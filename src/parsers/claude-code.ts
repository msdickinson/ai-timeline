import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  fillEventDurations,
} from "../common/types";

/**
 * Parser for Claude Code session files.
 * Location: ~/.claude/projects/<project-slug>/<session-id>.jsonl
 * Each line is a JSON object with type, message, timestamp, etc.
 */

interface ClaudeCodeLine {
  type: string;
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | ClaudeContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    stop_reason?: string;
  };
  // file-history-snapshot, queue-operation, etc.
  [key: string]: unknown;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string; // tool_use blocks use "id"
  input?: Record<string, unknown> | string;
  content?: string | ClaudeContentBlock[];
  tool_use_id?: string; // tool_result blocks use "tool_use_id"
  is_error?: boolean;
}

export class ClaudeCodeParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    if (filename.endsWith(".jsonl") && firstLine) {
      try {
        const obj = JSON.parse(firstLine);
        // Claude Code files have sessionId, or specific type+uuid combo
        // Be specific to avoid matching OpenHands/SWE-Agent JSONL
        return (
          obj.sessionId != null ||
          obj.type === "file-history-snapshot" ||
          obj.type === "queue-operation" ||
          ((obj.type === "user" || obj.type === "assistant") && obj.uuid != null)
        );
      } catch {
        return false;
      }
    }
    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    const lines = contents.split("\n").filter((l) => l.trim());
    const parsed: ClaudeCodeLine[] = [];

    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }

    if (parsed.length === 0) return [];

    // Detect subagent: path-based (new format) or data-based (isSidechain)
    let agentId = "";
    let parentSessionId = "";
    let isSidechain = false;

    // Path-based: <parent-id>/subagents/agent-<id>.jsonl (id can contain hyphens)
    const pathMatch = filename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[/\\]subagents[/\\]agent-([a-z0-9-]+)\.jsonl/i);
    if (pathMatch) {
      parentSessionId = pathMatch[1];
      agentId = pathMatch[2];
      isSidechain = true;
    }

    // Data-based: check first few message lines for isSidechain flag
    if (!isSidechain) {
      for (const line of parsed) {
        const rec = line as Record<string, unknown>;
        if (rec.isSidechain === true) {
          isSidechain = true;
          if (rec.agentId) agentId = String(rec.agentId);
          break;
        }
        // Only check message lines, not queue ops
        if (rec.type === "user" || rec.type === "assistant") break;
      }
    }

    // Pre-pass: collect every line uuid in this file, and find the very
    // first message line's parentUuid. If that parentUuid is NOT one of
    // this file's own uuids, it's a cross-session reference — i.e., it
    // points to the Task `tool_use` block in the parent session that
    // spawned this subagent. That's the authoritative parent linkage.
    // (Within-conversation parentUuids point to the previous message in
    // the same file and aren't useful here.)
    const allOwnUuids = new Set<string>();
    for (const line of parsed) {
      if (line.uuid) allOwnUuids.add(line.uuid);
    }
    let candidateSpawnUuid: string | undefined;
    let firstMsgLine: ClaudeCodeLine | undefined;
    for (const line of parsed) {
      // Pick the first line that's a real conversation message (has a
      // role or type) rather than a queue-op / metadata wrapper.
      const rec = line as Record<string, unknown>;
      const isMsg = line.message != null || rec.type === "user" || rec.type === "assistant";
      if (!isMsg) continue;
      firstMsgLine = line;
      if (line.parentUuid && !allOwnUuids.has(line.parentUuid)) {
        candidateSpawnUuid = line.parentUuid;
      }
      break;
    }

    void firstMsgLine;

    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    let sessionId = "";
    let model = "";
    let cwd = "";
    let gitBranch = "";
    let startTime = "";
    const agentLabel = agentId ? `Agent ${agentId}` : "";

    // Track tool_call IDs for linking results
    const lastToolCallId = new Map<string, number>(); // tool_use_id -> event id

    // Track this session's own message uuids — particularly tool_use blocks,
    // since subagents reference their spawning Task tool_use via `parentUuid`
    // on the subagent's first line. We expose these on the trajectory so the
    // UI can do a cross-trajectory match (subagent.spawnToolUseUuid →
    // someParent.toolUseUuids) which is far more reliable than the path-
    // based parent UUID.
    const messageUuids: string[] = [];

    // For the subagent file itself: spawn uuid was captured in the pre-pass
    // above (only set when it's a *cross-file* reference).
    const spawnToolUseUuid: string | undefined = isSidechain ? candidateSpawnUuid : undefined;

    for (const line of parsed) {
      if (!line.timestamp) continue;

      // Extract session metadata from first message-bearing line
      if (!sessionId && line.sessionId) {
        sessionId = line.sessionId;
        cwd = (line.cwd as string) ?? "";
        gitBranch = (line.gitBranch as string) ?? "";
      }
      if (!startTime && line.timestamp) {
        startTime = line.timestamp;
      }

      // Track every message-line's uuid so the comparison view can match
      // subagents → their spawning session by cross-referencing the
      // subagent's `spawnToolUseUuid` against this list.
      if (line.uuid) messageUuids.push(line.uuid);

      // Handle system events (e.g. compaction boundaries)
      if (line.type === "system") {
        const subtype = (line as Record<string, unknown>).subtype as string | undefined;
        const content = (line as Record<string, unknown>).content as string | undefined;
        if (subtype === "compact_boundary" || content === "Conversation compacted") {
          events.push({
            id: eventId++,
            timestamp: line.timestamp!,
            type: "system",
            role: "system",
            content: content ?? "Context compacted",
            contextCompacted: true,
          });
        }
        continue;
      }

      const msg = line.message;
      if (!msg) continue;

      if (msg.model && !model) model = msg.model;

      const content = msg.content;
      if (content == null) continue;

      const tokens = msg.usage
        ? {
            input: msg.usage.input_tokens,
            output: msg.usage.output_tokens,
            cacheRead: msg.usage.cache_read_input_tokens,
            cacheWrite: msg.usage.cache_creation_input_tokens,
          }
        : undefined;

      // Handle string content (simple user/assistant messages)
      if (typeof content === "string") {
        events.push({
          id: eventId++,
          timestamp: line.timestamp,
          type: "message",
          role: (msg.role as TrajectoryEvent["role"]) ?? "user",
          content,
          tokens,
          model: msg.model,
        });
        continue;
      }

      // Handle array content (tool calls, thinking, text blocks)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "thinking" && block.thinking) {
            events.push({
              id: eventId++,
              timestamp: line.timestamp,
              type: "thinking",
              role: "assistant",
              content: block.thinking,
              tokens,
              model: msg.model,
            });
          } else if (block.type === "text" && block.text) {
            events.push({
              id: eventId++,
              timestamp: line.timestamp,
              type: "message",
              role: (msg.role as TrajectoryEvent["role"]) ?? "assistant",
              content: block.text,
              tokens,
              model: msg.model,
            });
          } else if (block.type === "tool_use") {
            const eid = eventId++;
            events.push({
              id: eid,
              timestamp: line.timestamp,
              type: "tool_call",
              role: "assistant",
              toolCall: {
                name: block.name ?? "unknown",
                arguments:
                  typeof block.input === "object"
                    ? (block.input as Record<string, unknown>)
                    : undefined,
              },
              tokens,
              model: msg.model,
            });
            // tool_use blocks use "id", tool_result blocks use "tool_use_id"
            const toolUseId = block.id ?? block.tool_use_id;
            if (toolUseId) {
              lastToolCallId.set(toolUseId, eid);
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
                .filter((c): c is ClaudeContentBlock => c != null && typeof c === "object")
                .map((c) => c.text ?? "")
                .join("\n");
            }

            // Calculate duration from tool_call to tool_result
            // toolCallEventId === array index since IDs are sequential from 0
            let durationMs: number | undefined;
            if (toolCallEventId != null && toolCallEventId < events.length) {
              const ce = events[toolCallEventId];
              if (ce && ce.id === toolCallEventId) {
                const callTime = new Date(ce.timestamp).getTime();
                const resultTime = new Date(line.timestamp).getTime();
                if (!isNaN(callTime) && !isNaN(resultTime)) {
                  durationMs = resultTime - callTime;
                }
              }
            }

            events.push({
              id: eventId++,
              timestamp: line.timestamp,
              type: "tool_result",
              role: "user", // tool results come as "user" role in Claude format
              toolResult: {
                output: output.slice(0, 10000), // Truncate huge outputs
                isError: block.is_error ?? false,
                toolCallEventId,
              },
              durationMs,
            });
          }
        }
      }
    }

    if (events.length === 0) return [];

    // Tag subagent events with agent identifier
    if (agentId) {
      for (const ev of events) {
        ev.agent = agentLabel;
      }
    }

    // Extract session ID from filename if not found in data
    if (!sessionId) {
      const match = filename.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/
      );
      sessionId = match ? match[1] : filename;
    }

    const trajectory: Trajectory = {
      version: "1.0",
      source: "claude-code",
      session: {
        id: sessionId,
        startTime: startTime || events[0]?.timestamp,
        endTime: events[events.length - 1]?.timestamp,
        model,
        cwd,
        gitBranch,
      },
      events,
      toolUseUuids: messageUuids,
    };

    if (parentSessionId) {
      trajectory.parentSessionId = parentSessionId;
    } else if (isSidechain) {
      // Data-detected subagent without path-based parent — mark with special value
      // so the merge step can match by time overlap
      trajectory.parentSessionId = "__sidechain__";
    }
    if (spawnToolUseUuid) {
      trajectory.spawnToolUseUuid = spawnToolUseUuid;
    }

    fillEventDurations(events);
    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}
