/**
 * File Impact View — which files were read, edited, created, and how they relate.
 * Shows file cards with access counts, dependency graph, and hot file highlighting.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

interface FileInfo {
  path: string;
  reads: number;
  edits: number;
  creates: number;
  firstAccess: string;
  lastAccess: string;
  errors: number;
}

type AccessType = "read" | "edit" | "create";

const READ_TOOLS = ["read", "readfile", "readfilerange", "grep", "searchfiles", "glob", "listfiles", "gitshowfile", "gitblame"];
const EDIT_TOOLS = ["edit", "editfile", "editlines"];
const CREATE_TOOLS = ["write", "writefile"];

function classifyTool(name: string): AccessType | null {
  const n = name.toLowerCase().replace(/^mcp__\w+__/, "");
  if (READ_TOOLS.some((t) => n.includes(t))) return "read";
  if (EDIT_TOOLS.some((t) => n.includes(t))) return "edit";
  if (CREATE_TOOLS.some((t) => n.includes(t))) return "create";
  return null;
}

function extractFilePath(args: Record<string, unknown> | string | undefined): string | null {
  if (!args) return null;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return null; }
  }
  const obj = args as Record<string, unknown>;
  const fp = (obj.file_path ?? obj.path ?? obj.filepath ?? obj.file ?? obj.pattern ?? null) as string | null;
  if (!fp || typeof fp !== "string") return null;
  // Skip glob patterns without real paths
  if (fp.includes("*") && !fp.includes("/")) return null;
  return fp;
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return parts.join("/");
  return ".../" + parts.slice(-3).join("/");
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function buildFileMap(trajectories: Trajectory[]): Map<string, FileInfo> {
  const files = new Map<string, FileInfo>();

  for (const traj of trajectories) {
    const events = traj.events;
    // Pre-build O(1) result lookup
    const resultMap = new Map<number, TrajectoryEvent>();
    for (const e of events) {
      if (e.type === "tool_result" && e.toolResult?.toolCallEventId != null)
        resultMap.set(e.toolResult.toolCallEventId, e);
    }
    for (const ev of events) {
      if (ev.type !== "tool_call" || !ev.toolCall) continue;
      const access = classifyTool(ev.toolCall.name);
      if (!access) continue;
      const fp = extractFilePath(ev.toolCall.arguments as Record<string, unknown>);
      if (!fp) continue;

      const normalized = fp.replace(/\\/g, "/");
      if (!files.has(normalized)) {
        files.set(normalized, { path: normalized, reads: 0, edits: 0, creates: 0, firstAccess: ev.timestamp, lastAccess: ev.timestamp, errors: 0 });
      }
      const info = files.get(normalized)!;
      if (access === "read") info.reads++;
      else if (access === "edit") info.edits++;
      else if (access === "create") info.creates++;
      info.lastAccess = ev.timestamp;

      // Check if the result was an error
      const result = resultMap.get(ev.id);
      if (result?.toolResult?.isError) info.errors++;
    }
  }

  return files;
}

function buildDependencies(trajectories: Trajectory[]): Map<string, Set<string>> {
  // If file A was read, and then file B was edited within 5 events, A -> B dependency
  const deps = new Map<string, Set<string>>();

  for (const traj of trajectories) {
    const events = traj.events.filter((e) => e.type === "tool_call" && e.toolCall);
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const access = classifyTool(ev.toolCall!.name);
      if (access !== "read") continue;
      const readPath = extractFilePath(ev.toolCall!.arguments as Record<string, unknown>);
      if (!readPath) continue;
      const normalized = readPath.replace(/\\/g, "/");

      // Look ahead up to 5 tool calls for edits
      for (let j = i + 1; j < Math.min(i + 6, events.length); j++) {
        const next = events[j];
        const nextAccess = classifyTool(next.toolCall!.name);
        if (nextAccess !== "edit" && nextAccess !== "create") continue;
        const editPath = extractFilePath(next.toolCall!.arguments as Record<string, unknown>);
        if (!editPath) continue;
        const normEdit = editPath.replace(/\\/g, "/");
        if (normEdit === normalized) continue;
        if (!deps.has(normalized)) deps.set(normalized, new Set());
        deps.get(normalized)!.add(normEdit);
      }
    }
  }
  return deps;
}

export const fileImpactView: TrajectoryView = {
  id: "file-impact",
  name: "Files",
  description: "File access patterns, hot files, and dependency graph",
  icon: "f",
  tier: "standard",
  requires: ["tools"],

  css: `
    .fi { font-family: var(--tv-font); }
    .fi-section { background: var(--tv-bg-card); border: 1px solid var(--tv-border); border-radius: var(--tv-radius); padding: 16px 20px; margin-bottom: 14px; }
    .fi-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    .fi-stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
    .fi-stat { background: var(--tv-bg); border: 1px solid var(--tv-border); border-radius: var(--tv-radius-sm); padding: 8px 14px; }
    .fi-stat-label { font-size: 11px; color: var(--tv-text-muted); }
    .fi-stat-val { font-size: 20px; font-weight: 700; font-family: var(--tv-mono); }
    .fi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; }
    .fi-card { background: var(--tv-bg); border: 1px solid var(--tv-border); border-radius: var(--tv-radius-sm); padding: 12px 14px; }
    .fi-card-hot { border-color: #ed8936; border-width: 2px; }
    .fi-card-name { font-family: var(--tv-mono); font-size: 13px; font-weight: 700; word-break: break-all; }
    .fi-card-path { font-family: var(--tv-mono); font-size: 10px; color: var(--tv-text-muted); word-break: break-all; margin-bottom: 6px; }
    .fi-card-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .fi-badge { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600; }
    .fi-badge-read { background: #bee3f8; color: #2a4365; }
    .fi-badge-edit { background: #fefcbf; color: #744210; }
    .fi-badge-create { background: #c6f6d5; color: #22543d; }
    .fi-badge-error { background: #fed7d7; color: #9b2c2c; }
    .fi-badge-hot { background: #ed8936; color: #fff; }
    .fi-card-time { font-size: 10px; color: var(--tv-text-muted); margin-top: 4px; }
    .fi-dep { padding: 4px 0; border-bottom: 1px solid var(--tv-border); font-size: 12px; font-family: var(--tv-mono); display: flex; align-items: center; gap: 6px; }
    .fi-dep:last-child { border-bottom: none; }
    .fi-dep-arrow { color: var(--tv-text-muted); }
    .fi-dep-from { color: #4299e1; }
    .fi-dep-to { color: #ed8936; }
    .fi-empty { padding: 40px; text-align: center; color: var(--tv-text-muted); }
  `,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    container.classList.add("fi");

    const fileMap = buildFileMap(trajectories);

    if (fileMap.size === 0) {
      const empty = el("div", "fi-empty");
      empty.textContent = "No file access detected in selected sessions.";
      container.appendChild(empty);
      return;
    }

    const files = [...fileMap.values()].sort((a, b) => (b.reads + b.edits + b.creates) - (a.reads + a.edits + a.creates));
    const hotThreshold = Math.max(3, Math.ceil(files[0] ? (files[0].reads + files[0].edits + files[0].creates) * 0.5 : 3));

    // --- Summary Stats ---
    const statsSection = el("div", "fi-section");
    const statsTitle = el("div", "fi-title");
    statsTitle.textContent = "File Impact Overview";
    statsSection.appendChild(statsTitle);

    const totalReads = files.reduce((s, f) => s + f.reads, 0);
    const totalEdits = files.reduce((s, f) => s + f.edits, 0);
    const totalCreates = files.reduce((s, f) => s + f.creates, 0);
    const hotFiles = files.filter((f) => f.reads + f.edits + f.creates >= hotThreshold);

    const stats = el("div", "fi-stats");
    const statItems = [
      { label: "Files Touched", value: String(files.length) },
      { label: "Total Reads", value: String(totalReads) },
      { label: "Total Edits", value: String(totalEdits) },
      { label: "Created", value: String(totalCreates) },
      { label: "Hot Files", value: String(hotFiles.length) },
    ];
    for (const s of statItems) {
      const item = el("div", "fi-stat");
      const lbl = el("div", "fi-stat-label");
      lbl.textContent = s.label;
      const val = el("div", "fi-stat-val");
      val.textContent = s.value;
      item.appendChild(lbl);
      item.appendChild(val);
      stats.appendChild(item);
    }
    statsSection.appendChild(stats);
    container.appendChild(statsSection);

    // --- File Cards ---
    const cardsSection = el("div", "fi-section");
    const cardsTitle = el("div", "fi-title");
    cardsTitle.textContent = `Files (${files.length})`;
    cardsSection.appendChild(cardsTitle);

    const grid = el("div", "fi-grid");
    for (const f of files) {
      const totalAccess = f.reads + f.edits + f.creates;
      const isHot = totalAccess >= hotThreshold;
      const card = el("div", `fi-card ${isHot ? "fi-card-hot" : ""}`);

      const name = el("div", "fi-card-name");
      name.textContent = fileName(f.path);
      card.appendChild(name);

      const path = el("div", "fi-card-path");
      path.textContent = shortPath(f.path);
      card.appendChild(path);

      const badges = el("div", "fi-card-badges");
      if (f.reads > 0) {
        const b = el("span", "fi-badge fi-badge-read");
        b.textContent = `${f.reads} reads`;
        badges.appendChild(b);
      }
      if (f.edits > 0) {
        const b = el("span", "fi-badge fi-badge-edit");
        b.textContent = `${f.edits} edits`;
        badges.appendChild(b);
      }
      if (f.creates > 0) {
        const b = el("span", "fi-badge fi-badge-create");
        b.textContent = `${f.creates} creates`;
        badges.appendChild(b);
      }
      if (f.errors > 0) {
        const b = el("span", "fi-badge fi-badge-error");
        b.textContent = `${f.errors} errors`;
        badges.appendChild(b);
      }
      if (isHot) {
        const b = el("span", "fi-badge fi-badge-hot");
        b.textContent = "HOT";
        badges.appendChild(b);
      }
      card.appendChild(badges);

      const time = el("div", "fi-card-time");
      try {
        const first = new Date(f.firstAccess).toLocaleTimeString();
        const last = new Date(f.lastAccess).toLocaleTimeString();
        time.textContent = first === last ? `at ${first}` : `${first} - ${last}`;
      } catch { time.textContent = ""; }
      card.appendChild(time);

      grid.appendChild(card);
    }
    cardsSection.appendChild(grid);
    container.appendChild(cardsSection);

    // --- Dependency Graph ---
    const deps = buildDependencies(trajectories);
    if (deps.size > 0) {
      const depSection = el("div", "fi-section");
      const depTitle = el("div", "fi-title");
      depTitle.textContent = "File Dependencies (read A -> then edited B)";
      depSection.appendChild(depTitle);

      const entries = [...deps.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 20);
      for (const [from, toSet] of entries) {
        for (const to of toSet) {
          const row = el("div", "fi-dep");
          const fromSpan = el("span", "fi-dep-from");
          fromSpan.textContent = fileName(from);
          fromSpan.title = from;
          row.appendChild(fromSpan);
          const arrow = el("span", "fi-dep-arrow");
          arrow.textContent = " -> ";
          row.appendChild(arrow);
          const toSpan = el("span", "fi-dep-to");
          toSpan.textContent = fileName(to);
          toSpan.title = to;
          row.appendChild(toSpan);
          depSection.appendChild(row);
        }
      }
      container.appendChild(depSection);
    }
  },
};

