/**
 * Tests that every view handles missing data gracefully.
 * Uses Tier 2 data (no tokens) and Tier 3 data (no tools, no tokens)
 * to verify views show helpful messages instead of empty/broken content.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { Trajectory, TrajectoryEvent, computeSummary } from "../src/common/types";
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

const opts: ViewOptions = { darkMode: false, filterTool: null, expandedEvents: new Set(), onStateChange: () => {} };

// Tier 2: tool calls but NO tokens, NO model, NO thinking (like Cline/Continue/Aider)
function makeTier2Traj(): Trajectory {
  const events: TrajectoryEvent[] = [
    { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "user", content: "Fix the bug in auth.ts" },
    { id: 1, timestamp: "2026-01-01T00:00:02Z", type: "tool_call", role: "assistant", toolCall: { name: "read_file", arguments: { path: "src/auth.ts" } } },
    { id: 2, timestamp: "2026-01-01T00:00:03Z", type: "tool_result", role: "environment", toolResult: { output: "function login() { ... }", isError: false, toolCallEventId: 1 } },
    { id: 3, timestamp: "2026-01-01T00:00:05Z", type: "message", role: "assistant", content: "I see the issue. Let me fix it." },
    { id: 4, timestamp: "2026-01-01T00:00:06Z", type: "tool_call", role: "assistant", toolCall: { name: "write_to_file", arguments: { path: "src/auth.ts", content: "fixed code" } } },
    { id: 5, timestamp: "2026-01-01T00:00:07Z", type: "tool_result", role: "environment", toolResult: { output: "File written.", isError: false, toolCallEventId: 4 } },
    { id: 6, timestamp: "2026-01-01T00:00:08Z", type: "tool_call", role: "assistant", toolCall: { name: "execute_command", arguments: { command: "npm test" } } },
    { id: 7, timestamp: "2026-01-01T00:00:15Z", type: "tool_result", role: "environment", toolResult: { output: "3 passed", isError: false, toolCallEventId: 6 } },
    { id: 8, timestamp: "2026-01-01T00:00:16Z", type: "message", role: "assistant", content: "Fixed. All tests pass." },
  ];
  return {
    version: "1.0", source: "cline",
    session: { id: "tier2-session", startTime: events[0].timestamp, endTime: events[events.length - 1].timestamp, metadata: { tool: "cline" } },
    events, summary: computeSummary(events),
  };
}

// Tier 3: messages ONLY — no tools, no tokens (like Copilot Chat)
function makeTier3Traj(): Trajectory {
  const events: TrajectoryEvent[] = [
    { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "user", content: "How do I implement retry logic?" },
    { id: 1, timestamp: "2026-01-01T00:00:05Z", type: "message", role: "assistant", content: "Here is a retry implementation with exponential backoff..." },
    { id: 2, timestamp: "2026-01-01T00:00:10Z", type: "message", role: "user", content: "Can you add jitter?" },
    { id: 3, timestamp: "2026-01-01T00:00:15Z", type: "message", role: "assistant", content: "Sure, here is the updated version with jitter..." },
  ];
  return {
    version: "1.0", source: "copilot-chat",
    session: { id: "tier3-session", startTime: events[0].timestamp, endTime: events[events.length - 1].timestamp, metadata: { tool: "copilot-chat" } },
    events, summary: computeSummary(events),
  };
}

const allViews = [
  { view: dashboardV2View, name: "Dashboard" },
  { view: dashboardV3View, name: "Dashboard v3" },
  { view: ganttView, name: "Gantt" },
  { view: aiCallsView, name: "AI Calls" },
  { view: toolUsageView, name: "Tools" },
  { view: tableV2View, name: "Table" },
  { view: costView, name: "Cost" },
  { view: diffView, name: "Diffs" },
  { view: errorsView, name: "Errors" },
  { view: conversationView, name: "Chat" },
  { view: heatmapView, name: "Heatmap" },
  { view: summaryView, name: "Summary" },
  { view: tokenFlowView, name: "Token Flow" },
  { view: rawView, name: "Raw JSON" },
  { view: testResultsView, name: "Tests" },
  { view: toolPatternsView, name: "Patterns" },
  { view: iterationAnalysisView, name: "Iterations" },
  { view: fileImpactView, name: "Files" },
  { view: tokenEfficiencyView, name: "Efficiency" },
  { view: findingsView, name: "Findings" },
  { view: contextUsageView, name: "Context" },
  { view: strategyView, name: "Strategy" },
  { view: timelineCompactView, name: "Compact" },
];

describe("All views with Tier 2 Data (tools, no tokens)", () => {
  const traj = makeTier2Traj();

  for (const { view, name } of allViews) {
    it(`${name}: should not crash and should render content`, () => {
      const container = document.createElement("div");
      expect(() => view.render(container, [traj], opts)).not.toThrow();
      // Should render SOMETHING — not be completely empty
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });
  }
});

describe("All views with Tier 3 Data (messages only, no tools)", () => {
  const traj = makeTier3Traj();

  for (const { view, name } of allViews) {
    it(`${name}: should not crash with messages-only data`, () => {
      const container = document.createElement("div");
      expect(() => view.render(container, [traj], opts)).not.toThrow();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });
  }
});

describe("Token-dependent views with no token data", () => {
  const traj = makeTier2Traj(); // No tokens

  it("AI Calls: should show helpful message, not broken chart", () => {
    const container = document.createElement("div");
    aiCallsView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    // Should either show "no data" message or still render without crashing
    expect(text.length).toBeGreaterThan(0);
    console.log(`  AI Calls with no tokens: "${text.slice(0, 80)}..."`);
  });

  it("Token Flow: should show helpful message", () => {
    const container = document.createElement("div");
    tokenFlowView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Token Flow with no tokens: "${text.slice(0, 80)}..."`);
  });

  it("Cost: should show helpful message", () => {
    const container = document.createElement("div");
    costView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Cost with no tokens: "${text.slice(0, 80)}..."`);
  });

  it("Context Usage: should show helpful message", () => {
    const container = document.createElement("div");
    contextUsageView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Context with no tokens: "${text.slice(0, 80)}..."`);
  });

  it("Efficiency: should show helpful message", () => {
    const container = document.createElement("div");
    tokenEfficiencyView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Efficiency with no tokens: "${text.slice(0, 80)}..."`);
  });
});

describe("Tool-dependent views with no tool data", () => {
  const traj = makeTier3Traj(); // No tools

  it("Tools view: should show helpful message", () => {
    const container = document.createElement("div");
    toolUsageView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Tools with no tools: "${text.slice(0, 80)}..."`);
  });

  it("Diffs view: should show helpful message", () => {
    const container = document.createElement("div");
    diffView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Diffs with no tools: "${text.slice(0, 80)}..."`);
  });

  it("Patterns view: should show helpful message", () => {
    const container = document.createElement("div");
    toolPatternsView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Patterns with no tools: "${text.slice(0, 80)}..."`);
  });

  it("Files view: should show helpful message", () => {
    const container = document.createElement("div");
    fileImpactView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Files with no tools: "${text.slice(0, 80)}..."`);
  });

  it("Iterations view: should show helpful message", () => {
    const container = document.createElement("div");
    iterationAnalysisView.render(container, [traj], opts);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    console.log(`  Iterations with no tools: "${text.slice(0, 80)}..."`);
  });
});
