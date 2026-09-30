import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { AmazonQParser } from "../../src/parsers/amazon-q";

const parser = new AmazonQParser();
const fixture = readFileSync(join(__dirname, "../fixtures/amazonq-history.json"), "utf-8");

describe("AmazonQParser", () => {
  describe("canParse", () => {
    it("should detect files with amazonq in name", () => {
      expect(parser.canParse("amazonq-history.json", "{")).toBe(true);
    });

    it("should detect compact JSON with conversationId + messages", () => {
      const compact = JSON.stringify(JSON.parse(fixture));
      expect(parser.canParse("history.json", compact)).toBe(true);
    });

    it("should reject non-JSON", () => {
      expect(parser.canParse("amazonq.txt", "hi")).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return one trajectory", () => {
      const result = parser.parse(fixture, "amazonq.json");
      expect(result).toHaveLength(1);
    });

    it("should extract session metadata", () => {
      const [traj] = parser.parse(fixture, "amazonq.json");
      expect(traj.session.id).toBe("amazonq-conv-12345");
      expect(traj.session.model).toBe("anthropic.claude-sonnet");
      expect(traj.session.metadata?.tool).toBe("amazon-q");
    });

    it("should parse user messages", () => {
      const [traj] = parser.parse(fixture, "amazonq.json");
      const user = traj.events.filter((e) => e.type === "message" && e.role === "user");
      expect(user.length).toBe(2);
      expect(user[0].content).toContain("current directory");
    });

    it("should parse assistant messages with model", () => {
      const [traj] = parser.parse(fixture, "amazonq.json");
      const assistant = traj.events.filter((e) => e.type === "message" && e.role === "assistant");
      expect(assistant.length).toBeGreaterThanOrEqual(2);
    });

    it("should parse tool calls from toolUse", () => {
      const [traj] = parser.parse(fixture, "amazonq.json");
      const calls = traj.events.filter((e) => e.type === "tool_call");
      expect(calls.length).toBe(2); // bash, readFile
      expect(calls[0].toolCall?.name).toBe("bash");
      expect(calls[1].toolCall?.name).toBe("readFile");
    });

    it("should parse tool results and link to calls", () => {
      const [traj] = parser.parse(fixture, "amazonq.json");
      const results = traj.events.filter((e) => e.type === "tool_result");
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.toolResult?.toolCallEventId).toBeDefined();
        const call = traj.events.find((e) => e.id === r.toolResult!.toolCallEventId);
        expect(call?.type).toBe("tool_call");
      }
    });

    it("should extract timestamps from messages", () => {
      const [traj] = parser.parse(fixture, "amazonq.json");
      const d = new Date(traj.events[0].timestamp);
      expect(d.getFullYear()).toBe(2026);
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "amazonq.json");
      expect(traj.summary!.totalToolCalls).toBe(2);
      expect(traj.summary!.uniqueTools).toContain("bash");
      expect(traj.summary!.uniqueTools).toContain("readFile");
    });

    it("should handle empty messages", () => {
      expect(parser.parse('{"conversationId":"x","messages":[]}', "amazonq.json")).toHaveLength(0);
    });

    it("should handle malformed JSON", () => {
      expect(parser.parse("bad", "amazonq.json")).toHaveLength(0);
    });
  });
});
