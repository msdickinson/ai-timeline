/**
 * Tool Usage View — per-tool breakdown with duration bar charts.
 * Shows: call count, avg/p95/max duration per tool, clickable bar chart.
 */

import { Trajectory, TrajectoryEvent, getSessionLabel } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

interface ToolCallData {
  index: number;
  toolName: string;
  event: TrajectoryEvent;
  resultEvent?: TrajectoryEvent;
  durationMs: number;
  isError: boolean;
}

export const toolUsageView: TrajectoryView = {
  id: "tool-usage",
  name: "Tools",
  description: "Per-tool usage breakdown with duration charts",
  icon: "\u2699",
  tier: "standard",
  requires: ["tools"],

  css: `
    .ttu { font-family: var(--tv-font); }
    .ttu-session-selector { display: flex; align-items: center; gap: 8px; padding: 10px 0; }
    .ttu-session-dropdown {
      padding: 4px 8px; font-size: 12px; border: 1px solid var(--tv-border); border-radius: 4px;
      background: var(--tv-bg-card); color: var(--tv-text); font-family: var(--tv-font); cursor: pointer;
    }
    .ttu-session-header {
      padding: 8px 12px; font-size: 13px; font-weight: 700; color: var(--tv-text);
      background: color-mix(in srgb, var(--tv-accent) 12%, var(--tv-bg-card));
      border-bottom: 2px solid var(--tv-accent);
      border-radius: var(--tv-radius) var(--tv-radius) 0 0;
      margin-top: 16px;
    }
    .ttu-header {
      font-size: 16px;
      font-weight: 700;
      padding: 12px 0;
      border-bottom: 1px solid var(--tv-border);
      margin-bottom: 16px;
    }
    .ttu-header-count { font-weight: 400; color: var(--tv-text-secondary); font-size: 14px; }

    .ttu-tool {
      background: var(--tv-bg-card);
      border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius);
      padding: 16px 20px;
      margin-bottom: 12px;
    }
    .ttu-tool-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .ttu-tool-name { font-size: 18px; font-weight: 700; font-family: var(--tv-mono); }
    .ttu-tool-count { font-size: 14px; color: var(--tv-text-secondary); }
    .ttu-tool-stats {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--tv-text-secondary);
      margin-bottom: 10px;
    }
    .ttu-stat-label { color: var(--tv-text-muted); }
    .ttu-stat-avg { font-weight: 600; }
    .ttu-stat-p95 { color: #ed8936; font-weight: 600; }
    .ttu-stat-max { color: #fc5c65; font-weight: 600; }

    .ttu-chart-label {
      font-size: 11px;
      color: var(--tv-text-muted);
      margin-bottom: 6px;
    }
    .ttu-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 70px;
    }
    .ttu-bar {
      flex: 1;
      min-width: 4px;
      max-width: 20px;
      border-radius: 2px 2px 0 0;
      cursor: pointer;
      transition: opacity 0.1s;
      background: #ed8936;
    }
    .ttu-bar:hover { opacity: 0.7; }
    .ttu-bar.ttu-bar-error { background: var(--tv-error); }
    .ttu-bar.ttu-bar-selected { outline: 2px solid var(--tv-text); outline-offset: 1px; }
    .ttu-chart-axis {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      font-family: var(--tv-mono);
      margin-top: 2px;
    }
    .ttu-chart-axis-first { color: #ed8936; }
    .ttu-chart-axis-last { color: var(--tv-text-muted); }
    .ttu-mode-tabs {
      display: flex;
      gap: 2px;
      justify-content: flex-end;
      margin-bottom: 6px;
    }
    .ttu-mode-tab {
      padding: 3px 10px;
      font-size: 11px;
      border: 1px solid var(--tv-border);
      border-radius: 3px;
      background: var(--tv-bg);
      color: var(--tv-text-secondary);
      cursor: pointer;
    }
    .ttu-mode-tab:hover { background: var(--tv-bg-hover); }
    .ttu-mode-tab.ttu-mode-active { background: var(--tv-accent); color: #fff; border-color: var(--tv-accent); }

    .ttu-inspect {
      background: var(--tv-bg);
      border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius-sm);
      padding: 10px 16px;
      margin-top: 8px;
      font-size: 12px;
    }
    .ttu-inspect-header {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .ttu-inspect-header strong { color: var(--tv-text); }
    .ttu-inspect-content {
      font-family: var(--tv-mono);
      font-size: 11px;
      color: var(--tv-text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 150px;
      overflow-y: auto;
      margin-top: 6px;
    }
    .ttu-inspect-btn {
      padding: 2px 8px;
      border: 1px solid var(--tv-border);
      border-radius: 3px;
      background: var(--tv-bg-card);
      color: var(--tv-text);
      cursor: pointer;
      font-size: 11px;
    }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("ttu");

    const isMulti = trajectories.length > 1;

    const events = trajectories.flatMap((t) => t.events);
    const toolCallEvents = events.filter((e) => e.type === "tool_call");

    if (toolCallEvents.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tv-text-muted)">No tool calls in this session</div>';
      return;
    }

    // Build session labels
    const trajLabels = trajectories.map((t, i) => getSessionLabel(t, i));

    // Build tool call data per-trajectory
    const perSession: { label: string; calls: ToolCallData[] }[] = [];
    let globalIdx = 0;
    for (let si = 0; si < trajectories.length; si++) {
      const trajEvents = trajectories[si].events;
      const resultMap = new Map<number, TrajectoryEvent>();
      for (const r of trajEvents) {
        if (r.type === "tool_result" && r.toolResult?.toolCallEventId != null)
          resultMap.set(r.toolResult.toolCallEventId, r);
      }
      const sessCalls: ToolCallData[] = [];
      for (const e of trajEvents.filter(ev => ev.type === "tool_call")) {
        const resultEvent = resultMap.get(e.id);
        let durationMs = e.durationMs ?? 0;
        if (!durationMs && resultEvent) {
          const startMs = new Date(e.timestamp).getTime();
          const endMs = new Date(resultEvent.timestamp).getTime();
          if (!isNaN(startMs) && !isNaN(endMs)) durationMs = endMs - startMs;
        }
        sessCalls.push({ index: globalIdx++, toolName: e.toolCall?.name ?? "unknown", event: e, resultEvent, durationMs, isError: resultEvent?.toolResult?.isError ?? false });
      }
      perSession.push({ label: trajLabels[si], calls: sessCalls });
    }

    const allCalls = perSession.flatMap(s => s.calls);
    let viewMode: "combined" | "by-session" | number = "combined";

    // Session dropdown for multi-session
    if (isMulti) {
      const selectorRow = el("div", "ttu-session-selector");
      const label = el("span", "");
      label.textContent = "View: ";
      label.style.cssText = "font-size:12px;font-weight:600;color:var(--tv-text-secondary)";
      selectorRow.appendChild(label);

      const dropdown = document.createElement("select");
      dropdown.className = "ttu-session-dropdown";

      const combinedOpt = document.createElement("option");
      combinedOpt.value = "combined";
      combinedOpt.textContent = `All \u2014 Combined (${allCalls.length} calls)`;
      dropdown.appendChild(combinedOpt);

      const bySessionOpt = document.createElement("option");
      bySessionOpt.value = "by-session";
      bySessionOpt.textContent = `All \u2014 By Session`;
      dropdown.appendChild(bySessionOpt);

      for (let si = 0; si < perSession.length; si++) {
        const opt = document.createElement("option");
        opt.value = String(si);
        opt.textContent = `${perSession[si].label} (${perSession[si].calls.length} calls)`;
        dropdown.appendChild(opt);
      }
      dropdown.onchange = () => {
        const v = dropdown.value;
        viewMode = v === "combined" ? "combined" : v === "by-session" ? "by-session" : Number(v);
        renderContent();
      };
      selectorRow.appendChild(dropdown);
      container.appendChild(selectorRow);
    }

    const contentArea = el("div", "");
    container.appendChild(contentArea);

    function renderToolsForCalls(calls: ToolCallData[]) {
      const toolNames = [...new Set(calls.map((c) => c.toolName))];
      const header = el("div", "ttu-header");
      header.innerHTML = `Tool Usage <span class="ttu-header-count">(${toolNames.length} tools, ${calls.length} calls)</span>`;
      contentArea.appendChild(header);

      const sorted = toolNames.sort((a, b) => {
        return calls.filter(c => c.toolName === b).length - calls.filter(c => c.toolName === a).length;
      });
      for (const toolName of sorted) {
        contentArea.appendChild(renderToolSection(toolName, calls.filter(c => c.toolName === toolName)));
      }
    }

    function renderContent() {
      contentArea.innerHTML = "";

      if (viewMode === "combined" || !isMulti) {
        renderToolsForCalls(allCalls);
      } else if (viewMode === "by-session") {
        for (let si = 0; si < perSession.length; si++) {
          const sessHeader = el("div", "ttu-session-header");
          sessHeader.textContent = perSession[si].label;
          contentArea.appendChild(sessHeader);
          renderToolsForCalls(perSession[si].calls);
        }
      } else {
        renderToolsForCalls(perSession[viewMode as number].calls);
      }
    }

    renderContent();
  },
};

function renderToolSection(toolName: string, calls: ToolCallData[]): HTMLElement {
  const section = el("div", "ttu-tool");

  const durations = calls.map((c) => c.durationMs).sort((a, b) => a - b);
  const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0;
  const max = durations.length > 0 ? durations[durations.length - 1] : 0;
  const errors = calls.filter((c) => c.isError).length;

  // Header
  const header = el("div", "ttu-tool-header");
  header.innerHTML = `
    <span class="ttu-tool-name">${escHtml(toolName)}</span>
    <span class="ttu-tool-count">${calls.length}x</span>
    ${errors > 0 ? `<span style="color:var(--tv-error);font-weight:600">${errors} errors</span>` : ""}
  `;
  section.appendChild(header);

  // Stats
  const stats = el("div", "ttu-tool-stats");
  stats.innerHTML = `
    <span><span class="ttu-stat-label">Avg</span> <span class="ttu-stat-avg">${fmtDur(avg)}</span></span>
    <span><span class="ttu-stat-label">P95</span> <span class="ttu-stat-p95">${fmtDur(p95)}</span></span>
    <span><span class="ttu-stat-label">Max</span> <span class="ttu-stat-max">${fmtDur(max)}</span></span>
  `;
  section.appendChild(stats);

  // Chart mode
  let chartMode: "time" | "cost" = "time";
  const modeTabs = el("div", "ttu-mode-tabs");

  function renderChart() {
    const existing = section.querySelector(".ttu-chart-wrap");
    if (existing) existing.remove();
    const existingInspect = section.querySelector(".ttu-inspect");
    if (existingInspect) existingInspect.remove();

    modeTabs.querySelectorAll(".ttu-mode-tab").forEach((tab) => {
      tab.classList.toggle("ttu-mode-active", tab.getAttribute("data-mode") === chartMode);
    });

    const wrap = el("div", "ttu-chart-wrap");

    const label = el("div", "ttu-chart-label");
    label.textContent = `${toolName} Duration (1st → ${calls.length}th) — click a bar to inspect`;
    wrap.appendChild(label);

    const chart = el("div", "ttu-chart");
    const maxVal = Math.max(...calls.map((c) => c.durationMs), 1);

    for (const call of calls) {
      const height = Math.max((call.durationMs / maxVal) * 100, 3);
      const bar = el("div", `ttu-bar ${call.isError ? "ttu-bar-error" : ""}`);
      bar.style.height = `${height}%`;
      bar.title = `#${call.index + 1}: ${fmtDur(call.durationMs)}${call.isError ? " (error)" : ""}`;

      bar.onclick = () => {
        chart.querySelectorAll(".ttu-bar-selected").forEach((b) => b.classList.remove("ttu-bar-selected"));
        bar.classList.add("ttu-bar-selected");
        const oldInspect = section.querySelector(".ttu-inspect");
        if (oldInspect) oldInspect.remove();
        section.appendChild(renderInspect(call, calls));
      };

      chart.appendChild(bar);
    }

    wrap.appendChild(chart);

    const axis = el("div", "ttu-chart-axis");
    axis.innerHTML = `
      <span class="ttu-chart-axis-first">1st: ${fmtDur(calls[0]?.durationMs ?? 0)}</span>
      <span class="ttu-chart-axis-last">Last: ${fmtDur(calls[calls.length - 1]?.durationMs ?? 0)}</span>
    `;
    wrap.appendChild(axis);

    section.appendChild(wrap);
  }

  for (const mode of ["time", "cost"] as const) {
    const tab = el("div", `ttu-mode-tab ${mode === chartMode ? "ttu-mode-active" : ""}`);
    tab.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    tab.setAttribute("data-mode", mode);
    tab.onclick = () => { chartMode = mode; renderChart(); };
    modeTabs.appendChild(tab);
  }
  section.appendChild(modeTabs);

  renderChart();
  return section;
}

function renderInspect(call: ToolCallData, allCalls: ToolCallData[]): HTMLElement {
  const inspect = el("div", "ttu-inspect");

  const headerEl = el("div", "ttu-inspect-header");

  // Nav
  const prevBtn = document.createElement("button");
  prevBtn.className = "ttu-inspect-btn";
  prevBtn.textContent = "‹ Prev";
  prevBtn.disabled = call.index <= 0;
  prevBtn.onclick = () => {
    const bars = inspect.parentElement!.querySelectorAll(".ttu-bar");
    bars.forEach((b) => b.classList.remove("ttu-bar-selected"));
    const prevCall = allCalls.find((c) => c.index === call.index - 1);
    if (prevCall) {
      const barIdx = allCalls.indexOf(prevCall);
      bars[barIdx]?.classList.add("ttu-bar-selected");
      inspect.replaceWith(renderInspect(prevCall, allCalls));
    }
  };
  headerEl.appendChild(prevBtn);

  const callLabel = el("span", "");
  callLabel.innerHTML = `<strong>Call #${call.index + 1} of ${allCalls.length}</strong>`;
  headerEl.appendChild(callLabel);

  const nextBtn = document.createElement("button");
  nextBtn.className = "ttu-inspect-btn";
  nextBtn.textContent = "Next ›";
  nextBtn.disabled = call.index >= allCalls[allCalls.length - 1].index;
  nextBtn.onclick = () => {
    const bars = inspect.parentElement!.querySelectorAll(".ttu-bar");
    bars.forEach((b) => b.classList.remove("ttu-bar-selected"));
    const nextCall = allCalls.find((c) => c.index === call.index + 1);
    if (nextCall) {
      const barIdx = allCalls.indexOf(nextCall);
      bars[barIdx]?.classList.add("ttu-bar-selected");
      inspect.replaceWith(renderInspect(nextCall, allCalls));
    }
  };
  headerEl.appendChild(nextBtn);

  // Metrics
  const time = call.event.timestamp ? new Date(call.event.timestamp).toLocaleTimeString() : "";
  headerEl.innerHTML += `
    <span><strong>${fmtDur(call.durationMs)}</strong></span>
    <span>${time}</span>
    ${call.isError ? '<span style="color:var(--tv-error);font-weight:600">Error</span>' : '<span style="color:#48bb78">OK</span>'}
  `;

  inspect.appendChild(headerEl);

  // Tool call arguments
  const argsContent = el("div", "ttu-inspect-content");
  const args = call.event.toolCall?.arguments;
  argsContent.textContent = typeof args === "string" ? args : JSON.stringify(args, null, 2);
  inspect.appendChild(argsContent);

  // Result output
  if (call.resultEvent) {
    const resultLabel = el("div", "");
    resultLabel.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;color:var(--tv-text-muted);margin-top:8px;margin-bottom:4px";
    resultLabel.textContent = call.isError ? "ERROR OUTPUT" : "RESULT";
    inspect.appendChild(resultLabel);

    const resultContent = el("div", "ttu-inspect-content");
    resultContent.textContent = call.resultEvent.toolResult?.output ?? "";
    inspect.appendChild(resultContent);
  }

  return inspect;
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDur(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
