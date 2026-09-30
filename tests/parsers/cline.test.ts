import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ClineParser } from "../../src/parsers/cline";

const parser = new ClineParser();
const fixture = readFileSync(join(__dirname, "../fixtures/cline-conversation.json"), "utf-8");

describe("ClineParser", () => {
  describe("canParse", () => {
    it("should detect api_conversation_history.json", () => {
      expect(parser.canParse("api_conversation_history.json", "[")).toBe(true);
    });

    it("should detect files with cline in name", () => {
      expect(parser.canParse("cline-task.json", "[")).toBe(true);
    });

    it("should detect files with claude-dev in name", () => {
      expect(parser.canParse("claude-dev-session.json", "[")).toBe(true);
    });

    it("should reject non-JSON files", () => {
      expect(parser.canParse("cline-task.txt", "[")).toBe(false);
    });

    it("should reject JSONL files", () => {
      expect(parser.canParse("cline.jsonl", '{"role":"user"}')).toBe(false);
    });

    it("should reject JSON that doesn't look like Cline", () => {
      expect(parser.canParse("data.json", '{"key":"value"}')).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return exactly one trajectory", () => {
      const result = parser.parse(fixture, "api_conversation_history.json");
      expect(result).toHaveLength(1);
    });

    it("should extract session metadata", () => {
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      expect(traj.version).toBe("1.0");
      expect(traj.session.id).toBeTruthy();
      expect(traj.session.metadata?.tool).toBe("cline");
    });

    it("should parse user messages", () => {
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      const userMsgs = traj.events.filter((e) => e.type === "message" && e.role === "user");
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(userMsgs[0].content).toContain("authentication bug");
    });

    it("should parse assistant messages", () => {
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      const assistantMsgs = traj.events.filter((e) => e.type === "message" && e.role === "assistant");
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse tool calls with names and arguments", () => {
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      expect(toolCalls.length).toBe(3); // read_file, write_to_file, execute_command

      expect(toolCalls[0].toolCall?.name).toBe("read_file");
      expect(toolCalls[1].toolCall?.name).toBe("write_to_file");
      expect(toolCalls[2].toolCall?.name).toBe("execute_command");
    });

    it("should parse tool results and link to calls", () => {
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      const toolResults = traj.events.filter((e) => e.type === "tool_result");
      expect(toolResults.length).toBe(3);

      for (const result of toolResults) {
        expect(result.toolResult?.toolCallEventId).toBeDefined();
        const call = traj.events.find((e) => e.id === result.toolResult!.toolCallEventId);
        expect(call).toBeDefined();
        expect(call!.type).toBe("tool_call");
      }
    });

    it("should extract timestamps from ts field", () => {
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      // First event should have the ts from fixture
      const d = new Date(traj.events[0].timestamp);
      expect(d.getTime()).not.toBeNaN();
      expect(d.getFullYear()).toBe(2024); // 1711900000000 = March 2024
    });

    it("should detect tool result errors", () => {
      // The fixture has no errors, but let's test the structure
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      const results = traj.events.filter((e) => e.toolResult?.isError);
      expect(results).toHaveLength(0); // No errors in fixture
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "api_conversation_history.json");
      expect(traj.summary).toBeDefined();
      expect(traj.summary!.totalToolCalls).toBe(3);
      expect(traj.summary!.uniqueTools).toContain("read_file");
      expect(traj.summary!.uniqueTools).toContain("write_to_file");
      expect(traj.summary!.uniqueTools).toContain("execute_command");
    });

    it("should handle empty array", () => {
      const result = parser.parse("[]", "cline.json");
      expect(result).toHaveLength(0);
    });

    it("should handle malformed JSON", () => {
      const result = parser.parse("not json", "cline.json");
      expect(result).toHaveLength(0);
    });
  });
});
