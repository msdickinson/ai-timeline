/**
 * Diff View — shows only file edit events as cards with before/after content.
 * Filters to tool calls containing "edit", "write", "patch", "apply".
 */

import { Trajectory, TrajectoryEvent, getSessionLabel } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

// Explicit allowlist of file-editing tools across the harnesses we support.
// Loose substring matching ("includes('write')") was catching TodoWrite,
// MemoryWrite, etc. — they have nothing to do with files.
//
// Listed in lowercase; we lowercase the candidate before comparing.
const EDIT_TOOL_NAMES = new Set([
  // Anthropic Claude Code
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  // Anthropic Computer Use / str_replace family
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "str_replace",
  // OpenHands / VETT
  "file_editor",
  "file_edit",
  // Cursor / Cline / Aider
  "edit_file",
  "create_file",
  "write_file",
  "replace_in_file",
  "apply_diff",
  "apply_patch",
  // Generic
  "patch",
]);

// File-editor sub-commands that we DON'T want to render as edits — they're
// read/inspect operations that happen to flow through the same tool.
// (Used to filter file_editor calls by their `command` argument.)
const FILE_EDITOR_READ_COMMANDS = new Set(["view", "list_dir", "exists"]);

function isEditTool(name: string, args?: Record<string, unknown> | string): boolean {
  const lower = (name ?? "").toLowerCase();
  if (!EDIT_TOOL_NAMES.has(lower)) return false;
  // For tools that wrap multiple commands behind one name (file_editor's
  // {view, create, str_replace, insert, undo_edit}), peek at the command
  // and skip read-only ones. Otherwise the diff list fills with view ops
  // that aren't really file edits.
  if (lower === "file_editor" || lower === "file_edit") {
    const argsObj = typeof args === "string"
      ? safeParseJson(args)
      : (args ?? null);
    const cmd = argsObj && typeof argsObj === "object"
      ? String((argsObj as Record<string, unknown>).command ?? "").toLowerCase()
      : "";
    if (cmd && FILE_EDITOR_READ_COMMANDS.has(cmd)) return false;
  }
  return true;
}

function safeParseJson(s: string): unknown {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try { return JSON.parse(t); } catch { return null; }
}

interface EditInfo {
  toolName: string;
  filename: string;
  callEvent: TrajectoryEvent;
  resultEvent?: TrajectoryEvent;
  args: Record<string, unknown> | string | undefined;
  isError: boolean;
  timestamp: string;
  sessionLabel?: string;
}

function extractFilename(args: Record<string, unknown> | string | undefined): string {
  if (!args) return "unknown file";
  // If args came in as a JSON string (common for VETT live data — the parser
  // synthesises {command, path, …} JSON), parse it and read the path field
  // directly. This works for paths like "/testbed" with no extension that
  // the extension-only regex below would miss.
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          for (const key of ["file_path", "filePath", "path", "filename", "file", "target"]) {
            if (typeof parsed[key] === "string") return parsed[key];
          }
        }
      } catch { /* fall through to regex */ }
    }
    // Plaintext args — find a path-like string with an extension.
    const pathMatch = trimmed.match(/["']?([^\s"']+\.[a-zA-Z0-9]+)["']?/);
    return pathMatch?.[1] ?? "unknown file";
  }
  // Common arg names for file paths
  for (const key of ["file_path", "filePath", "path", "filename", "file", "target"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return "unknown file";
}

function estimateLines(args: Record<string, unknown> | string | undefined, output: string | undefined): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  const content = typeof args === "string" ? args : JSON.stringify(args ?? {});
  // Count newlines in new content as rough estimate
  if (typeof args === "object" && args) {
    const newStr = (args["new_string"] ?? args["content"] ?? args["newContent"] ?? "") as string;
    const oldStr = (args["old_string"] ?? args["oldContent"] ?? "") as string;
    added = (newStr.match(/\n/g) ?? []).length + (newStr.length > 0 ? 1 : 0);
    removed = (oldStr.match(/\n/g) ?? []).length + (oldStr.length > 0 ? 1 : 0);
  } else {
    const lines = content.split("\n").length;
    added = Math.ceil(lines / 2);
  }

  return { added, removed };
}

export const diffView: TrajectoryView = {
  id: "diff",
  name: "Diffs",
  description: "File edits shown as cards with before/after content",
  icon: "\u00B1",
  tier: "standard",
  requires: ["tools"],

  css: `
    .dv { font-family: var(--tv-font); padding: 8px 0; }
    .dv-header { font-size: 16px; font-weight: 700; padding: 12px 0; border-bottom: 1px solid var(--tv-border); margin-bottom: 16px; }
    .dv-stats { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .dv-stat { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 10px 16px; font-size: 13px; }
    .dv-stat-value { font-weight: 700; font-family: var(--tv-mono); font-size: 18px; }
    .dv-stat-label { color: var(--tv-text-secondary); font-size: 11px; margin-top: 2px; }
    .dv-card { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); margin-bottom: 12px; overflow: hidden; }
    .dv-card-header { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--tv-border); cursor: pointer; }
    .dv-card-header:hover { background: var(--tv-bg-hover); }
    .dv-card-tool { font-size: 10px; color: var(--tv-text-muted); background: var(--tv-bg); padding: 2px 6px; border-radius: 3px; }
    .dv-card-file { font-family: var(--tv-mono); font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .dv-card-time { font-size: 11px; color: var(--tv-text-muted); white-space: nowrap; }
    .dv-card-status { font-size: 11px; font-weight: 600; }
    .dv-card-status-ok { color: #48bb78; }
    .dv-card-status-err { color: var(--tv-error); }
    .dv-card-body { display: none; padding: 12px 16px; }
    .dv-card-body.dv-open { display: block; }
    .dv-diff-section { margin-bottom: 10px; }
    .dv-diff-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--tv-text-muted); margin-bottom: 4px; }
    .dv-diff-content { font-family: var(--tv-mono); font-size: 11px; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; padding: 8px; border-radius: 4px; background: var(--tv-bg); border: 1px solid var(--tv-border); }
    .dv-diff-old { border-left: 3px solid var(--tv-error); }
    .dv-diff-new { border-left: 3px solid #48bb78; }
    .dv-diff-patch { border-left: 3px solid #ed8936; }
    .dv-line-stats { font-size: 12px; font-family: var(--tv-mono); }
    .dv-line-add { color: #48bb78; }
    .dv-line-rm { color: var(--tv-error); }
    .dv-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
    .dv-chevron { font-size: 12px; color: var(--tv-text-muted); transition: transform 0.2s; }
    .dv-chevron.dv-open { transform: rotate(90deg); }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], options: ViewOptions): void {
    container.classList.add("dv");

    if (trajectories.length === 0) {
      const empty = el("div", "dv-empty");
      empty.textContent = "No sessions selected";
      container.appendChild(empty);
      return;
    }

    const isMulti = trajectories.length > 1;

    // Collect edit events
    const edits: EditInfo[] = [];
    for (let si = 0; si < trajectories.length; si++) {
      const traj = trajectories[si];
      const events = traj.events;
      const sessionLabel = isMulti ? getSessionLabel(traj, si) : undefined;
      // Pre-build O(1) lookup for tool results
      const resultMap = new Map<number, TrajectoryEvent>();
      for (const e of events) {
        if (e.type === "tool_result" && e.toolResult?.toolCallEventId != null)
          resultMap.set(e.toolResult.toolCallEventId, e);
      }
      for (const ev of events) {
        if (ev.type !== "tool_call") continue;
        const toolName = ev.toolCall?.name ?? "";
        if (!isEditTool(toolName, ev.toolCall?.arguments)) continue;

        const resultEvent = resultMap.get(ev.id);

        edits.push({
          toolName,
          filename: extractFilename(ev.toolCall?.arguments),
          callEvent: ev,
          resultEvent,
          args: ev.toolCall?.arguments,
          isError: resultEvent?.toolResult?.isError ?? false,
          timestamp: ev.timestamp,
          sessionLabel,
        });
      }
    }

    if (edits.length === 0) {
      const empty = el("div", "dv-empty");
      empty.textContent = "No file edits in this session";
      container.appendChild(empty);
      return;
    }

    // Header
    const header = el("div", "dv-header");
    header.textContent = "File Edits";
    container.appendChild(header);

    // Stats
    const uniqueFiles = new Set(edits.map((e) => e.filename));
    let totalAdded = 0;
    let totalRemoved = 0;
    for (const edit of edits) {
      const lines = estimateLines(edit.args, edit.resultEvent?.toolResult?.output);
      totalAdded += lines.added;
      totalRemoved += lines.removed;
    }

    const stats = el("div", "dv-stats");

    const fileStat = el("div", "dv-stat");
    const fileVal = el("div", "dv-stat-value");
    fileVal.textContent = String(uniqueFiles.size);
    fileStat.appendChild(fileVal);
    const fileLab = el("div", "dv-stat-label");
    fileLab.textContent = "Files Modified";
    fileStat.appendChild(fileLab);
    stats.appendChild(fileStat);

    const editStat = el("div", "dv-stat");
    const editVal = el("div", "dv-stat-value");
    editVal.textContent = String(edits.length);
    editStat.appendChild(editVal);
    const editLab = el("div", "dv-stat-label");
    editLab.textContent = "Total Edits";
    editStat.appendChild(editLab);
    stats.appendChild(editStat);

    const lineStat = el("div", "dv-stat");
    const lineVal = el("div", "dv-line-stats");
    const addSpan = el("span", "dv-line-add");
    addSpan.textContent = `+${totalAdded}`;
    const rmSpan = el("span", "dv-line-rm");
    rmSpan.textContent = ` -${totalRemoved}`;
    lineVal.appendChild(addSpan);
    lineVal.appendChild(rmSpan);
    lineStat.appendChild(lineVal);
    const lineLab = el("div", "dv-stat-label");
    lineLab.textContent = "Lines (estimate)";
    lineStat.appendChild(lineLab);
    stats.appendChild(lineStat);

    const errCount = edits.filter((e) => e.isError).length;
    if (errCount > 0) {
      const errStat = el("div", "dv-stat");
      const errVal = el("div", "dv-stat-value");
      errVal.textContent = String(errCount);
      errVal.style.color = "var(--tv-error)";
      errStat.appendChild(errVal);
      const errLab = el("div", "dv-stat-label");
      errLab.textContent = "Failed Edits";
      errStat.appendChild(errLab);
      stats.appendChild(errStat);
    }

    container.appendChild(stats);

    // Edit cards — with session group headers for multi-session
    let lastSession = "";
    for (const edit of edits) {
      if (isMulti && edit.sessionLabel && edit.sessionLabel !== lastSession) {
        lastSession = edit.sessionLabel;
        const sessHeader = el("div", "");
        sessHeader.style.cssText = "padding:8px 12px;font-size:13px;font-weight:700;color:var(--tv-text);background:color-mix(in srgb, var(--tv-accent) 12%, var(--tv-bg-card));border-bottom:2px solid var(--tv-accent);border-radius:var(--tv-radius) var(--tv-radius) 0 0;margin-top:16px;margin-bottom:0";
        sessHeader.textContent = edit.sessionLabel;
        container.appendChild(sessHeader);
      }
      container.appendChild(renderEditCard(edit));
    }
  },
};

function renderEditCard(edit: EditInfo): HTMLElement {
  const card = el("div", "dv-card");

  // Header
  const header = el("div", "dv-card-header");

  const chevron = el("span", "dv-chevron");
  chevron.textContent = "\u25B6";
  header.appendChild(chevron);

  const toolBadge = el("span", "dv-card-tool");
  toolBadge.textContent = edit.toolName;
  header.appendChild(toolBadge);

  const fileLabel = el("span", "dv-card-file");
  fileLabel.textContent = edit.filename;
  fileLabel.title = edit.filename;
  header.appendChild(fileLabel);

  const status = el("span", edit.isError ? "dv-card-status dv-card-status-err" : "dv-card-status dv-card-status-ok");
  status.textContent = edit.isError ? "FAIL" : "OK";
  header.appendChild(status);

  const time = el("span", "dv-card-time");
  time.textContent = edit.timestamp ? new Date(edit.timestamp).toLocaleTimeString() : "";
  header.appendChild(time);

  card.appendChild(header);

  // Body (collapsed by default)
  const body = el("div", "dv-card-body");

  const args = edit.args;
  if (typeof args === "object" && args) {
    const oldStr = (args["old_string"] ?? args["oldContent"] ?? "") as string;
    const newStr = (args["new_string"] ?? args["content"] ?? args["newContent"] ?? "") as string;

    if (oldStr) {
      const sec = el("div", "dv-diff-section");
      const label = el("div", "dv-diff-label");
      label.textContent = "Before";
      sec.appendChild(label);
      const content = el("div", "dv-diff-content dv-diff-old");
      content.textContent = oldStr;
      sec.appendChild(content);
      body.appendChild(sec);
    }

    if (newStr) {
      const sec = el("div", "dv-diff-section");
      const label = el("div", "dv-diff-label");
      label.textContent = oldStr ? "After" : "Content";
      sec.appendChild(label);
      const content = el("div", "dv-diff-content dv-diff-new");
      content.textContent = newStr;
      sec.appendChild(content);
      body.appendChild(sec);
    }

    if (!oldStr && !newStr) {
      const sec = el("div", "dv-diff-section");
      const label = el("div", "dv-diff-label");
      label.textContent = "Arguments";
      sec.appendChild(label);
      const content = el("div", "dv-diff-content dv-diff-patch");
      content.textContent = JSON.stringify(args, null, 2);
      sec.appendChild(content);
      body.appendChild(sec);
    }
  } else if (typeof args === "string") {
    const sec = el("div", "dv-diff-section");
    const label = el("div", "dv-diff-label");
    label.textContent = "Patch";
    sec.appendChild(label);
    const content = el("div", "dv-diff-content dv-diff-patch");
    content.textContent = args;
    sec.appendChild(content);
    body.appendChild(sec);
  }

  // Result output
  if (edit.resultEvent?.toolResult?.output) {
    const sec = el("div", "dv-diff-section");
    const label = el("div", "dv-diff-label");
    label.textContent = edit.isError ? "Error Output" : "Result";
    sec.appendChild(label);
    const content = el("div", `dv-diff-content ${edit.isError ? "dv-diff-old" : "dv-diff-new"}`);
    content.textContent = edit.resultEvent.toolResult.output;
    sec.appendChild(content);
    body.appendChild(sec);
  }

  card.appendChild(body);

  // Toggle
  header.addEventListener("click", () => {
    body.classList.toggle("dv-open");
    chevron.classList.toggle("dv-open");
  });

  return card;
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
