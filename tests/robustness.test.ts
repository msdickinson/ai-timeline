/**
 * Robustness tests — edge cases that previous audits identified as untested.
 * Cross-format parsing, unicode, orphaned tool results, invalid timestamps.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "../src/parsers/index";
import { computeSummary, TrajectoryEvent, safeTimestamp } from "../src/common/types";
import { ClaudeCodeParser } from "../src/parsers/claude-code";
import { OpenHandsParser } from "../src/parsers/openhands";
import { SweAgentParser } from "../src/parsers/swe-agent";
import { ClineParser } from "../src/parsers/cline";
import { ContinueDevParser } from "../src/parsers/continue-dev";
import { CodexCliParser } from "../src/parsers/codex-cli";
import { CopilotChatParser } from "../src/parsers/copilot-chat";
import { AmazonQParser } from "../src/parsers/amazon-q";

const claudeFixture = readFileSync(join(__dirname, "./fixtures/claude-code-session.jsonl"), "utf-8");
const openhandsFixture = readFileSync(join(__dirname, "./fixtures/openhands-output.jsonl"), "utf-8");
const sweagentFixture = readFileSync(join(__dirname, "./fixtures/swe-agent-instance.traj"), "utf-8");

describe("safeTimestamp helper", () => {
  it("should handle valid ISO string", () => {
    expect(safeTimestamp("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("should handle valid Unix ms", () => {
    const ts = safeTimestamp(1711900000000);
    expect(new Date(ts).getTime()).not.toBeNaN();
  });

  it("should handle null", () => {
    const ts = safeTimestamp(null);
    expect(new Date(ts).getTime()).not.toBeNaN();
  });

  it("should handle undefined", () => {
    const ts = safeTimestamp(undefined);
    expect(new Date(ts).getTime()).not.toBeNaN();
  });

  it("should handle NaN", () => {
    const ts = safeTimestamp(NaN);
    expect(new Date(ts).getTime()).not.toBeNaN();
  });

  it("should handle invalid string", () => {
    const ts = safeTimestamp("not a date");
    expect(new Date(ts).getTime()).not.toBeNaN();
  });

  it("should handle empty string", () => {
    const ts = safeTimestamp("");
    expect(new Date(ts).getTime()).not.toBeNaN();
  });

  it("should use fallback when value is invalid", () => {
    const fallback = "2020-01-01T00:00:00.000Z";
    expect(safeTimestamp("garbage", fallback)).toBe(fallback);
  });

  it("should handle negative timestamp (year 1969)", () => {
    const ts = safeTimestamp(-1000);
    expect(new Date(ts).getTime()).not.toBeNaN();
  });
});

describe("Cross-Format Robustness — Parser Given Wrong Data", () => {
  it("ClaudeCodeParser.parse should not crash on OpenHands data", () => {
    const parser = new ClaudeCodeParser();
    expect(() => parser.parse(openhandsFixture, "test.jsonl")).not.toThrow();
  });

  it("OpenHandsParser.parse should not crash on Claude Code data", () => {
    const parser = new OpenHandsParser();
    expect(() => parser.parse(claudeFixture, "test.jsonl")).not.toThrow();
  });

  it("SweAgentParser.parse should not crash on OpenHands data", () => {
    const parser = new SweAgentParser();
    expect(() => parser.parse(openhandsFixture, "test.traj")).not.toThrow();
  });

  it("ClineParser.parse should not crash on SWE-Agent data", () => {
    const parser = new ClineParser();
    expect(() => parser.parse(sweagentFixture, "test.json")).not.toThrow();
  });

  it("ContinueDevParser.parse should not crash on Claude Code data", () => {
    const parser = new ContinueDevParser();
    expect(() => parser.parse(claudeFixture, "test.json")).not.toThrow();
  });

  it("CodexCliParser.parse should not crash on random JSON", () => {
    const parser = new CodexCliParser();
    expect(() => parser.parse('{"random": "data"}', "test.json")).not.toThrow();
  });

  it("CopilotChatParser.parse should not crash on array JSON", () => {
    const parser = new CopilotChatParser();
    expect(() => parser.parse('[{"role":"user"}]', "test.json")).not.toThrow();
  });

  it("AmazonQParser.parse should not crash on Claude Code data", () => {
    const parser = new AmazonQParser();
    expect(() => parser.parse(claudeFixture, "test.json")).not.toThrow();
  });
});

describe("Unicode and Emoji Handling", () => {
  it("should handle emoji in content", () => {
    const content = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "Fix the 🐛 bug in auth.ts 🔧" }], ts: 1711900000000 },
      { role: "assistant", content: [{ type: "text", text: "I'll fix it! ✅" }], ts: 1711900001000 },
    ]);
    const result = parseFile(content, "api_conversation_history.json");
    expect(result.length).toBeGreaterThan(0);
    const allText = result[0].events.map((e) => e.content ?? "").join("");
    expect(allText).toContain("🐛");
    expect(allText).toContain("✅");
  });

  it("should handle CJK characters", () => {
    const content = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "修复 auth.ts 中的错误。データベース接続を確認。" }], ts: 1711900000000 },
    ]);
    const result = parseFile(content, "api_conversation_history.json");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].events[0].content).toContain("修复");
  });

  it("should handle RTL text (Arabic)", () => {
    const content = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "الرجاء إصلاح الخطأ في الكود" }], ts: 1711900000000 },
    ]);
    const result = parseFile(content, "api_conversation_history.json");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("Orphaned Tool Results (Missing Tool Call)", () => {
  it("computeSummary should handle orphaned toolCallEventId gracefully", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "tool_call", role: "assistant", toolCall: { name: "Read" } },
      { id: 1, timestamp: "2026-01-01T00:00:01Z", type: "tool_result", role: "environment", toolResult: { isError: false, output: "ok", toolCallEventId: 0 } },
      { id: 2, timestamp: "2026-01-01T00:00:02Z", type: "tool_result", role: "environment", toolResult: { isError: false, output: "orphaned", toolCallEventId: 999 } },
    ];
    expect(() => computeSummary(events)).not.toThrow();
    const summary = computeSummary(events);
    expect(summary.totalToolCalls).toBe(1);
    expect(summary.totalEvents).toBe(3);
  });

  it("all fixture parsers should produce trajectories with valid tool links", () => {
    const fixtures = [
      { file: "./fixtures/claude-code-session.jsonl", name: "session.jsonl" },
      { file: "./fixtures/openhands-output.jsonl", name: "output.jsonl" },
      { file: "./fixtures/swe-agent-instance.traj", name: "instance.traj" },
      { file: "./fixtures/cline-conversation.json", name: "api_conversation_history.json" },
      { file: "./fixtures/continue-session.json", name: ".continue/sessions/abc.json" },
      { file: "./fixtures/codex-session.json", name: "codex-session.json" },
      { file: "./fixtures/amazonq-history.json", name: "amazonq.json" },
    ];

    for (const f of fixtures) {
      const contents = readFileSync(join(__dirname, f.file), "utf-8");
      const trajs = parseFile(contents, f.name);
      for (const traj of trajs) {
        const orphans = traj.events.filter((e) => {
          if (e.type !== "tool_result" || !e.toolResult?.toolCallEventId) return false;
          return !traj.events.find((ev) => ev.id === e.toolResult!.toolCallEventId);
        });
        expect(orphans).toHaveLength(0);
      }
    }
  });
});

describe("Null Array Elements in All Parsers", () => {
  it("OpenHands: null in history array should not crash", () => {
    const fixture = JSON.stringify({
      instance_id: "null-test", history: [null, { timestamp: "2026-01-01T00:00:00Z", kind: "MessageEvent", source: "user", thought: [{ type: "text", text: "hi" }] }], metrics: {},
    });
    expect(() => parseFile(fixture, "output.jsonl")).not.toThrow();
  });

  it("SWE-Agent: null in trajectory array should not crash", () => {
    const fixture = JSON.stringify({
      instance_id: "null-test", info: {}, trajectory: [null, { thought: "test", action: "bash\nls", observation: "ok" }],
    });
    expect(() => parseFile(fixture, "test.traj")).not.toThrow();
  });

  it("Claude Code: null in content blocks should not crash", () => {
    const fixture = '{"type":"assistant","uuid":"x","message":{"role":"assistant","content":[null,{"type":"text","text":"hi"}]},"timestamp":"2026-01-01T00:00:00Z","sessionId":"x"}';
    expect(() => parseFile(fixture, "session.jsonl")).not.toThrow();
  });

  it("Cline: null message in array should not crash", () => {
    const fixture = JSON.stringify([null, { role: "user", content: [{ type: "text", text: "hi" }], ts: 1711900000000 }]);
    expect(() => parseFile(fixture, "api_conversation_history.json")).not.toThrow();
  });

  it("Amazon Q: null message should not crash", () => {
    const fixture = JSON.stringify({ conversationId: "test", messages: [null, { role: "user", content: "hi" }] });
    expect(() => parseFile(fixture, "amazonq.json")).not.toThrow();
  });

  it("Copilot Chat: null request should not crash", () => {
    const fixture = JSON.stringify({ requests: [null, { message: { text: "hi" }, timestamp: 1711900000000 }] });
    expect(() => parseFile(fixture, "chatSessions/abc.json")).not.toThrow();
  });
});

describe("Invalid Timestamp Handling", () => {
  it("should handle NaN timestamps in Cline format", () => {
    const content = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "hi" }], ts: NaN },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(() => parseFile(content, "api_conversation_history.json")).not.toThrow();
  });

  it("should handle string 'null' as timestamp", () => {
    const content = JSON.stringify({
      conversationId: "test",
      messages: [{ role: "user", content: "hi", timestamp: "null" }],
    });
    expect(() => parseFile(content, "amazonq.json")).not.toThrow();
  });

  it("should handle extremely large timestamps", () => {
    const content = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "hi" }], ts: 99999999999999 },
    ]);
    expect(() => parseFile(content, "api_conversation_history.json")).not.toThrow();
  });
});
