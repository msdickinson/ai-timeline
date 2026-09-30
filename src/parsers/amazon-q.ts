import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for Amazon Q Developer CLI/IDE history.
 *
 * Storage location:
 *   ~/.aws/amazonq/history/<timestamp>.json
 *   Or exported via /save command
 *
 * Format: JSON with messages array (OpenAI-compatible chat format).
 */

interface AmazonQSession {
  conversationId?: string;
  messages?: AmazonQMessage[];
  model?: string;
  created?: string;
}

interface AmazonQMessage {
  role: "user" | "assistant" | "system";
  content?: string;
  timestamp?: string;
  toolUse?: {
    toolUseId?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  toolResult?: {
    toolUseId?: string;
    content?: string;
    status?: string;
  };
}

export class AmazonQParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    if (!filename.endsWith(".json")) return false;
    if (filename.includes("amazonq") || filename.includes("amazon-q")) return true;
    if (!firstLine) return false;
    try {
      const trimmed = firstLine.trim();
      if (!trimmed.startsWith("{")) return false;
      const obj = JSON.parse(trimmed);
      return (
        obj.conversationId != null &&
        obj.messages != null &&
        Array.isArray(obj.messages)
      );
    } catch {
      return false;
    }
  }

  parse(contents: string, filename: string): Trajectory[] {
    let session: AmazonQSession;
    try {
      session = JSON.parse(contents);
    } catch {
      return [];
    }

    if (!session.messages || session.messages.length === 0) return [];

    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    const baseTime = session.created ? new Date(session.created).getTime() : Date.now();
    const toolCallMap = new Map<string, number>();

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      if (!msg || typeof msg !== "object") continue;
      const timestamp = safeTimestamp(msg.timestamp, new Date(baseTime + i * 2000).toISOString());

      if (msg.toolUse && typeof msg.toolUse === "object") {
        // Tool call
        const eid = eventId++;
        events.push({
          id: eid,
          timestamp,
          type: "tool_call",
          role: "assistant",
          toolCall: {
            name: msg.toolUse.name ?? "unknown",
            arguments: msg.toolUse.input,
          },
        });
        if (msg.toolUse.toolUseId) toolCallMap.set(msg.toolUse.toolUseId, eid);
      } else if (msg.toolResult) {
        // Tool result
        const toolCallEventId = msg.toolResult.toolUseId
          ? toolCallMap.get(msg.toolResult.toolUseId)
          : undefined;
        events.push({
          id: eventId++,
          timestamp,
          type: "tool_result",
          role: "environment",
          toolResult: {
            output: (msg.toolResult.content ?? "").slice(0, 10000),
            isError: msg.toolResult.status === "error",
            toolCallEventId,
          },
        });
      } else if (msg.role === "system") {
        events.push({
          id: eventId++,
          timestamp,
          type: "system",
          role: "system",
          content: msg.content ?? "",
        });
      } else {
        events.push({
          id: eventId++,
          timestamp,
          type: "message",
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content ?? "",
          model: msg.role === "assistant" ? session.model : undefined,
        });
      }
    }

    if (events.length === 0) return [];

    const sessionId = session.conversationId ?? filename.replace(/\.json$/, "").split("/").pop() ?? "amazonq";

    const trajectory: Trajectory = {
      version: "1.0",
      source: "amazon-q",
      session: {
        id: sessionId,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        model: session.model,
        metadata: { tool: "amazon-q" },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}
