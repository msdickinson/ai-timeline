/**
 * AI Calls View — per-model breakdown with clickable bar chart.
 * Shows: total tokens, per-request t/s, output t/s, cache hit %, compactions.
 * Each call is a bar — click to inspect details.
 */

import { Trajectory, TrajectoryEvent, getSessionLabel } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

interface CallData {
  index: number;
  event: TrajectoryEvent;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  tps: number;
  model: string;
}

export const aiCallsView: TrajectoryView = {
  id: "ai-calls",
  name: "AI Calls",
  description: "Per-model token usage, throughput, and call-by-call bar chart",
  // U+FE0E (Variation Selector-15) forces text-style rendering of the
  // lightning bolt instead of color emoji, which is how every other
  // view's Unicode glyph renders in the tab bar / dropdown.
  icon: "\u26A1\uFE0E",
  tier: "standard",
  requires: ["tokens"],

  css: `
    .tac { font-family: var(--tv-font); }
    .tac-session-selector { display: flex; align-items: center; gap: 8px; padding: 10px 0; }
    .tac-session-picker { position: relative; }
    .tac-session-picker-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px; font-size: 12px;
      background: var(--tv-bg-card); color: var(--tv-text);
      border: 1px solid var(--tv-border); border-radius: 4px;
      font-family: inherit; cursor: pointer; min-width: 280px;
      justify-content: space-between;
    }
    .tac-session-picker-btn:hover { border-color: var(--tv-accent, #58a6ff); }
    .tac-session-picker-current { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tac-session-picker-caret { color: var(--tv-text-muted); font-size: 10px; }
    .tac-session-picker-popup {
      position: absolute; top: 100%; left: 0; z-index: 100; margin-top: 4px;
      width: 360px; max-width: 90vw;
      background: var(--tv-bg-card); border: 1px solid var(--tv-border);
      border-radius: 6px; box-shadow: 0 12px 32px rgba(0,0,0,0.4);
      display: flex; flex-direction: column;
    }
    .tac-session-picker-popup.tac-hidden { display: none; }
    .tac-session-picker-search {
      width: 100%; box-sizing: border-box;
      padding: 8px 10px; font-size: 12px;
      background: var(--tv-bg); color: var(--tv-text);
      border: 0; border-bottom: 1px solid var(--tv-border);
      font-family: inherit; outline: none;
    }
    .tac-session-picker-list {
      max-height: 320px; overflow-y: auto;
    }
    /* Virtualized list: spacer sets total scroll height; rows are
       absolutely positioned so we can render only the visible window. */
    .tac-session-picker-virt { position: relative; }
    .tac-session-picker-rows {
      position: absolute; top: 0; left: 0; right: 0; pointer-events: none;
    }
    .tac-session-picker-row {
      position: absolute; left: 0; right: 0; height: 26px;
      padding: 4px 12px; font-size: 12px; cursor: pointer;
      color: var(--tv-text); pointer-events: auto;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      box-sizing: border-box;
      display: flex; align-items: center;
    }
    .tac-session-picker-row:hover { background: var(--tv-bg-hover); }
    .tac-session-picker-row-active {
      background: var(--tv-accent, #58a6ff); color: #fff;
    }
    .tac-session-picker-empty,
    .tac-session-picker-more {
      padding: 8px 12px; font-size: 11px;
      color: var(--tv-text-muted); font-style: italic;
    }
    .tac-session-dropdown {
      padding: 4px 8px; font-size: 12px; border: 1px solid var(--tv-border); border-radius: 4px;
      background: var(--tv-bg-card); color: var(--tv-text); font-family: var(--tv-font); cursor: pointer;
    }
    .tac-session-header {
      padding: 8px 12px; font-size: 13px; font-weight: 700; color: var(--tv-text);
      background: color-mix(in srgb, var(--tv-accent) 12%, var(--tv-bg-card));
      border-bottom: 2px solid var(--tv-accent);
      border-radius: var(--tv-radius) var(--tv-radius) 0 0;
      margin-top: 16px;
    }
    .tac-summary {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      padding: 16px 0;
      font-size: 13px;
      color: var(--tv-text-secondary);
      border-bottom: 1px solid var(--tv-border);
      margin-bottom: 16px;
    }
    .tac-summary strong { color: var(--tv-text); font-size: 15px; }
    .tac-summary .tac-green { color: #48bb78; }
    .tac-summary .tac-orange { color: #ed8936; }
    .tac-summary .tac-red { color: #fc5c65; }

    .tac-model {
      background: var(--tv-bg-card);
      border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius);
      padding: 16px 20px;
      margin-bottom: 16px;
      /* Skip layout/paint for off-screen model cards. Each card is roughly
         ~520px tall (header + stats + 600-bar chart + axis); the browser
         uses this as the placeholder size until the card scrolls in. */
      content-visibility: auto;
      contain-intrinsic-size: 1px 520px;
    }
    /* Wrapper for an entire session's sections in by-session mode — same
       trick at a coarser granularity for 1145-session multi-select. */
    .tac-session-block {
      content-visibility: auto;
      contain-intrinsic-size: 1px 700px;
    }
    .tac-model-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .tac-model-name { font-size: 18px; font-weight: 700; font-family: var(--tv-mono); }
    .tac-model-count { font-size: 14px; color: var(--tv-text-secondary); }
    .tac-model-tokens { font-size: 13px; color: var(--tv-text-secondary); font-family: var(--tv-mono); }
    .tac-model-stats {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--tv-text-secondary);
      margin-bottom: 12px;
    }
    .tac-stat-label { color: var(--tv-text-muted); }
    .tac-stat-avg { font-weight: 600; }
    .tac-stat-p95 { color: #ed8936; font-weight: 600; }
    .tac-stat-max { color: #fc5c65; font-weight: 600; }
    .tac-stat-tps { color: #4f8ff7; font-weight: 600; }

    .tac-chart-label {
      font-size: 11px;
      color: var(--tv-text-muted);
      margin-bottom: 6px;
    }
    .tac-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 80px;
      padding: 0;
      position: relative;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
    }
    .tac-chart::-webkit-scrollbar { height: 6px; }
    .tac-chart::-webkit-scrollbar-thumb { background: var(--tv-border); border-radius: 3px; }
    .tac-bar {
      flex: 0 0 4px;
      min-width: 4px;
      max-width: 16px;
      border-radius: 2px 2px 0 0;
      cursor: pointer;
      transition: opacity 0.1s;
      position: relative;
    }
    .tac-bar:hover { opacity: 0.8; }
    .tac-bar.tac-bar-selected { outline: 2px solid var(--tv-text); outline-offset: 1px; }
    .tac-bar-cached {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      border-radius: 0;
      background: #48bb78;
    }
    .tac-chart-axis {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      font-family: var(--tv-mono);
      margin-top: 2px;
    }
    .tac-chart-axis-first { color: #ed8936; }
    .tac-chart-axis-last { color: var(--tv-text-muted); }
    .tac-chart-legend {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      font-size: 10px;
      color: var(--tv-text-muted);
      margin-top: 4px;
    }
    .tac-chart-legend-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      margin-right: 3px;
    }
    .tac-mode-tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 8px;
    }
    .tac-mode-tab {
      padding: 3px 10px;
      font-size: 11px;
      border: 1px solid var(--tv-border);
      border-radius: 3px;
      background: var(--tv-bg);
      color: var(--tv-text-secondary);
      cursor: pointer;
    }
    .tac-mode-tab:hover { background: var(--tv-bg-hover); }
    .tac-mode-tab.tac-mode-active { background: var(--tv-accent); color: #fff; border-color: var(--tv-accent); }

    .tac-inspect {
      background: var(--tv-bg-card);
      border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius-sm);
      padding: 12px 20px;
      margin-top: 12px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
      line-height: 1.6;
    }
    .tac-inspect-nav { font-weight: 600; white-space: nowrap; }
    .tac-inspect strong { color: var(--tv-text); }
    .tac-inspect .tac-green { color: #48bb78; }
    .tac-inspect-btn {
      padding: 2px 8px;
      border: 1px solid var(--tv-border);
      border-radius: 3px;
      background: var(--tv-bg-card);
      color: var(--tv-text);
      cursor: pointer;
      font-size: 11px;
    }
    .tac-inspect-msg-btn {
      padding: 5px 12px;
      border: 1px solid var(--tv-border);
      border-radius: 4px;
      background: var(--tv-bg-card);
      color: var(--tv-text);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tac-inspect-msg-btn:hover {
      background: var(--tv-bg-hover);
      border-color: var(--tv-accent, #58a6ff);
    }
    .tac-inspect-wrap { }

    .tac-messages {
      border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius);
      margin-top: 8px;
      max-height: 400px;
      overflow-y: auto;
      background: var(--tv-bg);
    }
    .tac-msg {
      padding: 8px 14px;
      border-bottom: 1px solid var(--tv-border);
      font-size: 12px;
    }
    .tac-msg:last-child { border-bottom: none; }
    .tac-msg-highlight { background: color-mix(in srgb, var(--tv-accent) 8%, transparent); border-left: 3px solid var(--tv-accent); }
    .tac-msg-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    }
    .tac-msg-role {
      display: inline-block; padding: 1px 6px; border-radius: 3px;
      font-size: 9px; font-weight: 700; text-transform: uppercase;
    }
    .tac-msg-role-assistant { background: #4f8ff7; color: #fff; }
    .tac-msg-role-user { background: #48bb78; color: #fff; }
    .tac-msg-tool { font-family: var(--tv-mono); font-size: 11px; font-weight: 600; color: var(--tv-text); }
    .tac-msg-current { background: var(--tv-accent); color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; }
    .tac-msg-time { font-size: 10px; color: var(--tv-text-muted); font-family: var(--tv-mono); margin-left: auto; }
    .tac-msg-body {
      font-family: var(--tv-mono); font-size: 11px; color: var(--tv-text-secondary);
      white-space: pre-wrap; word-break: break-word; max-height: 150px; overflow-y: auto;
      line-height: 1.5;
    }
    .tac-msg-empty { padding: 16px; text-align: center; color: var(--tv-text-muted); font-size: 12px; }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("tac");

    const isMulti = trajectories.length > 1;

    const sessionLabels = trajectories.map((t, i) => getSessionLabel(t, i));

    // Build per-trajectory call data
    const perSession: { label: string; calls: CallData[]; events: TrajectoryEvent[] }[] = [];
    let globalIdx = 0;
    for (let si = 0; si < trajectories.length; si++) {
      const traj = trajectories[si];
      const aiEvents = traj.events.filter(e => e.type === "message" && e.role === "assistant" && e.tokens);
      const calls: CallData[] = aiEvents.map((e) => {
        const t = e.tokens!;
        const input = t.input ?? 0; // Total input tokens (includes cached)
        const output = t.output ?? 0;
        const cached = t.cacheRead ?? 0; // Subset of input that was cached
        const total = input + output; // Don't double-count cached (it's part of input)
        const durationMs = e.durationMs ?? 0;
        const tps = durationMs > 0 ? output / (durationMs / 1000) : 0;
        return { index: globalIdx++, event: e, tokens: total, inputTokens: input, outputTokens: output, cachedTokens: cached, durationMs, tps, model: e.model ?? "unknown" };
      });
      perSession.push({ label: sessionLabels[si], calls, events: traj.events });
    }

    const allCalls = perSession.flatMap(s => s.calls);
    if (allCalls.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--tv-text-muted)">No AI calls with token data in this session</div>';
      return;
    }

    // Mode: "combined" = all mixed, "by-session" = all shown separately, or index for single session
    let viewMode: "combined" | "by-session" | number = "combined";

    // Session picker for multi-session view. With 1000+ sessions the
    // native <select> opens slowly \u2014 the browser renders ALL options
    // even before the user can interact. We render a custom button +
    // searchable popup that only materialises the (max 60) currently-
    // matching rows.
    if (isMulti) {
      const selectorRow = el("div", "tac-session-selector");
      const label = el("span", "");
      label.textContent = "View: ";
      label.style.cssText = "font-size:12px;font-weight:600;color:var(--tv-text-secondary)";
      selectorRow.appendChild(label);

      const optionList: Array<{ value: "combined" | "by-session" | number; label: string }> = [
        { value: "combined", label: `All \u2014 Combined (${allCalls.length.toLocaleString()} calls)` },
        { value: "by-session", label: `All \u2014 By Session` },
      ];
      for (let si = 0; si < perSession.length; si++) {
        optionList.push({
          value: si,
          label: `${sessionLabels[si]} (${perSession[si].calls.length.toLocaleString()} calls)`,
        });
      }

      const picker = el("div", "tac-session-picker");
      const btn = document.createElement("button");
      btn.className = "tac-session-picker-btn";
      btn.type = "button";
      function btnLabel() {
        return optionList.find(o => o.value === viewMode)?.label ?? optionList[0].label;
      }
      // Use textContent for the current-label span so we don't need an HTML
      // escape helper. innerHTML for the caret only (it's a static glyph).
      btn.innerHTML = `<span class="tac-session-picker-current"></span><span class="tac-session-picker-caret">\u25be</span>`;
      btn.querySelector(".tac-session-picker-current")!.textContent = btnLabel();

      const popup = document.createElement("div");
      popup.className = "tac-session-picker-popup tac-hidden";

      const search = document.createElement("input");
      search.className = "tac-session-picker-search";
      search.type = "text";
      search.placeholder = `Search ${optionList.length.toLocaleString()} sessions\u2026`;

      // Virtualized list \u2014 only the rows currently in the viewport are
      // mounted, even when the full filtered set is thousands of items.
      // Uses one absolute-positioned spacer to set total scroll height;
      // visible rows are positioned by `top: <rowIndex * ROW_HEIGHT>px`.
      const listEl = document.createElement("div");
      listEl.className = "tac-session-picker-list tac-session-picker-virt";

      const ROW_HEIGHT = 26; // px \u2014 must match CSS height of .tac-session-picker-row

      const spacer = el("div", "tac-session-picker-spacer");
      const rowsHost = el("div", "tac-session-picker-rows");
      listEl.appendChild(spacer);
      listEl.appendChild(rowsHost);

      let filtered: typeof optionList = optionList;

      // Row pool — pre-allocate a fixed set of row elements once and keep
      // reusing them. The previous "innerHTML="" + recreate" approach was
      // racing the scroll on fast wheel scrolls (you'd see blank space for
      // a frame or two until the new rows mounted). Pooling means each
      // scroll frame only touches text + top + class on existing nodes.
      const OVERSCAN = 12; // rows above/below viewport — bigger overscan = fewer empty frames during fast scroll
      const VIEWPORT_ROWS = Math.ceil(320 / ROW_HEIGHT); // CSS max-height
      const POOL_SIZE = VIEWPORT_ROWS + OVERSCAN * 2;
      type PoolRow = { el: HTMLElement; idx: number };
      const pool: PoolRow[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        const row = el("div", "tac-session-picker-row");
        row.style.display = "none";
        // Single delegated handler — reads index off the row at click time
        // so we don't have to rebind on every scroll.
        row.onclick = () => {
          const idx = (row as HTMLElement & { _vidx?: number })._vidx ?? -1;
          const opt = filtered[idx];
          if (!opt) return;
          viewMode = opt.value;
          popup.classList.add("tac-hidden");
          btn.querySelector(".tac-session-picker-current")!.textContent = btnLabel();
          renderContent();
        };
        rowsHost.appendChild(row);
        pool.push({ el: row, idx: -1 });
      }

      const emptyEl = el("div", "tac-session-picker-empty");
      emptyEl.style.display = "none";
      rowsHost.appendChild(emptyEl);

      function applyFilter() {
        const q = search.value.trim().toLowerCase();
        filtered = q
          ? optionList.filter(o => o.label.toLowerCase().includes(q))
          : optionList;
        spacer.style.height = `${filtered.length * ROW_HEIGHT}px`;
        listEl.scrollTop = 0;
        renderWindow();
      }

      function renderWindow() {
        const total = filtered.length;
        if (total === 0) {
          for (const p of pool) p.el.style.display = "none";
          spacer.style.height = "0";
          emptyEl.textContent = `No sessions match "${search.value}"`;
          emptyEl.style.display = "";
          return;
        }
        emptyEl.style.display = "none";

        const viewportH = listEl.clientHeight || 320;
        const start = Math.max(0, Math.floor(listEl.scrollTop / ROW_HEIGHT) - OVERSCAN);
        const end = Math.min(total, start + POOL_SIZE);

        for (let i = 0; i < POOL_SIZE; i++) {
          const idx = start + i;
          const p = pool[i];
          if (idx >= end) {
            p.el.style.display = "none";
            p.idx = -1;
            continue;
          }
          const opt = filtered[idx];
          const isActive = opt.value === viewMode;
          if (p.idx !== idx) {
            // Only update DOM when this slot needs a different row
            p.el.style.display = "";
            p.el.style.top = `${idx * ROW_HEIGHT}px`;
            p.el.textContent = opt.label;
            p.el.className = "tac-session-picker-row" + (isActive ? " tac-session-picker-row-active" : "");
            (p.el as HTMLElement & { _vidx?: number })._vidx = idx;
            p.idx = idx;
          } else {
            // Same row — only re-evaluate the active state (cheap)
            const wantActive = "tac-session-picker-row" + (isActive ? " tac-session-picker-row-active" : "");
            if (p.el.className !== wantActive) p.el.className = wantActive;
          }
        }
        // Suppress viewportH-unused warning
        void viewportH;
      }

      const renderList = applyFilter;
      // Render synchronously on scroll. Scroll events are already throttled
      // to one-per-frame by the browser; using rAF on top of that adds a
      // frame of latency for no benefit — that's what was producing the
      // empty-space-then-pop visual.
      listEl.onscroll = () => renderWindow();

      search.oninput = renderList;
      btn.onclick = (e) => {
        e.stopPropagation();
        const opening = popup.classList.contains("tac-hidden");
        popup.classList.toggle("tac-hidden");
        if (opening) {
          renderList();
          search.value = "";
          search.focus();
        }
      };
      popup.onclick = (e) => e.stopPropagation();
      // Close on outside click
      document.addEventListener("click", () => popup.classList.add("tac-hidden"));

      popup.appendChild(search);
      popup.appendChild(listEl);
      picker.appendChild(btn);
      picker.appendChild(popup);
      selectorRow.appendChild(picker);
      container.appendChild(selectorRow);
    }

    const contentArea = el("div", "");
    container.appendChild(contentArea);

    function renderSummaryAndModels(calls: CallData[], events: TrajectoryEvent[], target: HTMLElement = contentArea) {
      const totalTokens = calls.reduce((s, c) => s + c.tokens, 0);
      const totalInput = calls.reduce((s, c) => s + c.inputTokens, 0);
      const totalOutput = calls.reduce((s, c) => s + c.outputTokens, 0);
      const totalCached = calls.reduce((s, c) => s + c.cachedTokens, 0);
      const avgTps = calls.filter((c) => c.tps > 0).length > 0
        ? calls.reduce((s, c) => s + c.tps, 0) / calls.filter((c) => c.tps > 0).length
        : 0;
      // Cache hit = share of INPUT tokens that came from cache (cheap)
      // vs fresh input (full price). Anthropic's API reports input_tokens
      // as the FRESH count (excludes cache reads), so the denominator is
      // input + cached, not just input. The old formula divided by input
      // alone and could yield 629048% for long agentic sessions where
      // each turn adds ~50 fresh tokens on top of ~50K cached tokens.
      const cacheHitRate = totalInput + totalCached > 0
        ? (totalCached / (totalInput + totalCached)) * 100
        : 0;
      // Decimal precision when ≥99% so the difference between 99.4% and
      // a true 100% (which is essentially never reached) is visible.
      const cacheHitStr = cacheHitRate >= 99 && cacheHitRate < 100
        ? cacheHitRate.toFixed(1) + "%"
        : Math.round(cacheHitRate) + "%";

      const summary = el("div", "tac-summary");
      summary.innerHTML = `
        <span><strong>${fmt(totalTokens)}</strong> tokens <span style="font-size:11px">(${fmt(totalInput)} in / ${fmt(totalOutput)} out)</span></span>
        <span><strong>${avgTps.toFixed(1)}</strong> per-request t/s</span>
        <span class="tac-green"><strong>${fmt(totalOutput)}</strong> output t/s</span>
        <span class="tac-green" title="Share of input tokens billed at the cheaper cache-read rate. Long agentic sessions naturally sit at 99%+ because each turn just adds tokens to a huge cached prompt."><strong>${cacheHitStr}</strong> cache hit</span>
      `;
      target.appendChild(summary);

      const models = [...new Set(calls.map((c) => c.model))];
      for (const model of models) {
        const modelCalls = calls.filter((c) => c.model === model);
        target.appendChild(renderModelSection(model, modelCalls, events));
      }
    }

    function renderContent() {
      contentArea.innerHTML = "";

      if (viewMode === "combined" || !isMulti) {
        const activeCalls = allCalls;
        const activeEvents = trajectories.flatMap(t => t.events);
        renderSummaryAndModels(activeCalls, activeEvents);
      } else if (viewMode === "by-session") {
        // Render each session inside a content-visibility:auto block so the
        // browser skips layout/paint for off-screen sessions. With 1145
        // sessions this turns a ~10s scroll lag into instant scrolling.
        for (let si = 0; si < perSession.length; si++) {
          const block = el("div", "tac-session-block");
          const sessHeader = el("div", "tac-session-header");
          sessHeader.textContent = sessionLabels[si];
          block.appendChild(sessHeader);
          renderSummaryAndModels(perSession[si].calls, perSession[si].events, block);
          contentArea.appendChild(block);
        }
      } else {
        const si = viewMode as number;
        renderSummaryAndModels(perSession[si].calls, perSession[si].events);
      }
    }

    renderContent();
  },
};

function renderModelSection(model: string, calls: CallData[], allEvents: TrajectoryEvent[]): HTMLElement {
  const section = el("div", "tac-model");

  const totalTokens = calls.reduce((s, c) => s + c.tokens, 0);
  const durations = calls.map((c) => c.durationMs).filter((d) => d > 0).sort((a, b) => a - b);
  const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0;
  const max = durations.length > 0 ? durations[durations.length - 1] : 0;
  const avgTps = calls.filter((c) => c.tps > 0).length > 0
    ? calls.reduce((s, c) => s + c.tps, 0) / calls.filter((c) => c.tps > 0).length
    : 0;

  // Header
  const header = el("div", "tac-model-header");
  header.innerHTML = `
    <span class="tac-model-name">${escHtml(model)}</span>
    <span class="tac-model-count">${calls.length} calls</span>
    <span class="tac-model-tokens">${fmt(totalTokens)} tokens</span>
  `;
  section.appendChild(header);

  // Stats
  const stats = el("div", "tac-model-stats");
  stats.innerHTML = `
    <span><span class="tac-stat-label">Avg</span> <span class="tac-stat-avg">${fmtDur(avg)}</span></span>
    <span><span class="tac-stat-label">P95</span> <span class="tac-stat-p95">${fmtDur(p95)}</span></span>
    <span><span class="tac-stat-label">Max (single call)</span> <span class="tac-stat-max">${fmtDur(max)}</span></span>
    <span><span class="tac-stat-tps">${avgTps.toFixed(1)} t/s avg</span></span>
  `;
  section.appendChild(stats);

  // Chart mode tabs
  let chartMode: "tokens" | "time" | "cost" = "tokens";
  const modeTabs = el("div", "tac-mode-tabs");

  function renderChart() {
    // Clear previous chart
    const existing = section.querySelector(".tac-chart-wrap");
    if (existing) existing.remove();
    const existingInspect = section.querySelector(".tac-inspect-wrap");
    if (existingInspect) existingInspect.remove();

    // Update tab active states
    modeTabs.querySelectorAll(".tac-mode-tab").forEach((tab) => {
      tab.classList.toggle("tac-mode-active", tab.getAttribute("data-mode") === chartMode);
    });

    const wrap = el("div", "tac-chart-wrap");

    const label = el("div", "tac-chart-label");
    label.textContent = `${model} Call ${chartMode === "tokens" ? "Tokens" : chartMode === "time" ? "Duration" : "Cost"} (1st → ${calls.length}th) — click a bar to inspect`;
    wrap.appendChild(label);

    const chart = el("div", "tac-chart");

    // Bucket when there are too many calls to render legibly (or quickly).
    // 26K individual bars × per-bar onclick handlers absolutely tanks page
    // load. Rendering ~600 bars is instant and fits the screen better.
    const MAX_INDIVIDUAL_BARS = 600;
    const aggregated = calls.length > MAX_INDIVIDUAL_BARS;
    let displayCalls: typeof calls;
    let bucketSize = 1;
    if (aggregated) {
      bucketSize = Math.ceil(calls.length / MAX_INDIVIDUAL_BARS);
      displayCalls = [];
      for (let i = 0; i < calls.length; i += bucketSize) {
        const slice = calls.slice(i, i + bucketSize);
        const avg = (k: keyof CallData) =>
          slice.reduce((s, c) => s + (c[k] as number), 0) / slice.length;
        // Pick a representative call (the one closest to the bucket avg
        // for the active mode) so click-to-inspect still surfaces a real
        // event rather than a synthetic average.
        const targetVal = avg("tokens");
        let representative = slice[0];
        let bestDiff = Math.abs(getVal(slice[0], chartMode) - targetVal);
        for (const c of slice) {
          const d = Math.abs(getVal(c, chartMode) - targetVal);
          if (d < bestDiff) { bestDiff = d; representative = c; }
        }
        displayCalls.push({
          ...representative,
          tokens: avg("tokens"),
          inputTokens: avg("inputTokens"),
          outputTokens: avg("outputTokens"),
          cachedTokens: avg("cachedTokens"),
          durationMs: avg("durationMs"),
          tps: avg("tps"),
        });
      }
      const hint = el("div", "tac-chart-bucket-hint");
      hint.style.cssText = "font-size:11px;color:var(--tv-text-muted);margin:4px 0";
      hint.textContent = `${calls.length.toLocaleString()} calls bucketed into ${displayCalls.length} bars (~${bucketSize} calls per bar). Click a bar to inspect a representative call from that bucket.`;
      wrap.appendChild(hint);
    } else {
      displayCalls = calls;
    }

    const maxVal = Math.max(...displayCalls.map((c) => getVal(c, chartMode)), 1);

    for (const call of displayCalls) {
      const val = getVal(call, chartMode);
      const height = Math.max((val / maxVal) * 100, 2);
      const bar = el("div", "tac-bar");
      bar.style.height = `${height}%`;
      bar.style.background = chartMode === "tokens" ? "#4f8ff7" : chartMode === "time" ? "#ed8936" : "#9f7aea";
      bar.title = aggregated
        ? `~${fmtVal(val, chartMode)} avg · bucket of ~${bucketSize} calls`
        : `#${call.index + 1}: ${fmtVal(val, chartMode)}`;

      // Cached portion overlay for token mode
      if (chartMode === "tokens" && call.cachedTokens > 0 && call.tokens > 0) {
        const cachedPct = (call.cachedTokens / call.tokens) * 100;
        const cachedBar = el("div", "tac-bar-cached");
        cachedBar.style.height = `${cachedPct}%`;
        bar.appendChild(cachedBar);
      }

      bar.onclick = () => {
        // Deselect others
        chart.querySelectorAll(".tac-bar-selected").forEach((b) => b.classList.remove("tac-bar-selected"));
        bar.classList.add("tac-bar-selected");

        // Show inspect panel — even in aggregated mode, `call` carries the
        // representative event so the inspect panel has a real call to show.
        const oldInspect = section.querySelector(".tac-inspect-wrap");
        if (oldInspect) oldInspect.remove();
        section.appendChild(renderInspect(call, calls, allEvents));
      };

      chart.appendChild(bar);
    }

    wrap.appendChild(chart);

    // Axis labels
    const axis = el("div", "tac-chart-axis");
    axis.innerHTML = `
      <span class="tac-chart-axis-first">1st: ${fmtVal(getVal(calls[0], chartMode), chartMode)}</span>
      <span class="tac-chart-axis-last">Last: ${fmtVal(getVal(calls[calls.length - 1], chartMode), chartMode)}</span>
    `;
    wrap.appendChild(axis);

    // Legend
    if (chartMode === "tokens") {
      const legend = el("div", "tac-chart-legend");
      legend.innerHTML = `<span><span class="tac-chart-legend-dot" style="background:#48bb78"></span>cached</span>`;
      wrap.appendChild(legend);
    }

    section.appendChild(wrap);
  }

  for (const mode of ["tokens", "time"] as const) {
    const tab = el("div", `tac-mode-tab ${mode === chartMode ? "tac-mode-active" : ""}`);
    tab.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    tab.setAttribute("data-mode", mode);
    tab.onclick = () => { chartMode = mode; renderChart(); };
    modeTabs.appendChild(tab);
  }
  section.appendChild(modeTabs);

  renderChart();
  return section;
}

function renderInspect(call: CallData, allCalls: CallData[], allEvents: TrajectoryEvent[]): HTMLElement {
  const wrap = el("div", "tac-inspect-wrap");

  const inspect = el("div", "tac-inspect");
  const cachePct = call.inputTokens + call.cachedTokens > 0
    ? ((call.cachedTokens / (call.inputTokens + call.cachedTokens)) * 100).toFixed(0)
    : "0";
  const time = call.event.timestamp ? new Date(call.event.timestamp).toLocaleTimeString() : "";

  const posInList = allCalls.indexOf(call);

  inspect.innerHTML = `
    <span class="tac-inspect-nav">Call #${posInList + 1} of ${allCalls.length}</span>
    <span><strong>${fmtDur(call.durationMs)}</strong></span>
    <span>${escHtml(call.model)}</span>
    <span><strong>${fmt(call.tokens)}</strong> (${fmt(call.inputTokens)} in / ${fmt(call.outputTokens)} out · ${cachePct}% cached)</span>
    <span class="tac-green"><strong>${call.tps.toFixed(1)}</strong> t/s</span>
    <span>${time}</span>
  `;

  // Nav buttons
  const prevBtn = document.createElement("button");
  prevBtn.className = "tac-inspect-btn";
  prevBtn.textContent = "\u2039 Prev";
  prevBtn.disabled = posInList <= 0;
  prevBtn.onclick = () => {
    const bars = wrap.parentElement!.querySelectorAll(".tac-bar");
    bars.forEach((b) => b.classList.remove("tac-bar-selected"));
    if (posInList > 0) {
      bars[posInList - 1]?.classList.add("tac-bar-selected");
      wrap.replaceWith(renderInspect(allCalls[posInList - 1], allCalls, allEvents));
    }
  };

  const nextBtn = document.createElement("button");
  nextBtn.className = "tac-inspect-btn";
  nextBtn.textContent = "Next \u203A";
  nextBtn.disabled = posInList >= allCalls.length - 1;
  nextBtn.onclick = () => {
    const bars = wrap.parentElement!.querySelectorAll(".tac-bar");
    bars.forEach((b) => b.classList.remove("tac-bar-selected"));
    if (posInList < allCalls.length - 1) {
      bars[posInList + 1]?.classList.add("tac-bar-selected");
      wrap.replaceWith(renderInspect(allCalls[posInList + 1], allCalls, allEvents));
    }
  };

  inspect.appendChild(prevBtn);
  inspect.appendChild(nextBtn);

  // Messages toggle button
  const msgBtn = document.createElement("button");
  msgBtn.className = "tac-inspect-msg-btn";
  msgBtn.textContent = "\uD83D\uDCCB Messages";
  let messagesVisible = false;
  let messagesPanel: HTMLElement | null = null;

  msgBtn.onclick = () => {
    if (messagesVisible && messagesPanel) {
      messagesPanel.remove();
      messagesPanel = null;
      messagesVisible = false;
      msgBtn.textContent = "\uD83D\uDCCB Messages";
      return;
    }

    messagesVisible = true;
    msgBtn.textContent = "\uD83D\uDCCB Hide";

    messagesPanel = el("div", "tac-messages");

    // Find context: events between previous AI call and this one (+ this one's response)
    const thisIdx = allEvents.indexOf(call.event);
    const prevCall = posInList > 0 ? allCalls[posInList - 1] : null;
    const prevIdx = prevCall ? allEvents.indexOf(prevCall.event) : -1;
    const startIdx = prevIdx >= 0 ? prevIdx + 1 : Math.max(0, thisIdx - 10);
    const nextCall = posInList < allCalls.length - 1 ? allCalls[posInList + 1] : null;
    const nextIdx = nextCall ? allEvents.indexOf(nextCall.event) : allEvents.length;
    const endIdx = Math.min(nextIdx, thisIdx + 20);

    const contextEvents = allEvents.slice(startIdx, endIdx);

    if (contextEvents.length === 0) {
      const empty = el("div", "tac-msg-empty");
      empty.textContent = "No context messages found";
      messagesPanel.appendChild(empty);
    } else {
      for (const ev of contextEvents) {
        const msg = el("div", "tac-msg");
        const isThisCall = ev === call.event;

        const header = el("div", "tac-msg-header");
        const roleBadge = el("span", "tac-msg-role tac-msg-role-" + ev.role);
        roleBadge.textContent = ev.type === "tool_call" ? "TOOL" : ev.type === "tool_result" ? "RESULT" : ev.role.toUpperCase();
        header.appendChild(roleBadge);

        if (ev.type === "tool_call" && ev.toolCall?.name) {
          const toolName = el("span", "tac-msg-tool");
          toolName.textContent = ev.toolCall.name;
          header.appendChild(toolName);
        }

        if (isThisCall) {
          const marker = el("span", "tac-msg-current");
          marker.textContent = "RESPONSE";
          header.appendChild(marker);
        }

        if (ev.timestamp) {
          const ts = el("span", "tac-msg-time");
          ts.textContent = new Date(ev.timestamp).toLocaleTimeString();
          header.appendChild(ts);
        }

        msg.appendChild(header);

        const body = el("div", "tac-msg-body");
        let content = "";
        if (ev.type === "tool_call") {
          const args = ev.toolCall?.arguments;
          content = typeof args === "string" ? args : JSON.stringify(args, null, 2);
        } else if (ev.type === "tool_result") {
          content = ev.toolResult?.output ?? "";
        } else {
          content = ev.content ?? "";
        }
        body.textContent = content.slice(0, 1500) + (content.length > 1500 ? "\n..." : "");
        msg.appendChild(body);

        if (isThisCall) msg.classList.add("tac-msg-highlight");
        messagesPanel.appendChild(msg);
      }
    }

    wrap.appendChild(messagesPanel);
  };

  inspect.appendChild(msgBtn);
  wrap.appendChild(inspect);

  return wrap;
}

function getVal(call: CallData, mode: "tokens" | "time" | "cost"): number {
  if (mode === "tokens") return call.tokens;
  if (mode === "time") return call.durationMs;
  return 0; // cost not available yet
}

function fmtVal(val: number, mode: "tokens" | "time" | "cost"): string {
  if (mode === "tokens") return fmt(val);
  if (mode === "time") return fmtDur(val);
  return "$0";
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function fmtDur(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
