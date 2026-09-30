/**
 * Table v2 — Data-grid style event table.
 * Sortable columns, smart per-column filters (chips, ranges),
 * column visibility toggle, sticky header, alternating rows, row expansion.
 */

import { Trajectory, TrajectoryEvent, computeSummary, getSessionLabel } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

const CSS = `
.tv2 { font-family: var(--tv-font); position: relative; }
.tv2-top-bar { display: flex; align-items: center; gap: 12px; padding: 8px 0; flex-wrap: wrap; }
.tv2-badge { background: var(--tv-accent); color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.tv2-gear { background: none; border: 1px solid var(--tv-border); border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 13px; color: var(--tv-text-secondary); position: relative; }
.tv2-gear:hover { background: var(--tv-bg-hover); }
.tv2-col-menu {
  position: absolute; top: 100%; right: 0; z-index: 50; background: var(--tv-bg-card);
  border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 8px 12px;
  min-width: 160px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.tv2-col-menu label { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 0; cursor: pointer; }
.tv2-session-selector { display: flex; align-items: center; gap: 8px; }
.tv2-session-dropdown {
  padding: 4px 8px; font-size: 12px; border: 1px solid var(--tv-border); border-radius: 4px;
  background: var(--tv-bg-card); color: var(--tv-text); font-family: var(--tv-font); cursor: pointer;
  max-width: 250px;
}

.tv2-wrap { overflow-x: auto; max-height: 80vh; overflow-y: auto; border: 1px solid var(--tv-border); border-radius: var(--tv-radius); position: relative; }
.tv2-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.tv2-table thead { position: sticky; top: 0; z-index: 10; }
.tv2-table th {
  background: var(--tv-bg-card); border-bottom: 2px solid var(--tv-border); padding: 8px 10px;
  text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.3px; color: var(--tv-text-secondary); cursor: pointer; user-select: none; white-space: nowrap;
}
.tv2-table .tv2-col-session { width: 120px; }
.tv2-table .tv2-col-time { width: 155px; }
.tv2-table .tv2-col-type { width: 90px; }
.tv2-table .tv2-col-role { width: 80px; }
.tv2-table .tv2-col-tool { width: 100px; }
.tv2-table .tv2-col-tokens { width: 80px; text-align: right; }
.tv2-table .tv2-col-duration { width: 85px; text-align: right; }
.tv2-table td.tv2-col-tokens { text-align: right; }
.tv2-table td.tv2-col-duration { text-align: right; }
.tv2-table th:hover { color: var(--tv-text); }
.tv2-sort-arrow { margin-left: 4px; font-size: 10px; }

/* Filter row */
.tv2-filter-row th { padding: 4px 6px; background: var(--tv-bg); border-bottom: 1px solid var(--tv-border); position: relative; }
.tv2-filter-input {
  width: 100%; box-sizing: border-box; padding: 3px 6px; font-size: 11px;
  border: 1px solid var(--tv-border); border-radius: 3px; background: var(--tv-bg-card);
  color: var(--tv-text); font-family: var(--tv-mono);
}
.tv2-dd-btn {
  display: block; width: 100%; padding: 2px 6px; font-size: 10px; border: 1px solid var(--tv-border);
  border-radius: 3px; background: var(--tv-bg-card); color: var(--tv-text-secondary); cursor: pointer;
  text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tv2-dd-btn:hover { background: var(--tv-bg-hover); }
.tv2-dd-btn.tv2-dd-filtered { border-color: var(--tv-accent); color: var(--tv-accent); font-weight: 600; }
.tv2-dd-panel {
  position: absolute; top: 100%; left: 0; z-index: 60; background: var(--tv-bg-card);
  border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 6px 0;
  min-width: 140px; max-height: 240px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
.tv2-dd-panel label {
  display: flex; align-items: center; gap: 6px; padding: 3px 10px; font-size: 11px; cursor: pointer;
  white-space: nowrap;
}
.tv2-dd-panel label:hover { background: var(--tv-bg-hover); }
.tv2-dd-actions { display: flex; gap: 4px; padding: 4px 10px; border-bottom: 1px solid var(--tv-border); margin-bottom: 2px; }
.tv2-dd-actions button {
  padding: 1px 6px; font-size: 9px; border: 1px solid var(--tv-border); border-radius: 2px;
  background: var(--tv-bg); color: var(--tv-text-secondary); cursor: pointer;
}
.tv2-dd-actions button:hover { background: var(--tv-bg-hover); }
/* Date picker — native input styled as compact icon */
.tv2-date-picker-input {
  width: 20px; height: 20px; padding: 0; border: 1px solid var(--tv-border); border-radius: 3px;
  background: var(--tv-bg-card); cursor: pointer; color: transparent; font-size: 0;
  position: relative;
}
.tv2-date-picker-input::-webkit-calendar-picker-indicator {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: auto; height: auto;
  cursor: pointer; opacity: 0.6; filter: invert(0.7);
}
.tv2-date-picker-input:hover { background: var(--tv-bg-hover); }
.tv2-date-picker-input::-webkit-inner-spin-button { display: none; }
.tv2-range-wrap { display: flex; gap: 2px; align-items: center; }
.tv2-range-input {
  width: 55px; padding: 2px 4px; font-size: 10px; border: 1px solid var(--tv-border);
  border-radius: 3px; background: var(--tv-bg-card); color: var(--tv-text); font-family: var(--tv-mono);
}
.tv2-range-sep { color: var(--tv-text-muted); font-size: 10px; }

.tv2-table td { padding: 5px 10px; border-bottom: 1px solid var(--tv-border); vertical-align: top; white-space: nowrap; }
.tv2-table tbody tr { cursor: pointer; }
.tv2-table tbody tr:nth-child(even) { background: var(--tv-bg-card); }
.tv2-table tbody tr:hover { background: var(--tv-bg-hover); }
.tv2-table tbody tr.tv2-err { background: color-mix(in srgb, var(--tv-error) 8%, transparent); }
.tv2-type-badge {
  display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;
  background: var(--tv-bg-hover); color: var(--tv-text-secondary);
}
.tv2-type-badge.tv2-b-error { background: var(--tv-error); color: #fff; }
.tv2-type-badge.tv2-b-tool_call { background: #ed8936; color: #fff; }
.tv2-type-badge.tv2-b-tool_result { background: #4f8ff7; color: #fff; }
.tv2-type-badge.tv2-b-thinking { background: #f7b731; color: #000; }
.tv2-type-badge.tv2-b-system { background: #778ca3; color: #fff; }
.tv2-content-cell { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--tv-mono); font-size: 11px; }
.tv2-detail { padding: 0 !important; }
.tv2-detail pre { margin: 0; padding: 10px 14px; font-size: 11px; font-family: var(--tv-mono); white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; background: var(--tv-bg); color: var(--tv-text-secondary); }
.tv2-session-cell { font-size: 10px; color: var(--tv-text-secondary); max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
`;

type Col = "session" | "time" | "type" | "role" | "tool" | "tokens" | "duration" | "content";
const BASE_COLS: Col[] = ["time", "type", "role", "tool", "tokens", "duration", "content"];
const COL_LABELS: Record<Col, string> = {
  session: "Session", time: "Date / Time", type: "Type", role: "Role",
  tool: "Tool", tokens: "Tokens (out)", duration: "Duration", content: "Content"
};

export const tableV2View: TrajectoryView = {
  id: "table",
  name: "Table",
  description: "Data-grid with sorting, filtering, column toggles, and sticky headers",
  icon: "\u2637",
  tier: "core",
  css: CSS,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("tv2");

    if (trajectories.length === 0) {
      const p = document.createElement("p");
      p.style.cssText = "padding:40px;text-align:center;color:var(--tv-text-muted)";
      p.textContent = "No sessions selected";
      container.appendChild(p);
      return;
    }

    const isMulti = trajectories.length > 1;

    // Build session labels
    const sessionLabels = trajectories.map((t, i) => getSessionLabel(t, i));
    const eventSessionMap = new Map<number, string>();
    for (let si = 0; si < trajectories.length; si++) {
      for (const ev of trajectories[si].events) eventSessionMap.set(ev.id, sessionLabels[si]);
    }

    // Session filter state
    const enabledSessions = new Set<number>();
    for (let si = 0; si < trajectories.length; si++) enabledSessions.add(si);

    // Build per-session event arrays for filtering
    const perSessionEvents: TrajectoryEvent[][] = trajectories.map(t => t.events);

    function getActiveEvents(): TrajectoryEvent[] {
      const result: TrajectoryEvent[] = [];
      for (let si = 0; si < trajectories.length; si++) {
        if (enabledSessions.has(si)) result.push(...perSessionEvents[si]);
      }
      return result;
    }

    const ALL_COLS: Col[] = isMulti ? ["session", ...BASE_COLS] : [...BASE_COLS];
    let sortCol: Col = "time";
    let sortAsc = true;

    // Dropdown-checkbox filters: which values are enabled (all on by default)
    const allTypes = [...new Set(trajectories.flatMap(t => t.events).map(e => e.type))];
    const allRoles = [...new Set(trajectories.flatMap(t => t.events).map(e => e.role))];
    const allTools = [...new Set(trajectories.flatMap(t => t.events)
      .filter(e => e.type === "tool_call" && e.toolCall?.name)
      .map(e => e.toolCall!.name))].sort();
    const enabledTypes = new Set(allTypes);
    const enabledRoles = new Set(allRoles);
    const enabledTools = new Set(allTools);

    // Range filters
    let timeFrom = "";
    let timeTo = "";
    let durationMin = "";
    let durationMax = "";

    // Text filter for content
    let contentFilter = "";

    // Token range
    let tokenMin = "";
    let tokenMax = "";

    // Track open dropdown so we close others
    let openDropdown: HTMLElement | null = null;

    const visibleCols = new Set<Col>(ALL_COLS);

    // ── Top bar: badge + session selector + column toggle ──
    const topBar = document.createElement("div");
    topBar.className = "tv2-top-bar";
    const badge = document.createElement("span");
    badge.className = "tv2-badge";
    topBar.appendChild(badge);

    // Session selector
    if (isMulti) {
      const sessWrap = document.createElement("span");
      sessWrap.className = "tv2-session-selector";
      const sessLabel = document.createElement("span");
      sessLabel.textContent = "Sessions: ";
      sessLabel.style.cssText = "font-size:12px;font-weight:600;color:var(--tv-text-secondary)";
      sessWrap.appendChild(sessLabel);

      const sessDropdown = document.createElement("select");
      sessDropdown.className = "tv2-session-dropdown";

      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = `All (${trajectories.length})`;
      sessDropdown.appendChild(allOpt);

      for (let si = 0; si < trajectories.length; si++) {
        const opt = document.createElement("option");
        opt.value = String(si);
        opt.textContent = `${si + 1}. ${sessionLabels[si]}`;
        sessDropdown.appendChild(opt);
      }

      sessDropdown.onchange = () => {
        enabledSessions.clear();
        if (sessDropdown.value === "all") {
          for (let si = 0; si < trajectories.length; si++) enabledSessions.add(si);
        } else {
          enabledSessions.add(Number(sessDropdown.value));
        }
        rebuild();
      };
      sessWrap.appendChild(sessDropdown);
      topBar.appendChild(sessWrap);
    }

    // Column toggle
    const gearWrap = document.createElement("span");
    gearWrap.style.position = "relative";
    const gearBtn = document.createElement("button");
    gearBtn.className = "tv2-gear";
    gearBtn.textContent = "\u2699 Columns";
    let menuOpen = false;
    gearBtn.onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; renderMenu(); };
    gearWrap.appendChild(gearBtn);
    topBar.appendChild(gearWrap);
    container.appendChild(topBar);

    function renderMenu() {
      let menu = gearWrap.querySelector(".tv2-col-menu") as HTMLElement | null;
      if (!menuOpen) { menu?.remove(); return; }
      if (menu) menu.remove();
      menu = document.createElement("div");
      menu.className = "tv2-col-menu";
      menu.onclick = (e) => e.stopPropagation();
      for (const col of ALL_COLS) {
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = visibleCols.has(col);
        cb.onchange = () => { if (cb.checked) visibleCols.add(col); else visibleCols.delete(col); buildHeader(); rebuild(); };
        label.appendChild(cb);
        const span = document.createElement("span");
        span.textContent = COL_LABELS[col];
        label.appendChild(span);
        menu.appendChild(label);
      }
      gearWrap.appendChild(menu);
    }
    document.addEventListener("click", () => { menuOpen = false; renderMenu(); });

    const wrapEl = document.createElement("div");
    wrapEl.className = "tv2-wrap";
    container.appendChild(wrapEl);

    // ── Value getters ──
    function getTimestamp(ev: TrajectoryEvent): number {
      return ev.timestamp ? new Date(ev.timestamp).getTime() : 0;
    }

    function getTimeDisplay(ev: TrajectoryEvent): string {
      if (!ev.timestamp) return "";
      const d = new Date(ev.timestamp);
      // Short date + time: "Mar 15, 3:45:12 PM"
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " +
        d.toLocaleTimeString();
    }

    function getVal(ev: TrajectoryEvent, col: Col): string {
      if (col === "session") return eventSessionMap.get(ev.id) ?? "";
      if (col === "time") return getTimeDisplay(ev);
      if (col === "type") return ev.type;
      if (col === "role") return ev.role;
      if (col === "tool") return ev.type === "tool_call" ? (ev.toolCall?.name ?? "") : ev.type === "tool_result" ? "result" : "";
      if (col === "tokens") return ev.tokens?.output ? String(ev.tokens.output) : "";
      if (col === "duration") return ev.durationMs ? String(ev.durationMs) : "";
      return contentPreview(ev);
    }

    function sortNum(a: string, b: string): number { return (Number(a) || 0) - (Number(b) || 0); }

    // ── Filtering ──
    let rows: TrajectoryEvent[] = [];

    function recomputeRows() {
      const activeEvents = getActiveEvents();

      const durMinMs = parseDurationInput(durationMin);
      const durMaxMs = parseDurationInput(durationMax);
      const tokMin = tokenMin ? Number(tokenMin) : null;
      const tokMax = tokenMax ? Number(tokenMax) : null;
      const tFrom = timeFrom ? new Date(timeFrom + "T00:00").getTime() : null;
      const tTo = timeTo ? new Date(timeTo + "T23:59:59").getTime() : null;

      rows = activeEvents.filter(ev => {
        if (!enabledTypes.has(ev.type)) return false;
        if (!enabledRoles.has(ev.role)) return false;

        // Time range
        if ((tFrom !== null && !isNaN(tFrom)) || (tTo !== null && !isNaN(tTo))) {
          const ts = getTimestamp(ev);
          if (tFrom !== null && !isNaN(tFrom) && ts < tFrom) return false;
          if (tTo !== null && !isNaN(tTo) && ts > tTo) return false;
        }

        // Tool filter: only applies to tool_call events with a name
        if (ev.type === "tool_call" && ev.toolCall?.name && !enabledTools.has(ev.toolCall.name)) return false;

        const dur = ev.durationMs ?? 0;
        if (durMinMs !== null && dur < durMinMs) return false;
        if (durMaxMs !== null && dur > durMaxMs) return false;

        const tok = ev.tokens?.output ?? 0;
        if (tokMin !== null && tok < tokMin) return false;
        if (tokMax !== null && tok > tokMax) return false;

        if (contentFilter) {
          const preview = contentPreview(ev).toLowerCase();
          if (!preview.includes(contentFilter.toLowerCase())) return false;
        }

        return true;
      });

      // Sort
      rows.sort((a, b) => {
        let cmp: number;
        if (sortCol === "time") {
          cmp = getTimestamp(a) - getTimestamp(b);
        } else if (sortCol === "tokens" || sortCol === "duration") {
          cmp = sortNum(getVal(a, sortCol), getVal(b, sortCol));
        } else {
          cmp = getVal(a, sortCol).localeCompare(getVal(b, sortCol));
        }
        return sortAsc ? cmp : -cmp;
      });
    }

    // ── Debounce for text inputs ──
    let rebuildTimer = 0;
    function debouncedRebuild() {
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(rebuild, 200);
    }

    // ── Build table structure once — only tbody is rebuilt on filter/sort ──
    const table = document.createElement("table");
    table.className = "tv2-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);
    wrapEl.appendChild(table);

    let currentCols: Col[] = [];

    function buildHeader() {
      thead.innerHTML = "";
      const cols = ALL_COLS.filter(c => visibleCols.has(c));
      currentCols = cols;

      // Header row
      const headerRow = document.createElement("tr");
      for (const col of cols) {
        const th = document.createElement("th");
        th.className = "tv2-col-" + col;
        th.textContent = COL_LABELS[col];
        if (sortCol === col) {
          const arrow = document.createElement("span");
          arrow.className = "tv2-sort-arrow";
          arrow.textContent = sortAsc ? "\u25B2" : "\u25BC";
          th.appendChild(arrow);
        }
        th.onclick = () => { if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; } buildHeader(); rebuild(); };
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);

      // Filter row
      const filterRow = document.createElement("tr");
      filterRow.className = "tv2-filter-row";
      for (const col of cols) {
        const th = document.createElement("th");

        if (col === "type") {
          th.appendChild(buildDropdownFilter("Type", allTypes, enabledTypes));
        } else if (col === "role") {
          th.appendChild(buildDropdownFilter("Role", allRoles, enabledRoles));
        } else if (col === "tool") {
          th.appendChild(buildDropdownFilter("Tool", allTools, enabledTools));
        } else if (col === "time") {
          th.appendChild(buildTimeRange());
        } else if (col === "duration") {
          th.appendChild(buildDurationRange());
        } else if (col === "tokens") {
          th.appendChild(buildTokenRange());
        } else if (col === "content") {
          const input = document.createElement("input");
          input.className = "tv2-filter-input";
          input.placeholder = "Search...";
          input.value = contentFilter;
          input.oninput = () => { contentFilter = input.value; debouncedRebuild(); };
          th.appendChild(input);
        }
        // time and session: no inline filter (sort handles time, dropdown handles session)

        filterRow.appendChild(th);
      }
      thead.appendChild(filterRow);
    }

    // Virtual scrolling constants
    const ROW_HEIGHT = 30;
    const BUFFER = 20;

    function rebuild() {
      recomputeRows();
      const allEvents = getActiveEvents();
      badge.textContent = `${rows.length} of ${allEvents.length} events`;

      const cols = currentCols;

      function renderVisibleRows() {
        const scrollTop = wrapEl.scrollTop;
        const viewportHeight = wrapEl.clientHeight;
        const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
        const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER);

        tbody.innerHTML = "";

        if (startIdx > 0) {
          const padRow = document.createElement("tr");
          const padTd = document.createElement("td");
          padTd.colSpan = cols.length;
          padTd.style.cssText = `height:${startIdx * ROW_HEIGHT}px;padding:0;border:none`;
          padRow.appendChild(padTd);
          tbody.appendChild(padRow);
        }

        for (let i = startIdx; i < endIdx; i++) {
          const ev = rows[i];
          const tr = document.createElement("tr");
          if (ev.type === "error" || ev.toolResult?.isError) tr.classList.add("tv2-err");

          for (const col of cols) {
            const td = document.createElement("td");
            td.className = "tv2-col-" + col;
            if (col === "type") {
              const span = document.createElement("span");
              span.className = "tv2-type-badge tv2-b-" + ev.type;
              span.textContent = ev.type;
              td.appendChild(span);
            } else if (col === "session") {
              td.className += " tv2-session-cell";
              td.textContent = getVal(ev, col);
              td.title = getVal(ev, col);
            } else if (col === "content") {
              td.className = "tv2-col-content tv2-content-cell";
              td.textContent = getVal(ev, col).slice(0, 120);
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

          tr.onclick = () => {
            // Toggle expanded state in-place. The previous flow created a
            // new Set + onStateChange + renderApp, which forced the entire
            // app to re-render and made every row click feel like the table
            // was refreshing. Mutating the existing Set keeps the global
            // state in sync (it's the same reference) and we just patch
            // the affected DOM row.
            const expanded = options.expandedEvents;
            if (expanded.has(ev.id)) {
              expanded.delete(ev.id);
              const sib = tr.nextElementSibling as HTMLElement | null;
              if (sib && sib.querySelector(".tv2-detail")) sib.remove();
            } else {
              expanded.add(ev.id);
              const detailRow = document.createElement("tr");
              const detailTd = document.createElement("td");
              detailTd.className = "tv2-detail";
              detailTd.colSpan = cols.length;
              const pre = document.createElement("pre");
              pre.textContent = fullContent(ev);
              detailTd.appendChild(pre);
              detailRow.appendChild(detailTd);
              tr.after(detailRow);
            }
          };
          tbody.appendChild(tr);

          if (options.expandedEvents.has(ev.id)) {
            const detailRow = document.createElement("tr");
            const detailTd = document.createElement("td");
            detailTd.className = "tv2-detail";
            detailTd.colSpan = cols.length;
            const pre = document.createElement("pre");
            pre.textContent = fullContent(ev);
            detailTd.appendChild(pre);
            detailRow.appendChild(detailTd);
            tbody.appendChild(detailRow);
          }
        }

        const remainingRows = rows.length - endIdx;
        if (remainingRows > 0) {
          const padRow = document.createElement("tr");
          const padTd = document.createElement("td");
          padTd.colSpan = cols.length;
          padTd.style.cssText = `height:${remainingRows * ROW_HEIGHT}px;padding:0;border:none`;
          padRow.appendChild(padTd);
          tbody.appendChild(padRow);
        }
      }

      // Reset scroll handler and render visible rows
      let scrollRaf = 0;
      wrapEl.onscroll = () => {
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(renderVisibleRows);
      };

      renderVisibleRows();
    }

    // ── Filter builders ──
    function closeDropdowns() {
      if (openDropdown) { openDropdown.remove(); openDropdown = null; }
    }
    document.addEventListener("click", closeDropdowns);

    function buildDropdownFilter(label: string, values: string[], enabled: Set<string>): HTMLElement {
      const wrap = document.createElement("div");
      wrap.style.position = "relative";

      const isFiltered = enabled.size < values.length;
      const btn = document.createElement("button");
      btn.className = `tv2-dd-btn${isFiltered ? " tv2-dd-filtered" : ""}`;
      btn.textContent = isFiltered ? `${enabled.size} of ${values.length}` : `All (${values.length})`;
      btn.onclick = (e) => {
        e.stopPropagation();
        // Close any other open dropdown
        if (openDropdown && openDropdown.parentElement !== wrap) {
          openDropdown.remove(); openDropdown = null;
        }
        // Toggle this one
        if (openDropdown) { openDropdown.remove(); openDropdown = null; return; }

        const panel = document.createElement("div");
        panel.className = "tv2-dd-panel";
        panel.onclick = (e) => e.stopPropagation();

        // All / None buttons
        const actions = document.createElement("div");
        actions.className = "tv2-dd-actions";
        const allBtn = document.createElement("button");
        allBtn.textContent = "All";
        allBtn.onclick = () => { values.forEach(v => enabled.add(v)); rebuildPanel(); rebuild(); };
        actions.appendChild(allBtn);
        const noneBtn = document.createElement("button");
        noneBtn.textContent = "None";
        noneBtn.onclick = () => { enabled.clear(); rebuildPanel(); rebuild(); };
        actions.appendChild(noneBtn);
        panel.appendChild(actions);

        function rebuildPanel() {
          // Update checkboxes and button text
          panel.querySelectorAll("input[type=checkbox]").forEach((cb, i) => {
            (cb as HTMLInputElement).checked = enabled.has(values[i]);
          });
          const nowFiltered = enabled.size < values.length;
          btn.className = `tv2-dd-btn${nowFiltered ? " tv2-dd-filtered" : ""}`;
          btn.textContent = nowFiltered ? `${enabled.size} of ${values.length}` : `All (${values.length})`;
        }

        for (const val of values) {
          const lbl = document.createElement("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = enabled.has(val);
          cb.onchange = () => {
            if (cb.checked) enabled.add(val); else enabled.delete(val);
            rebuildPanel();
            rebuild();
          };
          lbl.appendChild(cb);
          const txt = document.createTextNode(val);
          lbl.appendChild(txt);
          panel.appendChild(lbl);
        }

        wrap.appendChild(panel);
        openDropdown = panel;
      };
      wrap.appendChild(btn);
      return wrap;
    }

    function buildTimeRange(): HTMLElement {
      const wrap = document.createElement("div");
      wrap.className = "tv2-range-wrap";

      function makeDateBtn(label: string, current: string, onChange: (val: string) => void): HTMLElement {
        const container = document.createElement("span");
        container.style.cssText = "display:inline-flex;align-items:center;gap:2px";

        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.className = "tv2-date-picker-input";
        dateInput.title = label;
        dateInput.value = current || "";
        dateInput.onchange = () => {
          onChange(dateInput.value);
          updateDisplay();
          rebuild();
        };
        container.appendChild(dateInput);

        const display = document.createElement("span");
        display.style.cssText = "font-size:9px;color:var(--tv-text-muted);white-space:nowrap";
        container.appendChild(display);

        const clearBtn = document.createElement("button");
        clearBtn.style.cssText = "background:none;border:none;cursor:pointer;font-size:9px;color:var(--tv-text-muted);padding:0 1px;display:none";
        clearBtn.textContent = "\u2715";
        clearBtn.title = "Clear";
        clearBtn.onclick = (e) => {
          e.stopPropagation();
          dateInput.value = "";
          onChange("");
          updateDisplay();
          rebuild();
        };
        container.appendChild(clearBtn);

        function updateDisplay() {
          if (dateInput.value) {
            const d = new Date(dateInput.value + "T00:00");
            display.textContent = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
            display.style.color = "var(--tv-accent)";
            display.style.fontWeight = "600";
            clearBtn.style.display = "inline";
          } else {
            display.textContent = label.toLowerCase();
            display.style.color = "var(--tv-text-muted)";
            display.style.fontWeight = "";
            clearBtn.style.display = "none";
          }
        }

        updateDisplay();
        return container;
      }

      wrap.appendChild(makeDateBtn("From", timeFrom, (v) => { timeFrom = v; }));
      const sep = document.createElement("span");
      sep.className = "tv2-range-sep";
      sep.textContent = "\u2013";
      wrap.appendChild(sep);
      wrap.appendChild(makeDateBtn("To", timeTo, (v) => { timeTo = v; }));
      return wrap;
    }

    function buildDurationRange(): HTMLElement {
      const wrap = document.createElement("div");
      wrap.className = "tv2-range-wrap";
      const min = document.createElement("input");
      min.className = "tv2-range-input";
      min.placeholder = "min";
      min.title = "Min duration (e.g. 500ms, 2s, 1m)";
      min.value = durationMin;
      min.oninput = () => { durationMin = min.value; debouncedRebuild(); };
      wrap.appendChild(min);
      const sep = document.createElement("span");
      sep.className = "tv2-range-sep";
      sep.textContent = "\u2013";
      wrap.appendChild(sep);
      const max = document.createElement("input");
      max.className = "tv2-range-input";
      max.placeholder = "max";
      max.title = "Max duration (e.g. 5s, 30s, 2m)";
      max.value = durationMax;
      max.oninput = () => { durationMax = max.value; debouncedRebuild(); };
      wrap.appendChild(max);
      return wrap;
    }

    function buildTokenRange(): HTMLElement {
      const wrap = document.createElement("div");
      wrap.className = "tv2-range-wrap";
      const min = document.createElement("input");
      min.className = "tv2-range-input";
      min.placeholder = "min";
      min.title = "Min output tokens";
      min.value = tokenMin;
      min.oninput = () => { tokenMin = min.value; debouncedRebuild(); };
      wrap.appendChild(min);
      const sep = document.createElement("span");
      sep.className = "tv2-range-sep";
      sep.textContent = "\u2013";
      wrap.appendChild(sep);
      const max = document.createElement("input");
      max.className = "tv2-range-input";
      max.placeholder = "max";
      max.title = "Max output tokens";
      max.value = tokenMax;
      max.oninput = () => { tokenMax = max.value; debouncedRebuild(); };
      wrap.appendChild(max);
      return wrap;
    }

    buildHeader();
    rebuild();
  },
};

// ── Helpers ──

function contentPreview(ev: TrajectoryEvent): string {
  if (ev.type === "tool_call") {
    const args = ev.toolCall?.arguments;
    if (!args) return "";
    if (typeof args === "string") return args;
    const obj = args as Record<string, unknown>;
    return String(obj.command ?? obj.file_path ?? obj.pattern ?? JSON.stringify(obj)).slice(0, 200);
  }
  if (ev.type === "tool_result") return (ev.toolResult?.output ?? "").slice(0, 200);
  return (ev.content ?? "").slice(0, 200);
}

function fullContent(ev: TrajectoryEvent): string {
  if (ev.type === "tool_call") {
    const args = ev.toolCall?.arguments;
    if (!args) return "";
    return typeof args === "string" ? args : JSON.stringify(args, null, 2);
  }
  if (ev.type === "tool_result") return ev.toolResult?.output ?? "";
  return ev.content ?? "";
}

/** Parse human-friendly duration input: "500ms", "2s", "1.5s", "1m", "90" (defaults to ms) */
function parseDurationInput(val: string): number | null {
  if (!val.trim()) return null;
  const s = val.trim().toLowerCase();
  const mMatch = s.match(/^([\d.]+)\s*m$/);
  if (mMatch) return parseFloat(mMatch[1]) * 60000;
  const sMatch = s.match(/^([\d.]+)\s*s$/);
  if (sMatch) return parseFloat(sMatch[1]) * 1000;
  const msMatch = s.match(/^([\d.]+)\s*ms$/);
  if (msMatch) return parseFloat(msMatch[1]);
  const num = parseFloat(s);
  return isNaN(num) ? null : num; // bare number = ms
}

function fmtTok(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1000000) return (n / 1000).toFixed(1) + "K";
  return (n / 1000000).toFixed(2) + "M";
}

function fmtDur(ms: number): string {
  if (ms < 1000) return ms + "ms";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  const remS = Math.floor(s % 60);
  if (m < 60) return m + "m " + remS + "s";
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return h + "h " + remM + "m";
}
