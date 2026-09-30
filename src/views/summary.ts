/**
 * Summary View — executive summary with large stat cards,
 * natural language paragraph, timeline phases, and top tools.
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

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(2)}M`;
}

function fmtMinutes(ms: number): string {
  const m = ms / 60000;
  if (m < 1) return "less than a minute";
  if (m < 2) return "about 1 minute";
  return `${Math.round(m)} minutes`;
}

/** Classify an event into a phase: exploring, editing, testing, other */
function classifyPhase(e: TrajectoryEvent): string {
  const name = e.toolCall?.name?.toLowerCase() ?? "";
  if (name.includes("read") || name.includes("glob") || name.includes("search") || name.includes("grep") || name.includes("list") || name.includes("find")) return "exploring";
  if (name.includes("edit") || name.includes("write") || name.includes("create") || name.includes("delete") || name.includes("patch")) return "editing";
  if (name.includes("test") || name.includes("build") || name.includes("run") || name.includes("bash") || name.includes("exec")) return "testing";
  if (e.type === "thinking") return "thinking";
  return "other";
}

export const summaryView: TrajectoryView = {
  id: "summary",
  name: "Summary",
  description: "Executive summary with key stats, natural language overview, timeline phases, and top tools",
  icon: "S",
  tier: "advanced",

  css: `
.sum-empty { padding: 40px; text-align: center; color: var(--tv-text-muted, #888); }
.sum-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
.sum-card { background: var(--tv-card-bg, #1a1a2e); border-radius: 10px; padding: 20px; text-align: center; }
.sum-card-value { font-size: 28px; font-weight: 700; margin-bottom: 4px; color: var(--tv-text, #e0e0e0); }
.sum-card-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--tv-text-muted, #888); }
.sum-section { margin-bottom: 24px; }
.sum-section h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
.sum-paragraph { line-height: 1.7; font-size: 14px; color: var(--tv-text, #ccc); background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 16px; }
.sum-phases { display: flex; height: 28px; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
.sum-phase { display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #fff; min-width: 2px; }
.sum-phase-exploring { background: #4f8ff7; }
.sum-phase-editing { background: #48bb78; }
.sum-phase-testing { background: #ed8936; }
.sum-phase-thinking { background: #9f7aea; }
.sum-phase-other { background: #555; }
.sum-legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--tv-text-muted, #888); }
.sum-legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.sum-top-tools { list-style: none; padding: 0; margin: 0; }
.sum-top-tools li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--tv-border, #222); font-size: 13px; }
.sum-tool-rank { font-weight: 700; color: var(--tv-accent, #4f8ff7); min-width: 20px; }
.sum-tool-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--tv-border, #333); overflow: hidden; }
.sum-tool-bar-fill { height: 100%; background: var(--tv-accent, #4f8ff7); border-radius: 3px; }
.sum-multi { background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 16px; font-size: 14px; line-height: 1.7; }
`,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    if (trajectories.length === 0) {
      const msg = el("p", "sum-empty");
      msg.textContent = "No sessions selected";
      container.appendChild(msg);
      return;
    }

    const allEvents = trajectories.flatMap((t) => t.events);
    const summary = trajectories.length === 1 && trajectories[0].summary
      ? trajectories[0].summary
      : computeSummary(allEvents);

    const model = trajectories[0].session.model ?? "Unknown";
    const totalTok = summary.totalTokens.input + summary.totalTokens.output + summary.totalTokens.cacheRead;

    // Key stat cards
    const cards = el("div", "sum-cards");
    const stats = [
      { label: "Duration", value: fmtDur(summary.durationMs) },
      { label: "Total Tokens", value: fmtTokens(totalTok) },
      { label: "Tool Calls", value: summary.totalToolCalls.toLocaleString() },
      { label: "Errors", value: summary.errorCount.toString() },
      { label: "Model", value: model.length > 24 ? model.slice(0, 20) + "..." : model },
      { label: "Unique Tools", value: summary.uniqueTools.length.toString() },
    ];

    for (const stat of stats) {
      const card = el("div", "sum-card");
      const val = el("div", "sum-card-value");
      val.textContent = stat.value;
      const lbl = el("div", "sum-card-label");
      lbl.textContent = stat.label;
      card.appendChild(val);
      card.appendChild(lbl);
      cards.appendChild(card);
    }
    container.appendChild(cards);

    // Natural language summary
    const paraSection = el("div", "sum-section");
    const paraH3 = el("h3");
    paraH3.textContent = "Overview";
    paraSection.appendChild(paraH3);

    const para = el("p", "sum-paragraph");
    const sessionWord = trajectories.length > 1 ? `These ${trajectories.length} sessions` : "This session";
    let text = `${sessionWord} lasted ${fmtMinutes(summary.durationMs)}, made ${summary.totalToolCalls} tool call${summary.totalToolCalls !== 1 ? "s" : ""} across ${summary.uniqueTools.length} unique tool${summary.uniqueTools.length !== 1 ? "s" : ""}. `;
    text += `The model used was ${model}. `;
    if (totalTok > 0) text += `A total of ${fmtTokens(totalTok)} tokens were consumed. `;
    if (summary.errorCount > 0) {
      text += `${summary.errorCount} error${summary.errorCount !== 1 ? "s" : ""} occurred during execution.`;
    } else {
      text += "No errors were encountered.";
    }
    para.textContent = text;
    paraSection.appendChild(para);
    container.appendChild(paraSection);

    // Timeline phases
    const toolEvents = allEvents.filter((e) => e.type === "tool_call");
    if (toolEvents.length > 0) {
      const phaseSection = el("div", "sum-section");
      const phaseH3 = el("h3");
      phaseH3.textContent = "Activity Phases";
      phaseSection.appendChild(phaseH3);

      const phaseCounts: Record<string, number> = { exploring: 0, editing: 0, testing: 0, thinking: 0, other: 0 };
      for (const e of toolEvents) {
        const phase = classifyPhase(e);
        phaseCounts[phase]++;
      }
      // Also count thinking events
      for (const e of allEvents) {
        if (e.type === "thinking") phaseCounts["thinking"]++;
      }

      const total = Object.values(phaseCounts).reduce((a, b) => a + b, 0) || 1;
      const phaseBar = el("div", "sum-phases");
      const colors: Record<string, string> = { exploring: "sum-phase-exploring", editing: "sum-phase-editing", testing: "sum-phase-testing", thinking: "sum-phase-thinking", other: "sum-phase-other" };

      for (const [phase, count] of Object.entries(phaseCounts)) {
        if (count === 0) continue;
        const seg = el("div", `sum-phase ${colors[phase] ?? "sum-phase-other"}`);
        const pct = (count / total) * 100;
        seg.style.width = `${pct}%`;
        if (pct > 8) seg.textContent = `${Math.round(pct)}%`;
        seg.title = `${phase}: ${count} events (${Math.round(pct)}%)`;
        phaseBar.appendChild(seg);
      }
      phaseSection.appendChild(phaseBar);

      const legend = el("div", "sum-legend");
      const phaseLabels: Record<string, string> = { exploring: "#4f8ff7", editing: "#48bb78", testing: "#ed8936", thinking: "#9f7aea", other: "#555" };
      for (const [phase, color] of Object.entries(phaseLabels)) {
        if (phaseCounts[phase] === 0) continue;
        const item = el("span");
        item.innerHTML = `<span class="sum-legend-dot" style="background:${esc(color)}"></span>${esc(phase)} (${phaseCounts[phase]})`;
        legend.appendChild(item);
      }
      phaseSection.appendChild(legend);
      container.appendChild(phaseSection);
    }

    // Top 3 most-used tools
    if (summary.uniqueTools.length > 0) {
      const toolSection = el("div", "sum-section");
      const toolH3 = el("h3");
      toolH3.textContent = "Top Tools";
      toolSection.appendChild(toolH3);

      const sorted = Object.entries(summary.toolCallCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const maxCount = sorted[0]?.[1] ?? 1;
      const list = el("ul", "sum-top-tools");

      for (let i = 0; i < sorted.length; i++) {
        const [name, count] = sorted[i];
        const li = document.createElement("li");

        const rank = el("span", "sum-tool-rank");
        rank.textContent = `#${i + 1}`;
        li.appendChild(rank);

        const nameEl = el("span");
        nameEl.textContent = name;
        nameEl.style.minWidth = "120px";
        li.appendChild(nameEl);

        const barOuter = el("div", "sum-tool-bar");
        const barInner = el("div", "sum-tool-bar-fill");
        barInner.style.width = `${(count / maxCount) * 100}%`;
        barOuter.appendChild(barInner);
        li.appendChild(barOuter);

        const countEl = el("span");
        countEl.textContent = count.toString();
        countEl.style.minWidth = "36px";
        countEl.style.textAlign = "right";
        li.appendChild(countEl);

        list.appendChild(li);
      }
      toolSection.appendChild(list);
      container.appendChild(toolSection);
    }

    // Multi-session comparison summary
    if (trajectories.length > 1) {
      const multiSection = el("div", "sum-section");
      const multiH3 = el("h3");
      multiH3.textContent = "Multi-Session Summary";
      multiSection.appendChild(multiH3);

      const multiP = el("div", "sum-multi");
      const durations = trajectories.map((t) => (t.summary ?? computeSummary(t.events)).durationMs);
      const avgDur = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const models = [...new Set(trajectories.map((t) => t.session.model ?? "Unknown"))];
      const statuses = trajectories.map((t) => t.session.status ?? "unknown");
      const succeeded = statuses.filter((s) => s === "succeeded").length;

      let multiText = `Comparing ${trajectories.length} sessions. `;
      multiText += `Average duration: ${fmtMinutes(avgDur)}. `;
      multiText += `Models used: ${models.join(", ")}. `;
      multiText += `${succeeded}/${trajectories.length} succeeded.`;
      multiP.textContent = multiText;
      multiSection.appendChild(multiP);
      container.appendChild(multiSection);
    }
  },
};
