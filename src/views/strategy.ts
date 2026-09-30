/**
 * Strategy View — reconstructs the agent's strategy from its actions.
 * Classifies events into phases (Explore, Understand, Plan, Implement, Verify, Communicate)
 * and shows phase transitions on a horizontal bar with time percentages.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

type Phase = "explore" | "understand" | "plan" | "implement" | "verify" | "communicate";

const PHASE_CONFIG: Record<Phase, { label: string; color: string; icon: string }> = {
  explore:      { label: "Explore",      color: "#4f8ff7", icon: "🔍" },
  understand:   { label: "Understand",   color: "#9f7aea", icon: "🧠" },
  plan:         { label: "Plan",         color: "#ed8936", icon: "📋" },
  implement:    { label: "Implement",    color: "#48bb78", icon: "🔧" },
  verify:       { label: "Verify",       color: "#38b2ac", icon: "✓" },
  communicate:  { label: "Communicate",  color: "#fc5c65", icon: "💬" },
};

const EXPLORE_TOOLS = new Set(["Read", "ReadFile", "ReadFileRange", "Grep", "Glob", "SearchFiles", "ListFiles", "search", "find", "ls", "cat"]);
const IMPLEMENT_TOOLS = new Set(["Edit", "EditFile", "EditLines", "Write", "WriteFile", "apply_patch", "str_replace_editor", "insert", "create"]);
const VERIFY_TOOLS = new Set(["Bash", "ExecuteCommand", "terminal", "RunTests", "RunTestsStructured", "BuildProject", "BuildProjectStructured", "NpmTest", "NpmBuild"]);

function classifyEvent(e: TrajectoryEvent): Phase {
  if (e.type === "message" && e.role === "user") return "communicate";
  if (e.type === "thinking") return "understand";
  if (e.type === "system") return "plan";

  if (e.type === "tool_call" && e.toolCall) {
    const name = e.toolCall.name;
    if (EXPLORE_TOOLS.has(name)) return "explore";
    if (IMPLEMENT_TOOLS.has(name)) return "implement";
    if (VERIFY_TOOLS.has(name)) {
      // Check if it looks like a test command
      const args = typeof e.toolCall.arguments === "string" ? e.toolCall.arguments : JSON.stringify(e.toolCall.arguments ?? "");
      if (/test|check|verify|lint|build|compile|pytest|jest|dotnet\s+test/i.test(args)) return "verify";
      return "verify";
    }
    // Default tool calls to explore
    return "explore";
  }

  if (e.type === "tool_result") {
    return "implement"; // Results follow the call's phase but we group them
  }

  if (e.type === "message" && e.role === "assistant") {
    const content = e.content ?? "";
    if (content.length > 500) return "understand"; // Long messages = reasoning
    return "communicate";
  }

  return "explore";
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface PhaseSegment {
  phase: Phase;
  startIdx: number;
  endIdx: number;
  startTime: number;
  endTime: number;
  events: TrajectoryEvent[];
}

export const strategyView: TrajectoryView = {
  id: "strategy",
  name: "Strategy",
  description: "Reconstruct the agent's strategy — phase timeline with Explore/Understand/Plan/Implement/Verify",
  icon: "Z",
  tier: "advanced",

  css: `
.sv-empty { padding: 40px; text-align: center; color: var(--tv-text-muted, #888); }
.sv-section { margin-bottom: 24px; }
.sv-section h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
.sv-timeline-wrap { background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 16px; }
.sv-timeline-bar { display: flex; height: 36px; border-radius: 6px; overflow: hidden; margin-bottom: 12px; cursor: pointer; }
.sv-timeline-seg { position: relative; min-width: 2px; transition: opacity 0.15s; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.9); text-shadow: 0 1px 2px rgba(0,0,0,0.4); overflow: hidden; white-space: nowrap; }
.sv-timeline-seg:hover { opacity: 0.8; }
.sv-legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--tv-text-muted, #888); }
.sv-legend-item { display: flex; align-items: center; gap: 6px; }
.sv-legend-dot { width: 12px; height: 12px; border-radius: 3px; }
.sv-pct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.sv-pct-card { background: var(--tv-card-bg, #1a1a2e); border-radius: 8px; padding: 14px; text-align: center; }
.sv-pct-value { font-size: 22px; font-weight: 700; }
.sv-pct-label { font-size: 11px; text-transform: uppercase; color: var(--tv-text-muted, #888); margin-top: 2px; }
.sv-pct-bar { height: 4px; border-radius: 2px; margin-top: 6px; }
.sv-transitions { margin-top: 8px; }
.sv-transition-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--tv-border, #333); font-size: 13px; }
.sv-transition-idx { color: var(--tv-text-muted, #888); font-size: 11px; min-width: 40px; font-family: var(--tv-mono, monospace); }
.sv-transition-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #fff; }
.sv-transition-arrow { color: var(--tv-text-muted, #888); }
.sv-transition-dur { color: var(--tv-text-muted, #888); font-size: 11px; margin-left: auto; }
.sv-session-sep { padding: 8px 12px; background: var(--tv-bg, #0d0d1a); border-radius: 4px; margin: 12px 0 8px; font-size: 12px; font-weight: 600; color: var(--tv-text-muted, #888); }
`,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    if (trajectories.length === 0) {
      const msg = el("p", "sv-empty");
      msg.textContent = "No sessions selected";
      container.appendChild(msg);
      return;
    }

    for (let ti = 0; ti < trajectories.length; ti++) {
      const traj = trajectories[ti];
      if (trajectories.length > 1) {
        const sep = el("div", "sv-session-sep");
        sep.textContent = `Session ${ti + 1}: ${traj.session.id}`;
        container.appendChild(sep);
      }
      renderSession(container, traj);
    }
  },
};

function renderSession(container: HTMLElement, traj: Trajectory): void {
  const events = traj.events;
  if (events.length === 0) {
    const msg = el("p", "sv-empty");
    msg.textContent = "No events in this session";
    container.appendChild(msg);
    return;
  }

  // Classify all events
  const classified = events.map(e => ({ event: e, phase: classifyEvent(e) }));

  // Build segments (consecutive same-phase events)
  const segments: PhaseSegment[] = [];
  let currentPhase = classified[0].phase;
  let segStart = 0;

  for (let i = 1; i <= classified.length; i++) {
    if (i === classified.length || classified[i].phase !== currentPhase) {
      const segEvents = classified.slice(segStart, i).map(c => c.event);
      const startTime = new Date(segEvents[0].timestamp).getTime();
      const endTime = new Date(segEvents[segEvents.length - 1].timestamp).getTime();
      segments.push({
        phase: currentPhase,
        startIdx: segStart,
        endIdx: i - 1,
        startTime: isNaN(startTime) ? 0 : startTime,
        endTime: isNaN(endTime) ? 0 : endTime,
        events: segEvents,
      });
      if (i < classified.length) {
        currentPhase = classified[i].phase;
        segStart = i;
      }
    }
  }

  // Phase time breakdown
  const phaseTimes: Record<Phase, number> = { explore: 0, understand: 0, plan: 0, implement: 0, verify: 0, communicate: 0 };
  const phaseCounts: Record<Phase, number> = { explore: 0, understand: 0, plan: 0, implement: 0, verify: 0, communicate: 0 };
  for (const seg of segments) {
    const dur = Math.max(seg.endTime - seg.startTime, 100); // min 100ms for display
    phaseTimes[seg.phase] += dur;
    phaseCounts[seg.phase] += seg.events.length;
  }
  const totalTime = Object.values(phaseTimes).reduce((a, b) => a + b, 0) || 1;

  // Timeline bar
  const timelineSection = el("div", "sv-section");
  const tlH3 = el("h3");
  tlH3.textContent = "Phase Timeline";
  timelineSection.appendChild(tlH3);

  const tlWrap = el("div", "sv-timeline-wrap");
  const bar = el("div", "sv-timeline-bar");

  for (const seg of segments) {
    const dur = Math.max(seg.endTime - seg.startTime, 100);
    const pct = (dur / totalTime) * 100;
    const segEl = el("div", "sv-timeline-seg");
    segEl.style.width = `${Math.max(pct, 0.5)}%`;
    segEl.style.background = PHASE_CONFIG[seg.phase].color;
    if (pct > 8) {
      segEl.textContent = PHASE_CONFIG[seg.phase].label;
    }
    segEl.title = `${PHASE_CONFIG[seg.phase].label}: ${fmtDur(dur)} (${seg.events.length} events)`;
    bar.appendChild(segEl);
  }
  tlWrap.appendChild(bar);

  // Legend
  const legend = el("div", "sv-legend");
  for (const [phase, cfg] of Object.entries(PHASE_CONFIG)) {
    if (phaseCounts[phase as Phase] === 0) continue;
    const item = el("div", "sv-legend-item");
    const dot = el("span", "sv-legend-dot");
    dot.style.background = cfg.color;
    item.appendChild(dot);
    const lbl = el("span");
    lbl.textContent = `${cfg.label} (${phaseCounts[phase as Phase]})`;
    item.appendChild(lbl);
    legend.appendChild(item);
  }
  tlWrap.appendChild(legend);
  timelineSection.appendChild(tlWrap);
  container.appendChild(timelineSection);

  // Percentage cards
  const pctSection = el("div", "sv-section");
  const pctH3 = el("h3");
  pctH3.textContent = "Time in Each Phase";
  pctSection.appendChild(pctH3);

  const pctGrid = el("div", "sv-pct-grid");
  for (const [phase, cfg] of Object.entries(PHASE_CONFIG)) {
    const pct = phaseTimes[phase as Phase] / totalTime;
    if (pct === 0) continue;
    const card = el("div", "sv-pct-card");
    const val = el("div", "sv-pct-value");
    val.textContent = fmtPct(pct);
    val.style.color = cfg.color;
    const lbl = el("div", "sv-pct-label");
    lbl.textContent = cfg.label;
    const pbar = el("div", "sv-pct-bar");
    pbar.style.background = cfg.color;
    pbar.style.width = fmtPct(pct);
    card.appendChild(val);
    card.appendChild(lbl);
    card.appendChild(pbar);
    pctGrid.appendChild(card);
  }
  pctSection.appendChild(pctGrid);
  container.appendChild(pctSection);

  // Phase transitions list
  const transSection = el("div", "sv-section");
  const transH3 = el("h3");
  transH3.textContent = `Phase Transitions (${segments.length - 1})`;
  transSection.appendChild(transH3);

  const transList = el("div", "sv-transitions");
  const maxTransitions = 50;
  for (let i = 1; i < segments.length && i <= maxTransitions; i++) {
    const from = segments[i - 1];
    const to = segments[i];
    const row = el("div", "sv-transition-row");

    const idx = el("span", "sv-transition-idx");
    idx.textContent = `#${i}`;
    row.appendChild(idx);

    const fromBadge = el("span", "sv-transition-badge");
    fromBadge.textContent = PHASE_CONFIG[from.phase].label;
    fromBadge.style.background = PHASE_CONFIG[from.phase].color;
    row.appendChild(fromBadge);

    const arrow = el("span", "sv-transition-arrow");
    arrow.textContent = "→";
    row.appendChild(arrow);

    const toBadge = el("span", "sv-transition-badge");
    toBadge.textContent = PHASE_CONFIG[to.phase].label;
    toBadge.style.background = PHASE_CONFIG[to.phase].color;
    row.appendChild(toBadge);

    const dur = el("span", "sv-transition-dur");
    const segDur = Math.max(from.endTime - from.startTime, 0);
    dur.textContent = `after ${fmtDur(segDur)} (${from.events.length} events)`;
    row.appendChild(dur);

    transList.appendChild(row);
  }
  if (segments.length - 1 > maxTransitions) {
    const more = el("div", "sv-transition-row");
    more.textContent = `... and ${segments.length - 1 - maxTransitions} more transitions`;
    more.style.color = "var(--tv-text-muted, #888)";
    transList.appendChild(more);
  }
  transSection.appendChild(transList);
  container.appendChild(transSection);
}
