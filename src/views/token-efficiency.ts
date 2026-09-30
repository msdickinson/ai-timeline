/**
 * Token Efficiency View — analyze token usage, cache hits, waste, and I/O ratios.
 * Computes efficiency scores and compares across sessions.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

interface SessionEfficiency {
  sessionId: string;
  model: string;
  totalInput: number;
  totalOutput: number;
  cacheRead: number;
  cacheWrite: number;
  wastedTokens: number;
  usefulOutput: number;
  errorEvents: number;
  totalEvents: number;
  cacheHitRate: number;
  ioRatio: number;
  efficiencyScore: number;
  durationMs: number;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function computeEfficiency(traj: Trajectory): SessionEfficiency {
  const events = traj.events;
  let totalInput = 0, totalOutput = 0, cacheRead = 0, cacheWrite = 0;
  let wastedTokens = 0, usefulOutput = 0, errorEvents = 0;

  // Identify tool calls that errored or were part of reverted work
  const errorCallIds = new Set<number>();
  for (const ev of events) {
    if (ev.type === "tool_result" && ev.toolResult?.isError) {
      if (ev.toolResult.toolCallEventId != null) errorCallIds.add(ev.toolResult.toolCallEventId);
    }
  }

  for (const ev of events) {
    if (!ev.tokens) continue;
    const input = ev.tokens.input ?? 0;
    const output = ev.tokens.output ?? 0;
    const cr = ev.tokens.cacheRead ?? 0;
    const cw = ev.tokens.cacheWrite ?? 0;

    totalInput += input;
    totalOutput += output;
    cacheRead += cr;
    cacheWrite += cw;

    // Count wasted tokens: tokens spent on events that led to errors
    if (ev.type === "tool_call" && errorCallIds.has(ev.id)) {
      wastedTokens += input + output;
      errorEvents++;
    } else if (ev.type === "tool_result" && ev.toolResult?.isError) {
      wastedTokens += input + output;
      errorEvents++;
    } else {
      usefulOutput += output;
    }
  }

  const totalTokens = totalInput + totalOutput;
  const cacheHitRate = (totalInput + cacheRead) > 0 ? cacheRead / (totalInput + cacheRead) : 0;
  const ioRatio = totalOutput > 0 ? totalInput / totalOutput : 0;
  const efficiencyScore = totalTokens > 0 ? usefulOutput / totalTokens : 0;

  const timestamps = events.map((e) => new Date(e.timestamp).getTime()).filter((t) => !isNaN(t));
  const durationMs = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  return {
    sessionId: traj.session.id,
    model: traj.session.model ?? "unknown",
    totalInput, totalOutput, cacheRead, cacheWrite,
    wastedTokens, usefulOutput, errorEvents,
    totalEvents: events.length,
    cacheHitRate, ioRatio, efficiencyScore, durationMs,
  };
}

function renderBar(value: number, max: number, color: string, width: number): HTMLElement {
  const wrap = el("div", "");
  wrap.style.cssText = `width:${width}px;height:14px;background:var(--tv-bg);border-radius:3px;overflow:hidden;`;
  const fill = el("div", "");
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  fill.style.cssText = `width:${pct}%;height:100%;background:${color};border-radius:3px;`;
  wrap.appendChild(fill);
  return wrap;
}

export const tokenEfficiencyView: TrajectoryView = {
  id: "token-efficiency",
  name: "Efficiency",
  description: "Token usage analysis, cache rates, waste tracking, and efficiency scores",
  icon: "E",
  tier: "advanced",
  requires: ["tokens"],

  css: `
    .te { font-family: var(--tv-font); }
    .te-section { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 16px 20px; margin-bottom: 14px; }
    .te-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    .te-subtitle { font-size: 13px; font-weight: 600; color: var(--tv-text-secondary); margin-bottom: 8px; }
    .te-stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .te-stat { background: var(--tv-bg); border: 1px solid var(--tv-border); border-radius: var(--tv-radius-sm); padding: 10px 16px; min-width: 110px; }
    .te-stat-label { font-size: 11px; color: var(--tv-text-muted); }
    .te-stat-val { font-size: 22px; font-weight: 700; font-family: var(--tv-mono); }
    .te-stat-val.te-good { color: #48bb78; }
    .te-stat-val.te-warn { color: #ed8936; }
    .te-stat-val.te-bad { color: var(--tv-error); }
    .te-gauge { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
    .te-gauge-label { min-width: 100px; font-size: 12px; color: var(--tv-text-secondary); }
    .te-gauge-val { min-width: 60px; text-align: right; font-family: var(--tv-mono); font-size: 12px; font-weight: 600; }
    .te-breakdown { display: flex; height: 32px; border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
    .te-breakdown-seg { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #fff; min-width: 2px; }
    .te-breakdown-legend { display: flex; gap: 14px; font-size: 11px; flex-wrap: wrap; margin-top: 4px; }
    .te-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
    .te-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .te-table th { text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--tv-border); font-weight: 600; font-size: 11px; color: var(--tv-text-muted); }
    .te-table td { padding: 6px 8px; border-bottom: 1px solid var(--tv-border); font-family: var(--tv-mono); }
    .te-table tr:hover { background: var(--tv-bg-hover); }
    .te-cache-timeline { display: flex; gap: 1px; align-items: flex-end; height: 60px; }
    .te-cache-bar { flex: 1; min-width: 3px; border-radius: 2px 2px 0 0; }
    .te-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    container.classList.add("te");

    if (trajectories.length === 0) {
      const empty = el("div", "te-empty");
      empty.textContent = "No sessions loaded.";
      container.appendChild(empty);
      return;
    }

    const efficiencies = trajectories.map(computeEfficiency);
    const hasTokens = efficiencies.some((e) => e.totalInput > 0 || e.totalOutput > 0);

    if (!hasTokens) {
      const empty = el("div", "te-empty");
      empty.textContent = "No token usage data available in selected sessions.";
      container.appendChild(empty);
      return;
    }

    // --- Aggregate Stats ---
    const agg = efficiencies.reduce((acc, e) => ({
      totalInput: acc.totalInput + e.totalInput,
      totalOutput: acc.totalOutput + e.totalOutput,
      cacheRead: acc.cacheRead + e.cacheRead,
      cacheWrite: acc.cacheWrite + e.cacheWrite,
      wastedTokens: acc.wastedTokens + e.wastedTokens,
      usefulOutput: acc.usefulOutput + e.usefulOutput,
      errorEvents: acc.errorEvents + e.errorEvents,
    }), { totalInput: 0, totalOutput: 0, cacheRead: 0, cacheWrite: 0, wastedTokens: 0, usefulOutput: 0, errorEvents: 0 });

    const totalTokens = agg.totalInput + agg.totalOutput;
    const aggCacheRate = (agg.totalInput + agg.cacheRead) > 0 ? agg.cacheRead / (agg.totalInput + agg.cacheRead) : 0;
    const aggEfficiency = totalTokens > 0 ? agg.usefulOutput / totalTokens : 0;
    const aggIoRatio = agg.totalOutput > 0 ? agg.totalInput / agg.totalOutput : 0;

    const statsSection = el("div", "te-section");
    const statsTitle = el("div", "te-title");
    statsTitle.textContent = trajectories.length > 1 ? `Efficiency Overview (${trajectories.length} sessions)` : "Efficiency Overview";
    statsSection.appendChild(statsTitle);

    const stats = el("div", "te-stats");
    const statItems: Array<{ label: string; value: string; cls: string }> = [
      { label: "Total Tokens", value: fmtTokens(totalTokens), cls: "" },
      { label: "Efficiency", value: fmtPct(aggEfficiency), cls: aggEfficiency > 0.3 ? "te-good" : aggEfficiency > 0.15 ? "te-warn" : "te-bad" },
      { label: "Cache Hit Rate", value: fmtPct(aggCacheRate), cls: aggCacheRate > 0.5 ? "te-good" : aggCacheRate > 0.2 ? "te-warn" : "te-bad" },
      { label: "I/O Ratio", value: aggIoRatio.toFixed(1) + "x", cls: "" },
      { label: "Wasted", value: fmtTokens(agg.wastedTokens), cls: agg.wastedTokens > 0 ? "te-warn" : "" },
      { label: "Errors", value: String(agg.errorEvents), cls: agg.errorEvents > 0 ? "te-bad" : "" },
    ];
    for (const s of statItems) {
      const item = el("div", "te-stat");
      const lbl = el("div", "te-stat-label");
      lbl.textContent = s.label;
      const val = el("div", `te-stat-val ${s.cls}`);
      val.textContent = s.value;
      item.appendChild(lbl);
      item.appendChild(val);
      stats.appendChild(item);
    }
    statsSection.appendChild(stats);

    // Token breakdown bar
    const breakSub = el("div", "te-subtitle");
    breakSub.textContent = "Token Breakdown";
    statsSection.appendChild(breakSub);

    const breakBar = el("div", "te-breakdown");
    const segments: Array<{ label: string; value: number; color: string }> = [
      { label: "Input", value: agg.totalInput, color: "#4299e1" },
      { label: "Output (useful)", value: agg.usefulOutput, color: "#48bb78" },
      { label: "Output (wasted)", value: agg.wastedTokens, color: "#fc5c65" },
      { label: "Cache Read", value: agg.cacheRead, color: "#9f7aea" },
      { label: "Cache Write", value: agg.cacheWrite, color: "#ed8936" },
    ];
    const segTotal = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const d = el("div", "te-breakdown-seg");
      d.style.cssText = `flex:${seg.value};background:${seg.color};`;
      if (seg.value / segTotal > 0.08) d.textContent = fmtTokens(seg.value);
      d.title = `${seg.label}: ${fmtTokens(seg.value)}`;
      breakBar.appendChild(d);
    }
    statsSection.appendChild(breakBar);

    const legend = el("div", "te-breakdown-legend");
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const item = el("span", "");
      item.innerHTML = `<span class="te-dot" style="background:${seg.color}"></span>`;
      const txt = document.createTextNode(`${seg.label} (${fmtTokens(seg.value)})`);
      item.appendChild(txt);
      legend.appendChild(item);
    }
    statsSection.appendChild(legend);
    container.appendChild(statsSection);

    // --- Gauges ---
    const gaugeSection = el("div", "te-section");
    const gaugeTitle = el("div", "te-title");
    gaugeTitle.textContent = "Efficiency Gauges";
    gaugeSection.appendChild(gaugeTitle);

    const gauges: Array<{ label: string; value: number; max: number; color: string; display: string }> = [
      { label: "Efficiency", value: aggEfficiency, max: 1, color: aggEfficiency > 0.3 ? "#48bb78" : "#ed8936", display: fmtPct(aggEfficiency) },
      { label: "Cache Rate", value: aggCacheRate, max: 1, color: aggCacheRate > 0.5 ? "#48bb78" : "#ed8936", display: fmtPct(aggCacheRate) },
      { label: "Useful Output", value: agg.usefulOutput, max: totalTokens, color: "#4299e1", display: fmtTokens(agg.usefulOutput) },
      { label: "Waste Rate", value: agg.wastedTokens, max: totalTokens, color: "#fc5c65", display: fmtPct(totalTokens > 0 ? agg.wastedTokens / totalTokens : 0) },
    ];
    for (const g of gauges) {
      const row = el("div", "te-gauge");
      const lbl = el("span", "te-gauge-label");
      lbl.textContent = g.label;
      row.appendChild(lbl);
      row.appendChild(renderBar(g.value, g.max, g.color, 200));
      const val = el("span", "te-gauge-val");
      val.textContent = g.display;
      row.appendChild(val);
      gaugeSection.appendChild(row);
    }
    container.appendChild(gaugeSection);

    // --- Cache Over Time ---
    const cacheEvents = trajectories.flatMap((t) => t.events).filter((e) => e.tokens && ((e.tokens.cacheRead ?? 0) > 0 || (e.tokens.input ?? 0) > 0));
    if (cacheEvents.length > 2) {
      const cacheSection = el("div", "te-section");
      const cacheTitle = el("div", "te-title");
      cacheTitle.textContent = "Cache Hit Rate Over Time";
      cacheSection.appendChild(cacheTitle);

      const timeline = el("div", "te-cache-timeline");
      // Bucket into ~40 segments
      const bucketSize = Math.max(1, Math.floor(cacheEvents.length / 40));
      const buckets: number[] = [];
      for (let i = 0; i < cacheEvents.length; i += bucketSize) {
        const slice = cacheEvents.slice(i, i + bucketSize);
        let cr = 0, inp = 0;
        for (const e of slice) {
          cr += e.tokens?.cacheRead ?? 0;
          inp += e.tokens?.input ?? 0;
        }
        buckets.push((cr + inp) > 0 ? cr / (cr + inp) : 0);
      }
      for (const rate of buckets) {
        const bar = el("div", "te-cache-bar");
        bar.style.cssText = `height:${Math.max(rate * 100, 2)}%;background:${rate > 0.5 ? "#48bb78" : rate > 0.2 ? "#ed8936" : "#fc5c65"};`;
        bar.title = fmtPct(rate);
        timeline.appendChild(bar);
      }
      cacheSection.appendChild(timeline);
      container.appendChild(cacheSection);
    }

    // --- Per-Session Comparison ---
    if (efficiencies.length > 1) {
      const compSection = el("div", "te-section");
      const compTitle = el("div", "te-title");
      compTitle.textContent = "Session Comparison";
      compSection.appendChild(compTitle);

      const table = document.createElement("table");
      table.className = "te-table";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const h of ["Session", "Model", "Input", "Output", "Cache%", "Waste%", "Efficiency"]) {
        const th = document.createElement("th");
        th.textContent = h;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const eff of efficiencies) {
        const tr = document.createElement("tr");
        const vals = [
          eff.sessionId.slice(0, 12),
          eff.model.slice(0, 20),
          fmtTokens(eff.totalInput),
          fmtTokens(eff.totalOutput),
          fmtPct(eff.cacheHitRate),
          fmtPct((eff.totalInput + eff.totalOutput) > 0 ? eff.wastedTokens / (eff.totalInput + eff.totalOutput) : 0),
          fmtPct(eff.efficiencyScore),
        ];
        for (const v of vals) {
          const td = document.createElement("td");
          td.textContent = v;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      compSection.appendChild(table);
      container.appendChild(compSection);
    }
  },
};

