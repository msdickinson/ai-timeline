import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { OpenHandsParser } from "../../src/parsers/openhands";

const parser = new OpenHandsParser();
const fixture = readFileSync(
  join(__dirname, "../fixtures/openhands-output.jsonl"),
  "utf-8"
);

describe("OpenHandsParser", () => {
  describe("canParse", () => {
    it("should detect OpenHands output by history array + instance_id", () => {
      const firstLine = fixture.split("\n")[0];
      expect(parser.canParse("output.jsonl", firstLine)).toBe(true);
    });

    it("should reject files without history array", () => {
      expect(
        parser.canParse("data.jsonl", '{"type": "user", "sessionId": "abc"}')
      ).toBe(false);
    });

    it("should reject non-JSONL files", () => {
      expect(parser.canParse("data.txt", "hello")).toBe(false);
    });

    it("should handle malformed JSON", () => {
      expect(parser.canParse("bad.jsonl", "not json {")).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return one trajectory per JSONL line (instance)", () => {
      const result = parser.parse(fixture, "output.jsonl");
      expect(result).toHaveLength(1);
    });

    it("should extract instance metadata", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      expect(traj.source).toBe("openhands");
      expect(traj.version).toBe("1.0");
      expect(traj.session.id).toBe("django__django-12345");
      expect(traj.session.metadata?.instanceId).toBe("django__django-12345");
      expect(traj.session.metadata?.attempt).toBe(1);
      expect(traj.session.metadata?.hasPatch).toBe(true);
    });

    it("should derive status from patch and error", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      // Fixture has git_patch and no error → succeeded
      expect(traj.session.status).toBe("succeeded");
    });

    it("should set error status when error field present", () => {
      const errorFixture = fixture.replace('"error":null', '"error":"agent crashed"');
      const [traj] = parser.parse(errorFixture, "error.jsonl");
      expect(traj.session.status).toBe("error");
    });

    it("should skip ConversationStateUpdateEvent", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const stateEvents = traj.events.filter(
        (e) => e.content === "running" || e.content === "full_state"
      );
      expect(stateEvents).toHaveLength(0);
    });

    it("should parse SystemPromptEvent", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const systemEvents = traj.events.filter((e) => e.type === "system");
      expect(systemEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse user MessageEvent", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const userMsgs = traj.events.filter(
        (e) => e.type === "message" && e.role === "user"
      );
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(userMsgs[0].content).toContain("CharField");
    });

    it("should parse ActionEvents as tool calls", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      // Should have: 2x terminal (find, cat), 1x file_edit, 1x terminal (pytest)
      expect(toolCalls.length).toBe(4);

      const terminalCalls = toolCalls.filter(
        (e) => e.toolCall?.name === "terminal"
      );
      expect(terminalCalls.length).toBe(3); // find, cat, pytest

      const editCalls = toolCalls.filter(
        (e) => e.toolCall?.name === "file_edit"
      );
      expect(editCalls.length).toBe(1);
    });

    it("should parse ActionEvent arguments", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const terminalCall = traj.events.find(
        (e) => e.type === "tool_call" && e.toolCall?.name === "terminal"
      );
      expect(terminalCall).toBeDefined();
      expect(
        (terminalCall!.toolCall!.arguments as any).command
      ).toContain("find");
    });

    it("should parse ObservationEvents as tool results", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const toolResults = traj.events.filter((e) => e.type === "tool_result");
      expect(toolResults.length).toBe(4);

      // Check results link back to actions
      for (const result of toolResults) {
        expect(result.toolResult?.toolCallEventId).toBeDefined();
      }
    });

    it("should extract observation content", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const results = traj.events.filter((e) => e.type === "tool_result");
      const findResult = results.find((e) =>
        e.toolResult?.output?.includes("fields/__init__.py")
      );
      expect(findResult).toBeDefined();
    });

    it("should detect errors in observations", () => {
      // The fixture has no errors, all is_error: false
      const [traj] = parser.parse(fixture, "output.jsonl");
      const errors = traj.events.filter((e) => e.toolResult?.isError);
      expect(errors).toHaveLength(0);
    });

    it("should extract thinking from action thoughts", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const thinking = traj.events.filter((e) => e.type === "thinking");
      expect(thinking.length).toBeGreaterThan(0);
      // Should have thought content from action.thought
      expect(
        thinking.some((t) => t.content?.includes("find"))
      ).toBe(true);
    });

    it("should extract token usage from metrics", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      // Token usage should be set on the first event
      const withTokens = traj.events.filter((e) => e.tokens);
      expect(withTokens.length).toBeGreaterThan(0);
      // Accumulated usage is spread evenly across assistant turns, so the
      // per-turn values add back up to the totals (prompt + cache read, output).
      const sumIn = withTokens.reduce((a, e) => a + e.tokens!.input, 0);
      const sumOut = withTokens.reduce((a, e) => a + e.tokens!.output, 0);
      expect(Math.abs(sumIn - 90000)).toBeLessThanOrEqual(withTokens.length);
      expect(Math.abs(sumOut - 2500)).toBeLessThanOrEqual(withTokens.length);
    });

    it("should extract response latencies as durations", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      const withDuration = toolCalls.filter((e) => e.durationMs != null);
      expect(withDuration.length).toBeGreaterThan(0);
      // First latency is 3.5s = 3500ms
      expect(withDuration[0].durationMs).toBe(3500);
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "output.jsonl");
      expect(traj.summary).toBeDefined();
      expect(traj.summary!.totalToolCalls).toBe(4);
      expect(traj.summary!.uniqueTools).toContain("terminal");
      expect(traj.summary!.uniqueTools).toContain("file_edit");
      expect(traj.summary!.errorCount).toBe(0);
    });

    it("should handle empty history", () => {
      const content = JSON.stringify({
        instance_id: "test",
        history: [],
        metrics: {},
      });
      const result = parser.parse(content, "empty.jsonl");
      expect(result).toHaveLength(0);
    });

    it("should handle multiple instances in one file", () => {
      const line1 = fixture.split("\n")[0];
      const line2 = line1.replace(
        "django__django-12345",
        "django__django-67890"
      );
      const content = line1 + "\n" + line2;
      const result = parser.parse(content, "multi.jsonl");
      expect(result).toHaveLength(2);
      expect(result[0].session.id).toBe("django__django-12345");
      expect(result[1].session.id).toBe("django__django-67890");
    });
  });
});
