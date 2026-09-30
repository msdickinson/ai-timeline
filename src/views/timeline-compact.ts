/**
 * Compact Timeline View — ultra-compact one-line-per-event display.
 * Like `git log --oneline` for AI sessions. Virtual scroll for performance.
 * Search/filter, keyboard navigation (j/k/enter), click to expand.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/[\r\n]+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max) + "...";
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "??:??:??";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const TYPE_ICONS: Record<string, string> = {
  message: "M",
  tool_call: "T",
  tool_result: "R",
  thinking: ".",
  system: "S",
  error: "!",
};

const ROLE_COLORS: Record<string, string> = {
  assistant: "#4f8ff7",
  user: "#48bb78",
  system: "#9f7aea",
  environment: "#ed8936",
};

function getTypeColor(e: TrajectoryEvent): string {
  if (e.type === "error" || e.toolResult?.isError) return "#fc5c65";
  if (e.type === "tool_call") return "#9f7aea";
  if (e.type === "tool_result") return "#ed8936";
  if (e.type === "thinking") return "#666";
  return ROLE_COLORS[e.role] ?? "var(--tv-text-muted, #888)";
}

function getPreview(e: TrajectoryEvent): string {
  if (e.type === "tool_call" && e.toolCall) {
    const args = e.toolCall.arguments;
    const argStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
    return `${e.toolCall.name}(${truncate(argStr, 60)})`;
  }
  if (e.type === "tool_result") {
    const prefix = e.toolResult?.isError ? "[ERR] " : "";
    return prefix + truncate(e.toolResult?.output ?? e.content ?? "", 80);
  }
  return truncate(e.content ?? "", 80);
}

const ROW_HEIGHT = 28;
const BUFFER_ROWS = 10;

interface FlatEvent {
  event: TrajectoryEvent;
  sessionIdx: number;
  globalIdx: number;
}

let cleanupFn: (() => void) | null = null;

export const timelineCompactView: TrajectoryView = {
  id: "timeline-compact",
  name: "Compact",
  description: "Ultra-compact one-line-per-event timeline with virtual scroll, search, and keyboard navigation",
  icon: "_",
  tier: "advanced",

  css: `
.tlc-wrap { display: flex; flex-direction: column; height: calc(100vh - 160px); min-height: 400px; }
.tlc-toolbar { display: flex; gap: 8px; padding: 8px 0; align-items: center; flex-wrap: wrap; flex-shrink: 0; }
.tlc-search { flex: 1; min-width: 200px; background: var(--tv-card-bg, #1a1a2e); color: var(--tv-text, #e0e0e0); border: 1px solid var(--tv-border, #333); border-radius: 4px; padding: 6px 10px; font-size: 13px; font-family: var(--tv-mono, monospace); }
.tlc-search:focus { outline: 1px solid var(--tv-accent, #4f8ff7); border-color: var(--tv-accent, #4f8ff7); }
.tlc-filter-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--tv-border, #333); background: var(--tv-bg, #0d0d1a); color: var(--tv-text-muted, #888); font-size: 11px; cursor: pointer; }
.tlc-filter-btn.tlc-active { background: var(--tv-accent, #4f8ff7); color: #fff; border-color: var(--tv-accent, #4f8ff7); }
.tlc-count { font-size: 11px; color: var(--tv-text-muted, #888); }
.tlc-scroll { flex: 1; overflow-y: auto; position: relative; background: var(--tv-card-bg, #1a1a2e); border-radius: 6px; }
.tlc-scroll:focus { outline: 1px solid var(--tv-accent, #4f8ff7); }
.tlc-spacer { width: 100%; }
.tlc-viewport { position: absolute; left: 0; right: 0; }
.tlc-row { display: flex; align-items: center; gap: 0; height: ${ROW_HEIGHT}px; padding: 0 8px; font-size: 12px; font-family: var(--tv-mono, monospace); cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.03); white-space: nowrap; overflow: hidden; }
.tlc-row:hover { background: rgba(255,255,255,0.04); }
.tlc-row.tlc-selected { background: rgba(79, 143, 247, 0.12); }
.tlc-row.tlc-focused { outline: 1px solid var(--tv-accent, #4f8ff7); outline-offset: -1px; }
.tlc-col-time { width: 72px; flex-shrink: 0; color: var(--tv-text-muted, #666); }
.tlc-col-icon { width: 20px; flex-shrink: 0; text-align: center; font-weight: 700; }
.tlc-col-name { width: 120px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.tlc-col-preview { flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--tv-text-muted, #aaa); }
.tlc-col-session { width: 24px; flex-shrink: 0; text-align: center; color: var(--tv-text-muted, #666); font-size: 10px; }
.tlc-detail { background: var(--tv-bg, #0d0d1a); border: 1px solid var(--tv-border, #333); border-radius: 6px; margin: 4px 8px; padding: 12px; font-size: 12px; max-height: 300px; overflow-y: auto; }
.tlc-detail-pre { font-family: var(--tv-mono, monospace); font-size: 11px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.tlc-detail-meta { font-size: 11px; color: var(--tv-text-muted, #888); margin-bottom: 8px; display: flex; gap: 12px; flex-wrap: wrap; }
.tlc-empty { padding: 40px; text-align: center; color: var(--tv-text-muted, #888); }
.tlc-kbd { display: inline-block; padding: 1px 5px; background: var(--tv-bg, #0d0d1a); border: 1px solid var(--tv-border, #333); border-radius: 3px; font-size: 10px; font-family: var(--tv-mono, monospace); margin: 0 2px; }
`,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    if (cleanupFn) { cleanupFn(); cleanupFn = null; }

    if (trajectories.length === 0) {
      const msg = el("p", "tlc-empty");
      msg.textContent = "No sessions selected";
      container.appendChild(msg);
      return;
    }

    // Flatten all events
    const allFlat: FlatEvent[] = [];
    for (let si = 0; si < trajectories.length; si++) {
      for (const e of trajectories[si].events) {
        allFlat.push({ event: e, sessionIdx: si, globalIdx: allFlat.length });
      }
    }

    if (allFlat.length === 0) {
      const msg = el("p", "tlc-empty");
      msg.textContent = "No events in selected sessions";
      container.appendChild(msg);
      return;
    }

    let filtered = allFlat;
    let selectedIdx = -1;
    let expandedIdx = -1;
    let focusIdx = 0;
    let activeTypeFilter: string | null = null;
    let searchText = "";

    const wrap = el("div", "tlc-wrap");

    // Toolbar
    const toolbar = el("div", "tlc-toolbar");
    const searchInput = document.createElement("input");
    searchInput.className = "tlc-search";
    searchInput.placeholder = "Search events... (content, tool name)";
    searchInput.type = "text";
    toolbar.appendChild(searchInput);

    const typeButtons: HTMLElement[] = [];
    for (const t of ["message", "tool_call", "tool_result", "thinking", "error"]) {
      const btn = el("button", "tlc-filter-btn");
      btn.textContent = t.replace("_", " ");
      btn.addEventListener("click", () => {
        activeTypeFilter = activeTypeFilter === t ? null : t;
        typeButtons.forEach(b => b.classList.remove("tlc-active"));
        if (activeTypeFilter) btn.classList.add("tlc-active");
        applyFilters();
      });
      typeButtons.push(btn);
      toolbar.appendChild(btn);
    }

    const countLabel = el("span", "tlc-count");
    toolbar.appendChild(countLabel);

    // Keyboard hints
    const hints = el("span", "tlc-count");
    hints.innerHTML = `<span class="tlc-kbd">j</span>/<span class="tlc-kbd">k</span> nav <span class="tlc-kbd">Enter</span> expand`;
    toolbar.appendChild(hints);

    wrap.appendChild(toolbar);

    // Virtual scroll container
    const scrollEl = el("div", "tlc-scroll");
    scrollEl.tabIndex = 0;
    const spacer = el("div", "tlc-spacer");
    const viewport = el("div", "tlc-viewport");
    scrollEl.appendChild(spacer);
    scrollEl.appendChild(viewport);
    wrap.appendChild(scrollEl);
    container.appendChild(wrap);

    function applyFilters() {
      const q = searchText.toLowerCase();
      filtered = allFlat.filter(f => {
        if (activeTypeFilter && f.event.type !== activeTypeFilter) return false;
        if (q) {
          const content = (f.event.content ?? "").toLowerCase();
          const toolName = (f.event.toolCall?.name ?? "").toLowerCase();
          const output = (f.event.toolResult?.output ?? "").toLowerCase();
          if (!content.includes(q) && !toolName.includes(q) && !output.includes(q)) return false;
        }
        return true;
      });
      focusIdx = 0;
      expandedIdx = -1;
      selectedIdx = -1;
      countLabel.textContent = `${filtered.length} / ${allFlat.length}`;
      updateVirtualScroll();
    }

    function updateVirtualScroll() {
      const totalHeight = filtered.length * ROW_HEIGHT;
      spacer.style.height = `${totalHeight}px`;
      renderVisible();
    }

    function renderVisible() {
      viewport.textContent = "";
      const scrollTop = scrollEl.scrollTop;
      const containerHeight = scrollEl.clientHeight;
      const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
      const endRow = Math.min(filtered.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS);

      viewport.style.top = `${startRow * ROW_HEIGHT}px`;

      for (let i = startRow; i < endRow; i++) {
        const f = filtered[i];
        const row = el("div", "tlc-row");
        if (i === selectedIdx) row.classList.add("tlc-selected");
        if (i === focusIdx) row.classList.add("tlc-focused");

        const time = el("span", "tlc-col-time");
        time.textContent = fmtTime(f.event.timestamp);
        row.appendChild(time);

        const icon = el("span", "tlc-col-icon");
        icon.textContent = TYPE_ICONS[f.event.type] ?? "?";
        icon.style.color = getTypeColor(f.event);
        row.appendChild(icon);

        const name = el("span", "tlc-col-name");
        name.textContent = f.event.toolCall?.name ?? f.event.role ?? f.event.type;
        name.style.color = getTypeColor(f.event);
        row.appendChild(name);

        const preview = el("span", "tlc-col-preview");
        preview.textContent = getPreview(f.event);
        row.appendChild(preview);

        if (trajectories.length > 1) {
          const sess = el("span", "tlc-col-session");
          sess.textContent = (f.sessionIdx + 1).toString();
          row.appendChild(sess);
        }

        const rowIdx = i;
        row.addEventListener("click", () => toggleExpand(rowIdx));
        viewport.appendChild(row);

        // Expanded detail
        if (i === expandedIdx) {
          const detail = renderDetail(f);
          viewport.appendChild(detail);
        }
      }
    }

    function renderDetail(f: FlatEvent): HTMLElement {
      const detail = el("div", "tlc-detail");

      const meta = el("div", "tlc-detail-meta");
      const parts = [
        `Type: ${f.event.type}`,
        `Role: ${f.event.role}`,
        `ID: ${f.event.id}`,
        f.event.durationMs ? `Duration: ${f.event.durationMs}ms` : "",
        f.event.model ? `Model: ${f.event.model}` : "",
        f.event.tokens ? `Tokens: in=${f.event.tokens.input ?? 0} out=${f.event.tokens.output ?? 0} cache=${f.event.tokens.cacheRead ?? 0}` : "",
      ].filter(Boolean);
      meta.textContent = parts.join("  |  ");
      detail.appendChild(meta);

      const pre = el("div", "tlc-detail-pre");
      let content = "";
      if (f.event.toolCall) {
        const args = f.event.toolCall.arguments;
        content = `Tool: ${f.event.toolCall.name}\n\nArguments:\n${typeof args === "string" ? args : JSON.stringify(args, null, 2)}`;
      } else if (f.event.toolResult) {
        content = f.event.toolResult.output ?? "";
        if (f.event.toolResult.isError) content = "[ERROR]\n" + content;
      } else {
        content = f.event.content ?? "";
      }
      pre.textContent = content.slice(0, 5000);
      if (content.length > 5000) {
        const trunc = el("div");
        trunc.textContent = `... truncated (${content.length} chars total)`;
        trunc.style.color = "var(--tv-text-muted, #888)";
        trunc.style.fontStyle = "italic";
        trunc.style.marginTop = "4px";
        pre.appendChild(trunc);
      }
      detail.appendChild(pre);
      return detail;
    }

    function toggleExpand(idx: number) {
      selectedIdx = idx;
      expandedIdx = expandedIdx === idx ? -1 : idx;
      renderVisible();
    }

    function scrollToFocus() {
      const targetTop = focusIdx * ROW_HEIGHT;
      const containerHeight = scrollEl.clientHeight;
      if (targetTop < scrollEl.scrollTop) {
        scrollEl.scrollTop = targetTop;
      } else if (targetTop + ROW_HEIGHT > scrollEl.scrollTop + containerHeight) {
        scrollEl.scrollTop = targetTop - containerHeight + ROW_HEIGHT;
      }
      renderVisible();
    }

    // Keyboard navigation
    function handleKeydown(ev: KeyboardEvent) {
      if (ev.key === "j" || ev.key === "ArrowDown") {
        ev.preventDefault();
        if (focusIdx < filtered.length - 1) { focusIdx++; scrollToFocus(); }
      } else if (ev.key === "k" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (focusIdx > 0) { focusIdx--; scrollToFocus(); }
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        toggleExpand(focusIdx);
      } else if (ev.key === "Escape") {
        expandedIdx = -1;
        renderVisible();
      }
    }

    scrollEl.addEventListener("keydown", handleKeydown);
    scrollEl.addEventListener("scroll", renderVisible);

    let searchTimer: ReturnType<typeof setTimeout>;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchText = searchInput.value;
        applyFilters();
      }, 150);
    });

    cleanupFn = () => {
      scrollEl.removeEventListener("keydown", handleKeydown);
      scrollEl.removeEventListener("scroll", renderVisible);
      clearTimeout(searchTimer);
    };

    applyFilters();
  },

  destroy() {
    if (cleanupFn) { cleanupFn(); cleanupFn = null; }
  },
};
