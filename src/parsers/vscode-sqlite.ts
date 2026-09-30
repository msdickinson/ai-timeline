import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for VS Code-based AI tools that store in SQLite (state.vscdb).
 * Supports: Cursor, Windsurf/Codeium, Trae (ByteDance), and any VS Code fork.
 *
 * Storage locations:
 *   Cursor:   %APPDATA%/Cursor/User/globalStorage/state.vscdb
 *   Windsurf: %APPDATA%/Windsurf/User/globalStorage/state.vscdb
 *   Trae:     %APPDATA%/Trae/User/globalStorage/state.vscdb
 *
 * All use VS Code's ItemTable with JSON values.
 * Key patterns vary by tool — we try all known patterns.
 *
 * Requires sql.js (SQLite compiled to WASM) to read binary .vscdb files.
 */

// Lazy-loaded sql.js
let SQL: any = null;

async function getSQL(): Promise<any> {
  if (SQL) return SQL;
  try {
    const initSqlJs = (await import("sql.js")).default;
    SQL = await initSqlJs({
      locateFile: (file: string) => {
        // In Node.js (tests): use local file from node_modules
        if (typeof process !== "undefined" && process.versions?.node) {
          return `node_modules/sql.js/dist/${file}`;
        }
        // In browser: use CDN
        return `https://sql.js.org/dist/${file}`;
      },
    });
    return SQL;
  } catch {
    return null;
  }
}

/** Known key patterns for different tools */
const KEY_PATTERNS = {
  cursor: [
    "composer.composerData",                          // Cursor composer sessions
    "workbench.panel.aichat.view.aichat.chatdata",   // Cursor legacy chat
    "aiService.prompts",                              // Cursor prompts
  ],
  windsurf: [
    "cascade.conversationData",                       // Windsurf Cascade
  ],
  generic: [
    "interactive.sessions",                           // VS Code Copilot interactive
    "memento/interactive-session",                     // VS Code Copilot memento
  ],
};

export class VSCodeSqliteParser implements TrajectoryParser {
  canParse(filename: string, _firstLine?: string): boolean {
    return (
      filename.endsWith(".vscdb") ||
      filename.endsWith(".sqlite") ||
      filename.endsWith(".db")
    ) && (
      filename.includes("state") ||
      filename.includes("cursor") ||
      filename.includes("windsurf") ||
      filename.includes("trae") ||
      filename.includes("globalStorage")
    );
  }

  parse(contents: string, filename: string): Trajectory[] {
    // This parser needs binary data, not text.
    // The standard parse() receives text content which won't work for SQLite.
    // Instead, use parseBinary() which is called from the app when it detects binary files.
    // For the text-based parse(), return empty and let parseBinary handle it.
    return [];
  }

  /**
   * Parse a binary SQLite file. Called by the app when it detects a .vscdb file.
   * Returns a Promise because sql.js init is async.
   */
  async parseBinary(data: ArrayBuffer, filename: string): Promise<Trajectory[]> {
    const SqlJs = await getSQL();
    if (!SqlJs) return [];

    let db: any;
    try {
      db = new SqlJs.Database(new Uint8Array(data));
    } catch {
      return [];
    }

    const trajectories: Trajectory[] = [];
    const tool = detectTool(filename);

    try {
      // Get all keys from ItemTable
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      const tableNames = tables[0]?.values?.map((r: any[]) => r[0]) ?? [];

      const itemTable = tableNames.find((t: string) =>
        t === "ItemTable" || t === "cursorDiskKV" || t === "main.ItemTable"
      );

      if (!itemTable) {
        db.close();
        return [];
      }

      // Try all known key patterns
      const allPatterns = [
        ...KEY_PATTERNS[tool as keyof typeof KEY_PATTERNS] ?? [],
        ...KEY_PATTERNS.generic,
      ];

      for (const pattern of allPatterns) {
        try {
          const result = db.exec(`SELECT key, value FROM "${itemTable}" WHERE key LIKE ?`, [`%${pattern}%`]);
          if (result.length > 0 && result[0].values) {
            for (const [key, value] of result[0].values) {
              const parsed = tryParseConversations(value as string, tool, key as string);
              trajectories.push(...parsed);
            }
          }
        } catch {
          // Key pattern didn't match — try next
        }
      }

      // Also try extracting individual composer/bubble data (Cursor-specific)
      if (tool === "cursor") {
        try {
          const result = db.exec(
            `SELECT key, value FROM "${itemTable}" WHERE key LIKE 'composerData:%' OR key LIKE 'bubbleId:%' LIMIT 200`
          );
          if (result.length > 0 && result[0].values) {
            const composerMap = new Map<string, any[]>();
            for (const [key, value] of result[0].values) {
              const keyStr = key as string;
              if (keyStr.startsWith("composerData:")) {
                const composerId = keyStr.replace("composerData:", "");
                if (!composerMap.has(composerId)) composerMap.set(composerId, []);
              } else if (keyStr.startsWith("bubbleId:")) {
                const parts = keyStr.split(":");
                const composerId = parts[1];
                if (!composerMap.has(composerId)) composerMap.set(composerId, []);
                try {
                  composerMap.get(composerId)!.push(JSON.parse(value as string));
                } catch {}
              }
            }

            for (const [composerId, bubbles] of composerMap) {
              if (bubbles.length > 0) {
                const traj = buildTrajectoryFromBubbles(composerId, bubbles, tool);
                if (traj) trajectories.push(traj);
              }
            }
          }
        } catch {}
      }
    } catch {
      // Database error — return what we have
    }

    db.close();
    return trajectories;
  }
}

function detectTool(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("windsurf") || lower.includes("codeium")) return "windsurf";
  if (lower.includes("trae")) return "trae";
  return "vscode";
}

function tryParseConversations(value: string, tool: string, key: string): Trajectory[] {
  if (!value) return [];

  let data: any;
  try {
    data = JSON.parse(value);
  } catch {
    return [];
  }

  // Handle array of conversations
  if (Array.isArray(data)) {
    return data
      .map((conv: any, i: number) => buildTrajectoryFromConversation(conv, tool, `${key}-${i}`))
      .filter((t): t is Trajectory => t != null);
  }

  // Handle single conversation object
  const traj = buildTrajectoryFromConversation(data, tool, key);
  return traj ? [traj] : [];
}

function buildTrajectoryFromConversation(conv: any, tool: string, fallbackId: string): Trajectory | null {
  if (!conv) return null;

  const events: TrajectoryEvent[] = [];
  let eventId = 0;

  // Try various message array field names
  const messages = conv.messages ?? conv.turns ?? conv.history ?? conv.chatMessages ?? conv.items ?? [];
  if (!Array.isArray(messages) || messages.length === 0) return null;

  for (const msg of messages) {
    const role = msg.role ?? (msg.type === "user" ? "user" : msg.type === "assistant" ? "assistant" : "user");
    const content = msg.content ?? msg.text ?? msg.message ?? msg.value ?? "";
    const timestamp = safeTimestamp(msg.timestamp, new Date(Date.now() + eventId * 1000).toISOString());

    if (typeof content === "string" && content) {
      events.push({
        id: eventId++,
        timestamp,
        type: "message",
        role: role === "user" ? "user" : role === "system" ? "system" : "assistant",
        content,
        model: msg.model ?? conv.model,
      });
    }

    // Handle tool calls if present
    if (msg.toolCalls || msg.tool_calls || msg.functionCall) {
      const calls = msg.toolCalls ?? msg.tool_calls ?? [msg.functionCall];
      for (const tc of Array.isArray(calls) ? calls : [calls]) {
        if (!tc) continue;
        events.push({
          id: eventId++,
          timestamp,
          type: "tool_call",
          role: "assistant",
          toolCall: {
            name: tc.name ?? tc.function?.name ?? "unknown",
            arguments: tc.arguments ?? tc.input ?? tc.function?.arguments,
          },
        });
      }
    }
  }

  if (events.length === 0) return null;

  const sessionId = conv.id ?? conv.sessionId ?? conv.composerId ?? fallbackId;

  const sourceMap: Record<string, Trajectory["source"]> = { cursor: "cursor", windsurf: "windsurf", trae: "trae" };
  const trajectory: Trajectory = {
    version: "1.0",
    source: sourceMap[tool] ?? "unknown",
    session: {
      id: sessionId,
      startTime: events[0].timestamp,
      endTime: events[events.length - 1]?.timestamp,
      model: conv.model ?? conv.modelId,
      metadata: { tool: tool === "vscode" ? "vscode-ai" : tool },
    },
    events,
  };

  trajectory.summary = computeSummary(events);
  return trajectory;
}

function buildTrajectoryFromBubbles(composerId: string, bubbles: any[], tool: string): Trajectory | null {
  const events: TrajectoryEvent[] = [];
  let eventId = 0;

  // Sort bubbles by timestamp if available
  bubbles.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  for (const bubble of bubbles) {
    const role = bubble.type === "user" || bubble.role === "user" ? "user" : "assistant";
    const content = bubble.text ?? bubble.content ?? bubble.message ?? "";
    const timestamp = safeTimestamp(bubble.timestamp, new Date(Date.now() + eventId * 1000).toISOString());

    if (content) {
      events.push({
        id: eventId++,
        timestamp,
        type: "message",
        role,
        content,
        model: bubble.model,
      });
    }
  }

  if (events.length === 0) return null;

  const sourceMap2: Record<string, Trajectory["source"]> = { cursor: "cursor", windsurf: "windsurf", trae: "trae" };
  const trajectory: Trajectory = {
    version: "1.0",
    source: sourceMap2[tool] ?? "unknown",
    session: {
      id: composerId,
      startTime: events[0].timestamp,
      endTime: events[events.length - 1]?.timestamp,
      metadata: { tool },
    },
    events,
  };

  trajectory.summary = computeSummary(events);
  return trajectory;
}
