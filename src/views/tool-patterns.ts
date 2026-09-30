/**
 * Tool Patterns View — analyze tool call sequences, transitions, and strategy fingerprints.
 * Shows bigram transition matrix, common sequences, and phase detection.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

const PHASES: Record<string, string[]> = {
  exploration: ["Read", "ReadFile", "ReadFileRange", "Grep", "Glob", "SearchFiles", "ListFiles", "GitLog", "GitDiff", "GitBlame", "GitStatus"],
  editing: ["Edit", "EditFile", "EditLines", "Write", "WriteFile"],
  validation: ["Bash", "ExecuteCommand", "RunTests", "BuildProject", "NpmTest", "RunPythonTests"],
};

function classifyTool(name: string): string {
  const base = name.replace(/^mcp__\w+__/, "");
  for (const [phase, tools] of Object.entries(PHASES)) {
    if (tools.some((t) => base.toLowerCase().includes(t.toLowerCase()))) return phase;
  }
  return "other";
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function esc(s: string): string {
  const d = document.createElement("span");
  d.textContent = s;
  return d.innerHTML;
}

function getToolCalls(trajectories: Trajectory[]): string[] {
  return trajectories.flatMap((t) =>
    t.events.filter((e) => e.type === "tool_call").map((e) => e.toolCall?.name ?? "unknown")
  );
}

export const toolPatternsView: TrajectoryView = {
  id: "tool-patterns",
  name: "Patterns",
  description: "Tool call sequences, transition matrix, and strategy fingerprints",
  icon: "P",
  tier: "standard",
  requires: ["tools"],

  css: `
    .tp { font-family: var(--tv-font); }
    .tp-section { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 16px 20px; margin-bottom: 14px; }
    .tp-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    .tp-subtitle { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--tv-text-secondary); }
    .tp-seq { display: flex; align-items: center; gap: 4px; padding: 6px 0; border-bottom: 1px solid var(--tv-border); font-size: 13px; font-family: var(--tv-mono); }
    .tp-seq:last-child { border-bottom: none; }
    .tp-seq-count { min-width: 40px; font-weight: 700; color: var(--tv-accent); text-align: right; margin-right: 8px; }
    .tp-seq-arrow { color: var(--tv-text-muted); }
    .tp-matrix { width: 100%; border-collapse: collapse; font-size: 11px; font-family: var(--tv-mono); }
    .tp-matrix th, .tp-matrix td { padding: 4px 6px; text-align: center; border: 1px solid var(--tv-border); }
    .tp-matrix th { background: var(--tv-bg); font-weight: 600; position: sticky; top: 0; }
    .tp-matrix td.tp-hot { font-weight: 700; }
    .tp-matrix-wrap { max-height: 400px; overflow: auto; }
    .tp-phase-bar { display: flex; height: 28px; border-radius: 4px; overflow: hidden; margin-bottom: 4px; }
    .tp-phase-seg { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #fff; min-width: 2px; }
    .tp-phase-legend { display: flex; gap: 16px; font-size: 12px; margin-top: 6px; flex-wrap: wrap; }
    .tp-phase-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
    .tp-fp { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
    .tp-fp-item { background: var(--tv-bg); border: 1px solid var(--tv-border); border-radius: var(--tv-radius-sm); padding: 8px 14px; font-size: 13px; }
    .tp-fp-label { font-size: 11px; color: var(--tv-text-muted); }
    .tp-fp-val { font-size: 18px; font-weight: 700; font-family: var(--tv-mono); }
    .tp-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    container.classList.add("tp");
    const toolNames = getToolCalls(trajectories);

    if (toolNames.length === 0) {
      const empty = el("div", "tp-empty");
      empty.textContent = "No tool calls found in selected sessions.";
      container.appendChild(empty);
      return;
    }

    // --- Strategy Fingerprint ---
    const fpSection = el("div", "tp-section");
    const fpTitle = el("div", "tp-title");
    fpTitle.textContent = "Strategy Fingerprint";
    fpSection.appendChild(fpTitle);

    const phaseCounts: Record<string, number> = { exploration: 0, editing: 0, validation: 0, other: 0 };
    for (const t of toolNames) phaseCounts[classifyTool(t)]++;
    const total = toolNames.length;

    const fpRow = el("div", "tp-fp");
    for (const [phase, count] of Object.entries(phaseCounts)) {
      if (count === 0) continue;
      const item = el("div", "tp-fp-item");
      const lbl = el("div", "tp-fp-label");
      lbl.textContent = phase.charAt(0).toUpperCase() + phase.slice(1);
      const val = el("div", "tp-fp-val");
      val.textContent = `${Math.round((count / total) * 100)}%`;
      item.appendChild(lbl);
      item.appendChild(val);
      fpRow.appendChild(item);
    }
    fpSection.appendChild(fpRow);

    // Explore-first vs jump-to-edit detection
    const firstEditIdx = toolNames.findIndex((t) => classifyTool(t) === "editing");
    const exploreBeforeEdit = firstEditIdx > 0 ? toolNames.slice(0, firstEditIdx).filter((t) => classifyTool(t) === "exploration").length : 0;
    const stratLabel = el("div", "tp-subtitle");
    stratLabel.style.marginTop = "12px";
    if (firstEditIdx <= 1) {
      stratLabel.textContent = "Strategy: Jump-to-edit (minimal exploration before first edit)";
    } else if (exploreBeforeEdit >= 5) {
      stratLabel.textContent = `Strategy: Explore-first (${exploreBeforeEdit} reads before first edit)`;
    } else {
      stratLabel.textContent = `Strategy: Balanced (${exploreBeforeEdit} reads before first edit)`;
    }
    fpSection.appendChild(stratLabel);
    container.appendChild(fpSection);

    // --- Phase Timeline ---
    const phaseSection = el("div", "tp-section");
    const phaseTitle = el("div", "tp-title");
    phaseTitle.textContent = "Phase Timeline";
    phaseSection.appendChild(phaseTitle);

    const colors: Record<string, string> = { exploration: "#4299e1", editing: "#ed8936", validation: "#48bb78", other: "#a0aec0" };
    const phaseBar = el("div", "tp-phase-bar");

    // Compress into runs
    const runs: { phase: string; count: number }[] = [];
    for (const t of toolNames) {
      const p = classifyTool(t);
      if (runs.length > 0 && runs[runs.length - 1].phase === p) {
        runs[runs.length - 1].count++;
      } else {
        runs.push({ phase: p, count: 1 });
      }
    }
    for (const run of runs) {
      const seg = el("div", "tp-phase-seg");
      seg.style.width = `${(run.count / total) * 100}%`;
      seg.style.background = colors[run.phase] ?? "#a0aec0";
      seg.title = `${run.phase}: ${run.count} calls`;
      if (run.count / total > 0.05) seg.textContent = String(run.count);
      phaseBar.appendChild(seg);
    }
    phaseSection.appendChild(phaseBar);

    const legend = el("div", "tp-phase-legend");
    for (const [phase, color] of Object.entries(colors)) {
      if (!phaseCounts[phase]) continue;
      const item = el("span", "");
      item.innerHTML = `<span class="tp-phase-dot" style="background:${color}"></span>${esc(phase)} (${phaseCounts[phase]})`;
      legend.appendChild(item);
    }
    phaseSection.appendChild(legend);
    container.appendChild(phaseSection);

    // --- Common Sequences (bigrams and trigrams) ---
    const seqSection = el("div", "tp-section");
    const seqTitle = el("div", "tp-title");
    seqTitle.textContent = "Common Sequences";
    seqSection.appendChild(seqTitle);

    // Bigrams
    const bigramCounts = new Map<string, number>();
    for (let i = 0; i < toolNames.length - 1; i++) {
      const key = `${toolNames[i]} -> ${toolNames[i + 1]}`;
      bigramCounts.set(key, (bigramCounts.get(key) ?? 0) + 1);
    }
    const topBigrams = [...bigramCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const biSub = el("div", "tp-subtitle");
    biSub.textContent = "Top Bigrams (A -> B)";
    seqSection.appendChild(biSub);

    for (const [seq, count] of topBigrams) {
      const row = el("div", "tp-seq");
      const cnt = el("span", "tp-seq-count");
      cnt.textContent = `${count}x`;
      row.appendChild(cnt);
      const parts = seq.split(" -> ");
      const a = el("span", "");
      a.textContent = parts[0];
      row.appendChild(a);
      const arrow = el("span", "tp-seq-arrow");
      arrow.textContent = " -> ";
      row.appendChild(arrow);
      const b = el("span", "");
      b.textContent = parts[1];
      row.appendChild(b);
      seqSection.appendChild(row);
    }

    // Trigrams
    const trigramCounts = new Map<string, number>();
    for (let i = 0; i < toolNames.length - 2; i++) {
      const key = `${toolNames[i]} -> ${toolNames[i + 1]} -> ${toolNames[i + 2]}`;
      trigramCounts.set(key, (trigramCounts.get(key) ?? 0) + 1);
    }
    const topTrigrams = [...trigramCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    if (topTrigrams.length > 0) {
      const triSub = el("div", "tp-subtitle");
      triSub.style.marginTop = "12px";
      triSub.textContent = "Top Trigrams (A -> B -> C)";
      seqSection.appendChild(triSub);

      for (const [seq, count] of topTrigrams) {
        const row = el("div", "tp-seq");
        const cnt = el("span", "tp-seq-count");
        cnt.textContent = `${count}x`;
        row.appendChild(cnt);
        const parts = seq.split(" -> ");
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) {
            const arrow = el("span", "tp-seq-arrow");
            arrow.textContent = " -> ";
            row.appendChild(arrow);
          }
          const span = el("span", "");
          span.textContent = parts[i];
          row.appendChild(span);
        }
        seqSection.appendChild(row);
      }
    }
    container.appendChild(seqSection);

    // --- Transition Matrix ---
    const matSection = el("div", "tp-section");
    const matTitle = el("div", "tp-title");
    matTitle.textContent = "Transition Matrix";
    matSection.appendChild(matTitle);

    const uniqueTools = [...new Set(toolNames)].sort();
    // Limit to top 12 tools by frequency
    const toolFreq = new Map<string, number>();
    for (const t of toolNames) toolFreq.set(t, (toolFreq.get(t) ?? 0) + 1);
    const topTools = [...toolFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);

    const matrix = new Map<string, Map<string, number>>();
    for (const from of topTools) matrix.set(from, new Map());
    for (let i = 0; i < toolNames.length - 1; i++) {
      if (!topTools.includes(toolNames[i]) || !topTools.includes(toolNames[i + 1])) continue;
      const row = matrix.get(toolNames[i])!;
      row.set(toolNames[i + 1], (row.get(toolNames[i + 1]) ?? 0) + 1);
    }

    const matWrap = el("div", "tp-matrix-wrap");
    const table = document.createElement("table");
    table.className = "tp-matrix";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.textContent = "From \\ To";
    headerRow.appendChild(corner);
    for (const t of topTools) {
      const th = document.createElement("th");
      // Add an ellipsis when we truncate so the cutoff doesn't read like
      // a real tool name ("PowerShe", "TodoWrit"). Bumped to 14 chars to
      // accommodate "TodoWrite", "PowerShell", "WebSearch", "ToolSearch",
      // "TaskOutput" without clipping.
      const display = t.replace(/^mcp__\w+__/, "");
      th.textContent = display.length > 14 ? display.slice(0, 13) + "…" : display;
      th.title = t;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const allVals: number[] = [];
    for (const row of matrix.values()) for (const v of row.values()) allVals.push(v);
    const maxVal = Math.max(...allVals, 1);

    for (const from of topTools) {
      const tr = document.createElement("tr");
      const label = document.createElement("th");
      const fromDisplay = from.replace(/^mcp__\w+__/, "");
      label.textContent = fromDisplay.length > 16 ? fromDisplay.slice(0, 15) + "…" : fromDisplay;
      label.title = from;
      label.style.textAlign = "left";
      tr.appendChild(label);
      const row = matrix.get(from)!;
      for (const to of topTools) {
        const td = document.createElement("td");
        const val = row.get(to) ?? 0;
        td.textContent = val > 0 ? String(val) : "";
        if (val > 0) {
          const intensity = Math.round((val / maxVal) * 255);
          td.style.background = `rgba(237, 137, 54, ${intensity / 255 * 0.6})`;
          if (val / maxVal > 0.5) td.classList.add("tp-hot");
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    matWrap.appendChild(table);
    matSection.appendChild(matWrap);
    container.appendChild(matSection);
  },
};

