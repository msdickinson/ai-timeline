/**
 * Errors View — shows only error events with context and error rate.
 * Filters to type="error" or toolResult.isError=true.
 */

import { Trajectory, TrajectoryEvent, getSessionLabel } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

interface ErrorInfo {
  event: TrajectoryEvent;
  toolName: string;
  /** The originating tool_call (when found) — used to surface the command
   * / args that actually failed. Without this, a Bash error reads
   * "Exit code 1" with no hint of what was attempted. */
  callEvent: TrajectoryEvent | undefined;
  errorOutput: string;
  contextBefore: TrajectoryEvent | undefined;
  contextAfter: TrajectoryEvent | undefined;
  index: number;
  sessionLabel?: string;
}

export const errorsView: TrajectoryView = {
  id: "errors",
  name: "Errors",
  description: "Error events with context, rate, and tool breakdown",
  icon: "\u26A0",
  tier: "standard",

  css: `
    .ev { font-family: var(--tv-font); padding: 8px 0; }
    .ev-header { font-size: 16px; font-weight: 700; padding: 12px 0; border-bottom: 1px solid var(--tv-border); margin-bottom: 16px; }
    .ev-stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .ev-stat { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 12px 16px; min-width: 120px; }
    .ev-stat-value { font-size: 22px; font-weight: 700; font-family: var(--tv-mono); }
    .ev-stat-label { font-size: 11px; color: var(--tv-text-secondary); margin-top: 2px; }
    .ev-success { background: #065f46; border-color: #10b981; border-radius: var(--tv-radius); padding: 40px; text-align: center; }
    .ev-success-icon { font-size: 32px; margin-bottom: 8px; }
    .ev-success-text { font-size: 16px; font-weight: 600; color: #10b981; }
    .ev-success-sub { font-size: 12px; color: #6ee7b7; margin-top: 4px; }
    .ev-card { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-left: 4px solid var(--tv-warning, #d29922); border-radius: var(--tv-radius); padding: 16px; margin-bottom: 12px; }
    .ev-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
    .ev-card-index { font-size: 11px; font-weight: 700; background: var(--tv-warning, #d29922); color: #fff; padding: 2px 8px; border-radius: 10px; }
    .ev-card-tool { font-family: var(--tv-mono); font-size: 13px; font-weight: 600; }
    .ev-card-time { font-size: 11px; color: var(--tv-text-muted); margin-left: auto; }
    .ev-card-type { font-size: 10px; color: var(--tv-text-muted); background: var(--tv-bg); padding: 2px 6px; border-radius: 3px; }
    .ev-card-output { font-family: var(--tv-mono); font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; padding: 10px; background: var(--tv-bg); border: 1px solid var(--tv-border); border-radius: 4px; margin-bottom: 10px; color: var(--tv-text-secondary); }
    .ev-card-input { margin-bottom: 10px; }
    .ev-card-input-label { font-size: 10px; text-transform: uppercase; color: var(--tv-text-muted); letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600; }
    .ev-card-input-body { font-family: var(--tv-mono); font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow-y: auto; padding: 8px 10px; background: var(--tv-bg); border: 1px solid var(--tv-border); border-left: 3px solid var(--tv-accent, #58a6ff); border-radius: 4px; margin: 0; color: var(--tv-text); }
    .ev-context { border-top: 1px solid var(--tv-border); padding-top: 8px; }
    .ev-context-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--tv-text-muted); margin-bottom: 4px; }
    .ev-context-item { font-size: 11px; color: var(--tv-text-secondary); margin-bottom: 4px; padding: 4px 8px; background: var(--tv-bg); border-radius: 3px; }
    .ev-context-item-type { font-weight: 600; margin-right: 6px; }
    .ev-breakdown { margin-bottom: 20px; }
    .ev-breakdown h4 { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
    .ev-breakdown-row { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; font-size: 12px; }
    .ev-breakdown-name { min-width: 140px; font-family: var(--tv-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ev-breakdown-bar { flex: 1; height: 16px; background: var(--tv-bg); border-radius: 3px; overflow: hidden; }
    .ev-breakdown-fill { height: 100%; background: var(--tv-warning, #d29922); border-radius: 3px; }
    .ev-breakdown-count { min-width: 40px; text-align: right; font-family: var(--tv-mono); }
    .ev-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("ev");

    if (trajectories.length === 0) {
      const empty = el("div", "ev-empty");
      empty.textContent = "No sessions selected";
      container.appendChild(empty);
      return;
    }

    const isMulti = trajectories.length > 1;
    const allEvents = trajectories.flatMap((t) => t.events);
    const toolCalls = allEvents.filter((e) => e.type === "tool_call");
    const toolResults = allEvents.filter((e) => e.type === "tool_result");

    // Build event-to-session label map
    const sessionLabels = trajectories.map((t, i) => getSessionLabel(t, i));
    const eventSessionMap = new Map<number, string>();
    for (let si = 0; si < trajectories.length; si++) {
      for (const ev of trajectories[si].events) eventSessionMap.set(ev.id, sessionLabels[si]);
    }

    // Find error events
    const errors: ErrorInfo[] = [];
    // Pre-build O(1) lookup for tool call events
    const eventById = new Map<number, TrajectoryEvent>();
    for (const e of allEvents) eventById.set(e.id, e);

    for (let i = 0; i < allEvents.length; i++) {
      const ev = allEvents[i];
      const isError = ev.type === "error" || (ev.type === "tool_result" && ev.toolResult?.isError === true);
      if (!isError) continue;

      let toolName = "unknown";
      let errorOutput = ev.content ?? ev.toolResult?.output ?? "";
      let callEvent: TrajectoryEvent | undefined;

      if (ev.type === "tool_result") {
        errorOutput = ev.toolResult?.output ?? errorOutput;
        // Primary: linked toolCallEventId set by the parser
        if (ev.toolResult?.toolCallEventId != null) {
          callEvent = eventById.get(ev.toolResult.toolCallEventId);
          if (callEvent?.toolCall?.name) toolName = callEvent.toolCall.name;
        }
        // Fallback: walk backwards from the result to the most recent
        // tool_call event. Many Claude Code tool_results have a missing
        // or unmatched tool_use_id (older recordings, merged subagent
        // events, edge cases) — but Claude conversations are strictly
        // alternating, so the last tool_call before this result is
        // almost always the originator. Beats showing "unknown".
        if (!callEvent) {
          for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
            const prev = allEvents[j];
            if (prev.type === "tool_call" && prev.toolCall?.name) {
              callEvent = prev;
              if (toolName === "unknown") toolName = prev.toolCall.name;
              break;
            }
          }
        }
      }

      errors.push({
        event: ev,
        toolName,
        callEvent,
        errorOutput,
        contextBefore: i > 0 ? allEvents[i - 1] : undefined,
        contextAfter: i < allEvents.length - 1 ? allEvents[i + 1] : undefined,
        index: errors.length + 1,
        sessionLabel: isMulti ? eventSessionMap.get(ev.id) : undefined,
      });
    }

    // Header
    const header = el("div", "ev-header");
    header.textContent = "Errors";
    container.appendChild(header);

    // No errors - green success
    if (errors.length === 0) {
      const success = el("div", "ev-success");
      const icon = el("div", "ev-success-icon");
      icon.textContent = "\u2713";
      success.appendChild(icon);
      const text = el("div", "ev-success-text");
      text.textContent = "No errors";
      success.appendChild(text);
      const sub = el("div", "ev-success-sub");
      sub.textContent = `${toolCalls.length} tool calls completed successfully`;
      success.appendChild(sub);
      container.appendChild(success);
      return;
    }

    // Stats
    const errorRate = toolResults.length > 0 ? (errors.length / toolResults.length) * 100 : 0;
    const stats = el("div", "ev-stats");

    const errStat = makeStat(String(errors.length), "Total Errors", "var(--tv-warning, #d29922)");
    stats.appendChild(errStat);

    const rateStat = makeStat(`${errorRate.toFixed(1)}%`, "Error Rate", errorRate > 20 ? "var(--tv-error)" : "#ed8936");
    stats.appendChild(rateStat);

    const callsStat = makeStat(String(toolResults.length), "Total Tool Results", "");
    stats.appendChild(callsStat);

    const uniqueTools = new Set(errors.map((e) => e.toolName));
    const toolsStat = makeStat(String(uniqueTools.size), "Tools with Errors", "");
    stats.appendChild(toolsStat);

    container.appendChild(stats);

    // Error breakdown by tool
    if (uniqueTools.size > 1) {
      const breakdown = el("div", "ev-breakdown");
      const heading = el("h4", "");
      heading.textContent = "Errors by Tool";
      breakdown.appendChild(heading);

      const toolErrors: Record<string, number> = {};
      for (const err of errors) {
        toolErrors[err.toolName] = (toolErrors[err.toolName] ?? 0) + 1;
      }

      const sorted = Object.entries(toolErrors).sort((a, b) => b[1] - a[1]);
      const maxErrs = sorted[0]?.[1] ?? 1;

      for (const [name, count] of sorted) {
        const row = el("div", "ev-breakdown-row");

        const nameEl = el("div", "ev-breakdown-name");
        nameEl.textContent = name;
        nameEl.title = name;
        row.appendChild(nameEl);

        const bar = el("div", "ev-breakdown-bar");
        const fill = el("div", "ev-breakdown-fill");
        fill.style.width = `${(count / maxErrs) * 100}%`;
        bar.appendChild(fill);
        row.appendChild(bar);

        const countEl = el("div", "ev-breakdown-count");
        countEl.textContent = String(count);
        row.appendChild(countEl);

        breakdown.appendChild(row);
      }

      container.appendChild(breakdown);
    }

    // Error cards — with session group headers for multi-session
    let lastSession = "";
    for (const err of errors) {
      if (isMulti && err.sessionLabel && err.sessionLabel !== lastSession) {
        lastSession = err.sessionLabel;
        const sessHeader = el("div", "");
        sessHeader.style.cssText = "padding:8px 12px;font-size:13px;font-weight:700;color:var(--tv-text);background:color-mix(in srgb, var(--tv-accent) 12%, var(--tv-bg-card));border-bottom:2px solid var(--tv-accent);border-radius:var(--tv-radius) var(--tv-radius) 0 0;margin-top:16px;margin-bottom:0";
        sessHeader.textContent = err.sessionLabel;
        container.appendChild(sessHeader);
      }
      container.appendChild(renderErrorCard(err));
    }
  },
};

function renderErrorCard(err: ErrorInfo): HTMLElement {
  const card = el("div", "ev-card");

  // Header
  const header = el("div", "ev-card-header");

  const index = el("span", "ev-card-index");
  index.textContent = `#${err.index}`;
  header.appendChild(index);

  const typeBadge = el("span", "ev-card-type");
  typeBadge.textContent = err.event.type;
  header.appendChild(typeBadge);

  const toolLabel = el("span", "ev-card-tool");
  toolLabel.textContent = err.toolName;
  header.appendChild(toolLabel);

  const time = el("span", "ev-card-time");
  time.textContent = err.event.timestamp ? new Date(err.event.timestamp).toLocaleTimeString() : "";
  header.appendChild(time);

  card.appendChild(header);

  // What was attempted — surface the tool call's input. Without this, a
  // Bash error reads "Exit code 1" with no clue what command failed.
  const inputPreview = formatToolInput(err.callEvent);
  if (inputPreview) {
    const inputBlock = el("div", "ev-card-input");
    const inputLabel = el("div", "ev-card-input-label");
    inputLabel.textContent = "Input";
    inputBlock.appendChild(inputLabel);
    const pre = el("pre", "ev-card-input-body");
    pre.textContent = inputPreview;
    inputBlock.appendChild(pre);
    card.appendChild(inputBlock);
  }

  // Error output
  if (err.errorOutput) {
    const output = el("div", "ev-card-output");
    output.textContent = err.errorOutput.length > 2000
      ? "(truncated) ...\n" + err.errorOutput.slice(-2000)
      : err.errorOutput;
    card.appendChild(output);
  }

  // Context
  if (err.contextBefore || err.contextAfter) {
    const ctx = el("div", "ev-context");

    const label = el("div", "ev-context-label");
    label.textContent = "Context";
    ctx.appendChild(label);

    if (err.contextBefore) {
      const item = el("div", "ev-context-item");
      const typeSpan = el("span", "ev-context-item-type");
      typeSpan.textContent = "Before:";
      item.appendChild(typeSpan);
      const desc = document.createTextNode(describeEvent(err.contextBefore));
      item.appendChild(desc);
      ctx.appendChild(item);
    }

    if (err.contextAfter) {
      const item = el("div", "ev-context-item");
      const typeSpan = el("span", "ev-context-item-type");
      typeSpan.textContent = "After:";
      item.appendChild(typeSpan);
      const desc = document.createTextNode(describeEvent(err.contextAfter));
      item.appendChild(desc);
      ctx.appendChild(item);
    }

    card.appendChild(ctx);
  }

  return card;
}

function describeEvent(ev: TrajectoryEvent): string {
  if (ev.type === "tool_call") return `tool_call: ${ev.toolCall?.name ?? "unknown"}`;
  if (ev.type === "tool_result") return `tool_result${ev.toolResult?.isError ? " (error)" : ""}`;
  if (ev.type === "message") return `${ev.role} message`;
  if (ev.type === "thinking") return "thinking";
  if (ev.type === "system") return "system";
  return ev.type;
}

/**
 * Build a compact preview of what the tool was actually asked to do.
 * For Bash: the command. For Edit/Write: the file path. For everything
 * else: the salient args. Returns "" when there's nothing to show.
 */
function formatToolInput(ev: TrajectoryEvent | undefined): string {
  if (!ev || ev.type !== "tool_call" || !ev.toolCall) return "";
  const name = ev.toolCall.name;
  let args = ev.toolCall.arguments;
  if (typeof args === "string") {
    const raw = args;
    try { args = JSON.parse(raw); } catch { return raw.slice(0, 1000); }
  }
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  // Tool-specific salient field(s)
  if (name === "Bash") {
    const cmd = String(a.command ?? "");
    const desc = a.description ? `\n# ${a.description}` : "";
    return cmd + desc;
  }
  if (name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") {
    const fp = a.file_path ?? a.path ?? "";
    const old = a.old_string ?? a.old_text ?? "";
    const oldStr = String(old).split("\n").slice(0, 3).join("\n");
    return `file: ${fp}` + (oldStr ? `\n--- old ---\n${oldStr}` : "");
  }
  if (name === "Write") {
    const fp = a.file_path ?? a.path ?? "";
    const content = String(a.content ?? "");
    return `file: ${fp}\n--- content (first 200 chars) ---\n${content.slice(0, 200)}`;
  }
  if (name === "Read") {
    const fp = a.file_path ?? a.path ?? "";
    const lines = a.offset || a.limit ? ` (offset=${a.offset ?? 0}, limit=${a.limit ?? "default"})` : "";
    return `file: ${fp}${lines}`;
  }
  if (name === "Grep") {
    const pat = a.pattern ?? "";
    const path = a.path ? ` in ${a.path}` : "";
    return `pattern: ${pat}${path}`;
  }
  if (name === "Glob") {
    const pat = a.pattern ?? "";
    const path = a.path ? ` in ${a.path}` : "";
    return `pattern: ${pat}${path}`;
  }
  if (name === "WebFetch") {
    return `url: ${a.url ?? ""}\nprompt: ${String(a.prompt ?? "").slice(0, 200)}`;
  }
  if (name === "WebSearch") {
    return `query: ${a.query ?? ""}`;
  }
  if (name === "Task" || name === "TaskOutput" || name === "TaskStop") {
    const sub = a.subagent_type ?? a.agent_type ?? "";
    const id = a.task_id ?? a.id ?? "";
    const desc = a.description ?? a.prompt ?? "";
    return `${sub ? `subagent: ${sub}\n` : ""}${id ? `id: ${id}\n` : ""}${String(desc).slice(0, 300)}`;
  }
  if (name === "TodoWrite") {
    return JSON.stringify(a.todos ?? a, null, 2).slice(0, 500);
  }

  // Generic: pretty-print, truncate
  return JSON.stringify(a, null, 2).slice(0, 600);
}

function makeStat(value: string, label: string, color: string): HTMLElement {
  const stat = el("div", "ev-stat");
  const valEl = el("div", "ev-stat-value");
  valEl.textContent = value;
  if (color) valEl.style.color = color;
  stat.appendChild(valEl);
  const labEl = el("div", "ev-stat-label");
  labEl.textContent = label;
  stat.appendChild(labEl);
  return stat;
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
