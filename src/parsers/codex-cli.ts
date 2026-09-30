import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for OpenAI Codex CLI sessions.
 *
 * Storage location:
 *   ~/.codex/sessions/<session-id>.json
 *
 * Format: JSON with messages array (OpenAI chat format).
 * Each message has role, content, and optional tool_calls/tool_call_id.
 */

interface CodexSession {
  id?: string;
  model?: string;
  created_at?: string;
  messages?: CodexMessage[];
  instructions?: string;
}

interface CodexMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: string };
    type?: string;
  }>;
  tool_call_id?: string;
  name?: string;
  timestamp?: string;
}

export class CodexCliParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    if (filename.includes("codex") && (filename.endsWith(".json") || filename.endsWith(".jsonl"))) return true;
    if (!firstLine) return false;

    // JSON format: single object with messages + model + instructions
    if (filename.endsWith(".json")) {
      try {
        const trimmed = firstLine.trim();
        if (!trimmed.startsWith("{")) return false;
        const obj = JSON.parse(trimmed);
        return obj.messages != null && Array.isArray(obj.messages) && obj.model != null && obj.instructions != null;
      } catch {
        return false;
      }
    }

    // JSONL format: lines with ts, dir, kind fields (codex-rs TUI format)
    if (filename.endsWith(".jsonl")) {
      try {
        const obj = JSON.parse(firstLine.trim());
        return obj.ts != null && obj.kind != null && (obj.kind === "session_start" || obj.dir != null);
      } catch {
        return false;
      }
    }

    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    // Try JSONL format first (codex-rs TUI event log)
    if (filename.endsWith(".jsonl") || contents.trim().startsWith("{\"ts\"")) {
      return this.parseJsonl(contents, filename);
    }

    // JSON format (single session object)
    let session: CodexSession;
    try {
      session = JSON.parse(contents);
    } catch {
      return [];
    }

    if (!session.messages || session.messages.length === 0) return [];

    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    const baseTime = session.created_at ? new Date(session.created_at).getTime() : Date.now();
    const toolCallMap = new Map<string, number>();

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      if (!msg || typeof msg !== "object") continue;
      const timestamp = safeTimestamp(msg.timestamp, new Date(baseTime + i * 2000).toISOString());

      if (msg.role === "system") {
        events.push({
          id: eventId++,
          timestamp,
          type: "system",
          role: "system",
          content: msg.content ?? "",
        });
      } else if (msg.role === "user") {
        events.push({
          id: eventId++,
          timestamp,
          type: "message",
          role: "user",
          content: msg.content ?? "",
        });
      } else if (msg.role === "assistant") {
        if (msg.content) {
          events.push({
            id: eventId++,
            timestamp,
            type: "message",
            role: "assistant",
            content: msg.content,
            model: session.model,
          });
        }
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            if (!tc || typeof tc !== "object") continue;
            const eid = eventId++;
            let args: Record<string, unknown> | string | undefined;
            if (tc.function?.arguments) {
              try { args = JSON.parse(tc.function.arguments); } catch { args = tc.function.arguments; }
            }
            events.push({
              id: eid,
              timestamp,
              type: "tool_call",
              role: "assistant",
              toolCall: {
                name: tc.function?.name ?? "unknown",
                arguments: args,
              },
              model: session.model,
            });
            if (tc.id) toolCallMap.set(tc.id, eid);
          }
        }
      } else if (msg.role === "tool") {
        const toolCallEventId = msg.tool_call_id ? toolCallMap.get(msg.tool_call_id) : undefined;
        events.push({
          id: eventId++,
          timestamp,
          type: "tool_result",
          role: "environment",
          toolResult: {
            output: (msg.content ?? "").slice(0, 10000),
            isError: false,
            toolCallEventId,
          },
        });
      }
    }

    if (events.length === 0) return [];

    const sessionId = session.id ?? filename.replace(/\.json$/, "").split("/").pop() ?? "codex";

    const trajectory: Trajectory = {
      version: "1.0",
      source: "codex-cli",
      session: {
        id: sessionId,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        model: session.model,
        metadata: { tool: "codex-cli" },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }

  /** Parse codex-rs TUI event JSONL format */
  private parseJsonl(contents: string, filename: string): Trajectory[] {
    const lines = contents.split("\n").filter((l) => l.trim());
    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    let sessionId = "";
    let model = "";
    let cwd = "";

    for (const line of lines) {
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = safeTimestamp(obj.ts);

      if (obj.kind === "session_start") {
        sessionId = obj.session_id ?? "";
        model = obj.model ?? "";
        cwd = obj.cwd ?? "";
        continue;
      }

      if (obj.kind === "codex_event" && obj.payload?.msg) {
        const msg = obj.payload.msg;

        if (msg.type === "session_configured") {
          sessionId = msg.session_id ?? sessionId;
          model = msg.model ?? model;
        } else if (msg.type === "task_started") {
          events.push({
            id: eventId++,
            timestamp,
            type: "system",
            role: "system",
            content: "Task started",
          });
        } else if (msg.type === "task_complete") {
          events.push({
            id: eventId++,
            timestamp,
            type: "system",
            role: "system",
            content: `Task complete: ${msg.result ?? ""}`,
          });
        } else if (msg.type === "agent_message" || msg.type === "message") {
          events.push({
            id: eventId++,
            timestamp,
            type: "message",
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.content ?? msg.text ?? "",
            model: msg.role === "assistant" ? model : undefined,
          });
        } else if (msg.type === "exec_command" || msg.type === "tool_call") {
          const eid = eventId++;
          events.push({
            id: eid,
            timestamp,
            type: "tool_call",
            role: "assistant",
            toolCall: {
              name: msg.tool_name ?? msg.name ?? "shell",
              arguments: msg.args ?? msg.command ? { command: msg.command } : undefined,
            },
          });
        } else if (msg.type === "exec_result" || msg.type === "tool_result") {
          events.push({
            id: eventId++,
            timestamp,
            type: "tool_result",
            role: "environment",
            toolResult: {
              output: (msg.output ?? msg.content ?? "").slice(0, 10000),
              isError: msg.exit_code != null && msg.exit_code !== 0,
            },
          });
        }
      }

      // insert_history events contain user/assistant turns
      if (obj.kind === "insert_history" && obj.payload) {
        const p = obj.payload;
        if (p.role) {
          events.push({
            id: eventId++,
            timestamp,
            type: "message",
            role: p.role === "user" ? "user" : "assistant",
            content: typeof p.content === "string" ? p.content : JSON.stringify(p.content),
            model: p.role === "assistant" ? model : undefined,
          });
        }
      }
    }

    if (events.length === 0) return [];

    const trajectory: Trajectory = {
      version: "1.0",
      source: "codex-cli",
      session: {
        id: sessionId || (filename.replace(/\.jsonl$/, "").split("/").pop() ?? "codex"),
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        model,
        cwd,
        metadata: { tool: "codex-cli" },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}
