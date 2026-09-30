import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for Cline (formerly Claude Dev) VS Code extension.
 *
 * Storage location:
 *   Windows: %APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/
 *   macOS:   ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/
 *   Linux:   ~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/<task-id>/
 *
 * Files per task:
 *   api_conversation_history.json — full API messages with tool calls
 *   ui_messages.json — UI-rendered messages
 *
 * We parse api_conversation_history.json (richest data).
 */

interface ClineMessage {
  role: "user" | "assistant";
  content: string | ClineContentBlock[];
  ts?: number; // Unix timestamp ms (added by Cline)
}

interface ClineContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ClineContentBlock[];
  is_error?: boolean;
}

export class ClineParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    // Cline's api_conversation_history.json is a JSON array
    if (
      (filename.includes("api_conversation_history") ||
        filename.includes("cline") ||
        filename.includes("claude-dev") ||
        filename.includes("roo-cline") ||
        filename.includes("roo-code")) &&
      filename.endsWith(".json") &&
      firstLine
    ) {
      try {
        // Should start with [ (array)
        const trimmed = firstLine.trim();
        if (trimmed.startsWith("[")) return true;
        // Or could be first element
        const obj = JSON.parse(trimmed);
        return obj.role != null && (obj.content != null || obj.ts != null);
      } catch {
        return false;
      }
    }
    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    let messages: ClineMessage[];
    try {
      messages = JSON.parse(contents);
    } catch {
      return [];
    }

    if (!Array.isArray(messages) || messages.length === 0) return [];

    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    let model: string | undefined;
    const lastToolCallId = new Map<string, number>();

    // Derive timestamps: Cline may have ts field, or we synthesize
    let baseTime = Date.now();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") continue;
      const timestamp = safeTimestamp(msg.ts, new Date(baseTime + i * 1000).toISOString());

      const content = msg.content;

      // Simple string content
      if (typeof content === "string") {
        events.push({
          id: eventId++,
          timestamp,
          type: "message",
          role: msg.role === "assistant" ? "assistant" : "user",
          content,
        });
        continue;
      }

      // Array content blocks (same as Claude API format)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "text" && block.text) {
            events.push({
              id: eventId++,
              timestamp,
              type: "message",
              role: msg.role === "assistant" ? "assistant" : "user",
              content: block.text,
            });
          } else if (block.type === "tool_use") {
            const eid = eventId++;
            events.push({
              id: eid,
              timestamp,
              type: "tool_call",
              role: "assistant",
              toolCall: {
                name: block.name ?? "unknown",
                arguments: block.input,
              },
            });
            if (block.id) {
              lastToolCallId.set(block.id, eid);
            }
          } else if (block.type === "tool_result") {
            const toolCallEventId = block.tool_use_id
              ? lastToolCallId.get(block.tool_use_id)
              : undefined;

            let output = "";
            if (typeof block.content === "string") {
              output = block.content;
            } else if (Array.isArray(block.content)) {
              output = block.content
                .filter((c): c is ClineContentBlock => c != null && typeof c === "object" && c.type === "text" && !!c.text)
                .map((c) => c.text!)
                .join("\n");
            }

            events.push({
              id: eventId++,
              timestamp,
              type: "tool_result",
              role: "user",
              toolResult: {
                output: output.slice(0, 10000),
                isError: block.is_error ?? false,
                toolCallEventId,
              },
            });
          }
        }
      }
    }

    if (events.length === 0) return [];

    // Extract task ID from filename
    const taskMatch = filename.match(/([a-f0-9-]{20,})/i);
    const taskId = taskMatch ? taskMatch[1] : filename.replace(/\.json$/, "");

    const trajectory: Trajectory = {
      version: "1.0",
      source: "cline",
      session: {
        id: taskId,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        model,
        metadata: { tool: "cline" },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}
