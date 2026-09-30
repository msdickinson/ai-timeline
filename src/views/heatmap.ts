/**
 * Heatmap View — time-based activity density heatmap.
 * X axis: time buckets within session. Y axis: event type.
 * Color intensity = count. Clickable cells filter the timeline.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

const EVENT_TYPES = ["tool_call", "tool_result", "message", "thinking", "error", "system"] as const;
const TYPE_LABELS: Record<string, string> = {
  tool_call: "Tool Calls",
  tool_result: "Tool Results",
  message: "Messages",
  thinking: "Thinking",
  error: "Errors",
  system: "System",
};
const TYPE_COLORS: Record<string, string> = {
  tool_call: "237,137,54",    // orange
  tool_result: "72,187,120",  // green
  message: "79,143,247",      // blue
  thinking: "159,122,234",    // purple
  error: "252,92,101",        // red
  system: "160,174,192",      // gray
};

const BUCKET_COUNT = 30;

interface BucketData {
  startMs: number;
  endMs: number;
  counts: Record<string, number>;
  total: number;
}

export const heatmapView: TrajectoryView = {
  id: "heatmap",
  name: "Heatmap",
  description: "Time-based activity density heatmap with clickable cells",
  icon: "H",
  tier: "advanced",

  css: `
    .hm { font-family: var(--tv-font); padding: 8px 0; }
    .hm-header { font-size: 16px; font-weight: 700; padding: 12px 0; border-bottom: 1px solid var(--tv-border); margin-bottom: 16px; }
    .hm-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
    .hm-grid-wrap { overflow-x: auto; margin-bottom: 20px; }
    .hm-grid { display: grid; gap: 2px; min-width: 600px; }
    .hm-row { display: contents; }
    .hm-label { font-size: 11px; font-family: var(--tv-mono); color: var(--tv-text-secondary); display: flex; align-items: center; padding-right: 8px; white-space: nowrap; min-width: 90px; }
    .hm-cell { border-radius: 3px; cursor: pointer; transition: opacity 0.15s, outline-color 0.15s; min-height: 28px; min-width: 16px; position: relative; display: flex; align-items: center; justify-content: center; font-size: 9px; font-family: var(--tv-mono); color: transparent; }
    .hm-cell:hover { opacity: 0.8; outline: 2px solid var(--tv-text); outline-offset: -1px; color: var(--tv-text); }
    .hm-cell.hm-selected { outline: 2px solid #fbbf24; outline-offset: -1px; }
    .hm-axis { display: grid; gap: 2px; margin-top: 4px; min-width: 600px; }
    .hm-axis-label { font-size: 9px; font-family: var(--tv-mono); color: var(--tv-text-muted); text-align: center; overflow: hidden; text-overflow: ellipsis; }
    .hm-axis-spacer { min-width: 90px; }
    .hm-legend { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .hm-legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; }
    .hm-legend-swatch { width: 14px; height: 14px; border-radius: 3px; }
    .hm-insights { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .hm-insight { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 12px 16px; flex: 1; min-width: 200px; }
    .hm-insight-label { font-size: 10px; color: var(--tv-text-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
    .hm-insight-value { font-size: 14px; font-weight: 700; font-family: var(--tv-mono); }
    .hm-insight-detail { font-size: 11px; color: var(--tv-text-secondary); margin-top: 2px; }
    .hm-filter-bar { background: var(--tv-bg-card); border: 1px solid #fbbf24; border-radius: var(--tv-radius); padding: 10px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
    .hm-filter-text { font-size: 12px; flex: 1; }
    .hm-filter-clear { padding: 4px 10px; border: 1px solid var(--tv-border); border-radius: 4px; background: var(--tv-bg); color: var(--tv-text); cursor: pointer; font-size: 11px; }
    .hm-filter-clear:hover { background: var(--tv-bg-hover); }
    .hm-session-label { font-size: 12px; color: var(--tv-text-muted); margin-bottom: 12px; font-style: italic; }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("hm");

    if (trajectories.length === 0) {
      const empty = el("div", "hm-empty");
      empty.textContent = "No sessions selected";
      container.appendChild(empty);
      return;
    }

    const allEvents = trajectories.flatMap((t) => t.events);
    const timedEvents = allEvents.filter((e) => e.timestamp && !isNaN(new Date(e.timestamp).getTime()));

    if (timedEvents.length < 2) {
      const empty = el("div", "hm-empty");
      empty.textContent = "Not enough timestamped events to build heatmap";
      container.appendChild(empty);
      return;
    }

    const header = el("div", "hm-header");
    header.textContent = "Activity Heatmap";
    container.appendChild(header);

    if (trajectories.length > 1) {
      const label = el("div", "hm-session-label");
      label.textContent = `Combined view of ${trajectories.length} sessions`;
      container.appendChild(label);
    }

    // Build time buckets
    const timestamps = timedEvents.map((e) => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
    const startMs = timestamps[0];
    const endMs = timestamps[timestamps.length - 1];
    const spanMs = endMs - startMs || 1;
    const bucketMs = spanMs / BUCKET_COUNT;

    const buckets: BucketData[] = [];
    for (let i = 0; i < BUCKET_COUNT; i++) {
      buckets.push({
        startMs: startMs + i * bucketMs,
        endMs: startMs + (i + 1) * bucketMs,
        counts: {},
        total: 0,
      });
    }

    // Populate buckets
    const activeTypes = new Set<string>();
    for (const ev of timedEvents) {
      const ms = new Date(ev.timestamp).getTime();
      let idx = Math.floor((ms - startMs) / bucketMs);
      if (idx >= BUCKET_COUNT) idx = BUCKET_COUNT - 1;
      if (idx < 0) idx = 0;
      const type = ev.type;
      buckets[idx].counts[type] = (buckets[idx].counts[type] ?? 0) + 1;
      buckets[idx].total++;
      activeTypes.add(type);
    }

    const typesInUse = EVENT_TYPES.filter((t) => activeTypes.has(t));
    const globalMax = Math.max(...buckets.flatMap((b) => typesInUse.map((t) => b.counts[t] ?? 0)), 1);

    // Find busiest and quietest
    let busiestIdx = 0;
    let quietestIdx = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].total > buckets[busiestIdx].total) busiestIdx = i;
      if (buckets[i].total < buckets[quietestIdx].total) quietestIdx = i;
    }

    // Insights
    const insights = el("div", "hm-insights");

    const busyInsight = el("div", "hm-insight");
    const busyLabel = el("div", "hm-insight-label");
    busyLabel.textContent = "Busiest Period";
    busyInsight.appendChild(busyLabel);
    const busyVal = el("div", "hm-insight-value");
    busyVal.textContent = `${buckets[busiestIdx].total} events`;
    busyInsight.appendChild(busyVal);
    const busyDetail = el("div", "hm-insight-detail");
    busyDetail.textContent = `${fmtTime(buckets[busiestIdx].startMs)} - ${fmtTime(buckets[busiestIdx].endMs)}`;
    busyInsight.appendChild(busyDetail);
    insights.appendChild(busyInsight);

    const quietInsight = el("div", "hm-insight");
    const quietLabel = el("div", "hm-insight-label");
    quietLabel.textContent = "Quietest Period";
    quietInsight.appendChild(quietLabel);
    const quietVal = el("div", "hm-insight-value");
    quietVal.textContent = `${buckets[quietestIdx].total} events`;
    quietInsight.appendChild(quietVal);
    const quietDetail = el("div", "hm-insight-detail");
    quietDetail.textContent = `${fmtTime(buckets[quietestIdx].startMs)} - ${fmtTime(buckets[quietestIdx].endMs)}`;
    quietInsight.appendChild(quietDetail);
    insights.appendChild(quietInsight);

    const totalInsight = el("div", "hm-insight");
    const totalLabel = el("div", "hm-insight-label");
    totalLabel.textContent = "Duration";
    totalInsight.appendChild(totalLabel);
    const totalVal = el("div", "hm-insight-value");
    totalVal.textContent = fmtDuration(spanMs);
    totalInsight.appendChild(totalVal);
    const totalDetail = el("div", "hm-insight-detail");
    totalDetail.textContent = `${timedEvents.length} events across ${BUCKET_COUNT} time slots`;
    totalInsight.appendChild(totalDetail);
    insights.appendChild(totalInsight);

    container.appendChild(insights);

    // Legend
    const legend = el("div", "hm-legend");
    for (const type of typesInUse) {
      const item = el("div", "hm-legend-item");
      const swatch = el("div", "hm-legend-swatch");
      swatch.style.background = `rgb(${TYPE_COLORS[type] ?? "160,174,192"})`;
      item.appendChild(swatch);
      const label = document.createTextNode(TYPE_LABELS[type] ?? type);
      item.appendChild(label);
      legend.appendChild(item);
    }
    container.appendChild(legend);

    // Filter bar (hidden initially)
    const filterBar = el("div", "hm-filter-bar");
    filterBar.style.display = "none";
    const filterText = el("span", "hm-filter-text");
    filterBar.appendChild(filterText);
    const filterClear = el("button", "hm-filter-clear");
    filterClear.textContent = "Clear";
    filterBar.appendChild(filterClear);
    container.appendChild(filterBar);

    let selectedCell: HTMLElement | null = null;

    filterClear.addEventListener("click", () => {
      filterBar.style.display = "none";
      if (selectedCell) selectedCell.classList.remove("hm-selected");
      selectedCell = null;
    });

    // Grid
    const cols = BUCKET_COUNT + 1; // +1 for label column
    const gridWrap = el("div", "hm-grid-wrap");
    const grid = el("div", "hm-grid");
    grid.style.gridTemplateColumns = `90px repeat(${BUCKET_COUNT}, 1fr)`;

    for (const type of typesInUse) {
      const rgb = TYPE_COLORS[type] ?? "160,174,192";

      // Row label
      const label = el("div", "hm-label");
      label.textContent = TYPE_LABELS[type] ?? type;
      grid.appendChild(label);

      // Cells
      for (let i = 0; i < BUCKET_COUNT; i++) {
        const count = buckets[i].counts[type] ?? 0;
        const intensity = count > 0 ? Math.max(0.15, count / globalMax) : 0;

        const cell = el("div", "hm-cell");
        cell.style.background = count > 0 ? `rgba(${rgb},${intensity})` : "var(--tv-bg)";
        cell.title = `${TYPE_LABELS[type] ?? type}: ${count} events\n${fmtTime(buckets[i].startMs)} - ${fmtTime(buckets[i].endMs)}`;
        if (count > 0) cell.textContent = String(count);

        cell.addEventListener("click", () => {
          if (selectedCell) selectedCell.classList.remove("hm-selected");
          if (selectedCell === cell) {
            selectedCell = null;
            filterBar.style.display = "none";
            return;
          }
          selectedCell = cell;
          cell.classList.add("hm-selected");

          filterText.textContent = `${TYPE_LABELS[type] ?? type}: ${count} events between ${fmtTime(buckets[i].startMs)} and ${fmtTime(buckets[i].endMs)}`;
          filterBar.style.display = "flex";
        });

        grid.appendChild(cell);
      }
    }

    gridWrap.appendChild(grid);

    // Time axis
    const axis = el("div", "hm-axis");
    axis.style.gridTemplateColumns = `90px repeat(${BUCKET_COUNT}, 1fr)`;
    const spacer = el("div", "hm-axis-spacer");
    axis.appendChild(spacer);

    for (let i = 0; i < BUCKET_COUNT; i++) {
      const label = el("div", "hm-axis-label");
      // Show every 5th label to avoid crowding
      if (i % 5 === 0 || i === BUCKET_COUNT - 1) {
        label.textContent = fmtTime(buckets[i].startMs);
      }
      axis.appendChild(label);
    }
    gridWrap.appendChild(axis);

    container.appendChild(gridWrap);
  },
};

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
