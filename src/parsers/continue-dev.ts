import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for Continue.dev VS Code extension sessions.
 *
 * Storage location:
 *   ~/.continue/sessions/<session-id>.json
 *
 * Format: JSON object with title, sessionId, history array of steps.
 * Each step has role, content, and optional toolCalls.
 */

interface ContinueSession {
  title?: string;
  sessionId?: string;
  workspaceDirectory?: string;
  history?: ContinueStep[];
  dateCreated?: string;
}

interface ContinueStep {
  role?: "user" | "assistant" | "system" | "tool";
  content?: string | ContinueContentPart[];
  toolCalls?: ContinueToolCall[];
  name?: string; // tool name for role=tool
  toolCallId?: string;
  timestamp?: number;
}

interface ContinueContentPart {
  type: "text" | "imageUrl";
  text?: string;
}

interface ContinueToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  type?: string;
}

export class ContinueDevParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    if (!filename.endsWith(".json")) return false;

    // Filename hint
    if (filename.includes("continue") || filename.includes(".continue")) return true;

    if (!firstLine) return false;
    const trimmed = firstLine.trim();

    // Single-line JSON: parse directly
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        return (
          (obj.sessionId != null || obj.title != null) &&
          obj.history != null &&
          Array.isArray(obj.history)
        );
      } catch {
        return false;
      }
    }

    // Pretty-printed JSON starts with just "{" — we can't confirm from first line alone.
    // Return false here; the parse() method will handle it. The registry tries all parsers,
    // so if no earlier parser matches, this will get a chance via filename or full parse.
    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    let session: ContinueSession;
    try {
      session = JSON.parse(contents);
    } catch {
      return [];
    }

    if (!session.history || !Array.isArray(session.history) || session.history.length === 0) {
      return [];
    }

    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    const toolCallIdMap = new Map<string, number>();
    let baseTime = session.dateCreated
      ? new Date(session.dateCreated).getTime()
      : Date.now();

    for (let i = 0; i < session.history.length; i++) {
      const step = session.history[i];
      if (!step || typeof step !== "object") continue;
      const timestamp = safeTimestamp(step.timestamp, new Date(baseTime + i * 2000).toISOString());

      // Extract text content
      let textContent = "";
      if (typeof step.content === "string") {
        textContent = step.content;
      } else if (Array.isArray(step.content)) {
        textContent = step.content
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
          .join("\n");
      }

      if (step.role === "user") {
        events.push({
          id: eventId++,
          timestamp,
          type: "message",
          role: "user",
          content: textContent,
        });
      } else if (step.role === "assistant") {
        // Add text message if present
        if (textContent) {
          events.push({
            id: eventId++,
            timestamp,
            type: "message",
            role: "assistant",
            content: textContent,
          });
        }

        // Add tool calls
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            const eid = eventId++;
            let args: Record<string, unknown> | string | undefined;
            if (tc.function?.arguments) {
              try {
                args = JSON.parse(tc.function.arguments);
              } catch {
                args = tc.function.arguments;
              }
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
            });

            if (tc.id) {
              toolCallIdMap.set(tc.id, eid);
            }
          }
        }
      } else if (step.role === "tool") {
        // Tool result
        const toolCallEventId = step.toolCallId
          ? toolCallIdMap.get(step.toolCallId)
          : undefined;

        events.push({
          id: eventId++,
          timestamp,
          type: "tool_result",
          role: "environment",
          toolResult: {
            output: textContent.slice(0, 10000),
            isError: false,
            toolCallEventId,
          },
        });
      } else if (step.role === "system") {
        events.push({
          id: eventId++,
          timestamp,
          type: "system",
          role: "system",
          content: textContent,
        });
      }
    }

    if (events.length === 0) return [];

    const sessionId = session.sessionId ?? filename.replace(/\.json$/, "");

    const trajectory: Trajectory = {
      version: "1.0",
      source: "continue-dev",
      session: {
        id: sessionId,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        cwd: session.workspaceDirectory,
        metadata: { tool: "continue-dev", title: session.title },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}
