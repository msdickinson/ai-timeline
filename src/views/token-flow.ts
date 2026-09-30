/**
 * Token Flow View — stacked area chart of token usage over time.
 * Shows input, output, and cached tokens as stacked areas with
 * hover tooltip, running total line, and cumulative stats.
 */

import { Trajectory, TrajectoryEvent, computeSummary } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(2)}M`;
}

interface TokenPoint {
  time: number;
  label: string;
  input: number;
  output: number;
  cached: number;
  cumulative: number;
}

export const tokenFlowView: TrajectoryView = {
  id: "token-flow",
  name: "Token Flow",
  description: "Stacked area chart of token usage over time with hover details and running totals",
  icon: "~",
  tier: "advanced",
  requires: ["tokens"],

  css: `
.tf-empty { padding: 40px; text-align: center; color: var(--tv-text-muted, #888); }
.tf-section { margin-bottom: 24px; }
.tf-section h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
.tf-chart-wrap { position: relative; background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 16px; overflow: hidden; }
.tf-chart-svg { width: 100%; display: block; }
.tf-tooltip { position: absolute; display: none; background: rgba(0,0,0,0.9); color: #e0e0e0; border-radius: 6px; padding: 10px 14px; font-size: 12px; pointer-events: none; z-index: 10; line-height: 1.6; white-space: nowrap; border: 1px solid var(--tv-border, #333); }
.tf-legend { display: flex; gap: 20px; margin-top: 12px; font-size: 12px; color: var(--tv-text-muted, #888); }
.tf-legend-item { display: flex; align-items: center; gap: 6px; }
.tf-legend-dot { width: 12px; height: 12px; border-radius: 3px; }
.tf-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.tf-stat { background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 14px; text-align: center; }
.tf-stat-value { font-size: 22px; font-weight: 700; }
.tf-stat-label { font-size: 11px; text-transform: uppercase; color: var(--tv-text-muted, #888); margin-top: 2px; }
`,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    if (trajectories.length === 0) {
      const msg = el("p", "tf-empty");
      msg.textContent = "No sessions selected";
      container.appendChild(msg);
      return;
    }

    const allEvents = trajectories.flatMap((t) => t.events);
    const eventsWithTokens = allEvents.filter((e) => e.tokens && ((e.tokens.input ?? 0) + (e.tokens.output ?? 0) + (e.tokens.cacheRead ?? 0)) > 0);

    if (eventsWithTokens.length === 0) {
      const msg = el("p", "tf-empty");
      msg.textContent = "No token data available in this trajectory";
      container.appendChild(msg);
      return;
    }

    // Build data points sorted by time
    eventsWithTokens.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let cumulative = 0;
    const points: TokenPoint[] = eventsWithTokens.map((e) => {
      const inp = e.tokens?.input ?? 0;
      const out = e.tokens?.output ?? 0;
      const cached = e.tokens?.cacheRead ?? 0;
      cumulative += inp + out + cached;
      return {
        time: new Date(e.timestamp).getTime(),
        label: new Date(e.timestamp).toLocaleTimeString(),
        input: inp,
        output: out,
        cached,
        cumulative,
      };
    });

    // Chart dimensions
    const W = 800;
    const H = 300;
    const PAD = { top: 20, right: 60, bottom: 30, left: 60 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    const tMin = points[0].time;
    const tMax = points[points.length - 1].time;
    const tSpan = tMax - tMin || 1;

    // Stack: cached on bottom, then input, then output on top
    const maxStack = Math.max(...points.map((p) => p.cached + p.input + p.output), 1);
    const maxCum = points[points.length - 1].cumulative || 1;

    function x(t: number): number { return PAD.left + ((t - tMin) / tSpan) * cw; }
    function yStack(v: number): number { return PAD.top + ch - (v / maxStack) * ch; }
    function yCum(v: number): number { return PAD.top + ch - (v / maxCum) * ch; }

    // Build area paths
    function areaPath(getData: (p: TokenPoint) => [number, number]): string {
      const top: string[] = [];
      const bot: string[] = [];
      for (const p of points) {
        const px = x(p.time);
        const [lo, hi] = getData(p);
        top.push(`${px.toFixed(1)},${yStack(hi).toFixed(1)}`);
        bot.unshift(`${px.toFixed(1)},${yStack(lo).toFixed(1)}`);
      }
      return `M${top.join(" L")} L${bot.join(" L")} Z`;
    }

    const cachedPath = areaPath((p) => [0, p.cached]);
    const inputPath = areaPath((p) => [p.cached, p.cached + p.input]);
    const outputPath = areaPath((p) => [p.cached + p.input, p.cached + p.input + p.output]);

    // Cumulative line
    const cumLine = points.map((p) => `${x(p.time).toFixed(1)},${yCum(p.cumulative).toFixed(1)}`).join(" L");

    // Y-axis labels
    const yLabels = [0, Math.round(maxStack / 2), maxStack].map((v) =>
      `<text x="${PAD.left - 8}" y="${yStack(v).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--tv-text-muted, #666)" dominant-baseline="middle">${fmtTokens(v)}</text>`
    ).join("");

    // Cumulative Y-axis labels (right side)
    const yCumLabels = [0, Math.round(maxCum / 2), maxCum].map((v) =>
      `<text x="${W - PAD.right + 8}" y="${yCum(v).toFixed(1)}" text-anchor="start" font-size="10" fill="#ed8936" dominant-baseline="middle">${fmtTokens(v)}</text>`
    ).join("");

    // X-axis labels (first, middle, last)
    const xTicks = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
    const xLabels = xTicks.map((p) =>
      `<text x="${x(p.time).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--tv-text-muted, #666)">${esc(p.label)}</text>`
    ).join("");

    const chartSection = el("div", "tf-section");
    const chartH3 = el("h3");
    chartH3.textContent = "Token Usage Over Time";
    chartSection.appendChild(chartH3);

    const wrap = el("div", "tf-chart-wrap");
    wrap.innerHTML = `
      <svg class="tf-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <path d="${cachedPath}" fill="#9f7aea" opacity="0.6"/>
        <path d="${inputPath}" fill="#4f8ff7" opacity="0.6"/>
        <path d="${outputPath}" fill="#48bb78" opacity="0.6"/>
        <polyline points="${cumLine}" fill="none" stroke="#ed8936" stroke-width="2" stroke-dasharray="4,3"/>
        ${yLabels}
        ${yCumLabels}
        ${xLabels}
      </svg>
    `;

    // Invisible overlay rects for hover
    const tooltip = el("div", "tf-tooltip");
    wrap.appendChild(tooltip);

    const svg = wrap.querySelector("svg")!;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const rectX = i === 0 ? PAD.left : x((points[i - 1].time + p.time) / 2);
      const rectW = i === points.length - 1
        ? W - PAD.right - rectX
        : x(i < points.length - 1 ? (p.time + points[i + 1].time) / 2 : p.time) - rectX;

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", rectX.toFixed(1));
      rect.setAttribute("y", PAD.top.toString());
      rect.setAttribute("width", Math.max(rectW, 2).toFixed(1));
      rect.setAttribute("height", ch.toString());
      rect.setAttribute("fill", "transparent");
      rect.style.cursor = "crosshair";

      rect.addEventListener("mouseenter", () => {
        tooltip.style.display = "block";
        tooltip.textContent = "";
        const lines = [
          p.label,
          `Input: ${fmtTokens(p.input)}`,
          `Output: ${fmtTokens(p.output)}`,
          `Cached: ${fmtTokens(p.cached)}`,
          `Cumulative: ${fmtTokens(p.cumulative)}`,
        ];
        for (const line of lines) {
          const div = el("div");
          div.textContent = line;
          tooltip.appendChild(div);
        }
      });
      rect.addEventListener("mousemove", (ev: MouseEvent) => {
        const bounds = wrap.getBoundingClientRect();
        tooltip.style.left = `${ev.clientX - bounds.left + 12}px`;
        tooltip.style.top = `${ev.clientY - bounds.top - 10}px`;
      });
      rect.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });

      svg.appendChild(rect);
    }

    chartSection.appendChild(wrap);

    // Legend
    const legend = el("div", "tf-legend");
    const legendItems = [
      { label: "Input Tokens", color: "#4f8ff7" },
      { label: "Output Tokens", color: "#48bb78" },
      { label: "Cached Tokens", color: "#9f7aea" },
      { label: "Running Total", color: "#ed8936" },
    ];
    for (const item of legendItems) {
      const li = el("div", "tf-legend-item");
      const dot = el("span", "tf-legend-dot");
      dot.style.background = item.color;
      if (item.label === "Running Total") {
        dot.style.background = "transparent";
        dot.style.borderBottom = `2px dashed ${item.color}`;
        dot.style.height = "0";
        dot.style.marginTop = "6px";
      }
      li.appendChild(dot);
      const lbl = el("span");
      lbl.textContent = item.label;
      li.appendChild(lbl);
      legend.appendChild(li);
    }
    chartSection.appendChild(legend);
    container.appendChild(chartSection);

    // Cumulative stats
    const summary = trajectories.length === 1 && trajectories[0].summary
      ? trajectories[0].summary
      : computeSummary(allEvents);

    const statsSection = el("div", "tf-section");
    const statsH3 = el("h3");
    statsH3.textContent = "Cumulative Stats";
    statsSection.appendChild(statsH3);

    const statsGrid = el("div", "tf-stats");
    const statsData = [
      { label: "Total Input", value: fmtTokens(summary.totalTokens.input), color: "#4f8ff7" },
      { label: "Total Output", value: fmtTokens(summary.totalTokens.output), color: "#48bb78" },
      { label: "Cache Read", value: fmtTokens(summary.totalTokens.cacheRead), color: "#9f7aea" },
      { label: "Cache Write", value: fmtTokens(summary.totalTokens.cacheWrite), color: "#ed8936" },
      { label: "Grand Total", value: fmtTokens(summary.totalTokens.input + summary.totalTokens.output + summary.totalTokens.cacheRead + summary.totalTokens.cacheWrite), color: "var(--tv-text, #e0e0e0)" },
      { label: "Events w/ Tokens", value: eventsWithTokens.length.toString(), color: "var(--tv-text, #e0e0e0)" },
    ];

    for (const stat of statsData) {
      const card = el("div", "tf-stat");
      const val = el("div", "tf-stat-value");
      val.textContent = stat.value;
      val.style.color = stat.color;
      const lbl = el("div", "tf-stat-label");
      lbl.textContent = stat.label;
      card.appendChild(val);
      card.appendChild(lbl);
      statsGrid.appendChild(card);
    }
    statsSection.appendChild(statsGrid);
    container.appendChild(statsSection);
  },
};
