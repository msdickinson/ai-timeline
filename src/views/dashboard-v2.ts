/**
 * Dashboard — Dense, Grafana-style overview.
 * KPIs, initial prompt, collapsible tool & token sections
 * (tools: performance cards with sparklines; tokens: AI calls bar chart),
 * first+last event log with expandable rows.
 */

import { Trajectory, TrajectoryEvent, computeSummary, getSessionLabel } from "../common/types";
import { estimateCost, formatCost } from "../common/cost";
import { TrajectoryView, ViewOptions } from "../common/registry";

const CSS = `
.dv2 { font-family: var(--tv-font); padding: 8px; }
.dv2-stats-line {
  font-size: 13px; font-family: var(--tv-mono); color: var(--tv-text-secondary);
  padding: 10px 0; margin-bottom: 8px; border-bottom: 1px solid var(--tv-border);
  letter-spacing: 0.2px;
}
.dv2-week-card {
  font-size: 12px; font-family: var(--tv-mono); color: var(--tv-text-secondary);
  padding: 8px 12px; margin-bottom: 8px; background: var(--tv-bg-card);
  border: 1px solid var(--tv-border); border-radius: var(--tv-radius);
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
}
.dv2-week-title { font-weight: 700; color: var(--tv-text); margin-right: 4px; font-family: var(--tv-font); }
.dv2-stats-dot { color: var(--tv-text-muted); margin: 0 4px; }
.dv2-model-line { font-size: 12px; padding: 4px 0 8px; display: flex; gap: 12px; flex-wrap: wrap; }
.dv2-model-chip {
  display: inline-flex; gap: 4px; align-items: baseline; font-family: var(--tv-mono);
  color: var(--tv-text-secondary); background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: 4px; padding: 2px 8px; font-size: 11px;
}
.dv2-model-chip strong { color: var(--tv-text); }
.dv2-stats-err { color: var(--tv-error); font-weight: 600; }
.dv2-stats-prompt {
  color: var(--tv-text-muted); font-style: italic; cursor: pointer;
  max-width: 400px; display: inline-block; vertical-align: bottom;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dv2-stats-prompt:hover { color: var(--tv-text-secondary); }
.dv2-stats-prompt-expanded {
  white-space: pre-wrap; word-break: break-word; max-width: 100%;
  max-height: 200px; overflow-y: auto; display: block; margin-top: 6px;
  padding: 10px 14px; background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: var(--tv-radius); font-style: normal;
  color: var(--tv-text); font-size: 13px; line-height: 1.6;
}

.dv2-detail-toggle { text-align: center; margin: 8px 0; }
.dv2-detail-toggle-btn {
  background: none; border: 1px solid var(--tv-border); border-radius: var(--tv-radius);
  padding: 6px 16px; font-size: 12px; color: var(--tv-text-secondary); cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.dv2-detail-toggle-btn:hover { border-color: var(--tv-accent); color: var(--tv-accent); }
.dv2-mid { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.dv2-section {
  flex: 1; min-width: 280px; background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: var(--tv-radius); overflow: hidden;
}

/* Mini Gantt */
.dv2-gantt {
  background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: var(--tv-radius); margin-bottom: 12px; overflow: hidden;
}
.dv2-gantt-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px;
}
.dv2-gantt-header h4 {
  margin: 0; font-size: 12px; text-transform: uppercase;
  color: var(--tv-text-muted); letter-spacing: 0.5px;
}
.dv2-gantt-times { font-size: 10px; color: var(--tv-text-muted); font-family: var(--tv-mono); }
.dv2-gantt-lane {
  display: flex; align-items: center; height: 24px; border-bottom: 1px solid var(--tv-border);
}
.dv2-gantt-lane:last-of-type { border-bottom: none; }
.dv2-gantt-lane-label {
  width: 90px; flex-shrink: 0; font-size: 10px; font-weight: 700;
  padding: 0 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dv2-gantt-track {
  flex: 1; position: relative; height: 100%; background: var(--tv-bg);
  overflow: hidden;
}
.dv2-gantt-bar {
  position: absolute; top: 3px; bottom: 3px; min-width: 2px;
  border-radius: 2px; opacity: 0.85;
}
.dv2-gantt-bar:hover { opacity: 1; }
.dv2-gantt:hover { border-color: var(--tv-accent); }
.dv2-gantt-legend {
  display: flex; gap: 10px; padding: 6px 14px; font-size: 10px; color: var(--tv-text-muted);
}
.dv2-gantt-legend-item { display: flex; align-items: center; gap: 3px; }
.dv2-gantt-legend-dot { width: 8px; height: 8px; border-radius: 2px; }

/* Stacked bar */
.dv2-stacked-bar { display: flex; height: 28px; border-radius: 4px; overflow: hidden; }
.dv2-stacked-seg { position: relative; min-width: 2px; transition: opacity 0.15s; cursor: default; }
.dv2-stacked-seg:hover { opacity: 0.8; }
.dv2-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 11px; }
.dv2-legend-item { display: flex; align-items: center; gap: 4px; }

/* Tool perf cards */
.dv2-tool-cards { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.dv2-tool-card {
  flex: 1 1 140px; max-width: 200px; min-width: 120px; background: var(--tv-bg);
  border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 10px;
}
.dv2-tool-card-name { font-weight: 700; font-family: var(--tv-mono); font-size: 12px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dv2-tool-card-stats { font-size: 10px; color: var(--tv-text-secondary); line-height: 1.6; }
.dv2-tool-card-stats .dv2-tc-err { color: var(--tv-error); font-weight: 600; }
.dv2-tool-card-stats .dv2-tc-p95 { color: #ed8936; }
.dv2-tool-card-stats .dv2-tc-max { color: #fc5c65; }
.dv2-spark { margin-top: 4px; display: block; }

/* View toggle tabs */
.dv2-tabs { display: flex; gap: 2px; margin-top: 10px; margin-bottom: 6px; }
.dv2-tab {
  padding: 3px 10px; font-size: 10px; border: 1px solid var(--tv-border);
  border-radius: 3px; background: var(--tv-bg); color: var(--tv-text-secondary);
  cursor: pointer; text-transform: uppercase; letter-spacing: 0.3px;
}
.dv2-tab:hover { background: var(--tv-bg-hover); }
.dv2-tab.active { background: var(--tv-accent); color: #fff; border-color: var(--tv-accent); }

/* Count table (toggle) */
.dv2-tool-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11px; }
.dv2-tool-table th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--tv-border); color: var(--tv-text-muted); font-weight: 600; }
.dv2-tool-table td { padding: 4px 8px; border-bottom: 1px solid var(--tv-border); font-family: var(--tv-mono); }
.dv2-tool-table .dv2-bar-cell { width: 40%; }
.dv2-tool-bar { height: 14px; border-radius: 2px; min-width: 2px; }

/* AI calls mini chart */
/* Chart wrapper — adds horizontal scroll when there are more calls than fit. */
.dv2-ai-chart-wrap { position: relative; }
.dv2-ai-chart-wrap.dv2-ai-overflow::after {
  content: "scroll →";
  position: absolute; right: 4px; top: 4px;
  font-size: 10px; color: var(--tv-text-muted);
  background: linear-gradient(to right, transparent, var(--tv-bg-card) 30%);
  padding: 2px 6px 2px 18px;
  pointer-events: none;
  border-radius: 2px;
}
.dv2-ai-chart {
  display: flex; align-items: flex-end; gap: 1px; height: 70px; margin-top: 10px;
  overflow-x: auto; overflow-y: hidden;
  scrollbar-width: thin;
}
.dv2-ai-chart::-webkit-scrollbar { height: 6px; }
.dv2-ai-chart::-webkit-scrollbar-thumb { background: var(--tv-border); border-radius: 3px; }
.dv2-ai-bar {
  flex: 0 0 3px; min-width: 3px; max-width: 10px; border-radius: 1px 1px 0 0;
  background: #4f8ff7; cursor: default; position: relative;
}
.dv2-ai-bar:hover { opacity: 0.8; }
.dv2-ai-bar-cached { position: absolute; bottom: 0; left: 0; right: 0; background: #48bb78; border-radius: 0; }
.dv2-ai-chart-legend {
  display: flex; gap: 12px; font-size: 10px; color: var(--tv-text-muted); margin-top: 4px; justify-content: flex-end;
}
.dv2-ai-chart-legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 3px; }
.dv2-ai-stats { display: flex; gap: 14px; font-size: 11px; color: var(--tv-text-secondary); margin-top: 8px; flex-wrap: wrap; }
.dv2-ai-stats strong { color: var(--tv-text); }
.dv2-ai-stats .dv2-green { color: #48bb78; }
.dv2-ai-stats .dv2-blue { color: #4f8ff7; }

/* Donut */
.dv2-donut-wrap { display: flex; align-items: center; gap: 16px; margin-top: 10px; }
.dv2-donut-legend { font-size: 11px; line-height: 1.8; }
.dv2-donut-legend-row { display: flex; align-items: center; gap: 6px; }
.dv2-legend-swatch { width: 10px; height: 10px; border-radius: 2px; }

/* Event table */
.dv2-events { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); overflow: hidden; }
.dv2-events-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--tv-border);
}
.dv2-events-header h4 { margin: 0; font-size: 12px; text-transform: uppercase; color: var(--tv-text-muted); letter-spacing: 0.5px; }
.dv2-events-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dv2-events-table thead { position: sticky; top: 0; z-index: 10; }
.dv2-events-table th {
  background: var(--tv-bg-card); border-bottom: 2px solid var(--tv-border); padding: 8px 12px;
  text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.3px; color: var(--tv-text-secondary); cursor: pointer; user-select: none; white-space: nowrap;
}
.dv2-events-table th:hover { color: var(--tv-text); }
.dv2-events-table .dv2-evc-time { width: 95px; }
.dv2-events-table .dv2-evc-type { width: 95px; }
.dv2-events-table .dv2-evc-role { width: 85px; }
.dv2-events-table .dv2-evc-tool { width: 90px; }
.dv2-events-table .dv2-evc-tokens { width: 80px; text-align: right; }
.dv2-events-table .dv2-evc-duration { width: 90px; text-align: right; }
.dv2-events-table td.dv2-evc-tokens { text-align: right; }
.dv2-events-table td.dv2-evc-duration { text-align: right; }
.dv2-events-table td { padding: 6px 12px; border-bottom: 1px solid var(--tv-border); vertical-align: top; white-space: nowrap; }
.dv2-events-table tbody tr { cursor: pointer; }
.dv2-events-table tbody tr:hover { background: var(--tv-bg-hover); }
.dv2-events-table tbody tr:nth-child(even) { background: var(--tv-bg-card); }
.dv2-events-table tbody tr.dv2-ev-err { background: color-mix(in srgb, var(--tv-error) 8%, transparent); }
.dv2-events-table .dv2-ev-content { max-width: 500px; overflow: hidden; text-overflow: ellipsis; font-family: var(--tv-mono); font-size: 11px; color: var(--tv-text-secondary); }
.dv2-ev-badge {
  display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 600;
  background: var(--tv-bg-hover); color: var(--tv-text-secondary);
}
.dv2-ev-badge.dv2-ev-tool_call { background: #ed8936; color: #fff; }
.dv2-ev-badge.dv2-ev-tool_result { background: #4f8ff7; color: #fff; }
.dv2-ev-badge.dv2-ev-error { background: var(--tv-error); color: #fff; }
.dv2-ev-badge.dv2-ev-thinking { background: #9f7aea; color: #fff; }
.dv2-ev-count-badge { background: var(--tv-accent); color: #fff; font-size: 10px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.dv2-ev-filter-row th { padding: 6px 12px; background: var(--tv-bg); border-bottom: 1px solid var(--tv-border); }
.dv2-ev-filter {
  width: 100%; box-sizing: border-box; padding: 4px 8px; font-size: 11px;
  border: 1px solid var(--tv-border); border-radius: 3px; background: var(--tv-bg-card);
  color: var(--tv-text); font-family: var(--tv-mono);
}
.dv2-ev-filter::placeholder { color: var(--tv-text-muted); }
.dv2-ev-expand {
  display: none; padding: 0;
}
.dv2-ev-expand pre {
  margin: 0; padding: 8px 12px; font-size: 10px; font-family: var(--tv-mono);
  white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto;
  background: var(--tv-bg); color: var(--tv-text-secondary);
}
.dv2-ev-expand.open { display: table-row; }
.dv2-events-wrap { overflow-x: auto; max-height: 380px; overflow-y: auto; border: 1px solid var(--tv-border); border-radius: var(--tv-radius); }

.dv2-multi { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 10px 14px; margin-bottom: 12px; font-size: 12px; color: var(--tv-text-secondary); }

/* Comparison table */
.dv2-cmp { overflow-x: auto; }
.dv2-cmp-title { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.dv2-cmp-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: var(--tv-mono); }
.dv2-cmp-table th {
  text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.3px; color: var(--tv-text-muted);
  border-bottom: 2px solid var(--tv-border); white-space: nowrap;
  position: sticky; top: 0; background: var(--tv-bg-card); z-index: 1; cursor: pointer;
}
.dv2-cmp-table th:hover { color: var(--tv-text); }
.dv2-cmp-table td { padding: 6px 12px; border-bottom: 1px solid var(--tv-border); white-space: nowrap; }
.dv2-cmp-table tbody tr:hover { background: var(--tv-bg-hover); }
.dv2-cmp-table tbody tr:nth-child(even) { background: var(--tv-bg-card); }
.dv2-cmp-table .dv2-cmp-label { font-family: var(--tv-font); font-weight: 600; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.dv2-cmp-table .dv2-cmp-num { text-align: right; }
.dv2-cmp-table .dv2-cmp-model {
  font-size: 11px; color: var(--tv-text-secondary);
  font-family: var(--tv-mono); white-space: nowrap;
}
.dv2-cmp-table .dv2-cmp-err { color: var(--tv-error); }
.dv2-cmp-table .dv2-cmp-good { color: #48bb78; }
.dv2-cmp-table .dv2-cmp-bad { color: var(--tv-error); }
.dv2-cmp-delta { font-size: 10px; margin-left: 4px; }
.dv2-cmp-wrap {
  max-height: 70vh;
  overflow-y: auto;
  /* Horizontal scroll on narrow viewports — the table has up to 9 columns
     plus the per-agent breakdown indents, so it overflows below ~720px.
     Wrapping the table in a scroll container keeps every column readable
     instead of squishing them into illegible <50px slots. */
  overflow-x: auto;
  border: 1px solid var(--tv-border); border-radius: var(--tv-radius);
}
@media (max-width: 720px) {
  .dv2-cmp-table { font-size: 11px; }
  .dv2-cmp-table th, .dv2-cmp-table td { padding: 4px 8px; }
  .dv2-cmp-table .dv2-cmp-label { max-width: 140px; }
}
.dv2-cmp-table .dv2-cmp-subagent-row td { background: rgba(0, 0, 0, 0.18); color: var(--tv-text-secondary); font-size: 11px; }
.dv2-cmp-table tbody tr.dv2-cmp-subagent-row:nth-child(even) { background: rgba(0, 0, 0, 0.22); }
.dv2-cmp-subagent-badge {
  font-size: 9px; padding: 1px 6px; border-radius: 3px;
  background: rgba(159, 122, 234, 0.18); color: #b794f4;
  font-family: var(--tv-font); font-weight: 600; white-space: nowrap;
}
.dv2-cmp-direct-badge {
  font-size: 9px; padding: 1px 6px; border-radius: 3px;
  background: rgba(72, 187, 120, 0.18); color: #68d391;
  font-family: var(--tv-font); font-weight: 600; white-space: nowrap;
}
.dv2-cmp-caret { color: var(--tv-text-muted); font-size: 11px; user-select: none; width: 10px; display: inline-block; }
.dv2-cmp-subagent-count {
  font-size: 10px; padding: 1px 6px; border-radius: 8px;
  background: rgba(79, 143, 247, 0.16); color: #4f8ff7;
  font-weight: 600;
}

/* Cost breakdown disclosure */
.dv2-cost-stat { display: inline-flex; align-items: center; gap: 4px; }
.dv2-cost-info { display: inline-block; position: relative; }
.dv2-cost-info > summary {
  list-style: none; cursor: pointer; user-select: none;
  font-size: 14px; color: var(--tv-text-muted); padding: 2px 6px; border-radius: 3px;
}
.dv2-cost-info > summary::-webkit-details-marker { display: none; }
.dv2-cost-info > summary:hover { color: var(--tv-text); background: var(--tv-bg-hover); }
.dv2-cost-info-panel {
  position: absolute; top: 100%; right: 0; z-index: 100;
  margin-top: 6px; min-width: 720px; max-width: 1100px;
  background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: var(--tv-radius); padding: 18px 22px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  font-size: 14px; line-height: 1.5; color: var(--tv-text-secondary);
  cursor: default;
}
.dv2-cost-info-head {
  font-size: 14px; font-weight: 700; color: var(--tv-text); margin-bottom: 12px;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.dv2-cost-info-foot {
  font-size: 13px; color: var(--tv-text-muted); margin-top: 14px;
  padding-top: 12px; border-top: 1px dashed var(--tv-border);
  line-height: 1.55;
}
.dv2-cost-info-foot strong { color: var(--tv-text-secondary); }
.dv2-cost-table {
  width: 100%; border-collapse: collapse; font-family: var(--tv-mono);
  font-size: 13px;
}
.dv2-cost-table th {
  text-align: left; padding: 8px 10px; color: var(--tv-text-muted);
  border-bottom: 1px solid var(--tv-border); font-weight: 600;
  text-transform: uppercase; font-size: 11px; letter-spacing: 0.4px;
}
.dv2-cost-table td {
  padding: 10px 12px; border-bottom: 1px solid var(--tv-border);
  vertical-align: top;
}
.dv2-cost-table tr:last-child td { border-bottom: none; }
.dv2-cost-table code {
  background: var(--tv-bg); padding: 2px 5px; border-radius: 2px; font-size: 12px;
}

/* Insights card */
.dv2-insights {
  background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-left: 4px solid var(--tv-accent);
  border-radius: var(--tv-radius); padding: 14px 18px; margin-bottom: 12px;
}
.dv2-insights h4 {
  margin: 0 0 8px; font-size: 12px; text-transform: uppercase;
  color: var(--tv-text-muted); letter-spacing: 0.5px;
}

/* Takeaways — top-of-dashboard data-backed findings + actions */
.dv2-takeaways {
  background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-left: 4px solid #f7b731;
  border-radius: var(--tv-radius);
  padding: 14px 20px; margin-bottom: 14px;
}
.dv2-takeaways-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px; flex-wrap: wrap; gap: 8px;
}
.dv2-takeaways-title {
  font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.6px; color: #f7b731;
}
.dv2-takeaways-sub { font-size: 11px; color: var(--tv-text-muted); font-family: var(--tv-mono); }
.dv2-takeaways-list {
  margin: 0; padding-left: 26px; display: flex; flex-direction: column; gap: 12px;
}
.dv2-takeaway { line-height: 1.5; }
.dv2-takeaway-fact { font-size: 14px; color: var(--tv-text); line-height: 1.55; }
.dv2-takeaway-fact strong { color: #fff; font-weight: 700; }
.dv2-takeaway-fact code {
  background: var(--tv-bg); padding: 1px 5px; border-radius: 3px;
  font-size: 12px; color: var(--tv-accent);
}
/* Structured fact — used by takeaways with multiple findings */
.dv2-takeaway-headline {
  margin-bottom: 8px;
}
.dv2-takeaway-section-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.6px;
  text-transform: uppercase; color: var(--tv-text-muted);
  margin: 10px 0 4px;
}
.dv2-takeaway-findings {
  margin: 0; padding-left: 22px;
  display: flex; flex-direction: column; gap: 6px;
}
.dv2-takeaway-findings li {
  font-size: 13px; line-height: 1.5;
}
.dv2-takeaway-note {
  margin-top: 6px; font-size: 13px; line-height: 1.5;
  color: var(--tv-text-secondary); font-style: italic;
}
.dv2-takeaway-action {
  font-size: 12px; color: var(--tv-text-secondary); margin-top: 4px;
  padding-left: 2px;
}
.dv2-takeaway-strip {
  margin-top: 6px; padding: 4px 8px; border-radius: 3px;
  font-size: 11px; line-height: 1.4; color: var(--tv-text-secondary);
  font-family: var(--tv-mono);
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.dv2-takeaway-strip-trend { background: rgba(79, 143, 247, 0.10); border-left: 2px solid #4f8ff7; }
.dv2-takeaway-strip-model { background: rgba(72, 187, 120, 0.10); border-left: 2px solid #48bb78; }
.dv2-takeaway-strip-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.6px; color: var(--tv-text-muted);
  padding: 1px 5px; border-radius: 2px; background: rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}
.dv2-takeaway-strip strong { color: var(--tv-text); }
.dv2-takeaway-trend-arrow {
  font-weight: 700; font-size: 13px; color: var(--tv-text);
}
.dv2-takeaway-items {
  margin-top: 8px; padding: 8px 12px; background: rgba(0, 0, 0, 0.18);
  border-radius: 4px; border: 1px solid var(--tv-border);
}
.dv2-takeaway-items-title {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
  color: var(--tv-text-muted); font-weight: 600; margin-bottom: 4px;
}
.dv2-takeaway-items-list { list-style: none; margin: 0; padding: 0; }
.dv2-takeaway-items-list li {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; padding: 2px 0; gap: 12px;
}
.dv2-takeaway-item-label {
  font-family: var(--tv-mono); color: var(--tv-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.dv2-takeaway-item-meta {
  font-family: var(--tv-mono); font-size: 11px; color: var(--tv-text-muted);
  flex-shrink: 0;
}
.dv2-takeaway-arrow { color: #f7b731; font-weight: 700; margin-right: 4px; }
.dv2-takeaways-more {
  margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--tv-border);
}
.dv2-takeaways-more > summary {
  font-size: 11px; color: var(--tv-accent); cursor: pointer;
  list-style: none; user-select: none;
}
.dv2-takeaways-more > summary::-webkit-details-marker { display: none; }
.dv2-takeaways-more > summary:hover { text-decoration: underline; }
.dv2-takeaways-more .dv2-takeaways-list { margin-top: 10px; }
/* Time breakdown bar */
.dv2-time-bar-wrap {
  background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: var(--tv-radius); padding: 10px 16px; margin-bottom: 12px;
}
/* Response-time vs context-size scatter */
.dv2-ctxlat-wrap {
  background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: var(--tv-radius); padding: 10px 16px; margin-bottom: 12px;
}
.dv2-ctxlat-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.dv2-ctxlat-title {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--tv-text-muted); font-weight: 600;
}
.dv2-ctxlat-sub { font-size: 10px; color: var(--tv-text-muted); font-family: var(--tv-mono); }
.dv2-ctxlat-svg { display: block; width: 100%; }
.dv2-ctxlat-summary {
  font-size: 12px; color: var(--tv-text-secondary); padding: 6px 0 4px;
  line-height: 1.45;
}
.dv2-ctxlat-summary strong { color: var(--tv-text); }
.dv2-ctxlat-legend {
  display: flex; flex-wrap: wrap; gap: 14px; padding: 4px 0 2px;
  font-size: 10px; color: var(--tv-text-muted);
}
.dv2-ctxlat-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.dv2-ctxlat-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; opacity: 0.6; }
.dv2-ctxlat-line { width: 14px; height: 2px; display: inline-block; }
.dv2-ctxlat-line.dashed {
  background: transparent !important;
  border-top: 1.5px dashed #ed8936;
  width: 14px; height: 0;
}
.dv2-ctxlat-chart-host { min-height: 260px; }
.dv2-ctxlat-svg-wrap { display: flex; flex-direction: column; gap: 4px; }
.dv2-ctxlat-empty {
  height: 240px; display: flex; align-items: center; justify-content: center;
  color: var(--tv-text-muted); font-size: 12px;
}
.dv2-time-bar-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
}
.dv2-time-bar-title {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--tv-text-muted); font-weight: 600;
}
.dv2-time-bar-total { font-size: 11px; color: var(--tv-text-muted); font-family: var(--tv-mono); }
.dv2-time-bar { display: flex; height: 24px; border-radius: 4px; overflow: hidden; }
.dv2-time-bar-thin { height: 12px; }
.dv2-time-seg { min-width: 2px; position: relative; transition: opacity 0.15s; cursor: default; }
.dv2-time-seg:hover { opacity: 0.8; }
.dv2-time-legend {
  display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 11px; color: var(--tv-text-secondary);
}
.dv2-time-legend-item { display: flex; align-items: center; gap: 4px; }
.dv2-time-legend-dot { width: 10px; height: 10px; border-radius: 2px; }
.dv2-time-ratio-wrap { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--tv-border); }
.dv2-time-ratio-title {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
  color: var(--tv-text-muted); margin-bottom: 4px;
}

.dv2-insight-hero {
  font-size: 16px; line-height: 1.5; color: var(--tv-text);
  margin-bottom: 8px;
}
.dv2-insight-hero strong { color: var(--tv-accent); font-size: 18px; }
.dv2-insights ul { margin: 0; padding: 0 0 0 18px; }
.dv2-insights li {
  font-size: 12px; line-height: 1.7; color: var(--tv-text-secondary);
}
.dv2-insights li strong { color: var(--tv-text); }

/* Reply / AI-turn latency tornado */
.dv2-latency-tornado { margin-top: 12px; }
.dv2-lt-head {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  font-size: 11px; color: var(--tv-text-secondary);
  margin-bottom: 8px;
}
.dv2-lt-head strong { color: var(--tv-text); font-size: 12px; }
.dv2-lt-head-label { display: inline-flex; align-items: center; gap: 5px; color: var(--tv-text-muted); }
.dv2-lt-head-sep { margin: 0 8px; opacity: 0.5; }
.dv2-lt-swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.dv2-lt-swatch.dv2-lt-ai { background: #4f8ff7; }
.dv2-lt-swatch.dv2-lt-user { background: #ed8936; }
.dv2-lt-grid {
  display: grid;
  /* row 1 (AI bars) and row 3 (cond bars / lines) stretch; axis row sits fit-content */
  grid-template-rows: 1fr auto 1fr;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  padding: 4px 6px;
  flex: 1; min-height: 0;
}
.dv2-lt-cell {
  height: 100%; min-height: 40px;
  position: relative; display: flex; padding: 1px 2px;
}
.dv2-lt-cell-ai { align-items: flex-end; }
.dv2-lt-cell-user { align-items: flex-start; }
.dv2-lt-bar {
  width: 100%; min-height: 1px; border-radius: 2px;
  position: relative; display: flex; align-items: flex-end; justify-content: center;
}
.dv2-lt-bar.dv2-lt-ai { background: #4f8ff7; }
.dv2-lt-bar.dv2-lt-user { background: #ed8936; }
.dv2-lt-cell-ai .dv2-lt-bar { border-radius: 2px 2px 0 0; }
.dv2-lt-cell-user .dv2-lt-bar { border-radius: 0 0 2px 2px; align-items: flex-start; }
.dv2-lt-pct {
  position: absolute; left: 50%; transform: translateX(-50%);
  font-size: 9px; font-weight: 600; color: var(--tv-text); white-space: nowrap;
  background: var(--tv-bg-card); padding: 0 3px; border-radius: 2px;
  pointer-events: none;
}
.dv2-lt-cell-ai .dv2-lt-pct { top: -12px; }
.dv2-lt-cell-user .dv2-lt-pct { bottom: -12px; }
.dv2-lt-axis-cell {
  font-size: 10px; color: var(--tv-text-muted); text-align: center;
  padding: 4px 0; border-top: 1px solid var(--tv-border);
  border-bottom: 1px solid var(--tv-border);
  font-family: var(--tv-mono);
  background: rgba(0, 0, 0, 0.1);
}

/* Conditional bars view — side-by-side mini reply-bucket bars under each AI column */
.dv2-lt-cond-wrap { display: flex; flex-direction: column; gap: 8px; }
.dv2-lt-cell-cond {
  align-items: stretch; flex-direction: column; gap: 2px; padding: 1px 2px;
}
.dv2-lt-cond-group {
  width: 100%; flex: 1; min-height: 30px;
  display: flex; align-items: flex-end; gap: 1px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 0 0 2px 2px;
  padding: 0 1px;
}
.dv2-lt-cond-slot {
  flex: 1 1 0; height: 100%;
  display: flex; align-items: flex-end; justify-content: center;
  min-width: 0;
}
.dv2-lt-cond-mini {
  width: 100%; min-height: 0; position: relative;
  display: flex; align-items: flex-start; justify-content: center;
  border-radius: 1px 1px 0 0;
}
.dv2-lt-cond-pct {
  font-size: 8px; font-weight: 700; color: #fff; white-space: nowrap;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.85);
  pointer-events: none; line-height: 1;
  padding-top: 1px;
}
.dv2-lt-cond-n {
  font-size: 9px; color: var(--tv-text-muted);
  font-family: var(--tv-mono); text-align: center; width: 100%;
}
.dv2-lt-cond-empty {
  width: 100%; flex: 1; min-height: 30px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--tv-text-muted);
  background: rgba(0, 0, 0, 0.1); border-radius: 0 0 2px 2px;
}
/* Per-column mini line graphs (View 1b) */
.dv2-lt-line-cell {
  width: 100%; height: 48px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 0 0 2px 2px;
  display: block;
}
.dv2-lt-line-mini {
  width: 100%; height: 100%; display: block;
}
.dv2-lt-cond-legend {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  font-size: 10px; color: var(--tv-text-muted);
  padding: 4px 6px;
}
.dv2-lt-cond-legend-label { font-weight: 600; color: var(--tv-text-secondary); }
.dv2-lt-cond-legend-item {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--tv-mono);
}
.dv2-lt-cond-legend-swatch {
  width: 10px; height: 10px; border-radius: 2px; display: inline-block;
}
.dv2-lt-toggle {
  display: flex; gap: 2px; margin: 8px 0; flex-wrap: wrap;
}
.dv2-lt-toggle-btn {
  padding: 3px 10px; font-size: 11px;
  border: 1px solid var(--tv-border); border-radius: 3px;
  background: var(--tv-bg); color: var(--tv-text-secondary);
  cursor: pointer; font-family: inherit;
}
.dv2-lt-toggle-btn:hover { background: var(--tv-bg-hover); color: var(--tv-text); }
.dv2-lt-toggle-active, .dv2-lt-toggle-active:hover {
  background: var(--tv-accent); color: #fff; border-color: var(--tv-accent);
}
/* Fixed-height chart host so toggling between Bars / Strip / Density /
 * Scatter doesn't reflow the page, plus inner views are flex-1 so they
 * actually FILL the space instead of leaving dead air below. */
.dv2-lt-chart-host {
  background: rgba(0, 0, 0, 0.15); border-radius: 4px; padding: 6px 8px;
  height: 260px;
  display: flex; flex-direction: column;
}
/* Bars wrapper + SVG wrapper both fill the host vertically */
.dv2-lt-chart-host > .dv2-lt-cond-wrap,
.dv2-lt-chart-host > .dv2-lt-svg-wrap { flex: 1; min-height: 0; }
.dv2-lt-svg-wrap { display: flex; flex-direction: column; gap: 4px; }
.dv2-lt-svg { display: block; }
.dv2-lt-cap { font-size: 11px; color: var(--tv-text-muted); padding: 2px 4px; }
`;

const TOOL_COLORS = ["#4f8ff7", "#48bb78", "#ed8936", "#9f7aea", "#fc5c65", "#a0aec0", "#38b2ac", "#e53e3e", "#d69e2e", "#667eea"];
const TOKEN_COLORS: Record<string, string> = { Input: "#4f8ff7", Output: "#48bb78", "Cache Read": "#9f7aea", "Cache Write": "#ed8936" };

export const dashboardV2View: TrajectoryView = {
  id: "dashboard",
  name: "Dashboard",
  description: "Dense Grafana-style dashboard: KPIs, initial prompt, collapsible tools & tokens, event log",
  icon: "\u2261",
  tier: "core",
  css: CSS,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("dv2");

    if (trajectories.length === 0) {
      const p = document.createElement("p");
      p.style.cssText = "padding:40px;text-align:center;color:var(--tv-text-muted)";
      p.textContent = "No sessions selected";
      container.appendChild(p);
      return;
    }

    if (trajectories.length > 1) {
      buildMultiSessionDashboard(container, trajectories, options);
      return;
    }

    // Weekly stats card — aggregate from all loaded sessions
    const allLoaded = options.allTrajectories ?? trajectories;
    if (allLoaded.length > 1) {
      const weekCard = buildWeeklyStats(allLoaded);
      if (weekCard) container.appendChild(weekCard);
    }

    const allEvents = trajectories.flatMap(t => t.events);
    const summary = computeSummary(allEvents);

    // Stats line — compact, one row, reference numbers
    // userMsgCount = real prompts the human typed (ignoring IDE / hook /
    // task-notification noise that Anthropic also tags as role:"user").
    const userMsgCount = allEvents.filter(isHumanUserMessage).length;
    const compactCount = (summary.compactionCount ?? 0) || allEvents.filter(e => e.contextCompacted).length;
    // Stats line 1 — duration, tokens, cost (the "what happened" summary)
    const statsLine = document.createElement("div");
    statsLine.className = "dv2-stats-line";

    const costEst = estimateCost(allEvents);
    const stats = [
      fmtDur(summary.durationMs),
      summary.totalToolCalls.toLocaleString() + " tools",
      fmtTok(summary.totalTokens.output) + " output",
    ].filter(Boolean);

    // Secondary details — only show if notable
    const secondaryStats = [
      summary.errorCount > 0 ? `${summary.errorCount} retries` : null,
      compactCount > 0 ? `<span title="Context was compressed to fit the conversation window">${compactCount} compaction${compactCount > 1 ? "s" : ""}</span>` : null,
    ].filter(Boolean);

    const allStats = [...stats, ...secondaryStats];
    statsLine.innerHTML = allStats.join(' <span class="dv2-stats-dot">&middot;</span> ');

    container.appendChild(statsLine);

    // Stats line 2 — first user prompt (the "what was I doing" context)
    const firstUserMsg = allEvents.find(e => e.role === "user" && e.content && isHumanPrompt(e.content));
    const promptText = firstUserMsg?.content?.trim() ?? "";
    const promptPreview = promptText.split("\n")[0].slice(0, 120);

    if (promptPreview) {
      const promptLine = document.createElement("div");
      promptLine.className = "dv2-stats-line";
      promptLine.style.marginTop = "2px";
      const promptSpan = `<span class="dv2-stats-prompt" title="Click to expand">${esc(promptPreview)}${promptText.length > promptPreview.length ? "..." : ""}</span>`;
      promptLine.innerHTML = promptSpan;

      // Click prompt to expand/collapse full text
      const promptEl = promptLine.querySelector(".dv2-stats-prompt");
      if (promptEl) {
        let expanded = false;
        promptEl.addEventListener("click", () => {
          expanded = !expanded;
          if (expanded) {
            (promptEl as HTMLElement).textContent = promptText;
            (promptEl as HTMLElement).classList.add("dv2-stats-prompt-expanded");
          } else {
            (promptEl as HTMLElement).textContent = promptPreview + (promptText.length > promptPreview.length ? "..." : "");
            (promptEl as HTMLElement).classList.remove("dv2-stats-prompt-expanded");
          }
        });
      }
      container.appendChild(promptLine);
    }

    // Model usage breakdown
    const modelTokens = new Map<string, number>();
    for (const ev of allEvents) {
      if (ev.model && ev.tokens?.output) {
        modelTokens.set(ev.model, (modelTokens.get(ev.model) ?? 0) + ev.tokens.output);
      }
    }
    if (modelTokens.size > 0) {
      const totalOut = [...modelTokens.values()].reduce((s, v) => s + v, 0);
      const modelLine = document.createElement("div");
      modelLine.className = "dv2-model-line";
      const parts: string[] = [];
      const sorted = [...modelTokens.entries()].sort((a, b) => b[1] - a[1]);
      for (const [model, tokens] of sorted) {
        const pct = totalOut > 0 ? Math.round((tokens / totalOut) * 100) : 0;
        parts.push(`<span class="dv2-model-chip"><strong>${esc(model)}</strong> ${fmtTok(tokens)} (${pct}%)</span>`);
      }
      modelLine.innerHTML = parts.join(" ");
      container.appendChild(modelLine);
    }

    // (Takeaways moved to the dedicated Insights view — keeps the main
    //  Dashboard scannable and gives findings room to breathe.)

    // Auto-insights
    const insights = buildInsights(allEvents, summary);
    if (insights) container.appendChild(insights);

    // Mini Gantt timeline + time breakdown (paired — summary of the timeline)
    // Click timeline to switch to full Timeline view
    const gantt = buildMiniGantt(trajectories);
    if (gantt) {
      gantt.style.cursor = "pointer";
      gantt.title = "Click to open full Timeline view";
      gantt.addEventListener("click", () => {
        options.onStateChange({ switchView: "gantt" });
      });
      container.appendChild(gantt);
    }
    // Response time vs context size — "is the AI getting slower as
    // the conversation grows?" Hidden when there's not enough data.
    const ctxLatChart = buildContextLatencyChart(trajectories);
    if (ctxLatChart) container.appendChild(ctxLatChart);

    const timeBar = buildTimeBreakdown(allEvents);
    if (timeBar) container.appendChild(timeBar);

    // Middle row: Tool Usage + Token Breakdown — collapsed by default
    const mid = document.createElement("div");
    mid.className = "dv2-mid";
    mid.appendChild(buildToolSection(trajectories, summary.toolCallCounts));
    mid.appendChild(buildTokenSection(allEvents, summary.totalTokens));
    container.appendChild(mid);

    container.appendChild(buildEventTable(allEvents));
  },
};

// ── Multi-Session Dashboard ──────────────────────────────────────────

function buildMultiSessionDashboard(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
  const n = trajectories.length;

  // Per-session summaries
  const summaries = trajectories.map(t => t.summary ?? computeSummary(t.events));
  const allEvents = trajectories.flatMap(t => t.events);
  const aggSummary = computeSummary(allEvents);

  // Per-session metrics
  const durations = summaries.map(s => s.durationMs);
  const toolCounts = summaries.map(s => s.totalToolCalls);
  const errorCounts = summaries.map(s => s.errorCount);
  const outputToks = summaries.map(s => s.totalTokens.output);
  // Count only real human prompts — exclude IDE/hook/task-notification
  // role:"user" noise so "1154 messages" reflects actual prompts the human
  // typed, not 11K of automated event chatter.
  const userMsgCounts = trajectories.map(t => t.events.filter(isHumanUserMessage).length);
  const aiTurnCounts = trajectories.map(t =>
    t.events.filter(e => e.role === "assistant" && (e.type === "message" || e.type === "tool_call")).length
  );
  const autonomies = userMsgCounts.map((u, i) => {
    const a = aiTurnCounts[i];
    return a > 0 ? Math.round((1 - u / (u + a)) * 100) : 0;
  });

  // Stat mode toggle
  let statMode: "total" | "avg" | "p50" | "p90" = "total";

  const modeBar = document.createElement("div");
  modeBar.style.cssText = "display:flex;gap:4px;padding:8px 0;align-items:center";
  const modeLabel = document.createElement("span");
  modeLabel.textContent = `${n} sessions`;
  modeLabel.style.cssText = "font-size:14px;font-weight:700;color:var(--tv-text);margin-right:8px";
  modeBar.appendChild(modeLabel);

  function renderModeButtons() {
    modeBar.querySelectorAll("button").forEach(b => b.remove());
    for (const mode of ["total", "avg", "p50", "p90"] as const) {
      const btn = document.createElement("button");
      btn.style.cssText = `padding:3px 10px;font-size:11px;border:1px solid var(--tv-border);border-radius:3px;cursor:pointer;background:${statMode === mode ? "var(--tv-accent)" : "var(--tv-bg)"};color:${statMode === mode ? "#fff" : "var(--tv-text-secondary)"};${statMode === mode ? "border-color:var(--tv-accent)" : ""}`;
      btn.textContent = mode === "total" ? "Totals" : mode === "avg" ? "Average" : mode.toUpperCase();
      // Toggling stat mode only changes the one-line summary at the top
      // of the dashboard. Re-rendering the full multi-session view
      // (insights, time breakdown, 26K-event token chart, 1145-row
      // comparison table) on every click was making the toggle feel
      // dead for several seconds. updateStatsLine() is O(sessions) only.
      btn.onclick = () => { statMode = mode; updateStatsLine(); };
      modeBar.appendChild(btn);
    }
  }

  /**
   * Cheap re-render of just the stats line + button highlights — used by
   * the Total / Avg / P50 / P90 toggle. The rest of the dashboard does
   * not depend on statMode, so we don't touch it.
   */
  function updateStatsLine() {
    renderModeButtons();
    const existing = contentArea.querySelector(".dv2-stats-line");
    if (!existing) return;
    const fresh = buildStatsLine();
    existing.replaceWith(fresh);
  }

  function buildStatsLine(): HTMLElement {
    const statsLine = document.createElement("div");
    statsLine.className = "dv2-stats-line";
    const parts = [
      fmtDur(statNum(durations)),
      fmtTok(statNum(outputToks)) + " output",
      stat(toolCounts) + " tools",
      stat(userMsgCounts) + " msgs",
      statNum(errorCounts) > 0 ? `${stat(errorCounts)} retries` : null,
    ];
    statsLine.innerHTML =
      `<span style="font-size:11px;color:var(--tv-text-muted)">${statMode === "total" ? "Totals" : statMode === "avg" ? "Per-session avg" : statMode.toUpperCase()}</span> ` +
      parts.join(' <span class="dv2-stats-dot">&middot;</span> ');
    return statsLine;
  }

  container.appendChild(modeBar);

  // Content area
  const contentArea = document.createElement("div");
  container.appendChild(contentArea);

  function stat(values: number[]): string {
    if (values.length === 0) return "0";
    const sorted = [...values].sort((a, b) => a - b);
    if (statMode === "total") return values.reduce((s, v) => s + v, 0).toString();
    if (statMode === "avg") return Math.round(values.reduce((s, v) => s + v, 0) / values.length).toString();
    if (statMode === "p50") return sorted[Math.floor(sorted.length * 0.5)].toString();
    if (statMode === "p90") return sorted[Math.floor(sorted.length * 0.9)].toString();
    return "0";
  }

  function statNum(values: number[]): number {
    return Number(stat(values));
  }

  function renderAll() {
    renderModeButtons();
    contentArea.innerHTML = "";

    // ── Aggregate stats line ──
    const totalMsgs = userMsgCounts.reduce((s, v) => s + v, 0);
    const avgAuto = Math.round(autonomies.reduce((s, v) => s + v, 0) / n);
    const totalErrors = errorCounts.reduce((s, v) => s + v, 0);
    contentArea.appendChild(buildStatsLine());

    // Model usage breakdown (aggregate)
    const modelTokens = new Map<string, number>();
    for (const ev of allEvents) {
      if (ev.model && ev.tokens?.output) {
        modelTokens.set(ev.model, (modelTokens.get(ev.model) ?? 0) + ev.tokens.output);
      }
    }
    if (modelTokens.size > 0) {
      const totalOut = [...modelTokens.values()].reduce((s, v) => s + v, 0);
      const modelLine = document.createElement("div");
      modelLine.className = "dv2-model-line";
      const mParts: string[] = [];
      for (const [model, tokens] of [...modelTokens.entries()].sort((a, b) => b[1] - a[1])) {
        const pct = totalOut > 0 ? Math.round((tokens / totalOut) * 100) : 0;
        const shortName = model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
        mParts.push(`<span class="dv2-model-chip"><strong>${esc(shortName)}</strong> ${fmtTok(tokens)} (${pct}%)</span>`);
      }
      modelLine.innerHTML = mParts.join(" ");
      contentArea.appendChild(modelLine);
    }

    // (Takeaways moved to the dedicated Insights view.)

    // ── Aggregate insights ──
    const insightCard = document.createElement("div");
    insightCard.className = "dv2-insights";
    const findings: string[] = [];

    // Autonomy across all sessions
    findings.push(`<strong>${totalMsgs} messages</strong> across ${n} sessions. Average autonomy: <strong>${avgAuto}%</strong>. ` +
      `Median session duration: <strong>${fmtDur(sorted(durations)[Math.floor(n / 2)])}</strong>`);

    // ── Per-session message stats: avg + p50 + p90 ──
    // Tells you whether your sessions are uniform (small spread) or spiky
    // (big spread — a few marathon sessions and a long tail of quick ones).
    if (n >= 2) {
      const sortedMsgs = sorted(userMsgCounts);
      const avgMsgs = totalMsgs / n;
      const p50Msgs = sortedMsgs[Math.floor(n * 0.5)];
      const p90Msgs = sortedMsgs[Math.min(n - 1, Math.floor(n * 0.9))];
      const maxMsgs = sortedMsgs[n - 1];
      findings.push(
        `Messages per session: <strong>${avgMsgs.toFixed(1)}</strong> avg · ` +
        `<strong>${p50Msgs}</strong> p50 · ` +
        `<strong>${p90Msgs}</strong> p90 · ` +
        `<strong>${maxMsgs}</strong> max`
      );
    }

    // ── Compaction stats (multi-session) ──
    // "messages between compacts" answers "how often does context get full?"
    // — a context-window stress indicator. Sessions that never compact
    // didn't fill the window; ones that compact frequently were churning.
    const compactionsPerSession = trajectories.map(t => {
      const c = (t.summary?.compactionCount ?? 0) || t.events.filter(e => e.contextCompacted).length;
      return c;
    });
    const totalCompactions = compactionsPerSession.reduce((s, v) => s + v, 0);
    if (totalCompactions > 0) {
      // msgs between compacts = avg msgs in sessions that DID compact, per compaction
      const sessionsWithCompacts = compactionsPerSession.filter(c => c > 0).length;
      const msgsInCompactingSessions = userMsgCounts.reduce(
        (s, m, i) => s + (compactionsPerSession[i] > 0 ? m : 0), 0
      );
      const avgMsgsBetweenCompacts = totalCompactions > 0
        ? msgsInCompactingSessions / totalCompactions
        : 0;
      findings.push(
        `<strong>${totalCompactions}</strong> compactions across <strong>${sessionsWithCompacts}</strong> session${sessionsWithCompacts === 1 ? "" : "s"} · ` +
        `≈<strong>${avgMsgsBetweenCompacts.toFixed(1)}</strong> messages between compacts ` +
        `<span title="Compactions = times the conversation got too long and had to be trimmed. Lower 'msgs between compacts' = context fills up faster, often a sign of long tool outputs or large file reads.">ⓘ</span>`
      );
    }

    // ── Tools per turn (productivity ratio) ──
    const totalTools = toolCounts.reduce((s, v) => s + v, 0);
    if (totalMsgs > 0) {
      const toolsPerTurn = totalTools / totalMsgs;
      findings.push(
        `<strong>${toolsPerTurn.toFixed(1)}</strong> tools per user message ` +
        `<span title="Tool calls divided by user messages. Higher = AI does more per ask (more autonomous). Lower = lots of back-and-forth.">ⓘ</span>`
      );
    }

    // ── Files touched (scope indicator) ──
    const filesTouched = new Set<string>();
    for (const ev of allEvents) {
      if (ev.type !== "tool_call" || !ev.toolCall?.arguments) continue;
      const args = ev.toolCall.arguments as Record<string, unknown>;
      const fp = (args.file_path ?? args.filePath ?? args.path ?? args.notebook_path) as unknown;
      if (typeof fp === "string" && fp.length > 0) filesTouched.add(fp);
    }
    if (filesTouched.size > 0) {
      findings.push(
        `<strong>${filesTouched.size.toLocaleString()}</strong> distinct files touched ` +
        `(read, edited, or written across all ${n} sessions)`
      );
    }

    // ── Longest single AI turn ──
    let longestAiTurnMs = 0;
    for (const t of trajectories) {
      const { aiTurns } = collectSessionLatencies(t.events);
      for (const v of aiTurns) if (v > longestAiTurnMs) longestAiTurnMs = v;
    }
    if (longestAiTurnMs >= 60_000) {
      findings.push(
        `Longest single AI turn: <strong>${fmtDur(longestAiTurnMs)}</strong> ` +
        `<span title="Biggest stretch from one of your messages → the AI's last activity within a single session, before you spoke again.">ⓘ</span>`
      );
    }

    // Retry rate
    if (totalErrors > 0 && totalTools > 0) {
      const pct = Math.round((totalErrors / totalTools) * 100);
      findings.push(`<strong>${totalErrors}</strong> retries across <strong>${totalTools}</strong> tool calls (<strong>${pct}%</strong> retry rate)`);
    }

    // Token spread
    const sortedTok = sorted(outputToks);
    if (sortedTok.length >= 4) {
      findings.push(`Output tokens range: <strong>${fmtTok(sortedTok[0])}</strong> to <strong>${fmtTok(sortedTok[sortedTok.length - 1])}</strong> (p50: ${fmtTok(sortedTok[Math.floor(sortedTok.length * 0.5)])})`);
    }

    const hero = document.createElement("div");
    hero.className = "dv2-insight-hero";
    hero.innerHTML = findings[0];
    insightCard.appendChild(hero);
    if (findings.length > 1) {
      const ul = document.createElement("ul");
      for (const f of findings.slice(1)) {
        const li = document.createElement("li");
        li.innerHTML = f;
        ul.appendChild(li);
      }
      insightCard.appendChild(ul);
    }

    // ── Reply / AI-turn latency tornado (per-session, then merged) ──
    // Computing per-session avoids cross-session pollution where session A's
    // last AI event would otherwise be paired with session B's first user
    // message and produce nonsense gaps spanning days.
    const allReplyGaps: number[] = [];
    const allAiTurns: number[] = [];
    const allPairs: { aiTurn: number; reply: number }[] = [];
    for (const t of trajectories) {
      const lat = collectSessionLatencies(t.events);
      allReplyGaps.push(...lat.replyGaps);
      allAiTurns.push(...lat.aiTurns);
      allPairs.push(...lat.pairs);
    }
    if (allReplyGaps.length + allAiTurns.length >= 3) {
      insightCard.appendChild(buildLatencyTornado(allReplyGaps, allAiTurns, allPairs));
    }

    contentArea.appendChild(insightCard);

    // ── Mini Gantt across all selected sessions ──
    // Same lane logic the single-session view uses, but laid out across
    // every event in every selected trajectory so you can see the shape
    // of activity (Assistant / Tool Calls / User / Thinking / Compactions)
    // collapsed into one strip. Click to open the full Timeline view.
    const multiGantt = buildMiniGantt(trajectories);
    if (multiGantt) {
      multiGantt.style.cursor = "pointer";
      multiGantt.title = "Click to open full Timeline view";
      multiGantt.addEventListener("click", () => {
        options.onStateChange({ switchView: "gantt" });
      });
      contentArea.appendChild(multiGantt);
    }

    // ── Response time vs context size (aggregate across selected sessions) ──
    const multiCtxLat = buildContextLatencyChart(trajectories);
    if (multiCtxLat) contentArea.appendChild(multiCtxLat);

    // ── Time Breakdown (aggregate) ──
    const timeBar = buildTimeBreakdown(allEvents);
    if (timeBar) contentArea.appendChild(timeBar);

    // ── Tool Usage + Token Breakdown (aggregate) ──
    const mid = document.createElement("div");
    mid.className = "dv2-mid";
    mid.appendChild(buildToolSection(trajectories, aggSummary.toolCallCounts));
    mid.appendChild(buildTokenSection(allEvents, aggSummary.totalTokens));
    contentArea.appendChild(mid);

    // ── Comparison Table ──
    contentArea.appendChild(buildComparisonTable(trajectories, options));
  }

  renderAll();
}

function buildWeeklyStats(allTrajectories: Trajectory[]): HTMLElement | null {
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const prevWeekStart = weekAgo - 7 * 86400000;

  const thisWeek = allTrajectories.filter(t => {
    const ts = t.session.startTime ? new Date(t.session.startTime).getTime() : 0;
    return ts >= weekAgo;
  });
  const prevWeek = allTrajectories.filter(t => {
    const ts = t.session.startTime ? new Date(t.session.startTime).getTime() : 0;
    return ts >= prevWeekStart && ts < weekAgo;
  });

  if (thisWeek.length === 0) return null;

  const thisTokens = thisWeek.reduce((s, t) => {
    const sm = t.summary ?? computeSummary(t.events);
    return s + sm.totalTokens.output;
  }, 0);
  const thisTools = thisWeek.reduce((s, t) => {
    const sm = t.summary ?? computeSummary(t.events);
    return s + sm.totalToolCalls;
  }, 0);
  const thisDur = thisWeek.reduce((s, t) => {
    const sm = t.summary ?? computeSummary(t.events);
    return s + sm.durationMs;
  }, 0);
  const thisEvents = thisWeek.flatMap(t => t.events);
  const thisCost = estimateCost(thisEvents);
  const prevEvents = prevWeek.flatMap(t => t.events);
  const prevCost = estimateCost(prevEvents);

  const prevTokens = prevWeek.reduce((s, t) => {
    const sm = t.summary ?? computeSummary(t.events);
    return s + sm.totalTokens.output;
  }, 0);

  function trend(current: number, previous: number): string {
    if (previous === 0) return "";
    const pct = Math.round(((current - previous) / previous) * 100);
    if (Math.abs(pct) < 3) return "";
    return pct > 0 ? ` <span style="color:#48bb78">\u25B2${pct}%</span>` : ` <span style="color:#fc5c65">\u25BC${Math.abs(pct)}%</span>`;
  }

  const card = document.createElement("div");
  card.className = "dv2-week-card";
  card.innerHTML = `
    <span class="dv2-week-title">This week</span>
    <span>${thisWeek.length} sessions</span>
    <span class="dv2-stats-dot">&middot;</span>
    <span>${fmtDur(thisDur)}</span>
    <span class="dv2-stats-dot">&middot;</span>
    <span>${fmtTok(thisTokens)} output${trend(thisTokens, prevTokens)}</span>
    <span class="dv2-stats-dot">&middot;</span>
    <span>${thisTools.toLocaleString()} tools</span>
    ${renderCostStat(thisCost, prevCost.totalUsd, trend)}
  `;
  return card;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * The "≈$N" stat is misleading for the common case — most AI Timeline
 * users run Claude Code / Cursor / etc on a flat-rate subscription, not
 * pay-per-token API access. The default cost mode is "subscription" which
 * shows nothing in this slot. Users on the API can flip the mode in
 * Settings to see list-price estimates.
 */
function readCostMode(): "list" | "subscription" | "hidden" {
  try {
    const raw = localStorage.getItem("tv-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.costMode === "list" || parsed?.costMode === "subscription" || parsed?.costMode === "hidden") {
        return parsed.costMode;
      }
    }
  } catch { /* ignore */ }
  return "subscription";
}

function renderCostStat(estimate: { totalUsd: number; details?: import("../common/cost").CostDetail[]; pricesAsOf?: string }, prev: number, trend: (a: number, b: number) => string): string {
  const total = estimate.totalUsd;
  if (total <= 0) return "";
  const mode = readCostMode();
  if (mode === "hidden") return "";
  if (mode === "subscription") return ""; // Subscription users don't pay per-token

  // The (ⓘ) is a <details> disclosure: click to expand a full breakdown
  // showing every model's input/output/cache token counts, the per-million
  // rates used, where each rate came from (exact match / fuzzy / pattern),
  // and when the price table was last updated. No popover JS needed.
  const tooltip = "Click ⓘ for breakdown. ≈ list price; subscribers don't pay this. Change mode in Settings.";
  return `<span class="dv2-stats-dot">&middot;</span>` +
    `<span class="dv2-cost-stat" title="${tooltip}">` +
    `  ≈${formatCost(total)} <span style="color:var(--tv-text-muted);font-size:10px">list</span>${trend(total, prev)}` +
    `  ${renderCostBreakdownDisclosure(estimate)}` +
    `</span>`;
}

function renderCostBreakdownDisclosure(est: { totalUsd: number; details?: import("../common/cost").CostDetail[]; pricesAsOf?: string }): string {
  if (!est.details || est.details.length === 0) return "";
  const rows = est.details.map((d) => {
    const sourceLabel = d.pricingSource === "exact" ? "exact match"
      : d.pricingSource === "fuzzy" ? "matched on substring"
      : d.pricingSource === "pattern" ? "matched on pattern"
      : d.pricingSource === "local-default" ? "treated as local (free)"
      : "unknown — no pricing applied";
    const sourceColor = d.pricingSource === "exact" ? "#48bb78"
      : d.pricingSource === "unknown" ? "#fc5c65" : "#f7b731";
    const sourceLink = d.pricingSourceUrl
      ? `<br><a href="${escForCost(d.pricingSourceUrl)}" target="_blank" rel="noopener" style="color:#4f8ff7;font-size:12px">View pricing ↗</a>`
      : "";
    return `
      <tr>
        <td><code>${escForCost(d.model)}</code></td>
        <td>${d.pricingKey ? `<code>${escForCost(d.pricingKey)}</code>` : "<em>unknown</em>"}<br>
            <span style="color:${sourceColor};font-size:12px">${sourceLabel}</span>${sourceLink}</td>
        <td style="text-align:right">${fmtTok(d.inputTokens)} × $${d.inputPerM}/M<br><strong>${formatCost(d.inputCost)}</strong></td>
        <td style="text-align:right">${fmtTok(d.cacheReadTokens)} × $${d.cacheReadPerM}/M<br><strong>${formatCost(d.cacheReadCost)}</strong></td>
        <td style="text-align:right">${fmtTok(d.cacheWriteTokens)} × $${d.cacheWritePerM}/M<br><strong>${formatCost(d.cacheWriteCost)}</strong></td>
        <td style="text-align:right">${fmtTok(d.outputTokens)} × $${d.outputPerM}/M<br><strong>${formatCost(d.outputCost)}</strong></td>
        <td style="text-align:right"><strong>${formatCost(d.totalCost)}</strong></td>
      </tr>`;
  }).join("");
  return `
    <details class="dv2-cost-info">
      <summary aria-label="Cost breakdown" title="Click to see per-model token-by-token math">ⓘ</summary>
      <div class="dv2-cost-info-panel">
        <div class="dv2-cost-info-head">Cost breakdown — list price as of ${est.pricesAsOf ?? "early 2026"}</div>
        <table class="dv2-cost-table">
          <thead><tr>
            <th>Model</th><th>Pricing source</th>
            <th>Fresh input</th><th>Cache read</th><th>Cache write</th><th>Output</th><th>Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="dv2-cost-info-foot">
          Anthropic / OpenAI counters are disjoint: <strong>fresh input</strong>
          is just the uncached portion (we don't subtract cache reads from it).
          <strong>Cache write</strong> tokens carry a ~25% premium on Anthropic;
          we price them separately. Tools (Bash, Read, Edit, etc.) and thinking
          tokens cost $0 — they run locally or are billed inside the LLM call's
          output. Numbers are <strong>list price</strong>; if you're on a
          flat-rate subscription you don't actually pay this. Click "View
          pricing ↗" to verify our $/M against the provider's rate sheet.
        </div>
      </div>
    </details>`;
}

export function escForCost(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Multi-Session Comparison Table ───────────────────────────────────

interface SessionRow {
  label: string;
  date: string;
  dateMs: number;
  duration: string;
  durationMs: number;
  tools: number;
  msgs: number;
  errors: number;
  outputTok: number;
  autonomy: number;
  model: string;
  /** Full per-model breakdown for hover (one line per model with output tokens + %) */
  modelTooltip?: string;
  isSubagent: boolean;
  sessionId: string;
  parentId?: string;
  /** Synthetic row representing the parent's events that weren't tagged
   * with an agent label (direct user/assistant work). Distinguished from
   * a real subagent so the badge reads "you" instead of "subagent". */
  isDirectWork?: boolean;
}

// Persistent sort state for comparison table (survives rebuilds from stat mode toggle)
const cmpSortState: { col: string; asc: boolean } = { col: "date", asc: false };
// Which parent rows have their subagent block expanded. Persists across
// table rebuilds (sort, stat-mode toggle).
const expandedParents = new Set<string>();

function buildComparisonTable(trajectories: Trajectory[], options: ViewOptions): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-cmp";

  // STRICT linkage only — no guessing.
  // Verified against ~/.claude/projects/ with scripts/inspect-claude-subagents.py:
  // 0 / 1163 subagent files have a cross-session uuid linkage in their
  // JSONL data. The only signal Claude Code gives us is the path:
  // `<parent-uuid>/subagents/agent-<id>.jsonl`. We attach a subagent to a
  // parent ONLY when the path UUID matches a loaded session AND
  // timestamps make it possible. Anything else is an orphan — we don't
  // pretend to know which session spawned it.
  const parentTrajectoriesIdx = new Map<string, number>();
  const parentStartMs = new Map<string, number>();
  const parentEndMs = new Map<string, number>();
  trajectories.forEach((t, i) => {
    if (!t.parentSessionId) {
      parentTrajectoriesIdx.set(t.session.id, i);
      const sMs = t.session.startTime ? new Date(t.session.startTime).getTime() : 0;
      parentStartMs.set(t.session.id, sMs);
      const eMs = t.session.endTime
        ? new Date(t.session.endTime).getTime()
        : sMs + (t.summary?.durationMs ?? 0);
      parentEndMs.set(t.session.id, eMs || sMs + 86400000);
    }
  });
  const subagentsByParent = new Map<string, { traj: Trajectory; idx: number }[]>();
  const orphanSubagents: { traj: Trajectory; idx: number }[] = [];
  const TEMPORAL_GRACE_MS = 5 * 60 * 1000;
  // Diagnostic counters — surfaced in the title so the user sees exactly
  // why each subagent grouped (or didn't).
  let matchedByPath = 0;
  let unlinkedNoParentFile = 0;
  let unlinkedTemporal = 0;
  let unlinkedSidechain = 0;
  trajectories.forEach((t, i) => {
    if (!t.parentSessionId) return;

    let resolvedParentId: string | undefined;

    if (t.parentSessionId === "__sidechain__") {
      // Data-detected subagent without a path-based parent — no
      // definitive way to link.
      unlinkedSidechain++;
    } else {
      const pathParentIdx = parentTrajectoriesIdx.get(t.parentSessionId);
      if (pathParentIdx == null) {
        // Path UUID's parent session isn't loaded.
        unlinkedNoParentFile++;
      } else {
        const subStartMs = t.session.startTime ? new Date(t.session.startTime).getTime() : 0;
        const parentStart = parentStartMs.get(t.parentSessionId) ?? 0;
        const parentEnd = parentEndMs.get(t.parentSessionId) ?? 0;
        const tooEarly = subStartMs > 0 && parentStart > 0 && (subStartMs + TEMPORAL_GRACE_MS) < parentStart;
        const tooLate = subStartMs > 0 && parentEnd > 0 && subStartMs > parentEnd + TEMPORAL_GRACE_MS;
        if (tooEarly || tooLate) {
          unlinkedTemporal++;
        } else {
          resolvedParentId = t.parentSessionId;
          matchedByPath++;
        }
      }
    }

    if (resolvedParentId) {
      const arr = subagentsByParent.get(resolvedParentId) ?? [];
      arr.push({ traj: t, idx: i });
      subagentsByParent.set(resolvedParentId, arr);
    } else {
      orphanSubagents.push({ traj: t, idx: i });
    }
  });
  const unlinkedTotal = unlinkedNoParentFile + unlinkedTemporal + unlinkedSidechain;

  const parentCount = parentTrajectoriesIdx.size + orphanSubagents.length;
  const subagentCount = trajectories.length - parentCount;

  const title = document.createElement("div");
  title.className = "dv2-cmp-title";
  title.textContent = subagentCount > 0
    ? `${parentCount} sessions selected · ${subagentCount} subagents (collapsed under parents)`
    : `${trajectories.length} sessions selected`;
  if (subagentCount > 0) {
    const diag = document.createElement("div");
    diag.style.cssText = "font-size:10px;color:var(--tv-text-muted);font-family:var(--tv-mono);margin-top:2px";
    diag.textContent =
      `subagent linkage: ${matchedByPath} linked to parent · ${unlinkedTotal} can't link ` +
      `(${unlinkedNoParentFile} parent not loaded, ${unlinkedSidechain} no path parent, ${unlinkedTemporal} timestamp mismatch)`;
    title.appendChild(diag);
  }
  wrap.appendChild(title);

  function buildRow(t: Trajectory, idx: number, isSubagent: boolean): SessionRow {
    const s = t.summary ?? computeSummary(t.events);
    const userMsgs = t.events.filter(isHumanUserMessage).length;
    const aiTurns = t.events.filter(e => e.role === "assistant" && (e.type === "message" || e.type === "tool_call")).length;
    const autonomy = aiTurns > 0 ? Math.round((1 - userMsgs / (userMsgs + aiTurns)) * 100) : 0;
    const label = getSessionLabel(t, idx);
    return {
      label,
      date: t.session.startTime ? new Date(t.session.startTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "",
      dateMs: t.session.startTime ? new Date(t.session.startTime).getTime() : 0,
      duration: fmtDur(s.durationMs),
      durationMs: s.durationMs,
      tools: s.totalToolCalls,
      msgs: userMsgs,
      errors: s.errorCount,
      outputTok: s.totalTokens.output,
      autonomy,
      // Surface the *actual* model usage from this row's events, not just
      // session.model. A session whose primary is opus-4-7 may still have
      // sonnet-4-6 calls inside (subagent dispatches, secondary tools) —
      // session.model alone hides that and made the model column look
      // homogeneous while the dashboard header showed 1% sonnet.
      model: pickPrimaryModel(t.events, t.session.model ?? ""),
      modelTooltip: modelBreakdownTooltip(t.events),
      isSubagent,
      sessionId: t.session.id,
      parentId: t.parentSessionId,
    };
  }

  // Top-level rows: real sessions + orphan subagents (parent not in selection)
  const rows: SessionRow[] = [];
  trajectories.forEach((t, i) => {
    if (!t.parentSessionId) rows.push(buildRow(t, i, false));
  });
  for (const { traj, idx } of orphanSubagents) rows.push(buildRow(traj, idx, true));

  // Sub-rows per parent
  const subRowsByParent = new Map<string, SessionRow[]>();
  for (const [parentId, kids] of subagentsByParent) {
    subRowsByParent.set(parentId, kids.map(({ traj, idx }) => buildRow(traj, idx, true)));
  }

  // Also derive sub-rows from each parent's MERGED subagent events.
  // mergeSubagentTrajectories absorbs each subagent's events into the
  // parent and tags them with `agent`. So a parent that absorbed 8
  // subagents has 8 distinct agent labels in its event stream — and
  // those are the rows we want to surface when the user expands the
  // parent. We also emit a "Direct (no subagent)" row tallying events
  // that have no agent label, so subagent + direct rows sum exactly to
  // the parent total (otherwise the user sees 1454 vs. 128 of subagent
  // work and rightfully asks where the rest went).
  function statsFromEvents(evs: TrajectoryEvent[]): { tools: number; errors: number; msgs: number; output: number; first: number; last: number } {
    let tools = 0, errors = 0, msgs = 0, output = 0;
    let first = Infinity, last = -Infinity;
    for (const ev of evs) {
      if (ev.type === "tool_call") tools++;
      if (ev.type === "tool_result" && ev.toolResult?.isError) errors++;
      if (ev.role === "user" && ev.type === "message" && ev.content) msgs++;
      if (ev.tokens?.output) output += ev.tokens.output;
      const ts = new Date(ev.timestamp).getTime();
      if (isFinite(ts)) {
        if (ts < first) first = ts;
        if (ts > last) last = ts;
      }
    }
    return { tools, errors, msgs, output, first: isFinite(first) ? first : 0, last: isFinite(last) ? last : 0 };
  }

  function makeAgentRow(parent: Trajectory, agentLabel: string, evs: TrajectoryEvent[], isDirect: boolean): SessionRow {
    const s = statsFromEvents(evs);
    const durMs = Math.max(0, s.last - s.first);
    return {
      label: agentLabel,
      date: s.first ? new Date(s.first).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "",
      dateMs: s.first,
      duration: fmtDur(durMs),
      durationMs: durMs,
      tools: s.tools,
      msgs: s.msgs,
      errors: s.errors,
      outputTok: s.output,
      autonomy: 0,
      model: pickPrimaryModel(evs, parent.session.model ?? ""),
      modelTooltip: modelBreakdownTooltip(evs),
      isSubagent: true,
      sessionId: `${parent.session.id}::agent::${agentLabel || "__direct__"}`,
      parentId: parent.session.id,
      isDirectWork: isDirect,
    };
  }

  for (let i = 0; i < trajectories.length; i++) {
    const t = trajectories[i];
    if (t.parentSessionId) continue;
    // Group events: by agent label, plus a "direct" bucket for un-tagged events
    const byAgent = new Map<string, TrajectoryEvent[]>();
    const direct: TrajectoryEvent[] = [];
    for (const ev of t.events) {
      if (ev.agent) {
        const arr = byAgent.get(ev.agent) ?? [];
        arr.push(ev);
        byAgent.set(ev.agent, arr);
      } else {
        direct.push(ev);
      }
    }
    if (byAgent.size === 0) continue;

    const agentRows: SessionRow[] = [];
    // Direct row first so the user reads it as "what I did myself"
    if (direct.length > 0) {
      agentRows.push(makeAgentRow(t, "Direct (no subagent)", direct, true));
    }
    for (const [agentLabel, evs] of byAgent) {
      agentRows.push(makeAgentRow(t, agentLabel, evs, false));
    }
    const existing = subRowsByParent.get(t.session.id) ?? [];
    subRowsByParent.set(t.session.id, [...existing, ...agentRows]);
  }

  // Sortable columns — use persistent state so sort survives stat mode changes
  type SortCol = "date" | "model" | "duration" | "tools" | "msgs" | "errors" | "outputTok" | "autonomy";

  // Short-name a Claude model id for the column. "claude-opus-4-7-20250101"
  // → "opus-4-7", "claude-sonnet-4-6-..." → "sonnet-4-6", etc. Strips the
  // "claude-" prefix and any trailing date stamp so the cell stays narrow.
  // Handles slash-separated lists like "claude-opus-4-7 / claude-sonnet-4-6".
  function shortModelName(m: string): string {
    if (!m) return "";
    return m
      .split(" / ")
      .map(part => part
        .replace(/^claude-/, "")
        .replace(/-\d{8}$/, "")
        .replace(/^anthropic\//, ""))
      .join(" / ");
  }

  // Returns a slash-separated list of all models that contributed output
  // tokens in this row's events, ordered by share (most-used first).
  // E.g. "opus-4-7 / sonnet-4-6". Drops models contributing <1% so the
  // cell isn't cluttered by background-task models. The full breakdown
  // (with percentages) is in modelBreakdownTooltip.
  function pickPrimaryModel(events: TrajectoryEvent[], defaultModel: string): string {
    const tokens = new Map<string, number>();
    for (const ev of events) {
      if (!ev.model) continue;
      tokens.set(ev.model, (tokens.get(ev.model) ?? 0) + (ev.tokens?.output ?? 0));
    }
    if (tokens.size === 0) return defaultModel;
    const total = [...tokens.values()].reduce((s, v) => s + v, 0);
    const sorted = [...tokens.entries()].sort((a, b) => b[1] - a[1]);
    const significant = total > 0
      ? sorted.filter(([, t]) => t / total >= 0.01)
      : sorted;
    const list = (significant.length > 0 ? significant : sorted.slice(0, 1)).map(([m]) => m);
    return list.join(" / ");
  }

  // Full per-model token breakdown for the tooltip — so a "+1" cell can
  // show exactly which secondary model was used and how much.
  function modelBreakdownTooltip(events: TrajectoryEvent[]): string {
    const tokens = new Map<string, number>();
    for (const ev of events) {
      if (!ev.model) continue;
      tokens.set(ev.model, (tokens.get(ev.model) ?? 0) + (ev.tokens?.output ?? 0));
    }
    if (tokens.size === 0) return "";
    const total = [...tokens.values()].reduce((s, v) => s + v, 0);
    const sorted = [...tokens.entries()].sort((a, b) => b[1] - a[1]);
    return sorted
      .map(([m, t]) => `${m}: ${fmtTok(t)} out (${total > 0 ? Math.round((t / total) * 100) : 0}%)`)
      .join("\n");
  }
  if (!cmpSortState.col) { cmpSortState.col = "date"; cmpSortState.asc = false; }

  const tableWrap = document.createElement("div");
  tableWrap.className = "dv2-cmp-wrap";

  function rebuild() {
    // Read sort state inside rebuild so click handlers (which mutate
    // cmpSortState then call rebuild) see fresh values. Previously these
    // were captured once at outer scope, so clicking any column header
    // updated state but the next render used the stale capture and
    // appeared to ignore the click.
    const sortCol = cmpSortState.col as SortCol;
    const sortAsc = cmpSortState.asc;

    const sorted = [...rows];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "date") cmp = a.dateMs - b.dateMs;
      else if (sortCol === "model") cmp = a.model.localeCompare(b.model);
      else if (sortCol === "duration") cmp = a.durationMs - b.durationMs;
      else if (sortCol === "tools") cmp = a.tools - b.tools;
      else if (sortCol === "msgs") cmp = a.msgs - b.msgs;
      else if (sortCol === "errors") cmp = a.errors - b.errors;
      else if (sortCol === "outputTok") cmp = a.outputTok - b.outputTok;
      else if (sortCol === "autonomy") cmp = a.autonomy - b.autonomy;
      return sortAsc ? cmp : -cmp;
    });

    const table = document.createElement("table");
    table.className = "dv2-cmp-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const cols: { key: SortCol | "label"; label: string; cls?: string }[] = [
      { key: "label", label: "Session" },
      { key: "date", label: "Date" },
      { key: "model", label: "Model" },
      { key: "duration", label: "Duration", cls: "dv2-cmp-num" },
      { key: "tools", label: "Tools", cls: "dv2-cmp-num" },
      { key: "msgs", label: "Msgs", cls: "dv2-cmp-num" },
      { key: "errors", label: "Retries", cls: "dv2-cmp-num" },
      { key: "autonomy", label: "Autonomy", cls: "dv2-cmp-num" },
      { key: "outputTok", label: "Output Tok", cls: "dv2-cmp-num" },
    ];

    for (const col of cols) {
      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.cls) th.className = col.cls;
      if (col.key !== "label") {
        th.textContent += sortCol === col.key ? (sortAsc ? " ▲" : " ▼") : "";
        th.onclick = () => {
          if (cmpSortState.col === col.key) cmpSortState.asc = !cmpSortState.asc;
          else { cmpSortState.col = col.key; cmpSortState.asc = true; }
          rebuild();
        };
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    function renderRow(row: SessionRow, opts: { subRowCount?: number; toggleHandler?: () => void; expanded?: boolean }): HTMLTableRowElement {
      const tr = document.createElement("tr");
      if (row.isSubagent) tr.classList.add("dv2-cmp-subagent-row");

      const tdLabel = document.createElement("td");
      tdLabel.className = "dv2-cmp-label";
      tdLabel.title = row.label;

      // Indent + caret for parents with kids; indent + badge for subagents
      const labelInner = document.createElement("span");
      labelInner.style.display = "inline-flex";
      labelInner.style.alignItems = "center";
      labelInner.style.gap = "6px";
      labelInner.style.maxWidth = "100%";

      if (row.isSubagent) {
        labelInner.style.paddingLeft = "20px";
        const badge = document.createElement("span");
        if (row.isDirectWork) {
          badge.className = "dv2-cmp-direct-badge";
          badge.textContent = "↳ direct";
          badge.title = "Parent's own tool calls — work done without delegating to a subagent";
        } else {
          badge.className = "dv2-cmp-subagent-badge";
          badge.textContent = row.parentId ? "↳ subagent" : "↳ orphan subagent";
          badge.title = row.parentId ? "Subagent spawned by parent session" : "Subagent whose parent isn't in this selection";
        }
        labelInner.appendChild(badge);
      } else if (opts.subRowCount && opts.subRowCount > 0) {
        const caret = document.createElement("span");
        caret.className = "dv2-cmp-caret";
        caret.textContent = opts.expanded ? "▾" : "▸";
        caret.title = `${opts.subRowCount} subagent${opts.subRowCount > 1 ? "s" : ""} — click to ${opts.expanded ? "collapse" : "expand"}`;
        labelInner.appendChild(caret);
        const count = document.createElement("span");
        count.className = "dv2-cmp-subagent-count";
        count.textContent = `+${opts.subRowCount}`;
        count.title = `${opts.subRowCount} subagent${opts.subRowCount > 1 ? "s" : ""}`;
        labelInner.appendChild(count);
      }
      const labelText = document.createElement("span");
      labelText.textContent = row.label;
      labelText.style.overflow = "hidden";
      labelText.style.textOverflow = "ellipsis";
      labelInner.appendChild(labelText);
      tdLabel.appendChild(labelInner);

      if (opts.toggleHandler) {
        tdLabel.style.cursor = "pointer";
        tdLabel.onclick = opts.toggleHandler;
      }
      tr.appendChild(tdLabel);

      const tdDate = document.createElement("td");
      tdDate.textContent = row.date;
      tr.appendChild(tdDate);

      const tdModel = document.createElement("td");
      tdModel.className = "dv2-cmp-model";
      const shortModel = shortModelName(row.model);
      tdModel.textContent = shortModel;
      // Hover shows the full per-model breakdown with output tokens + %
      // so the user can see exactly what each component contributed
      // ("claude-opus-4-7: 10.4M out (99%)\nclaude-sonnet-4-6: 91K (1%)")
      if (row.modelTooltip) tdModel.title = row.modelTooltip;
      else if (row.model && row.model !== shortModel) tdModel.title = row.model;
      tr.appendChild(tdModel);

      const tdDur = document.createElement("td");
      tdDur.className = "dv2-cmp-num";
      tdDur.textContent = row.duration;
      tr.appendChild(tdDur);

      const tdTools = document.createElement("td");
      tdTools.className = "dv2-cmp-num";
      tdTools.textContent = row.tools.toLocaleString();
      tr.appendChild(tdTools);

      const tdMsgs = document.createElement("td");
      tdMsgs.className = "dv2-cmp-num";
      tdMsgs.textContent = row.msgs.toString();
      tr.appendChild(tdMsgs);

      const tdErrs = document.createElement("td");
      tdErrs.className = "dv2-cmp-num";
      tdErrs.textContent = row.errors.toString();
      tr.appendChild(tdErrs);

      const tdAuto = document.createElement("td");
      tdAuto.className = "dv2-cmp-num";
      tdAuto.textContent = row.autonomy + "%";
      tr.appendChild(tdAuto);

      const tdTok = document.createElement("td");
      tdTok.className = "dv2-cmp-num";
      tdTok.textContent = fmtTok(row.outputTok);
      tr.appendChild(tdTok);

      return tr;
    }

    for (const row of sorted) {
      const subRows = subRowsByParent.get(row.sessionId) ?? [];
      const expanded = expandedParents.has(row.sessionId);
      const parentTr = renderRow(row, {
        subRowCount: subRows.length,
        expanded,
        toggleHandler: subRows.length > 0 ? () => {
          if (expandedParents.has(row.sessionId)) expandedParents.delete(row.sessionId);
          else expandedParents.add(row.sessionId);
          rebuild();
        } : undefined,
      });
      tbody.appendChild(parentTr);
      if (expanded) {
        // Sort subagents by date by default; same column-sort applies if user picked one
        const sortedSubs = [...subRows].sort((a, b) => a.dateMs - b.dateMs);
        for (const sub of sortedSubs) {
          tbody.appendChild(renderRow(sub, {}));
        }
      }
    }
    table.appendChild(tbody);

    // Summary row — totals include parent rows + path-linked SEPARATE
    // subagent trajectories (they did real work that isn't already in
    // a parent's count). We exclude the agent-derived breakdown rows
    // (sessionId contains "::agent::") because those events are
    // already absorbed into the parent's total via merge — counting
    // them again would double-count.
    const allRowsForTotals: SessionRow[] = [...rows];
    for (const subs of subRowsByParent.values()) {
      for (const sub of subs) {
        if (!sub.sessionId.includes("::agent::")) allRowsForTotals.push(sub);
      }
    }

    const tfoot = document.createElement("tfoot");
    const sumRow = document.createElement("tr");
    sumRow.style.fontWeight = "700";
    sumRow.style.borderTop = "2px solid var(--tv-border)";

    const sumLabel = document.createElement("td");
    sumLabel.textContent = subagentCount > 0
      ? `Total (${rows.length} sessions + ${subagentCount} subagents)`
      : `Total (${rows.length})`;
    sumRow.appendChild(sumLabel);

    sumRow.appendChild(document.createElement("td")); // date — empty
    sumRow.appendChild(document.createElement("td")); // model — empty

    const sumDur = document.createElement("td");
    sumDur.className = "dv2-cmp-num";
    sumDur.textContent = fmtDur(allRowsForTotals.reduce((s, r) => s + r.durationMs, 0));
    sumRow.appendChild(sumDur);

    const sumTools = document.createElement("td");
    sumTools.className = "dv2-cmp-num";
    sumTools.textContent = allRowsForTotals.reduce((s, r) => s + r.tools, 0).toLocaleString();
    sumRow.appendChild(sumTools);

    const sumMsgs = document.createElement("td");
    sumMsgs.className = "dv2-cmp-num";
    sumMsgs.textContent = allRowsForTotals.reduce((s, r) => s + r.msgs, 0).toString();
    sumRow.appendChild(sumMsgs);

    const sumErrs = document.createElement("td");
    sumErrs.className = "dv2-cmp-num";
    sumErrs.textContent = allRowsForTotals.reduce((s, r) => s + r.errors, 0).toString();
    sumRow.appendChild(sumErrs);

    const sumAuto = document.createElement("td");
    sumAuto.className = "dv2-cmp-num";
    const avgAuto = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.autonomy, 0) / rows.length) : 0;
    sumAuto.textContent = avgAuto + "% avg";
    sumRow.appendChild(sumAuto);

    const sumTok = document.createElement("td");
    sumTok.className = "dv2-cmp-num";
    sumTok.textContent = fmtTok(allRowsForTotals.reduce((s, r) => s + r.outputTok, 0));
    sumRow.appendChild(sumTok);

    tfoot.appendChild(sumRow);
    table.appendChild(tfoot);

    tableWrap.innerHTML = "";
    tableWrap.appendChild(table);
  }

  rebuild();
  wrap.appendChild(tableWrap);
  return wrap;
}

// ── Time Breakdown ───────────────────────────────────────────────────

const TIME_COLORS: Record<string, string> = {
  "AI Responding": "#4f8ff7",
  "Tool Execution": "#48bb78",
  "Thinking": "#f7b731",
  "User Responding (<15m)": "#9f7aea",
  "User Away (15m+)": "#4a5568",
};

/**
 * Response-time + compaction analytics for a set of sessions. Tabbed:
 *
 *   Scatter        — context-tokens vs response-time, every AI message
 *   Pre-compaction — distribution of context sizes that TRIGGERED compactions
 *   Post-compaction— distribution of context sizes RIGHT AFTER compaction
 *   Frequency     — how often compactions happen (per session)
 *
 * Together they answer "is the AI getting slower as conversation grows?",
 * "at what size does compaction kick in?", "what does it compact down to?",
 * and "how often is this happening?"
 */

export type CtxViewMode = "scatter" | "distribution" | "pre" | "post" | "frequency";
const CTX_VIEW_KEY = "tv-ctxlat-view";
function readCtxView(): CtxViewMode {
  const v = localStorage.getItem(CTX_VIEW_KEY);
  if (v === "scatter" || v === "distribution" || v === "pre" || v === "post" || v === "frequency") return v;
  return "scatter";
}

// Shared X-axis range used across all four views so the eye can compare
// them apples-to-apples.
const CTX_X_MIN = 1000, CTX_X_MAX = 2_000_000;
const ctxXLog = (v: number) =>
  (Math.log(Math.max(CTX_X_MIN, Math.min(CTX_X_MAX, v))) - Math.log(CTX_X_MIN))
  / (Math.log(CTX_X_MAX) - Math.log(CTX_X_MIN));
const CTX_X_TICKS: { v: number; label: string }[] = [
  { v: 10_000, label: "10K" },
  { v: 50_000, label: "50K" },
  { v: 100_000, label: "100K" },
  { v: 200_000, label: "200K" },
  { v: 500_000, label: "500K" },
  { v: 1_000_000, label: "1M" },
];

interface CtxLatPoint { x: number; y: number; sessionIdx: number; turnIdx: number; postCompaction: boolean }

export function buildContextLatencyChart(trajectories: Trajectory[], viewFilter?: CtxViewMode[]): HTMLElement | null {
  // ── Walk events once, collect everything every view needs ──
  const points: CtxLatPoint[] = [];           // for Scatter
  const preCompCtx: number[] = [];            // context-tokens just before each compaction (trigger size)
  const postCompCtx: number[] = [];           // context-tokens right after each compaction (landing size)
  const compactionsPerSession: number[] = trajectories.map(() => 0);

  for (let s = 0; s < trajectories.length; s++) {
    const events = trajectories[s].events;
    let lastAiCtx = 0;        // most recent AI message's context size
    let pendingPost = false;  // capture next AI message's context as "post-compaction"
    let recentlyCompacted = false; // flag scatter dot as post-compaction

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.contextCompacted) {
        if (lastAiCtx > 0) preCompCtx.push(lastAiCtx);
        compactionsPerSession[s]++;
        pendingPost = true;
        recentlyCompacted = true;
      }
      if (ev.role === "assistant" && ev.type === "message" && ev.tokens) {
        const ctx = (ev.tokens.input ?? 0) + (ev.tokens.cacheRead ?? 0) + (ev.tokens.cacheWrite ?? 0);
        if (ctx > 0) {
          lastAiCtx = ctx;
          if (pendingPost) {
            postCompCtx.push(ctx);
            pendingPost = false;
          }
          // Latency for the scatter view
          const aiTs = new Date(ev.timestamp).getTime();
          if (isFinite(aiTs) && i > 0) {
            const prevTs = new Date(events[i - 1].timestamp).getTime();
            if (isFinite(prevTs) && aiTs > prevTs) {
              const latency = aiTs - prevTs;
              if (latency >= 500 && latency <= 30 * 60 * 1000) {
                points.push({ x: ctx, y: latency, sessionIdx: s, turnIdx: i, postCompaction: recentlyCompacted });
              }
            }
          }
          recentlyCompacted = false;
        }
      }
    }
  }

  if (points.length < 8 && preCompCtx.length === 0) return null;

  // ── Build wrapper ──
  const wrap = document.createElement("div");
  wrap.className = "dv2-ctxlat-wrap";

  const totalCompactions = preCompCtx.length;
  const sessionsWithComp = compactionsPerSession.filter(c => c > 0).length;

  const head = document.createElement("div");
  head.className = "dv2-ctxlat-head";
  head.innerHTML =
    `<span class="dv2-ctxlat-title">Response time &amp; compactions</span>` +
    `<span class="dv2-ctxlat-sub">${points.length.toLocaleString()} responses · ${totalCompactions} compaction${totalCompactions === 1 ? "" : "s"} across ${sessionsWithComp}/${trajectories.length} session${trajectories.length === 1 ? "" : "s"}</span>`;
  wrap.appendChild(head);

  // ── View toggle ──
  let view = readCtxView();
  const toggle = document.createElement("div");
  toggle.className = "dv2-lt-toggle";
  const ALL_VIEWS: { id: CtxViewMode; label: string; needsCompaction?: boolean }[] = [
    { id: "scatter", label: "Scatter" },
    { id: "distribution", label: "Distribution" },
    { id: "pre", label: "Pre-compaction", needsCompaction: true },
    { id: "post", label: "Post-compaction", needsCompaction: true },
    { id: "frequency", label: "Frequency", needsCompaction: true },
  ];
  // viewFilter lets callers (e.g. the refined dashboard) trim to a subset.
  const VIEWS = viewFilter && viewFilter.length > 0
    ? ALL_VIEWS.filter(v => viewFilter.includes(v.id))
    : ALL_VIEWS;
  // If the persisted view isn't in the filtered set, fall back to first.
  if (!VIEWS.some(v => v.id === view)) view = VIEWS[0]?.id ?? "scatter";
  // If active view requires compaction data and there isn't any, fall back to scatter
  const activeNeedsComp = VIEWS.find(v => v.id === view)?.needsCompaction;
  if (activeNeedsComp && totalCompactions === 0) view = "scatter";

  const chartHost = document.createElement("div");
  chartHost.className = "dv2-ctxlat-chart-host";

  const summary = document.createElement("div");
  summary.className = "dv2-ctxlat-summary";

  function renderToggle() {
    toggle.innerHTML = "";
    for (const v of VIEWS) {
      const disabled = v.needsCompaction && totalCompactions === 0;
      const b = document.createElement("button");
      b.className = "dv2-lt-toggle-btn" + (view === v.id ? " dv2-lt-toggle-active" : "");
      b.textContent = v.label;
      if (disabled) {
        b.disabled = true;
        b.title = "No compactions in the selected sessions";
        b.style.opacity = "0.45";
        b.style.cursor = "not-allowed";
      }
      b.onclick = () => {
        if (disabled) return;
        view = v.id;
        try { localStorage.setItem(CTX_VIEW_KEY, v.id); } catch { /* ignore quota */ }
        renderToggle();
        renderChart();
      };
      toggle.appendChild(b);
    }
  }

  function renderChart() {
    chartHost.innerHTML = "";
    summary.innerHTML = "";
    if (view === "scatter") {
      chartHost.appendChild(renderCtxScatter(points, preCompCtx));
      summary.innerHTML = scatterSummary(points);
    } else if (view === "distribution") {
      chartHost.appendChild(renderCtxDistribution(points));
      summary.innerHTML = distributionSummary(points);
    } else if (view === "pre") {
      chartHost.appendChild(renderCtxHistogram(preCompCtx, "#fc5c65", "trigger"));
      summary.innerHTML = compHistSummary(preCompCtx, "Compactions trigger when context reaches");
    } else if (view === "post") {
      chartHost.appendChild(renderCtxHistogram(postCompCtx, "#48bb78", "landing"));
      summary.innerHTML = compHistSummary(postCompCtx, "After a compaction the context is");
    } else if (view === "frequency") {
      chartHost.appendChild(renderCompactionFrequency(compactionsPerSession));
      summary.innerHTML = freqSummary(compactionsPerSession);
    }
  }

  renderToggle();
  renderChart();
  wrap.appendChild(toggle);
  wrap.appendChild(chartHost);
  wrap.appendChild(summary);

  return wrap;
}

// ── Helpers shared across the four sub-views ──

function ctxAxisFrame(svgEl: SVGElement, W: number, H: number, PAD_L: number, PAD_R: number, PAD_T: number, PAD_B: number, yLabel: string, yTicks: { v: number; label: string }[], yScale: (v: number) => number) {
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  // X gridlines
  for (const t of CTX_X_TICKS) {
    if (t.v < CTX_X_MIN || t.v > CTX_X_MAX) continue;
    const x = PAD_L + ctxXLog(t.v) * innerW;
    svg("line", { x1: x, x2: x, y1: PAD_T, y2: PAD_T + innerH, stroke: "var(--tv-border)", "stroke-width": 0.5, "stroke-dasharray": "2 3", opacity: 0.4 }, svgEl);
    const lbl = svg("text", { x, y: PAD_T + innerH + 14, "text-anchor": "middle", fill: "var(--tv-text-muted)", "font-size": 10, "font-family": "var(--tv-mono)" }, svgEl);
    lbl.textContent = t.label;
  }
  const xAxisLbl = svg("text", { x: PAD_L + innerW / 2, y: PAD_T + innerH + 26, "text-anchor": "middle", fill: "var(--tv-text-muted)", "font-size": 10 }, svgEl);
  xAxisLbl.textContent = "context tokens";
  // Y gridlines
  for (const t of yTicks) {
    const y = PAD_T + (1 - yScale(t.v)) * innerH;
    if (y < PAD_T - 1 || y > PAD_T + innerH + 1) continue;
    svg("line", { x1: PAD_L, x2: PAD_L + innerW, y1: y, y2: y, stroke: "var(--tv-border)", "stroke-width": 0.5, "stroke-dasharray": "2 3", opacity: 0.4 }, svgEl);
    const lbl = svg("text", { x: PAD_L - 6, y: y + 4, "text-anchor": "end", fill: "var(--tv-text-muted)", "font-size": 10, "font-family": "var(--tv-mono)" }, svgEl);
    lbl.textContent = t.label;
  }
  const yAxisLbl = svg("text", {
    x: 14, y: PAD_T + innerH / 2,
    "text-anchor": "middle", fill: "var(--tv-text-muted)", "font-size": 10,
    transform: `rotate(-90 14 ${PAD_T + innerH / 2})`,
  }, svgEl);
  yAxisLbl.textContent = yLabel;
  return { innerW, innerH };
}

// View 1: Scatter (context vs response time)
function renderCtxScatter(points: CtxLatPoint[], compactionContexts: number[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-ctxlat-svg-wrap";

  const W = 920, H = 260, PAD_T = 12, PAD_R = 16, PAD_B = 30, PAD_L = 56;
  const Y_MIN = 1000, Y_MAX = 30 * 60 * 1000;
  const yLog = (v: number) =>
    (Math.log(Math.max(Y_MIN, Math.min(Y_MAX, v))) - Math.log(Y_MIN))
    / (Math.log(Y_MAX) - Math.log(Y_MIN));

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.setAttribute("class", "dv2-ctxlat-svg");
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", String(H));

  const yTicks = [
    { v: 1000, label: "1s" }, { v: 5000, label: "5s" }, { v: 15_000, label: "15s" },
    { v: 30_000, label: "30s" }, { v: 60_000, label: "1m" }, { v: 3 * 60_000, label: "3m" }, { v: 10 * 60_000, label: "10m" },
  ];
  const { innerW, innerH } = ctxAxisFrame(svgEl, W, H, PAD_L, PAD_R, PAD_T, PAD_B, "response time", yTicks, yLog);

  const xPx = (v: number) => PAD_L + ctxXLog(v) * innerW;
  const yPx = (v: number) => PAD_T + (1 - yLog(v)) * innerH;

  // Compaction markers
  for (const cx of compactionContexts) {
    const x = xPx(cx);
    svg("line", { x1: x, x2: x, y1: PAD_T, y2: PAD_T + innerH,
      stroke: "#ed8936", "stroke-width": 1, opacity: 0.4, "stroke-dasharray": "4 3" }, svgEl);
  }

  // Trend line (median per log-bin)
  const BINS = 14;
  const binPoints: number[][] = Array.from({ length: BINS }, () => []);
  for (const p of points) {
    const idx = Math.min(BINS - 1, Math.max(0, Math.floor(ctxXLog(p.x) * BINS)));
    binPoints[idx].push(p.y);
  }
  const trend: { x: number; p25: number; p50: number; p75: number; n: number }[] = [];
  for (let i = 0; i < BINS; i++) {
    const arr = binPoints[i];
    if (arr.length === 0) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    const q = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const xBinCenter = (i + 0.5) / BINS;
    const xVal = Math.exp(Math.log(CTX_X_MIN) + xBinCenter * (Math.log(CTX_X_MAX) - Math.log(CTX_X_MIN)));
    trend.push({ x: xVal, p25: q(0.25), p50: q(0.5), p75: q(0.75), n: arr.length });
  }
  const showTrend = trend.length >= 2;

  if (showTrend) {
    const top = trend.map(t => `${xPx(t.x).toFixed(1)},${yPx(t.p75).toFixed(1)}`);
    const bot = trend.map(t => `${xPx(t.x).toFixed(1)},${yPx(t.p25).toFixed(1)}`).reverse();
    svg("path", { d: `M ${top.join(" L ")} L ${bot.join(" L ")} Z`, fill: "#ed8936", opacity: 0.12 }, svgEl);
  }

  for (const p of points) {
    const dot = svg("circle", { cx: xPx(p.x), cy: yPx(p.y), r: 2, fill: "#4f8ff7", opacity: 0.4 }, svgEl) as SVGElement;
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tip.textContent = `Session ${p.sessionIdx + 1} · turn ${p.turnIdx} · context ${fmtTok(p.x)} · response ${formatLatency(p.y)}${p.postCompaction ? " · after compaction" : ""}`;
    dot.appendChild(tip);
  }

  if (showTrend) {
    const linePath = trend.map((t, i) => `${i === 0 ? "M" : "L"} ${xPx(t.x).toFixed(1)} ${yPx(t.p50).toFixed(1)}`).join(" ");
    svg("path", { d: linePath, fill: "none", stroke: "#ed8936", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svgEl);
    for (const t of trend) {
      const dot = svg("circle", { cx: xPx(t.x), cy: yPx(t.p50), r: 3, fill: "#ed8936", stroke: "var(--tv-bg)", "stroke-width": 1 }, svgEl) as SVGElement;
      const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
      tip.textContent = `~${fmtTok(t.x)} context: median ${formatLatency(t.p50)} (n=${t.n}, p25 ${formatLatency(t.p25)} → p75 ${formatLatency(t.p75)})`;
      dot.appendChild(tip);
    }
  }

  wrap.appendChild(svgEl);

  const legend = document.createElement("div");
  legend.className = "dv2-ctxlat-legend";
  legend.innerHTML =
    `<span class="dv2-ctxlat-legend-item"><span class="dv2-ctxlat-dot" style="background:#4f8ff7"></span>each AI response</span>` +
    `<span class="dv2-ctxlat-legend-item"><span class="dv2-ctxlat-line" style="background:#ed8936"></span>median + p25–p75 band</span>` +
    (compactionContexts.length > 0
      ? `<span class="dv2-ctxlat-legend-item"><span class="dv2-ctxlat-line dashed"></span>compaction</span>`
      : "");
  wrap.appendChild(legend);

  return wrap;
}

// View 2: Histogram of context sizes (used by Pre and Post compaction views)
function renderCtxHistogram(values: number[], color: string, kind: "trigger" | "landing"): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-ctxlat-svg-wrap";

  if (values.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dv2-ctxlat-empty";
    empty.textContent = "No compaction events to summarize.";
    wrap.appendChild(empty);
    return wrap;
  }

  const W = 920, H = 260, PAD_T = 12, PAD_R = 16, PAD_B = 30, PAD_L = 56;
  const BINS = 24;
  const counts: number[] = Array(BINS).fill(0);
  for (const v of values) {
    const idx = Math.min(BINS - 1, Math.max(0, Math.floor(ctxXLog(v) * BINS)));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  // Y-axis = count. Linear; ticks at quartiles of maxCount
  const yScale = (v: number) => maxCount === 0 ? 0 : v / maxCount;
  const yTicks: { v: number; label: string }[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = (i / 4) * maxCount;
    if (v <= 0 && i > 0) continue;
    yTicks.push({ v, label: Math.round(v).toString() });
  }

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.setAttribute("class", "dv2-ctxlat-svg");
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", String(H));
  const { innerW, innerH } = ctxAxisFrame(svgEl, W, H, PAD_L, PAD_R, PAD_T, PAD_B, "compactions", yTicks, yScale);

  const binW = innerW / BINS;
  for (let i = 0; i < BINS; i++) {
    if (counts[i] === 0) continue;
    const x = PAD_L + i * binW;
    const h = (counts[i] / Math.max(maxCount, 1)) * innerH;
    const y = PAD_T + innerH - h;
    const xBinStart = Math.exp(Math.log(CTX_X_MIN) + (i / BINS) * (Math.log(CTX_X_MAX) - Math.log(CTX_X_MIN)));
    const xBinEnd = Math.exp(Math.log(CTX_X_MIN) + ((i + 1) / BINS) * (Math.log(CTX_X_MAX) - Math.log(CTX_X_MIN)));
    const rect = svg("rect", { x: x + 0.5, y, width: Math.max(binW - 1, 1), height: h, fill: color, opacity: 0.7 }, svgEl) as SVGElement;
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tip.textContent = `${counts[i]} compaction${counts[i] === 1 ? "" : "s"} ${kind === "trigger" ? "triggered when" : "landed when"} context was ${fmtTok(xBinStart)}–${fmtTok(xBinEnd)}`;
    rect.appendChild(tip);
  }

  // Median marker — vertical line
  const sorted = [...values].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const medX = PAD_L + ctxXLog(med) * innerW;
  svg("line", { x1: medX, x2: medX, y1: PAD_T, y2: PAD_T + innerH, stroke: "#fff", "stroke-width": 1.5, "stroke-dasharray": "4 3", opacity: 0.7 }, svgEl);
  const medLbl = svg("text", { x: medX + 4, y: PAD_T + 12, fill: "#fff", "font-size": 10, "font-family": "var(--tv-mono)", opacity: 0.85 }, svgEl);
  medLbl.textContent = `median ${fmtTok(med)}`;

  wrap.appendChild(svgEl);
  return wrap;
}

// View 3: Compaction frequency per session (bar chart)
// View 4: Context size distribution (% of AI responses at each token bucket)
// Answers "what's the typical context I'm running at?" — separate from
// pre/post-compaction views which only look at compaction events.
function renderCtxDistribution(points: CtxLatPoint[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-ctxlat-svg-wrap";

  if (points.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dv2-ctxlat-empty";
    empty.textContent = "No AI responses with token data.";
    wrap.appendChild(empty);
    return wrap;
  }

  const W = 920, H = 260, PAD_T = 12, PAD_R = 16, PAD_B = 30, PAD_L = 56;
  const BINS = 24;
  const counts: number[] = Array(BINS).fill(0);
  for (const p of points) {
    const idx = Math.min(BINS - 1, Math.max(0, Math.floor(ctxXLog(p.x) * BINS)));
    counts[idx]++;
  }
  const total = points.length;
  const pcts = counts.map(c => (c / total) * 100);
  const maxPct = Math.max(...pcts);

  const yScale = (v: number) => maxPct === 0 ? 0 : v / maxPct;
  const yTicks: { v: number; label: string }[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = (i / 4) * maxPct;
    yTicks.push({ v, label: v.toFixed(v < 10 ? 1 : 0) + "%" });
  }

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.setAttribute("class", "dv2-ctxlat-svg");
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", String(H));
  const { innerW, innerH } = ctxAxisFrame(svgEl, W, H, PAD_L, PAD_R, PAD_T, PAD_B, "% of responses", yTicks, yScale);

  const binW = innerW / BINS;
  for (let i = 0; i < BINS; i++) {
    if (counts[i] === 0) continue;
    const x = PAD_L + i * binW;
    const h = (pcts[i] / Math.max(maxPct, 0.0001)) * innerH;
    const y = PAD_T + innerH - h;
    const xBinStart = Math.exp(Math.log(CTX_X_MIN) + (i / BINS) * (Math.log(CTX_X_MAX) - Math.log(CTX_X_MIN)));
    const xBinEnd = Math.exp(Math.log(CTX_X_MIN) + ((i + 1) / BINS) * (Math.log(CTX_X_MAX) - Math.log(CTX_X_MIN)));
    const rect = svg("rect", { x: x + 0.5, y, width: Math.max(binW - 1, 1), height: h, fill: "#4f8ff7", opacity: 0.75 }, svgEl) as SVGElement;
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tip.textContent = `${counts[i]} responses (${pcts[i].toFixed(1)}%) at ${fmtTok(xBinStart)}–${fmtTok(xBinEnd)} context`;
    rect.appendChild(tip);
  }

  // Stat markers — vertical lines for mean, median, p25, p75
  const xs = points.map(p => p.x);
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];

  const markX = (v: number) => PAD_L + ctxXLog(v) * innerW;
  // p25 / p75 — faint shading region
  const x25 = markX(p25);
  const x75 = markX(p75);
  svg("rect", {
    x: x25, y: PAD_T, width: Math.max(0, x75 - x25), height: innerH,
    fill: "#fff", opacity: 0.05,
  }, svgEl);
  // Median (white solid)
  const xMed = markX(median);
  svg("line", { x1: xMed, x2: xMed, y1: PAD_T, y2: PAD_T + innerH, stroke: "#fff", "stroke-width": 1.5, opacity: 0.8 }, svgEl);
  const medLbl = svg("text", { x: xMed + 4, y: PAD_T + 11, fill: "#fff", "font-size": 10, "font-family": "var(--tv-mono)", opacity: 0.85 }, svgEl);
  medLbl.textContent = `median ${fmtTok(median)}`;
  // Mean (orange dashed)
  const xMean = markX(mean);
  svg("line", { x1: xMean, x2: xMean, y1: PAD_T, y2: PAD_T + innerH, stroke: "#ed8936", "stroke-width": 1.5, "stroke-dasharray": "4 3", opacity: 0.85 }, svgEl);
  const meanLbl = svg("text", { x: xMean + 4, y: PAD_T + 24, fill: "#ed8936", "font-size": 10, "font-family": "var(--tv-mono)", opacity: 0.95 }, svgEl);
  meanLbl.textContent = `avg ${fmtTok(mean)}`;

  wrap.appendChild(svgEl);

  // Legend below
  const legend = document.createElement("div");
  legend.className = "dv2-ctxlat-legend";
  legend.innerHTML =
    `<span class="dv2-ctxlat-legend-item"><span class="dv2-ctxlat-dot" style="background:#4f8ff7;border-radius:2px"></span>% of responses in bucket</span>` +
    `<span class="dv2-ctxlat-legend-item"><span class="dv2-ctxlat-line" style="background:#fff"></span>median</span>` +
    `<span class="dv2-ctxlat-legend-item"><span class="dv2-ctxlat-line dashed"></span>average</span>` +
    `<span class="dv2-ctxlat-legend-item"><span class="dv2-ctxlat-dot" style="background:rgba(255,255,255,0.15);border-radius:0"></span>middle 50% (p25–p75)</span>`;
  wrap.appendChild(legend);

  return wrap;
}

function renderCompactionFrequency(perSession: number[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-ctxlat-svg-wrap";

  const totalSessions = perSession.length;
  if (totalSessions === 0) {
    const empty = document.createElement("div");
    empty.className = "dv2-ctxlat-empty";
    empty.textContent = "No sessions selected.";
    wrap.appendChild(empty);
    return wrap;
  }

  // Sort descending so the worst offenders are on the left
  const sorted = perSession
    .map((c, i) => ({ session: i + 1, count: c }))
    .sort((a, b) => b.count - a.count);

  const W = 920, H = 260, PAD_T = 12, PAD_R = 16, PAD_B = 36, PAD_L = 56;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const maxCount = Math.max(...sorted.map(s => s.count), 1);

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.setAttribute("class", "dv2-ctxlat-svg");
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", String(H));

  // Y-axis ticks
  for (let i = 0; i <= 4; i++) {
    const v = (i / 4) * maxCount;
    const y = PAD_T + (1 - i / 4) * innerH;
    svg("line", { x1: PAD_L, x2: PAD_L + innerW, y1: y, y2: y, stroke: "var(--tv-border)", "stroke-width": 0.5, "stroke-dasharray": "2 3", opacity: 0.4 }, svgEl);
    const lbl = svg("text", { x: PAD_L - 6, y: y + 4, "text-anchor": "end", fill: "var(--tv-text-muted)", "font-size": 10, "font-family": "var(--tv-mono)" }, svgEl);
    lbl.textContent = Math.round(v).toString();
  }
  const yAxisLbl = svg("text", {
    x: 14, y: PAD_T + innerH / 2,
    "text-anchor": "middle", fill: "var(--tv-text-muted)", "font-size": 10,
    transform: `rotate(-90 14 ${PAD_T + innerH / 2})`,
  }, svgEl);
  yAxisLbl.textContent = "compactions";

  const xAxisLbl = svg("text", { x: PAD_L + innerW / 2, y: H - 8, "text-anchor": "middle", fill: "var(--tv-text-muted)", "font-size": 10 }, svgEl);
  xAxisLbl.textContent = "sessions (sorted by compaction count)";

  // Bars
  const barW = innerW / sorted.length;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const h = (s.count / maxCount) * innerH;
    const x = PAD_L + i * barW;
    const y = PAD_T + innerH - h;
    const color = s.count === 0 ? "#4a5568" : s.count >= 5 ? "#fc5c65" : s.count >= 2 ? "#ed8936" : "#48bb78";
    const rect = svg("rect", { x: x + 0.5, y, width: Math.max(barW - 1, 1), height: h, fill: color, opacity: 0.85 }, svgEl) as SVGElement;
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tip.textContent = `Session ${s.session}: ${s.count} compaction${s.count === 1 ? "" : "s"}`;
    rect.appendChild(tip);
    // Show label inline if there's room
    if (h > 14 && s.count > 0) {
      const lbl = svg("text", { x: x + barW / 2, y: y + 11, "text-anchor": "middle", fill: "#fff", "font-size": 9, "font-weight": 600 }, svgEl);
      lbl.textContent = String(s.count);
    }
  }

  wrap.appendChild(svgEl);
  return wrap;
}

// ── Summary text per view ──
function scatterSummary(points: CtxLatPoint[]): string {
  if (points.length < 8) return "Not enough data yet.";
  const BINS = 14;
  const bins: number[][] = Array.from({ length: BINS }, () => []);
  for (const p of points) {
    const idx = Math.min(BINS - 1, Math.max(0, Math.floor(ctxXLog(p.x) * BINS)));
    bins[idx].push(p.y);
  }
  const trend: { x: number; p50: number }[] = [];
  for (let i = 0; i < BINS; i++) {
    if (bins[i].length === 0) continue;
    const sorted = [...bins[i]].sort((a, b) => a - b);
    const xVal = Math.exp(Math.log(CTX_X_MIN) + ((i + 0.5) / BINS) * (Math.log(CTX_X_MAX) - Math.log(CTX_X_MIN)));
    trend.push({ x: xVal, p50: sorted[Math.floor(sorted.length / 2)] });
  }
  if (trend.length < 2) return "Not enough range to call a trend yet.";
  const lo = trend[0], hi = trend[trend.length - 1];
  const ratio = hi.p50 / lo.p50;
  const word = ratio >= 3 ? "much slower" : ratio >= 1.5 ? "slower" : ratio <= 0.7 ? "faster" : "about the same";
  return `At small contexts (${fmtTok(lo.x)}) the median response is <strong>${formatLatency(lo.p50)}</strong>; ` +
    `at large contexts (${fmtTok(hi.x)}) it's <strong>${formatLatency(hi.p50)}</strong> — ` +
    `${ratio >= 1 ? `<strong>${ratio.toFixed(1)}× ${word}</strong>` : `<strong>${(1 / ratio).toFixed(1)}× ${word}</strong>`}.`;
}

function distributionSummary(points: CtxLatPoint[]): string {
  if (points.length === 0) return "No AI responses with token data.";
  const xs = points.map(p => p.x);
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];

  // % of responses below common round-number thresholds — gives the user the
  // "typically I'm operating at X" answer they asked for.
  const thresholds = [10_000, 25_000, 50_000, 100_000, 200_000, 500_000];
  const pctBelow = (n: number) => (sorted.findIndex(v => v >= n) === -1 ? 100 : (sorted.findIndex(v => v >= n) / sorted.length) * 100);
  const breakdown = thresholds.map(t => {
    const pct = pctBelow(t);
    return `<strong>${pct.toFixed(0)}%</strong> &lt;${fmtTok(t)}`;
  }).join(" · ");

  return `Avg <strong>${fmtTok(mean)}</strong> · median <strong>${fmtTok(median)}</strong> · ` +
    `middle 50%: <strong>${fmtTok(p25)} → ${fmtTok(p75)}</strong> · p90 <strong>${fmtTok(p90)}</strong>` +
    `<br><span style="color:var(--tv-text-muted);font-size:11px">Cumulative: ${breakdown}</span>`;
}

function compHistSummary(values: number[], lead: string): string {
  if (values.length === 0) return "No compactions in the selected sessions.";
  const sorted = [...values].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  return `${lead} <strong>${fmtTok(p50)}</strong> (median, n=${values.length}). ` +
    `Middle 50% of compactions: <strong>${fmtTok(p25)} → ${fmtTok(p75)}</strong>.`;
}

function freqSummary(perSession: number[]): string {
  const total = perSession.reduce((s, v) => s + v, 0);
  const sessionsWithComp = perSession.filter(c => c > 0).length;
  const totalSessions = perSession.length;
  if (total === 0) {
    return `<strong>0 compactions</strong> across ${totalSessions} session${totalSessions === 1 ? "" : "s"} — none of your sessions hit the context limit.`;
  }
  const sortedDesc = [...perSession].sort((a, b) => b - a);
  const max = sortedDesc[0];
  const avgAcrossAll = total / totalSessions;
  const avgAmongCompacting = total / Math.max(sessionsWithComp, 1);
  return `<strong>${total} compactions</strong> across <strong>${sessionsWithComp}/${totalSessions}</strong> session${totalSessions === 1 ? "" : "s"}. ` +
    `Avg <strong>${avgAcrossAll.toFixed(1)}/session</strong> (all) · ` +
    `<strong>${avgAmongCompacting.toFixed(1)}/session</strong> (only those that compacted) · ` +
    `worst session: <strong>${max}</strong>.`;
}

export function buildTimeBreakdown(events: TrajectoryEvent[]): HTMLElement | null {
  if (events.length < 10) return null;

  const AFK_MS = 15 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const buckets: Record<string, number> = {
    "AI Responding": 0,
    "Tool Execution": 0,
    "Thinking": 0,
    "User Responding (<15m)": 0,
    "User Away (15m+)": 0,
  };
  // Sub-buckets for the second ratio bar — splits Away (15m+) into "stepped
  // out for a bit" vs "gone for the night/day". The user wants to see both.
  let awayShortMs = 0; // 15m ≤ gap < 60m
  let awayLongMs = 0;  // gap ≥ 60m

  // Use actual measured durations, not gap attribution
  // Tool execution: tool_call timestamp → matching tool_result timestamp
  const toolCallTs = new Map<number, number>(); // event id → timestamp ms
  for (const e of events) {
    if (e.type === "tool_call") {
      const ts = new Date(e.timestamp).getTime();
      if (!isNaN(ts)) toolCallTs.set(e.id, ts);
    }
    if (e.type === "tool_result" && e.toolResult?.toolCallEventId != null) {
      const callTs = toolCallTs.get(e.toolResult.toolCallEventId);
      const resultTs = new Date(e.timestamp).getTime();
      if (callTs && !isNaN(resultTs)) {
        const dur = resultTs - callTs;
        if (dur > 0 && dur < AFK_MS) buckets["Tool Execution"] += dur;
      }
    }
  }

  // AI response time: last input event (tool_result or user msg) → next assistant event
  // User wait time: last assistant event → next user text message
  let lastInputTs: number | null = null;
  let lastAiTs: number | null = null;

  for (const e of events) {
    const ts = new Date(e.timestamp).getTime();
    if (isNaN(ts)) continue;

    if (e.role === "assistant" && (e.type === "message" || e.type === "tool_call")) {
      // AI started responding — gap from last input is AI think/respond time
      if (lastInputTs != null) {
        const dur = ts - lastInputTs;
        if (dur > 0 && dur < AFK_MS) buckets["AI Responding"] += dur;
      }
      lastAiTs = ts;
      lastInputTs = null;
    } else if (e.type === "tool_result") {
      lastInputTs = ts;
    } else if (isHumanUserMessage(e)) {
      // User responded — split into active thinking vs away
      if (lastAiTs != null) {
        const dur = ts - lastAiTs;
        if (dur > 0) {
          if (dur >= AFK_MS) {
            buckets["User Away (15m+)"] += dur;
            if (dur >= HOUR_MS) awayLongMs += dur;
            else awayShortMs += dur;
          } else {
            buckets["User Responding (<15m)"] += dur;
          }
        }
      }
      lastInputTs = ts;
      lastAiTs = null;
    }

    if (e.type === "thinking") {
      // Attribute thinking time from latency if available, else small fixed amount
      buckets["Thinking"] += e.tokens?.latencyMs ?? 500;
    }
  }

  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  if (total < 30000) return null; // less than 30s of active time — skip

  const wrap = document.createElement("div");
  wrap.className = "dv2-time-bar-wrap";

  const header = document.createElement("div");
  header.className = "dv2-time-bar-header";
  const title = document.createElement("span");
  title.className = "dv2-time-bar-title";
  title.textContent = "Active Time Breakdown";
  header.appendChild(title);
  const totalLabel = document.createElement("span");
  totalLabel.className = "dv2-time-bar-total";
  const awayMs = buckets["User Away (15m+)"] ?? 0;
  const activeMs = total - awayMs;
  totalLabel.textContent = awayMs > 0
    ? fmtDur(activeMs) + " active + " + fmtDur(awayMs) + " away"
    : fmtDur(total) + " active";
  header.appendChild(totalLabel);
  wrap.appendChild(header);

  // Two stacked bars:
  //   1. ACTIVE breakdown — AI / Tool / Thinking / User Responding, percentages
  //      taken over active time only so they sum to 100% and reflect what
  //      the section title implies.
  //   2. ACTIVE vs AWAY ratio — a skinny bar showing how much of the wallclock
  //      was active vs away (15m+ gaps), so the dominance of "away" time is
  //      still visible at a glance without distorting the active breakdown.
  const ACTIVE_LABELS = ["AI Responding", "Tool Execution", "Thinking", "User Responding (<15m)"];

  // Bar 1 — Active breakdown (% of active time)
  const activeBar = document.createElement("div");
  activeBar.className = "dv2-time-bar";
  for (const label of ACTIVE_LABELS) {
    const ms = buckets[label] ?? 0;
    if (ms <= 0) continue;
    const pct = activeMs > 0 ? (ms / activeMs) * 100 : 0;
    const seg = document.createElement("div");
    seg.className = "dv2-time-seg";
    seg.style.width = pct + "%";
    seg.style.background = TIME_COLORS[label] ?? "#778ca3";
    seg.title = `${label}: ${fmtDur(ms)} (${pct > 0 && pct < 1 ? "<1" : Math.round(pct)}% of active time)`;
    activeBar.appendChild(seg);
  }
  wrap.appendChild(activeBar);

  // Active legend (% of active)
  const activeLegend = document.createElement("div");
  activeLegend.className = "dv2-time-legend";
  for (const label of ACTIVE_LABELS) {
    const ms = buckets[label] ?? 0;
    if (ms <= 0) continue;
    const rawPct = activeMs > 0 ? (ms / activeMs) * 100 : 0;
    const pctLabel = rawPct > 0 && rawPct < 1 ? "<1%" : Math.round(rawPct) + "%";
    const item = document.createElement("div");
    item.className = "dv2-time-legend-item";
    const dot = document.createElement("span");
    dot.className = "dv2-time-legend-dot";
    dot.style.background = TIME_COLORS[label] ?? "#778ca3";
    item.appendChild(dot);
    item.appendChild(document.createTextNode(`${label} ${pctLabel}`));
    activeLegend.appendChild(item);
  }
  wrap.appendChild(activeLegend);

  // Bar 2 — Wallclock by user-gap length, three buckets:
  //   Active (<15m)     — engaged time: AI working + tools + thinking + you typing
  //   Away 15–60m       — stepped out briefly, came back same hour
  //   Away 60m+         — overnight / multi-day gap
  // Only render if there's actual away time, otherwise it'd be a 100%
  // active bar that adds nothing.
  if (awayMs > 0 && total > 0) {
    const ratioWrap = document.createElement("div");
    ratioWrap.className = "dv2-time-ratio-wrap";

    const ratioTitle = document.createElement("div");
    ratioTitle.className = "dv2-time-ratio-title";
    ratioTitle.textContent = "Total wallclock — by user-gap length";
    ratioWrap.appendChild(ratioTitle);

    const ratioBar = document.createElement("div");
    ratioBar.className = "dv2-time-bar dv2-time-bar-thin";

    const activePct = (activeMs / total) * 100;
    const awayShortPct = (awayShortMs / total) * 100;
    const awayLongPct = (awayLongMs / total) * 100;

    const segs: { label: string; color: string; ms: number; pct: number; tooltip: string }[] = [
      { label: "Active (<15m)", color: "#4f8ff7", ms: activeMs, pct: activePct,
        tooltip: `Active (<15m gaps): ${fmtDur(activeMs)} — AI + tools + thinking + you typing` },
      { label: "Away 15–60m", color: "#718096", ms: awayShortMs, pct: awayShortPct,
        tooltip: `Away 15–60m: ${fmtDur(awayShortMs)} — stepped out briefly` },
      { label: "Away 60m+", color: "#2d3748", ms: awayLongMs, pct: awayLongPct,
        tooltip: `Away 60m+: ${fmtDur(awayLongMs)} — overnight or multi-day gap` },
    ];

    for (const s of segs) {
      if (s.ms <= 0) continue;
      const seg = document.createElement("div");
      seg.className = "dv2-time-seg";
      seg.style.width = s.pct + "%";
      seg.style.background = s.color;
      seg.title = `${s.tooltip} (${s.pct > 0 && s.pct < 1 ? "<1" : Math.round(s.pct)}% of total)`;
      ratioBar.appendChild(seg);
    }

    ratioWrap.appendChild(ratioBar);

    const ratioLegend = document.createElement("div");
    ratioLegend.className = "dv2-time-legend";
    for (const s of segs) {
      if (s.ms <= 0) continue;
      const item = document.createElement("div");
      item.className = "dv2-time-legend-item";
      const dot = document.createElement("span");
      dot.className = "dv2-time-legend-dot";
      dot.style.background = s.color;
      item.appendChild(dot);
      const pctLabel = s.pct > 0 && s.pct < 1 ? "<1%" : Math.round(s.pct) + "%";
      item.appendChild(document.createTextNode(`${s.label} ${pctLabel}`));
      ratioLegend.appendChild(item);
    }
    ratioWrap.appendChild(ratioLegend);

    wrap.appendChild(ratioWrap);
  }

  return wrap;
}

// ── Takeaways ────────────────────────────────────────────────────────
// Goal: 5 data-backed findings, each with a concrete action, prioritized
// by impact. The rule we follow: every "fact" sentence must cite numbers
// computed from the user's actual events. We're allowed to interpret
// causally in our heads (e.g. "compaction trims context, so latency
// should drop after"), but the on-screen claim must be measurable
// behavior the user can verify in their data.
//
// Each takeaway has:
//   priority — higher floats to top; we render the top 5
//   fact     — one sentence, numbers in <strong>, nothing speculative
//   action   — one short suggestion the user can act on this week
//
// Takeaways are skipped when their data threshold isn't met (e.g. you
// can't talk about latency degradation without enough samples).

interface Takeaway {
  priority: number;
  fact: string;
  action?: string;
  /** Optional list rendered as a compact details/items block below the
   * action — used by takeaways that have multiple concrete artifacts the
   * user can act on (e.g. top files to create a digest for). */
  items?: { label: string; meta?: string }[];
  itemsTitle?: string;
  /** Optional one-line "earlier vs later half" trend strip — answers
   * "am I getting better or worse at this?" Only set when the data
   * shows a real shift (>=10% change between halves). */
  trend?: string;
  /** Optional one-line "by primary model" breakdown — answers "is my
   * model choice making this metric better/worse?" Only set when at
   * least 2 models each have 2+ sessions. */
  byModel?: string;
}

export function buildTakeaways(trajectories: Trajectory[], opts?: { limit?: number; fullPage?: boolean }): HTMLElement | null {
  const takeaways: Takeaway[] = [];
  const allEvents = trajectories.flatMap(t => t.events);
  const totalSessions = trajectories.length;

  // ── Helpers shared across takeaways ───────────────────────────────
  // Keep the model VERSION (opus-4-6 ≠ opus-4-7) — collapsing them hides
  // real differences between releases. Strip provider prefix and the
  // date snapshot suffix, that's it. Matches the model-chip styling the
  // user already sees elsewhere on the dashboard.
  const normalizeModel = (m: string): string => {
    return m
      .replace(/^claude-/i, "")            // claude-opus-4-7  → opus-4-7
      .replace(/-\d{8}$/, "")              // -20251201 snapshot → drop
      .replace(/^anthropic\//i, "")        // anthropic/...
      .toLowerCase();
  };
  // Primary model for a session = model that produced the most output
  // tokens. Used to bucket sessions by model for the byModel breakdown.
  const primaryModel = (t: Trajectory): string | null => {
    const tokens = new Map<string, number>();
    for (const ev of t.events) {
      if (ev.model && ev.tokens?.output) {
        tokens.set(ev.model, (tokens.get(ev.model) ?? 0) + ev.tokens.output);
      }
    }
    if (tokens.size === 0) return null;
    return normalizeModel([...tokens.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  };

  /** Earlier-half vs later-half trend strip for a metric.
   * Returns undefined when the data isn't long enough to call a trend
   * or the change between halves is below the noise floor. */
  function trendFor(
    metricName: string,
    format: (v: number) => string,
    metric: (t: Trajectory) => number | null,
    minNoiseRatio = 0.10,
  ): string | undefined {
    if (trajectories.length < 6) return undefined;
    const sorted = [...trajectories].sort(
      (a, b) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime()
    );
    const half = Math.floor(sorted.length / 2);
    const earlier = sorted.slice(0, half).map(metric).filter((v): v is number => v != null);
    const later = sorted.slice(half).map(metric).filter((v): v is number => v != null);
    if (earlier.length < 2 || later.length < 2) return undefined;
    const eAvg = earlier.reduce((s, v) => s + v, 0) / earlier.length;
    const lAvg = later.reduce((s, v) => s + v, 0) / later.length;
    const noise = Math.max(eAvg, lAvg) * minNoiseRatio;
    if (Math.abs(lAvg - eAvg) < noise) return undefined;
    const arrow = lAvg < eAvg ? "↓" : "↑";
    return `<span class="dv2-takeaway-trend-arrow">${arrow}</span> ${metricName} <strong>${format(eAvg)}</strong> → <strong>${format(lAvg)}</strong> over the period`;
  }

  /** "By primary model" strip — comma-separated per-model averages.
   * Skipped when fewer than 2 models have ≥2 sessions each. */
  function byModelFor(
    format: (v: number) => string,
    metric: (t: Trajectory) => number | null,
  ): string | undefined {
    const grouped = new Map<string, number[]>();
    for (const t of trajectories) {
      const v = metric(t);
      if (v == null) continue;
      const m = primaryModel(t);
      if (!m) continue;
      if (!grouped.has(m)) grouped.set(m, []);
      grouped.get(m)!.push(v);
    }
    const entries = [...grouped.entries()].filter(([, vs]) => vs.length >= 2);
    if (entries.length < 2) return undefined;
    // Sort low-to-high so "best" tends to land first for negative-good
    // metrics; user can read either direction since each value is shown.
    entries.sort((a, b) => {
      const aAvg = a[1].reduce((s, v) => s + v, 0) / a[1].length;
      const bAvg = b[1].reduce((s, v) => s + v, 0) / b[1].length;
      return aAvg - bAvg;
    });
    return entries
      .map(([name, vs]) => `<strong>${name}</strong> ${format(vs.reduce((s, v) => s + v, 0) / vs.length)}`)
      .join(" · ");
  }
  // Per-session metric extractors (reused by trendFor + byModelFor)
  const compactionsOf = (t: Trajectory) => t.events.filter(e => e.contextCompacted).length;
  const subagentsOf = (t: Trajectory) => {
    const labels = new Set<string>();
    for (const e of t.events) if (e.agent) labels.add(e.agent);
    return labels.size;
  };
  const retryRateOf = (t: Trajectory): number | null => {
    let calls = 0, errors = 0;
    for (const e of t.events) {
      if (e.type === "tool_call") calls++;
      if (e.type === "tool_result" && e.toolResult?.isError) errors++;
    }
    return calls === 0 ? null : errors / calls;
  };
  const wasteRatioOf = (t: Trajectory): number | null => {
    const events = t.events;
    const lastEditIdx = events.reduce((last, ev, i) => {
      if (ev.type === "tool_call" && ev.toolCall) {
        const n = ev.toolCall.name.toLowerCase();
        if (n === "edit" || n === "editfile" || n === "editlines" || n === "write" || n === "writefile") return i;
      }
      return last;
    }, -1);
    const totalOut = events.reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
    if (totalOut === 0 || lastEditIdx <= 0 || lastEditIdx >= events.length - 1) return null;
    const after = events.slice(lastEditIdx + 1).reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
    return after / totalOut;
  };
  const peakContextOf = (t: Trajectory): number | null => {
    let peak = 0;
    for (const ev of t.events) {
      if (ev.role === "assistant" && ev.tokens) {
        const ctx = (ev.tokens.input ?? 0) + (ev.tokens.cacheRead ?? 0) + (ev.tokens.cacheWrite ?? 0);
        if (ctx > peak) peak = ctx;
      }
    }
    return peak === 0 ? null : peak;
  };

  // Frustration patterns — kept at top so the per-session count helper
  // below can reuse them, and the takeaway code below references the
  // same arrays.
  const USER_FRUSTRATION = [
    /\bthat\s+(didn'?t|doesn'?t|doesn't)\s+(work|help)/i,
    /\bstill (broken|not working|wrong|failing)/i,
    /\b(this is wrong|this is broken)/i,
    /\b(stop( doing| it)?|wait|hold on)\b/i,
    /\b(no,? (that|do)|nope[, ]|why are you)/i,
    /\bnot (right|what i (asked|wanted))/i,
    /\b(you broke|undo|revert)\b/i,
    /\b(damn|fuck|wtf|wth)\b/i,
    /\bsame (error|issue|problem)\b/i,
    /\b(don'?t panic|stop panicking)/i,
  ];
  const AI_FRUSTRATION = [
    /\bI (apologize|am sorry|'m sorry)\b/i,
    /\b(let me|i'?ll) try (again|a different)/i,
    /\byou'?re (right|correct).*(my (mistake|apologies))/i,
    /\bi (made|see) (a |the )?mistake\b/i,
    /\bthat was (wrong|incorrect)/i,
    /\blet me start (over|fresh)/i,
    /\b(panic|panicking|panicked)\b/i,
    /\bi'?m (stuck|confused|lost|worried|stressed|frustrated)\b/i,
    /\b(this is concerning|this is troubling|this is bad)\b/i,
    /\bi (keep|cannot|can'?t) (figure|getting|seeing|fix)/i,
    /\bi don'?t (know|understand) (what|why|how)/i,
    /\b(something|nothing) (is )?(seriously|really) wrong\b/i,
    /\bgoing in circles\b/i,
  ];

  // Per-session reads of unedited heavy-read files (used by heavy-reads takeaway)
  const heavyReadsOf = (t: Trajectory): number => {
    const reads = new Map<string, number>();
    const edited = new Set<string>();
    for (const ev of t.events) {
      if (ev.type !== "tool_call" || !ev.toolCall) continue;
      const name = ev.toolCall.name.toLowerCase();
      const args = ev.toolCall.arguments;
      const path = typeof args === "object" && args !== null
        ? ((args as Record<string, unknown>).file_path ?? (args as Record<string, unknown>).path ?? "") as string
        : "";
      const short = path ? (path.split("/").pop() ?? path.split("\\").pop() ?? path) : "";
      if (!short) continue;
      if (name === "read" || name === "readfile" || name === "readfilerange" || name === "cat") {
        reads.set(short, (reads.get(short) ?? 0) + 1);
      }
      if (name === "edit" || name === "editfile" || name === "editlines" || name === "write" || name === "writefile") {
        edited.add(short);
      }
    }
    let total = 0;
    for (const [f, c] of reads) if (!edited.has(f) && c >= 3) total += c;
    return total;
  };

  // Per-session frustration signal count (used by frustration takeaway)
  const frustOf = (t: Trajectory): number => {
    let n = 0;
    for (const e of t.events) {
      if (!e.content || typeof e.content !== "string") continue;
      if (isHumanUserMessage(e) && USER_FRUSTRATION.some(rx => rx.test(e.content!))) n++;
      else if (e.role === "assistant" && e.type === "message" && AI_FRUSTRATION.some(rx => rx.test(e.content!))) n++;
    }
    return n;
  };

  // ── 1. Latency degradation at high context ───────────────────────────
  // Collect (context, latency) per AI message; compare top quartile
  // context against bottom quartile.
  const ctxLatPoints: { ctx: number; lat: number }[] = [];
  for (const t of trajectories) {
    for (let i = 1; i < t.events.length; i++) {
      const ev = t.events[i];
      if (ev.role !== "assistant" || ev.type !== "message" || !ev.tokens) continue;
      const ctx = (ev.tokens.input ?? 0) + (ev.tokens.cacheRead ?? 0) + (ev.tokens.cacheWrite ?? 0);
      if (ctx <= 0) continue;
      const ts = new Date(ev.timestamp).getTime();
      const prevTs = new Date(t.events[i - 1].timestamp).getTime();
      if (!isFinite(ts) || !isFinite(prevTs) || ts <= prevTs) continue;
      const lat = ts - prevTs;
      if (lat < 500 || lat > 30 * 60_000) continue;
      ctxLatPoints.push({ ctx, lat });
    }
  }
  if (ctxLatPoints.length >= 50) {
    const byCtx = [...ctxLatPoints].sort((a, b) => a.ctx - b.ctx);
    const q1 = byCtx.slice(0, Math.floor(byCtx.length / 4));
    const q4 = byCtx.slice(Math.floor(byCtx.length * 3 / 4));
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const q1Lat = med(q1.map(p => p.lat));
    const q4Lat = med(q4.map(p => p.lat));
    const q1Ctx = med(q1.map(p => p.ctx));
    const q4Ctx = med(q4.map(p => p.ctx));
    const ratio = q4Lat / Math.max(q1Lat, 1);
    // Find the inflection threshold: smallest context bucket where median
    // latency hits 1.5× the q1 median. That's a more honest "where does it
    // start to bite" number than just stating q4.
    const STEP_BINS = 8;
    const sortedAll = [...ctxLatPoints].sort((a, b) => a.ctx - b.ctx);
    let crossover = q4Ctx;
    for (let i = 1; i < STEP_BINS; i++) {
      const slice = sortedAll.slice(0, Math.floor((sortedAll.length * i) / STEP_BINS));
      if (slice.length < 10) continue;
      const m = med(slice.map(p => p.lat));
      if (m >= q1Lat * 1.5) {
        crossover = med(slice.slice(-Math.max(5, slice.length / 5)).map(p => p.ctx));
        break;
      }
    }
    if (ratio >= 1.8) {
      takeaways.push({
        priority: 95,
        fact: `Your responses get noticeably slower once context crosses <strong>~${fmtTok(crossover)}</strong>. By the time context reaches <strong>~${fmtTok(q4Ctx)}</strong>, responses are <strong>${ratio.toFixed(1)}× slower</strong> than at small contexts (median <strong>${formatLatency(q4Lat)}</strong> vs <strong>${formatLatency(q1Lat)}</strong>).`,
        action: `This is LLM physics, not your workflow — every model slows down with bigger prompts. The lever you control is <em>when to start fresh</em>: when context approaches ~${fmtTok(crossover)}, ask the AI for a 1-paragraph recap and continue in a new session. Subagents help too (their context doesn't enter the parent).`,
        trend: trendFor("peak context per session", v => fmtTok(v), peakContextOf, 0.15),
        byModel: byModelFor(v => fmtTok(v) + " peak", peakContextOf),
      });
    }
  }

  // ── 2. Subagent leverage ─────────────────────────────────────────────
  // Subagent events are merged INTO the parent trajectory at parse time
  // (see common/merge-subagents.ts) and tagged with `event.agent` set to
  // the subagent's identifier/name. So we count subagents by walking
  // events and grouping by `agent`, not by looking at separate
  // trajectories. We also still check parentSessionId in case a session
  // wasn't merged.
  const subagentEvents = allEvents.filter(e => e.agent);
  const subagentLabels = new Set<string>();
  for (const e of subagentEvents) if (e.agent) subagentLabels.add(e.agent);
  // Add separately-loaded subagent trajectories too (uncommon after merge)
  const standaloneSubs = trajectories.filter(t => t.parentSessionId);
  for (const t of standaloneSubs) subagentLabels.add(t.session.id);

  const subagentRunCount = subagentLabels.size;
  const subagentOutputFromEvents = subagentEvents.reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
  const subagentOutputFromTrajs = standaloneSubs.reduce((s, t) => {
    const sm = t.summary ?? computeSummary(t.events);
    return s + sm.totalTokens.output;
  }, 0);
  const subagentOutput = subagentOutputFromEvents + subagentOutputFromTrajs;

  // Sessions that USED subagents (had any agent-tagged event)
  const sessionsUsingSubs = trajectories.filter(t => t.events.some(e => e.agent)).length;

  if (subagentRunCount > 0) {
    const subagentTrend = trendFor("subagents/session", v => v.toFixed(1), subagentsOf, 0.15);
    const subagentByModel = byModelFor(v => v.toFixed(1) + "/session", subagentsOf);
    if (subagentOutput >= 50_000) {
      takeaways.push({
        priority: 88,
        fact: `You ran <strong>${subagentRunCount} subagent${subagentRunCount === 1 ? "" : "s"}</strong> across <strong>${sessionsUsingSubs} session${sessionsUsingSubs === 1 ? "" : "s"}</strong>. They produced <strong>${fmtTok(subagentOutput)} of output</strong> — none of which entered your main context.`,
        action: "Subagents are working as a context tax-shelter. Keep using them for parallel scans, audits, and \"go look at X and report back\" tasks where the parent only needs the summary.",
        trend: subagentTrend,
        byModel: subagentByModel,
      });
    } else {
      takeaways.push({
        priority: 70,
        fact: `You ran <strong>${subagentRunCount} subagent${subagentRunCount === 1 ? "" : "s"}</strong>, producing <strong>${fmtTok(subagentOutput)} of output</strong> kept out of your main context.`,
        action: "Subagents are useful but light-touch in your data. They pay off most when the work is bulky (file scans, audits, exploratory reads).",
        trend: subagentTrend,
        byModel: subagentByModel,
      });
    }
  } else if (totalSessions >= 3 && allEvents.length > 1000) {
    // No subagents in a long multi-session selection — flag the opportunity.
    // Trend + byModel here will usually be empty (it's a zero-everywhere
    // metric) but compaction-rate + peak-context show up as proxies for
    // "what would subagents help with."
    takeaways.push({
      priority: 60,
      fact: `You haven't used subagents in any of these <strong>${totalSessions} sessions</strong> (${allEvents.length.toLocaleString()} events).`,
      action: "Subagents run in their own context window — their output never inflates the parent. Try them for file scans, codebase audits, or any \"go look at X and report back\" task. They're often the cheapest way to keep context lean.",
      trend: trendFor("compactions/session (proxy for context pressure)", v => v.toFixed(1), compactionsOf, 0.20),
      byModel: byModelFor(v => fmtTok(v) + " peak ctx", peakContextOf),
    });
  }

  // ── 3. Top retry source ──────────────────────────────────────────────
  // Group tool errors by tool name and report the worst offender.
  const errorsByTool = new Map<string, number>();
  const callsByTool = new Map<string, number>();
  let totalErrors = 0;
  let totalCalls = 0;
  // Build event-id → tool name map so we can attribute errors to their callers
  const toolCallNameById = new Map<number, string>();
  for (const ev of allEvents) {
    if (ev.type === "tool_call" && ev.toolCall) {
      toolCallNameById.set(ev.id, ev.toolCall.name);
      callsByTool.set(ev.toolCall.name, (callsByTool.get(ev.toolCall.name) ?? 0) + 1);
      totalCalls++;
    }
    if (ev.type === "tool_result" && ev.toolResult?.isError) {
      totalErrors++;
      const callId = ev.toolResult.toolCallEventId;
      const name = callId != null ? toolCallNameById.get(callId) : undefined;
      if (name) errorsByTool.set(name, (errorsByTool.get(name) ?? 0) + 1);
    }
  }
  // Bash retries are usually noise: probing commands that legitimately fail
  // (`ls /tmp/foo` returns 1, `git diff --quiet` is meant to non-zero, etc.).
  // For most users that's just how shell scripting works, so we skip Bash
  // and look for the next-most-frequent retry source — typically Edit /
  // Write / regex-style tools where errors signal a real problem the user
  // can fix.
  const NOISY_TOOLS = new Set(["bash", "shell", "powershell", "exec"]);
  if (totalErrors >= 10 && totalCalls > 0) {
    const sorted = [...errorsByTool.entries()]
      .filter(([name]) => !NOISY_TOOLS.has(name.toLowerCase()))
      .sort((a, b) => b[1] - a[1]);
    const [topTool, topCount] = sorted[0] ?? ["", 0];
    if (topTool && topCount >= 5) {
      const pctOfRetries = (topCount / totalErrors) * 100;
      const toolCalls = callsByTool.get(topTool) ?? 1;
      const toolFailRate = (topCount / toolCalls) * 100;
      takeaways.push({
        priority: 80,
        fact: `<strong>${topTool}</strong> failed <strong>${topCount} times</strong> (${pctOfRetries.toFixed(0)}% of all your retries) at a <strong>${toolFailRate.toFixed(0)}% fail rate</strong>.`,
        action: `Open the Errors view, filter to ${topTool}. Most ${topTool} failures are a single fixable assumption — once you spot the pattern, the loop stops.`,
        trend: trendFor("overall retry rate", v => (v * 100).toFixed(1) + "%", retryRateOf, 0.10),
        byModel: byModelFor(v => (v * 100).toFixed(1) + "%", retryRateOf),
      });
    }
  }

  // ── 4. Output waste after last edit ──────────────────────────────────
  // For each session, find the last edit-like tool call. Tokens output
  // after that point are tokens the AI spent monologuing once the work
  // was done. Aggregate across sessions.
  let totalAfterEdit = 0;
  let totalOutput = 0;
  for (const t of trajectories) {
    const events = t.events;
    const lastEditIdx = events.reduce((last, ev, i) => {
      if (ev.type === "tool_call" && ev.toolCall) {
        const n = ev.toolCall.name.toLowerCase();
        if (n === "edit" || n === "editfile" || n === "editlines" || n === "write" || n === "writefile") return i;
      }
      return last;
    }, -1);
    const sessionOutput = events.reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
    totalOutput += sessionOutput;
    if (lastEditIdx > 0 && lastEditIdx < events.length - 3) {
      totalAfterEdit += events.slice(lastEditIdx + 1).reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
    }
  }
  if (totalOutput > 100_000) {
    const pct = (totalAfterEdit / totalOutput) * 100;
    if (pct >= 20) {
      takeaways.push({
        priority: 75,
        fact: `<strong>${pct.toFixed(0)}% of your output tokens</strong> (≈${fmtTok(totalAfterEdit)}) were generated <em>after</em> the AI's last edit — recap, summary, or commentary.`,
        action: "Add an explicit stop signal to your prompts (\"stop after the last edit, no recap\") or use shorter system prompts.",
        trend: trendFor("post-edit output share", v => (v * 100).toFixed(0) + "%", wasteRatioOf, 0.15),
        byModel: byModelFor(v => (v * 100).toFixed(0) + "%", wasteRatioOf),
      });
    }
  }

  // ── 4b. Frustration signals ─────────────────────────────────────────
  // Pattern arrays (USER_FRUSTRATION, AI_FRUSTRATION) are defined at the
  // top of buildTakeaways so heavyReadsOf / frustOf can reuse them.
  // ── Frustration signal collection with per-signal metadata ──
  // For each match we capture the moment's context size and the latency
  // of the most recent AI response — so we can answer "is frustration
  // correlated with big contexts or slow responses?" using the user's
  // own data, not folklore.
  interface FrustSignal {
    sessionIdx: number;
    ts: number;
    role: "user" | "ai";
    contextAtMoment: number;      // sum of input+cache_read+cache_write of the most recent AI message
    latencyBefore: number;        // ms from previous event to this one (0 if first)
    hasSubagentInSession: boolean;
  }
  const signals: FrustSignal[] = [];
  // Baseline pairs (context size at the AI message, latency to reach it).
  // Collected as pairs so we can compute conditional medians ("when
  // context is X, how long does the AI typically take?") — not just an
  // overall median, which conflates fast small-context responses with
  // slow large-context ones.
  const baselinePairs: { ctx: number; lat: number }[] = [];

  for (let s = 0; s < trajectories.length; s++) {
    const events = trajectories[s].events;
    const hasSubagent = events.some(e => e.agent);
    let lastAiCtx = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const ts = new Date(e.timestamp).getTime();
      if (!isFinite(ts)) continue;
      // Track most recent AI message context for use as "context at moment"
      if (e.role === "assistant" && e.type === "message" && e.tokens) {
        const ctx = (e.tokens.input ?? 0) + (e.tokens.cacheRead ?? 0) + (e.tokens.cacheWrite ?? 0);
        if (ctx > 0) lastAiCtx = ctx;
        // Baseline pair only when both sides are valid — otherwise the
        // conditional lookup gets distorted.
        if (ctx > 0 && i > 0) {
          const prevTs = new Date(events[i - 1].timestamp).getTime();
          if (isFinite(prevTs) && ts > prevTs) {
            const lat = ts - prevTs;
            if (lat >= 500 && lat <= 30 * 60_000) {
              baselinePairs.push({ ctx, lat });
            }
          }
        }
      }
      if (!e.content) continue;
      const matchedUser = isHumanUserMessage(e) && typeof e.content === "string"
        && USER_FRUSTRATION.some(rx => rx.test(e.content!));
      const matchedAi = e.role === "assistant" && e.type === "message" && typeof e.content === "string"
        && AI_FRUSTRATION.some(rx => rx.test(e.content!));
      if (!matchedUser && !matchedAi) continue;
      const prevTs = i > 0 ? new Date(events[i - 1].timestamp).getTime() : NaN;
      const lat = isFinite(prevTs) && ts > prevTs ? ts - prevTs : 0;
      signals.push({
        sessionIdx: s,
        ts,
        role: matchedUser ? "user" : "ai",
        contextAtMoment: lastAiCtx,
        latencyBefore: lat,
        hasSubagentInSession: hasSubagent,
      });
    }
  }

  if (signals.length >= 3) {
    const userFrustEvents = signals.filter(s => s.role === "user").length;
    const aiFrustEvents = signals.filter(s => s.role === "ai").length;
    const sessionsAffected = new Set(signals.map(s => s.sessionIdx)).size;

    // ── Cluster into incidents — consecutive signals within the same
    // session and within 10 minutes count as one back-and-forth.
    const INCIDENT_GAP_MS = 10 * 60_000;
    const sortedSignals = [...signals].sort((a, b) => a.sessionIdx - b.sessionIdx || a.ts - b.ts);
    const incidents: FrustSignal[][] = [];
    let current: FrustSignal[] = [];
    for (const sig of sortedSignals) {
      const last = current[current.length - 1];
      if (!last || last.sessionIdx !== sig.sessionIdx || sig.ts - last.ts > INCIDENT_GAP_MS) {
        if (current.length > 0) incidents.push(current);
        current = [sig];
      } else {
        current.push(sig);
      }
    }
    if (current.length > 0) incidents.push(current);

    // ── Conditional stats: at-signal vs overall AND vs context-matched ──
    // Comparing signal latency (57s) to overall median (7s) is misleading:
    // overall median includes lots of small-context responses that are
    // naturally fast. The honest comparison is "at this context size,
    // what's your typical latency?" — that's the conditional baseline.
    const sortNum = (a: number[]) => [...a].sort((x, y) => x - y);
    const med = (a: number[]) => a.length === 0 ? 0 : sortNum(a)[Math.floor(a.length / 2)];
    const q = (a: number[], p: number) =>
      a.length === 0 ? 0 : sortNum(a)[Math.min(a.length - 1, Math.floor(a.length * p))];
    const sigCtxs = signals.map(s => s.contextAtMoment).filter(c => c > 0);
    const sigLats = signals.map(s => s.latencyBefore).filter(l => l >= 500 && l <= 30 * 60_000);
    const ctxAtSignal = med(sigCtxs);
    const ctxAtSignalP25 = q(sigCtxs, 0.25);
    const ctxAtSignalP75 = q(sigCtxs, 0.75);
    const baselineCtx = baselinePairs.map(p => p.ctx);
    const baselineLat = baselinePairs.map(p => p.lat);
    const ctxBaseline = med(baselineCtx);
    const latAtSignal = med(sigLats);
    const latAtSignalP25 = q(sigLats, 0.25);
    const latAtSignalP75 = q(sigLats, 0.75);
    const latBaseline = med(baselineLat);
    const ctxRatio = ctxBaseline > 0 ? ctxAtSignal / ctxBaseline : 1;
    const latRatio = latBaseline > 0 ? latAtSignal / latBaseline : 1;

    // Percentile of the signal-context within the user's overall context
    // distribution — gives a clearer "this is at your top 16% / top 5%
    // context level" framing than ratio-to-median.
    let ctxPercentile = 50;
    if (baselineCtx.length > 0 && ctxAtSignal > 0) {
      const sortedCtx = sortNum(baselineCtx);
      let lo = 0, hi = sortedCtx.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedCtx[mid] < ctxAtSignal) lo = mid + 1; else hi = mid;
      }
      ctxPercentile = (lo / sortedCtx.length) * 100;
    }

    // Conditional latency baseline: "at this context size, what's your
    // typical latency?" Bin baseline pairs in log-context space and look
    // up the bin that contains ctxAtSignal. If we have enough samples,
    // use bin median; otherwise fall back to overall.
    function condBaselineLat(targetCtx: number): number {
      if (baselinePairs.length === 0 || targetCtx <= 0) return latBaseline;
      // Take baseline pairs within ±0.25 log10 units of the target
      // (roughly ±77% of target) — a meaningful "neighborhood."
      const logT = Math.log10(targetCtx);
      const close = baselinePairs.filter(p => {
        const lp = Math.log10(p.ctx);
        return Math.abs(lp - logT) <= 0.25;
      });
      if (close.length < 5) return latBaseline; // fallback if neighborhood too sparse
      return med(close.map(p => p.lat));
    }
    const condLatBaseline = condBaselineLat(ctxAtSignal);
    const condLatRatio = condLatBaseline > 0 ? latAtSignal / condLatBaseline : 1;

    // ── Build the data-grounded "why" sentence ──
    // Each clause spells out exactly which stat it's quoting and uses
    // the conditional baseline so the comparison is fair (latency at the
    // SAME context size, not the overall median).
    const whyParts: string[] = [];
    if (ctxAtSignal > 0 && (ctxPercentile >= 75 || ctxRatio >= 1.3)) {
      whyParts.push(
        `<strong>median context at signal moments</strong> was <strong>${fmtTok(ctxAtSignal)}</strong> ` +
        `(middle 50% range ${fmtTok(ctxAtSignalP25)}–${fmtTok(ctxAtSignalP75)}) — ` +
        `that's your <strong>p${ctxPercentile.toFixed(0)}</strong> for context size, so signals are concentrated in your bigger sessions`
      );
    } else if (ctxAtSignal > 0 && ctxRatio <= 0.7) {
      whyParts.push(`<strong>median context at signal moments</strong> (${fmtTok(ctxAtSignal)}) was actually <em>smaller</em> than your overall median (${fmtTok(ctxBaseline)}) — context bloat isn't the cause for you`);
    }
    if (latAtSignal > 0 && condLatRatio >= 1.3) {
      whyParts.push(
        `<strong>median AI response time just before</strong> was <strong>${formatLatency(latAtSignal)}</strong> ` +
        `(middle 50% range ${formatLatency(latAtSignalP25)}–${formatLatency(latAtSignalP75)}) — ` +
        `at this context size your typical latency is <strong>${formatLatency(condLatBaseline)}</strong>, so signals are <strong>${condLatRatio.toFixed(1)}× slower than expected for the context</strong>` +
        (latRatio >= 2 ? ` (and ${latRatio.toFixed(1)}× slower than your overall median ${formatLatency(latBaseline)})` : "")
      );
    } else if (latAtSignal > 0 && latRatio >= 1.3 && condLatRatio < 1.3) {
      // Slow vs overall, but in line with what big context normally costs —
      // this is the "context tax, not bug" pattern.
      whyParts.push(
        `<strong>median AI response time just before</strong> was <strong>${formatLatency(latAtSignal)}</strong> ` +
        `vs your overall median ${formatLatency(latBaseline)} — but at this context size your typical latency is already <strong>${formatLatency(condLatBaseline)}</strong>, so the slow responses are mostly the context tax, not unusual stalls`
      );
    }
    const subagentSignals = signals.filter(s => s.hasSubagentInSession).length;
    const subagentSignalRate = signals.length > 0 ? subagentSignals / signals.length : 0;
    const sessionsWithSub = trajectories.filter(t => t.events.some(e => e.agent)).length;
    const baselineSubRate = trajectories.length > 0 ? sessionsWithSub / trajectories.length : 0;
    if (baselineSubRate > 0 && Math.abs(subagentSignalRate - baselineSubRate) >= 0.2) {
      if (subagentSignalRate < baselineSubRate) {
        whyParts.push(`only <strong>${(subagentSignalRate * 100).toFixed(0)}%</strong> of frustration happens in sessions that used subagents (vs ${(baselineSubRate * 100).toFixed(0)}% of sessions overall — so subagents may be helping)`);
      } else {
        whyParts.push(`<strong>${(subagentSignalRate * 100).toFixed(0)}%</strong> of frustration happens in sessions with subagents (vs ${(baselineSubRate * 100).toFixed(0)}% baseline — they may not be helping in your case)`);
      }
    }

    // Multi-paragraph layout — the old "; and ; and ;" wall was too dense.
    // Each finding becomes its own bullet so the eye can chunk it.
    const whyHtml = whyParts.length > 0
      ? `<div class="dv2-takeaway-section-label">When it happens:</div>` +
        `<ul class="dv2-takeaway-findings">` +
        whyParts.map(p => `<li>${p}</li>`).join("") +
        `</ul>`
      : `<div class="dv2-takeaway-note">Conditions at frustration moments don't strongly differ from your typical session — the trigger is likely message-level (intent mismatch, stale assumption) rather than environmental.</div>`;

    // ── Top incidents as items ──
    const topIncidents = [...incidents]
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);
    const items = topIncidents.map(inc => {
      const t = trajectories[inc[0].sessionIdx];
      const label = getSessionLabel(t).slice(0, 60);
      const time = new Date(inc[0].ts).toLocaleString();
      const ctxAt = inc[0].contextAtMoment;
      const ctxStr = ctxAt > 0 ? ` · ${fmtTok(ctxAt)} ctx` : "";
      return {
        label: `${label} — ${time}`,
        meta: `${inc.length} signal${inc.length === 1 ? "" : "s"}${ctxStr}`,
      };
    });

    takeaways.push({
      priority: 73,
      fact:
        `<div class="dv2-takeaway-headline">` +
        `Detected <strong>${userFrustEvents} frustrated user message${userFrustEvents === 1 ? "" : "s"}</strong>` +
        ` and <strong>${aiFrustEvents} apologetic/panicked AI response${aiFrustEvents === 1 ? "" : "s"}</strong>, ` +
        `clustered into <strong>${incidents.length} incident${incidents.length === 1 ? "" : "s"}</strong> ` +
        `across <strong>${sessionsAffected} session${sessionsAffected === 1 ? "" : "s"}</strong>.` +
        `</div>` +
        whyHtml,
      action: condLatRatio >= 1.5
        ? "At the same context size, the AI is responding way slower than usual when frustration spikes — suggests these particular turns were doing genuinely hard work (deep tool chains, big edits, multi-file scans). Tighter prompts, one explicit goal per turn, and earlier checkpoints help more than just compaction."
        : ctxPercentile >= 80
        ? "Frustration concentrates at your bigger context sizes. Splitting work earlier or using subagents for the bulky exploration phases will cut both context and frustration."
        : latRatio >= 1.3
        ? "The slow-response pattern at frustration moments matches what you'd expect for the context size — so it's the context tax, not unusual stalls. Compact or split before context grows."
        : "When this pattern shows up, the AI usually misread your intent. State the constraint explicitly up front, paste the exact error message verbatim, or start a fresh session if the apology loop goes past 2-3 turns.",
      itemsTitle: items.length > 0 ? "Worst incidents (clustered signals within 10 min)" : undefined,
      items: items.length > 0 ? items : undefined,
      trend: trendFor("frustration signals/session", v => v.toFixed(1), frustOf, 0.20),
      byModel: byModelFor(v => v.toFixed(1) + "/session", frustOf),
    });
  }

  // ── 4c. AI effectiveness — confidence vs hedging vs failure ─────────
  // Pure pattern detection on AI message text. We can't read intent or
  // verify correctness, but we CAN measure how the AI talks about its
  // own work: confident completion ("done", "tests pass") vs hedging
  // ("I think", "should work") vs admission ("unable to", "couldn't").
  // The ratio is a useful tone signal — sessions running heavy on
  // hedging or admissions are usually the ones where the AI was
  // struggling, even if the user never typed a frustration word.
  const COMPLETION_PATTERNS = [
    /\b(all (tests|checks) (pass|passing|passed))\b/i,
    /\b(successfully|done|complete[d]?|finished)\b/i,
    /\b(fixed|resolved) (the|this|that)\b/i,
    /\b(working|works) (correctly|as expected|now)\b/i,
    /\bready (to (commit|merge|ship|deploy)|for review)\b/i,
    /\b(everything (looks|is) good|all set)\b/i,
    /\bverified\b/i,
    /\b(confirmed|confirms?) (that|the)\b/i,
  ];
  const HEDGE_PATTERNS = [
    /\bi (think|believe|suspect|guess)\b/i,
    /\b(perhaps|maybe|might|could be|possibly)\b/i,
    /\b(it )?should (work|be|do)\b/i,
    /\b(let me know|please verify|please test)\b/i,
    /\b(if (you|that) )?(want[s]? me|prefer|like)\b/i,
    /\bnot (entirely|completely|fully) sure\b/i,
  ];
  const FAILURE_PATTERNS = [
    /\b(unable to|couldn'?t|can'?t) (figure|complete|fix|resolve|find|reproduce)\b/i,
    /\bfailed to (figure|complete|implement|fix|find)\b/i,
    /\b(this is|that'?s) (harder|trickier|more complex) than\b/i,
    /\b(i (don'?t|do not) know|no idea) (how|what|why)\b/i,
    /\b(i give up|giving up)\b/i,
  ];

  const completionPerSession = (t: Trajectory): number => {
    let n = 0;
    for (const e of t.events) {
      if (e.role !== "assistant" || e.type !== "message" || typeof e.content !== "string") continue;
      if (COMPLETION_PATTERNS.some(rx => rx.test(e.content!))) n++;
    }
    return n;
  };
  const hedgePerSession = (t: Trajectory): number => {
    let n = 0;
    for (const e of t.events) {
      if (e.role !== "assistant" || e.type !== "message" || typeof e.content !== "string") continue;
      if (HEDGE_PATTERNS.some(rx => rx.test(e.content!))) n++;
    }
    return n;
  };
  const failurePerSession = (t: Trajectory): number => {
    let n = 0;
    for (const e of t.events) {
      if (e.role !== "assistant" || e.type !== "message" || typeof e.content !== "string") continue;
      if (FAILURE_PATTERNS.some(rx => rx.test(e.content!))) n++;
    }
    return n;
  };

  let totalCompletion = 0, totalHedge = 0, totalFailure = 0, totalAiMsgs = 0;
  for (const t of trajectories) {
    for (const e of t.events) {
      if (e.role !== "assistant" || e.type !== "message" || typeof e.content !== "string") continue;
      totalAiMsgs++;
      if (COMPLETION_PATTERNS.some(rx => rx.test(e.content!))) totalCompletion++;
      if (HEDGE_PATTERNS.some(rx => rx.test(e.content!))) totalHedge++;
      if (FAILURE_PATTERNS.some(rx => rx.test(e.content!))) totalFailure++;
    }
  }
  if (totalAiMsgs >= 50 && (totalCompletion + totalHedge + totalFailure) >= 10) {
    const completionRate = (totalCompletion / totalAiMsgs) * 100;
    const hedgeRate = (totalHedge / totalAiMsgs) * 100;
    const failureRate = (totalFailure / totalAiMsgs) * 100;
    const completionToHedge = totalHedge > 0 ? totalCompletion / totalHedge : Infinity;

    // Headline frames the dominant signal
    let headline = "";
    if (totalFailure > totalCompletion) {
      headline = `Across <strong>${totalAiMsgs.toLocaleString()} AI messages</strong>, the AI admitted being stuck (\"unable to\", \"couldn't\", \"this is harder than\") <strong>${totalFailure} times</strong> — more often than it claimed completion (<strong>${totalCompletion}</strong>).`;
    } else if (totalHedge > totalCompletion * 2) {
      headline = `The AI hedges (\"I think\", \"should work\", \"let me know\") in <strong>${hedgeRate.toFixed(1)}%</strong> of messages — more than 2× the rate it confidently claimed completion (<strong>${completionRate.toFixed(1)}%</strong>).`;
    } else {
      headline = `Across <strong>${totalAiMsgs.toLocaleString()} AI messages</strong>: <strong>${totalCompletion}</strong> claim completion (\"done\", \"tests pass\"), <strong>${totalHedge}</strong> hedge (\"I think\", \"should work\"), <strong>${totalFailure}</strong> admit being stuck.`;
    }

    const findings: string[] = [
      `<strong>Confident completion</strong>: ${totalCompletion} message${totalCompletion === 1 ? "" : "s"} (<strong>${completionRate.toFixed(1)}%</strong>) — phrases like "successfully", "done", "tests pass", "verified".`,
      `<strong>Hedged language</strong>: ${totalHedge} message${totalHedge === 1 ? "" : "s"} (<strong>${hedgeRate.toFixed(1)}%</strong>) — phrases like "I think", "should work", "perhaps", "let me know if".`,
      `<strong>Stuck / admission</strong>: ${totalFailure} message${totalFailure === 1 ? "" : "s"} (<strong>${failureRate.toFixed(1)}%</strong>) — phrases like "unable to", "couldn't", "this is harder than", "I don't know".`,
    ];

    let action: string;
    if (totalFailure > totalCompletion) {
      action = "Admissions outpacing completions is a strong signal the AI is in over its head on these tasks. Try smaller scoped prompts, paste the actual error verbatim, or split the work into clearer subgoals.";
    } else if (completionToHedge < 0.4) {
      action = "Heavy hedging without matching completions usually means the AI isn't sure its work is right. Run the AI's output through tests or a checklist before continuing — \"verify the change works before claiming success\" in the system prompt also helps.";
    } else if (completionRate >= 5) {
      action = "Confident-completion language outpacing hedging is a healthy signal — the AI is finishing work, not punting. Keep doing what you're doing.";
    } else {
      action = "Tone signals are mixed. Worth comparing the per-model breakdown below — sometimes one model is more eager to claim done than another, even on similar tasks.";
    }

    takeaways.push({
      priority: 67,
      fact:
        `<div class="dv2-takeaway-headline">${headline}</div>` +
        `<div class="dv2-takeaway-section-label">Tone breakdown:</div>` +
        `<ul class="dv2-takeaway-findings">` +
        findings.map(f => `<li>${f}</li>`).join("") +
        `</ul>`,
      action,
      trend: trendFor("completion phrases/session", v => v.toFixed(1), completionPerSession, 0.20),
      byModel: byModelFor(v => v.toFixed(1) + "/session", completionPerSession),
    });
  }

  // ── 5. Compaction frequency ──────────────────────────────────────────
  const compactionsPerSession = trajectories.map(compactionsOf);
  const totalCompactions = compactionsPerSession.reduce((s, v) => s + v, 0);
  const sessionsWithCompact = compactionsPerSession.filter(c => c > 0).length;
  if (totalSessions >= 5 && sessionsWithCompact >= 2) {
    const pctSessions = (sessionsWithCompact / totalSessions) * 100;
    takeaways.push({
      priority: 70,
      fact: `<strong>${pctSessions.toFixed(0)}% of your sessions</strong> hit the context limit (${sessionsWithCompact}/${totalSessions} sessions, <strong>${totalCompactions} compactions</strong> total).`,
      action: pctSessions >= 30
        ? "Compaction blanks part of the conversation. Plan smaller-scoped sessions or compact proactively before it triggers automatically."
        : "When you do hit it, compaction works — but a slightly tighter scope per session would avoid the trim entirely.",
      trend: trendFor("compactions/session", v => v.toFixed(1), compactionsOf, 0.20),
      byModel: byModelFor(v => v.toFixed(1) + "/session", compactionsOf),
    });
  }

  // ── 6. Repeated read-without-edit overhead ───────────────────────────
  // (Removed "longest AI turn" — wall-clock gap conflates overnight agent
  // work with neglect. Long unsupervised stretches can be intentional.)

  const readCounts = new Map<string, number>();
  const editedFiles = new Set<string>();
  for (const ev of allEvents) {
    if (ev.type !== "tool_call" || !ev.toolCall) continue;
    const name = ev.toolCall.name.toLowerCase();
    const args = ev.toolCall.arguments;
    const path = typeof args === "object" && args !== null
      ? ((args as Record<string, unknown>).file_path ?? (args as Record<string, unknown>).path ?? "") as string
      : "";
    const short = path ? (path.split("/").pop() ?? path.split("\\").pop() ?? path) : "";
    if (short && (name === "read" || name === "readfile" || name === "readfilerange" || name === "cat")) {
      readCounts.set(short, (readCounts.get(short) ?? 0) + 1);
    }
    if (short && (name === "edit" || name === "editfile" || name === "editlines" || name === "write" || name === "writefile")) {
      editedFiles.add(short);
    }
  }
  const heavyReads = [...readCounts.entries()].filter(([f, c]) => c >= 5 && !editedFiles.has(f)).sort((a, b) => b[1] - a[1]);
  if (heavyReads.length > 0) {
    const [topFile, topCount] = heavyReads[0];
    const totalRereads = heavyReads.reduce((s, [, c]) => s + c, 0);
    const fileWord = heavyReads.length === 1 ? "file was" : "files were";
    const items = heavyReads.slice(0, 10).map(([f, c]) => ({
      label: f,
      meta: `${c} read${c === 1 ? "" : "s"}`,
    }));
    takeaways.push({
      priority: 62,
      fact: heavyReads.length === 1
        ? `<strong>${esc(topFile)}</strong> was read <strong>${topCount} times</strong> across these sessions, never edited — pure exploration cost.`
        : `<strong>${heavyReads.length} ${fileWord}</strong> read repeatedly without being edited — <strong>${totalRereads} reads</strong> total of the top ${heavyReads.length} (worst offender: <strong>${esc(topFile)}</strong>, ${topCount} reads).`,
      action: "Each repeated read pays the file's full token cost again. Cheapest fix: write a 1–2 paragraph digest per file (or a single PROJECT.md pointing at summaries) and reference that in your system prompt instead. The AI hits the digest, only re-reads the source when it needs detail.",
      itemsTitle: "Top files to digest",
      items,
      trend: trendFor("unedited rereads/session", v => v.toFixed(0), heavyReadsOf, 0.20),
      byModel: byModelFor(v => v.toFixed(0) + "/session", heavyReadsOf),
    });
  }

  // (placeholder — section 7 was the "longest AI turn" takeaway, removed
  //  because it's misleading when overnight agent work is intentional.)

  // ── 8. Model comparison ──────────────────────────────────────────────
  // When the user has run sessions on multiple primary models, compare
  // success metrics — retry rate + compaction count — and surface a
  // takeaway only when the gap is meaningful and the sample isn't tiny.
  // We classify each session by its "primary model" = the model that
  // produced the most output tokens in that session (sessions often
  // mix Opus + Haiku via subagents, but the primary handler is what
  // matters for the comparison).
  if (totalSessions >= 4) {
    // Reuse the version-preserving normalizer defined above so opus-4-6
    // and opus-4-7 stay distinct in this comparison too.
    interface ModelStat {
      sessions: number;
      retries: number;
      toolCalls: number;
      compactions: number;
      output: number;
    }
    const byModel = new Map<string, ModelStat>();
    for (const t of trajectories) {
      const modelTokens = new Map<string, number>();
      for (const ev of t.events) {
        if (ev.model && ev.tokens?.output) {
          modelTokens.set(ev.model, (modelTokens.get(ev.model) ?? 0) + ev.tokens.output);
        }
      }
      if (modelTokens.size === 0) continue;
      const primary = [...modelTokens.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const norm = normalizeModel(primary);
      const sm = t.summary ?? computeSummary(t.events);
      const compactions = t.events.filter(e => e.contextCompacted).length;
      const stat = byModel.get(norm) ?? { sessions: 0, retries: 0, toolCalls: 0, compactions: 0, output: 0 };
      stat.sessions += 1;
      stat.retries += sm.errorCount;
      stat.toolCalls += sm.totalToolCalls;
      stat.compactions += compactions;
      stat.output += sm.totalTokens.output;
      byModel.set(norm, stat);
    }
    // Need at least 2 models, each with 3+ sessions
    const eligible = [...byModel.entries()].filter(([, s]) => s.sessions >= 3);
    if (eligible.length >= 2) {
      const withRates = eligible.map(([name, s]) => ({
        name, sessions: s.sessions,
        retryRate: s.toolCalls > 0 ? s.retries / s.toolCalls : 0,
        compactsPerSession: s.compactions / s.sessions,
        output: s.output,
      }));
      // Sort best (lowest retry rate) first for the surfaced fact + items list
      withRates.sort((a, b) => a.retryRate - b.retryRate);
      const best = withRates[0];
      const worst = withRates[withRates.length - 1];
      const retryRatio = best.retryRate > 0 ? worst.retryRate / best.retryRate : Infinity;
      const retryDiff = (worst.retryRate - best.retryRate) * 100; // percentage points
      const hasMeaningfulRetryGap = retryRatio >= 1.5 && retryDiff >= 2 && worst.retryRate >= 0.03;

      // Sort by compactions for the secondary signal
      const byCompacts = [...withRates].sort((a, b) => a.compactsPerSession - b.compactsPerSession);
      const cBest = byCompacts[0];
      const cWorst = byCompacts[byCompacts.length - 1];
      const compactDelta = cWorst.compactsPerSession - cBest.compactsPerSession;
      const hasMeaningfulCompactGap = compactDelta >= 0.5 && cWorst.compactsPerSession >= 1;

      // Build the per-model items list — same data, side by side, in the
      // order [best retry rate first]. User asked to see all models so
      // they can judge whether their model choice is making a difference.
      const items = withRates.map(r => ({
        label: r.name,
        meta: `${r.sessions} session${r.sessions === 1 ? "" : "s"} · ${(r.retryRate * 100).toFixed(1)}% retry · ${r.compactsPerSession.toFixed(1)} compacts/session`,
      }));

      if (hasMeaningfulRetryGap) {
        takeaways.push({
          priority: 78,
          fact: `Across <strong>${eligible.length} primary models</strong>, retry rates spread <strong>${retryRatio.toFixed(1)}×</strong> — <strong>${best.name}</strong> at <strong>${(best.retryRate * 100).toFixed(1)}%</strong> vs <strong>${worst.name}</strong> at <strong>${(worst.retryRate * 100).toFixed(1)}%</strong>.`,
          action: `If your tasks were similar across both, <strong>${best.name}</strong> is doing more useful work per call. Try defaulting to it for that kind of work. The full per-model breakdown is below — match models to task type.`,
          itemsTitle: "Per-model breakdown (sorted by retry rate)",
          items,
        });
      } else if (hasMeaningfulCompactGap) {
        takeaways.push({
          priority: 76,
          fact: `Across <strong>${eligible.length} primary models</strong>, compaction rates differ — <strong>${cBest.name}</strong> averages <strong>${cBest.compactsPerSession.toFixed(1)}/session</strong>, <strong>${cWorst.name}</strong> averages <strong>${cWorst.compactsPerSession.toFixed(1)}</strong>.`,
          action: `${cBest.name} handled long-running work without filling the context window as often. Worth trying it as the primary for big sessions.`,
          itemsTitle: "Per-model breakdown (sorted by retry rate)",
          items,
        });
      } else {
        // Even when no metric crosses thresholds, show the breakdown so
        // the user can see "no obvious difference" at a glance — that's
        // also useful info ("am I paying for Opus when Sonnet would do?").
        takeaways.push({
          priority: 50,
          fact: `You used <strong>${eligible.length} primary models</strong>, and the metrics are within a normal spread — no clear winner emerges from your data alone.`,
          action: `Without a measurable retry/compaction gap, model choice is probably driven by task fit and budget. The full per-model breakdown is below for reference.`,
          itemsTitle: "Per-model breakdown (sorted by retry rate)",
          items,
        });
      }
    }
  }

  // ── 9. Time trend (only for multi-session views with 6+ sessions) ──
  // Compare first half of selected sessions against second half on
  // multiple axes — msgs/session, compaction rate, subagent usage, retry
  // rate. Surface up to three notable movers as separate takeaways so the
  // user can see the directional changes in their workflow.
  if (trajectories.length >= 6) {
    const sorted = [...trajectories].sort(
      (a, b) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime()
    );
    const half = Math.floor(sorted.length / 2);
    const earlier = sorted.slice(0, half);
    const later = sorted.slice(half);
    const earlyStart = new Date(earlier[0].session.startTime).getTime();
    const lateStart = new Date(later[0].session.startTime).getTime();
    const spanDays = (lateStart - earlyStart) / (24 * 60 * 60_000);
    if (spanDays >= 3) {
      const periodLabel = spanDays >= 30 ? "month over month"
        : spanDays >= 14 ? "across the last few weeks"
        : "across the recent stretch";

      // Helpers to compute each metric per half
      const totalsFor = (group: Trajectory[]) => {
        const events = group.flatMap(t => t.events);
        const msgs = events.filter(isHumanUserMessage).length;
        const compactions = events.filter(e => e.contextCompacted).length;
        const subagentEvents = events.filter(e => e.agent);
        const subagentLabels = new Set<string>();
        for (const e of subagentEvents) if (e.agent) subagentLabels.add(e.agent);
        let toolCalls = 0, retries = 0;
        for (const e of events) {
          if (e.type === "tool_call") toolCalls++;
          if (e.type === "tool_result" && e.toolResult?.isError) retries++;
        }
        return {
          n: group.length,
          msgsAvg: group.length > 0 ? msgs / group.length : 0,
          compactRate: group.length > 0 ? compactions / group.length : 0,
          subagentsAvg: group.length > 0 ? subagentLabels.size / group.length : 0,
          retryRate: toolCalls > 0 ? retries / toolCalls : 0,
        };
      };
      const e0 = totalsFor(earlier);
      const e1 = totalsFor(later);

      const trends: { delta: number; takeaway: Takeaway }[] = [];

      // Msgs/session
      const msgsRatio = e0.msgsAvg > 0 ? e1.msgsAvg / e0.msgsAvg : 1;
      if (Math.abs(msgsRatio - 1) >= 0.25 && e0.msgsAvg >= 5) {
        const dir = msgsRatio > 1 ? "longer" : "tighter";
        trends.push({
          delta: Math.abs(msgsRatio - 1),
          takeaway: {
            priority: 58,
            fact: `Your sessions are getting <strong>${dir}</strong> ${periodLabel} — average prompts/session moved from <strong>${e0.msgsAvg.toFixed(0)}</strong> to <strong>${e1.msgsAvg.toFixed(0)}</strong> (${(msgsRatio * 100 - 100).toFixed(0)}%).`,
            action: msgsRatio > 1
              ? "Longer sessions = more context tax. If output quality hasn't improved, you may be over-elaborating — try wrapping up sooner."
              : "Tighter sessions usually mean better focus. Keep it.",
          },
        });
      }

      // Compaction rate
      const compactDelta = e1.compactRate - e0.compactRate;
      if (Math.abs(compactDelta) >= 0.5 && Math.max(e0.compactRate, e1.compactRate) >= 0.5) {
        const dir = compactDelta > 0 ? "more" : "less";
        trends.push({
          delta: Math.abs(compactDelta),
          takeaway: {
            priority: 56,
            fact: `You're hitting compaction <strong>${dir}</strong> ${periodLabel} — <strong>${e0.compactRate.toFixed(1)}</strong> per session earlier vs <strong>${e1.compactRate.toFixed(1)}</strong> recently.`,
            action: compactDelta > 0
              ? "Sessions are growing past the context window more often. Worth scoping prompts narrower or compacting earlier."
              : "Whatever you changed (smaller scope, more subagents, /clear earlier) is working — keep it.",
          },
        });
      }

      // Subagent usage trend — answers "am I getting better at using subagents?"
      const subaDelta = e1.subagentsAvg - e0.subagentsAvg;
      if (Math.max(e0.subagentsAvg, e1.subagentsAvg) >= 0.5 && Math.abs(subaDelta) >= 0.5) {
        const dir = subaDelta > 0 ? "more" : "less";
        trends.push({
          delta: Math.abs(subaDelta) / Math.max(e0.subagentsAvg, 0.1),
          takeaway: {
            priority: 60,
            fact: `You're using <strong>${dir} subagents</strong> ${periodLabel} — averaging <strong>${e1.subagentsAvg.toFixed(1)}/session</strong> recently vs <strong>${e0.subagentsAvg.toFixed(1)}/session</strong> earlier.`,
            action: subaDelta > 0
              ? "You've been leaning on subagents harder. If your compaction rate also dropped, that's the leverage paying off."
              : "Subagent usage is down. If you're seeing more compactions or context slowdown, swing back to them — they're a cheap context tax-shelter.",
          },
        });
      }

      // Retry rate trend
      const retryDelta = e1.retryRate - e0.retryRate;
      if (Math.abs(retryDelta) >= 0.02 && Math.max(e0.retryRate, e1.retryRate) >= 0.05) {
        const dir = retryDelta > 0 ? "higher" : "lower";
        trends.push({
          delta: Math.abs(retryDelta) * 5, // scale so it competes with other deltas
          takeaway: {
            priority: 54,
            fact: `Your tool retry rate is <strong>${dir}</strong> ${periodLabel} — <strong>${(e0.retryRate * 100).toFixed(1)}%</strong> earlier vs <strong>${(e1.retryRate * 100).toFixed(1)}%</strong> recently.`,
            action: retryDelta > 0
              ? "More retries = more wasted tokens. Check if a particular tool started failing recently (look at Errors view)."
              : "Fewer retries — your prompts or the AI's tool grounding got better. Keep it.",
          },
        });
      }

      // Surface up to 2 biggest movers (so trends don't drown out the
      // higher-priority data takeaways above)
      trends.sort((a, b) => b.delta - a.delta);
      for (const t of trends.slice(0, 2)) takeaways.push(t.takeaway);
    }
  }

  // ── Render ──
  if (takeaways.length === 0) return null;
  takeaways.sort((a, b) => b.priority - a.priority);
  const limit = opts?.limit ?? 5;
  const top = takeaways.slice(0, limit);

  const card = document.createElement("div");
  card.className = "dv2-takeaways" + (opts?.fullPage ? " dv2-takeaways-fullpage" : "");
  const heading = document.createElement("div");
  heading.className = "dv2-takeaways-head";
  const subText = limit < takeaways.length
    ? `${top.length} of ${takeaways.length} findings · all backed by your data`
    : `${takeaways.length} finding${takeaways.length === 1 ? "" : "s"} · all backed by your data`;
  heading.innerHTML = `<span class="dv2-takeaways-title">Takeaways</span><span class="dv2-takeaways-sub">${subText}</span>`;
  card.appendChild(heading);

  function appendTakeaway(parent: HTMLElement, t: Takeaway) {
    const li = document.createElement("li");
    li.className = "dv2-takeaway";
    const factEl = document.createElement("div");
    factEl.className = "dv2-takeaway-fact";
    factEl.innerHTML = t.fact;
    li.appendChild(factEl);
    if (t.action) {
      const actionEl = document.createElement("div");
      actionEl.className = "dv2-takeaway-action";
      actionEl.innerHTML = `<span class="dv2-takeaway-arrow">→</span> ${t.action}`;
      li.appendChild(actionEl);
    }
    if (t.trend) {
      const trendEl = document.createElement("div");
      trendEl.className = "dv2-takeaway-strip dv2-takeaway-strip-trend";
      trendEl.innerHTML = `<span class="dv2-takeaway-strip-label">TREND</span> ${t.trend}`;
      li.appendChild(trendEl);
    }
    if (t.byModel) {
      const modelEl = document.createElement("div");
      modelEl.className = "dv2-takeaway-strip dv2-takeaway-strip-model";
      modelEl.innerHTML = `<span class="dv2-takeaway-strip-label">BY MODEL</span> ${t.byModel}`;
      li.appendChild(modelEl);
    }
    if (t.items && t.items.length > 0) {
      const itemsWrap = document.createElement("div");
      itemsWrap.className = "dv2-takeaway-items";
      if (t.itemsTitle) {
        const title = document.createElement("div");
        title.className = "dv2-takeaway-items-title";
        title.textContent = t.itemsTitle;
        itemsWrap.appendChild(title);
      }
      const itemsList = document.createElement("ul");
      itemsList.className = "dv2-takeaway-items-list";
      for (const item of t.items) {
        const itemLi = document.createElement("li");
        const labelSpan = document.createElement("span");
        labelSpan.className = "dv2-takeaway-item-label";
        labelSpan.textContent = item.label;
        labelSpan.title = item.label;
        itemLi.appendChild(labelSpan);
        if (item.meta) {
          const metaSpan = document.createElement("span");
          metaSpan.className = "dv2-takeaway-item-meta";
          metaSpan.textContent = item.meta;
          itemLi.appendChild(metaSpan);
        }
        itemsList.appendChild(itemLi);
      }
      itemsWrap.appendChild(itemsList);
      li.appendChild(itemsWrap);
    }
    parent.appendChild(li);
  }

  const list = document.createElement("ol");
  list.className = "dv2-takeaways-list";
  for (const t of top) appendTakeaway(list, t);
  card.appendChild(list);

  // Only render the "+ N more" expandable when we actually capped. Pass
  // limit: Infinity (or any number ≥ takeaways.length) to suppress it
  // entirely — the Insights view does this so the page shows everything.
  if (takeaways.length > limit) {
    const more = document.createElement("details");
    more.className = "dv2-takeaways-more";
    const sum = document.createElement("summary");
    sum.textContent = `+ ${takeaways.length - limit} more`;
    more.appendChild(sum);
    const moreList = document.createElement("ol");
    moreList.className = "dv2-takeaways-list";
    moreList.start = limit + 1;
    for (const t of takeaways.slice(limit)) appendTakeaway(moreList, t);
    more.appendChild(moreList);
    card.appendChild(more);
  }

  return card;
}

// ── Auto-Insights ────────────────────────────────────────────────────

export function buildInsights(events: TrajectoryEvent[], summary: ReturnType<typeof computeSummary>): HTMLElement | null {
  const findings: string[] = [];

  // 0. User autonomy + reply / AI-turn latency tornado.
  // Real prompts only — filters IDE/hook/system noise that's also tagged
  // role:"user" in the wire format, otherwise autonomy % is wildly off.
  const userMessages = events.filter(isHumanUserMessage);
  const aiTurnCount = events.filter(e => e.role === "assistant" && (e.type === "message" || e.type === "tool_call")).length;
  const { replyGaps, aiTurns, pairs: latencyPairs } = collectSessionLatencies(events);

  let renderTornado = false;
  if (userMessages.length > 0 && aiTurnCount > 0) {
    const autonomyPct = Math.round((1 - userMessages.length / (userMessages.length + aiTurnCount)) * 100);
    findings.push(`You sent <strong>${userMessages.length} messages</strong> — the AI was <strong>${autonomyPct}% autonomous</strong>`);
    if (replyGaps.length + aiTurns.length >= 3) renderTornado = true;
  }

  // ── Parallel KPIs (mirror the multi-session insight card so single and
  // multi look structurally similar — only the first hero line differs) ──

  // Tools per user message
  const toolCallsAll = events.filter(e => e.type === "tool_call");
  if (userMessages.length > 0 && toolCallsAll.length > 0) {
    const tpt = toolCallsAll.length / userMessages.length;
    findings.push(
      `<strong>${tpt.toFixed(1)}</strong> tools per user message ` +
      `<span title="Tool calls divided by user messages. Higher = AI does more per ask (more autonomous). Lower = lots of back-and-forth.">ⓘ</span>`
    );
  }

  // Distinct files touched
  const filesTouchedSet = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "tool_call" || !ev.toolCall?.arguments) continue;
    const args = ev.toolCall.arguments as Record<string, unknown>;
    const fp = (args.file_path ?? args.filePath ?? args.path ?? args.notebook_path) as unknown;
    if (typeof fp === "string" && fp.length > 0) filesTouchedSet.add(fp);
  }
  if (filesTouchedSet.size > 0) {
    findings.push(
      `<strong>${filesTouchedSet.size.toLocaleString()}</strong> distinct files touched (read, edited, or written)`
    );
  }

  // Longest single AI turn within this session
  let longestAi = 0;
  for (const v of aiTurns) if (v > longestAi) longestAi = v;
  if (longestAi >= 60_000) {
    findings.push(
      `Longest single AI turn: <strong>${fmtDur(longestAi)}</strong> ` +
      `<span title="Biggest stretch from one of your messages to the AI's last activity, before you spoke again.">ⓘ</span>`
    );
  }

  // 1. Repeated file reads — only flag if the file WASN'T being edited
  const readCounts = new Map<string, number>();
  const editedFiles = new Set<string>();
  for (const ev of events) {
    if (ev.type === "tool_call" && ev.toolCall) {
      const name = ev.toolCall.name.toLowerCase();
      const args = ev.toolCall.arguments;
      const path = typeof args === "object" && args !== null
        ? ((args as Record<string, unknown>).file_path ?? (args as Record<string, unknown>).path ?? "") as string
        : "";
      const short = path ? (path.split("/").pop() ?? path.split("\\").pop() ?? path) : "";

      if (short && (name === "read" || name === "readfile" || name === "readfilerange" || name === "cat")) {
        readCounts.set(short, (readCounts.get(short) ?? 0) + 1);
      }
      if (short && (name === "edit" || name === "editfile" || name === "editlines" || name === "write" || name === "writefile")) {
        editedFiles.add(short);
      }
    }
  }
  // Only flag files that were read repeatedly but NOT edited (pure exploration)
  const topRepeated = [...readCounts.entries()]
    .filter(([file, c]) => c >= 5 && !editedFiles.has(file))
    .sort((a, b) => b[1] - a[1]);
  if (topRepeated.length > 0) {
    const [file, count] = topRepeated[0];
    findings.push(`<strong>${file}</strong> was read <strong>${count} times</strong> without being edited — a project overview file could reduce this exploration`);
  }

  // 2. Token waste after last edit — tokens spent after the work was done
  const toolCalls = events.filter(e => e.type === "tool_call");
  const lastEditIdx = events.reduce((last, ev, i) => {
    if (ev.type === "tool_call" && ev.toolCall) {
      const n = ev.toolCall.name.toLowerCase();
      if (n === "edit" || n === "editfile" || n === "editlines" || n === "write" || n === "writefile") return i;
    }
    return last;
  }, -1);
  if (lastEditIdx > 0 && lastEditIdx < events.length - 3) {
    const afterEdit = events.slice(lastEditIdx + 1);
    const tokensAfter = afterEdit.reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
    const totalOutput = events.reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
    if (totalOutput > 0) {
      const pct = Math.round((tokensAfter / totalOutput) * 100);
      if (pct >= 20) {
        findings.push(`<strong>${pct}%</strong> of output tokens spent <strong>after the last edit</strong> — try adding explicit stop signals to your prompt`);
      }
    }
  }

  // 3. Tool retry ratio — always show when there are any retries; the
  // multi-session card does the same (no threshold gate). Wording stays
  // helpful when the rate is high.
  const errorResults = events.filter(e => e.type === "tool_result" && e.toolResult?.isError);
  if (toolCalls.length > 0 && errorResults.length > 0) {
    const pct = Math.round((errorResults.length / toolCalls.length) * 100);
    const tail = pct >= 15 ? " — check the Errors view for patterns" : "";
    findings.push(`<strong>${errorResults.length}</strong> retries across <strong>${toolCalls.length}</strong> tool calls (<strong>${pct}%</strong> retry rate)${tail}`);
  }

  // Total output tokens — parallel to the multi-session "Output tokens range" line
  const totalOutputTokens = events.reduce((s, e) => s + (e.tokens?.output ?? 0), 0);
  if (totalOutputTokens > 0) {
    findings.push(`Output tokens: <strong>${fmtTok(totalOutputTokens)}</strong>`);
  }

  // 4. Tool loops — same tool with same/similar args called repeatedly (actually stuck)
  let maxRepeat = 0;
  let repeatTool = "";
  let repeatCount = 0;
  let lastToolKey = "";
  for (const ev of events) {
    if (ev.type === "tool_call" && ev.toolCall) {
      // Create a key from tool name + first arg to detect true repeats vs exploration
      const name = ev.toolCall.name;
      const args = ev.toolCall.arguments;
      const firstArg = typeof args === "object" && args !== null
        ? String(Object.values(args)[0] ?? "").substring(0, 50)
        : "";
      const key = name + "::" + firstArg;
      if (key === lastToolKey) {
        repeatCount++;
        if (repeatCount > maxRepeat) { maxRepeat = repeatCount; repeatTool = name; }
      } else {
        lastToolKey = key;
        repeatCount = 1;
      }
    }
  }
  if (maxRepeat >= 4) {
    findings.push(`<strong>${repeatTool}</strong> called <strong>${maxRepeat}x with the same arguments</strong> — the agent was stuck in a retry loop`);
  }

  // 5. Context resets — compactions or milestones (the AI was drowning in context)
  // Always show when there's at least one (multi-session does the same).
  // Wording escalates when there are several to flag the pattern.
  const compactions = events.filter(e => e.contextCompacted === true).length;
  const compactionCount = summary.compactionCount ?? compactions;
  if (compactionCount > 0) {
    if (compactionCount >= 3) {
      findings.push(`Context was compressed <strong>${compactionCount} times</strong> — the conversation got too long and had to be trimmed`);
    } else {
      findings.push(`<strong>${compactionCount}</strong> compaction${compactionCount === 1 ? "" : "s"} <span title="Times the conversation was compressed because it got too long for the model's context window.">ⓘ</span>`);
    }
  }

  if (findings.length === 0 && !renderTornado) return null;

  const card = document.createElement("div");
  card.className = "dv2-insights";

  if (findings.length > 0) {
    // First finding as a large callout — the shareable number
    const hero = document.createElement("div");
    hero.className = "dv2-insight-hero";
    hero.innerHTML = findings[0];
    card.appendChild(hero);

    // Remaining findings as a compact list. Cap removed — the parallel
    // KPIs added to match the multi-session card pushed the list past 4
    // bullets, and silently dropping them was confusing.
    if (findings.length > 1) {
      const ul = document.createElement("ul");
      for (const f of findings.slice(1)) {
        const li = document.createElement("li");
        li.innerHTML = f;
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
  }

  if (renderTornado) {
    card.appendChild(buildLatencyTornado(replyGaps, aiTurns, latencyPairs));
  }

  return card;
}

// ── Tool Usage Section ──────────────────────────────────────────────

interface ToolPerf {
  name: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  durations: number[];
}

function buildToolPerf(trajectories: Trajectory[]): ToolPerf[] {
  const map = new Map<string, { durations: number[]; errors: number; count: number }>();

  for (const traj of trajectories) {
    const resultMap = new Map<number, TrajectoryEvent>();
    for (const ev of traj.events) {
      if (ev.type === "tool_result" && ev.toolResult?.toolCallEventId != null)
        resultMap.set(ev.toolResult.toolCallEventId, ev);
    }
    for (const ev of traj.events) {
      if (ev.type !== "tool_call") continue;
      const name = ev.toolCall?.name ?? "unknown";
      if (!map.has(name)) map.set(name, { durations: [], errors: 0, count: 0 });
      const entry = map.get(name)!;
      entry.count++;
      const result = resultMap.get(ev.id);
      let dur = ev.durationMs ?? 0;
      if (!dur && result) {
        const s = new Date(ev.timestamp).getTime();
        const e = new Date(result.timestamp).getTime();
        if (!isNaN(s) && !isNaN(e) && e > s) dur = e - s;
      }
      if (dur > 0) entry.durations.push(dur);
      if (result?.toolResult?.isError) entry.errors++;
    }
  }

  const tools: ToolPerf[] = [];
  for (const [name, data] of map) {
    const sorted = [...data.durations].sort((a, b) => a - b);
    const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    const max = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
    tools.push({ name, count: data.count, errors: data.errors, avgMs: avg, p95Ms: p95, maxMs: max, durations: data.durations });
  }
  return tools.sort((a, b) => b.count - a.count);
}

export function buildToolSection(trajectories: Trajectory[], counts: Record<string, number>): HTMLElement {
  const section = document.createElement("div");
  section.className = "dv2-section";

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);

  // Header with tabs inline
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:10px 16px";
  const h4 = document.createElement("h4");
  h4.style.cssText = "margin:0;font-size:12px;text-transform:uppercase;color:var(--tv-text-muted);letter-spacing:0.5px";
  h4.textContent = "Tool Usage";
  header.appendChild(h4);

  const tabs = document.createElement("div");
  tabs.className = "dv2-tabs";
  tabs.style.margin = "0";
  header.appendChild(tabs);
  section.appendChild(header);

  // Content area
  const content = document.createElement("div");
  content.style.padding = "0 16px 12px";
  section.appendChild(content);

  const toolPerf = buildToolPerf(trajectories);
  let toolView: "bar" | "perf" | "counts" = "bar";

  function render() {
    content.innerHTML = "";
    tabs.innerHTML = "";

    for (const mode of ["bar", "perf", "counts"] as const) {
      const tab = document.createElement("div");
      tab.className = "dv2-tab" + (toolView === mode ? " active" : "");
      tab.textContent = mode === "bar" ? "Overview" : mode === "perf" ? "Performance" : "Counts";
      tab.addEventListener("click", () => { toolView = mode; render(); });
      tabs.appendChild(tab);
    }

    if (toolView === "bar") {
      // Stacked bar + legend
      const top6 = sorted.slice(0, 6);
      const otherCount = sorted.slice(6).reduce((s, [, c]) => s + c, 0);
      if (otherCount > 0) top6.push(["other", otherCount]);

      const bar = document.createElement("div");
      bar.className = "dv2-stacked-bar";
      const legend = document.createElement("div");
      legend.className = "dv2-legend";

      top6.forEach(([name, count], i) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        const seg = document.createElement("div");
        seg.className = "dv2-stacked-seg";
        seg.style.width = pct + "%";
        seg.style.background = TOOL_COLORS[i % TOOL_COLORS.length];
        seg.title = `${name}: ${count} calls (${pct.toFixed(1)}%)`;
        bar.appendChild(seg);

        const item = document.createElement("div");
        item.className = "dv2-legend-item";
        const swatch = document.createElement("span");
        swatch.className = "dv2-legend-swatch";
        swatch.style.background = TOOL_COLORS[i % TOOL_COLORS.length];
        item.appendChild(swatch);
        const label = document.createElement("span");
        label.textContent = `${name} (${count})`;
        item.appendChild(label);
        legend.appendChild(item);
      });

      content.appendChild(bar);
      content.appendChild(legend);
    } else if (toolView === "perf") {
      const cards = document.createElement("div");
      cards.className = "dv2-tool-cards";
      const show = toolPerf.slice(0, 8);
      for (const t of show) {
        const card = document.createElement("div");
        card.className = "dv2-tool-card";
        const name = document.createElement("div");
        name.className = "dv2-tool-card-name";
        name.textContent = t.name;
        card.appendChild(name);

        const stats = document.createElement("div");
        stats.className = "dv2-tool-card-stats";
        let html = `${t.count}`;
        if (t.errors > 0) html += ` <span class="dv2-tc-err">(${t.errors} err)</span>`;
        if (t.avgMs > 0) html += ` \u00B7 ${fmtMs(t.avgMs)}`;
        stats.innerHTML = html;
        card.appendChild(stats);

        if (t.durations.length > 1) card.appendChild(buildSparkline(t.durations));
        cards.appendChild(card);
      }
      if (toolPerf.length > 8) {
        const more = document.createElement("div");
        more.className = "dv2-tool-card";
        more.style.cssText = "display:flex;align-items:center;justify-content:center;color:var(--tv-text-muted);font-size:11px;cursor:pointer";
        more.textContent = `+${toolPerf.length - 8} more`;
        more.addEventListener("click", () => { toolView = "counts"; render(); });
        cards.appendChild(more);
      }
      content.appendChild(cards);
    } else {
      const maxCount = sorted.length > 0 ? sorted[0][1] : 0;
      const table = document.createElement("table");
      table.className = "dv2-tool-table";
      const thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>Tool</th><th>Calls</th><th>%</th><th class='dv2-bar-cell'></th></tr>";
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const [name, count] of sorted) {
        const pct = total > 0 ? (count / total) * 100 : 0;
        const tr = document.createElement("tr");
        const tdName = document.createElement("td"); tdName.textContent = name;
        const tdCount = document.createElement("td"); tdCount.textContent = count.toString();
        const tdPct = document.createElement("td"); tdPct.textContent = pct.toFixed(1) + "%";
        const tdBar = document.createElement("td"); tdBar.className = "dv2-bar-cell";
        const barDiv = document.createElement("div");
        barDiv.className = "dv2-tool-bar";
        barDiv.style.width = (maxCount > 0 ? (count / maxCount) * 100 : 0) + "%";
        barDiv.style.background = "#4f8ff7";
        tdBar.appendChild(barDiv);
        tr.appendChild(tdName); tr.appendChild(tdCount); tr.appendChild(tdPct); tr.appendChild(tdBar);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      content.appendChild(table);
    }
  }

  render();
  return section;
}

function buildSparkline(values: number[]): SVGSVGElement {
  const w = 110;
  const h = 20;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.classList.add("dv2-spark");

  const max = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
    const y = h - 2 - ((v / max) * (h - 4));
    return `${x},${y}`;
  });

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#ed8936");
  polyline.setAttribute("stroke-width", "1.5");
  svg.appendChild(polyline);

  return svg;
}

// ── Token Breakdown Section ─────────────────────────────────────────

function buildTokenSection(allEvents: TrajectoryEvent[], tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }): HTMLElement {
  const section = document.createElement("div");
  section.className = "dv2-section";

  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;

  // Header with tabs inline
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:10px 16px";
  const h4 = document.createElement("h4");
  h4.style.cssText = "margin:0;font-size:12px;text-transform:uppercase;color:var(--tv-text-muted);letter-spacing:0.5px";
  h4.textContent = "Token Breakdown";
  header.appendChild(h4);

  const tabs = document.createElement("div");
  tabs.className = "dv2-tabs";
  tabs.style.margin = "0";
  header.appendChild(tabs);
  section.appendChild(header);

  // Content area
  const content = document.createElement("div");
  content.style.padding = "0 16px 12px";
  section.appendChild(content);

  let tokenView: "calls" | "breakdown" = "calls";

  function render() {
    content.innerHTML = "";
    tabs.innerHTML = "";

    for (const mode of ["calls", "breakdown"] as const) {
      const tab = document.createElement("div");
      tab.className = "dv2-tab" + (tokenView === mode ? " active" : "");
      tab.textContent = mode === "calls" ? "AI Calls" : "Breakdown";
      tab.addEventListener("click", () => { tokenView = mode; render(); });
      tabs.appendChild(tab);
    }

    if (tokenView === "calls") {
      content.appendChild(buildMiniAiCalls(allEvents));
    } else {
      if (total > 0) {
        content.appendChild(buildDonut(tokens));
      } else {
        const p = document.createElement("div");
        p.style.cssText = "padding:10px;color:var(--tv-text-muted);font-size:12px";
        p.textContent = "No token data";
        content.appendChild(p);
      }
    }
  }

  render();
  return section;
}

function buildMiniAiCalls(allEvents: TrajectoryEvent[]): HTMLElement {
  const wrap = document.createElement("div");

  // Collect AI call events
  const aiEvents = allEvents.filter(e => e.type === "message" && e.role === "assistant" && e.tokens);

  if (aiEvents.length === 0) {
    wrap.style.cssText = "padding:10px;color:var(--tv-text-muted);font-size:12px";
    wrap.textContent = "No AI calls with token data";
    return wrap;
  }

  // Stats
  const calls = aiEvents.map(e => {
    const t = e.tokens!;
    const input = t.input ?? 0;
    const output = t.output ?? 0;
    const cached = t.cacheRead ?? 0;
    const totalTok = input + output + cached;
    const dur = e.durationMs ?? 0;
    const tps = dur > 0 ? output / (dur / 1000) : 0;
    return { totalTok, input, output, cached, dur, tps };
  });

  const totalTokens = calls.reduce((s, c) => s + c.totalTok, 0);
  const totalCached = calls.reduce((s, c) => s + c.cached, 0);
  const totalInput = calls.reduce((s, c) => s + c.input, 0);
  const totalOutput = calls.reduce((s, c) => s + c.output, 0);
  const tpsList = calls.filter(c => c.tps > 0);
  const avgTps = tpsList.length > 0 ? tpsList.reduce((s, c) => s + c.tps, 0) / tpsList.length : 0;
  // Cache hit % — fraction of input tokens that were billed at the
  // (cheaper) cache-read rate vs full price. Round to whole percent except
  // when ≥99% — long Claude Code agentic sessions genuinely sit at 99.4%
  // (each turn adds tiny fresh input on top of huge cached context); the
  // old `.toFixed(0)` rounded that to "100%" which looked like a bug.
  const rawCacheHit = totalInput + totalCached > 0
    ? (totalCached / (totalInput + totalCached)) * 100
    : 0;
  const cacheHitStr = rawCacheHit >= 99 && rawCacheHit < 100
    ? rawCacheHit.toFixed(1) + "%"
    : Math.round(rawCacheHit) + "%";

  // Stats row
  const stats = document.createElement("div");
  stats.className = "dv2-ai-stats";
  stats.innerHTML = `
    <span><strong>${aiEvents.length}</strong> calls</span>
    <span><strong>${fmtTok(totalTokens)}</strong> tokens</span>
    <span class="dv2-blue"><strong>${avgTps.toFixed(1)}</strong> t/s avg</span>
    <span class="dv2-green" title="Share of input tokens billed at cache-read rates (cheaper). Long agentic sessions genuinely run 99%+ because each turn just appends a few tokens to a huge cached prompt."><strong>${cacheHitStr}</strong> cache hit</span>
    <span>${fmtTok(totalOutput)} output</span>
  `;
  wrap.appendChild(stats);

  // Chart container that we'll fill (and re-fill on toggle). Built up
  // front so the toggle button can refer to it.
  const chartHost = document.createElement("div");
  chartHost.className = "dv2-ai-chart-host";
  wrap.appendChild(chartHost);

  // Toggle row — lets user choose bucketed (default, fast) or ungrouped
  // (every bar visible, scroll horizontally). Bucketed is on by default
  // for very large session counts so the page loads without freezing.
  const MAX_INDIVIDUAL_BARS = 600;
  const tooManyForUngrouped = calls.length > MAX_INDIVIDUAL_BARS;
  let groupBars = tooManyForUngrouped; // default to grouped when many calls

  if (tooManyForUngrouped) {
    const toggleRow = document.createElement("div");
    toggleRow.className = "dv2-mini-toggle-row";
    toggleRow.innerHTML = `
      <label class="dv2-mini-switch" title="Off: each individual call gets its own bar (scroll horizontally for the full series). On: bars are grouped into ~600 buckets for fast loading.">
        <input type="checkbox" checked>
        <span class="dv2-mini-switch-track"><span class="dv2-mini-switch-knob"></span></span>
        <span class="dv2-mini-switch-label">Group ${calls.length.toLocaleString()} calls into buckets</span>
      </label>
    `;
    wrap.appendChild(toggleRow);
    const checkbox = toggleRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.onchange = () => {
      groupBars = checkbox.checked;
      renderChart();
    };
  }

  function renderChart() {
    chartHost.innerHTML = "";
    // Toggle visual state
    wrap.querySelectorAll<HTMLButtonElement>(".dv2-mini-toggle").forEach((btn) => {
      const active = (groupBars && btn.dataset.mode === "grouped")
        || (!groupBars && btn.dataset.mode === "all");
      btn.classList.toggle("dv2-mini-toggle-active", active);
    });
    renderBars();
  }

  function renderBars() {
    const aggregated = groupBars && calls.length > MAX_INDIVIDUAL_BARS;
    let displayCalls: typeof calls;
    let bucketSize = 1;
    if (aggregated) {
      bucketSize = Math.ceil(calls.length / MAX_INDIVIDUAL_BARS);
      displayCalls = [];
      for (let i = 0; i < calls.length; i += bucketSize) {
        const slice = calls.slice(i, i + bucketSize);
        const avg = (k: keyof (typeof calls)[number]) =>
          slice.reduce((s, c) => s + (c[k] as number), 0) / slice.length;
        displayCalls.push({
          totalTok: avg("totalTok"),
          input: avg("input"),
          output: avg("output"),
          cached: avg("cached"),
          dur: avg("dur"),
          tps: avg("tps"),
        });
      }
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:10px;color:var(--tv-text-muted);margin-top:6px";
      hint.textContent =
        `${calls.length.toLocaleString()} calls bucketed into ${displayCalls.length} bars ` +
        `(~${bucketSize} calls per bar). Each bar shows the average tokens for its group.`;
      chartHost.appendChild(hint);
    } else {
      displayCalls = calls;
      if (calls.length > MAX_INDIVIDUAL_BARS) {
        const hint = document.createElement("div");
        hint.style.cssText = "font-size:10px;color:var(--tv-text-muted);margin-top:6px";
        hint.textContent = `Showing all ${calls.length.toLocaleString()} bars \u00b7 scroll horizontally`;
        chartHost.appendChild(hint);
      }
    }

    const maxTok = Math.max(...displayCalls.map(c => c.totalTok), 1);
    const chart = document.createElement("div");
    chart.className = "dv2-ai-chart";
    if (displayCalls.length > 200) chart.classList.add("dv2-ai-overflow");

    for (const c of displayCalls) {
      const pct = (c.totalTok / maxTok) * 100;
      const bar = document.createElement("div");
      bar.className = "dv2-ai-bar";
      bar.style.height = Math.max(pct, 2) + "%";
      bar.title = aggregated
        ? `~${fmtTok(c.totalTok)} avg tokens \u00b7 bucket of ~${bucketSize} calls`
        : `${fmtTok(c.totalTok)} tokens (${fmtTok(c.cached)} cached) \u2014 ${c.tps > 0 ? c.tps.toFixed(1) + " t/s" : ""}`;
      if (c.cached > 0 && c.totalTok > 0) {
        const cachedBar = document.createElement("div");
        cachedBar.className = "dv2-ai-bar-cached";
        cachedBar.style.height = ((c.cached / c.totalTok) * 100) + "%";
        bar.appendChild(cachedBar);
      }
      chart.appendChild(bar);
    }
    chartHost.appendChild(chart);

    const legend = document.createElement("div");
    legend.className = "dv2-ai-chart-legend";
    legend.innerHTML = `
      <span><span class="dv2-ai-chart-legend-dot" style="background:#4f8ff7"></span>total</span>
      <span><span class="dv2-ai-chart-legend-dot" style="background:#48bb78"></span>cached</span>
    `;
    chartHost.appendChild(legend);
  }

  renderChart();
  return wrap;
}

function buildDonut(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }): HTMLElement {
  const data = [
    { label: "Input", value: tokens.input },
    { label: "Output", value: tokens.output },
    { label: "Cache Read", value: tokens.cacheRead },
    { label: "Cache Write", value: tokens.cacheWrite },
  ].filter(d => d.value > 0);

  const total = data.reduce((s, d) => s + d.value, 0);
  const wrap = document.createElement("div");
  wrap.className = "dv2-donut-wrap";

  if (total === 0) {
    wrap.textContent = "No token data";
    return wrap;
  }

  const size = 100; const r = 38; const cx = 50; const cy = 50; const stroke = 14;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", "120");
  svg.setAttribute("height", "120");

  let cumAngle = -90;
  for (const d of data) {
    const pct = d.value / total;
    const angle = pct * 360;
    const startRad = (cumAngle * Math.PI) / 180;
    const endRad = ((cumAngle + angle) * Math.PI) / 180;
    const largeArc = angle > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", TOKEN_COLORS[d.label] ?? "#888");
    path.setAttribute("stroke-width", String(stroke));
    svg.appendChild(path);
    cumAngle += angle;
  }

  const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
  txt.setAttribute("x", String(cx));
  txt.setAttribute("y", String(cy + 3));
  txt.setAttribute("text-anchor", "middle");
  txt.setAttribute("font-size", "12");
  txt.setAttribute("font-weight", "700");
  txt.setAttribute("fill", "currentColor");
  txt.textContent = fmtTok(total);
  svg.appendChild(txt);
  wrap.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "dv2-donut-legend";
  for (const d of data) {
    const row = document.createElement("div");
    row.className = "dv2-donut-legend-row";
    const swatch = document.createElement("span");
    swatch.className = "dv2-legend-swatch";
    swatch.style.background = TOKEN_COLORS[d.label] ?? "#888";
    row.appendChild(swatch);
    const lbl = document.createElement("span");
    lbl.textContent = `${d.label}: ${fmtTok(d.value)} (${((d.value / total) * 100).toFixed(1)}%)`;
    row.appendChild(lbl);
    legend.appendChild(row);
  }
  wrap.appendChild(legend);
  return wrap;
}

// ── Event Log ───────────────────────────────────────────────────────

// ── Mini Gantt ──────────────────────────────────────────────────────

const LANE_COLORS: Record<string, string> = {
  Assistant: "#4f8ff7",
  Agents: "#ed8936",
  Thinking: "#f7b731",
  "Tool Calls": "#9f7aea",
  User: "#48bb78",
  System: "#718096",     // automated/system "user" events (IDE, hooks, task notifications)
  Compactions: "#fc5c65",
};
const LANE_ORDER = ["Assistant", "Agents", "Thinking", "Tool Calls", "User", "System", "Compactions"];
const LANE_HEIGHT = 24;

interface MiniEntry {
  lane: string;
  startPct: number;
  widthPct: number;
  color: string;
  label: string;
}

export function buildMiniGantt(trajectories: Trajectory[]): HTMLElement | null {
  // Build entries using same logic as real Gantt
  const entries: MiniEntry[] = [];
  let minT = Infinity;
  let maxT = -Infinity;

  for (const traj of trajectories) {
    // Build tool result lookup
    const resultMap = new Map<number, TrajectoryEvent>();
    for (const ev of traj.events) {
      if (ev.type === "tool_result" && ev.toolResult?.toolCallEventId != null)
        resultMap.set(ev.toolResult.toolCallEventId, ev);
    }

    // Next timestamp lookup
    const nextTs = new Map<number, number>();
    for (let i = 0; i < traj.events.length - 1; i++) {
      const nxt = new Date(traj.events[i + 1].timestamp).getTime();
      if (isFinite(nxt)) nextTs.set(traj.events[i].id, nxt);
    }

    for (const ev of traj.events) {
      const startMs = new Date(ev.timestamp).getTime();
      if (!isFinite(startMs)) continue;

      let lane = "";
      let endMs = startMs;
      let label = "";

      const MAX_AI_BAR = 5 * 60 * 1000;  // 5 min cap
      const MAX_THINK_BAR = 2 * 60 * 1000; // 2 min cap

      if (ev.type === "message" && ev.role === "assistant") {
        lane = ev.agent ? "Agents" : "Assistant";
        const rawEnd = nextTs.get(ev.id) ?? startMs + 500;
        endMs = (rawEnd - startMs > MAX_AI_BAR) ? startMs + (ev.durationMs ?? Math.min(rawEnd - startMs, MAX_AI_BAR)) : rawEnd;
        label = ev.agent ?? ev.model ?? "AI";
      } else if (ev.type === "message" && ev.role === "user") {
        // Split real human prompts from system/IDE/hook noise — without this
        // a user with a hyperactive editor or task-notification stream sees
        // 11K "User" entries and panics.
        if (isHumanUserMessage(ev)) {
          lane = "User";
          label = "User";
        } else {
          lane = "System";
          label = "System";
        }
        endMs = startMs + 200;
      } else if (ev.type === "tool_call") {
        lane = "Tool Calls";
        const result = resultMap.get(ev.id);
        if (result) {
          const rMs = new Date(result.timestamp).getTime();
          if (isFinite(rMs) && rMs > startMs) endMs = rMs;
          else endMs = startMs + (ev.durationMs ?? 500);
        } else {
          endMs = startMs + (ev.durationMs ?? 500);
        }
        label = ev.toolCall?.name ?? "Tool";
      } else if (ev.type === "thinking") {
        lane = "Thinking";
        const rawEnd = nextTs.get(ev.id) ?? startMs + 300;
        endMs = (rawEnd - startMs > MAX_THINK_BAR) ? startMs + Math.min(rawEnd - startMs, MAX_THINK_BAR) : rawEnd;
        label = "Thinking";
      } else if (ev.type === "system" && ev.contextCompacted) {
        lane = "Compactions";
        endMs = startMs + 500;
        label = "Compaction";
      } else {
        continue;
      }

      if (startMs < minT) minT = startMs;
      if (endMs > maxT) maxT = endMs;
      if (startMs > maxT) maxT = startMs; // in case endMs < startMs

      entries.push({ lane, startPct: startMs, widthPct: endMs - startMs, color: LANE_COLORS[lane] ?? "#778ca3", label });
    }
  }

  if (entries.length < 2 || !isFinite(minT) || !isFinite(maxT)) return null;
  const span = maxT - minT;
  if (span <= 0) return null;

  // Convert to percentages
  for (const e of entries) {
    const rawStart = e.startPct;
    e.startPct = ((rawStart - minT) / span) * 100;
    e.widthPct = Math.max((e.widthPct / span) * 100, 0.15);
  }

  // Only show lanes that have entries
  const activeLanes = LANE_ORDER.filter(l => entries.some(e => e.lane === l));
  if (activeLanes.length === 0) return null;

  const section = document.createElement("div");
  section.className = "dv2-gantt";

  // Header
  const header = document.createElement("div");
  header.className = "dv2-gantt-header";
  const h4 = document.createElement("h4");
  h4.textContent = "Timeline";
  header.appendChild(h4);
  const times = document.createElement("span");
  times.className = "dv2-gantt-times";
  times.textContent = `${new Date(minT).toLocaleTimeString()} \u2014 ${new Date(maxT).toLocaleTimeString()}`;
  header.appendChild(times);
  section.appendChild(header);

  // Swim lanes
  for (const lane of activeLanes) {
    const row = document.createElement("div");
    row.className = "dv2-gantt-lane";

    const lbl = document.createElement("div");
    lbl.className = "dv2-gantt-lane-label";
    lbl.textContent = lane;
    lbl.style.color = LANE_COLORS[lane] ?? "#778ca3";
    row.appendChild(lbl);

    const track = document.createElement("div");
    track.className = "dv2-gantt-track";

    const laneEntries = entries.filter(e => e.lane === lane);
    for (const e of laneEntries) {
      const bar = document.createElement("div");
      bar.className = "dv2-gantt-bar";
      bar.style.left = e.startPct + "%";
      bar.style.width = Math.min(e.widthPct, 100 - e.startPct) + "%";
      bar.style.background = e.color;
      bar.title = e.label;
      track.appendChild(bar);
    }

    row.appendChild(track);
    section.appendChild(row);
  }

  // Legend with counts
  const legend = document.createElement("div");
  legend.className = "dv2-gantt-legend";
  for (const lane of activeLanes) {
    const count = entries.filter(e => e.lane === lane).length;
    const item = document.createElement("span");
    item.className = "dv2-gantt-legend-item";
    const dot = document.createElement("span");
    dot.className = "dv2-gantt-legend-dot";
    dot.style.background = LANE_COLORS[lane] ?? "#778ca3";
    item.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = `${lane} (${count})`;
    item.appendChild(label);
    legend.appendChild(item);
  }
  section.appendChild(legend);

  return section;
}

// ── Event Table ─────────────────────────────────────────────────────

type EvCol = "time" | "type" | "role" | "tool" | "tokens" | "duration" | "content";
const EV_COLS: EvCol[] = ["time", "type", "role", "tool", "tokens", "duration", "content"];
const EV_COL_LABELS: Record<EvCol, string> = { time: "Time", type: "Type", role: "Role", tool: "Tool", tokens: "Tokens", duration: "Duration", content: "Content" };

export function buildEventTable(events: TrajectoryEvent[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "dv2-events";

  let sortCol: EvCol = "time";
  let sortAsc = true;
  const filters: Record<EvCol, string> = { time: "", type: "", role: "", tool: "", tokens: "", duration: "", content: "" };

  // Header + badge
  const header = document.createElement("div");
  header.className = "dv2-events-header";
  const h4 = document.createElement("h4");
  h4.textContent = "Events";
  header.appendChild(h4);
  const badge = document.createElement("span");
  badge.className = "dv2-ev-count-badge";
  header.appendChild(badge);
  section.appendChild(header);

  const wrap = document.createElement("div");
  wrap.className = "dv2-events-wrap";
  section.appendChild(wrap);

  function getVal(ev: TrajectoryEvent, col: EvCol): string {
    if (col === "time") return ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "";
    if (col === "type") return ev.type;
    if (col === "role") return ev.role;
    if (col === "tool") return ev.type === "tool_call" ? (ev.toolCall?.name ?? "") : "";
    if (col === "tokens") return ev.tokens ? String((ev.tokens.input ?? 0) + (ev.tokens.output ?? 0)) : "";
    if (col === "duration") return ev.durationMs ? String(ev.durationMs) : "";
    return evPreview(ev);
  }

  function rebuild() {
    let rows = events.filter(ev => {
      for (const col of EV_COLS) {
        if (!filters[col]) continue;
        if (!getVal(ev, col).toLowerCase().includes(filters[col].toLowerCase())) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const va = getVal(a, sortCol);
      const vb = getVal(b, sortCol);
      const cmp = (sortCol === "tokens" || sortCol === "duration")
        ? ((Number(va) || 0) - (Number(vb) || 0))
        : va.localeCompare(vb);
      return sortAsc ? cmp : -cmp;
    });

    badge.textContent = `${rows.length} of ${events.length}`;

    const table = document.createElement("table");
    table.className = "dv2-events-table";

    // Header row
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of EV_COLS) {
      const th = document.createElement("th");
      th.className = "dv2-evc-" + col;
      th.textContent = EV_COL_LABELS[col];
      if (sortCol === col) {
        const arrow = document.createElement("span");
        arrow.style.cssText = "margin-left:4px;font-size:10px";
        arrow.textContent = sortAsc ? "\u25B2" : "\u25BC";
        th.appendChild(arrow);
      }
      th.addEventListener("click", () => {
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        rebuild();
      });
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    // Filter row
    const filterRow = document.createElement("tr");
    filterRow.className = "dv2-ev-filter-row";
    for (const col of EV_COLS) {
      const th = document.createElement("th");
      const input = document.createElement("input");
      input.className = "dv2-ev-filter";
      input.placeholder = "Filter...";
      input.value = filters[col];
      input.addEventListener("input", () => { filters[col] = input.value; rebuild(); });
      th.appendChild(input);
      filterRow.appendChild(th);
    }
    thead.appendChild(filterRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    for (const ev of rows) {
      const isErr = ev.type === "error" || ev.toolResult?.isError;
      const tr = document.createElement("tr");
      if (isErr) tr.className = "dv2-ev-err";

      for (const col of EV_COLS) {
        const td = document.createElement("td");
        td.className = "dv2-evc-" + col;
        if (col === "type") {
          const b = document.createElement("span");
          b.className = "dv2-ev-badge dv2-ev-" + ev.type;
          b.textContent = ev.type;
          td.appendChild(b);
        } else if (col === "content") {
          td.className = "dv2-evc-content dv2-ev-content";
          td.textContent = getVal(ev, col).slice(0, 150);
        } else if (col === "tokens") {
          const raw = Number(getVal(ev, col)) || 0;
          td.textContent = raw > 0 ? fmtTok(raw) : "";
        } else if (col === "duration") {
          td.textContent = ev.durationMs ? fmtDur(ev.durationMs) : "";
        } else {
          td.textContent = getVal(ev, col);
        }
        tr.appendChild(td);
      }

      // Click to expand
      const full = evFullContent(ev);
      if (full) {
        const expandRow = document.createElement("tr");
        expandRow.className = "dv2-ev-expand";
        const expandTd = document.createElement("td");
        expandTd.colSpan = EV_COLS.length;
        const pre = document.createElement("pre");
        pre.textContent = full;
        expandTd.appendChild(pre);
        expandRow.appendChild(expandTd);
        tr.addEventListener("click", () => expandRow.classList.toggle("open"));
        tbody.appendChild(tr);
        tbody.appendChild(expandRow);
      } else {
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);

    wrap.innerHTML = "";
    wrap.appendChild(table);
  }

  rebuild();
  return section;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** True if this event is a user message that the human actually typed —
 * filters out IDE/system/hook/task-notification wrapper events that the
 * Anthropic format also tags as `role: "user"`. Used to split the lone
 * "User" bucket into real prompts vs. automated chatter. */
export function isHumanUserMessage(e: TrajectoryEvent): boolean {
  if (e.role !== "user" || e.type !== "message" || !e.content) return false;
  return isHumanPrompt(e.content);
}

/** Skip system/task/XML messages — find the real human-written prompt */
export function isHumanPrompt(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("<task-notification") || t.startsWith("<task_notification")) return false;
  if (t.startsWith("<system") || t.startsWith("<System")) return false;
  if (t.startsWith("<output-file") || t.startsWith("<tool-use-id")) return false;
  if (t.startsWith("<ide_opened_file>") || t.startsWith("<ide_selection")) return false;
  if (t.startsWith("<ide_") || t.startsWith("<user-prompt-submit-hook")) return false;
  const sample = t.slice(0, 200);
  const tagChars = (sample.match(/<[^>]+>/g) || []).join("").length;
  if (tagChars > sample.length * 0.5) return false;
  if (t.length < 5) return false;
  return true;
}

export function evPreview(e: TrajectoryEvent): string {
  if (e.type === "tool_call") {
    const args = e.toolCall?.arguments;
    if (!args) return "";
    if (typeof args === "string") return args.slice(0, 120);
    const obj = args as Record<string, unknown>;
    return String(obj.command ?? obj.file_path ?? obj.pattern ?? JSON.stringify(obj)).slice(0, 120);
  }
  if (e.type === "tool_result") return (e.toolResult?.output ?? "").slice(0, 120);
  return (e.content ?? "").slice(0, 120);
}

function evFullContent(e: TrajectoryEvent): string {
  if (e.type === "tool_call") {
    const args = e.toolCall?.arguments;
    if (!args) return "";
    if (typeof args === "string") return args.slice(0, 2000);
    return JSON.stringify(args, null, 2).slice(0, 2000);
  }
  if (e.type === "tool_result") return (e.toolResult?.output ?? "").slice(0, 2000);
  return (e.content ?? "").slice(0, 2000);
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtDur(ms: number): string {
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  if (ms < 3600000) return Math.floor(ms / 60000) + "m " + Math.floor((ms % 60000) / 1000) + "s";
  return Math.floor(ms / 3600000) + "h " + Math.floor((ms % 3600000) / 60000) + "m";
}

function fmtMs(ms: number): string {
  if (ms <= 0) return "0ms";
  if (ms < 1000) return Math.round(ms) + "ms";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  return Math.floor(s / 60) + "m " + Math.floor(s % 60) + "s";
}

/** Compact human latency for stats — "47s", "3m", "1h12m". */
export function formatLatency(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h${r}m` : `${h}h`;
}

const LATENCY_BUCKETS = [
  { label: "<1m",  ceil: 1 * 60 * 1000 },
  { label: "<3m",  ceil: 3 * 60 * 1000 },
  { label: "<5m",  ceil: 5 * 60 * 1000 },
  { label: "<10m", ceil: 10 * 60 * 1000 },
  { label: "<30m", ceil: 30 * 60 * 1000 },
  { label: "<60m", ceil: 60 * 60 * 1000 },
  { label: "60m+", ceil: Infinity },
];

/**
 * Walk events of a single session and return:
 *   replyGaps[]   = gap from AI's last action → user's next message (user reply latency)
 *   aiTurns[]     = gap from user's message → AI's last action of that turn (AI working time)
 * Gaps under 2s are dropped (they're not really "waits"); turns are also clamped >0.
 * Computing per-session avoids cross-session pollution when multiple sessions are merged.
 */
export function collectSessionLatencies(events: TrajectoryEvent[]): {
  replyGaps: number[];
  aiTurns: number[];
  pairs: { aiTurn: number; reply: number }[];
} {
  const replyGaps: number[] = [];
  const aiTurns: number[] = [];
  const pairs: { aiTurn: number; reply: number }[] = [];
  let lastAiTs: number | null = null;
  let lastUserTs: number | null = null;
  let pendingTurn: number | null = null;

  for (const e of events) {
    const ts = new Date(e.timestamp).getTime();
    if (!isFinite(ts)) continue;

    if (e.role === "assistant" && (e.type === "message" || e.type === "tool_call")) {
      lastAiTs = ts;
    } else if (isHumanUserMessage(e)) {
      // Close out any open AI turn — from last user msg → most recent AI activity.
      // We snapshot it as `pendingTurn` so we can pair it with this user's reply gap.
      pendingTurn = null;
      if (lastUserTs != null && lastAiTs != null && lastAiTs > lastUserTs) {
        const turn = lastAiTs - lastUserTs;
        if (turn > 2000) {
          aiTurns.push(turn);
          pendingTurn = turn;
        }
      }
      // Open a reply gap — from last AI activity → this user msg
      if (lastAiTs != null) {
        const gap = ts - lastAiTs;
        if (gap > 2000) {
          replyGaps.push(gap);
          if (pendingTurn != null) pairs.push({ aiTurn: pendingTurn, reply: gap });
        }
      }
      lastUserTs = ts;
      lastAiTs = null;
    }
  }
  // Close out the final AI turn at session end (no reply pair to capture)
  if (lastUserTs != null && lastAiTs != null && lastAiTs > lastUserTs) {
    const turn = lastAiTs - lastUserTs;
    if (turn > 2000) aiTurns.push(turn);
  }
  return { replyGaps, aiTurns, pairs };
}

function bucketLatencies(gaps: number[]): { counts: number[]; median: number } {
  const counts = LATENCY_BUCKETS.map(() => 0);
  for (const g of gaps) {
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      if (g < LATENCY_BUCKETS[i].ceil) { counts[i]++; break; }
    }
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
  return { counts, median };
}

type LatencyViewMode = "bars" | "strip" | "density" | "scatter";
const LATENCY_VIEW_KEY = "tv-latency-view";
function readLatencyView(): LatencyViewMode {
  const v = localStorage.getItem(LATENCY_VIEW_KEY);
  // Migrate stored values from views we've since dropped (line, line-v2,
  // cdf, violin, bars-cond) → "bars". "pair" → "scatter" (rename only).
  if (v === "pair") return "scatter";
  if (v === "bars" || v === "strip" || v === "density" || v === "scatter") return v;
  return "bars";
}

// Color ramp keyed to LATENCY_BUCKETS — fast (green) to slow (red).
// Used by the conditional bars view to color reply-latency segments stacked
// under each AI bucket. Order MUST match LATENCY_BUCKETS index for index.
const REPLY_BUCKET_COLORS = [
  "#48bb78", // <1m   green
  "#9ae6b4", // <3m   light green
  "#ecc94b", // <5m   yellow
  "#ed8936", // <10m  orange
  "#dd6b20", // <30m  dark orange
  "#c53030", // <60m  red
  "#742a2a", // 60m+  dark red
];

interface LatencyPair { aiTurn: number; reply: number; }

/**
 * Latency tornado — AI turn duration (top) vs user reply latency (bottom).
 * Toggle picks one of several renderings of the same two distributions:
 *   bars    — categorical buckets <1m / <3m / ... / 60m+, % within each row
 *   cdf     — smooth cumulative curves (% finished by time X) on a log axis
 *   strip   — every reply / turn as a dot on a shared log axis
 *   density — divergent smoothed density curves (KDE-ish)
 *   violin  — single side-by-side violin per metric (AI vs You)
 */
function buildLatencyTornado(replyGaps: number[], aiTurns: number[], pairs: LatencyPair[] = []): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-latency-tornado";

  const aiTotal = aiTurns.length;
  const replyTotal = replyGaps.length;
  const aiMed = aiTotal > 0 ? formatLatency(bucketLatencies(aiTurns).median) : "—";
  const replyMed = replyTotal > 0 ? formatLatency(bucketLatencies(replyGaps).median) : "—";

  // Header line — totals + medians
  const head = document.createElement("div");
  head.className = "dv2-lt-head";
  head.innerHTML =
    `<span class="dv2-lt-head-label"><span class="dv2-lt-swatch dv2-lt-ai"></span>AI turn</span> ` +
    `<strong>${aiTotal}</strong> turns · median <strong>${aiMed}</strong>` +
    `<span class="dv2-lt-head-sep">·</span>` +
    `<span class="dv2-lt-head-label"><span class="dv2-lt-swatch dv2-lt-user"></span>You reply</span> ` +
    `<strong>${replyTotal}</strong> replies · median <strong>${replyMed}</strong>`;
  wrap.appendChild(head);

  // View toggle
  let view = readLatencyView();
  const toggle = document.createElement("div");
  toggle.className = "dv2-lt-toggle";
  const VIEWS: { id: LatencyViewMode; label: string }[] = [
    { id: "bars", label: "Bars" },
    { id: "strip", label: "Strip" },
    { id: "density", label: "Density" },
    { id: "scatter", label: "Scatter (AI → reply)" },
  ];
  const chartHost = document.createElement("div");
  chartHost.className = "dv2-lt-chart-host";

  function renderToggle() {
    toggle.innerHTML = "";
    for (const v of VIEWS) {
      const b = document.createElement("button");
      b.className = "dv2-lt-toggle-btn" + (view === v.id ? " dv2-lt-toggle-active" : "");
      b.textContent = v.label;
      b.onclick = () => {
        view = v.id;
        try { localStorage.setItem(LATENCY_VIEW_KEY, v.id); } catch { /* ignore quota errors */ }
        renderToggle();
        renderChart();
      };
      toggle.appendChild(b);
    }
  }

  function renderChart() {
    chartHost.innerHTML = "";
    if (view === "bars") chartHost.appendChild(renderLatencyBars(aiTurns, pairs));
    else if (view === "strip") chartHost.appendChild(renderLatencyStrip(replyGaps, aiTurns));
    else if (view === "density") chartHost.appendChild(renderLatencyDensity(replyGaps, aiTurns));
    else if (view === "scatter") chartHost.appendChild(renderLatencyPair(pairs));
  }

  renderToggle();
  renderChart();
  wrap.appendChild(toggle);
  wrap.appendChild(chartHost);
  return wrap;
}

// ── View 1: Bars — top row shows AI turn distribution; bottom row shows
// the reply-latency distribution *conditional on* the AI bucket above it.
// Under each AI column we render 7 mini bars side-by-side (one per reply
// bucket, green→red) scaled to the column's max so shape stays readable.
// Answers "when AI takes X minutes, how long does the user typically take
// to reply?" ─────────────────────────────
function renderLatencyBars(aiTurns: number[], pairs: LatencyPair[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-lt-cond-wrap";

  const aiBuckets = bucketLatencies(aiTurns);
  const aiTotal = aiTurns.length;

  // Bucket each AI turn → its index, then bucket the *paired* reply within
  // that group. Result: condCounts[aiIdx][replyIdx] = how many pairs.
  const condCounts: number[][] = LATENCY_BUCKETS.map(() => LATENCY_BUCKETS.map(() => 0));
  const condTotals: number[] = LATENCY_BUCKETS.map(() => 0);
  for (const p of pairs) {
    let aiIdx = -1;
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      if (p.aiTurn < LATENCY_BUCKETS[i].ceil) { aiIdx = i; break; }
    }
    let replyIdx = -1;
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      if (p.reply < LATENCY_BUCKETS[i].ceil) { replyIdx = i; break; }
    }
    if (aiIdx < 0 || replyIdx < 0) continue;
    condCounts[aiIdx][replyIdx]++;
    condTotals[aiIdx]++;
  }

  const grid = document.createElement("div");
  grid.className = "dv2-lt-grid";
  grid.style.gridTemplateColumns = `repeat(${LATENCY_BUCKETS.length}, 1fr)`;

  // Top row — AI bucket bars (same as the regular Bars view)
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    const cell = document.createElement("div");
    cell.className = "dv2-lt-cell dv2-lt-cell-ai";
    const pct = aiTotal > 0 ? (aiBuckets.counts[i] / aiTotal) * 100 : 0;
    if (pct > 0) {
      const bar = document.createElement("div");
      bar.className = "dv2-lt-bar dv2-lt-ai";
      bar.style.height = Math.max(pct, 3) + "%";
      bar.title = `AI: ${aiBuckets.counts[i]} of ${aiTotal} turns (${pct.toFixed(0)}%) finished in ${LATENCY_BUCKETS[i].label}`;
      const lbl = document.createElement("span");
      lbl.className = "dv2-lt-pct";
      lbl.textContent = pct >= 1 ? Math.round(pct) + "%" : "<1%";
      bar.appendChild(lbl);
      cell.appendChild(bar);
    }
    grid.appendChild(cell);
  }

  // Axis row — bucket labels
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    const ax = document.createElement("div");
    ax.className = "dv2-lt-axis-cell";
    ax.textContent = LATENCY_BUCKETS[i].label;
    grid.appendChild(ax);
  }

  // Bottom row — for each AI bucket, render 7 mini bars side-by-side (one
  // per reply bucket). Bars scale to the largest conditional % within this
  // AI column so shape is readable even when the dominant bucket dwarfs the
  // others. Hover shows raw count + bucket label.
  for (let aiIdx = 0; aiIdx < LATENCY_BUCKETS.length; aiIdx++) {
    const cell = document.createElement("div");
    cell.className = "dv2-lt-cell dv2-lt-cell-cond";
    const total = condTotals[aiIdx];
    if (total === 0) {
      const empty = document.createElement("div");
      empty.className = "dv2-lt-cond-empty";
      empty.textContent = "—";
      empty.title = `No replies recorded after AI turns of ${LATENCY_BUCKETS[aiIdx].label}`;
      cell.appendChild(empty);
    } else {
      // Find max % in this column so the tallest mini bar reaches the top
      let maxPct = 0;
      for (let r = 0; r < LATENCY_BUCKETS.length; r++) {
        const p = (condCounts[aiIdx][r] / total) * 100;
        if (p > maxPct) maxPct = p;
      }
      const group = document.createElement("div");
      group.className = "dv2-lt-cond-group";
      group.title = `${total} reply${total === 1 ? "" : "s"} after AI turns of ${LATENCY_BUCKETS[aiIdx].label}`;
      for (let rIdx = 0; rIdx < LATENCY_BUCKETS.length; rIdx++) {
        const count = condCounts[aiIdx][rIdx];
        const pct = (count / total) * 100;
        const slot = document.createElement("div");
        slot.className = "dv2-lt-cond-slot";
        const bar = document.createElement("div");
        bar.className = "dv2-lt-cond-mini";
        bar.style.background = REPLY_BUCKET_COLORS[rIdx];
        bar.style.height = count === 0 ? "0%" : Math.max(2, (pct / maxPct) * 100) + "%";
        bar.title = count === 0
          ? `0 replies within ${LATENCY_BUCKETS[rIdx].label} — when AI took ${LATENCY_BUCKETS[aiIdx].label}`
          : `${count} of ${total} replies (${pct.toFixed(0)}%) within ${LATENCY_BUCKETS[rIdx].label} — when AI took ${LATENCY_BUCKETS[aiIdx].label}`;
        if (pct >= 15) {
          const lbl = document.createElement("span");
          lbl.className = "dv2-lt-cond-pct";
          lbl.textContent = Math.round(pct) + "%";
          bar.appendChild(lbl);
        }
        slot.appendChild(bar);
        group.appendChild(slot);
      }
      cell.appendChild(group);
      const n = document.createElement("div");
      n.className = "dv2-lt-cond-n";
      n.textContent = `n=${total}`;
      cell.appendChild(n);
    }
    grid.appendChild(cell);
  }

  wrap.appendChild(grid);

  // Legend mapping color → reply bucket
  const legend = document.createElement("div");
  legend.className = "dv2-lt-cond-legend";
  const legendLabel = document.createElement("span");
  legendLabel.className = "dv2-lt-cond-legend-label";
  legendLabel.textContent = "Reply latency:";
  legend.appendChild(legendLabel);
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    const item = document.createElement("span");
    item.className = "dv2-lt-cond-legend-item";
    const sw = document.createElement("span");
    sw.className = "dv2-lt-cond-legend-swatch";
    sw.style.background = REPLY_BUCKET_COLORS[i];
    item.appendChild(sw);
    item.appendChild(document.createTextNode(LATENCY_BUCKETS[i].label));
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  return wrap;
}

// ── Shared log-time axis helpers ──────────────────────────────────────
const LAT_MIN_MS = 2000;             // 2s — same floor used by collectSessionLatencies
const LAT_MAX_MS = 4 * 60 * 60 * 1000; // 4h cap so the long tail doesn't squash everything
const LAT_TICKS: { ms: number; label: string }[] = [
  { ms: 5_000, label: "5s" },
  { ms: 30_000, label: "30s" },
  { ms: 60_000, label: "1m" },
  { ms: 3 * 60_000, label: "3m" },
  { ms: 10 * 60_000, label: "10m" },
  { ms: 30 * 60_000, label: "30m" },
  { ms: 60 * 60_000, label: "1h" },
];
function logX(ms: number): number {
  const v = Math.max(LAT_MIN_MS, Math.min(LAT_MAX_MS, ms));
  return (Math.log(v) - Math.log(LAT_MIN_MS)) / (Math.log(LAT_MAX_MS) - Math.log(LAT_MIN_MS));
}

function svg(tag: string, attrs: Record<string, string | number> = {}, parent?: Element): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (parent) parent.appendChild(el);
  return el;
}

function renderLatencyAxis(parent: SVGElement, w: number, yMid: number, h: number) {
  // Center axis line
  svg("line", { x1: 0, x2: w, y1: yMid, y2: yMid, stroke: "var(--tv-border)", "stroke-width": 1 }, parent);
  // Vertical tick guides + labels
  for (const t of LAT_TICKS) {
    const x = logX(t.ms) * w;
    svg("line", { x1: x, x2: x, y1: 0, y2: h, stroke: "var(--tv-border)", "stroke-width": 0.5, "stroke-dasharray": "2 3", opacity: 0.3 }, parent);
    const lbl = svg("text", { x, y: yMid + 4, "text-anchor": "middle", "dominant-baseline": "hanging", fill: "var(--tv-text-muted)", "font-size": 10, "font-family": "var(--tv-mono)" }, parent);
    lbl.textContent = t.label;
  }
}

// ── View 2: Strip plot ───────────────────────────────────────────────
function renderLatencyStrip(replyGaps: number[], aiTurns: number[]): HTMLElement {
  // H scales with sample count: long sessions stack more dots per column,
  // so they need more vertical room. Cap at 220 to fit inside the chart
  // host (260px) with caption + padding.
  const maxStack = Math.max(aiTurns.length, replyGaps.length);
  const W = 920, PAD = 8;
  const H = Math.min(220, Math.max(160, Math.round(maxStack / 9)));
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  const yMid = PAD + innerH / 2;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "dv2-lt-svg" });
  const g = svg("g", { transform: `translate(${PAD},${PAD})` }, root);

  renderLatencyAxis(g, innerW, innerH / 2, innerH);

  function plotDots(values: number[], color: string, side: "top" | "bottom") {
    const range = innerH / 2 - 16;
    const baseY = side === "top" ? innerH / 2 - 4 : innerH / 2 + 4;
    // Stack dots vertically when they collide using a fixed-radius bin.
    const RADIUS = 2.5;
    const binW = RADIUS * 2.2;
    const bins = new Map<number, number>();
    let clampedCount = 0;
    for (const v of values) {
      const x = logX(v) * innerW;
      const bin = Math.round(x / binW);
      const stack = bins.get(bin) ?? 0;
      const offset = stack * (RADIUS * 2 + 0.5);
      let y = baseY + (side === "top" ? -offset : offset);
      // Clamp so dots don't escape the band — track when this kicks in so
      // we can hint to the user the chart is still saturated.
      const limit = side === "top" ? innerH / 2 - range : innerH / 2 + range;
      const beforeClamp = y;
      if (side === "top") y = Math.max(y, limit);
      else y = Math.min(y, limit);
      if (y !== beforeClamp) clampedCount++;
      svg("circle", { cx: x, cy: y, r: RADIUS, fill: color, opacity: 0.7 }, g);
      bins.set(bin, stack + 1);
    }
    return clampedCount;
  }

  const aiClamped = plotDots(aiTurns, "#4f8ff7", "top");
  const replyClamped = plotDots(replyGaps, "#ed8936", "bottom");

  const wrap = document.createElement("div");
  wrap.className = "dv2-lt-svg-wrap";
  wrap.appendChild(root);
  const cap = document.createElement("div");
  cap.className = "dv2-lt-cap";
  const totalClamped = aiClamped + replyClamped;
  cap.textContent = totalClamped > 0
    ? `every turn / reply as one dot — clusters reveal where time actually goes (${totalClamped} dots clamped at band edge)`
    : "every turn / reply as one dot — clusters reveal where time actually goes";
  wrap.appendChild(cap);
  return wrap;
}

// ── View 4: Smoothed density (KDE-ish) ────────────────────────────────
function renderLatencyDensity(replyGaps: number[], aiTurns: number[]): HTMLElement {
  const W = 920, H = 220, PAD_X = 8, PAD_TOP = 8, PAD_BOT = 22;
  const innerW = W - PAD_X * 2, innerH = H - PAD_TOP - PAD_BOT;
  const yMid = innerH / 2;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "dv2-lt-svg" });
  const g = svg("g", { transform: `translate(${PAD_X},${PAD_TOP})` }, root);

  // Sample 120 points along the log-time axis. Bandwidth = 0.06 in log-x
  // space — a Gaussian kernel that produces a smooth curve without erasing
  // the bumps the eye actually wants to see.
  const SAMPLES = 120;
  const BANDWIDTH = 0.06;
  function densityCurve(values: number[]): { xs: number[]; ys: number[]; max: number } {
    if (values.length === 0) return { xs: [], ys: [], max: 0 };
    const xLogs = values.map(v => logX(v));
    const xs: number[] = [], ys: number[] = [];
    let maxY = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const xN = i / (SAMPLES - 1);
      let sum = 0;
      for (const xl of xLogs) {
        const d = (xN - xl) / BANDWIDTH;
        sum += Math.exp(-0.5 * d * d);
      }
      const y = sum / (xLogs.length * BANDWIDTH * Math.sqrt(2 * Math.PI));
      xs.push(xN * innerW);
      ys.push(y);
      if (y > maxY) maxY = y;
    }
    return { xs, ys, max: maxY };
  }

  // Center axis + ticks first (so curves draw on top)
  for (const t of LAT_TICKS) {
    const x = logX(t.ms) * innerW;
    svg("line", { x1: x, x2: x, y1: 0, y2: innerH, stroke: "var(--tv-border)", "stroke-width": 0.5, "stroke-dasharray": "2 3", opacity: 0.3 }, g);
    const lbl = svg("text", { x, y: innerH + 14, "text-anchor": "middle", fill: "var(--tv-text-muted)", "font-size": 10, "font-family": "var(--tv-mono)" }, g);
    lbl.textContent = t.label;
  }
  svg("line", { x1: 0, x2: innerW, y1: yMid, y2: yMid, stroke: "var(--tv-border)", "stroke-width": 1 }, g);

  const ai = densityCurve(aiTurns);
  const reply = densityCurve(replyGaps);
  const sharedMax = Math.max(ai.max, reply.max, 0.0001);

  function fillArea(curve: { xs: number[]; ys: number[] }, color: string, side: "top" | "bottom") {
    if (curve.xs.length === 0) return;
    const halfH = yMid - 4;
    const path: string[] = [];
    if (side === "top") {
      path.push(`M 0,${yMid}`);
      for (let i = 0; i < curve.xs.length; i++) {
        const y = yMid - (curve.ys[i] / sharedMax) * halfH;
        path.push(`L ${curve.xs[i].toFixed(1)},${y.toFixed(1)}`);
      }
      path.push(`L ${curve.xs[curve.xs.length - 1].toFixed(1)},${yMid} Z`);
    } else {
      path.push(`M 0,${yMid}`);
      for (let i = 0; i < curve.xs.length; i++) {
        const y = yMid + (curve.ys[i] / sharedMax) * halfH;
        path.push(`L ${curve.xs[i].toFixed(1)},${y.toFixed(1)}`);
      }
      path.push(`L ${curve.xs[curve.xs.length - 1].toFixed(1)},${yMid} Z`);
    }
    svg("path", { d: path.join(" "), fill: color, opacity: 0.85, stroke: color, "stroke-width": 1.5 }, g);
  }

  fillArea(ai, "#4f8ff7", "top");
  fillArea(reply, "#ed8936", "bottom");

  const wrap = document.createElement("div");
  wrap.className = "dv2-lt-svg-wrap";
  wrap.appendChild(root);
  const cap = document.createElement("div");
  cap.className = "dv2-lt-cap";
  cap.textContent = "smoothed density — peaks show where the bulk of turns / replies cluster";
  wrap.appendChild(cap);
  return wrap;
}

// ── View 4: AI turn → next reply correlation ─────────────────────────
// "When AI takes 3 min, how long do you take to reply?" — answers exactly
// the question the user asked. Each pair (aiTurn, replyAfter) is one dot
// on a log–log scatter. Bins along the AI-turn axis show median + p25/p75
// reply time, so the eye can see "as AI turns get longer, do my replies
// also get longer (i.e. I wandered off)?"
function renderLatencyPair(pairs: LatencyPair[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dv2-lt-svg-wrap";

  if (pairs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dv2-lt-cap";
    empty.style.padding = "20px";
    empty.style.textAlign = "center";
    empty.textContent = "No paired turns to correlate yet — need at least one user→AI→user→AI cycle.";
    wrap.appendChild(empty);
    return wrap;
  }

  const W = 920, H = 220, PAD_T = 10, PAD_B = 28, PAD_L = 56, PAD_R = 12;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "dv2-lt-svg" });
  const g = svg("g", { transform: `translate(${PAD_L},${PAD_T})` }, root);

  // Both axes use the shared log scale 2s → 4h
  function xAt(ms: number) { return logX(ms) * innerW; }
  function yAt(ms: number) { return innerH - logX(ms) * innerH; }

  // x-ticks (AI turn duration)
  for (const t of LAT_TICKS) {
    const x = xAt(t.ms);
    svg("line", { x1: x, x2: x, y1: 0, y2: innerH, stroke: "var(--tv-border)", "stroke-width": 0.5, "stroke-dasharray": "2 3", opacity: 0.25 }, g);
    const lbl = svg("text", { x, y: innerH + 14, "text-anchor": "middle", fill: "var(--tv-text-muted)", "font-size": 10, "font-family": "var(--tv-mono)" }, g);
    lbl.textContent = t.label;
  }
  // y-ticks (reply latency)
  for (const t of LAT_TICKS) {
    const y = yAt(t.ms);
    svg("line", { x1: 0, x2: innerW, y1: y, y2: y, stroke: "var(--tv-border)", "stroke-width": 0.5, "stroke-dasharray": "2 3", opacity: 0.25 }, g);
    const lbl = svg("text", { x: -4, y, "text-anchor": "end", "dominant-baseline": "middle", fill: "var(--tv-text-muted)", "font-size": 10, "font-family": "var(--tv-mono)" }, g);
    lbl.textContent = t.label;
  }
  // Axis titles
  const xt = svg("text", { x: innerW / 2, y: innerH + 26, "text-anchor": "middle", fill: "var(--tv-text-secondary)", "font-size": 11 }, g);
  xt.textContent = "AI turn duration →";
  const yt = svg("text", { x: -42, y: innerH / 2, "text-anchor": "middle", fill: "var(--tv-text-secondary)", "font-size": 11, transform: `rotate(-90, -42, ${innerH / 2})` }, g);
  yt.textContent = "Your reply latency →";

  // Diagonal reference line (y = x). If your reply consistently sits ABOVE
  // this line, you reply slower than the AI works — i.e. you wandered off.
  svg("line", { x1: 0, y1: yAt(LAT_MIN_MS), x2: innerW, y2: yAt(LAT_MAX_MS), stroke: "var(--tv-text-muted)", "stroke-width": 1, "stroke-dasharray": "4 4", opacity: 0.4 }, g);
  const diagLbl = svg("text", { x: innerW - 4, y: yAt(LAT_MAX_MS) + 4, "text-anchor": "end", "dominant-baseline": "hanging", fill: "var(--tv-text-muted)", "font-size": 9 }, g);
  diagLbl.textContent = "you = ai";

  // Scatter dots
  for (const p of pairs) {
    svg("circle", { cx: xAt(p.aiTurn), cy: yAt(p.reply), r: 2.2, fill: "#9f7aea", opacity: 0.45 }, g);
  }

  // Bin pairs by AI turn duration; show median reply per bin with a p25–p75
  // band, so the eye can see the trend through the noise.
  const BINS = [
    { lo: 0,             hi: 30_000,    label: "<30s" },
    { lo: 30_000,        hi: 60_000,    label: "30s–1m" },
    { lo: 60_000,        hi: 3 * 60000, label: "1–3m" },
    { lo: 3 * 60000,     hi: 5 * 60000, label: "3–5m" },
    { lo: 5 * 60000,     hi: 10 * 60000, label: "5–10m" },
    { lo: 10 * 60000,    hi: 30 * 60000, label: "10–30m" },
    { lo: 30 * 60000,    hi: Infinity,   label: "30m+" },
  ];
  const binStats: { center: number; n: number; med: number; p25: number; p75: number; label: string }[] = [];
  for (const b of BINS) {
    const replies = pairs.filter(p => p.aiTurn >= b.lo && p.aiTurn < b.hi).map(p => p.reply).sort((a, c) => a - c);
    if (replies.length === 0) continue;
    const center = Math.sqrt(b.lo === 0 ? LAT_MIN_MS : b.lo) * Math.sqrt(b.hi === Infinity ? LAT_MAX_MS : b.hi);
    binStats.push({
      center,
      n: replies.length,
      med: replies[Math.floor(replies.length / 2)],
      p25: replies[Math.floor(replies.length * 0.25)],
      p75: replies[Math.floor(replies.length * 0.75)],
      label: b.label,
    });
  }
  // Connect medians with a line (read the slope: positive = "you wander off
  // when AI takes longer", flat = "your reply pace is independent of AI").
  if (binStats.length >= 2) {
    const linePts = binStats.map(s => `${xAt(s.center).toFixed(1)},${yAt(s.med).toFixed(1)}`).join(" L ");
    svg("path", { d: `M ${linePts}`, fill: "none", stroke: "#ed8936", "stroke-width": 2.5 }, g);
  }
  for (const s of binStats) {
    const cx = xAt(s.center);
    const yMed = yAt(s.med);
    const y25 = yAt(s.p25);
    const y75 = yAt(s.p75);
    // p25–p75 band
    svg("line", { x1: cx, x2: cx, y1: y75, y2: y25, stroke: "#ed8936", "stroke-width": 6, opacity: 0.25, "stroke-linecap": "round" }, g);
    // Median dot
    svg("circle", { cx, cy: yMed, r: 4.5, fill: "#ed8936", stroke: "#fff", "stroke-width": 1.5 }, g);
    const t = svg("title", {}, g.lastChild as Element);
    t.textContent = `AI ${s.label}: n=${s.n}, median reply ${formatLatency(s.med)} (p25 ${formatLatency(s.p25)} → p75 ${formatLatency(s.p75)})`;
  }

  // Spearman rank correlation of (aiTurn, reply) — robust to log scaling
  const rho = spearmanRank(pairs.map(p => p.aiTurn), pairs.map(p => p.reply));
  const rhoLabel = svg("text", { x: innerW - 4, y: 12, "text-anchor": "end", fill: "var(--tv-text-secondary)", "font-size": 11, "font-family": "var(--tv-mono)" }, g);
  rhoLabel.textContent = `n=${pairs.length} · ρ=${rho.toFixed(2)}`;

  wrap.appendChild(root);
  const cap = document.createElement("div");
  cap.className = "dv2-lt-cap";
  // Describe the correlation in neutral terms — don't editorialize about
  // why it's happening (e.g. "you wander off" assumed intent the data
  // can't support). Just report the direction; let the user interpret.
  const direction = rho > 0.2 ? "your reply latency tends to grow with AI turn length" :
                    rho < -0.2 ? "your reply latency tends to shrink as AI turns get longer" :
                    "no strong link between AI turn length and your reply pace";
  cap.innerHTML = `Each dot is one (AI turn, your next reply). Orange line = median reply per AI bin. Diagonal = you-equal-AI. <strong>${direction}.</strong>`;
  wrap.appendChild(cap);
  return wrap;
}

function spearmanRank(xs: number[], ys: number[]): number {
  if (xs.length < 2) return 0;
  function ranks(arr: number[]): number[] {
    const idx = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j + 2) / 2; // 1-based ranks averaged for ties
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  }
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mean = (n + 1) / 2;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mean, b = ry[i] - mean;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}

export function fmtTok(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1000000) return (n / 1000).toFixed(1) + "K";
  return (n / 1000000).toFixed(2) + "M";
}
