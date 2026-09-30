import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for Aider CLI tool chat history.
 *
 * Storage location:
 *   .aider.chat.history.md in the working directory
 *
 * Format: Markdown with #### headings for user messages,
 * followed by assistant responses in plain markdown.
 * Edit blocks appear as search/replace fenced blocks.
 *
 * Limitations: No timestamps, no token data, no structured tool calls.
 * We treat search/replace blocks as "edit" tool calls.
 */

export class AiderParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    // Aider history files
    if (
      filename.includes("aider") &&
      (filename.endsWith(".md") || filename.endsWith(".history.md"))
    ) {
      return true;
    }
    // Also detect by content: starts with "# aider" or "####"
    if (filename.endsWith(".md") && firstLine) {
      const trimmed = firstLine.trim();
      return trimmed.startsWith("# aider") || trimmed.startsWith("####");
    }
    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    const lines = contents.split("\n");
    if (lines.length === 0) return [];

    const events: TrajectoryEvent[] = [];
    let eventId = 0;
    const baseTime = Date.now();
    let turnIndex = 0;

    let currentRole: "user" | "assistant" | null = null;
    let currentContent: string[] = [];
    let inEditBlock = false;
    let editBlockContent: string[] = [];
    let editBlockFile = "";

    function flushCurrent() {
      if (currentRole && currentContent.length > 0) {
        const text = currentContent.join("\n").trim();
        if (text) {
          events.push({
            id: eventId++,
            timestamp: safeTimestamp(baseTime + turnIndex * 3000),
            type: "message",
            role: currentRole,
            content: text,
            turnIndex,
          });
          turnIndex++;
        }
      }
      currentContent = [];
    }

    function flushEditBlock() {
      if (editBlockContent.length > 0) {
        const content = editBlockContent.join("\n");
        const eid = eventId++;
        events.push({
          id: eid,
          timestamp: safeTimestamp(baseTime + turnIndex * 3000),
          type: "tool_call",
          role: "assistant",
          toolCall: {
            name: "edit",
            arguments: {
              file: editBlockFile,
              content,
            },
          },
          turnIndex,
        });
        events.push({
          id: eventId++,
          timestamp: safeTimestamp(baseTime + turnIndex * 3000 + 500),
          type: "tool_result",
          role: "environment",
          toolResult: {
            output: "Edit applied",
            isError: false,
            toolCallEventId: eid,
          },
        });
        turnIndex++;
      }
      editBlockContent = [];
      editBlockFile = "";
      inEditBlock = false;
    }

    for (const line of lines) {
      // User message starts with ####
      if (line.startsWith("#### ")) {
        flushEditBlock();
        flushCurrent();
        currentRole = "user";
        currentContent = [line.slice(5)]; // Remove "#### " prefix
        continue;
      }

      // Search/replace edit blocks
      const editFileMatch = line.match(
        /^```(\w+)?\s*$/
      );
      if (editFileMatch && !inEditBlock) {
        // Could be start of an edit block
        // Aider uses fenced blocks with filename before them
        inEditBlock = true;
        editBlockContent = [];
        continue;
      }
      if (line === "```" && inEditBlock) {
        flushEditBlock();
        continue;
      }
      if (inEditBlock) {
        editBlockContent.push(line);
        // Check if previous line had a filename
        if (editBlockContent.length === 1 && line.match(/^[\w/.]+\.\w+$/)) {
          editBlockFile = line;
        }
        continue;
      }

      // If we're in user content and hit an empty line followed by non-#### content,
      // switch to assistant
      if (currentRole === "user" && line === "" && currentContent.length > 0) {
        flushCurrent();
        currentRole = "assistant";
        continue;
      }

      // If no role yet and not a heading, it's assistant
      if (currentRole === null && line.trim()) {
        currentRole = "assistant";
      }

      if (currentRole) {
        currentContent.push(line);
      }
    }

    // Flush remaining
    flushEditBlock();
    flushCurrent();

    if (events.length === 0) return [];

    const trajectory: Trajectory = {
      version: "1.0",
      source: "aider",
      session: {
        id: filename.replace(/\.md$/, "").replace(/\./g, "-"),
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        metadata: { tool: "aider" },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}
