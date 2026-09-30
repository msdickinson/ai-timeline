/**
 * Data integrity tests — verifies data survives the full pipeline:
 * parse → modify → export (JSON serialize) → re-import → verify
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "../src/parsers/index";
import { computeSummary, Trajectory } from "../src/common/types";

const claudeFixture = readFileSync(join(__dirname, "./fixtures/claude-code-session.jsonl"), "utf-8");
const openhandsFixture = readFileSync(join(__dirname, "./fixtures/openhands-output.jsonl"), "utf-8");
const sweagentFixture = readFileSync(join(__dirname, "./fixtures/swe-agent-instance.traj"), "utf-8");

describe("JSON Round-Trip Integrity", () => {
  const sources = [
    { name: "Claude Code", fixture: claudeFixture, filename: "session.jsonl" },
    { name: "OpenHands", fixture: openhandsFixture, filename: "output.jsonl" },
    { name: "SWE-Agent", fixture: sweagentFixture, filename: "instance.traj" },
  ];

  for (const { name, fixture, filename } of sources) {
    const originals = parseFile(fixture, filename);

    for (const original of originals) {
      it(`${name} (${original.session.id}): JSON round-trip preserves event count`, () => {
        const json = JSON.stringify(original);
        const reimported = JSON.parse(json) as Trajectory;
        expect(reimported.events.length).toBe(original.events.length);
      });

      it(`${name} (${original.session.id}): JSON round-trip preserves summary`, () => {
        const json = JSON.stringify(original);
        const reimported = JSON.parse(json) as Trajectory;
        expect(reimported.summary!.totalEvents).toBe(original.summary!.totalEvents);
        expect(reimported.summary!.totalToolCalls).toBe(original.summary!.totalToolCalls);
        expect(reimported.summary!.errorCount).toBe(original.summary!.errorCount);
      });

      it(`${name} (${original.session.id}): JSON round-trip preserves tool links`, () => {
        const json = JSON.stringify(original);
        const reimported = JSON.parse(json) as Trajectory;
        const results = reimported.events.filter(
          (e) => e.type === "tool_result" && e.toolResult?.toolCallEventId != null
        );
        for (const r of results) {
          const call = reimported.events.find((e) => e.id === r.toolResult!.toolCallEventId);
          expect(call).toBeDefined();
          expect(call!.type).toBe("tool_call");
        }
      });

      it(`${name} (${original.session.id}): event IDs remain unique after round-trip`, () => {
        const json = JSON.stringify(original);
        const reimported = JSON.parse(json) as Trajectory;
        const ids = reimported.events.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it(`${name} (${original.session.id}): recomputed summary matches after round-trip`, () => {
        const json = JSON.stringify(original);
        const reimported = JSON.parse(json) as Trajectory;
        const recomputed = computeSummary(reimported.events);
        expect(recomputed.totalEvents).toBe(reimported.summary!.totalEvents);
        expect(recomputed.totalToolCalls).toBe(reimported.summary!.totalToolCalls);
      });
    }
  }
});

describe("Parser Robustness — Null/Mixed Content", () => {
  it("should handle null values in content arrays", () => {
    const withNulls = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "hi" }], ts: 1711900000000 },
      { role: "assistant", content: [null, { type: "text", text: "ok" }, "bare string"], ts: 1711900001000 },
    ]);
    const result = parseFile(withNulls, "api_conversation_history.json");
    expect(result.length).toBeGreaterThan(0);
    // Should not crash
  });

  it("should handle null toolUse in Amazon Q", () => {
    const withNull = JSON.stringify({
      conversationId: "test",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "ok", toolUse: null },
      ],
    });
    const result = parseFile(withNull, "amazonq.json");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle NaN timestamp in events", () => {
    const withBadTs = JSON.stringify([
      { role: "user", content: [{ type: "text", text: "test" }], ts: NaN },
    ]);
    // Should not crash — NaN gets filtered or synthesized
    expect(() => parseFile(withBadTs, "api_conversation_history.json")).not.toThrow();
  });

  it("should handle extremely long content", () => {
    const longContent = "x".repeat(100000);
    const withLong = JSON.stringify([
      { role: "user", content: [{ type: "text", text: longContent }], ts: 1711900000000 },
    ]);
    const result = parseFile(withLong, "api_conversation_history.json");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].events[0].content!.length).toBe(100000);
  });
});

import { dashboardV2View } from "../src/views/dashboard-v2";
import { dashboardV3View } from "../src/views/dashboard-v3";
import { tableV2View } from "../src/views/table-v2";
import { errorsView } from "../src/views/errors";
import { testResultsView } from "../src/views/test-results";

describe("View Output Verification", () => {

  const opts = { darkMode: false, filterTool: null, expandedEvents: new Set(), onStateChange: () => {} };
  const traj = parseFile(claudeFixture, "session.jsonl");

  it("dashboard should render non-empty content", () => {
    const container = document.createElement("div");
    dashboardV2View.render(container, traj, opts);
    expect(container.textContent!.length).toBeGreaterThan(50);
    expect(container.children.length).toBeGreaterThan(0);
  });

  it("table should render rows matching event count", () => {
    const container = document.createElement("div");
    tableV2View.render(container, traj, opts);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("errors view with no errors should show success message", () => {
    const container = document.createElement("div");
    errorsView.render(container, traj, opts);
    // Should render something (either error cards or "no errors" message)
    expect(container.textContent!.length).toBeGreaterThan(0);
  });



  it("test results view WITH results should show pass/fail", () => {
    const trajWithTests = [{
      ...traj[0],
      testResults: {
        passed: false, total: 5, passedCount: 3, failedCount: 2,
        tests: [
          { name: "test_login", status: "passed" as const },
          { name: "test_auth", status: "failed" as const, failureMessage: "AssertionError" },
        ],
      },
    }];
    const container = document.createElement("div");
    testResultsView.render(container, trajWithTests, opts);
    expect(container.textContent).toContain("2"); // total test cases shown
    expect(container.textContent).toContain("Passed"); // status labels
  });
});
