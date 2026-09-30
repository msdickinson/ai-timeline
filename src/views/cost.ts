/**
 * Cost View — cost breakdown per model and per tool with cumulative line.
 *
 * Pricing comes from common/cost.ts (the unified table also used by the
 * dashboard). Each $ value on the right of every row is clickable —
 * expanding it shows the actual math: which pricing entry matched, how
 * the match was found (exact / fuzzy / pattern / unknown), token counts,
 * $/M rates, and the per-component subtotals. The user should be able to
 * audit any number we show or trust it.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";
import { estimateCost, formatCost, CostDetail, CostEstimate, PRICES_AS_OF } from "../common/cost";

export const costView: TrajectoryView = {
  id: "cost",
  name: "Cost",
  description: "Cost breakdown per model and tool with cumulative line",
  icon: "$",
  tier: "standard",
  requires: ["tokens"],

  css: `
    .cv { font-family: var(--tv-font); padding: 8px 0; }
    .cv-header { font-size: 16px; font-weight: 700; padding: 12px 0; border-bottom: 1px solid var(--tv-border); margin-bottom: 16px; }
    .cv-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .cv-card { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 16px; }
    .cv-card-value { font-size: 22px; font-weight: 700; font-family: var(--tv-mono); }
    .cv-card-label { font-size: 12px; color: var(--tv-text-secondary); margin-top: 4px; }
    .cv-card-note { font-size: 10px; color: var(--tv-text-muted); margin-top: 2px; font-style: italic; }
    .cv-section { margin-bottom: 24px; }
    .cv-section h3 { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
    .cv-section-note { font-size: 11px; color: var(--tv-text-muted); margin-bottom: 12px; font-style: italic; }
    .cv-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .cv-bar-label { min-width: 140px; font-family: var(--tv-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cv-bar-track { flex: 1; height: 22px; background: var(--tv-bg); border-radius: 3px; overflow: hidden; position: relative; }
    .cv-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .cv-bar-value-wrap { min-width: 110px; display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
    .cv-bar-value { text-align: right; font-family: var(--tv-mono); font-size: 12px; }
    .cv-line-wrap { position: relative; height: 160px; background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); overflow: hidden; }
    .cv-line-svg { width: 100%; height: 100%; }
    .cv-line-axis { position: absolute; bottom: 4px; left: 8px; right: 8px; display: flex; justify-content: space-between; font-size: 9px; color: var(--tv-text-muted); font-family: var(--tv-mono); }
    .cv-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }

    /* Cost-breakdown disclosure (mirrors dashboard's dv2-cost-info) */
    .cv-cost-info { display: inline-block; position: relative; }
    .cv-cost-info > summary {
      list-style: none; cursor: pointer; user-select: none;
      font-size: 14px; color: var(--tv-text-muted); padding: 2px 6px; border-radius: 3px;
    }
    .cv-cost-info > summary::-webkit-details-marker { display: none; }
    .cv-cost-info > summary:hover { color: var(--tv-text); background: var(--tv-bg-hover); }
    .cv-cost-info-panel {
      position: absolute; top: 100%; right: 0; z-index: 100;
      margin-top: 6px; min-width: 720px; max-width: 1100px;
      background: var(--tv-bg-card); border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius); padding: 18px 22px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
      font-size: 14px; line-height: 1.5; color: var(--tv-text-secondary);
      cursor: default;
    }
    .cv-cost-info-head {
      font-size: 14px; font-weight: 700; color: var(--tv-text); margin-bottom: 12px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .cv-cost-info-foot {
      font-size: 13px; color: var(--tv-text-muted); margin-top: 14px;
      padding-top: 12px; border-top: 1px dashed var(--tv-border);
      line-height: 1.55;
    }
    .cv-cost-info-foot strong { color: var(--tv-text-secondary); }
    .cv-cost-table {
      width: 100%; border-collapse: collapse; font-family: var(--tv-mono); font-size: 13px;
    }
    .cv-cost-table th {
      text-align: left; padding: 8px 10px; color: var(--tv-text-muted);
      border-bottom: 1px solid var(--tv-border); font-weight: 600;
      text-transform: uppercase; font-size: 11px; letter-spacing: 0.4px;
    }
    .cv-cost-table td {
      padding: 10px 12px; border-bottom: 1px solid var(--tv-border); vertical-align: top;
    }
    .cv-cost-table tr:last-child td { border-bottom: none; }
    .cv-cost-table code { background: var(--tv-bg); padding: 2px 5px; border-radius: 2px; font-size: 12px; }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("cv");

    if (trajectories.length === 0) {
      const empty = el("div", "cv-empty");
      empty.textContent = "No sessions selected";
      container.appendChild(empty);
      return;
    }

    const allEvents = trajectories.flatMap((t) => t.events);

    // Inject the per-event default model when an event lacks one (matches
    // the dashboard logic). This way estimateCost can attribute correctly.
    const eventsForCost = allEvents
      .filter((e) => e.tokens)
      .map((e) => ({
        model: e.model || trajectories.find((t) => t.events.includes(e))?.session.model || "unknown",
        tokens: e.tokens,
      }));

    const estimate = estimateCost(eventsForCost);

    // Header
    const header = el("div", "cv-header");
    header.textContent = "Cost Analysis";
    container.appendChild(header);

    // Summary cards
    const cards = el("div", "cv-cards");
    const totalNote = estimate.isEstimate ? "estimated from tokens (list price)" : "";
    cards.appendChild(makeCard(formatCost(estimate.totalUsd), "Total Cost", totalNote));

    const modelCount = estimate.details.filter((d) => d.totalCost > 0 || d.pricingSource === "local-default").length;
    cards.appendChild(makeCard(String(modelCount || estimate.details.length), "Models Used", ""));

    const totalTok = estimate.details.reduce((s, d) => s + d.inputTokens + d.outputTokens, 0);
    cards.appendChild(makeCard(fmtTokens(totalTok), "Total Tokens", ""));

    if (totalTok > 0 && estimate.totalUsd > 0) {
      const costPerKTok = (estimate.totalUsd / totalTok) * 1000;
      cards.appendChild(makeCard(formatCost(costPerKTok), "Cost / 1K Tokens", ""));
    }
    container.appendChild(cards);

    // Cost by Model
    if (estimate.details.length > 0) {
      const section = el("div", "cv-section");
      const heading = el("h3", "");
      heading.textContent = "Cost by Model";
      section.appendChild(heading);

      const note = el("div", "cv-section-note");
      note.textContent = `List price as of ${estimate.pricesAsOf}. Click ⓘ next to any value for the per-model token-by-token math.`;
      section.appendChild(note);

      const sortedDetails = [...estimate.details].sort((a, b) => b.totalCost - a.totalCost);
      const maxModelCost = sortedDetails[0]?.totalCost ?? 1;
      const colors = ["#4f8ff7", "#48bb78", "#ed8936", "#9f7aea", "#fc5c65", "#38bdf8"];

      for (let i = 0; i < sortedDetails.length; i++) {
        const detail = sortedDetails[i];
        const row = el("div", "cv-bar-row");

        const label = el("div", "cv-bar-label");
        label.textContent = detail.model;
        label.title = detail.model;
        row.appendChild(label);

        const track = el("div", "cv-bar-track");
        const fill = el("div", "cv-bar-fill");
        fill.style.width = `${maxModelCost > 0 ? (detail.totalCost / maxModelCost) * 100 : 0}%`;
        fill.style.background = colors[i % colors.length];
        track.appendChild(fill);
        row.appendChild(track);

        const valueWrap = el("div", "cv-bar-value-wrap");
        const value = el("div", "cv-bar-value");
        value.textContent = formatCost(detail.totalCost);
        valueWrap.appendChild(value);
        valueWrap.appendChild(makeCostInfoDisclosure([detail], `${detail.model} — cost breakdown`));
        row.appendChild(valueWrap);

        section.appendChild(row);
      }
      container.appendChild(section);
    }

    // Cost by Tool — what each tool's invoking AI calls cost. Tools execute
    // locally for free; this is the LLM token cost of the AI turns that
    // emitted each tool call, computed by running estimateCost on just that
    // tool's events. (Old impl divided by total-tool-tokens then multiplied
    // by total session cost, which double-counted non-tool spend.)
    const toolEventsByName = new Map<string, Array<{ model?: string; tokens?: TrajectoryEvent["tokens"] }>>();
    for (const ev of allEvents) {
      if (ev.type !== "tool_call" || !ev.tokens) continue;
      const name = ev.toolCall?.name ?? "unknown";
      const list = toolEventsByName.get(name) ?? [];
      list.push({
        model: ev.model || trajectories.find((t) => t.events.includes(ev))?.session.model || "unknown",
        tokens: ev.tokens,
      });
      toolEventsByName.set(name, list);
    }

    if (toolEventsByName.size > 0) {
      const section = el("div", "cv-section");
      const heading = el("h3", "");
      heading.textContent = "Cost by Tool";
      section.appendChild(heading);

      const note = el("div", "cv-section-note");
      note.textContent =
        "Tools (Bash, Read, Edit, etc.) run locally for $0. " +
        "This shows the LLM token cost of the AI turns that invoked each tool.";
      section.appendChild(note);

      const toolEntries: Array<{ name: string; est: CostEstimate }> = [];
      for (const [name, evs] of toolEventsByName) {
        toolEntries.push({ name, est: estimateCost(evs) });
      }
      toolEntries.sort((a, b) => b.est.totalUsd - a.est.totalUsd);
      const sortedTools = toolEntries.slice(0, 15);
      const maxToolCost = sortedTools[0]?.est.totalUsd ?? 1;

      for (const { name, est } of sortedTools) {
        const row = el("div", "cv-bar-row");

        const label = el("div", "cv-bar-label");
        label.textContent = name;
        label.title = name;
        row.appendChild(label);

        const track = el("div", "cv-bar-track");
        const fill = el("div", "cv-bar-fill");
        fill.style.width = `${maxToolCost > 0 ? (est.totalUsd / maxToolCost) * 100 : 0}%`;
        fill.style.background = "#ed8936";
        track.appendChild(fill);
        row.appendChild(track);

        const valueWrap = el("div", "cv-bar-value-wrap");
        const value = el("div", "cv-bar-value");
        value.textContent = formatCost(est.totalUsd);
        valueWrap.appendChild(value);
        valueWrap.appendChild(makeCostInfoDisclosure(est.details, `${name} — cost from invoking AI calls`));
        row.appendChild(valueWrap);

        section.appendChild(row);
      }
      container.appendChild(section);
    }

    // Cumulative cost line — uses the same unified pricing per event so
    // the running total lands exactly on estimate.totalUsd at the end.
    const eventsWithTokens = allEvents
      .filter((e) => e.tokens && e.timestamp)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (eventsWithTokens.length > 1) {
      const section = el("div", "cv-section");
      const heading = el("h3", "");
      heading.textContent = "Cumulative Cost Over Time";
      section.appendChild(heading);

      const lineNote = el("div", "cv-section-note");
      lineNote.textContent =
        "Running total of estimated $ across every token-bearing event in chronological order. " +
        "Steeper slope = more expensive turns; flat = idle or cheap turns.";
      section.appendChild(lineNote);

      const wrap = el("div", "cv-line-wrap");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cv-line-svg");
      svg.setAttribute("viewBox", "0 0 800 150");
      svg.setAttribute("preserveAspectRatio", "none");

      let cumulative = 0;
      const points: Array<{ x: number; y: number }> = [];
      const startMs = new Date(eventsWithTokens[0].timestamp).getTime();
      const endMs = new Date(eventsWithTokens[eventsWithTokens.length - 1].timestamp).getTime();
      const spanMs = endMs - startMs || 1;

      for (const ev of eventsWithTokens) {
        const model = ev.model || trajectories.find((t) => t.events.includes(ev))?.session.model || "unknown";
        // estimateCost on a single event gives us the right $ via unified pricing
        const evCost = estimateCost([{ model, tokens: ev.tokens }]).totalUsd;
        cumulative += evCost;

        const x = ((new Date(ev.timestamp).getTime() - startMs) / spanMs) * 780 + 10;
        points.push({ x, y: cumulative });
      }

      const maxY = points[points.length - 1]?.y || 1;
      const pathPoints = points.map((p) => `${p.x},${145 - (p.y / maxY) * 135}`).join(" ");

      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("points", pathPoints);
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", "#4f8ff7");
      polyline.setAttribute("stroke-width", "2");
      svg.appendChild(polyline);

      const areaPoints = `10,145 ${pathPoints} ${points[points.length - 1]?.x ?? 790},145`;
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.setAttribute("points", areaPoints);
      polygon.setAttribute("fill", "rgba(79,143,247,0.15)");
      svg.appendChild(polygon);

      wrap.appendChild(svg);

      const axis = el("div", "cv-line-axis");
      const startLabel = el("span", "");
      startLabel.textContent = new Date(eventsWithTokens[0].timestamp).toLocaleTimeString();
      const endLabel = el("span", "");
      endLabel.textContent = formatCost(maxY);
      axis.appendChild(startLabel);
      axis.appendChild(endLabel);
      wrap.appendChild(axis);

      section.appendChild(wrap);
      container.appendChild(section);
    }
  },
};

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function makeCard(value: string, label: string, note: string): HTMLElement {
  const card = el("div", "cv-card");
  const valEl = el("div", "cv-card-value");
  valEl.textContent = value;
  card.appendChild(valEl);
  const labEl = el("div", "cv-card-label");
  labEl.textContent = label;
  card.appendChild(labEl);
  if (note) {
    const noteEl = el("div", "cv-card-note");
    noteEl.textContent = note;
    card.appendChild(noteEl);
  }
  return card;
}

/** Build a click-to-expand <details> showing per-model math + pricing source.
 * Mirrors the dashboard's renderCostBreakdownDisclosure but as a DOM node. */
function makeCostInfoDisclosure(details: CostDetail[], headLabel: string): HTMLElement {
  const wrap = document.createElement("details");
  wrap.className = "cv-cost-info";
  const summary = document.createElement("summary");
  summary.setAttribute("aria-label", "Cost breakdown");
  summary.title = "Click to see token-by-token math + pricing source";
  summary.textContent = "ⓘ";
  wrap.appendChild(summary);

  const panel = document.createElement("div");
  panel.className = "cv-cost-info-panel";

  const head = document.createElement("div");
  head.className = "cv-cost-info-head";
  head.textContent = `${headLabel} — list price as of ${PRICES_AS_OF}`;
  panel.appendChild(head);

  const table = document.createElement("table");
  table.className = "cv-cost-table";
  table.innerHTML = `
    <thead><tr>
      <th>Model</th><th>Pricing source</th>
      <th>Fresh input</th><th>Cache read</th><th>Cache write</th><th>Output</th><th>Total</th>
    </tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector("tbody")!;

  for (const d of details) {
    const sourceLabel =
      d.pricingSource === "exact" ? "exact match" :
      d.pricingSource === "fuzzy" ? "matched on substring" :
      d.pricingSource === "pattern" ? "matched on pattern" :
      d.pricingSource === "local-default" ? "treated as local (free)" :
      "unknown — no pricing applied";
    const sourceColor =
      d.pricingSource === "exact" ? "#48bb78" :
      d.pricingSource === "unknown" ? "#fc5c65" : "#f7b731";
    const sourceLink = d.pricingSourceUrl
      ? `<br><a href="${escForCost(d.pricingSourceUrl)}" target="_blank" rel="noopener" style="color:#4f8ff7;font-size:12px">View pricing ↗</a>`
      : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escForCost(d.model)}</code></td>
      <td>${d.pricingKey ? `<code>${escForCost(d.pricingKey)}</code>` : "<em>unknown</em>"}<br>
          <span style="color:${sourceColor};font-size:12px">${sourceLabel}</span>${sourceLink}</td>
      <td style="text-align:right">${fmtTokens(d.inputTokens)} × $${d.inputPerM}/M<br><strong>${formatCost(d.inputCost)}</strong></td>
      <td style="text-align:right">${fmtTokens(d.cacheReadTokens)} × $${d.cacheReadPerM}/M<br><strong>${formatCost(d.cacheReadCost)}</strong></td>
      <td style="text-align:right">${fmtTokens(d.cacheWriteTokens)} × $${d.cacheWritePerM}/M<br><strong>${formatCost(d.cacheWriteCost)}</strong></td>
      <td style="text-align:right">${fmtTokens(d.outputTokens)} × $${d.outputPerM}/M<br><strong>${formatCost(d.outputCost)}</strong></td>
      <td style="text-align:right"><strong>${formatCost(d.totalCost)}</strong></td>`;
    tbody.appendChild(tr);
  }
  panel.appendChild(table);

  const foot = document.createElement("div");
  foot.className = "cv-cost-info-foot";
  foot.innerHTML =
    "Anthropic / OpenAI counters are disjoint: <strong>fresh input</strong> " +
    "is the uncached portion only (we don't subtract cache reads from it). " +
    "<strong>Cache write</strong> tokens carry a ~25% premium on Anthropic; " +
    "we price them separately. Tools (Bash, Read, Edit, etc.) and thinking " +
    "tokens cost $0 — they run locally or are billed inside the LLM call's " +
    "output. Numbers are <strong>list price</strong>; if you're on a " +
    "flat-rate subscription you don't pay this. Click \"View pricing ↗\" " +
    "to verify our $/M against the provider's rate sheet.";
  panel.appendChild(foot);

  wrap.appendChild(panel);
  return wrap;
}

function escForCost(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1e6) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1e6).toFixed(2)}M`;
}
