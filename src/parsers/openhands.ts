import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
} from "../common/types";

/**
 * Parser for OpenHands evaluation output files.
 * Location: benchmarks/results/<run>/<dataset>/<model>/output.jsonl
 * Each line is a JSON object representing one instance with a full history array.
 */

interface OpenHandsInstance {
  instance_id?: string;
  attempt?: number;
  test_result?: {
    git_patch?: string;
    [key: string]: unknown;
  };
  instruction?: string;
  history?: OpenHandsEvent[];
  metrics?: {
    model_name?: string;
    accumulated_cost?: number;
    accumulated_token_usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cache_read_tokens?: number;
      cache_write_tokens?: number;
      reasoning_tokens?: number;
    };
    response_latencies?: Array<{
      model?: string;
      latency?: number;
    }>;
  };
  error?: string | null;
  [key: string]: unknown;
}

interface OpenHandsEvent {
  id?: string;
  timestamp?: string;
  source?: string; // "agent" | "environment" | "user"
  kind?: string; // "ActionEvent" | "ObservationEvent" | "MessageEvent" | "SystemPromptEvent" | "ConversationStateUpdateEvent"
  thought?: Array<{ type?: string; text?: string }> | string;
  reasoning_content?: string | null;
  action?: {
    thought?: string;
    command?: string;
    kind?: string; // "CmdRunAction" | "FileEditAction" | "ThinkAction" etc.
    path?: string;
    new_content?: string;
    old_str?: string;
    new_str?: string;
    [key: string]: unknown;
  };
  observation?: {
    content?: string | Array<{ type?: string; text?: string }>;
    is_error?: boolean;
    kind?: string; // "TerminalObservation" | "ThinkObservation" | "FileEditObservation" etc.
    [key: string]: unknown;
  };
  tool_name?: string;
  tool_call_id?: string;
  action_id?: string;
  key?: string;
  value?: unknown;
  llm_message?: {
    role?: string;
    content?: string | Array<{ type?: string; text?: string; cache_prompt?: boolean }>;
    [key: string]: unknown;
  };
  summary?: string;
  forgotten_event_ids?: string[];
}

export class OpenHandsParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    if (!firstLine) return false;
    // Accept .json or .jsonl files that contain OpenHands instance data
    if (filename.endsWith(".jsonl") || filename.endsWith(".json")) {
      try {
        const obj = JSON.parse(firstLine);
        return (
          obj.history != null &&
          Array.isArray(obj.history) &&
          (obj.instance_id != null || obj.instruction != null)
        );
      } catch {
        return false;
      }
    }
    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    const lines = contents.split("\n").filter((l) => l.trim());
    const trajectories: Trajectory[] = [];

    for (const line of lines) {
      let instance: OpenHandsInstance;
      try {
        instance = JSON.parse(line);
      } catch {
        continue;
      }

      if (!instance.history || !Array.isArray(instance.history)) continue;

      const events: TrajectoryEvent[] = [];
      let eventId = 0;
      const actionIdToEventId = new Map<string, number>();

      // Token usage from metrics (OpenHands tracks accumulated, not per-event)
      const accTokens = instance.metrics?.accumulated_token_usage;

      // Build latency index for duration estimation
      const latencies = instance.metrics?.response_latencies ?? [];
      let latencyIdx = 0;
      let userMsgCount = 0;

      for (const h of instance.history) {
        if (!h || typeof h !== "object" || !h.timestamp) continue;

        // Skip state update events — not interesting for trajectory view
        if (h.kind === "ConversationStateUpdateEvent") continue;

        // System prompt
        if (h.kind === "SystemPromptEvent") {
          const sysPrompt = (h as any).system_prompt;
          const content = sysPrompt?.text || extractText(h.thought) || "[system prompt]";
          events.push({
            id: eventId++,
            timestamp: h.timestamp,
            type: "system",
            role: "system",
            content: typeof content === "string" ? content : extractText(content),
          });
          continue;
        }

        // User message
        if (h.kind === "MessageEvent" && h.source === "user") {
          // Content can be in llm_message.content (array of {type,text}) or thought
          const llmMsg = (h as any).llm_message;
          let content = "";
          if (llmMsg?.content) {
            content = extractText(llmMsg.content);
          }
          if (!content) {
            content = extractText(h.thought) || (h.value as string) || "";
          }

          // Detect harness feedback disguised as user messages
          // These are tool validation errors or nudges, not real user input
          const isHarnessFeedback = userMsgCount > 0 && (
            /^(Missing required parameters|Function '.*' not found|Parameter '.*' is (not allowed|expected)|Please continue working)/i.test(content.trim())
          );
          userMsgCount++;

          if (isHarnessFeedback) {
            // Show as tool result error, not a user message
            events.push({
              id: eventId++,
              timestamp: h.timestamp,
              type: "tool_result",
              role: "environment",
              content,
              toolResult: {
                output: content,
                isError: true,
              },
            });
          } else {
            events.push({
              id: eventId++,
              timestamp: h.timestamp,
              type: "message",
              role: "user",
              content,
            });
          }
          continue;
        }

        // Condensation event (context compaction)
        if (h.kind === "Condensation") {
          events.push({
            id: eventId++,
            timestamp: h.timestamp,
            type: "system",
            role: "system",
            content: (h as any).summary || "[context condensed]",
            contextCompacted: true,
          });
          continue;
        }

        // Agent action
        if (h.kind === "ActionEvent" && h.source === "agent") {
          const action = h.action;
          const thought =
            action?.thought || extractText(h.thought) || undefined;

          // Emit thinking if present
          if (thought) {
            events.push({
              id: eventId++,
              timestamp: h.timestamp,
              type: "thinking",
              role: "assistant",
              content: thought,
            });
          }

          // Map action kind to a tool name
          const toolName = mapActionKind(action?.kind);
          const args = buildActionArgs(action);

          // Get latency for this action
          let durationMs: number | undefined;
          if (latencyIdx < latencies.length) {
            durationMs = Math.round(
              (latencies[latencyIdx]?.latency ?? 0) * 1000
            );
            latencyIdx++;
          }

          const eid = eventId++;
          events.push({
            id: eid,
            timestamp: h.timestamp,
            type: "tool_call",
            role: "assistant",
            toolCall: {
              name: toolName,
              arguments: args,
            },
            model: latencies[latencyIdx - 1]?.model,
            durationMs,
          });

          if (h.id) {
            actionIdToEventId.set(h.id, eid);
          }
          continue;
        }

        // Environment observation (tool result)
        if (h.kind === "ObservationEvent" && h.source === "environment") {
          const obs = h.observation;
          const output = extractObservationContent(obs);
          const toolCallEventId = h.action_id
            ? actionIdToEventId.get(h.action_id)
            : undefined;

          events.push({
            id: eventId++,
            timestamp: h.timestamp,
            type: "tool_result",
            role: "environment",
            toolResult: {
              output: output.slice(0, 10000),
              isError: obs?.is_error ?? false,
              toolCallEventId,
            },
          });
          continue;
        }
      }

      if (events.length === 0) continue;

      // Distribute accumulated tokens across assistant events as a linear ramp
      // so the timeline shows context window growing over time
      if (accTokens) {
        const assistantEvents = events.filter((e) => e.role === "assistant");
        const n = assistantEvents.length;
        if (n > 0) {
          const totalInput = (accTokens.prompt_tokens ?? 0) + (accTokens.cache_read_tokens ?? 0);
          const totalOutput = accTokens.completion_tokens ?? 0;
          // Each turn's prompt grows linearly (turn 1 sees ~1/n of total, turn n sees full total)
          // Per-event input ≈ totalInput / n (the marginal cost per turn)
          const perEventInput = Math.round(totalInput / n);
          const perEventOutput = Math.round(totalOutput / n);
          for (let i = 0; i < n; i++) {
            assistantEvents[i].tokens = {
              input: perEventInput,
              output: perEventOutput,
            };
          }
        }
      }

      // Derive status from error and patch
      let status: "succeeded" | "failed" | "error" | "unknown" = "unknown";
      if (instance.error) status = "error";
      else if (instance.test_result?.git_patch) status = "succeeded";
      else status = "failed";

      const trajectory: Trajectory = {
        version: "1.0",
        source: "openhands",
        session: {
          id: instance.instance_id ?? `openhands-${trajectories.length}`,
          startTime: events[0].timestamp,
          endTime: events[events.length - 1]?.timestamp,
          model:
            instance.metrics?.model_name ??
            latencies[0]?.model ??
            undefined,
          status,
          cost: instance.metrics?.accumulated_cost
            ? { totalUsd: instance.metrics.accumulated_cost }
            : undefined,
          metadata: {
            instanceId: instance.instance_id,
            attempt: instance.attempt,
            hasPatch: !!instance.test_result?.git_patch,
            error: instance.error,
            resolved: instance.test_result?.resolved,
          },
        },
        events,
      };

      trajectory.summary = computeSummary(events);
      trajectories.push(trajectory);
    }

    return trajectories;
  }
}

function extractText(
  thought: Array<{ type?: string; text?: string }> | string | undefined | null
): string {
  if (!thought) return "";
  if (typeof thought === "string") return thought;
  if (Array.isArray(thought)) {
    return thought
      .filter((t) => t != null && typeof t === "object" && t.text)
      .map((t) => t.text!)
      .join("\n");
  }
  return "";
}

function mapActionKind(kind?: string): string {
  if (!kind) return "unknown";
  const map: Record<string, string> = {
    CmdRunAction: "terminal",
    FileEditAction: "file_edit",
    FileWriteAction: "file_write",
    IPythonRunCellAction: "ipython",
    ThinkAction: "think",
    BrowseURLAction: "browse",
    BrowseInteractiveAction: "browse",
    MessageAction: "message",
    AgentFinishAction: "finish",
    AgentDelegateAction: "delegate",
  };
  return map[kind] ?? kind.replace("Action", "").toLowerCase();
}

function buildActionArgs(
  action?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!action) return undefined;
  const args: Record<string, unknown> = {};
  if (action.command) args.command = action.command;
  if (action.path) args.path = action.path;
  if (action.old_str) args.old_str = action.old_str;
  if (action.new_str) args.new_str = action.new_str;
  if (action.new_content) args.new_content = action.new_content;
  if (action.url) args.url = action.url;
  if (action.message) args.message = action.message;
  if (action.file_text) args.file_text = action.file_text;
  if (action.view_range) args.view_range = action.view_range;
  return Object.keys(args).length > 0 ? args : undefined;
}

function extractObservationContent(obs?: {
  content?: string | Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
}): string {
  if (!obs?.content) return "";
  if (typeof obs.content === "string") return obs.content;
  if (Array.isArray(obs.content)) {
    return obs.content
      .filter((c) => c != null && typeof c === "object" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }
  return "";
}
