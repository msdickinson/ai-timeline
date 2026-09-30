/**
 * Edge case tests covering gaps found by audit.
 * - Parser ambiguity and precedence
 * - Error fixtures
 * - Empty/malformed inputs
 * - New fields (status, cost)
 * - Cross-parser collisions
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFile, parseFiles } from "../../src/parsers/index";
import { ClaudeCodeParser } from "../../src/parsers/claude-code";
import { OpenHandsParser } from "../../src/parsers/openhands";
import { SweAgentParser } from "../../src/parsers/swe-agent";

const claudeFixture = readFileSync(join(__dirname, "../fixtures/claude-code-session.jsonl"), "utf-8");
const openhandsFixture = readFileSync(join(__dirname, "../fixtures/openhands-output.jsonl"), "utf-8");
const sweagentFixture = readFileSync(join(__dirname, "../fixtures/swe-agent-instance.traj"), "utf-8");

describe("Parser precedence", () => {
  it("should parse OpenHands before Claude Code for .jsonl with history+instance_id", () => {
    // OpenHands format: has history array and instance_id
    const result = parseFile(openhandsFixture, "output.jsonl");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe("openhands");
  });

  it("should parse Claude Code for .jsonl with sessionId", () => {
    const result = parseFile(claudeFixture, "session.jsonl");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe("claude-code");
  });

  it("should not false-positive Claude Code on generic type:user without uuid", () => {
    const parser = new ClaudeCodeParser();
    // A line with type:user but no uuid should NOT match Claude Code
    expect(parser.canParse("test.jsonl", '{"type":"user","content":"hello"}')).toBe(false);
  });

  it("should match Claude Code when uuid is present", () => {
    const parser = new ClaudeCodeParser();
    expect(parser.canParse("test.jsonl", '{"type":"user","uuid":"abc-123"}')).toBe(true);
  });

  it("should match Claude Code on sessionId", () => {
    const parser = new ClaudeCodeParser();
    expect(parser.canParse("test.jsonl", '{"sessionId":"abc"}')).toBe(true);
  });

  it("should match Claude Code on file-history-snapshot", () => {
    const parser = new ClaudeCodeParser();
    expect(parser.canParse("test.jsonl", '{"type":"file-history-snapshot"}')).toBe(true);
  });
});

describe("Error fixtures", () => {
  it("should handle OpenHands instance with error", () => {
    const errorFixture = openhandsFixture.replace('"error":null', '"error":"agent crashed"');
    const result = parseFile(errorFixture, "error.jsonl");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].session.status).toBe("error");
  });

  it("should handle SWE-Agent with failed exit status", () => {
    const failedFixture = sweagentFixture.replace('"exit_status": "submitted"', '"exit_status": "failed"');
    const result = parseFile(failedFixture, "failed.traj");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].session.status).toBe("failed");
  });

  it("should handle SWE-Agent with timeout exit status", () => {
    const timeoutFixture = sweagentFixture.replace('"exit_status": "submitted"', '"exit_status": "timeout"');
    const result = parseFile(timeoutFixture, "timeout.traj");
    expect(result[0].session.status).toBe("timeout");
  });
});

describe("Empty and malformed inputs", () => {
  it("should handle completely empty file", () => {
    expect(parseFile("", "empty.jsonl")).toHaveLength(0);
    expect(parseFile("", "empty.traj")).toHaveLength(0);
    expect(parseFile("", "empty.json")).toHaveLength(0);
  });

  it("should handle file with only whitespace", () => {
    expect(parseFile("   \n\n  ", "space.jsonl")).toHaveLength(0);
  });

  it("should handle malformed JSON in .traj", () => {
    expect(parseFile("{ invalid json }", "bad.traj")).toHaveLength(0);
  });

  it("should handle .jsonl with mix of valid and invalid lines", () => {
    const mixed = claudeFixture.split("\n").slice(0, 3).join("\n") + "\nINVALID\n" + claudeFixture.split("\n").slice(3, 5).join("\n");
    const result = parseFile(mixed, "mixed.jsonl");
    expect(result.length).toBeGreaterThan(0); // Should parse valid lines
  });

  it("should handle .traj with empty trajectory array", () => {
    const empty = JSON.stringify({ instance_id: "test", info: {}, trajectory: [] });
    expect(parseFile(empty, "empty.traj")).toHaveLength(0);
  });

  it("should handle .jsonl with empty history", () => {
    const empty = JSON.stringify({ instance_id: "test", history: [], metrics: {} });
    expect(parseFile(empty, "empty.jsonl")).toHaveLength(0);
  });

  it("should handle file with unknown extension", () => {
    expect(parseFile('{"data": "test"}', "data.txt")).toHaveLength(0);
    expect(parseFile('{"data": "test"}', "data.csv")).toHaveLength(0);
  });
});

describe("Status and cost extraction", () => {
  it("OpenHands should set succeeded when patch exists and no error", () => {
    const result = parseFile(openhandsFixture, "oh.jsonl");
    expect(result[0].session.status).toBe("succeeded");
  });

  it("SWE-Agent should set succeeded for submitted exit_status", () => {
    const result = parseFile(sweagentFixture, "swe.traj");
    expect(result[0].session.status).toBe("succeeded");
  });

  it("SWE-Agent should extract cost from model_stats", () => {
    const result = parseFile(sweagentFixture, "swe.traj");
    expect(result[0].session.cost).toBeDefined();
    expect(result[0].session.cost!.totalUsd).toBe(0.15);
  });

  it("Claude Code should not have status (not applicable)", () => {
    const result = parseFile(claudeFixture, "cc.jsonl");
    expect(result[0].session.status).toBeUndefined();
  });
});

describe("parseFiles batch edge cases", () => {
  it("should preserve input order in results", () => {
    const result = parseFiles([
      { name: "oh.jsonl", contents: openhandsFixture },
      { name: "cc.jsonl", contents: claudeFixture },
      { name: "swe.traj", contents: sweagentFixture },
    ]);
    expect(result[0].source).toBe("openhands");
    expect(result[1].source).toBe("claude-code");
    expect(result[2].source).toBe("swe-agent");
  });

  it("should handle duplicate filenames independently", () => {
    const result = parseFiles([
      { name: "session.jsonl", contents: claudeFixture },
      { name: "session.jsonl", contents: claudeFixture },
    ]);
    expect(result).toHaveLength(2);
  });

  it("should skip unparseable and continue with rest", () => {
    const result = parseFiles([
      { name: "bad.jsonl", contents: "not json" },
      { name: "good.jsonl", contents: claudeFixture },
      { name: "also-bad.txt", contents: "random" },
      { name: "also-good.traj", contents: sweagentFixture },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("claude-code");
    expect(result[1].source).toBe("swe-agent");
  });
});

describe("Tool call to result linking", () => {
  it("Claude Code should link all tool results to their calls", () => {
    const result = parseFile(claudeFixture, "cc.jsonl");
    const results = result[0].events.filter((e) => e.type === "tool_result");
    for (const r of results) {
      expect(r.toolResult?.toolCallEventId).toBeDefined();
      const call = result[0].events.find((e) => e.id === r.toolResult!.toolCallEventId);
      expect(call).toBeDefined();
      expect(call!.type).toBe("tool_call");
      expect(call!.id).toBeLessThan(r.id); // Call before result
    }
  });

  it("OpenHands should link observations to actions", () => {
    const result = parseFile(openhandsFixture, "oh.jsonl");
    const results = result[0].events.filter((e) => e.type === "tool_result");
    for (const r of results) {
      if (r.toolResult?.toolCallEventId != null) {
        const call = result[0].events.find((e) => e.id === r.toolResult!.toolCallEventId);
        expect(call).toBeDefined();
        expect(call!.type).toBe("tool_call");
      }
    }
  });

  it("SWE-Agent original format should link results to calls", () => {
    const result = parseFile(sweagentFixture, "swe.traj");
    const results = result[0].events.filter((e) => e.type === "tool_result");
    for (const r of results) {
      expect(r.toolResult?.toolCallEventId).toBeDefined();
      const call = result[0].events.find((e) => e.id === r.toolResult!.toolCallEventId);
      expect(call).toBeDefined();
      expect(call!.type).toBe("tool_call");
    }
  });

  it("SWE-Agent v2.0 format should link tool results to tool calls", () => {
    const v2 = JSON.stringify({
      instance_id: "v2-test",
      info: { model: "gpt-4" },
      history: [
        { role: "system", content: "You are a bot" },
        { role: "user", content: "Fix the bug" },
        { role: "assistant", tool_calls: [{ function: { name: "bash", arguments: '{"cmd":"ls"}' }, id: "tc1" }] },
        { role: "tool", content: "file1.py\nfile2.py" },
        { role: "assistant", tool_calls: [{ function: { name: "edit", arguments: '{"path":"file1.py"}' }, id: "tc2" }] },
        { role: "tool", content: "File edited" },
      ],
    });
    const result = parseFile(v2, "v2.traj");
    expect(result).toHaveLength(1);
    const toolResults = result[0].events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(2);
    for (const r of toolResults) {
      expect(r.toolResult?.toolCallEventId).toBeDefined();
      const call = result[0].events.find((e) => e.id === r.toolResult!.toolCallEventId);
      expect(call).toBeDefined();
      expect(call!.type).toBe("tool_call");
    }
  });
});

describe("Summary invariants across all parsers", () => {
  const allTrajectories = [
    ...parseFile(claudeFixture, "cc.jsonl"),
    ...parseFile(openhandsFixture, "oh.jsonl"),
    ...parseFile(sweagentFixture, "swe.traj"),
  ];

  it("all summaries should have non-negative values", () => {
    for (const t of allTrajectories) {
      const s = t.summary!;
      expect(s.totalEvents).toBeGreaterThanOrEqual(0);
      expect(s.totalToolCalls).toBeGreaterThanOrEqual(0);
      expect(s.errorCount).toBeGreaterThanOrEqual(0);
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
      expect(s.totalTokens.input).toBeGreaterThanOrEqual(0);
      expect(s.totalTokens.output).toBeGreaterThanOrEqual(0);
    }
  });

  it("tool call counts should match unique tools", () => {
    for (const t of allTrajectories) {
      const s = t.summary!;
      const countSum = Object.values(s.toolCallCounts).reduce((a, b) => a + b, 0);
      expect(countSum).toBe(s.totalToolCalls);
      expect(Object.keys(s.toolCallCounts).length).toBe(s.uniqueTools.length);
    }
  });

  it("all sessions should have valid start times", () => {
    for (const t of allTrajectories) {
      const d = new Date(t.session.startTime);
      expect(d.getTime()).not.toBeNaN();
    }
  });
});
