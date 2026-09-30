/**
 * Insights — full-page view of all data-backed takeaways.
 *
 * Two style toggles share the same buildTakeaways() output, just
 * skinned differently:
 *
 *   - Cards (default) — visually rich: each finding becomes its own card
 *       with a colored numbered badge, accented action block, pill
 *       strips, and a contained items panel. Best for reading findings
 *       as standalone reports.
 *   - Text — strip the chrome down to a clean text-and-spacing layout
 *       for users who prefer to skim raw text.
 *
 * The takeaway HTML structure is identical across all three; only the
 * outer/inner CSS classes change. That keeps buildTakeaways simple and
 * lets us add more skins later without touching the data layer.
 */

import { Trajectory } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";
import { buildTakeaways } from "./dashboard-v2";

type InsightsStyle = "cards" | "text";
const STYLE_KEY = "tv-insights-style";
function readStyle(): InsightsStyle {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (v === "cards" || v === "text") return v;
    // Migrate older saved values to the new defaults: spacious → text,
    // compact → cards (since cards is now the default and the compact
    // density isn't offered anymore).
    if (v === "spacious") return "text";
    if (v === "compact") return "cards";
  } catch { /* ignore */ }
  return "cards";
}
function writeStyle(s: InsightsStyle) {
  try { localStorage.setItem(STYLE_KEY, s); } catch { /* quota */ }
}

const CSS = `
.insights { font-family: var(--tv-font); padding: 16px 12px; max-width: 1200px; margin: 0 auto; }
.insights-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.insights-title-block { flex: 1; min-width: 0; }
.insights-header {
  font-size: 22px; font-weight: 700; color: var(--tv-text);
  margin-bottom: 6px;
}
.insights-sub {
  font-size: 13px; color: var(--tv-text-secondary); margin-bottom: 18px;
  line-height: 1.5; max-width: 800px;
}
.insights-style-toggle {
  display: flex; gap: 4px; flex-shrink: 0; margin-top: 4px;
}
.insights-style-btn {
  padding: 4px 10px; font-size: 11px;
  border: 1px solid var(--tv-border); border-radius: 3px;
  background: var(--tv-bg); color: var(--tv-text-secondary);
  cursor: pointer; font-family: inherit;
}
.insights-style-btn:hover { background: var(--tv-bg-hover); color: var(--tv-text); }
.insights-style-active, .insights-style-active:hover {
  background: var(--tv-accent); color: #fff; border-color: var(--tv-accent);
}
.insights-empty {
  padding: 60px 20px; text-align: center; color: var(--tv-text-muted);
  background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-radius: var(--tv-radius); font-size: 14px;
}

/* ─── Spacious mode — text bigger, more padding ───────────────────── */
.insights .dv2-takeaways-fullpage.style-text {
  border-left-width: 6px;
  padding: 18px 24px;
}
.insights .dv2-takeaways-fullpage.style-text .dv2-takeaways-list { gap: 18px; padding-left: 30px; }
.insights .dv2-takeaways-fullpage.style-text .dv2-takeaway-fact { font-size: 15px; }
.insights .dv2-takeaways-fullpage.style-text .dv2-takeaway-action { font-size: 13px; line-height: 1.6; margin-top: 6px; }
.insights .dv2-takeaways-fullpage.style-text .dv2-takeaway-strip { font-size: 12px; padding: 6px 10px; }
.insights .dv2-takeaways-fullpage.style-text .dv2-takeaway-items { padding: 10px 14px; }
.insights .dv2-takeaways-fullpage.style-text .dv2-takeaway-items-list li { font-size: 13px; padding: 3px 0; }

/* ─── Cards mode — visually rich, each finding stands alone ─────── */
.insights .dv2-takeaways-fullpage.style-cards {
  background: transparent; border: none; padding: 0; margin: 0;
}
.insights .style-cards .dv2-takeaways-head {
  background: var(--tv-bg-card); border: 1px solid var(--tv-border);
  border-left: 4px solid #f7b731; border-radius: var(--tv-radius);
  padding: 14px 20px; margin-bottom: 16px;
}
.insights .style-cards .dv2-takeaways-list {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 14px;
}
.insights .style-cards .dv2-takeaway {
  position: relative;
  background: var(--tv-bg-card);
  border: 1px solid var(--tv-border);
  border-left: 4px solid #f7b731;
  border-radius: var(--tv-radius);
  padding: 18px 22px 18px 64px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.insights .style-cards .dv2-takeaway:hover {
  border-color: var(--tv-accent);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}
/* Numbered badge in a colored circle (uses CSS counter so we don't
 * need to thread a number through buildTakeaways). */
.insights .style-cards .dv2-takeaways-list { counter-reset: insight-counter; }
.insights .style-cards .dv2-takeaway::before {
  counter-increment: insight-counter;
  content: counter(insight-counter);
  position: absolute; left: 16px; top: 16px;
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f7b731 0%, #ed8936 100%);
  color: #1a1a1a; font-weight: 800; font-size: 14px;
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(247, 183, 49, 0.35);
}
.insights .style-cards .dv2-takeaway-fact {
  font-size: 16px; line-height: 1.55; color: var(--tv-text);
  font-weight: 500;
}
.insights .style-cards .dv2-takeaway-fact strong { color: #fff; font-weight: 800; }
.insights .style-cards .dv2-takeaway-action {
  margin-top: 12px; padding: 10px 14px;
  background: rgba(247, 183, 49, 0.08);
  border-left: 3px solid #f7b731;
  border-radius: 0 4px 4px 0;
  font-size: 13px; color: var(--tv-text-secondary); line-height: 1.55;
}
.insights .style-cards .dv2-takeaway-arrow { color: #f7b731; font-size: 16px; font-weight: 800; }
/* Trend + by-model strips become labeled pill rows */
.insights .style-cards .dv2-takeaway-strip {
  margin-top: 10px; padding: 8px 14px;
  border-radius: 6px; border-left-width: 4px;
  font-size: 12.5px; font-family: var(--tv-mono);
}
.insights .style-cards .dv2-takeaway-strip-trend {
  background: linear-gradient(90deg, rgba(79, 143, 247, 0.18), rgba(79, 143, 247, 0.04));
  border-left-color: #4f8ff7;
}
.insights .style-cards .dv2-takeaway-strip-model {
  background: linear-gradient(90deg, rgba(72, 187, 120, 0.18), rgba(72, 187, 120, 0.04));
  border-left-color: #48bb78;
}
.insights .style-cards .dv2-takeaway-strip-label {
  background: rgba(255, 255, 255, 0.08);
  font-size: 9.5px; padding: 2px 7px;
}
.insights .style-cards .dv2-takeaway-trend-arrow {
  font-size: 15px; color: #fff;
}
.insights .style-cards .dv2-takeaway-items {
  margin-top: 14px; padding: 12px 16px;
  background: var(--tv-bg);
  border: 1px solid var(--tv-border);
  border-radius: 6px;
}
.insights .style-cards .dv2-takeaway-items-title {
  font-size: 10px; letter-spacing: 0.6px;
  color: #f7b731; margin-bottom: 8px;
}
.insights .style-cards .dv2-takeaway-items-list li {
  font-size: 13px; padding: 5px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
}
.insights .style-cards .dv2-takeaway-items-list li:last-child { border-bottom: none; }
.insights .style-cards .dv2-takeaway-item-meta {
  font-weight: 700; color: var(--tv-accent);
}
/* "More" expandable suppressed in Cards mode since limit is unlimited;
 * keep this just in case it ever fires. */
.insights .style-cards .dv2-takeaways-more {
  margin-top: 14px; border-top: none; padding-top: 0;
}
`;

export const dashboardV3View: TrajectoryView = {
  id: "insights",
  name: "Insights",
  description: "All data-backed takeaways for the selected sessions, with trend and per-model splits.",
  icon: "★",
  tier: "core",
  css: CSS,
  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    container.classList.add("insights");
    container.innerHTML = "";

    let style = readStyle();

    const top = document.createElement("div");
    top.className = "insights-top";

    const titleBlock = document.createElement("div");
    titleBlock.className = "insights-title-block";

    const header = document.createElement("div");
    header.className = "insights-header";
    header.textContent = "Insights";
    titleBlock.appendChild(header);

    const sub = document.createElement("div");
    sub.className = "insights-sub";
    sub.textContent = trajectories.length === 0
      ? "Pick one or more sessions to see takeaways."
      : trajectories.length === 1
      ? "All findings for this session, in priority order. Each one is computed from your actual events; trend strips compare halves of the session, by-model strips compare per primary model."
      : `All findings across ${trajectories.length} sessions, in priority order. Each one is computed from your actual events; trend strips compare the earlier half of the selection vs the later half, by-model strips compare per primary model.`;
    titleBlock.appendChild(sub);

    top.appendChild(titleBlock);

    // Style toggle (Compact / Spacious / Cards)
    const toggle = document.createElement("div");
    toggle.className = "insights-style-toggle";

    function renderToggle() {
      toggle.innerHTML = "";
      const opts: { id: InsightsStyle; label: string; title: string }[] = [
        { id: "cards", label: "Cards", title: "Visually rich — each finding gets its own card with a numbered badge, accent strip, and pill strips" },
        { id: "text", label: "Text", title: "Strip the chrome — plain, larger-font text for fast reading" },
      ];
      for (const opt of opts) {
        const btn = document.createElement("button");
        btn.className = "insights-style-btn" + (style === opt.id ? " insights-style-active" : "");
        btn.textContent = opt.label;
        btn.title = opt.title;
        btn.onclick = () => {
          if (style === opt.id) return;
          style = opt.id;
          writeStyle(opt.id);
          renderToggle();
          renderCard();
        };
        toggle.appendChild(btn);
      }
    }
    renderToggle();
    top.appendChild(toggle);
    container.appendChild(top);

    if (trajectories.length === 0) {
      const empty = document.createElement("div");
      empty.className = "insights-empty";
      empty.textContent = "No sessions selected.";
      container.appendChild(empty);
      return;
    }

    const cardHost = document.createElement("div");
    cardHost.className = "insights-card-host";
    container.appendChild(cardHost);

    function renderCard() {
      cardHost.innerHTML = "";
      const card = buildTakeaways(trajectories, {
        limit: Infinity,
        fullPage: true,
      });
      if (card) {
        // Each style is opt-in via a CSS class on the card root.
        if (style === "text") card.classList.add("style-text");
        else card.classList.add("style-cards");
        cardHost.appendChild(card);
      } else {
        const empty = document.createElement("div");
        empty.className = "insights-empty";
        empty.textContent = "Not enough data in this selection to surface findings yet. Pick more sessions or run a longer one.";
        cardHost.appendChild(empty);
      }
    }
    renderCard();
  },
};
