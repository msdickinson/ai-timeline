/**
 * Findings View — aggregate analysis data across sessions.
 * Groups failures by rootCause, shows verdict distribution, tag clouds,
 * and drilldown from finding to matching sessions.
 */

import { Trajectory, SessionAnalysis } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

interface AnalyzedSession {
  sessionId: string;
  model: string;
  status: string;
  analysis: SessionAnalysis;
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

const VERDICT_COLORS: Record<string, string> = {
  correct: "#48bb78",
  incorrect: "#fc5c65",
  partial: "#ed8936",
  inconclusive: "#a0aec0",
};

export const findingsView: TrajectoryView = {
  id: "findings",
  name: "Findings",
  description: "Aggregated analysis findings, failure patterns, and verdict distribution",
  icon: "L",
  tier: "standard",
  requires: ["analysis"],

  css: `
    .fn { font-family: var(--tv-font); }
    .fn-section { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 16px 20px; margin-bottom: 14px; }
    .fn-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    .fn-subtitle { font-size: 13px; font-weight: 600; color: var(--tv-text-secondary); margin-bottom: 8px; }
    .fn-stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .fn-stat { background: var(--tv-bg); border: 1px solid var(--tv-border); border-radius: var(--tv-radius-sm); padding: 10px 16px; min-width: 90px; }
    .fn-stat-label { font-size: 11px; color: var(--tv-text-muted); }
    .fn-stat-val { font-size: 22px; font-weight: 700; font-family: var(--tv-mono); }
    .fn-verdict-bar { display: flex; height: 36px; border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
    .fn-verdict-seg { display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #fff; min-width: 2px; cursor: pointer; transition: opacity 0.15s; }
    .fn-verdict-seg:hover { opacity: 0.8; }
    .fn-legend { display: flex; gap: 14px; font-size: 12px; flex-wrap: wrap; margin-top: 6px; }
    .fn-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
    .fn-cause { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--tv-border); cursor: pointer; }
    .fn-cause:last-child { border-bottom: none; }
    .fn-cause:hover { background: var(--tv-bg-hover); }
    .fn-cause-count { min-width: 36px; text-align: right; font-weight: 700; font-family: var(--tv-mono); font-size: 14px; color: var(--tv-accent); }
    .fn-cause-name { font-size: 13px; font-weight: 600; }
    .fn-cause-bar { flex: 1; max-width: 200px; }
    .fn-cause-bar-inner { height: 8px; border-radius: 4px; background: var(--tv-accent); }
    .fn-sessions { margin-top: 8px; padding: 10px; background: var(--tv-bg); border-radius: var(--tv-radius-sm); border: 1px solid var(--tv-border); }
    .fn-session-item { padding: 4px 0; font-size: 12px; font-family: var(--tv-mono); border-bottom: 1px solid var(--tv-border); }
    .fn-session-item:last-child { border-bottom: none; }
    .fn-tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .fn-tag { padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; background: var(--tv-bg); border: 1px solid var(--tv-border); cursor: default; }
    .fn-rec { padding: 6px 0; border-bottom: 1px solid var(--tv-border); font-size: 13px; }
    .fn-rec:last-child { border-bottom: none; }
    .fn-rec-count { font-weight: 700; color: var(--tv-accent); font-family: var(--tv-mono); margin-right: 6px; }
    .fn-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    container.classList.add("fn");

    const analyzed: AnalyzedSession[] = [];
    for (const traj of trajectories) {
      if (!traj.analysis) continue;
      analyzed.push({
        sessionId: traj.session.id,
        model: traj.session.model ?? "unknown",
        status: traj.session.status ?? "unknown",
        analysis: traj.analysis,
      });
    }

    if (analyzed.length === 0) {
      const empty = el("div", "fn-empty");
      empty.textContent = "No analysis data found. This view requires trajectory.analysis to be populated (e.g., from benchmark AI reviews or session analysis).";
      container.appendChild(empty);
      return;
    }

    // --- Overview ---
    const overviewSection = el("div", "fn-section");
    const overviewTitle = el("div", "fn-title");
    overviewTitle.textContent = `Findings (${analyzed.length} analyzed sessions)`;
    overviewSection.appendChild(overviewTitle);

    const verdicts: Record<string, AnalyzedSession[]> = { correct: [], incorrect: [], partial: [], inconclusive: [] };
    for (const s of analyzed) {
      const v = s.analysis.verdict;
      if (!verdicts[v]) verdicts[v] = [];
      verdicts[v].push(s);
    }

    const stats = el("div", "fn-stats");
    for (const [verdict, sessions] of Object.entries(verdicts)) {
      const item = el("div", "fn-stat");
      const lbl = el("div", "fn-stat-label");
      lbl.textContent = verdict.charAt(0).toUpperCase() + verdict.slice(1);
      const val = el("div", "fn-stat-val");
      val.textContent = String(sessions.length);
      val.style.color = VERDICT_COLORS[verdict] ?? "inherit";
      item.appendChild(lbl);
      item.appendChild(val);
      stats.appendChild(item);
    }
    overviewSection.appendChild(stats);

    // Verdict bar
    const verdictBar = el("div", "fn-verdict-bar");
    let detailContainer: HTMLElement | null = null;
    for (const [verdict, sessions] of Object.entries(verdicts)) {
      if (sessions.length === 0) continue;
      const seg = el("div", "fn-verdict-seg");
      seg.style.cssText = `flex:${sessions.length};background:${VERDICT_COLORS[verdict] ?? "#a0aec0"};`;
      seg.textContent = `${verdict} (${sessions.length})`;
      seg.title = `${verdict}: ${sessions.length} sessions`;
      seg.addEventListener("click", () => {
        if (detailContainer) detailContainer.remove();
        detailContainer = el("div", "fn-sessions");
        const header = el("div", "fn-subtitle");
        header.textContent = `${verdict} sessions (${sessions.length}):`;
        detailContainer.appendChild(header);
        for (const s of sessions) {
          const item = el("div", "fn-session-item");
          const idSpan = el("span", "");
          idSpan.textContent = `${s.sessionId.slice(0, 16)} `;
          item.appendChild(idSpan);
          const sumSpan = el("span", "");
          sumSpan.style.cssText = "font-family:var(--tv-font);color:var(--tv-text-secondary);";
          sumSpan.textContent = s.analysis.summary;
          item.appendChild(sumSpan);
          detailContainer.appendChild(item);
        }
        overviewSection.appendChild(detailContainer);
      });
      verdictBar.appendChild(seg);
    }
    overviewSection.appendChild(verdictBar);

    const legend = el("div", "fn-legend");
    for (const [v, color] of Object.entries(VERDICT_COLORS)) {
      if (!verdicts[v]?.length) continue;
      const item = el("span", "");
      item.innerHTML = `<span class="fn-dot" style="background:${color}"></span>`;
      const txt = document.createTextNode(`${v} (${verdicts[v].length})`);
      item.appendChild(txt);
      legend.appendChild(item);
    }
    overviewSection.appendChild(legend);
    container.appendChild(overviewSection);

    // --- Root Causes ---
    const causeCounts = new Map<string, AnalyzedSession[]>();
    for (const s of analyzed) {
      const cause = s.analysis.rootCause ?? "unspecified";
      if (!causeCounts.has(cause)) causeCounts.set(cause, []);
      causeCounts.get(cause)!.push(s);
    }
    const sortedCauses = [...causeCounts.entries()].sort((a, b) => b[1].length - a[1].length);

    if (sortedCauses.length > 0) {
      const causeSection = el("div", "fn-section");
      const causeTitle = el("div", "fn-title");
      causeTitle.textContent = "Failure Root Causes";
      causeSection.appendChild(causeTitle);

      const maxCount = sortedCauses[0][1].length;
      let causeDetailEl: HTMLElement | null = null;

      for (const [cause, sessions] of sortedCauses) {
        const row = el("div", "fn-cause");

        const count = el("span", "fn-cause-count");
        count.textContent = String(sessions.length);
        row.appendChild(count);

        const name = el("span", "fn-cause-name");
        name.textContent = cause;
        row.appendChild(name);

        const barWrap = el("span", "fn-cause-bar");
        const barInner = el("div", "fn-cause-bar-inner");
        barInner.style.width = `${(sessions.length / maxCount) * 100}%`;
        barWrap.appendChild(barInner);
        row.appendChild(barWrap);

        row.addEventListener("click", () => {
          if (causeDetailEl) causeDetailEl.remove();
          causeDetailEl = el("div", "fn-sessions");
          const hdr = el("div", "fn-subtitle");
          hdr.textContent = `"${cause}" (${sessions.length} sessions):`;
          causeDetailEl.appendChild(hdr);
          for (const s of sessions) {
            const item = el("div", "fn-session-item");
            const idSpan = el("span", "");
            idSpan.textContent = `${s.sessionId.slice(0, 16)} `;
            item.appendChild(idSpan);
            const sumSpan = el("span", "");
            sumSpan.style.cssText = "font-family:var(--tv-font);color:var(--tv-text-secondary);";
            sumSpan.textContent = s.analysis.summary;
            item.appendChild(sumSpan);
            causeDetailEl.appendChild(item);
          }
          causeSection.appendChild(causeDetailEl);
        });

        causeSection.appendChild(row);
      }
      container.appendChild(causeSection);
    }

    // --- Common Recommendations ---
    const recCounts = new Map<string, number>();
    const recSessions = new Map<string, string[]>();
    for (const s of analyzed) {
      for (const rec of s.analysis.recommendations ?? []) {
        recCounts.set(rec, (recCounts.get(rec) ?? 0) + 1);
        if (!recSessions.has(rec)) recSessions.set(rec, []);
        recSessions.get(rec)!.push(s.sessionId);
      }
    }
    const sortedRecs = [...recCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

    if (sortedRecs.length > 0) {
      const recSection = el("div", "fn-section");
      const recTitle = el("div", "fn-title");
      recTitle.textContent = "What We Learned (Recurring Recommendations)";
      recSection.appendChild(recTitle);

      for (const [rec, count] of sortedRecs) {
        const row = el("div", "fn-rec");
        const cnt = el("span", "fn-rec-count");
        cnt.textContent = `${count}x`;
        row.appendChild(cnt);
        const txt = el("span", "");
        txt.textContent = rec;
        row.appendChild(txt);
        recSection.appendChild(row);
      }
      container.appendChild(recSection);
    }

    // --- Common Failure Patterns ---
    const failReasons = new Map<string, number>();
    for (const s of analyzed) {
      for (const reason of s.analysis.failureReasons ?? []) {
        failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
      }
    }
    const sortedFailures = [...failReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    if (sortedFailures.length > 0) {
      const failSection = el("div", "fn-section");
      const failTitle = el("div", "fn-title");
      failTitle.textContent = "Common Failure Patterns";
      failSection.appendChild(failTitle);

      for (const [reason, count] of sortedFailures) {
        const row = el("div", "fn-rec");
        const cnt = el("span", "fn-rec-count");
        cnt.textContent = `${count}x`;
        row.appendChild(cnt);
        const txt = el("span", "");
        txt.textContent = reason;
        row.appendChild(txt);
        failSection.appendChild(row);
      }
      container.appendChild(failSection);
    }

    // --- Tag Cloud ---
    const tagCounts = new Map<string, number>();
    for (const s of analyzed) {
      for (const tag of s.analysis.tags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

    if (sortedTags.length > 0) {
      const tagSection = el("div", "fn-section");
      const tagTitle = el("div", "fn-title");
      tagTitle.textContent = "Tag Cloud";
      tagSection.appendChild(tagTitle);

      const maxTag = sortedTags[0][1];
      const cloud = el("div", "fn-tags");
      for (const [tag, count] of sortedTags) {
        const t = el("span", "fn-tag");
        const scale = 0.8 + (count / maxTag) * 0.8;
        t.style.fontSize = `${Math.round(11 * scale)}px`;
        if (count / maxTag > 0.5) t.style.cssText += "border-color:var(--tv-accent);color:var(--tv-accent);font-weight:700;";
        t.textContent = `${tag} (${count})`;
        t.title = `${tag}: appears in ${count} sessions`;
        cloud.appendChild(t);
      }
      tagSection.appendChild(cloud);
      container.appendChild(tagSection);
    }

    // --- Strengths ---
    const strengthCounts = new Map<string, number>();
    for (const s of analyzed) {
      for (const str of s.analysis.strengths ?? []) {
        strengthCounts.set(str, (strengthCounts.get(str) ?? 0) + 1);
      }
    }
    const sortedStrengths = [...strengthCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    if (sortedStrengths.length > 0) {
      const strSection = el("div", "fn-section");
      const strTitle = el("div", "fn-title");
      strTitle.textContent = "Recurring Strengths";
      strSection.appendChild(strTitle);

      for (const [str, count] of sortedStrengths) {
        const row = el("div", "fn-rec");
        const cnt = el("span", "fn-rec-count");
        cnt.textContent = `${count}x`;
        cnt.style.color = "#48bb78";
        row.appendChild(cnt);
        const txt = el("span", "");
        txt.textContent = str;
        row.appendChild(txt);
        strSection.appendChild(row);
      }
      container.appendChild(strSection);
    }
  },
};

