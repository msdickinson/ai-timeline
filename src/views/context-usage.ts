/**
 * Context Usage View — tracks context window consumption over time.
 * Shows cumulative input tokens, cache utilization, compaction events,
 * and "context pressure" (how close to the limit at each step).
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// Known context window sizes by model name substring
function guessContextLimit(model?: string): number {
  if (!model) return 200_000;
  const m = model.toLowerCase();
  if (m.includes("claude-3-5") || m.includes("claude-4") || m.includes("opus") || m.includes("sonnet")) return 200_000;
  if (m.includes("gpt-4o")) return 128_000;
  if (m.includes("gpt-4-turbo")) return 128_000;
  if (m.includes("gpt-4")) return 8_192;
  if (m.includes("nemotron")) return 131_072;
  if (m.includes("deepseek")) return 128_000;
  return 200_000;
}

interface ContextPoint {
  index: number;
  timestamp: string;
  cumulativeInput: number;
  cachedTokens: number;
  freshTokens: number;
  pressure: number; // 0-1
  compacted: boolean;
  eventType: string;
  toolName?: string;
}

export const contextUsageView: TrajectoryView = {
  id: "context-usage",
  name: "Context",
  description: "Track context window consumption, cache utilization, and compaction events",
  icon: "X",
  tier: "advanced",
  requires: ["tokens"],

  css: `
.cu-empty { padding: 40px; text-align: center; color: var(--tv-text-muted, #888); }
.cu-section { margin-bottom: 24px; }
.cu-section h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
.cu-chart-wrap { position: relative; background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 16px; }
.cu-chart-svg { width: 100%; display: block; }
.cu-tooltip { position: absolute; display: none; background: rgba(0,0,0,0.92); color: #e0e0e0; border-radius: 6px; padding: 10px 14px; font-size: 12px; pointer-events: none; z-index: 10; line-height: 1.6; white-space: nowrap; border: 1px solid var(--tv-border, #333); }
.cu-legend { display: flex; gap: 20px; margin-top: 12px; font-size: 12px; color: var(--tv-text-muted, #888); flex-wrap: wrap; }
.cu-legend-item { display: flex; align-items: center; gap: 6px; }
.cu-legend-dot { width: 12px; height: 12px; border-radius: 3px; }
.cu-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.cu-stat { background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 14px; text-align: center; }
.cu-stat-value { font-size: 22px; font-weight: 700; }
.cu-stat-label { font-size: 11px; text-transform: uppercase; color: var(--tv-text-muted, #888); margin-top: 2px; }
.cu-pressure-bar { height: 24px; border-radius: 4px; position: relative; overflow: hidden; background: var(--tv-bg, #0d0d1a); margin-bottom: 8px; }
.cu-pressure-fill { height: 100%; border-radius: 4px; transition: width 0.2s; }
.cu-pressure-label { position: absolute; top: 4px; left: 8px; font-size: 11px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.cu-compaction-list { list-style: none; padding: 0; margin: 0; }
.cu-compaction-item { padding: 8px 12px; border-left: 3px solid #ed8936; margin-bottom: 6px; background: var(--tv-card-bg, #1a1a2e); border-radius: 0 6px 6px 0; font-size: 13px; }
.cu-compaction-idx { color: #ed8936; font-weight: 600; margin-right: 8px; }
`,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    if (trajectories.length === 0) {
      const msg = el("p", "cu-empty");
      msg.textContent = "No sessions selected";
      container.appendChild(msg);
      return;
    }

    const allEvents = trajectories.flatMap(t => t.events);
    const eventsWithTokens = allEvents.filter(e => e.tokens && ((e.tokens.input ?? 0) > 0));

    if (eventsWithTokens.length === 0) {
      const msg = el("p", "cu-empty");
      msg.textContent = "No token data available in these trajectories";
      container.appendChild(msg);
      return;
    }

    eventsWithTokens.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const model = trajectories[0]?.session?.model;
    const contextLimit = guessContextLimit(model);

    // Build data points
    let cumInput = 0;
    let totalCached = 0;
    let totalFresh = 0;
    const points: ContextPoint[] = [];

    for (let i = 0; i < eventsWithTokens.length; i++) {
      const e = eventsWithTokens[i];
      const inp = e.tokens?.input ?? 0;
      const cached = e.tokens?.cacheRead ?? 0;
      const fresh = inp - cached;
      cumInput += inp;
      totalCached += cached;
      totalFresh += (fresh > 0 ? fresh : inp);

      points.push({
        index: i,
        timestamp: e.timestamp,
        cumulativeInput: cumInput,
        cachedTokens: cached,
        freshTokens: fresh > 0 ? fresh : inp,
        pressure: Math.min(inp / contextLimit, 1),
        compacted: e.contextCompacted === true,
        eventType: e.type,
        toolName: e.toolCall?.name,
      });
    }

    const peakPressure = Math.max(...points.map(p => p.pressure));
    const compactionEvents = points.filter(p => p.compacted);
    const cacheRate = (totalCached + totalFresh) > 0 ? totalCached / (totalCached + totalFresh) : 0;

    // Stats cards
    const statsSection = el("div", "cu-section");
    const statsH3 = el("h3");
    statsH3.textContent = "Context Overview";
    statsSection.appendChild(statsH3);

    const statsGrid = el("div", "cu-stats");
    const stats = [
      { label: "Context Limit", value: fmtTokens(contextLimit), color: "var(--tv-text, #e0e0e0)" },
      { label: "Peak Input", value: fmtTokens(Math.max(...points.map(p => p.cachedTokens + p.freshTokens))), color: "#4f8ff7" },
      { label: "Peak Pressure", value: fmtPct(peakPressure), color: peakPressure > 0.8 ? "#fc5c65" : peakPressure > 0.5 ? "#ed8936" : "#48bb78" },
      { label: "Cache Hit Rate", value: fmtPct(cacheRate), color: cacheRate > 0.5 ? "#48bb78" : "#ed8936" },
      { label: "Compactions", value: compactionEvents.length.toString(), color: compactionEvents.length > 0 ? "#ed8936" : "#48bb78" },
      { label: "Total Consumed", value: fmtTokens(cumInput), color: "#9f7aea" },
    ];
    for (const s of stats) {
      const card = el("div", "cu-stat");
      const val = el("div", "cu-stat-value");
      val.textContent = s.value;
      val.style.color = s.color;
      const lbl = el("div", "cu-stat-label");
      lbl.textContent = s.label;
      card.appendChild(val);
      card.appendChild(lbl);
      statsGrid.appendChild(card);
    }
    statsSection.appendChild(statsGrid);
    container.appendChild(statsSection);

    // Context pressure chart
    const chartSection = el("div", "cu-section");
    const chartH3 = el("h3");
    chartH3.textContent = "Context Pressure Over Time";
    chartSection.appendChild(chartH3);

    const W = 800, H = 280;
    const PAD = { top: 20, right: 20, bottom: 30, left: 60 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    const maxPressure = Math.max(peakPressure * 1.1, 0.1);
    function xPos(i: number): number { return PAD.left + (i / Math.max(points.length - 1, 1)) * cw; }
    function yPos(v: number): number { return PAD.top + ch - (v / maxPressure) * ch; }

    // Build pressure area
    const pressureLine = points.map((p, i) => `${xPos(i).toFixed(1)},${yPos(p.pressure).toFixed(1)}`).join(" L");
    const pressureArea = `M${PAD.left},${PAD.top + ch} L${pressureLine} L${xPos(points.length - 1).toFixed(1)},${PAD.top + ch} Z`;

    // Danger zone line at 80%
    const dangerY = yPos(0.8);

    // Compaction markers
    const compactionMarkers = compactionEvents.map(p =>
      `<line x1="${xPos(p.index)}" y1="${PAD.top}" x2="${xPos(p.index)}" y2="${PAD.top + ch}" stroke="#ed8936" stroke-width="2" stroke-dasharray="4,3" opacity="0.8"/>
       <circle cx="${xPos(p.index)}" cy="${yPos(p.pressure)}" r="5" fill="#ed8936" stroke="#fff" stroke-width="1.5"/>`
    ).join("");

    // Y axis labels
    const yTicks = [0, 0.25, 0.5, 0.75, 1.0].filter(v => v <= maxPressure);
    const yLabels = yTicks.map(v =>
      `<text x="${PAD.left - 8}" y="${yPos(v).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--tv-text-muted, #666)" dominant-baseline="middle">${fmtPct(v)}</text>`
    ).join("");

    const wrap = el("div", "cu-chart-wrap");
    wrap.innerHTML = `
      <svg class="cu-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${dangerY >= PAD.top ? `<line x1="${PAD.left}" y1="${dangerY}" x2="${W - PAD.right}" y2="${dangerY}" stroke="#fc5c65" stroke-width="1" stroke-dasharray="6,4" opacity="0.5"/>
        <text x="${W - PAD.right}" y="${dangerY - 4}" text-anchor="end" font-size="9" fill="#fc5c65">80% danger</text>` : ""}
        <path d="${pressureArea}" fill="#4f8ff7" opacity="0.3"/>
        <polyline points="${pressureLine}" fill="none" stroke="#4f8ff7" stroke-width="2"/>
        ${compactionMarkers}
        ${yLabels}
      </svg>
    `;

    const tooltip = el("div", "cu-tooltip");
    wrap.appendChild(tooltip);

    const svg = wrap.querySelector("svg")!;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const rw = Math.max(cw / points.length, 4);
      rect.setAttribute("x", (xPos(i) - rw / 2).toFixed(1));
      rect.setAttribute("y", PAD.top.toString());
      rect.setAttribute("width", rw.toFixed(1));
      rect.setAttribute("height", ch.toString());
      rect.setAttribute("fill", "transparent");
      rect.style.cursor = "crosshair";

      rect.addEventListener("mouseenter", () => {
        tooltip.style.display = "block";
        tooltip.textContent = "";
        const lines = [
          `Step ${p.index + 1}`,
          `Pressure: ${fmtPct(p.pressure)}`,
          `Fresh: ${fmtTokens(p.freshTokens)}`,
          `Cached: ${fmtTokens(p.cachedTokens)}`,
          `Cumulative: ${fmtTokens(p.cumulativeInput)}`,
          p.compacted ? "** COMPACTION **" : "",
          p.toolName ? `Tool: ${p.toolName}` : `Type: ${p.eventType}`,
        ].filter(Boolean);
        for (const line of lines) {
          const d = el("div");
          d.textContent = line;
          tooltip.appendChild(d);
        }
      });
      rect.addEventListener("mousemove", (ev: MouseEvent) => {
        const bounds = wrap.getBoundingClientRect();
        tooltip.style.left = `${ev.clientX - bounds.left + 12}px`;
        tooltip.style.top = `${ev.clientY - bounds.top - 10}px`;
      });
      rect.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
      svg.appendChild(rect);
    }

    chartSection.appendChild(wrap);

    // Legend
    const legend = el("div", "cu-legend");
    for (const item of [
      { label: "Context Pressure", color: "#4f8ff7" },
      { label: "Compaction Event", color: "#ed8936" },
      { label: "80% Danger Zone", color: "#fc5c65" },
    ]) {
      const li = el("div", "cu-legend-item");
      const dot = el("span", "cu-legend-dot");
      dot.style.background = item.color;
      li.appendChild(dot);
      const lbl = el("span");
      lbl.textContent = item.label;
      li.appendChild(lbl);
      legend.appendChild(li);
    }
    chartSection.appendChild(legend);
    container.appendChild(chartSection);

    // Cache utilization bar
    const cacheSection = el("div", "cu-section");
    const cacheH3 = el("h3");
    cacheH3.textContent = "Cache Utilization";
    cacheSection.appendChild(cacheH3);

    const bar = el("div", "cu-pressure-bar");
    const fill = el("div", "cu-pressure-fill");
    fill.style.width = fmtPct(cacheRate);
    fill.style.background = cacheRate > 0.5 ? "linear-gradient(90deg, #48bb78, #38a169)" : "linear-gradient(90deg, #ed8936, #dd6b20)";
    const barLabel = el("span", "cu-pressure-label");
    barLabel.textContent = `${fmtPct(cacheRate)} cached vs ${fmtPct(1 - cacheRate)} fresh`;
    bar.appendChild(fill);
    bar.appendChild(barLabel);
    cacheSection.appendChild(bar);
    container.appendChild(cacheSection);

    // Compaction events list
    if (compactionEvents.length > 0) {
      const compSection = el("div", "cu-section");
      const compH3 = el("h3");
      compH3.textContent = `Compaction Events (${compactionEvents.length})`;
      compSection.appendChild(compH3);

      const list = el("ul", "cu-compaction-list");
      for (const ce of compactionEvents) {
        const item = el("li", "cu-compaction-item");
        const idx = el("span", "cu-compaction-idx");
        idx.textContent = `Step ${ce.index + 1}`;
        item.appendChild(idx);
        const desc = el("span");
        desc.textContent = `Pressure: ${fmtPct(ce.pressure)} | Cumulative: ${fmtTokens(ce.cumulativeInput)} | ${new Date(ce.timestamp).toLocaleTimeString()}`;
        item.appendChild(desc);
        list.appendChild(item);
      }
      compSection.appendChild(list);
      container.appendChild(compSection);
    }
  },
};
