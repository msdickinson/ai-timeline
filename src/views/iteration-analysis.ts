/**
 * Iteration Analysis View — detect edit-test-fix cycles, count retries, track wasted work.
 * Shows each iteration with what changed, test output, and agent decisions.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

interface Iteration {
  index: number;
  events: TrajectoryEvent[];
  editFiles: string[];
  testOutput: string | null;
  testPassed: boolean | null;
  wasReverted: boolean;
  startTime: string;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function fmtDur(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function extractFilePath(args: Record<string, unknown> | string | undefined): string | null {
  if (!args) return null;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return null; }
  }
  const obj = args as Record<string, unknown>;
  return (obj.file_path ?? obj.path ?? obj.filepath ?? obj.file ?? null) as string | null;
}

function isEditTool(name: string): boolean {
  const n = name.toLowerCase().replace(/^mcp__\w+__/, "");
  return ["edit", "editfile", "editlines", "write", "writefile"].some((t) => n.includes(t));
}

function isTestTool(name: string, content?: string): boolean {
  const n = name.toLowerCase().replace(/^mcp__\w+__/, "");
  if (["runtests", "npmtest", "runpythontests", "buildproject"].some((t) => n.includes(t))) return true;
  if (n === "bash" || n === "executecommand") {
    const c = (content ?? "").toLowerCase();
    return c.includes("test") || c.includes("pytest") || c.includes("jest") || c.includes("dotnet test") || c.includes("npm test") || c.includes("cargo test");
  }
  return false;
}

function detectIterations(events: TrajectoryEvent[]): Iteration[] {
  const iterations: Iteration[] = [];
  let current: TrajectoryEvent[] = [];
  let currentEdits: string[] = [];
  let iterIdx = 0;

  // Pre-build O(1) lookup: tool_call ID → result event
  const toolResultMap = new Map<number, TrajectoryEvent>();
  for (const e of events) {
    if (e.type === "tool_result" && e.toolResult?.toolCallEventId != null) {
      toolResultMap.set(e.toolResult.toolCallEventId, e);
    }
  }

  for (const ev of events) {
    current.push(ev);

    if (ev.type === "tool_call" && ev.toolCall) {
      if (isEditTool(ev.toolCall.name)) {
        const fp = extractFilePath(ev.toolCall.arguments as Record<string, unknown>);
        if (fp && !currentEdits.includes(fp)) currentEdits.push(fp);
      }

      const argStr = typeof ev.toolCall.arguments === "string"
        ? ev.toolCall.arguments
        : JSON.stringify(ev.toolCall.arguments ?? {});

      if (isTestTool(ev.toolCall.name, argStr) && currentEdits.length > 0) {
        const resultEv = toolResultMap.get(ev.id);
        const testOutput = resultEv?.toolResult?.output ?? null;
        const isError = resultEv?.toolResult?.isError ?? false;
        const outputLower = (testOutput ?? "").toLowerCase();
        const testPassed = testOutput
          ? !isError && !outputLower.includes("fail") && !outputLower.includes("error") && !outputLower.includes("exception")
          : null;

        iterations.push({
          index: iterIdx++,
          events: [...current],
          editFiles: [...currentEdits],
          testOutput: testOutput ? testOutput.slice(0, 2000) : null,
          testPassed,
          wasReverted: false,
          startTime: current[0]?.timestamp ?? "",
        });
        current = [];
        currentEdits = [];
      }
    }
  }

  // Mark reverted iterations: if same file is edited again after a failure
  const allEditedFiles = new Map<string, number[]>();
  for (const iter of iterations) {
    for (const f of iter.editFiles) {
      if (!allEditedFiles.has(f)) allEditedFiles.set(f, []);
      allEditedFiles.get(f)!.push(iter.index);
    }
  }
  for (const iter of iterations) {
    if (iter.testPassed === false) {
      const hasLaterEdit = iter.editFiles.some((f) => {
        const indices = allEditedFiles.get(f) ?? [];
        return indices.some((i) => i > iter.index);
      });
      if (hasLaterEdit) iter.wasReverted = true;
    }
  }

  return iterations;
}

export const iterationAnalysisView: TrajectoryView = {
  id: "iterations",
  name: "Iterations",
  description: "Edit-test-fix cycle detection, retry counts, and wasted work analysis",
  icon: "I",
  tier: "advanced",
  requires: ["tools"],

  css: `
    .ia { font-family: var(--tv-font); }
    .ia-section { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 16px 20px; margin-bottom: 14px; }
    .ia-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    .ia-subtitle { font-size: 13px; font-weight: 600; color: var(--tv-text-secondary); margin-bottom: 8px; }
    .ia-stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .ia-stat { background: var(--tv-bg); border: 1px solid var(--tv-border); border-radius: var(--tv-radius-sm); padding: 10px 16px; min-width: 100px; }
    .ia-stat-label { font-size: 11px; color: var(--tv-text-muted); }
    .ia-stat-val { font-size: 22px; font-weight: 700; font-family: var(--tv-mono); }
    .ia-stat-val.ia-good { color: #48bb78; }
    .ia-stat-val.ia-warn { color: #ed8936; }
    .ia-stat-val.ia-bad { color: var(--tv-error); }
    .ia-iter { border: 1px solid var(--tv-border); border-radius: var(--tv-radius-sm); padding: 12px 16px; margin-bottom: 8px; cursor: pointer; }
    .ia-iter:hover { background: var(--tv-bg-hover); }
    .ia-iter-header { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .ia-iter-num { font-weight: 700; font-family: var(--tv-mono); min-width: 32px; }
    .ia-iter-badge { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
    .ia-iter-pass { background: #c6f6d5; color: #22543d; }
    .ia-iter-fail { background: #fed7d7; color: #9b2c2c; }
    .ia-iter-revert { background: #fefcbf; color: #744210; }
    .ia-iter-unknown { background: var(--tv-bg); color: var(--tv-text-muted); }
    .ia-iter-files { font-size: 12px; color: var(--tv-text-secondary); font-family: var(--tv-mono); }
    .ia-iter-detail { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--tv-border); display: none; }
    .ia-iter-detail.ia-open { display: block; }
    .ia-iter-output { font-family: var(--tv-mono); font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; background: var(--tv-bg); padding: 8px; border-radius: 4px; color: var(--tv-text-secondary); margin-top: 6px; }
    .ia-rate-bar { display: flex; gap: 2px; margin-bottom: 6px; }
    .ia-rate-seg { height: 24px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #fff; border-radius: 3px; }
    .ia-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    container.classList.add("ia");

    const allIterations: Iteration[] = [];
    for (const traj of trajectories) {
      allIterations.push(...detectIterations(traj.events));
    }

    if (allIterations.length === 0) {
      const empty = el("div", "ia-empty");
      empty.textContent = "No edit-test-fix cycles detected. This view requires tool calls that edit files followed by test/build commands.";
      container.appendChild(empty);
      return;
    }

    // --- Summary Stats ---
    const statsSection = el("div", "ia-section");
    const statsTitle = el("div", "ia-title");
    statsTitle.textContent = "Iteration Summary";
    statsSection.appendChild(statsTitle);

    const totalIter = allIterations.length;
    const passed = allIterations.filter((i) => i.testPassed === true).length;
    const failed = allIterations.filter((i) => i.testPassed === false).length;
    const wasted = allIterations.filter((i) => i.wasReverted).length;
    const firstTrySuccess = allIterations.length > 0 && allIterations[0].testPassed === true ? 1 : 0;

    const stats = el("div", "ia-stats");
    const statItems: Array<{ label: string; value: string; cls: string }> = [
      { label: "Total Cycles", value: String(totalIter), cls: "" },
      { label: "Passed", value: String(passed), cls: "ia-good" },
      { label: "Failed", value: String(failed), cls: failed > 0 ? "ia-bad" : "" },
      { label: "Wasted", value: String(wasted), cls: wasted > 0 ? "ia-warn" : "" },
      { label: "Success Rate", value: `${totalIter > 0 ? Math.round((passed / totalIter) * 100) : 0}%`, cls: passed / totalIter > 0.5 ? "ia-good" : "ia-warn" },
    ];
    for (const s of statItems) {
      const item = el("div", "ia-stat");
      const lbl = el("div", "ia-stat-label");
      lbl.textContent = s.label;
      const val = el("div", `ia-stat-val ${s.cls}`);
      val.textContent = s.value;
      item.appendChild(lbl);
      item.appendChild(val);
      stats.appendChild(item);
    }
    statsSection.appendChild(stats);
    container.appendChild(statsSection);

    // --- Success Rate by Iteration Number ---
    const rateSection = el("div", "ia-section");
    const rateTitle = el("div", "ia-title");
    rateTitle.textContent = "Success Rate by Attempt";
    rateSection.appendChild(rateTitle);

    // Group by iteration index (1st try, 2nd try, etc.)
    const maxIdx = Math.min(Math.max(...allIterations.map((i) => i.index)) + 1, 10);
    for (let idx = 0; idx < maxIdx; idx++) {
      const atIdx = allIterations.filter((i) => i.index === idx);
      if (atIdx.length === 0) continue;
      const passCount = atIdx.filter((i) => i.testPassed === true).length;
      const failCount = atIdx.filter((i) => i.testPassed === false).length;
      const unkCount = atIdx.length - passCount - failCount;
      const row = el("div", "");
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px;";

      const label = el("span", "");
      label.style.cssText = "min-width:80px;font-family:var(--tv-mono);font-weight:600;";
      label.textContent = `Attempt ${idx + 1}`;
      row.appendChild(label);

      const bar = el("div", "ia-rate-bar");
      bar.style.flex = "1";
      if (passCount > 0) {
        const seg = el("div", "ia-rate-seg");
        seg.style.cssText = `flex:${passCount};background:#48bb78;`;
        seg.textContent = `${passCount}`;
        bar.appendChild(seg);
      }
      if (failCount > 0) {
        const seg = el("div", "ia-rate-seg");
        seg.style.cssText = `flex:${failCount};background:var(--tv-error);`;
        seg.textContent = `${failCount}`;
        bar.appendChild(seg);
      }
      if (unkCount > 0) {
        const seg = el("div", "ia-rate-seg");
        seg.style.cssText = `flex:${unkCount};background:#a0aec0;`;
        seg.textContent = `${unkCount}`;
        bar.appendChild(seg);
      }
      row.appendChild(bar);

      const pct = el("span", "");
      pct.style.cssText = "min-width:40px;text-align:right;font-family:var(--tv-mono);";
      pct.textContent = `${atIdx.length > 0 ? Math.round((passCount / atIdx.length) * 100) : 0}%`;
      row.appendChild(pct);
      rateSection.appendChild(row);
    }
    container.appendChild(rateSection);

    // --- Iteration List ---
    const listSection = el("div", "ia-section");
    const listTitle = el("div", "ia-title");
    listTitle.textContent = `All Iterations (${allIterations.length})`;
    listSection.appendChild(listTitle);

    for (const iter of allIterations) {
      const card = el("div", "ia-iter");
      const header = el("div", "ia-iter-header");

      const num = el("span", "ia-iter-num");
      num.textContent = `#${iter.index + 1}`;
      header.appendChild(num);

      const badge = el("span", "ia-iter-badge");
      if (iter.wasReverted) {
        badge.classList.add("ia-iter-revert");
        badge.textContent = "Reverted";
      } else if (iter.testPassed === true) {
        badge.classList.add("ia-iter-pass");
        badge.textContent = "Passed";
      } else if (iter.testPassed === false) {
        badge.classList.add("ia-iter-fail");
        badge.textContent = "Failed";
      } else {
        badge.classList.add("ia-iter-unknown");
        badge.textContent = "Unknown";
      }
      header.appendChild(badge);

      const fileSpan = el("span", "ia-iter-files");
      fileSpan.textContent = iter.editFiles.map((f) => f.split("/").pop() ?? f).join(", ");
      header.appendChild(fileSpan);

      if (iter.startTime) {
        const time = el("span", "");
        time.style.cssText = "font-size:11px;color:var(--tv-text-muted);margin-left:auto;";
        try {
          time.textContent = new Date(iter.startTime).toLocaleTimeString();
        } catch { /* skip */ }
        header.appendChild(time);
      }

      card.appendChild(header);

      // Expandable detail
      const detail = el("div", "ia-iter-detail");
      if (iter.editFiles.length > 0) {
        const filesLabel = el("div", "ia-subtitle");
        filesLabel.textContent = "Files edited:";
        detail.appendChild(filesLabel);
        for (const f of iter.editFiles) {
          const fp = el("div", "");
          fp.style.cssText = "font-family:var(--tv-mono);font-size:12px;color:var(--tv-text-secondary);padding-left:8px;";
          fp.textContent = f;
          detail.appendChild(fp);
        }
      }
      if (iter.testOutput) {
        const outLabel = el("div", "ia-subtitle");
        outLabel.style.marginTop = "8px";
        outLabel.textContent = "Test output:";
        detail.appendChild(outLabel);
        const output = el("div", "ia-iter-output");
        output.textContent = iter.testOutput;
        detail.appendChild(output);
      }
      card.appendChild(detail);

      card.addEventListener("click", () => {
        detail.classList.toggle("ia-open");
      });

      listSection.appendChild(card);
    }
    container.appendChild(listSection);
  },
};

