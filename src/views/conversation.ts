/**
 * Conversation View — clean chat-style view like iMessage/ChatGPT.
 * User messages on right (blue), assistant on left (gray), tool calls inline.
 */

import { Trajectory, TrajectoryEvent, getSessionLabel } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

export const conversationView: TrajectoryView = {
  id: "conversation",
  name: "Chat",
  description: "Chat-style conversation view with message bubbles",
  icon: "\u2709",
  tier: "standard",

  css: `
    .cnv { font-family: var(--tv-font); padding: 8px 0; }
    .cnv-single { max-width: 800px; margin: 0 auto; }
    .cnv-session-selector { display: flex; align-items: center; gap: 8px; padding: 10px 0; flex-wrap: wrap; }
    .cnv-session-dropdown {
      padding: 4px 8px; font-size: 12px; border: 1px solid var(--tv-border); border-radius: 4px;
      background: var(--tv-bg-card); color: var(--tv-text); font-family: var(--tv-font); cursor: pointer;
    }
    .cnv-sbs-container { display: flex; gap: 12px; height: calc(100vh - 140px); }
    .cnv-sbs-column {
      flex: 1; min-width: 0; overflow-y: auto; border: 1px solid var(--tv-border);
      border-radius: var(--tv-radius); background: var(--tv-bg-card); padding: 0 8px;
    }
    .cnv-sbs-column-header {
      position: sticky; top: 0; z-index: 5; padding: 8px 8px; font-size: 12px; font-weight: 700;
      color: var(--tv-text); background: color-mix(in srgb, var(--tv-accent) 12%, var(--tv-bg-card));
      border-bottom: 2px solid var(--tv-accent); margin: 0 -8px; padding-left: 16px;
    }
    .cnv-sbs-picker {
      display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 0; align-items: center;
    }
    .cnv-sbs-picker-label { font-size: 12px; color: var(--tv-text-secondary); font-weight: 600; }
    .cnv-sbs-check {
      display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;
      padding: 4px 10px; border: 1px solid var(--tv-border); border-radius: 4px;
      background: var(--tv-bg-card); color: var(--tv-text-secondary); user-select: none;
    }
    .cnv-sbs-check:hover { background: var(--tv-bg-hover); }
    .cnv-sbs-check.cnv-sbs-checked {
      background: color-mix(in srgb, var(--tv-accent) 15%, var(--tv-bg-card));
      border-color: var(--tv-accent); color: var(--tv-text); font-weight: 600;
    }
    .cnv-sbs-check.cnv-sbs-disabled { opacity: 0.4; cursor: not-allowed; }
    .cnv-sbs-hint { font-size: 11px; color: var(--tv-text-muted); font-style: italic; }
    .cnv-header { font-size: 16px; font-weight: 700; padding: 12px 0; border-bottom: 1px solid var(--tv-border); margin-bottom: 16px; text-align: center; }
    .cnv-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
    .cnv-group { margin-bottom: 16px; }
    .cnv-time { text-align: center; font-size: 10px; color: var(--tv-text-muted); margin-bottom: 8px; }
    .cnv-row { display: flex; margin-bottom: 4px; }
    .cnv-row-user { justify-content: flex-end; }
    .cnv-row-assistant { justify-content: flex-start; }
    .cnv-row-system { justify-content: center; }
    .cnv-bubble { max-width: 75%; padding: 10px 14px; border-radius: 16px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .cnv-bubble-user { background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
    .cnv-bubble-assistant { background: var(--tv-bg-card); border: 1px solid var(--tv-border); color: var(--tv-text); border-bottom-left-radius: 4px; }
    .cnv-bubble-system { background: transparent; color: var(--tv-text-muted); font-size: 11px; font-style: italic; max-width: 90%; text-align: center; padding: 6px 12px; }
    .cnv-thinking { background: var(--tv-bg); border: 1px dashed var(--tv-border); color: var(--tv-text-muted); font-style: italic; border-radius: 12px; max-width: 75%; padding: 8px 14px; font-size: 12px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; opacity: 0.7; }
    .cnv-tool { max-width: 75%; margin-bottom: 4px; }
    .cnv-tool-card { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: 8px; padding: 8px 12px; font-size: 11px; }
    .cnv-tool-header { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
    .cnv-tool-icon { font-weight: 700; color: #ed8936; }
    .cnv-tool-name { font-family: var(--tv-mono); font-weight: 600; font-size: 12px; }
    .cnv-tool-duration { color: var(--tv-text-muted); font-size: 10px; }
    .cnv-tool-args { font-family: var(--tv-mono); font-size: 10px; color: var(--tv-text-secondary); max-height: 60px; overflow: hidden; white-space: pre-wrap; word-break: break-word; cursor: pointer; }
    .cnv-tool-args.cnv-expanded { max-height: none; }
    .cnv-tool-result { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--tv-border); }
    .cnv-tool-result-text { font-family: var(--tv-mono); font-size: 10px; color: var(--tv-text-secondary); max-height: 60px; overflow: hidden; white-space: pre-wrap; word-break: break-word; cursor: pointer; }
    .cnv-tool-result-text.cnv-expanded { max-height: none; }
    .cnv-tool-error { color: var(--tv-error); }
    .cnv-tool-ok { color: #48bb78; font-size: 10px; font-weight: 600; }
    .cnv-role-label { font-size: 10px; font-weight: 600; color: var(--tv-text-muted); margin-bottom: 2px; text-transform: uppercase; }
    .cnv-session-break { text-align: center; padding: 12px 0; font-size: 11px; color: var(--tv-text-muted); border-top: 1px dashed var(--tv-border); margin-top: 16px; }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("cnv");
    // Override .tv-view-container's default overflow:hidden — the chat
    // feed needs to scroll vertically as messages accumulate.
    container.style.overflowY = "auto";
    container.style.overflowX = "hidden";

    if (trajectories.length === 0) {
      const empty = el("div", "cnv-empty");
      empty.textContent = "No sessions selected";
      container.appendChild(empty);
      return;
    }

    const isMulti = trajectories.length > 1;

    // Build session labels
    const sessionLabels = trajectories.map((t, i) => getSessionLabel(t, i));

    // View mode: index for single session, "side-by-side" for pick-and-compare
    let viewMode: number | "side-by-side" = 0;
    // Pre-select first 2 for side-by-side
    const sbsSelected = new Set<number>(isMulti ? [0, 1] : []);

    if (isMulti) {
      const selectorRow = el("div", "cnv-session-selector");
      const label = el("span", "");
      label.textContent = "View: ";
      label.style.cssText = "font-size:12px;font-weight:600;color:var(--tv-text-secondary)";
      selectorRow.appendChild(label);

      const dropdown = document.createElement("select");
      dropdown.className = "cnv-session-dropdown";

      const sbsOpt = document.createElement("option");
      sbsOpt.value = "side-by-side";
      sbsOpt.textContent = "Side by Side";
      dropdown.appendChild(sbsOpt);

      for (let si = 0; si < trajectories.length; si++) {
        const opt = document.createElement("option");
        opt.value = String(si);
        opt.textContent = sessionLabels[si];
        dropdown.appendChild(opt);
      }

      // Default to side by side when multi-session
      dropdown.value = "side-by-side";
      viewMode = "side-by-side";

      dropdown.onchange = () => {
        viewMode = dropdown.value === "side-by-side" ? "side-by-side" : Number(dropdown.value);
        renderContent();
      };
      selectorRow.appendChild(dropdown);
      container.appendChild(selectorRow);
    }

    // Picker area (shown only in side-by-side mode)
    const pickerArea = el("div", "");
    container.appendChild(pickerArea);

    const contentArea = el("div", "");
    container.appendChild(contentArea);

    function renderPicker() {
      pickerArea.innerHTML = "";
      if (viewMode !== "side-by-side") return;

      const picker = el("div", "cnv-sbs-picker");

      if (trajectories.length <= 5) {
        // Chip mode for small counts
        const pickerLabel = el("span", "cnv-sbs-picker-label");
        pickerLabel.textContent = "Compare:";
        picker.appendChild(pickerLabel);

        for (let si = 0; si < trajectories.length; si++) {
          const isChecked = sbsSelected.has(si);
          const atMax = sbsSelected.size >= 3 && !isChecked;
          const chip = el("div", `cnv-sbs-check${isChecked ? " cnv-sbs-checked" : ""}${atMax ? " cnv-sbs-disabled" : ""}`);
          chip.textContent = sessionLabels[si];
          if (!atMax) {
            chip.onclick = () => {
              if (sbsSelected.has(si)) sbsSelected.delete(si);
              else if (sbsSelected.size < 3) sbsSelected.add(si);
              renderPicker();
              renderSbs();
            };
          }
          picker.appendChild(chip);
        }

        const hint = el("span", "cnv-sbs-hint");
        hint.textContent = sbsSelected.size === 0
          ? "Pick 2 or 3 sessions to compare"
          : sbsSelected.size < 3
            ? `${sbsSelected.size} selected \u2014 pick up to ${3 - sbsSelected.size} more`
            : "3 selected (max \u2014 columns get too narrow beyond 3)";
        picker.appendChild(hint);
      } else {
        // Dropdown mode for large session counts
        const slotLabels = ["A", "B", "C"];
        for (let slot = 0; slot < 3; slot++) {
          const wrap = el("span", "");
          wrap.style.cssText = "display:inline-flex;align-items:center;gap:4px";
          const slotLabel = el("span", "cnv-sbs-picker-label");
          slotLabel.textContent = slot === 0 ? "Compare:" : "vs";
          wrap.appendChild(slotLabel);

          const dd = document.createElement("select");
          dd.className = "cnv-session-dropdown";

          const noneOpt = document.createElement("option");
          noneOpt.value = "";
          noneOpt.textContent = slot < 2 ? `Session ${slotLabels[slot]}...` : "(optional)";
          dd.appendChild(noneOpt);

          for (let si = 0; si < trajectories.length; si++) {
            const opt = document.createElement("option");
            opt.value = String(si);
            opt.textContent = `${si + 1}. ${sessionLabels[si]}`;
            dd.appendChild(opt);
          }

          // Restore current selection for this slot
          const sortedSelected = [...sbsSelected].sort((a, b) => a - b);
          if (slot < sortedSelected.length) {
            dd.value = String(sortedSelected[slot]);
          }

          dd.onchange = () => {
            // Rebuild sbsSelected from all 3 dropdowns
            sbsSelected.clear();
            const allDds = pickerArea.querySelectorAll("select.cnv-session-dropdown");
            allDds.forEach(d => {
              const v = (d as HTMLSelectElement).value;
              if (v !== "") sbsSelected.add(Number(v));
            });
            renderSbs();
          };
          wrap.appendChild(dd);
          picker.appendChild(wrap);
        }
      }

      pickerArea.appendChild(picker);
    }

    function renderSbs() {
      contentArea.innerHTML = "";
      if (sbsSelected.size === 0) {
        const hint = el("div", "");
        hint.style.cssText = "padding:40px;text-align:center;color:var(--tv-text-muted)";
        hint.textContent = "Select sessions above to compare side by side";
        contentArea.appendChild(hint);
        return;
      }
      const sbsContainer = el("div", "cnv-sbs-container");
      const indices = [...sbsSelected].sort((a, b) => a - b);
      for (const si of indices) {
        const column = el("div", "cnv-sbs-column");
        const colHeader = el("div", "cnv-sbs-column-header");
        colHeader.textContent = sessionLabels[si];
        column.appendChild(colHeader);
        renderSession(column, trajectories[si], options);
        sbsContainer.appendChild(column);
      }
      contentArea.appendChild(sbsContainer);
    }

    function renderContent() {
      renderPicker();
      contentArea.innerHTML = "";

      if (viewMode === "side-by-side") {
        renderSbs();
      } else {
        const si = typeof viewMode === "number" ? viewMode : 0;
        const wrap = el("div", "cnv-single");
        const header = el("div", "cnv-header");
        header.textContent = "Chat";
        wrap.appendChild(header);
        renderSession(wrap, trajectories[si], options);
        contentArea.appendChild(wrap);
      }
    }

    renderContent();
  },
};

function renderSession(container: HTMLElement, traj: Trajectory, options: ViewOptions): void {
  const events = traj.events;
  if (events.length === 0) return;

  // Pre-build O(1) lookup: tool_call ID → result event
  const toolResultMap = new Map<number, TrajectoryEvent>();
  for (const e of events) {
    if (e.type === "tool_result" && e.toolResult?.toolCallEventId != null) {
      toolResultMap.set(e.toolResult.toolCallEventId, e);
    }
  }

  // Group events by turn (or by time proximity)
  const groups = groupByTurn(events);

  for (const group of groups) {
    const groupEl = el("div", "cnv-group");

    const ts = group[0].timestamp;
    if (ts) {
      const time = el("div", "cnv-time");
      time.textContent = new Date(ts).toLocaleTimeString();
      groupEl.appendChild(time);
    }

    for (const ev of group) {
      const rendered = renderEvent(ev, toolResultMap, options);
      if (rendered) groupEl.appendChild(rendered);
    }

    container.appendChild(groupEl);
  }
}

function groupByTurn(events: TrajectoryEvent[]): TrajectoryEvent[][] {
  const groups: TrajectoryEvent[][] = [];
  let current: TrajectoryEvent[] = [];
  let lastTurn = -1;
  let lastTime = 0;

  for (const ev of events) {
    const turn = ev.turnIndex ?? -1;
    const time = new Date(ev.timestamp).getTime();
    const gap = lastTime > 0 ? time - lastTime : 0;

    // New group if turn changes or large time gap (>30s)
    if (current.length > 0 && (turn !== lastTurn && turn >= 0 || gap > 30000)) {
      groups.push(current);
      current = [];
    }

    current.push(ev);
    if (turn >= 0) lastTurn = turn;
    if (!isNaN(time)) lastTime = time;
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function renderEvent(ev: TrajectoryEvent, toolResultMap: Map<number, TrajectoryEvent>, options: ViewOptions): HTMLElement | null {
  if (ev.type === "message") {
    return renderMessage(ev);
  }

  if (ev.type === "thinking") {
    return renderThinking(ev);
  }

  if (ev.type === "system") {
    return renderSystem(ev);
  }

  if (ev.type === "tool_call") {
    const resultEvent = toolResultMap.get(ev.id);
    return renderToolCall(ev, resultEvent);
  }

  if (ev.type === "error") {
    return renderError(ev);
  }

  // Skip tool_result (rendered with tool_call)
  return null;
}

function renderMessage(ev: TrajectoryEvent): HTMLElement {
  const row = el("div", `cnv-row cnv-row-${ev.role}`);

  if (ev.role === "system") {
    const bubble = el("div", "cnv-bubble cnv-bubble-system");
    bubble.textContent = ev.content ?? "";
    row.appendChild(bubble);
    return row;
  }

  const wrap = el("div", "");

  const bubble = el("div", ev.role === "user" ? "cnv-bubble cnv-bubble-user" : "cnv-bubble cnv-bubble-assistant");
  const text = ev.content ?? "";
  bubble.textContent = text.length > 3000 ? text.slice(0, 3000) + "\n... (truncated)" : text;
  wrap.appendChild(bubble);

  row.appendChild(wrap);
  return row;
}

function renderThinking(ev: TrajectoryEvent): HTMLElement {
  const row = el("div", "cnv-row cnv-row-assistant");
  const bubble = el("div", "cnv-thinking");
  const text = ev.content ?? "";
  bubble.textContent = text.length > 1000 ? text.slice(0, 1000) + "\n... (truncated)" : text;
  row.appendChild(bubble);
  return row;
}

function renderSystem(ev: TrajectoryEvent): HTMLElement {
  const row = el("div", "cnv-row cnv-row-system");
  const bubble = el("div", "cnv-bubble cnv-bubble-system");
  bubble.textContent = ev.content ?? "";
  row.appendChild(bubble);
  return row;
}

function renderToolCall(ev: TrajectoryEvent, resultEvent: TrajectoryEvent | undefined): HTMLElement {
  const row = el("div", "cnv-row cnv-row-assistant");
  const tool = el("div", "cnv-tool");
  const card = el("div", "cnv-tool-card");

  // Header
  const header = el("div", "cnv-tool-header");
  const icon = el("span", "cnv-tool-icon");
  icon.textContent = "\u2699";
  header.appendChild(icon);

  const name = el("span", "cnv-tool-name");
  name.textContent = ev.toolCall?.name ?? "unknown";
  header.appendChild(name);

  if (ev.durationMs) {
    const dur = el("span", "cnv-tool-duration");
    dur.textContent = fmtDur(ev.durationMs);
    header.appendChild(dur);
  }

  if (resultEvent?.toolResult?.isError) {
    const errBadge = el("span", "cnv-tool-error");
    errBadge.textContent = "ERROR";
    header.appendChild(errBadge);
  } else if (resultEvent) {
    const okBadge = el("span", "cnv-tool-ok");
    okBadge.textContent = "OK";
    header.appendChild(okBadge);
  }

  card.appendChild(header);

  // Args (compact)
  const args = ev.toolCall?.arguments;
  if (args) {
    const argsEl = el("div", "cnv-tool-args");
    const argsText = typeof args === "string" ? args : summarizeArgs(args);
    argsEl.textContent = argsText;
    argsEl.addEventListener("click", () => argsEl.classList.toggle("cnv-expanded"));
    card.appendChild(argsEl);
  }

  // Result
  if (resultEvent?.toolResult?.output) {
    const resultDiv = el("div", "cnv-tool-result");
    const resultText = el("div", `cnv-tool-result-text ${resultEvent.toolResult.isError ? "cnv-tool-error" : ""}`);
    const out = resultEvent.toolResult.output;
    resultText.textContent = out.length > 500 ? "..." + out.slice(-500) : out;
    resultText.addEventListener("click", () => {
      resultText.classList.toggle("cnv-expanded");
      if (resultText.classList.contains("cnv-expanded")) {
        resultText.textContent = out;
      } else {
        resultText.textContent = out.length > 500 ? "..." + out.slice(-500) : out;
      }
    });
    resultDiv.appendChild(resultText);
    card.appendChild(resultDiv);
  }

  tool.appendChild(card);
  row.appendChild(tool);
  return row;
}

function renderError(ev: TrajectoryEvent): HTMLElement {
  const row = el("div", "cnv-row cnv-row-system");
  const bubble = el("div", "cnv-bubble cnv-bubble-system");
  bubble.style.color = "var(--tv-error)";
  bubble.style.fontWeight = "600";
  bubble.textContent = ev.content ?? "Error occurred";
  row.appendChild(bubble);
  return row;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === "string") {
      const short = val.length > 80 ? val.slice(0, 80) + "..." : val;
      parts.push(`${key}: ${short}`);
    } else if (val != null) {
      const s = JSON.stringify(val);
      const short = s.length > 60 ? s.slice(0, 60) + "..." : s;
      parts.push(`${key}: ${short}`);
    }
  }
  return parts.join("\n");
}

function fmtDur(ms: number): string {
  if (ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
