/**
 * Cross-parser invariant tests.
 * Every parser must produce valid Trajectory objects that won't crash any view.
 * Tests the full pipeline: parse → computeSummary → verify structure.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "../../src/parsers/index";
import { Trajectory, TrajectoryEvent, computeSummary } from "../../src/common/types";

const fixtures: Array<{ name: string; path: string }> = [
  { name: "Claude Code", path: "../fixtures/claude-code-session.jsonl" },
  { name: "OpenHands", path: "../fixtures/openhands-output.jsonl" },
  { name: "SWE-Agent", path: "../fixtures/swe-agent-instance.traj" },
  { name: "Cline", path: "../fixtures/cline-conversation.json" },
  { name: "Continue.dev", path: "../fixtures/continue-session.json" },
  { name: "Aider", path: "../fixtures/aider-chat-history.md" },
  { name: "Codex CLI", path: "../fixtures/codex-session.json" },
  { name: "Copilot Chat", path: "../fixtures/copilot-chat-session.json" },
  { name: "Amazon Q", path: "../fixtures/amazonq-history.json" },
];

// Load all fixtures and parse them
const allTrajectories: Array<{ name: string; trajectory: Trajectory }> = [];
for (const f of fixtures) {
  const contents = readFileSync(join(__dirname, f.path), "utf-8");
  // Use appropriate filename for auto-detection
  const filename = f.name === "Cline" ? "api_conversation_history.json"
    : f.name === "Continue.dev" ? ".continue/sessions/abc.json"
    : f.name === "Aider" ? ".aider.chat.history.md"
    : f.name === "Codex CLI" ? "codex-session.json"
    : f.name === "Copilot Chat" ? "chatSessions/abc.json"
    : f.name === "Amazon Q" ? "amazonq-history.json"
    : f.path.split("/").pop()!;

  const results = parseFile(contents, filename);
  for (const traj of results) {
    allTrajectories.push({ name: f.name, trajectory: traj });
  }
}

describe("All Parsers — Structural Invariants", () => {
  it("should parse all 9 fixture files", () => {
    expect(allTrajectories.length).toBeGreaterThanOrEqual(9);
  });

  for (const { name, trajectory: t } of allTrajectories) {
    describe(`${name} trajectory`, () => {
      it("should have version 1.0", () => {
        expect(t.version).toBe("1.0");
      });

      it("should have a non-empty session.id", () => {
        expect(t.session.id).toBeTruthy();
        expect(typeof t.session.id).toBe("string");
      });

      it("should have a valid startTime", () => {
        expect(t.session.startTime).toBeTruthy();
        const d = new Date(t.session.startTime);
        expect(d.getTime()).not.toBeNaN();
      });

      it("should have at least one event", () => {
        expect(t.events.length).toBeGreaterThan(0);
      });

      it("should have sequential event IDs", () => {
        for (let i = 1; i < t.events.length; i++) {
          expect(t.events[i].id).toBeGreaterThan(t.events[i - 1].id);
        }
      });

      it("should have valid event types", () => {
        const validTypes = ["message", "tool_call", "tool_result", "thinking", "system", "error"];
        for (const e of t.events) {
          expect(validTypes).toContain(e.type);
        }
      });

      it("should have valid event roles", () => {
        const validRoles = ["user", "assistant", "system", "environment"];
        for (const e of t.events) {
          expect(validRoles).toContain(e.role);
        }
      });

      it("tool_call events should have toolCall.name", () => {
        const toolCalls = t.events.filter((e) => e.type === "tool_call");
        for (const tc of toolCalls) {
          expect(tc.toolCall).toBeDefined();
          expect(tc.toolCall!.name).toBeTruthy();
          expect(typeof tc.toolCall!.name).toBe("string");
        }
      });

      it("tool_result events should have toolResult", () => {
        const results = t.events.filter((e) => e.type === "tool_result");
        for (const r of results) {
          expect(r.toolResult).toBeDefined();
          expect(typeof r.toolResult!.isError).toBe("boolean");
        }
      });

      it("should have a computed summary", () => {
        expect(t.summary).toBeDefined();
      });

      it("summary.totalEvents should match events.length", () => {
        expect(t.summary!.totalEvents).toBe(t.events.length);
      });

      it("summary.totalToolCalls should match tool_call events", () => {
        const toolCalls = t.events.filter((e) => e.type === "tool_call");
        expect(t.summary!.totalToolCalls).toBe(toolCalls.length);
      });

      it("summary token counts should be non-negative", () => {
        expect(t.summary!.totalTokens.input).toBeGreaterThanOrEqual(0);
        expect(t.summary!.totalTokens.output).toBeGreaterThanOrEqual(0);
        expect(t.summary!.totalTokens.cacheRead).toBeGreaterThanOrEqual(0);
        expect(t.summary!.totalTokens.cacheWrite).toBeGreaterThanOrEqual(0);
      });

      it("summary.durationMs should be non-negative", () => {
        expect(t.summary!.durationMs).toBeGreaterThanOrEqual(0);
      });

      it("summary.errorCount should be non-negative", () => {
        expect(t.summary!.errorCount).toBeGreaterThanOrEqual(0);
      });

      it("summary tool counts should sum to totalToolCalls", () => {
        const sum = Object.values(t.summary!.toolCallCounts).reduce((a, b) => a + b, 0);
        expect(sum).toBe(t.summary!.totalToolCalls);
      });

      it("should not have any NaN timestamps in events", () => {
        for (const e of t.events) {
          if (e.timestamp) {
            // Either valid or synthetic — should never be literally "NaN" or "Invalid Date"
            expect(e.timestamp).not.toBe("Invalid Date");
          }
        }
      });

      it("should not have any undefined required fields", () => {
        for (const e of t.events) {
          expect(e.id).toBeDefined();
          expect(e.type).toBeDefined();
          expect(e.role).toBeDefined();
        }
      });
    });
  }
});

describe("All Parsers — Tool Call Linking", () => {
  for (const { name, trajectory: t } of allTrajectories) {
    const results = t.events.filter((e) => e.type === "tool_result" && e.toolResult?.toolCallEventId != null);

    if (results.length > 0) {
      it(`${name}: tool_results should link to valid tool_calls`, () => {
        for (const r of results) {
          const call = t.events.find((e) => e.id === r.toolResult!.toolCallEventId);
          expect(call).toBeDefined();
          expect(call!.type).toBe("tool_call");
          expect(call!.id).toBeLessThan(r.id); // call before result
        }
      });
    }
  }
});

describe("All Parsers — Edge Cases", () => {
  it("should handle re-computing summary from events", () => {
    for (const { trajectory: t } of allTrajectories) {
      const recomputed = computeSummary(t.events);
      expect(recomputed.totalEvents).toBe(t.summary!.totalEvents);
      expect(recomputed.totalToolCalls).toBe(t.summary!.totalToolCalls);
    }
  });

  it("should handle empty events array in computeSummary", () => {
    const s = computeSummary([]);
    expect(s.totalEvents).toBe(0);
    expect(s.totalToolCalls).toBe(0);
    expect(s.durationMs).toBe(0);
  });

  it("should handle events with no tokens in computeSummary", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "user" },
    ];
    const s = computeSummary(events);
    expect(s.totalTokens.input).toBe(0);
    expect(s.totalTokens.output).toBe(0);
  });
});

describe("New Types — TestResults and SessionAnalysis", () => {
  it("TestResults type should be assignable", () => {
    const tr: import("../../src/common/types").TestResults = {
      passed: true,
      total: 5,
      passedCount: 5,
      failedCount: 0,
      tests: [
        { name: "test1", status: "passed" },
        { name: "test2", status: "passed", durationMs: 100 },
      ],
    };
    expect(tr.passed).toBe(true);
    expect(tr.tests!.length).toBe(2);
  });

  it("SessionAnalysis type should be assignable", () => {
    const sa: import("../../src/common/types").SessionAnalysis = {
      analyzedBy: "claude-opus-4-6",
      analyzedAt: "2026-04-04T00:00:00Z",
      verdict: "incorrect",
      confidence: 0.85,
      summary: "Agent edited the wrong file",
      explanation: "The agent confused utils.py with helpers.py",
      rootCause: "wrong_file_targeted",
      failureReasons: ["Edited utils.py instead of helpers.py"],
      strengths: ["Good initial analysis"],
      recommendations: ["Add file verification step"],
      tags: ["file_targeting", "confusion"],
      patchCorrectness: "incorrect",
      approachMatch: "wrong_approach",
    };
    expect(sa.verdict).toBe("incorrect");
    expect(sa.failureReasons!.length).toBe(1);
  });

  it("Trajectory with testResults and analysis should be valid", () => {
    const t: Trajectory = {
      version: "1.0",
      source: "unknown",
      session: { id: "test", startTime: "2026-01-01T00:00:00Z" },
      events: [],
      testResults: {
        passed: false,
        total: 10,
        passedCount: 8,
        failedCount: 2,
        tests: [
          { name: "test_auth", status: "failed", failureMessage: "AssertionError" },
        ],
      },
      analysis: {
        analyzedBy: "gpt-4",
        analyzedAt: "2026-01-01T01:00:00Z",
        verdict: "partial",
        summary: "Got 8/10 tests but missed edge cases",
        explanation: "The fix was correct but incomplete",
      },
    };
    expect(t.testResults!.failedCount).toBe(2);
    expect(t.analysis!.verdict).toBe("partial");
  });
});
