/**
 * View Render Safety Tests — actually calls render() on every view
 * with empty data, single session, and multi-session to verify
 * no runtime crashes occur.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "../src/parsers/index";
import { Trajectory, computeSummary } from "../src/common/types";
import { ViewOptions } from "../src/common/registry";

// Import every registered view
import { dashboardV2View } from "../src/views/dashboard-v2";
import { dashboardV3View } from "../src/views/dashboard-v3";
import { ganttView } from "../src/views/gantt";
import { aiCallsView } from "../src/views/ai-calls";
import { toolUsageView } from "../src/views/tool-usage";
import { tableV2View } from "../src/views/table-v2";
import { costView } from "../src/views/cost";
import { diffView } from "../src/views/diff";
import { errorsView } from "../src/views/errors";
import { conversationView } from "../src/views/conversation";
import { heatmapView } from "../src/views/heatmap";
import { summaryView } from "../src/views/summary";
import { tokenFlowView } from "../src/views/token-flow";
import { rawView } from "../src/views/raw";
import { testResultsView } from "../src/views/test-results";
import { toolPatternsView } from "../src/views/tool-patterns";
import { iterationAnalysisView } from "../src/views/iteration-analysis";
import { fileImpactView } from "../src/views/file-impact";
import { tokenEfficiencyView } from "../src/views/token-efficiency";
import { findingsView } from "../src/views/findings";
import { contextUsageView } from "../src/views/context-usage";
import { strategyView } from "../src/views/strategy";
import { timelineCompactView } from "../src/views/timeline-compact";

const allViews = [
  dashboardV2View, dashboardV3View, ganttView, aiCallsView, toolUsageView,
  tableV2View, costView, diffView, errorsView, conversationView,
  heatmapView, summaryView, tokenFlowView, rawView, testResultsView,
  toolPatternsView, iterationAnalysisView, fileImpactView, tokenEfficiencyView, findingsView,
  contextUsageView, strategyView, timelineCompactView,
];

// Load real fixture for single/multi session tests
const claudeFixture = readFileSync(join(__dirname, "./fixtures/claude-code-session.jsonl"), "utf-8");
const claudeTrajs = parseFile(claudeFixture, "session.jsonl");
const openhandsFixture = readFileSync(join(__dirname, "./fixtures/openhands-output.jsonl"), "utf-8");
const openhandsTrajs = parseFile(openhandsFixture, "output.jsonl");

const defaultOptions: ViewOptions = {
  darkMode: false,
  filterTool: null,
  expandedEvents: new Set(),
  onStateChange: () => {},
};

function makeContainer(): HTMLElement {
  const div = document.createElement("div");
  div.style.width = "1024px";
  div.style.height = "768px";
  return div;
}

describe("All views — Render with Empty Trajectories", () => {
  for (const view of allViews) {
    it(`${view.name} (${view.id}): render([]) should not throw`, () => {
      const container = makeContainer();
      expect(() => view.render(container, [], defaultOptions)).not.toThrow();
    });
  }
});

describe("All views — Render with Single Trajectory", () => {
  for (const view of allViews) {
    it(`${view.name} (${view.id}): render([traj]) should not throw`, () => {
      const container = makeContainer();
      expect(() => view.render(container, claudeTrajs, defaultOptions)).not.toThrow();
    });
  }
});

describe("All views — Render with Multi Trajectory", () => {
  // Combine Claude Code + OpenHands for multi-session
  const multiTrajs = [...claudeTrajs, ...openhandsTrajs];

  for (const view of allViews) {
    it(`${view.name} (${view.id}): render([traj1, traj2, ...]) should not throw`, () => {
      const container = makeContainer();
      expect(() => view.render(container, multiTrajs, defaultOptions)).not.toThrow();
    });
  }
});

describe("All views — Render with Trajectory with Zero Events", () => {
  const emptyEventsTraj: Trajectory = {
    version: "1.0",
    source: "unknown",
    session: { id: "empty", startTime: "2026-01-01T00:00:00Z" },
    events: [],
    summary: computeSummary([]),
  };

  for (const view of allViews) {
    it(`${view.name} (${view.id}): render with zero-event trajectory should not throw`, () => {
      const container = makeContainer();
      expect(() => view.render(container, [emptyEventsTraj], defaultOptions)).not.toThrow();
    });
  }
});

describe("All views — Render with Analysis + TestResults", () => {
  const richTraj: Trajectory = {
    ...claudeTrajs[0],
    testResults: {
      passed: false,
      total: 10,
      passedCount: 7,
      failedCount: 3,
      framework: "vitest",
      tests: [
        { name: "test_a", status: "passed", durationMs: 50 },
        { name: "test_b", status: "failed", failureMessage: "AssertionError", durationMs: 100 },
        { name: "test_c", status: "failed", failureMessage: "TypeError", stackTrace: "at line 42" },
      ],
    },
    analysis: {
      analyzedBy: "claude-opus-4-6",
      analyzedAt: "2026-04-04T00:00:00Z",
      verdict: "partial",
      confidence: 0.75,
      summary: "Partially correct fix",
      explanation: "Core logic correct but edge cases missed",
      rootCause: "incomplete_fix",
      failureReasons: ["Missing null check", "Edge case not handled"],
      strengths: ["Good initial analysis", "Correct approach"],
      recommendations: ["Add edge case tests", "Check null inputs"],
      tags: ["incomplete", "edge_cases"],
      taskDifficulty: "medium",
      phaseBreakdown: { exploration: 30, implementation: 50, debugging: 15, verification: 5 },
    },
  };

  for (const view of allViews) {
    it(`${view.name} (${view.id}): render with analysis+testResults should not throw`, () => {
      const container = makeContainer();
      expect(() => view.render(container, [richTraj], defaultOptions)).not.toThrow();
    });
  }
});
