import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ContinueDevParser } from "../../src/parsers/continue-dev";

const parser = new ContinueDevParser();
const fixture = readFileSync(join(__dirname, "../fixtures/continue-session.json"), "utf-8");

describe("ContinueDevParser", () => {
  describe("canParse", () => {
    it("should detect Continue session JSON with sessionId + history (compact)", () => {
      const compact = JSON.stringify(JSON.parse(fixture));
      expect(parser.canParse("session.json", compact)).toBe(true);
    });

    it("should detect files with continue in path", () => {
      expect(parser.canParse(".continue/sessions/abc.json", "{")).toBe(true);
    });

    it("should reject non-JSON files", () => {
      expect(parser.canParse("session.txt", '{"sessionId":"x"}')).toBe(false);
    });

    it("should reject JSON without history array", () => {
      expect(parser.canParse("data.json", '{"key":"value"}')).toBe(false);
    });

    it("should not conflict with OpenHands (no instance_id)", () => {
      // Continue has sessionId but not instance_id
      expect(parser.canParse("session.json", '{"sessionId":"x","history":[]}')).toBe(true);
    });
  });

  describe("parse", () => {
    it("should return exactly one trajectory", () => {
      const result = parser.parse(fixture, "session.json");
      expect(result).toHaveLength(1);
    });

    it("should extract session metadata", () => {
      const [traj] = parser.parse(fixture, "session.json");
      expect(traj.version).toBe("1.0");
      expect(traj.session.id).toBe("continue-session-abc123");
      expect(traj.session.cwd).toBe("/home/user/project");
      expect(traj.session.metadata?.tool).toBe("continue-dev");
      expect(traj.session.metadata?.title).toBe("Fix CSS layout issue");
    });

    it("should parse user messages", () => {
      const [traj] = parser.parse(fixture, "session.json");
      const userMsgs = traj.events.filter((e) => e.type === "message" && e.role === "user");
      expect(userMsgs.length).toBe(1);
      expect(userMsgs[0].content).toContain("sidebar is overlapping");
    });

    it("should parse assistant messages", () => {
      const [traj] = parser.parse(fixture, "session.json");
      const assistantMsgs = traj.events.filter((e) => e.type === "message" && e.role === "assistant");
      expect(assistantMsgs.length).toBe(3); // 3 text responses
    });

    it("should parse tool calls", () => {
      const [traj] = parser.parse(fixture, "session.json");
      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      expect(toolCalls.length).toBe(2); // readFile, editFile

      expect(toolCalls[0].toolCall?.name).toBe("readFile");
      expect(toolCalls[1].toolCall?.name).toBe("editFile");
    });

    it("should parse tool call arguments as structured JSON", () => {
      const [traj] = parser.parse(fixture, "session.json");
      const readCall = traj.events.find((e) => e.toolCall?.name === "readFile");
      expect(readCall).toBeDefined();
      const args = readCall!.toolCall!.arguments as Record<string, unknown>;
      expect(args.filepath).toBe("src/styles.css");
    });

    it("should parse tool results and link to calls", () => {
      const [traj] = parser.parse(fixture, "session.json");
      const toolResults = traj.events.filter((e) => e.type === "tool_result");
      expect(toolResults.length).toBe(2);

      for (const result of toolResults) {
        expect(result.toolResult?.toolCallEventId).toBeDefined();
        const call = traj.events.find((e) => e.id === result.toolResult!.toolCallEventId);
        expect(call).toBeDefined();
        expect(call!.type).toBe("tool_call");
      }
    });

    it("should extract timestamps", () => {
      const [traj] = parser.parse(fixture, "session.json");
      const d = new Date(traj.events[0].timestamp);
      expect(d.getTime()).not.toBeNaN();
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "session.json");
      expect(traj.summary).toBeDefined();
      expect(traj.summary!.totalToolCalls).toBe(2);
      expect(traj.summary!.uniqueTools).toContain("readFile");
      expect(traj.summary!.uniqueTools).toContain("editFile");
    });

    it("should handle empty history", () => {
      const empty = JSON.stringify({ sessionId: "x", history: [] });
      const result = parser.parse(empty, "empty.json");
      expect(result).toHaveLength(0);
    });

    it("should handle malformed JSON", () => {
      const result = parser.parse("not json", "session.json");
      expect(result).toHaveLength(0);
    });

    it("should fallback sessionId from filename", () => {
      const noId = JSON.stringify({ history: [{ role: "user", content: "hi" }] });
      const result = parser.parse(noId, "my-session.json");
      expect(result.length).toBe(1);
      expect(result[0].session.id).toBe("my-session");
    });
  });
});
