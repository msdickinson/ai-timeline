/**
 * Test Results View — shows unit test pass/fail from the session.
 * TicketForge stores full test output; other tools may have partial data
 * from tool_result events that contain test output.
 */

import { Trajectory, TestCase } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

export const testResultsView: TrajectoryView = {
  id: "test-results",
  name: "Tests",
  description: "Unit test results — pass/fail, individual test cases, failure details",
  icon: "T",
  tier: "advanced",
  requires: ["testResults"],

  css: `
    .ttr { font-family: var(--tv-font); }
    .ttr-summary {
      display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px;
    }
    .ttr-stat {
      background: var(--tv-bg-card); border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius); padding: 16px 24px; text-align: center;
      min-width: 100px;
    }
    .ttr-stat-value { font-size: 28px; font-weight: 700; }
    .ttr-stat-label { font-size: 11px; color: var(--tv-text-secondary); text-transform: uppercase; }
    .ttr-pass-bar {
      height: 8px; border-radius: 4px; background: var(--tv-border); overflow: hidden;
      margin-bottom: 20px; display: flex;
    }
    .ttr-pass-seg { height: 100%; }
    .ttr-green { color: #48bb78; }
    .ttr-red { color: #fc5c65; }
    .ttr-yellow { color: #f7b731; }
    .ttr-filters {
      display: flex; gap: 4px; margin-bottom: 12px;
    }
    .ttr-filter-btn {
      padding: 4px 12px; font-size: 12px; border: 1px solid var(--tv-border);
      border-radius: 4px; background: var(--tv-bg); color: var(--tv-text-secondary);
      cursor: pointer;
    }
    .ttr-filter-btn:hover { background: var(--tv-bg-hover); }
    .ttr-filter-active { background: var(--tv-accent); color: #fff; border-color: var(--tv-accent); }
    .ttr-test {
      background: var(--tv-bg-card); border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius-sm); padding: 10px 16px; margin-bottom: 4px;
      cursor: pointer;
    }
    .ttr-test:hover { background: var(--tv-bg-hover); }
    .ttr-test-header { display: flex; align-items: center; gap: 8px; }
    .ttr-test-badge {
      font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 3px;
    }
    .ttr-badge-passed { background: #d1fae5; color: #065f46; }
    .ttr-badge-failed { background: #fee2e2; color: #991b1b; }
    .ttr-badge-skipped { background: #fef3c7; color: #92400e; }
    .ttr-badge-error { background: #fee2e2; color: #991b1b; }
    .ttr-test-name { font-family: var(--tv-mono); font-size: 13px; font-weight: 500; }
    .ttr-test-suite { font-size: 11px; color: var(--tv-text-muted); }
    .ttr-test-dur { font-size: 11px; color: var(--tv-text-muted); margin-left: auto; font-family: var(--tv-mono); }
    .ttr-test-detail {
      margin-top: 8px; padding: 10px; background: var(--tv-bg); border-radius: var(--tv-radius-sm);
      font-family: var(--tv-mono); font-size: 11px; white-space: pre-wrap; color: var(--tv-error);
      max-height: 200px; overflow-y: auto;
    }
    .ttr-raw {
      background: var(--tv-bg-card); border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius); padding: 16px; margin-top: 16px;
    }
    .ttr-raw-output {
      font-family: var(--tv-mono); font-size: 11px; white-space: pre-wrap;
      color: var(--tv-text-secondary); max-height: 400px; overflow-y: auto;
    }
    .ttr-empty {
      padding: 40px; text-align: center; color: var(--tv-text-muted);
    }
    .ttr-inferred { font-size: 12px; color: var(--tv-text-muted); margin-bottom: 12px; font-style: italic; }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("ttr");

    // Collect test results: prefer explicit testResults, fall back to inferring from events
    const allResults = trajectories.map((t) => ({
      traj: t,
      results: t.testResults ?? inferTestResults(t),
    }));

    const hasAnyData = allResults.some((r) => r.results != null);
    if (!hasAnyData) {
      container.innerHTML = '<div class="ttr-empty">No test results found in selected sessions.<br>Test data comes from testResults field or tool outputs containing test output.</div>';
      return;
    }

    for (const { traj, results } of allResults) {
      if (!results) continue;
      container.appendChild(renderSessionTests(traj, results));
    }
  },
};

function renderSessionTests(traj: Trajectory, results: import("../common/types").TestResults): HTMLElement {
  const section = el("div", "");

  if (results.tests && results.tests.length > 0) {
    // Has individual test cases
    const passed = results.tests.filter((t) => t.status === "passed");
    const failed = results.tests.filter((t) => t.status === "failed" || t.status === "error");
    const skipped = results.tests.filter((t) => t.status === "skipped");

    // Summary stats
    const summary = el("div", "ttr-summary");
    const stats = [
      { value: results.tests.length, label: "Total", cls: "" },
      { value: passed.length, label: "Passed", cls: "ttr-green" },
      { value: failed.length, label: "Failed", cls: "ttr-red" },
      { value: skipped.length, label: "Skipped", cls: "ttr-yellow" },
    ];
    for (const s of stats) {
      const card = el("div", "ttr-stat");
      const val = el("div", `ttr-stat-value ${s.cls}`);
      val.textContent = s.value.toString();
      const label = el("div", "ttr-stat-label");
      label.textContent = s.label;
      card.appendChild(val);
      card.appendChild(label);
      summary.appendChild(card);
    }
    if (results.framework) {
      const fw = el("div", "ttr-stat");
      const val = el("div", "ttr-stat-value");
      val.textContent = results.framework;
      val.style.fontSize = "16px";
      const label = el("div", "ttr-stat-label");
      label.textContent = "Framework";
      fw.appendChild(val);
      fw.appendChild(label);
      summary.appendChild(fw);
    }
    section.appendChild(summary);

    // Pass bar
    const bar = el("div", "ttr-pass-bar");
    const total = results.tests.length || 1;
    const greenSeg = el("div", "ttr-pass-seg");
    greenSeg.style.width = `${(passed.length / total) * 100}%`;
    greenSeg.style.background = "#48bb78";
    const redSeg = el("div", "ttr-pass-seg");
    redSeg.style.width = `${(failed.length / total) * 100}%`;
    redSeg.style.background = "#fc5c65";
    const yellowSeg = el("div", "ttr-pass-seg");
    yellowSeg.style.width = `${(skipped.length / total) * 100}%`;
    yellowSeg.style.background = "#f7b731";
    bar.appendChild(greenSeg);
    bar.appendChild(redSeg);
    bar.appendChild(yellowSeg);
    section.appendChild(bar);

    // Filter
    let filter: string | null = null;
    const filters = el("div", "ttr-filters");
    const filterOpts = [
      { label: `All (${results.tests.length})`, value: null },
      { label: `Failed (${failed.length})`, value: "failed" },
      { label: `Passed (${passed.length})`, value: "passed" },
      { label: `Skipped (${skipped.length})`, value: "skipped" },
    ];

    const testList = el("div", "");

    function renderTests() {
      testList.innerHTML = "";
      const filtered = filter
        ? results.tests!.filter((t) => t.status === filter || (filter === "failed" && t.status === "error"))
        : results.tests!;

      for (const tc of filtered) {
        const row = el("div", "ttr-test");
        const header = el("div", "ttr-test-header");
        const badge = el("span", `ttr-test-badge ttr-badge-${tc.status}`);
        badge.textContent = tc.status.toUpperCase();
        header.appendChild(badge);
        const name = el("span", "ttr-test-name");
        name.textContent = tc.name;
        header.appendChild(name);
        if (tc.suite) {
          const suite = el("span", "ttr-test-suite");
          suite.textContent = tc.suite;
          header.appendChild(suite);
        }
        if (tc.durationMs != null) {
          const dur = el("span", "ttr-test-dur");
          dur.textContent = `${tc.durationMs}ms`;
          header.appendChild(dur);
        }
        row.appendChild(header);

        if (tc.failureMessage || tc.stackTrace) {
          let expanded = false;
          row.onclick = () => {
            expanded = !expanded;
            const existing = row.querySelector(".ttr-test-detail");
            if (existing) { existing.remove(); return; }
            const detail = el("div", "ttr-test-detail");
            detail.textContent = (tc.failureMessage ?? "") + (tc.stackTrace ? "\n\n" + tc.stackTrace : "");
            row.appendChild(detail);
          };
        }

        testList.appendChild(row);
      }
    }

    for (const opt of filterOpts) {
      const btn = el("button", `ttr-filter-btn ${filter === opt.value ? "ttr-filter-active" : ""}`);
      btn.textContent = opt.label;
      btn.onclick = () => {
        filter = opt.value;
        filters.querySelectorAll(".ttr-filter-btn").forEach((b) => b.classList.remove("ttr-filter-active"));
        btn.classList.add("ttr-filter-active");
        renderTests();
      };
      filters.appendChild(btn);
    }
    section.appendChild(filters);
    renderTests();
    section.appendChild(testList);
  } else {
    // No individual tests — show summary + raw
    const summary = el("div", "ttr-summary");
    const passCard = el("div", "ttr-stat");
    const passVal = el("div", `ttr-stat-value ${results.passed ? "ttr-green" : "ttr-red"}`);
    passVal.textContent = results.passed ? "PASSED" : "FAILED";
    const passLabel = el("div", "ttr-stat-label");
    passLabel.textContent = `${results.passedCount}/${results.total} tests`;
    passCard.appendChild(passVal);
    passCard.appendChild(passLabel);
    summary.appendChild(passCard);
    section.appendChild(summary);
  }

  // Raw output
  if (results.rawOutput) {
    const raw = el("div", "ttr-raw");
    const rawLabel = el("div", "ttr-stat-label");
    rawLabel.textContent = "RAW TEST OUTPUT";
    rawLabel.style.marginBottom = "8px";
    raw.appendChild(rawLabel);
    const rawOut = el("div", "ttr-raw-output");
    rawOut.textContent = results.rawOutput;
    raw.appendChild(rawOut);
    section.appendChild(raw);
  }

  return section;
}

/** Try to infer test results from tool_result events containing test output */
function inferTestResults(traj: Trajectory): import("../common/types").TestResults | null {
  const testEvents = traj.events.filter(
    (e) => e.type === "tool_result" && e.toolResult?.output &&
    (e.toolResult.output.includes("passed") || e.toolResult.output.includes("failed") || e.toolResult.output.includes("PASS") || e.toolResult.output.includes("FAIL"))
  );

  if (testEvents.length === 0) return null;

  // Try to parse test counts from output
  for (const e of testEvents) {
    const output = e.toolResult!.output!;

    // Jest/Vitest: "Tests: 5 passed, 2 failed"
    const jestMatch = output.match(/Tests?:\s*(\d+)\s*passed(?:.*?(\d+)\s*failed)?/i);
    if (jestMatch) {
      const passed = parseInt(jestMatch[1]);
      const failed = parseInt(jestMatch[2] ?? "0");
      return {
        passed: failed === 0,
        total: passed + failed,
        passedCount: passed,
        failedCount: failed,
        rawOutput: output,
        framework: "jest/vitest",
      };
    }

    // Pytest: "5 passed, 2 failed" or "5 passed in 1.2s"
    const pytestMatch = output.match(/(\d+)\s*passed(?:.*?(\d+)\s*failed)?/i);
    if (pytestMatch) {
      const passed = parseInt(pytestMatch[1]);
      const failed = parseInt(pytestMatch[2] ?? "0");
      return {
        passed: failed === 0,
        total: passed + failed,
        passedCount: passed,
        failedCount: failed,
        rawOutput: output,
        framework: "pytest",
      };
    }

    // .NET: "Passed! - Failed: 0, Passed: 12, Skipped: 0, Total: 12"
    const dotnetMatch = output.match(/Passed:\s*(\d+).*Failed:\s*(\d+).*Total:\s*(\d+)/i);
    if (dotnetMatch) {
      const passed = parseInt(dotnetMatch[1]);
      const failed = parseInt(dotnetMatch[2]);
      const total = parseInt(dotnetMatch[3]);
      return {
        passed: failed === 0,
        total,
        passedCount: passed,
        failedCount: failed,
        rawOutput: output,
        framework: "dotnet",
      };
    }
  }

  return null;
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
