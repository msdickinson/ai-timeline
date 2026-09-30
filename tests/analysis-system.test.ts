/**
 * Tests for the analysis system — verifying that SessionAnalysis,
 * TestResults, and BenchmarkRun types work correctly together.
 * This tests the full pipeline from data to viewable analysis.
 */

import { describe, it, expect } from "vitest";
import {
  Trajectory,
  SessionAnalysis,
  TestResults,
  TestCase,
  BenchmarkRun,
  BenchmarkInstance,
  ExportPackage,
  computeSummary,
} from "../src/common/types";

function makeTrajectory(overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    version: "1.0",
    source: "unknown",
    session: { id: "test", startTime: "2026-01-01T00:00:00Z" },
    events: [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "user", content: "Fix the bug" },
      { id: 1, timestamp: "2026-01-01T00:00:05Z", type: "tool_call", role: "assistant", toolCall: { name: "Read", arguments: { file_path: "src/bug.ts" } } },
      { id: 2, timestamp: "2026-01-01T00:00:06Z", type: "tool_result", role: "environment", toolResult: { output: "code here", isError: false, toolCallEventId: 1 } },
      { id: 3, timestamp: "2026-01-01T00:00:10Z", type: "message", role: "assistant", content: "Fixed it" },
    ],
    summary: computeSummary([
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "user" },
      { id: 1, timestamp: "2026-01-01T00:00:05Z", type: "tool_call", role: "assistant", toolCall: { name: "Read" } },
      { id: 2, timestamp: "2026-01-01T00:00:06Z", type: "tool_result", role: "environment", toolResult: { output: "", isError: false, toolCallEventId: 1 } },
      { id: 3, timestamp: "2026-01-01T00:00:10Z", type: "message", role: "assistant" },
    ]),
    ...overrides,
  };
}

describe("SessionAnalysis — Full Structure", () => {
  it("should support a complete analysis with all fields", () => {
    const analysis: SessionAnalysis = {
      analyzedBy: "claude-opus-4-6",
      analyzedAt: "2026-04-04T12:00:00Z",
      verdict: "incorrect",
      confidence: 0.92,
      summary: "Agent edited the wrong file due to similar naming",
      explanation: "The agent found two files with similar names (utils.py and util_helpers.py) and edited the wrong one. The fix was syntactically correct but applied to the wrong location.",
      rootCause: "file_targeting_error",
      failureReasons: [
        "Edited utils.py instead of util_helpers.py",
        "Did not verify file contents before editing",
        "Ignored grep results showing the function was in util_helpers.py",
      ],
      strengths: [
        "Correctly identified the bug type",
        "The proposed fix logic was correct",
        "Good use of search tools initially",
      ],
      recommendations: [
        "Always verify file contents with Read before Edit",
        "When multiple similar files exist, grep for the specific function",
        "Add a verification step after editing",
      ],
      tags: ["file_targeting", "similar_names", "missing_verification"],
      patchCorrectness: "incorrect",
      approachMatch: "wrong_approach",
      problematicToolCalls: [
        { eventId: 5, toolName: "Edit", issue: "Edited wrong file" },
      ],
      decisionPoints: [
        { eventId: 3, description: "Chose utils.py over util_helpers.py", wasCorrect: false, betterAlternative: "Should have searched for function definition first" },
        { eventId: 1, description: "Started with grep to find the function", wasCorrect: true },
      ],
      iterationCount: 2,
      strategyPivots: ["Switched from reading all files to targeted search after first failure"],
      taskDifficulty: "medium",
      phaseBreakdown: {
        exploration: 30,
        implementation: 40,
        debugging: 20,
        verification: 10,
      },
    };

    expect(analysis.verdict).toBe("incorrect");
    expect(analysis.confidence).toBe(0.92);
    expect(analysis.failureReasons!.length).toBe(3);
    expect(analysis.strengths!.length).toBe(3);
    expect(analysis.recommendations!.length).toBe(3);
    expect(analysis.problematicToolCalls!.length).toBe(1);
    expect(analysis.decisionPoints!.length).toBe(2);
    expect(analysis.phaseBreakdown!.exploration).toBe(30);
  });

  it("should support minimal analysis (just verdict + summary)", () => {
    const analysis: SessionAnalysis = {
      analyzedBy: "human",
      analyzedAt: "2026-04-04T00:00:00Z",
      verdict: "correct",
      summary: "Looks good",
      explanation: "The fix was correct and complete.",
    };
    expect(analysis.verdict).toBe("correct");
  });

  it("should attach to a trajectory", () => {
    const traj = makeTrajectory({
      analysis: {
        analyzedBy: "gpt-4o",
        analyzedAt: "2026-04-04T00:00:00Z",
        verdict: "partial",
        summary: "Partially correct fix",
        explanation: "Fixed the main issue but introduced a regression",
        failureReasons: ["New test failures in edge cases"],
        strengths: ["Core logic fix was correct"],
      },
    });
    expect(traj.analysis!.verdict).toBe("partial");
    expect(traj.analysis!.failureReasons!.length).toBe(1);
  });
});

describe("TestResults — Full Structure", () => {
  it("should support detailed test results with individual cases", () => {
    const results: TestResults = {
      passed: false,
      total: 15,
      passedCount: 12,
      failedCount: 2,
      skippedCount: 1,
      durationMs: 4500,
      framework: "pytest",
      rawOutput: "FAILED test_auth.py::test_login - AssertionError\n12 passed, 2 failed, 1 skipped in 4.5s",
      tests: [
        { name: "test_login", suite: "test_auth.py", status: "failed", durationMs: 150, failureMessage: "AssertionError: expected 200, got 401", stackTrace: "File test_auth.py:42\n  assert resp.status == 200" },
        { name: "test_logout", suite: "test_auth.py", status: "failed", durationMs: 80, failureMessage: "AttributeError: session not found" },
        { name: "test_register", suite: "test_auth.py", status: "passed", durationMs: 120 },
        { name: "test_reset_password", suite: "test_auth.py", status: "skipped" },
      ],
    };
    expect(results.total).toBe(15);
    expect(results.failedCount).toBe(2);
    expect(results.tests!.filter((t) => t.status === "failed").length).toBe(2);
  });

  it("should attach to a trajectory alongside analysis", () => {
    const traj = makeTrajectory({
      testResults: {
        passed: true,
        total: 5,
        passedCount: 5,
        failedCount: 0,
      },
      analysis: {
        analyzedBy: "claude-opus-4-6",
        analyzedAt: "2026-04-04T00:00:00Z",
        verdict: "correct",
        summary: "All tests pass",
        explanation: "Clean fix",
      },
    });
    expect(traj.testResults!.passed).toBe(true);
    expect(traj.analysis!.verdict).toBe("correct");
  });
});

describe("BenchmarkRun — Full Structure", () => {
  it("should support a complete benchmark run with instances", () => {
    const run: BenchmarkRun = {
      name: "SWE-bench Verified Q2 2026",
      harness: "CustomHarness",
      date: "2026-04-04T00:00:00Z",
      config: { model: "claude-opus-4-6", temperature: 1.0, maxIterations: 100 },
      instances: [
        { instanceId: "django__django-15277", sessionId: "sess-001", status: "passed" },
        { instanceId: "sympy__sympy-16886", sessionId: "sess-002", status: "failed", notes: "Wrong file edited" },
        { instanceId: "matplotlib__matplotlib-25287", sessionId: "sess-003", status: "error", verificationLog: "Docker timeout" },
        { instanceId: "sphinx-doc__sphinx-10614", sessionId: "sess-004", status: "passed", patchApplied: true },
      ],
    };
    expect(run.instances.length).toBe(4);
    expect(run.instances.filter((i) => i.status === "passed").length).toBe(2);
    expect(run.instances.filter((i) => i.status === "failed").length).toBe(1);
  });
});

describe("ExportPackage — Full Structure", () => {
  it("should bundle trajectories with analysis and test results for sharing", () => {
    const trajs = [
      makeTrajectory({
        session: { id: "sess-001", startTime: "2026-04-04T00:00:00Z", status: "succeeded" },
        testResults: { passed: true, total: 10, passedCount: 10, failedCount: 0 },
        analysis: {
          analyzedBy: "claude-opus-4-6",
          analyzedAt: "2026-04-04T01:00:00Z",
          verdict: "correct",
          summary: "Clean fix, all tests pass",
          explanation: "Agent correctly identified and fixed the bug",
          strengths: ["Efficient approach", "Good test coverage"],
        },
      }),
      makeTrajectory({
        session: { id: "sess-002", startTime: "2026-04-04T00:05:00Z", status: "failed" },
        testResults: { passed: false, total: 10, passedCount: 7, failedCount: 3 },
        analysis: {
          analyzedBy: "claude-opus-4-6",
          analyzedAt: "2026-04-04T01:00:00Z",
          verdict: "incorrect",
          summary: "Wrong file targeted",
          explanation: "Agent confused similar filenames",
          rootCause: "file_targeting",
          failureReasons: ["Edited wrong file"],
          recommendations: ["Verify file before editing"],
          taskDifficulty: "medium",
        },
      }),
    ];

    const pkg: ExportPackage = {
      version: "1.0",
      exportedAt: "2026-04-04T02:00:00Z",
      title: "SWE-bench Results - CustomHarness v2.1",
      enabledViews: ["dashboard", "gantt", "benchmark", "analysis", "test-results", "findings"],
      showSidebar: true,
      trajectories: trajs,
      benchmark: {
        name: "SWE-bench Verified",
        harness: "CustomHarness",
        date: "2026-04-04T00:00:00Z",
        instances: [
          { instanceId: "django-15277", sessionId: "sess-001", status: "passed" },
          { instanceId: "sympy-16886", sessionId: "sess-002", status: "failed" },
        ],
      },
    };

    expect(pkg.trajectories.length).toBe(2);
    expect(pkg.trajectories[0].analysis!.verdict).toBe("correct");
    expect(pkg.trajectories[1].analysis!.verdict).toBe("incorrect");
    expect(pkg.benchmark!.instances.length).toBe(2);

    // Verify the export is JSON-serializable
    const json = JSON.stringify(pkg);
    const reparsed = JSON.parse(json) as ExportPackage;
    expect(reparsed.trajectories.length).toBe(2);
    expect(reparsed.trajectories[0].analysis!.verdict).toBe("correct");
    expect(reparsed.benchmark!.instances[1].status).toBe("failed");
  });
});

describe("Analysis Aggregation Patterns", () => {
  const trajectories = [
    makeTrajectory({
      session: { id: "s1", startTime: "2026-01-01T00:00:00Z" },
      analysis: {
        analyzedBy: "claude", analyzedAt: "2026-01-01T00:00:00Z",
        verdict: "incorrect", summary: "Wrong file", explanation: "",
        rootCause: "file_targeting", tags: ["file_targeting", "similar_names"],
        taskDifficulty: "medium",
      },
    }),
    makeTrajectory({
      session: { id: "s2", startTime: "2026-01-01T00:00:00Z" },
      analysis: {
        analyzedBy: "claude", analyzedAt: "2026-01-01T00:00:00Z",
        verdict: "incorrect", summary: "Wrong approach", explanation: "",
        rootCause: "wrong_approach", tags: ["wrong_approach", "missed_context"],
        taskDifficulty: "hard",
      },
    }),
    makeTrajectory({
      session: { id: "s3", startTime: "2026-01-01T00:00:00Z" },
      analysis: {
        analyzedBy: "claude", analyzedAt: "2026-01-01T00:00:00Z",
        verdict: "correct", summary: "Good fix", explanation: "",
        rootCause: undefined, tags: ["clean_fix"],
        taskDifficulty: "easy",
      },
    }),
    makeTrajectory({
      session: { id: "s4", startTime: "2026-01-01T00:00:00Z" },
      analysis: {
        analyzedBy: "claude", analyzedAt: "2026-01-01T00:00:00Z",
        verdict: "incorrect", summary: "File targeting again", explanation: "",
        rootCause: "file_targeting", tags: ["file_targeting"],
        taskDifficulty: "medium",
      },
    }),
  ];

  it("should aggregate verdicts", () => {
    const verdicts = trajectories.map((t) => t.analysis!.verdict);
    const counts: Record<string, number> = {};
    for (const v of verdicts) counts[v] = (counts[v] ?? 0) + 1;
    expect(counts["incorrect"]).toBe(3);
    expect(counts["correct"]).toBe(1);
  });

  it("should find most common root causes", () => {
    const causes = trajectories
      .map((t) => t.analysis!.rootCause)
      .filter(Boolean) as string[];
    const counts: Record<string, number> = {};
    for (const c of causes) counts[c] = (counts[c] ?? 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    expect(sorted[0][0]).toBe("file_targeting");
    expect(sorted[0][1]).toBe(2);
  });

  it("should aggregate tags across sessions", () => {
    const allTags = trajectories.flatMap((t) => t.analysis!.tags ?? []);
    const tagCounts: Record<string, number> = {};
    for (const tag of allTags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    expect(tagCounts["file_targeting"]).toBe(2); // s1 and s4
    expect(tagCounts["similar_names"]).toBe(1);
  });

  it("should compute pass rate by difficulty", () => {
    const byDifficulty: Record<string, { total: number; correct: number }> = {};
    for (const t of trajectories) {
      const d = t.analysis!.taskDifficulty ?? "unknown";
      if (!byDifficulty[d]) byDifficulty[d] = { total: 0, correct: 0 };
      byDifficulty[d].total++;
      if (t.analysis!.verdict === "correct") byDifficulty[d].correct++;
    }
    expect(byDifficulty["easy"].correct / byDifficulty["easy"].total).toBe(1.0);
    expect(byDifficulty["medium"].correct / byDifficulty["medium"].total).toBe(0);
    expect(byDifficulty["hard"].correct / byDifficulty["hard"].total).toBe(0);
  });
});
