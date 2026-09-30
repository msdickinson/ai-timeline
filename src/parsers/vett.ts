import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  fillEventDurations,
} from "../common/types";

/**
 * Parser for Vett benchmark run exports.
 *
 * VETT, an agent harness, is a lean benchmark runner for AI coding agents.
 * Each run produces a single JSON file containing a RunResult with one or
 * more InstanceResults inside.
 *
 * File pattern: results/{suite}_{profile}_{timestamp}.json
 *
 * The Vett export is a summary format — it stores aggregate stats per
 * step + tool call counts + the final patch, but NOT the full message
 * history. For full per-iteration traces, users should enable Vett's
 * jsonl-telemetry middleware (which produces a separate `.jsonl` file
 * the existing parsers can already read).
 *
 * Each InstanceResult becomes one Trajectory. Synthetic events are
 * generated for: session start, per-step summary, per tool-call,
 * the final patch, and the verification result.
 */

interface VettRunResult {
  suite_name?: string;
  profile_name?: string;
  model?: string;
  total?: number;
  passed?: number;
  failed?: number;
  errored?: number;
  accuracy?: number;
  avg_confidence?: number;
  calibration_error?: number;
  total_duration_seconds?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  started_at?: string;
  completed_at?: string;
  instances?: VettInstanceResult[];
}

interface VettInstanceResult {
  instance_id?: string;
  suite_name?: string;
  passed?: boolean;
  confidence?: number;
  confidence_scores?: Array<{ source: string; score: number; summary?: string }>;
  patch?: string | null;
  failure_reason?: string | null;
  total_iterations?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  duration_seconds?: number;
  started_at?: string;
  completed_at?: string;
  steps?: VettStepTrace[];
}

interface VettStepTrace {
  step_name?: string;
  iterations?: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_seconds?: number;
  tool_calls?: Array<{ tool_name: string; duration_ms?: number; success?: boolean }>;
}

export class VettParser implements TrajectoryParser {
  readonly source = "vett" as const;

  canParse(filename: string, firstLine: string): boolean {
    const lower = filename.toLowerCase();

    // Aggregate RunResult JSON (thin trajectories, one per instance)
    if (lower.endsWith(".json") &&
        firstLine.includes('"profile_name"') &&
        firstLine.includes('"instances"')) {
      return true;
    }

    // Vett CS3 LiveSink event-stream JSONL (vett run --trajectory-dir / --live-port).
    // One JSON object per line, envelope shape: {seq, ts, type, instance_id, data}.
    // Mixed-instance run-level events.jsonl OR per-instance instances/<id>/events.jsonl.
    // Detected by the presence of the "seq" + "type" + "data" envelope keys, which
    // are unique to the CS3 sink.
    if (lower.endsWith(".jsonl") &&
        firstLine.includes('"seq"') &&
        firstLine.includes('"type"') &&
        firstLine.includes('"data"')) {
      return true;
    }

    // Legacy full-history trace JSONL (older `vett run --trace`).
    // Each line is a per-iteration snapshot with a messages[] array.
    if (lower.endsWith(".jsonl") &&
        firstLine.includes('"iteration"') &&
        firstLine.includes('"messages"') &&
        firstLine.includes('"assistant_content"')) {
      return true;
    }

    // `vett team-bench` per-instance session log (_bench-session.jsonl):
    // {ts,type,data} envelopes where data carries the team `thread_id`.
    // Distinguished from the LiveSink stream by the ABSENCE of `seq` /
    // `instance_id` and the PRESENCE of `thread_id` (the multi-agent tag
    // the coordinator stamps on every team event).
    if (lower.endsWith(".jsonl") &&
        firstLine.includes('"type"') &&
        firstLine.includes('"data"') &&
        firstLine.includes('"thread_id"') &&
        !firstLine.includes('"seq"') &&
        !firstLine.includes('"instance_id"')) {
      return true;
    }

    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    // CS3 LiveSink event stream — sniff by content (envelope keys) so the same
    // .jsonl extension can dispatch to the right parser.
    if (filename.toLowerCase().endsWith(".jsonl")) {
      const firstLine = contents.split("\n", 1)[0] ?? "";
      if (firstLine.includes('"seq"') && firstLine.includes('"type"') && firstLine.includes('"data"')) {
        return this.parseLiveSinkJsonl(contents, filename);
      }
      // team-bench session log: {ts,type,data} + thread_id, no seq/instance_id.
      if (firstLine.includes('"type"') && firstLine.includes('"data"') &&
          firstLine.includes('"thread_id"') &&
          !firstLine.includes('"seq"') && !firstLine.includes('"instance_id"')) {
        return this.parseBenchSessionJsonl(contents, filename);
      }
      // Legacy trace JSONL path: rich per-instance trajectory from full message history
      const trajectory = this.parseTraceJsonl(contents, filename);
      return trajectory ? [trajectory] : [];
    }

    // Aggregate JSON path: thin per-instance trajectories
    let data: VettRunResult;
    try {
      data = JSON.parse(contents) as VettRunResult;
    } catch {
      return [];
    }

    if (!data.instances || data.instances.length === 0) return [];

    return data.instances.map(inst => this.buildTrajectory(inst, data, filename));
  }

  /**
   * Build a rich trajectory from a Vett `--trace` JSONL file.
   * Each line is a self-contained snapshot of the conversation after
   * iteration N. The LAST line has the most complete message history,
   * so we use it as the source of truth for events.
   */
  private parseTraceJsonl(contents: string, filename: string): Trajectory | null {
    const lines = contents.split("\n").filter(l => l.trim().length > 0);
    if (lines.length === 0) return null;

    let lastSnapshot: any = null;
    const perIterSnapshots: any[] = [];
    for (const line of lines) {
      try {
        const snap = JSON.parse(line);
        perIterSnapshots.push(snap);
        lastSnapshot = snap;
      } catch {
        // skip malformed line
      }
    }

    if (!lastSnapshot || !Array.isArray(lastSnapshot.messages)) return null;

    // Instance id is derived from the filename:
    //   {suite}_{profile}_{timestamp}_{instance_id}.jsonl
    // Split on "_" and take the tail after the timestamp (best-effort).
    const base = filename.replace(/\.jsonl$/i, "").split(/[\\/]/).pop() ?? filename;
    const parts = base.split("_");
    const instanceId = parts.slice(4).join("_") || base;

    // Use the last snapshot's messages as the canonical history, then
    // synthesize TrajectoryEvents with timestamps derived from the per-iter
    // snapshots so the timeline view can order them.
    const events: TrajectoryEvent[] = [];
    let nextId = 1;
    const startMs = perIterSnapshots[0]?.timestamp
      ? Date.parse(perIterSnapshots[0].timestamp)
      : Date.now();

    // Walk the final message history and emit events. Since every snapshot
    // contains the FULL history up to that iteration, we use the last snapshot's
    // messages as the authoritative source.
    const messages = lastSnapshot.messages as Array<{
      role: string;
      content: string;
      tool_call_id?: string;
    }>;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Rough timestamp interpolation: spread messages across the
      // per-iteration timestamps we collected
      const iterIdx = Math.min(
        perIterSnapshots.length - 1,
        Math.floor((i / messages.length) * perIterSnapshots.length),
      );
      const tsSource = perIterSnapshots[iterIdx]?.timestamp;
      const timestamp = tsSource
        ? new Date(tsSource).toISOString()
        : new Date(startMs + i * 1000).toISOString();

      if (msg.role === "tool") {
        events.push({
          id: nextId++,
          timestamp,
          type: "tool_result",
          role: "environment",
          toolResult: {
            output: msg.content,
            isError: msg.content?.includes("<exception>") || false,
            toolCallEventId: msg.tool_call_id
              ? Number(msg.tool_call_id) || undefined
              : undefined,
          },
        });
      } else if (msg.role === "assistant") {
        events.push({
          id: nextId++,
          timestamp,
          type: "message",
          role: "assistant",
          content: msg.content,
        });
      } else if (msg.role === "user" || msg.role === "system") {
        events.push({
          id: nextId++,
          timestamp,
          type: msg.role === "system" ? "system" : "message",
          role: msg.role as any,
          content: msg.content,
        });
      }
    }

    // Emit a trailing summary event with per-iteration tool_calls metadata
    // so the timeline knows which tools fired at which iteration.
    for (const snap of perIterSnapshots) {
      if (Array.isArray(snap.tool_calls)) {
        for (const tc of snap.tool_calls) {
          events.push({
            id: nextId++,
            timestamp: snap.timestamp
              ? new Date(snap.timestamp).toISOString()
              : new Date(startMs).toISOString(),
            type: "tool_call",
            role: "assistant",
            toolCall: {
              name: tc.name,
              arguments: tc.arguments ?? "",
            },
            tokens: snap.input_tokens
              ? { input: snap.input_tokens, output: snap.output_tokens ?? 0 }
              : undefined,
          });
        }
      }
    }

    events.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta - tb || a.id - b.id;
    });

    const endMs = perIterSnapshots[perIterSnapshots.length - 1]?.timestamp
      ? Date.parse(perIterSnapshots[perIterSnapshots.length - 1].timestamp)
      : startMs;

    const traj: Trajectory = {
      version: "1.0",
      source: "vett",
      session: {
        id: `vett-trace/${instanceId}`,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        status: "unknown",
        metadata: {
          instanceId,
          source: "vett-trace",
          sourceFile: filename,
          iterations: perIterSnapshots.length,
          vettRichTrace: true, // marker used by the dedupe pass below
        },
      },
      events,
    };
    fillEventDurations(events);
    traj.summary = computeSummary(events);
    return traj;
  }

  private buildTrajectory(
    inst: VettInstanceResult,
    run: VettRunResult,
    filename: string,
  ): Trajectory {
    const events: TrajectoryEvent[] = [];
    let nextId = 1;
    const startMs = inst.started_at ? Date.parse(inst.started_at) : Date.now();
    const endMs = inst.completed_at ? Date.parse(inst.completed_at) : startMs;
    const totalIters = Math.max(1, inst.total_iterations ?? 1);
    const msPerIter = Math.max(1, (endMs - startMs) / totalIters);
    let cursor = startMs;

    const at = (offset = 0) => new Date(cursor + offset).toISOString();

    // Session start banner
    events.push({
      id: nextId++,
      timestamp: at(),
      type: "system",
      role: "system",
      content: `Vett run: ${run.suite_name ?? "?"} / ${run.profile_name ?? "?"} / ${run.model ?? "?"}`,
    });

    for (const step of inst.steps ?? []) {
      events.push({
        id: nextId++,
        timestamp: at(),
        type: "system",
        role: "system",
        content: `Step "${step.step_name ?? "?"}" — ${step.iterations ?? 0} iterations, ` +
          `${step.input_tokens ?? 0} in / ${step.output_tokens ?? 0} out tokens`,
        stage: step.step_name,
        tokens: {
          input: step.input_tokens ?? 0,
          output: step.output_tokens ?? 0,
        },
        durationMs: Math.round((step.duration_seconds ?? 0) * 1000),
      });

      for (const tc of step.tool_calls ?? []) {
        const callId = nextId++;
        events.push({
          id: callId,
          timestamp: at(),
          type: "tool_call",
          role: "assistant",
          toolCall: { name: tc.tool_name, arguments: "" },
          stage: step.step_name,
        });
        events.push({
          id: nextId++,
          timestamp: at(tc.duration_ms ?? 0),
          type: "tool_result",
          role: "environment",
          toolResult: {
            output: tc.success === false ? "(tool reported failure)" : "(success)",
            isError: tc.success === false,
            toolCallEventId: callId,
          },
          durationMs: tc.duration_ms,
          stage: step.step_name,
        });
        cursor += tc.duration_ms ?? msPerIter;
      }
    }

    if (inst.patch) {
      events.push({
        id: nextId++,
        timestamp: new Date(endMs).toISOString(),
        type: "message",
        role: "assistant",
        content: "```diff\n" + inst.patch + "\n```",
      });
    }

    events.push({
      id: nextId++,
      timestamp: new Date(endMs).toISOString(),
      type: inst.failure_reason ? "error" : "system",
      role: "system",
      content: inst.failure_reason
        ? `ERROR: ${inst.failure_reason}`
        : `Verification: ${inst.passed ? "PASSED" : "FAILED"}`,
    });

    fillEventDurations(events);

    const traj: Trajectory = {
      version: "1.0",
      source: "vett",
      session: {
        id: `${run.profile_name ?? "vett"}/${inst.instance_id ?? "?"}`,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        model: run.model,
        status: inst.failure_reason ? "error" : inst.passed ? "succeeded" : "failed",
        metadata: {
          instanceId: inst.instance_id,
          suiteName: inst.suite_name ?? run.suite_name,
          profileName: run.profile_name,
          source: "vett",
          sourceFile: filename,
        },
      },
      events,
    };

    if (inst.confidence_scores && inst.confidence_scores.length > 0) {
      const top = inst.confidence_scores[0];
      traj.analysis = {
        analyzedBy: top.source,
        analyzedAt: new Date(endMs).toISOString(),
        verdict: inst.passed ? "correct" : top.score < 0.5 ? "incorrect" : "inconclusive",
        confidence: top.score,
        summary: top.summary ?? `Confidence ${top.score.toFixed(2)} from ${top.source}`,
        explanation: inst.confidence_scores
          .map(score => `${score.source}: ${score.score.toFixed(2)}${score.summary ? ` — ${score.summary}` : ""}`)
          .join("\n"),
        patchCorrectness: inst.passed ? "correct" : inst.patch ? "incorrect" : "no_patch",
      };
    }

    traj.summary = computeSummary(events);
    return traj;
  }

  // ────────────────────────────────────────────────────────────────────
  // CS3 LiveSink JSONL: per-event envelope, one Trajectory per instance.
  // ────────────────────────────────────────────────────────────────────

  /**
   * Parse the new (2026-04-25+) CS3 LiveSink event-stream JSONL.
   *
   * File can be either:
   *   - <output>/events.jsonl              — multi-instance, mixed by time
   *   - <output>/instances/<id>/events.jsonl — single instance, time-ordered
   *
   * Each line is one envelope:
   *   { seq: number, ts: ISO, type: string, instance_id: string|null, data: {...} }
   *
   * We group by instance_id and emit one Trajectory per instance. Run-level
   * events (instance_id == null, e.g. run_start/run_end) are dropped — they're
   * better surfaced in the Live page or a separate run-summary view.
   *
   * Mapping vett event types → TrajectoryEvent:
   *   instance_start            → system message ("Instance X started")
   *   iteration_start           → (skip — too noisy; iter is on tool_call_end)
   *   iteration_end             → (skip)
   *   llm_response              → assistant message (with token usage)
   *   llm_error                 → error event
   *   tool_call_start           → tool_call event (correlation key: data.call_id)
   *   tool_call_end             → tool_result event (linked back via call_id)
   *   session_recovery          → system message (cwd/env reset)
   *   session_recovery_failed   → error event
   *   error                     → error event (middleware exception)
   *   instance_end              → system message with end_reason
   *   patch_capture_failed      → error event (post-instance)
   *   post_hook_failed          → error event (post-instance)
   */
  /**
   * VETT's tool_call_start envelope doesn't include the arguments — only
   * the tool name and call_id. So Diff / File Edits / etc. views see
   * `arguments=""` and render "unknown file" with no patch.
   *
   * For file_editor calls specifically, the result_preview text from the
   * matching tool_call_end almost always names the file:
   *   - "File created successfully at: /testbed/foo.py"
   *   - "Here's the result of running `cat -n` on /testbed/foo.py:"
   *   - "The file /testbed/foo.py has been edited..."
   *   - "Last edit to /testbed/foo.py undone successfully."
   *
   * Extract the path here and synthesise minimal {command, path} JSON so
   * downstream views can at least show which file was touched. The actual
   * `file_text` / `old_str` / `new_str` are still missing — that requires
   * a VETT sidecar update to include arguments in tool_call_start.data.
   */
  private deriveFileEditorArgsFromResult(result: string): string {
    if (!result) return "";
    const patterns: Array<{ command: string; re: RegExp }> = [
      { command: "create", re: /File created successfully at:\s*(\S+)/ },
      { command: "view",   re: /Here's the result of running `cat -n` on\s+(\S+):/ },
      { command: "view",   re: /Here's the files and directories up to .* deep in\s+(\S+),/ },
      { command: "str_replace", re: /The file\s+(\S+)\s+has been edited\./ },
      { command: "insert", re: /The file\s+(\S+)\s+has been edited\./ },
      { command: "undo_edit", re: /Last edit to\s+(\S+)\s+undone successfully\./ },
    ];
    for (const { command, re } of patterns) {
      const m = result.match(re);
      if (m && m[1]) {
        return JSON.stringify({ command, path: m[1], _derivedFromResult: true });
      }
    }
    return "";
  }

  /**
   * Compute the per-member agent label from an event's `data` envelope.
   *
   * VETT's TeamCoordinator tags EVERY team event with `thread_id`
   * (`"main"` for the leader, else the dispatch's task id like
   * `implementer-1`) plus a human `member` role name. This is the same
   * multi-agent signal Claude Code encodes via per-subagent files.
   *
   * We mirror Claude's model exactly:
   *   - `thread_id === "main"` (or absent) → undefined. Leader events
   *     stay in the normal main lanes, just like a Claude *parent*
   *     session, so the gantt renders the leader as the top track.
   *   - any other thread_id → a dispatched member. Label with the member
   *     role, disambiguated by thread_id when several dispatches share a
   *     role (implementer-1 vs implementer-2), so each becomes its own
   *     swim-lane. `event.agent` is the field the gantt/merge views key
   *     off to split per-member tracks.
   */
  private agentLabelFor(data: Record<string, unknown> | undefined): string | undefined {
    if (!data) return undefined;
    const tid = data.thread_id;
    if (typeof tid !== "string" || tid === "" || tid === "main") return undefined;
    const member = typeof data.member === "string" ? data.member : "";
    // thread_id is usually already role-prefixed ("implementer-1"); only
    // prepend the member name when it isn't (e.g. an opaque task id).
    if (member && !tid.toLowerCase().includes(member.toLowerCase())) {
      return `${member} (${tid})`;
    }
    return tid;
  }

  /**
   * Shared envelope → TrajectoryEvent mapper used by BOTH the LiveSink
   * (per-instance) path and the team-bench session-log path. Callers pass
   * an already-sorted list of envelopes for ONE trajectory; this walks
   * them, links tool_call/tool_result by call_id, and — critically —
   * stamps `event.agent` from each envelope's thread_id/member so team
   * runs render every leader + member as its own track.
   */
  private buildEventsFromEnvelopes(
    envs: Array<{ ts?: string; type?: string; instance_id?: string | null; data?: Record<string, unknown> }>,
  ): { events: TrajectoryEvent[]; endReason: string | null } {
    const events: TrajectoryEvent[] = [];
    let nextId = 1;
    // Map vett call_id (string) → TrajectoryEvent.id (number) so tool_result
    // events can link back via toolCall.eventId.
    const callIdToEventId = new Map<string, number>();
    let endReason: string | null = null;

    for (const env of envs) {
      const ts = env.ts ?? new Date().toISOString();
      const data = env.data ?? {};
      const type = env.type ?? "";
      const agent = this.agentLabelFor(data);
      const before = events.length;

      switch (type) {
        case "instance_start":
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "system",
            role: "system",
            content: `Instance ${env.instance_id ?? ""} started`,
          });
          break;

        case "llm_response": {
          const inputTok = Number(data.input_tokens ?? 0);
          const outputTok = Number(data.output_tokens ?? 0);
          const iter = Number(data.iteration ?? 0);
          // VETT only emits llm_response when the response LANDS — there
          // is no llm_request_start envelope, so the call's actual time
          // span is invisible without back-filling. We compute the call
          // duration as the gap between the previous event's end and
          // this response's timestamp, and backdate the message's own
          // timestamp to the call start. Net effect: the AI Call bar in
          // the Gantt now spans the real LLM time (~20s/call) instead
          // of collapsing to a zero-width tick.
          const responseTs = new Date(ts).getTime();
          let startTsIso = ts;
          let llmDurationMs: number | undefined;
          if (events.length > 0 && Number.isFinite(responseTs)) {
            const prev = events[events.length - 1];
            const prevTs = new Date(prev.timestamp).getTime();
            const prevEnd = prevTs + (prev.durationMs ?? 0);
            if (Number.isFinite(prevEnd) && prevEnd < responseTs) {
              startTsIso = new Date(prevEnd).toISOString();
              llmDurationMs = responseTs - prevEnd;
            }
          }
          // The team-bench session log carries the full assistant message
          // inline as data.content = { role, content: [{type, text}, ...] }.
          // Extract any narration text so the member's track shows real
          // content instead of a generic "(LLM response)" placeholder.
          // Function-call blocks are skipped — they arrive separately as
          // tool_call_start events (with arguments). The LiveSink stream
          // has no data.content, so it keeps the placeholder.
          let content = `(LLM response, iter ${iter})`;
          const inner = data.content as { content?: unknown } | undefined;
          if (inner && Array.isArray(inner.content)) {
            const texts = (inner.content as Array<Record<string, unknown>>)
              .filter((b) => b && b.type === "text" && typeof b.text === "string")
              .map((b) => b.text as string)
              .join("\n")
              .trim();
            if (texts) content = texts;
          }
          events.push({
            id: nextId++,
            timestamp: startTsIso,
            type: "message",
            role: "assistant",
            content,
            tokens: { input: inputTok, output: outputTok },
            turnIndex: iter,
            durationMs: llmDurationMs,
          });
          break;
        }

        case "llm_error":
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "error",
            role: "system",
            content: `LLM error: ${String(data.message ?? "")}`,
          });
          break;

        case "tool_call_start": {
          const callId = String(data.call_id ?? "");
          const eventId = nextId++;
          if (callId) callIdToEventId.set(callId, eventId);
          // The team-bench log includes the real arguments object; the
          // SWE-bench LiveSink stream does not (it's back-filled from the
          // result below). Pass the object straight through when present.
          const args =
            data.arguments && typeof data.arguments === "object"
              ? (data.arguments as Record<string, unknown>)
              : "";
          events.push({
            id: eventId,
            timestamp: ts,
            type: "tool_call",
            role: "assistant",
            toolCall: {
              name: String(data.tool_name ?? "unknown"),
              arguments: args,
            },
          });
          break;
        }

        case "tool_call_end": {
          const callId = String(data.call_id ?? "");
          const linkedId = callId ? callIdToEventId.get(callId) : undefined;
          const success = data.success !== false;
          const resultText = String(data.result_preview ?? "");
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "tool_result",
            role: "environment",
            toolResult: {
              output: resultText,
              isError: !success,
              toolCallEventId: linkedId,
            },
            durationMs: typeof data.duration_ms === "number" ? data.duration_ms : undefined,
          });
          // VETT's LiveSink tool_call_start envelope doesn't include the
          // arguments, so the corresponding tool_call event landed with
          // arguments="". For file_editor calls, derive a sensible
          // {command, path} back-fill from the result text so views (Diff,
          // File Edits) can show "/testbed/foo.py" instead of "unknown
          // file". (No-op for team-bench logs — args were already set.)
          if (linkedId !== undefined) {
            const callEvent = events.find((e) => e.id === linkedId);
            if (callEvent?.toolCall?.name === "file_editor" && !callEvent.toolCall.arguments) {
              const derived = this.deriveFileEditorArgsFromResult(resultText);
              if (derived) callEvent.toolCall.arguments = derived;
            } else if (callEvent?.toolCall?.name === "terminal" && !callEvent.toolCall.arguments) {
              // Terminal calls don't appear in the diff view but the
              // tool-call panels look better with SOMETHING here. We
              // still don't have the original command, but flag it so
              // downstream code can render "(arguments not captured)".
              callEvent.toolCall.arguments = JSON.stringify({ _captured: false });
            }
          }
          break;
        }

        case "dispatch_start":
          // Leader hands work to a member. Surface it as a system marker
          // on the LEADER track (thread_id=main) so the reader sees where
          // each member's track was spawned from.
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "system",
            role: "system",
            content: `Dispatched ${data.member ?? "member"} → ${data.task_id ?? "?"}: ${String(data.task ?? "").slice(0, 200)}`,
          });
          break;

        case "session_recovery":
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "system",
            role: "system",
            content: `Session recovered (iter ${data.iteration ?? "?"}, reason: ${data.reason ?? "?"})`,
          });
          break;

        case "session_recovery_failed":
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "error",
            role: "system",
            content: `Session recovery FAILED (iter ${data.iteration ?? "?"}): ${data.error ?? ""}`,
          });
          break;

        case "error":
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "error",
            role: "system",
            content: `Middleware error: ${data.message ?? ""}`,
          });
          break;

        case "patch_capture_failed":
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "error",
            role: "system",
            content: `Patch capture failed: ${data.error ?? ""}`,
          });
          break;

        case "post_hook_failed":
          events.push({
            id: nextId++,
            timestamp: ts,
            type: "error",
            role: "system",
            content: `Post-process hook failed: ${data.error ?? ""}`,
          });
          break;

        case "instance_end":
          endReason = String(data.end_reason ?? "unknown");
          events.push({
            id: nextId++,
            timestamp: ts,
            type: endReason === "finish_tool" ? "system" : "error",
            role: "system",
            content: `Instance ended: ${endReason}`,
          });
          break;

        // iteration_start / iteration_end / llm_request intentionally
        // dropped: too noisy, and iteration count is already on
        // llm_response/tool_call events.
      }

      // Stamp the member label on every event this envelope produced.
      // Leader (thread_id=main) → agent stays undefined → main lanes.
      if (agent) {
        for (let k = before; k < events.length; k++) events[k].agent = agent;
      }
    }

    return { events, endReason };
  }

  private parseLiveSinkJsonl(contents: string, filename: string): Trajectory[] {
    type Envelope = {
      seq?: number;
      ts?: string;
      type?: string;
      instance_id?: string | null;
      data?: Record<string, unknown>;
    };

    const envelopes: Envelope[] = [];
    for (const raw of contents.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        envelopes.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
    if (envelopes.length === 0) return [];

    // Group by instance_id. Drop run-level events (instance_id falsy).
    const byInstance = new Map<string, Envelope[]>();
    for (const e of envelopes) {
      const id = e.instance_id;
      if (!id) continue;
      if (!byInstance.has(id)) byInstance.set(id, []);
      byInstance.get(id)!.push(e);
    }

    const trajectories: Trajectory[] = [];
    for (const [instanceId, instEvents] of byInstance) {
      // Sort by seq (preferred — monotonic within a run) then by ts.
      instEvents.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

      const { events, endReason } = this.buildEventsFromEnvelopes(instEvents);

      if (events.length === 0) continue;

      const startTime = events[0].timestamp;
      const endTime = events[events.length - 1].timestamp;
      const status: Trajectory["session"]["status"] =
        endReason === "finish_tool" ? "succeeded"
        : endReason === null         ? "running"
        : endReason === "error"      ? "error"
        : "failed";

      fillEventDurations(events);

      const traj: Trajectory = {
        version: "1.0",
        source: "vett",
        session: {
          id: `vett-live/${instanceId}`,
          startTime,
          endTime,
          status,
          metadata: {
            instanceId,
            source: "vett-livesink",
            sourceFile: filename,
            endReason,
          },
        },
        events,
      };
      traj.summary = computeSummary(events);
      trajectories.push(traj);
    }

    return trajectories;
  }

  // ────────────────────────────────────────────────────────────────────
  // Team-bench session log: `<workspace>/_bench-session.jsonl`.
  // ────────────────────────────────────────────────────────────────────

  /**
   * Parse a `vett team-bench` per-instance session log.
   *
   * Shape: one `{ ts, type, data }` envelope per line — NO `seq`, NO
   * top-level `instance_id` (that's what distinguishes it from the
   * LiveSink stream). It's a single team run (one leader + N dispatched
   * members), so we emit ONE Trajectory whose events are agent-tagged by
   * thread_id. In AI Timeline this renders exactly like a Claude Code
   * session with subagents: the leader in the main lanes, each dispatched
   * member (implementer-1, implementer-2, researcher-1, …) as its own
   * track, with the Agents: Merged/Rows/Full toggle available.
   */
  private parseBenchSessionJsonl(contents: string, filename: string): Trajectory[] {
    type Envelope = { ts?: string; type?: string; data?: Record<string, unknown> };
    const envelopes: Envelope[] = [];
    for (const raw of contents.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        envelopes.push(JSON.parse(line));
      } catch {
        // skip malformed / partially-written line
      }
    }
    if (envelopes.length === 0) return [];

    // Ordered by ts (the log is written in emission order already, but a
    // stable sort keeps interleaved member/leader events monotonic).
    envelopes.sort((a, b) => {
      const ta = a.ts ? Date.parse(a.ts) : 0;
      const tb = b.ts ? Date.parse(b.ts) : 0;
      return ta - tb;
    });

    const { events, endReason } = this.buildEventsFromEnvelopes(envelopes);
    if (events.length === 0) return [];

    // Derive a readable instance id from the workspace dir name:
    //   .../vett-team-bench/empty-git-repo-…/_bench-session.jsonl
    const parts = filename.split(/[\\/]/);
    const dir = parts.length >= 2 ? parts[parts.length - 2] : "team-bench";

    // Distinct member tracks present (for a quick metadata glance).
    const members = [...new Set(events.map((e) => e.agent).filter(Boolean))] as string[];

    fillEventDurations(events);
    const traj: Trajectory = {
      version: "1.0",
      source: "vett",
      session: {
        id: `vett-team/${dir}`,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1].timestamp,
        status:
          endReason === "finish_tool" ? "succeeded"
          : endReason === null         ? "unknown"
          : endReason === "error"      ? "error"
          : "failed",
        metadata: {
          instanceId: dir,
          source: "vett-team-bench",
          sourceFile: filename,
          endReason,
          members,
        },
      },
      events,
    };
    traj.summary = computeSummary(events);
    return [traj];
  }
}
