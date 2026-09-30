import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { AiderParser } from "../../src/parsers/aider";

const parser = new AiderParser();
const fixture = readFileSync(join(__dirname, "../fixtures/aider-chat-history.md"), "utf-8");

describe("AiderParser", () => {
  describe("canParse", () => {
    it("should detect aider history files by name", () => {
      expect(parser.canParse(".aider.chat.history.md")).toBe(true);
    });

    it("should detect files with aider in name", () => {
      expect(parser.canParse("aider-session.md")).toBe(true);
    });

    it("should detect .md files starting with ####", () => {
      expect(parser.canParse("history.md", "#### Fix the bug")).toBe(true);
    });

    it("should reject non-md files", () => {
      expect(parser.canParse("aider.json", "{}")).toBe(false);
    });

    it("should reject .md files without #### or aider markers", () => {
      expect(parser.canParse("readme.md", "# My Project")).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return exactly one trajectory", () => {
      const result = parser.parse(fixture, ".aider.chat.history.md");
      expect(result).toHaveLength(1);
    });

    it("should extract session metadata", () => {
      const [traj] = parser.parse(fixture, ".aider.chat.history.md");
      expect(traj.version).toBe("1.0");
      expect(traj.session.id).toBeTruthy();
      expect(traj.session.metadata?.tool).toBe("aider");
    });

    it("should parse user messages from #### headings", () => {
      const [traj] = parser.parse(fixture, ".aider.chat.history.md");
      const userMsgs = traj.events.filter((e) => e.type === "message" && e.role === "user");
      expect(userMsgs.length).toBe(2); // Two #### headings in fixture
      expect(userMsgs[0].content).toContain("input validation");
      expect(userMsgs[1].content).toContain("add tests");
    });

    it("should parse assistant messages", () => {
      const [traj] = parser.parse(fixture, ".aider.chat.history.md");
      const assistantMsgs = traj.events.filter((e) => e.type === "message" && e.role === "assistant");
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse edit blocks as tool calls", () => {
      const [traj] = parser.parse(fixture, ".aider.chat.history.md");
      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      expect(toolCalls.length).toBeGreaterThanOrEqual(2); // Two edit blocks
      for (const tc of toolCalls) {
        expect(tc.toolCall?.name).toBe("edit");
      }
    });

    it("should create tool results for edit blocks", () => {
      const [traj] = parser.parse(fixture, ".aider.chat.history.md");
      const toolResults = traj.events.filter((e) => e.type === "tool_result");
      expect(toolResults.length).toBeGreaterThanOrEqual(2);
      for (const result of toolResults) {
        expect(result.toolResult?.toolCallEventId).toBeDefined();
        const call = traj.events.find((e) => e.id === result.toolResult!.toolCallEventId);
        expect(call).toBeDefined();
        expect(call!.type).toBe("tool_call");
      }
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, ".aider.chat.history.md");
      expect(traj.summary).toBeDefined();
      expect(traj.summary!.totalToolCalls).toBeGreaterThanOrEqual(2);
      expect(traj.summary!.uniqueTools).toContain("edit");
    });

    it("should handle empty file", () => {
      const result = parser.parse("", ".aider.chat.history.md");
      expect(result).toHaveLength(0);
    });

    it("should handle file with only user messages (no assistant)", () => {
      const result = parser.parse("#### Just a question\n", ".aider.chat.history.md");
      expect(result.length).toBe(1);
      const [traj] = result;
      expect(traj.events.filter((e) => e.role === "user").length).toBe(1);
    });

    it("should assign sequential timestamps", () => {
      const [traj] = parser.parse(fixture, ".aider.chat.history.md");
      for (let i = 1; i < traj.events.length; i++) {
        const prev = new Date(traj.events[i - 1].timestamp).getTime();
        const curr = new Date(traj.events[i].timestamp).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });
  });
});
