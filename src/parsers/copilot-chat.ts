import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for GitHub Copilot Chat sessions.
 *
 * Storage location:
 *   Windows: %APPDATA%/Code/User/workspaceStorage/<hash>/chatSessions/<session>.json
 *   macOS:   ~/Library/Application Support/Code/User/workspaceStorage/<hash>/chatSessions/<session>.json
 *
 * Format: JSON with requester/responder messages in a flat array.
 * Also exported via VS Code command palette "Chat: Export Session..."
 */

interface CopilotSession {
  requester?: CopilotMessage[];
  responder?: CopilotMessage[];
  // Export format: flat messages array
  messages?: CopilotMessage[];
  // VS Code Chat Export format (newer)
  requests?: CopilotRequest[];
  requesterUsername?: string;
  responderUsername?: string;
  providerResponsesByItemId?: Record<string, CopilotProviderResponse>;
}

interface CopilotRequest {
  requestId?: string;
  message?: { text?: string; parts?: unknown[] };
  response?: Array<{ kind?: string; content?: { value?: string } }>;
  result?: {
    timings?: { totalElapsed?: number };
    metadata?: { renderedUserMessage?: unknown };
    value?: string;
    errorDetails?: { message?: string };
  };
  timestamp?: number;
  modelId?: string;
  agent?: string;
  isCanceled?: boolean;
}

interface CopilotMessage {
  message?: string;
  text?: string;
  content?: string;
  role?: string;
  timestamp?: number;
  result?: {
    value?: string;
    errorDetails?: { message?: string };
  };
  // Copilot-specific
  agent?: string;
  command?: string;
  references?: Array<{ id?: string; uri?: string }>;
}

interface CopilotProviderResponse {
  response?: { value?: string };
  errorDetails?: { message?: string };
  timings?: { totalElapsed?: number };
  usedContext?: { documents?: Array<{ uri?: string }> };
}

export class CopilotChatParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    if (!filename.endsWith(".json")) return false;
    // Filename hints
    if (filename.includes("chatSession") || filename.includes("copilot")) return true;
    if (!firstLine) return false;
    try {
      const trimmed = firstLine.trim();
      if (!trimmed.startsWith("{")) return false;
      const obj = JSON.parse(trimmed);
      // Copilot sessions: requester/responder, requests[], or providerResponsesByItemId
      return (
        (obj.requester != null && obj.responder != null) ||
        (obj.requests != null && Array.isArray(obj.requests)) ||
        obj.providerResponsesByItemId != null ||
        (Array.isArray(obj.messages) && obj.messages.some((m: any) => m.agent != null || m.command != null))
      );
    } catch {
      return false;
    }
  }

  parse(contents: string, filename: string): Trajectory[] {
    let session: CopilotSession;
    try {
      session = JSON.parse(contents);
    } catch {
      return [];
    }

    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    const baseTime = Date.now();

    // Handle VS Code Chat Export format (requests[] array)
    if (session.requests && Array.isArray(session.requests)) {
      for (const req of session.requests) {
        if (!req || typeof req !== "object" || req.isCanceled) continue;
        const timestamp = safeTimestamp(req.timestamp, new Date(baseTime + eventId * 2000).toISOString());

        // User message
        const userText = req.message?.text ?? "";
        if (userText) {
          events.push({
            id: eventId++,
            timestamp,
            type: "message",
            role: "user",
            content: userText,
          });
        }

        // Assistant response — extract from result or response array
        let responseText = "";
        if (req.result?.value) {
          responseText = req.result.value;
        } else if (req.response) {
          // Concatenate progress content
          responseText = req.response
            .filter((r) => r != null && r.content?.value)
            .map((r) => r.content!.value!)
            .join("\n");
        }

        if (responseText) {
          const isError = !!req.result?.errorDetails;
          events.push({
            id: eventId++,
            timestamp: safeTimestamp(new Date(timestamp).getTime() + (req.result?.timings?.totalElapsed ?? 2000)),
            type: isError ? "error" : "message",
            role: "assistant",
            content: isError ? req.result?.errorDetails?.message ?? "Error" : responseText,
            model: req.modelId,
            durationMs: req.result?.timings?.totalElapsed,
          });
        }
      }
    }

    // Handle flat messages format (exported or newer format)
    if (session.messages && Array.isArray(session.messages)) {
      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        const timestamp = safeTimestamp(msg.timestamp, new Date(baseTime + i * 2000).toISOString());
        const text = msg.message ?? msg.text ?? msg.content ?? msg.result?.value ?? "";
        const role = msg.role === "user" ? "user" : "assistant";

        if (text) {
          events.push({
            id: eventId++,
            timestamp,
            type: "message",
            role,
            content: text,
          });
        }
      }
    }

    // Handle requester/responder format
    if (session.requester && session.responder) {
      const maxLen = Math.max(session.requester.length, session.responder.length);
      for (let i = 0; i < maxLen; i++) {
        const req = session.requester[i];
        const resp = session.responder[i];
        const timestamp = safeTimestamp(baseTime + i * 4000);

        if (req) {
          const text = req.message ?? req.text ?? "";
          if (text) {
            events.push({
              id: eventId++,
              timestamp,
              type: "message",
              role: "user",
              content: text,
            });
          }
        }

        if (resp) {
          const responseText = resp.result?.value ?? resp.message ?? resp.text ?? "";
          const isError = !!resp.result?.errorDetails;
          if (responseText || isError) {
            events.push({
              id: eventId++,
              timestamp: safeTimestamp(new Date(timestamp).getTime() + 2000),
              type: isError ? "error" : "message",
              role: "assistant",
              content: isError ? resp.result?.errorDetails?.message ?? "Error" : responseText,
            });
          }
        }
      }
    }

    // Extract timing info from providerResponses
    if (session.providerResponsesByItemId) {
      for (const [_id, resp] of Object.entries(session.providerResponsesByItemId)) {
        if (resp.timings?.totalElapsed) {
          // Find matching assistant event and add duration
          const lastAssistant = [...events].reverse().find((e) => e.role === "assistant");
          if (lastAssistant) {
            lastAssistant.durationMs = resp.timings.totalElapsed;
          }
        }
      }
    }

    if (events.length === 0) return [];

    const sessionId = filename.replace(/\.json$/, "").split("/").pop() ?? "copilot";

    const trajectory: Trajectory = {
      version: "1.0",
      source: "copilot-chat",
      session: {
        id: sessionId,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        metadata: { tool: "copilot-chat" },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}
