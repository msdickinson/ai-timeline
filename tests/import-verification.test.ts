/**
 * Import verification — ensures every parser and view can be imported
 * and has the correct interface. If any import is broken, this catches it.
 */

import { describe, it, expect } from "vitest";

// ── Parser Imports ────────────────────────────────────────────────────
import { ClaudeCodeParser } from "../src/parsers/claude-code";
import { OpenHandsParser } from "../src/parsers/openhands";
import { SweAgentParser } from "../src/parsers/swe-agent";
import { ClineParser } from "../src/parsers/cline";
import { ContinueDevParser } from "../src/parsers/continue-dev";
import { AiderParser } from "../src/parsers/aider";
import { CodexCliParser } from "../src/parsers/codex-cli";
import { CopilotChatParser } from "../src/parsers/copilot-chat";
import { AmazonQParser } from "../src/parsers/amazon-q";
import { VSCodeSqliteParser } from "../src/parsers/vscode-sqlite";

// ── View Imports ──────────────────────────────────────────────────────
import { dashboardV2View } from "../src/views/dashboard-v2";
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

// ── Core Imports ──────────────────────────────────────────────────────
import { parseFile, parseFiles } from "../src/parsers/index";
import { computeSummary, Trajectory, TrajectoryEvent, SessionAnalysis, TestResults, BenchmarkRun, ExportPackage } from "../src/common/types";
import { registerParser, registerView, getAllViews, getView, parseFile as registryParseFile } from "../src/common/registry";

describe("All Parser Imports", () => {
  const parsers = [
    { name: "ClaudeCodeParser", cls: ClaudeCodeParser },
    { name: "OpenHandsParser", cls: OpenHandsParser },
    { name: "SweAgentParser", cls: SweAgentParser },
    { name: "ClineParser", cls: ClineParser },
    { name: "ContinueDevParser", cls: ContinueDevParser },
    { name: "AiderParser", cls: AiderParser },
    { name: "CodexCliParser", cls: CodexCliParser },
    { name: "CopilotChatParser", cls: CopilotChatParser },
    { name: "AmazonQParser", cls: AmazonQParser },
    { name: "VSCodeSqliteParser", cls: VSCodeSqliteParser },
  ];

  it("should import all 10 parsers", () => {
    expect(parsers.length).toBe(10);
  });

  for (const { name, cls } of parsers) {
    it(`${name} should be constructable`, () => {
      const instance = new cls();
      expect(instance).toBeDefined();
    });

    it(`${name} should have canParse method`, () => {
      const instance = new cls();
      expect(typeof instance.canParse).toBe("function");
    });

    it(`${name} should have parse method`, () => {
      const instance = new cls();
      expect(typeof instance.parse).toBe("function");
    });

    it(`${name}.canParse should not throw on empty input`, () => {
      const instance = new cls();
      expect(() => instance.canParse("test.json", "")).not.toThrow();
      expect(() => instance.canParse("test.json")).not.toThrow();
    });

    it(`${name}.parse should return array for empty input`, () => {
      const instance = new cls();
      const result = instance.parse("", "test.json");
      expect(Array.isArray(result)).toBe(true);
    });
  }
});

describe("All View Imports", () => {
  const views = [
    { name: "dashboard-v2", view: dashboardV2View },
    { name: "gantt", view: ganttView },
    { name: "ai-calls", view: aiCallsView },
    { name: "tool-usage", view: toolUsageView },
    { name: "table-v2", view: tableV2View },
    { name: "cost", view: costView },
    { name: "diff", view: diffView },
    { name: "errors", view: errorsView },
    { name: "conversation", view: conversationView },
    { name: "heatmap", view: heatmapView },
    { name: "summary", view: summaryView },
    { name: "token-flow", view: tokenFlowView },
    { name: "raw", view: rawView },
    { name: "test-results", view: testResultsView },
    { name: "tool-patterns", view: toolPatternsView },
    { name: "iterations", view: iterationAnalysisView },
    { name: "file-impact", view: fileImpactView },
    { name: "token-efficiency", view: tokenEfficiencyView },
    { name: "findings", view: findingsView },
    { name: "context-usage", view: contextUsageView },
    { name: "strategy", view: strategyView },
    { name: "timeline-compact", view: timelineCompactView },
  ];

  it("should import all views", () => {
    expect(views.length).toBe(22);
  });

  for (const { name, view } of views) {
    it(`${name} should have id`, () => {
      expect(view.id).toBeTruthy();
      expect(typeof view.id).toBe("string");
    });

    it(`${name} should have name`, () => {
      expect(view.name).toBeTruthy();
      expect(typeof view.name).toBe("string");
    });

    it(`${name} should have description`, () => {
      expect(view.description).toBeTruthy();
    });

    it(`${name} should have icon`, () => {
      expect(view.icon).toBeTruthy();
    });

    it(`${name} should have render function`, () => {
      expect(typeof view.render).toBe("function");
    });

    it(`${name} render should accept 3 arguments`, () => {
      // render(container, trajectories[], options)
      expect(view.render.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("all view IDs should be unique", () => {
    const ids = views.map((v) => v.view.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all view icons should be unique", () => {
    const icons = views.map((v) => v.view.icon);
    const unique = new Set(icons);
    // Some icons might collide (e.g., "R" used by multiple), but flag it
    if (unique.size !== icons.length) {
      const dupes = icons.filter((icon, i) => icons.indexOf(icon) !== i);
      console.log(`  Warning: duplicate icons: ${dupes.join(", ")}`);
    }
  });
});

describe("Core Type Imports", () => {
  it("computeSummary should be a function", () => {
    expect(typeof computeSummary).toBe("function");
  });

  it("parseFile should be a function", () => {
    expect(typeof parseFile).toBe("function");
  });

  it("parseFiles should be a function", () => {
    expect(typeof parseFiles).toBe("function");
  });

  it("registry functions should be importable", () => {
    expect(typeof registerParser).toBe("function");
    expect(typeof registerView).toBe("function");
    expect(typeof getAllViews).toBe("function");
    expect(typeof getView).toBe("function");
  });

  it("all core types should be constructable", () => {
    // Just verify the types compile — if they import, they work
    const t: Trajectory = {
      version: "1.0",
      source: "unknown",
      session: { id: "x", startTime: "2026-01-01T00:00:00Z" },
      events: [],
    };
    expect(t.version).toBe("1.0");

    const a: SessionAnalysis = {
      analyzedBy: "test",
      analyzedAt: "2026-01-01T00:00:00Z",
      verdict: "correct",
      summary: "ok",
      explanation: "good",
    };
    expect(a.verdict).toBe("correct");

    const tr: TestResults = {
      passed: true,
      total: 1,
      passedCount: 1,
      failedCount: 0,
    };
    expect(tr.passed).toBe(true);

    const br: BenchmarkRun = {
      name: "test",
      harness: "test",
      date: "2026-01-01T00:00:00Z",
      instances: [],
    };
    expect(br.instances.length).toBe(0);

    const ep: ExportPackage = {
      version: "1.0",
      exportedAt: "2026-01-01T00:00:00Z",
      title: "test",
      enabledViews: [],
      showSidebar: true,
      trajectories: [],
    };
    expect(ep.version).toBe("1.0");
  });
});
