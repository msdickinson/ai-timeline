import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ClaudeCodeParser } from "../../src/parsers/claude-code";

const parser = new ClaudeCodeParser();
const fixture = readFileSync(
  join(__dirname, "../fixtures/claude-code-session.jsonl"),
  "utf-8"
);

describe("ClaudeCodeParser", () => {
  describe("canParse", () => {
    it("should detect Claude Code JSONL by sessionId field", () => {
      const firstLine = fixture.split("\n")[0];
      // First line is file-history-snapshot, which is a Claude Code format
      expect(parser.canParse("session.jsonl", firstLine)).toBe(true);
    });

    it("should detect Claude Code JSONL by type=user field", () => {
      const userLine = fixture.split("\n")[1];
      expect(parser.canParse("session.jsonl", userLine)).toBe(true);
    });

    it("should reject non-JSONL files", () => {
      expect(parser.canParse("data.json", '{"history": []}')).toBe(false);
    });

    it("should reject JSONL without Claude Code markers", () => {
      expect(
        parser.canParse("other.jsonl", '{"role": "user", "content": "hi"}')
      ).toBe(false);
    });

    it("should handle malformed first line gracefully", () => {
      expect(parser.canParse("bad.jsonl", "not json")).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return exactly one trajectory", () => {
      const result = parser.parse(fixture, "138944b0.jsonl");
      expect(result).toHaveLength(1);
    });

    it("should extract session metadata", () => {
      const [traj] = parser.parse(fixture, "138944b0.jsonl");
      expect(traj.source).toBe("claude-code");
      expect(traj.version).toBe("1.0");
      expect(traj.session.id).toBe("138944b0-9720-41ec-9935-6810156d4135");
      expect(traj.session.model).toBe("claude-opus-4-6");
      expect(traj.session.cwd).toBe("/home/user/project");
      expect(traj.session.gitBranch).toBe("main");
    });

    it("should extract session start and end times", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      expect(traj.session.startTime).toBe("2026-03-24T22:31:14.901Z");
      expect(traj.session.endTime).toBe("2026-03-24T22:31:36.000Z");
    });

    it("should parse user messages", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      const userMsgs = traj.events.filter(
        (e) => e.type === "message" && e.role === "user"
      );
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(userMsgs[0].content).toBe("Fix the bug in auth.ts");
    });

    it("should parse thinking blocks", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      const thinking = traj.events.filter((e) => e.type === "thinking");
      expect(thinking.length).toBeGreaterThanOrEqual(1);
      expect(thinking[0].content).toContain("read the auth.ts file");
    });

    it("should parse tool calls with names and arguments", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      expect(toolCalls.length).toBe(3); // Read, Edit, Bash

      const readCall = toolCalls.find((e) => e.toolCall?.name === "Read");
      expect(readCall).toBeDefined();
      expect((readCall!.toolCall!.arguments as any).file_path).toBe(
        "/home/user/project/src/auth.ts"
      );

      const editCall = toolCalls.find((e) => e.toolCall?.name === "Edit");
      expect(editCall).toBeDefined();

      const bashCall = toolCalls.find((e) => e.toolCall?.name === "Bash");
      expect(bashCall).toBeDefined();
      expect((bashCall!.toolCall!.arguments as any).command).toContain(
        "npm test"
      );
    });

    it("should parse tool results and link to calls", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      const toolResults = traj.events.filter((e) => e.type === "tool_result");
      expect(toolResults.length).toBe(3);

      // Each result should link back to its call
      for (const result of toolResults) {
        expect(result.toolResult?.toolCallEventId).toBeDefined();
        const linkedCall = traj.events.find(
          (e) => e.id === result.toolResult!.toolCallEventId
        );
        expect(linkedCall).toBeDefined();
        expect(linkedCall!.type).toBe("tool_call");
      }
    });

    it("should extract token usage", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      const withTokens = traj.events.filter((e) => e.tokens);
      expect(withTokens.length).toBeGreaterThan(0);

      // Check a specific event has expected token counts
      const firstAssistant = withTokens[0];
      expect(firstAssistant.tokens!.input).toBe(500);
      expect(firstAssistant.tokens!.output).toBe(20);
      expect(firstAssistant.tokens!.cacheRead).toBe(1000);
    });

    it("should extract model info", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      const assistantEvents = traj.events.filter(
        (e) => e.role === "assistant" && e.model
      );
      expect(assistantEvents.length).toBeGreaterThan(0);
      expect(assistantEvents[0].model).toBe("claude-opus-4-6");
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "test.jsonl");
      expect(traj.summary).toBeDefined();
      expect(traj.summary!.totalToolCalls).toBe(3);
      expect(traj.summary!.uniqueTools).toContain("Read");
      expect(traj.summary!.uniqueTools).toContain("Edit");
      expect(traj.summary!.uniqueTools).toContain("Bash");
      expect(traj.summary!.toolCallCounts["Read"]).toBe(1);
      expect(traj.summary!.toolCallCounts["Edit"]).toBe(1);
      expect(traj.summary!.toolCallCounts["Bash"]).toBe(1);
      expect(traj.summary!.errorCount).toBe(0);
      expect(traj.summary!.totalTokens.input).toBeGreaterThan(0);
      expect(traj.summary!.totalTokens.output).toBeGreaterThan(0);
      expect(traj.summary!.durationMs).toBeGreaterThan(0);
    });

    it("should handle empty file gracefully", () => {
      const result = parser.parse("", "empty.jsonl");
      expect(result).toHaveLength(0);
    });

    it("should handle file with only snapshots/queue-ops", () => {
      const content = [
        '{"type":"file-history-snapshot","snapshot":{},"timestamp":"2026-01-01T00:00:00Z"}',
        '{"type":"queue-operation","timestamp":"2026-01-01T00:00:01Z"}',
      ].join("\n");
      const result = parser.parse(content, "meta-only.jsonl");
      expect(result).toHaveLength(0);
    });

    it("should handle malformed lines mixed with valid ones", () => {
      const content =
        fixture.split("\n")[1] +
        "\nINVALID JSON LINE\n" +
        fixture.split("\n")[2];
      const result = parser.parse(content, "mixed.jsonl");
      // Should still parse valid lines
      expect(result).toHaveLength(1);
    });

    it("should extract session ID from filename as fallback", () => {
      // Create content without sessionId
      const content = [
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":10,"output_tokens":5}},"timestamp":"2026-01-01T00:00:00Z"}',
      ].join("\n");
      const result = parser.parse(
        content,
        "abc12345-1234-5678-9abc-def012345678.jsonl"
      );
      if (result.length > 0) {
        expect(result[0].session.id).toBe(
          "abc12345-1234-5678-9abc-def012345678"
        );
      }
    });
  });
});
