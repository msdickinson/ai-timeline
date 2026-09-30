/**
 * AI Timeline — Standalone Web App
 * Reads AI coding tool session files and shows diagnostics + analytics.
 * 100% offline. Your data never leaves your machine.
 */

import { Trajectory, TrajectoryEvent, TrajectorySummary, computeSummary, fillEventDurations, ExportPackage, BenchmarkRun, BenchmarkInstance, TrajectoryIndex } from "../common/types";
import { linkSubagents } from "../common/merge-subagents";
import {
  parseFile,
  getAllViews,
  getView,
  checkDataAvailability,
  isViewUsable,
  getRequirementLabel,
  getDefaultViewId,
  ViewOptions,
  TrajectoryView,
  getAllDataSources,
  getDataSource,
  type DataSource,
  type DataSourceCallbacks,
  type DataSourcePhase,
} from "../common/registry";
import { parseFileAsync } from "./parse-bridge";
// morphdom patches an existing DOM tree to match a freshly-built one, only
// touching nodes that actually changed. We use it on the live-update path
// so a token counter ticking up doesn't tear down the surrounding card —
// only the text node with the number updates.
import morphdom from "morphdom";
// Load all plugins (parsers + views) — this is the single entry point
import "../plugins";

// ── Known Locations ────────────────────────────────────────────────────

interface KnownSource {
  id: string;
  name: string;
  description: string;
  /** OS-aware path info (computed at runtime) */
  paths: () => PathInfo;
  color: string;
  /** Live sources don't pick a folder — they open a host:port input. */
  isLive?: boolean;
}

/** Detect OS from user agent */
function getOS(): "windows" | "mac" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

interface PathInfo {
  /** Path to display */
  display: string;
  /** Exact path to copy (ready to paste into address bar) */
  copyPath: string;
  /** Human-readable instructions */
  hint: string;
}

function getClaudePaths(): PathInfo {
  // Pick the .claude parent folder rather than .claude/projects directly,
  // so the recursive walk also picks up archived sessions in
  // .claude/projects-archive/ (or any other sibling archive folder you
  // created to slim down what Claude Code itself scans).
  const os = getOS();
  if (os === "windows") {
    return {
      display: "%USERPROFILE%\\.claude",
      copyPath: "%USERPROFILE%\\.claude",
      hint: "Paste this into the folder picker. Loads both projects/ (active) and projects-archive/ (anything you moved out of Claude Code's active set).",
    };
  }
  if (os === "mac") {
    return {
      display: "~/.claude/",
      copyPath: "~/.claude/",
      hint: 'In the picker, press Cmd+Shift+G and paste this path. Loads both projects/ and projects-archive/ — anything you archived to keep Claude Code snappy.',
    };
  }
  return {
    display: "~/.claude/",
    copyPath: "~/.claude/",
    hint: "Hidden folder. Type the path in the address bar or enable hidden files. Loads both projects/ (active) and projects-archive/ (your archived sessions).",
  };
}

function getOpenHandsPaths(): PathInfo {
  const os = getOS();
  if (os === "windows") {
    return {
      display: "Wherever you cloned openhands-eval",
      copyPath: "",
      hint: "Look for benchmarks/results/ inside your OpenHands eval directory.",
    };
  }
  return {
    display: "~/openhands-eval/benchmarks/results/",
    copyPath: "~/openhands-eval/benchmarks/results/",
    hint: "Default path if you cloned openhands-eval to your home directory.",
  };
}

function getSweAgentPaths(): PathInfo {
  const os = getOS();
  if (os === "windows") {
    return {
      display: "Wherever you cloned SWE-agent",
      copyPath: "",
      hint: "Look for trajectories/ inside your SWE-agent directory.",
    };
  }
  return {
    display: "~/SWE-agent/trajectories/",
    copyPath: "~/SWE-agent/trajectories/",
    hint: "Default path if you cloned SWE-agent to your home directory.",
  };
}

function getCursorPaths(): PathInfo {
  const os = getOS();
  if (os === "windows") {
    return {
      display: "%APPDATA%\\Cursor\\User\\globalStorage\\state.vscdb",
      copyPath: "%APPDATA%\\Cursor\\User\\globalStorage",
      hint: "Select the globalStorage folder. The state.vscdb file contains your chat history.",
    };
  }
  if (os === "mac") {
    return {
      display: "~/Library/Application Support/Cursor/User/globalStorage/",
      copyPath: "~/Library/Application Support/Cursor/User/globalStorage/",
      hint: "Press Cmd+Shift+G in Finder and paste this path.",
    };
  }
  return {
    display: "~/.config/Cursor/User/globalStorage/",
    copyPath: "~/.config/Cursor/User/globalStorage/",
    hint: "state.vscdb inside this folder contains your chat history.",
  };
}

function getClinePaths(): PathInfo {
  const os = getOS();
  if (os === "windows") {
    return {
      display: "%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\tasks",
      copyPath: "%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\tasks",
      hint: "Each subfolder is a task. The api_conversation_history.json file inside has the session.",
    };
  }
  if (os === "mac") {
    return {
      display: "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/",
      copyPath: "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/",
      hint: "Press Cmd+Shift+G in Finder and paste this path.",
    };
  }
  return {
    display: "~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/",
    copyPath: "~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/",
    hint: "Each subfolder is a task with api_conversation_history.json inside.",
  };
}

function getAiderPaths(): PathInfo {
  return {
    display: ".aider.chat.history.md in your project root",
    copyPath: "",
    hint: "Aider saves chat history as a markdown file in each project directory.",
  };
}

function getCopilotPaths(): PathInfo {
  const os = getOS();
  if (os === "windows") {
    return {
      display: "%APPDATA%\\Code\\User\\workspaceStorage",
      copyPath: "%APPDATA%\\Code\\User\\workspaceStorage",
      hint: "Chat sessions are inside <hash>/chatSessions/ subfolders.",
    };
  }
  if (os === "mac") {
    return {
      display: "~/Library/Application Support/Code/User/workspaceStorage/",
      copyPath: "~/Library/Application Support/Code/User/workspaceStorage/",
      hint: "Chat sessions are inside <hash>/chatSessions/ subfolders.",
    };
  }
  return {
    display: "~/.config/Code/User/workspaceStorage/",
    copyPath: "~/.config/Code/User/workspaceStorage/",
    hint: "Chat sessions are inside <hash>/chatSessions/ subfolders.",
  };
}

const KNOWN_SOURCES: KnownSource[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Session history from Claude Code CLI & IDE extensions",
    paths: getClaudePaths,
    color: "#4f8ff7",
  },
  {
    id: "cursor",
    name: "Cursor / Windsurf / Trae",
    description: "Chat history from the state.vscdb SQLite database",
    paths: getCursorPaths,
    color: "#00b4d8",
  },
  {
    id: "aider",
    name: "Aider",
    description: "Chat history markdown from your project directory",
    paths: getAiderPaths,
    color: "#22c55e",
  },
  {
    id: "cline",
    name: "Cline / Roo Code",
    description: "Task conversation history from the VSCode extension",
    paths: getClinePaths,
    color: "#f472b6",
  },
  {
    id: "copilot",
    name: "GitHub Copilot Chat",
    description: "Chat session exports from VSCode workspace storage",
    paths: getCopilotPaths,
    color: "#6366f1",
  },
  {
    id: "openhands",
    name: "OpenHands",
    description: "Evaluation output from OpenHands benchmark runs",
    paths: getOpenHandsPaths,
    color: "#f59e0b",
  },
  {
    id: "swe-agent",
    name: "SWE-Agent",
    description: "Trajectory files from SWE-Agent runs",
    paths: getSweAgentPaths,
    color: "#10b981",
  },
  {
    id: "custom",
    name: "Other / Custom Folder",
    description: "Any folder — also supports Codex CLI, Continue.dev, Amazon Q",
    paths: () => ({ display: "Browse to any location", copyPath: "", hint: "Drop any .jsonl, .json, .traj, .md, or .vscdb file. Format is auto-detected." }),
    color: "#8b5cf6",
  },
  // Live source: connects to a running `vett run --live-port <N>` over
  // SSE and streams events into the dashboard in real time. The auto-
  // discovery probe at app start already connects when it finds a VETT
  // live server on the LAN; this card lets users manually point at one
  // when probing isn't reachable (different subnet, custom port, etc).
  {
    id: "vett-live",
    name: "VETT — Live (SSE)",
    description: "Connect to a running `vett run --live-port <N>` for real-time benchmark events",
    paths: () => ({ display: "host:port (e.g. localhost:5151)", copyPath: "", hint: "Start VETT with --live-port <N>, then enter that host:port here." }),
    color: "#ec4899",
    isLive: true,
  },
];

// ── State ──────────────────────────────────────────────────────────────

type SortField = "date" | "source" | "duration" | "toolCalls" | "tokens";
type SortDir = "asc" | "desc";

// Built-in sample: a real Claude Code session on a small demo repo, plus its subagent.
const SAMPLE_SESSION = "claude-code-demo/aac96bcf-5a48-4184-b7d4-679f8875941d.jsonl";
const SAMPLE_SUBAGENT = "claude-code-demo/aac96bcf-5a48-4184-b7d4-679f8875941d/subagents/agent-ade35443be060e82d.jsonl";

const PAGE_SIZE = 100;

interface AppState {
  trajectories: Trajectory[];
  selectedIndex: number;
  /** Multi-select: indices of checked sessions (empty = use selectedIndex) */
  checkedIndices: Set<number>;
  expandedEvents: Set<number>;
  filterTool: string | null;
  filterSource: string | null;
  activeViewId: string;
  sortField: SortField;
  sortDir: SortDir;
  searchQuery: string;
  darkMode: boolean;
  activeTheme: string;
  isLoading: boolean;
  loadingMessage: string;
  /** Cached directory handles for re-scanning */
  scannedDirs: Map<string, FileSystemDirectoryHandle>;
  /** Files found but not yet parsed (for "Load More") */
  pendingFiles: File[];
  /** Total files discovered */
  totalFilesFound: number;
  /** File watcher interval */
  watchInterval: number | null;
  /** True when viewing sample data — nudge to load own files */
  isSampleData: boolean;
  /** True once the user explicitly clicks a view tab — prevents smart default override */
  _userPickedView: boolean;
  /** Known file signatures for change detection */
  knownFiles: Map<string, number>; // filename -> lastModified
  /** Cached reference to the .tv-main element so we can re-render just its
   * contents on live-trajectory updates (avoids full-page flicker). */
  _mainEl: HTMLElement | null;
  /**
   * Active live data sources. Multiple can run concurrently — VETT live and
   * Claude Code live can both feed the same view at once. Keyed by sourceId
   * so calling start("vett-live", ...) twice replaces in place.
   */
  liveSources: Map<string, {
    id: string;
    source: DataSource;
    /** Latest status string from the source (shown in the live banner). */
    status: string;
    /** Lifecycle phase — drives banner color/actions. */
    phase: DataSourcePhase;
    /** ms since epoch when start() was called. */
    startedAt: number;
    /** Latest error from the source (sticky until cleared). */
    error: string | null;
  }>;
  /** Discovered-but-not-yet-connected live source (drives the offer banner). */
  liveDiscovery: {
    sourceId: string;
    label: string;
    config: Record<string, unknown>;
    /** Stable key for sessionStorage dismissal. */
    dismissKey: string;
  } | null;
}

const state: AppState = {
  trajectories: [],
  selectedIndex: -1,
  checkedIndices: new Set(),
  expandedEvents: new Set(),
  filterTool: null,
  filterSource: null,
  activeViewId: getDefaultViewId(),
  sortField: "date",
  sortDir: "desc",
  searchQuery: "",
  // darkMode + activeTheme are pulled from persisted settings on load
  // (see the `let settings = loadSettings()` block below). Defaults
  // here are placeholders for the rare consumer-mode case where
  // settings never load.
  darkMode: window.matchMedia("(prefers-color-scheme: dark)").matches,
  activeTheme: "tv-dataviz",
  isLoading: false,
  loadingMessage: "",
  scannedDirs: new Map(),
  pendingFiles: [],
  totalFilesFound: 0,
  watchInterval: null,
  isSampleData: false,
  _userPickedView: false,
  knownFiles: new Map(),
  liveSources: new Map(),
  liveDiscovery: null,
  _mainEl: null,
};

// ── Directory Handle Persistence (IndexedDB) ──────────────────────────

const DB_NAME = "ai-timeline";
const STORE_NAME = "dir-handles";

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(sourceId: string, handle: FileSystemDirectoryHandle) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, sourceId);
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  } catch { /* IndexedDB not available */ }
}

async function loadSavedHandles(): Promise<Map<string, FileSystemDirectoryHandle>> {
  const map = new Map<string, FileSystemDirectoryHandle>();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const keys = await new Promise<string[]>((resolve) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
    });
    for (const key of keys) {
      const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (handle) map.set(key, handle);
    }
    db.close();
  } catch { /* IndexedDB not available */ }
  return map;
}

async function removeDirHandle(sourceId: string) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(sourceId);
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  } catch {}
  // Also remove metadata
  removeSourceMeta(sourceId);
}

// ── Source Metadata (localStorage) ────────────────────────────────────

interface SourceMeta {
  id: string;
  label: string;
  addedAt: string; // ISO date
}

function loadSourceMetas(): SourceMeta[] {
  try {
    const raw = localStorage.getItem("tv-source-metas");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveSourceMetas(metas: SourceMeta[]) {
  localStorage.setItem("tv-source-metas", JSON.stringify(metas));
}

function getSourceMeta(id: string): SourceMeta | undefined {
  return loadSourceMetas().find((m) => m.id === id);
}

function setSourceMeta(id: string, label: string) {
  const metas = loadSourceMetas();
  const existing = metas.find((m) => m.id === id);
  if (existing) {
    existing.label = label;
  } else {
    metas.push({ id, label, addedAt: new Date().toISOString() });
  }
  saveSourceMetas(metas);
}

function removeSourceMeta(id: string) {
  const metas = loadSourceMetas().filter((m) => m.id !== id);
  saveSourceMetas(metas);
}

function generateSourceId(): string {
  return `source-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Try to re-verify permission and scan a saved handle */
async function tryAutoScan(sourceId: string, handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // Check if we still have permission
    const perm = await (handle as any).queryPermission({ mode: "read" });
    if (perm === "granted") {
      await scanDirectory(handle, sourceId);
      return true;
    }
    // If prompt-able, we could request — but don't auto-prompt on load
    // User will click "Scan Folder" which re-requests
  } catch {}
  return false;
}

// ── Entry Point ────────────────────────────────────────────────────────

export function initApp(root: HTMLElement) {
  // ── Consumer mode: detect embedded export data ──
  const exportPkg = (window as any).__TRAJECTORY_EXPORT__ as ExportPackage | undefined;
  if (exportPkg) {
    initConsumerMode(root, exportPkg);
    return;
  }

  // ── Live data source plumbing ───────────────────────────────────────
  // A DataSource emits Trajectory[] batches via onData. Each batch is the
  // CURRENT FULL VIEW of every trajectory the source has produced so far —
  // the source is responsible for emitting trajectories with stable
  // session.id values across batches so we can dedupe.
  (window as any).__startLiveSource = (
    sourceId: string,
    config: Record<string, unknown>
  ) => startLiveSource(sourceId, config);
  (window as any).__stopLiveSource = () => stopLiveSource();

  // Expose for VS Code extension bridge
  (window as any).__trajectoryViewer = {
    openExport: () => { if (state.trajectories.length > 0) openExportModal(); },
    loadFiles: (files: Array<{ name: string; contents: string }>, append?: boolean) => {
      if (!append) {
        // Clear existing state for fresh session load
        state.trajectories = [];
        state.selectedIndex = -1;
        state.checkedIndices = new Set();
      }
      const newTrajectories: Trajectory[] = [];
      const parseResults: string[] = [];
      for (const f of files) {
        const parsed = parseFile(f.contents, f.name);
        parseResults.push(`${f.name}→${parsed.length}`);
        newTrajectories.push(...parsed);
      }
      // Merge subagents into parents
      const merged = mergeSubagentTrajectories(newTrajectories);
      state.trajectories.push(...merged);
      // Report back to extension for debugging
      if ((window as any).__isVSCodeExtension && (window as any).vscodeDebugReport) {
        (window as any).vscodeDebugReport(`[${files.length} files] ${parseResults.join(", ")} => ${state.trajectories.length} total`);
      }
      if (state.selectedIndex === -1 && state.trajectories.length > 0) {
        state.selectedIndex = 0;
      }
      // Auto-check all trajectories when loading multiple (compare mode)
      if (state.trajectories.length > 1) {
        state.checkedIndices = new Set(state.trajectories.map((_, i) => i));
      }
      renderApp();
    },
  };

  // Check if we have saved sources BEFORE first render
  loadSavedHandles().then(async (handles) => {
    if (handles.size > 0) {
      state.scannedDirs = handles;
      state.isLoading = true;
      state.loadingMessage = "Loading sessions...";
      render(root);
      setupDragDrop(root);

      for (const [sourceId, handle] of handles) {
        await tryAutoScan(sourceId, handle);
      }

      if (state.trajectories.length === 0) {
        state.isLoading = false;
        state.loadingMessage = "";
        renderApp();
      }
    } else {
      render(root);
      setupDragDrop(root);
    }
    // After the initial render is wired, probe known live sources so the
    // banner / auto-connect can fire without blocking first paint.
    void discoverLiveSourcesOnOpen();
  });
}

// ── Consumer Mode ─────────────────────────────────────────────────────

function initConsumerMode(root: HTMLElement, pkg: ExportPackage) {
  // Apply forced theme
  if (pkg.darkModeForced === "dark") state.darkMode = true;
  else if (pkg.darkModeForced === "light") state.darkMode = false;

  // Load trajectories
  state.trajectories = pkg.trajectories;
  if (state.trajectories.length > 0) {
    state.selectedIndex = 0;
  }

  // Store config for consumer rendering
  (window as any).__consumerPkg = pkg;

  render(root);
  setupDragDrop(root);
}

function isConsumerMode(): boolean {
  return !!(window as any).__TRAJECTORY_EXPORT__;
}

function getConsumerPkg(): ExportPackage | null {
  return (window as any).__consumerPkg ?? null;
}

// ── Parse Cache (IndexedDB) ───────────────────────────────────────────

const CACHE_STORE = "parsed-cache";

async function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ai-timeline-cache", 11); // v11: drop unlinked subagents (no orphans cluttering picker / model breakdown)
    req.onupgradeneeded = () => {
      const db = req.result;
      // Clear stale cache on version upgrade
      if (db.objectStoreNames.contains(CACHE_STORE)) {
        db.deleteObjectStore(CACHE_STORE);
      }
      db.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

async function getCachedTrajectories(file: File): Promise<Trajectory[] | null> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE, "readonly");
    const result = await new Promise<Trajectory[] | null>((resolve) => {
      const req = tx.objectStore(CACHE_STORE).get(cacheKey(file));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

async function cacheTrajectories(file: File, trajectories: Trajectory[]) {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE, "readwrite");
    tx.objectStore(CACHE_STORE).put(trajectories, cacheKey(file));
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
  } catch {}
}

// ── File Loading ───────────────────────────────────────────────────────

let isLoadingFiles = false;
/** Maps File objects to their relative path within the scanned directory (for subagent detection) */
const fileRelativePaths = new WeakMap<File, string>();
/** Maps agent ID to description from meta.json */
const agentMetaDescriptions = new Map<string, string>();

async function loadFiles(files: FileList | File[]) {
  if (isLoadingFiles) return; // Guard against concurrent calls
  isLoadingFiles = true;

  // Sort: parent files before subagent files so parents are in the map for merging
  const arr = Array.from(files).sort((a, b) => {
    const aIsSub = (fileRelativePaths.get(a) || "").includes("subagents/") ? 1 : 0;
    const bIsSub = (fileRelativePaths.get(b) || "").includes("subagents/") ? 1 : 0;
    return aIsSub - bIsSub;
  });
  const total = arr.length;
  const loadStart = Date.now();

  // Delay showing the loading banner — if cache is warm, it'll finish before this fires
  state.isLoading = false;
  const loadingTimeout = setTimeout(() => {
    state.isLoading = true;
    state.loadingMessage = `Loading ${total} session${total > 1 ? "s" : ""}...`;
    renderApp();
  }, 300);

  const newTrajectories: Trajectory[] = [];
  let processed = 0;
  let cacheHits = 0;
  let parseFailures: string[] = [];
  let lastUiUpdate = 0;

  for (const file of arr) {
    // Check cache first
    const cached = await getCachedTrajectories(file);
    if (cached) {
      newTrajectories.push(...cached);
      cacheHits++;
      processed++;
    } else {
      const text = await file.text();
      const parseName = fileRelativePaths.get(file) || file.name;
      try {
        const parsed = await parseFileAsync(text, parseName);
        if (parsed.length > 0) {
          newTrajectories.push(...parsed);
          cacheTrajectories(file, parsed);
        } else if (text.trim().length > 50) {
          // Non-empty file that produced no trajectories — likely unrecognized format
          parseFailures.push(file.name);
        }
      } catch (e) {
        console.error(`Parse failed for ${file.name}:`, e);
        parseFailures.push(file.name);
      }
      processed++;
    }

    // Only update UI every 10 files, after 300ms, and not too often
    const now = Date.now();
    const elapsed = now - loadStart;
    if (state.isLoading && (processed === total || (now - lastUiUpdate > 200 && processed % 10 === 0))) {
      lastUiUpdate = now;
      const pct = Math.round((processed / total) * 100);
      state.loadingMessage = `Loading sessions... ${processed}/${total} (${pct}%)${cacheHits > 0 ? ` · ${cacheHits} cached` : ""}`;
      renderLoadingOnly();
      await new Promise((r) => setTimeout(r, 0));
    } else if (!state.isLoading && elapsed > 500 && processed % 20 === 0) {
      // Yield to UI even if banner isn't showing, to keep page responsive
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  clearTimeout(loadingTimeout);
  state.isLoading = false;
  state.loadingMessage = "";

  // Track loaded files for the watcher
  trackLoadedFiles(arr);

  if (newTrajectories.length > 0) {
    // Merge subagent sessions into their parent sessions
    const beforeCount = newTrajectories.length;
    const childCount = newTrajectories.filter(t => t.parentSessionId).length;
    const merged = mergeSubagentTrajectories(newTrajectories);
    if (childCount > 0) {
      const stats = (mergeSubagentTrajectories as unknown as { lastStats?: Record<string, number> }).lastStats;
      if (stats) {
        console.log(
          `[AI Timeline] Merge: ${beforeCount} trajectories, ${childCount} subagents → ` +
          `${stats.merged} merged into parent, ${stats.unlinked} unlinked ` +
          `(${stats.unlinkedNoParentFile} parent not loaded, ${stats.unlinkedSidechain} no path parent, ${stats.unlinkedTemporal} timestamp mismatch). ` +
          `Result: ${merged.length} top-level trajectories.`
        );
      }
    }
    state.trajectories.push(...merged);
    if (state.selectedIndex === -1) {
      state.selectedIndex = 0;
    }
  }
  isLoadingFiles = false;

  // Show parse failure notification
  if (parseFailures.length > 0) {
    const toast = document.createElement("div");
    toast.style.cssText = "position:fixed;bottom:20px;right:20px;background:#991b1b;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,0.3)";
    toast.textContent = parseFailures.length === 1
      ? `Could not parse: ${parseFailures[0]}`
      : `${parseFailures.length} files could not be parsed (unrecognized format)`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  renderApp();

  // Start file watcher after first load
  startFileWatcher();
}

async function scanDirectory(dirHandle: FileSystemDirectoryHandle, sourceId?: string) {
  state.isLoading = true;
  state.loadingMessage = "Scanning folder...";
  renderApp();

  const files: File[] = [];
  let scanned = 0;

  async function walk(dir: FileSystemDirectoryHandle, pathPrefix: string) {
    // values() is in the File System Access API but not yet in TypeScript's DOM lib.
    for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle> }).values()) {
      if (entry.kind === "file") {
        const name = entry.name.toLowerCase();
        if (name.endsWith(".meta.json")) {
          // Load agent meta descriptions
          try {
            const file = await entry.getFile();
            const text = await file.text();
            const meta = JSON.parse(text);
            // Extract agent ID from filename: agent-<id>.meta.json
            const idMatch = entry.name.match(/^agent-([a-z0-9-]+)\.meta\.json$/i);
            if (idMatch && meta.description) {
              agentMetaDescriptions.set(idMatch[1], meta.description);
            }
          } catch {}
        } else if (
          (name.endsWith(".jsonl") ||
          name.endsWith(".json") ||
          name.endsWith(".traj"))
        ) {
          const relPath = pathPrefix + entry.name;
          const file = await entry.getFile();
          files.push(file);
          fileRelativePaths.set(file, relPath);
          scanned++;
          if (scanned % 50 === 0) {
            state.loadingMessage = `Scanning... ${scanned} files found`;
            renderLoadingOnly();
          }
        }
      } else if (entry.kind === "directory") {
        // Skip dirs that never contain session/trajectory files. The
        // .claude tree includes ide/ statsig/ todos/ shell-snapshots/
        // etc. that just slow scanning with no payoff.
        if (![
          "node_modules", ".git", "__pycache__", "venv", ".venv",
          "ide", "statsig", "todos", "shell-snapshots", "plugins",
          "settings.local", "agents", "hooks",
        ].includes(entry.name)) {
          await walk(entry, pathPrefix + entry.name + "/");
        }
      }
    }
  }

  await walk(dirHandle, "");

  if (sourceId) {
    state.scannedDirs.set(sourceId, dirHandle);
    saveDirHandle(sourceId, dirHandle);
  }

  if (files.length > 0) {
    // Separate parent files from subagent files
    const parentFiles: File[] = [];
    const subagentFiles: File[] = [];
    for (const f of files) {
      const relPath = fileRelativePaths.get(f) || "";
      if (relPath.includes("/subagents/") || relPath.includes("\\subagents\\")) {
        subagentFiles.push(f);
      } else {
        parentFiles.push(f);
      }
    }

    // Sort parents by lastModified (most recent first)
    parentFiles.sort((a, b) => b.lastModified - a.lastModified);

    // Load all parents + all their subagents
    const toLoad = [...parentFiles, ...subagentFiles];
    state.pendingFiles = [];
    state.totalFilesFound = parentFiles.length;

    state.loadingMessage = `Loading ${parentFiles.length} sessions${subagentFiles.length > 0 ? ` + ${subagentFiles.length} agents` : ""}...`;
    renderLoadingOnly();

    await loadFiles(toLoad);
  } else {
    state.isLoading = false;
    state.loadingMessage = "";
    renderApp();
  }
}

async function loadMoreFiles() {
  if (state.pendingFiles.length === 0) return;

  const next = state.pendingFiles.slice(0, PAGE_SIZE);
  state.pendingFiles = state.pendingFiles.slice(PAGE_SIZE);
  await loadFiles(next);
}

async function loadAllRemainingFiles() {
  if (state.pendingFiles.length === 0) return;

  const all = state.pendingFiles;
  state.pendingFiles = [];
  await loadFiles(all);
}

// ── Live File Watching ────────────────────────────────────────────────

/** Settings stored in localStorage */
interface Settings {
  watchIntervalMs: number;
  /** View IDs explicitly disabled by user */
  disabledViews: string[];
  /** View IDs explicitly enabled by user (overrides tier defaults, e.g. advanced views) */
  enabledViews: string[];
  /** Per-view CSS overrides keyed by view ID */
  viewCssOverrides: Record<string, string>;
  /**
   * How to display $ cost.
   *   "list"          — public API list price (the old default; misleading
   *                     for subscription users since they pay flat)
   *   "subscription"  — show "Subscription" (no $ figure) for SaaS-priced
   *                     models like Claude Code; $0 for local models
   *   "hidden"        — never show cost
   */
  costMode: "list" | "subscription" | "hidden";
  /** Active theme id (tv-dark, tv-light, tv-dataviz, etc.). Persisted so
   *  the choice survives reloads. */
  activeTheme: string;
}

const DEFAULT_SETTINGS: Settings = {
  watchIntervalMs: 2000, // 2s default — fast enough for live tailing of active runs
  disabledViews: [],
  enabledViews: [],
  viewCssOverrides: {},
  // List price is the default — directionally useful even for subscription
  // users (it's an upper-bound on token cost). The display labels it
  // clearly as "list price" so subscribers know it's not their actual
  // bill. Users can flip to subscription / hidden in Settings.
  costMode: "list",
  activeTheme: "tv-dataviz",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("tv-settings");
    if (raw) {
      const saved = JSON.parse(raw);
      // Migration: old defaults
      // Migrate old defaults forward to the new live-friendly default.
      if (saved.watchIntervalMs === 5000 || saved.watchIntervalMs === 10000) {
        saved.watchIntervalMs = 2000;
      }
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: Settings) {
  localStorage.setItem("tv-settings", JSON.stringify(s));
}

let settings = loadSettings();

// Apply persisted theme to the state object before first render. The
// state literal earlier defaults to tv-dataviz; we overwrite with the
// user's saved choice if one exists.
state.activeTheme = settings.activeTheme;
state.darkMode = !["tv-light", "tv-premium"].includes(settings.activeTheme);

function isViewEnabled(viewId: string): boolean {
  // Explicitly disabled by user
  if (settings.disabledViews.includes(viewId)) return false;
  // Explicitly enabled by user (overrides tier default)
  if (settings.enabledViews?.includes(viewId)) return true;
  // Advanced views are off by default — user must enable in Settings
  const view = getView(viewId);
  if (view?.tier === "advanced") return false;
  return true;
}

function startFileWatcher() {
  // Clear existing watcher if settings changed
  if (state.watchInterval) {
    clearInterval(state.watchInterval);
    state.watchInterval = null;
  }

  if (settings.watchIntervalMs <= 0) return; // disabled

  state.watchInterval = window.setInterval(async () => {
    // Don't check while user is interacting (loading, modal open, etc.)
    if (state.isLoading || state.scannedDirs.size === 0) return;
    if (document.querySelector(".tv-modal-overlay")) return; // modal open
    if (isLoadingFiles) return;

    for (const [sourceId, dirHandle] of state.scannedDirs) {
      try {
        const perm = await (dirHandle as any).queryPermission({ mode: "read" });
        if (perm !== "granted") continue;

        await checkForChanges(dirHandle);
      } catch {
        // Permission lost or handle invalid
      }
    }
  }, settings.watchIntervalMs);
}

async function checkForChanges(dirHandle: FileSystemDirectoryHandle) {
  const newFiles: File[] = [];
  const changedFiles: File[] = [];

  async function walk(dir: FileSystemDirectoryHandle) {
    for await (const entry of (dir as any).values()) {
      if (entry.kind === "file") {
        const name = entry.name.toLowerCase();
        if (name.endsWith(".jsonl") || name.endsWith(".json") || name.endsWith(".traj")) {
          const file = await entry.getFile();
          const key = `${file.name}::${file.size}`;
          const knownMod = state.knownFiles.get(key);

          // No staleness floor — Claude Code / OpenHands / SWE-Agent and the
          // rest write append-only files; we WANT to read mid-flight. The
          // parsers tolerate partial files (truncate at last complete line).

          if (knownMod == null) {
            // New file we haven't seen
            newFiles.push(file);
          } else if (file.lastModified > knownMod) {
            // File changed since we last loaded it
            changedFiles.push(file);
          }
        }
      } else if (entry.kind === "directory") {
        if (!["node_modules", ".git", "__pycache__", "venv", ".venv"].includes(entry.name)) {
          await walk(entry);
        }
      }
    }
  }

  await walk(dirHandle);

  // Only load the most recent new files (limit to 20 per poll to stay fast)
  const toLoad = [...newFiles, ...changedFiles]
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 20);

  if (toLoad.length > 0) {
    // Silently load — no loading banner for background updates.
    const newTrajectories: Trajectory[] = [];
    for (const file of toLoad) {
      const text = await file.text();
      const parseName = fileRelativePaths.get(file) || file.name;
      let parsed: Trajectory[];
      try {
        parsed = await parseFileAsync(text, parseName);
      } catch {
        // Parser failure on a partially-written file is normal — try again
        // on the next tick when more bytes have landed.
        continue;
      }
      newTrajectories.push(...parsed);
      if (parsed.length > 0) {
        cacheTrajectories(file, parsed);
      }
      // Track as known
      state.knownFiles.set(`${file.name}::${file.size}`, file.lastModified);
    }

    if (newTrajectories.length > 0) {
      // Dedupe by session.id — replace updated trajectories in place so the
      // sidebar entry updates rather than gaining a duplicate row.
      mergeLiveTrajectories(newTrajectories);
      // Same incremental path as live-source updates — just rebuild .tv-main
      // (sidebar + active view) without tearing down the header.
      renderTrajectoriesIncremental();
    }
  }
}

/** Track files we've already loaded so the watcher knows what's new */
function trackLoadedFiles(files: File[]) {
  for (const file of files) {
    state.knownFiles.set(`${file.name}::${file.size}`, file.lastModified);
  }
}

// ── Live source persistence ──────────────────────────────────────────
// Remember the user's last successful VETT host:port + whether they want
// auto-reconnect on app open. Stored in localStorage so it survives reloads
// without bloating IndexedDB.

const LIVE_LS = {
  vettHost: "tv-live-vett-host",
  vettPort: "tv-live-vett-port",
  autoConnect: "tv-live-auto-connect",
  dismissedDiscovery: "tv-live-dismissed-discovery", // session-scoped (we use sessionStorage)
};

function getLastVettTarget(): { host: string; port: number } | null {
  try {
    const host = localStorage.getItem(LIVE_LS.vettHost);
    const portRaw = localStorage.getItem(LIVE_LS.vettPort);
    if (!host || !portRaw) return null;
    const port = Number(portRaw);
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host, port };
  } catch { return null; }
}

function rememberVettTarget(host: string, port: number) {
  try {
    localStorage.setItem(LIVE_LS.vettHost, host);
    localStorage.setItem(LIVE_LS.vettPort, String(port));
  } catch { /* private mode etc. */ }
}

function getAutoConnect(): boolean {
  try { return localStorage.getItem(LIVE_LS.autoConnect) === "1"; } catch { return false; }
}

function setAutoConnect(on: boolean) {
  try {
    if (on) localStorage.setItem(LIVE_LS.autoConnect, "1");
    else localStorage.removeItem(LIVE_LS.autoConnect);
  } catch { /* ignore */ }
}

function dismissDiscoveryThisSession(key: string) {
  try { sessionStorage.setItem(LIVE_LS.dismissedDiscovery + ":" + key, "1"); } catch { /* ignore */ }
}

function isDiscoveryDismissedThisSession(key: string): boolean {
  try { return sessionStorage.getItem(LIVE_LS.dismissedDiscovery + ":" + key) === "1"; } catch { return false; }
}

/**
 * Probe a VETT live-port host:port for `/healthz`. Returns true on 200.
 * Short timeout so a missing service doesn't slow app open.
 */
async function probeVettHealthz(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  const url = `http://${host}:${port}/healthz`;
  try {
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { signal: ac.signal, mode: "cors" });
    window.clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * On app open, probe known VETT live-port targets in parallel. If any
 * responds, either auto-connect (when the user has opted in) or show a
 * dismissible discovery banner with one-click connect.
 */
async function discoverLiveSourcesOnOpen() {
  // Don't probe if vett-live is already connected.
  if (state.liveSources.has("vett-live")) return;

  const candidates: Array<{ host: string; port: number; key: string }> = [
    { host: "localhost", port: 5151, key: "localhost:5151" },
  ];
  const remembered = getLastVettTarget();
  if (remembered && (remembered.host !== "localhost" || remembered.port !== 5151)) {
    candidates.push({ host: remembered.host, port: remembered.port, key: `${remembered.host}:${remembered.port}` });
  }

  const results = await Promise.all(
    candidates.map(async (c) => ({ ...c, ok: await probeVettHealthz(c.host, c.port) }))
  );
  const hit = results.find((r) => r.ok);
  if (!hit) return;

  // Auto-connect if the user opted in for this exact target (or any, if remembered matches).
  if (getAutoConnect()) {
    rememberVettTarget(hit.host, hit.port);
    startLiveSource("vett-live", { host: hit.host, port: hit.port });
    return;
  }

  // Otherwise show a dismissible discovery banner above the main view.
  if (isDiscoveryDismissedThisSession(hit.key)) return;
  state.liveDiscovery = {
    sourceId: "vett-live",
    label: `VETT live source detected on ${hit.host}:${hit.port}`,
    config: { host: hit.host, port: hit.port },
    dismissKey: hit.key,
  };
  renderApp();
}

// ── Live data source plumbing ─────────────────────────────────────────
// Live sources push trajectories via onData callbacks. Each batch is the
// FULL view of every trajectory the source has produced — we dedupe by
// session.id so re-emits update in place rather than duplicating.

function mergeLiveTrajectories(incoming: Trajectory[]) {
  const byId = new Map<string, number>();
  for (let i = 0; i < state.trajectories.length; i++) {
    const id = state.trajectories[i]?.session?.id;
    if (id) byId.set(id, i);
  }

  let firstNewIndex = -1;
  for (const t of incoming) {
    const id = t?.session?.id;
    if (!id) continue;
    const existing = byId.get(id);
    if (existing !== undefined) {
      // Replace in place — preserves array index so the selected session
      // doesn't jump if the user clicked one that's still updating.
      state.trajectories[existing] = t;
    } else {
      const idx = state.trajectories.length;
      state.trajectories.push(t);
      byId.set(id, idx);
      if (firstNewIndex === -1) firstNewIndex = idx;
    }
  }

  // Auto-select the first newly-arrived trajectory if nothing's selected.
  if (state.selectedIndex === -1 && state.trajectories.length > 0) {
    state.selectedIndex = firstNewIndex >= 0 ? firstNewIndex : 0;
  }
}

function startLiveSource(sourceId: string, config: Record<string, unknown>) {
  // Replace if same id is already running; leave other sources alone.
  const prior = state.liveSources.get(sourceId);
  if (prior) {
    try { prior.source.stop(); } catch { /* ignore */ }
    state.liveSources.delete(sourceId);
  }

  // Discovery banner is now superseded — clear it.
  state.liveDiscovery = null;

  const source = getDataSource(sourceId);
  if (!source) {
    alert(`Live source "${sourceId}" is not registered.`);
    return;
  }

  // Persist VETT host/port so the next app open can probe it directly.
  if (sourceId === "vett-live") {
    const host = String((config as any).host ?? "");
    const port = Number((config as any).port ?? 0);
    if (host && port > 0) rememberVettTarget(host, port);
  }

  const callbacks: DataSourceCallbacks = {
    onData(trajectories) {
      mergeLiveTrajectories(trajectories);
      // Use the incremental path — only the .tv-main grid is replaced,
      // not the entire app. Drastically reduces flicker for streams that
      // emit batches every few hundred ms.
      renderTrajectoriesIncremental();
    },
    onStatus(message, phase) {
      const entry = state.liveSources.get(sourceId);
      if (entry) {
        entry.status = message;
        const phaseChanged = phase && phase !== entry.phase;
        if (phase) entry.phase = phase;
        // Phase transitions need a re-render (color, button changes).
        // Pure status-text updates can patch the existing text node.
        if (phaseChanged) {
          renderApp();
        } else {
          const text = appRoot?.querySelector<HTMLElement>(
            `.tv-live-banner-row[data-src="${cssEscape(sourceId)}"] .tv-live-banner-text`
          );
          if (text) text.textContent = message;
          else renderApp();
        }
      }
    },
    onError(message) {
      const entry = state.liveSources.get(sourceId);
      if (entry) {
        entry.error = message;
        renderApp();
      } else {
        alert(`Live source error: ${message}`);
      }
    },
  };

  state.liveSources.set(sourceId, {
    id: sourceId,
    source,
    status: "Starting…",
    phase: "connecting",
    startedAt: Date.now(),
    error: null,
  });

  try {
    source.start(config, callbacks);
  } catch (err) {
    const entry = state.liveSources.get(sourceId);
    if (entry) entry.error = String(err);
  }
  renderApp();
}

function stopLiveSource(sourceId?: string) {
  // No id → stop all (used by the legacy "Stop live" button).
  const ids = sourceId ? [sourceId] : Array.from(state.liveSources.keys());
  for (const id of ids) {
    const entry = state.liveSources.get(id);
    if (!entry) continue;
    try { entry.source.stop(); } catch { /* ignore */ }
    state.liveSources.delete(id);
  }
  renderApp();
}

/** Lightweight CSSEscape-equivalent so we can build attribute selectors. */
function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/**
 * Modal — lists all registered DataSources, lets the user configure and
 * start one. Each source supplies its own renderConfig() form; we don't
 * hardcode field names here so adding a new source is purely additive.
 */
function openLiveSourceModal() {
  // The modal is for streaming/network sources only. File-based sources
  // (Claude Code, Cursor, Aider, …) are picked via the regular folder
  // picker and are always live by virtue of the dir watcher polling them
  // — no separate "live" mode needed for files.
  const FILE_BASED_SOURCE_IDS = new Set(["claude-code-live"]);
  const sources = getAllDataSources().filter((s) => !FILE_BASED_SOURCE_IDS.has(s.id));
  if (sources.length === 0) {
    alert("No streaming sources registered.");
    return;
  }

  const overlay = el("div", "tv-modal-overlay");
  const modal = el("div", "tv-modal tv-modal-live");
  modal.innerHTML = `
    <div class="tv-modal-header">
      <h3>Connect to a live source</h3>
      <button class="tv-modal-close" aria-label="Close">&times;</button>
    </div>
    <div class="tv-modal-body">
      <p class="tv-hint">Choose a running session source. Trajectories will appear and update as the source emits events.</p>
      <div class="tv-live-source-list"></div>
      <div class="tv-live-source-config" data-empty="true"></div>
      <label class="tv-live-modal-remember">
        <input type="checkbox" id="tv-live-modal-remember" ${getAutoConnect() ? "checked" : ""}>
        <span>Remember &amp; auto-connect on next open</span>
      </label>
      <div class="tv-modal-actions">
        <button class="tv-btn tv-btn-primary tv-live-start" disabled>Start</button>
        <button class="tv-btn tv-modal-cancel">Cancel</button>
      </div>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const list = modal.querySelector<HTMLDivElement>(".tv-live-source-list")!;
  const configHost = modal.querySelector<HTMLDivElement>(".tv-live-source-config")!;
  const startBtn = modal.querySelector<HTMLButtonElement>(".tv-live-start")!;
  let selected: DataSource | null = null;

  for (const src of sources) {
    const row = el("button", "tv-live-source-row");
    row.innerHTML = `
      <div class="tv-live-source-name">${esc(src.name)}</div>
      <div class="tv-live-source-desc">${esc(src.description)}</div>
    `;
    row.onclick = () => {
      selected = src;
      list.querySelectorAll(".tv-live-source-row").forEach((r) =>
        r.classList.remove("tv-selected")
      );
      row.classList.add("tv-selected");
      configHost.innerHTML = "";
      configHost.removeAttribute("data-empty");
      if (typeof src.renderConfig === "function") {
        src.renderConfig(configHost);
      }
      startBtn.disabled = false;
    };
    list.appendChild(row);
  }

  const closeModal = () => overlay.remove();
  modal.querySelector(".tv-modal-close")!.addEventListener("click", closeModal);
  modal.querySelector(".tv-modal-cancel")!.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  startBtn.onclick = () => {
    if (!selected) return;
    // If the source has a collectConfig method, use it to read inputs.
    let config: Record<string, unknown> = {};
    const collect = (selected as any).collectConfig as
      | ((c: HTMLElement) => Record<string, unknown>)
      | undefined;
    if (typeof collect === "function") {
      config = collect.call(selected, configHost);
    }
    const rememberCb = modal.querySelector<HTMLInputElement>("#tv-live-modal-remember");
    if (rememberCb) setAutoConnect(rememberCb.checked);
    closeModal();
    startLiveSource(selected.id, config);
  };
}

// ── Settings Modal ────────────────────────────────────────────────────

// ── Export ────────────────────────────────────────────────────────────

function openExportMenu(_anchor: HTMLElement) {
  openExportModal();
}

function openExportModal() {
  document.querySelector(".tv-modal-overlay")?.remove();

  const overlay = el("div", "tv-modal-overlay");
  const modal = el("div", "tv-modal");
  modal.style.width = "700px";

  // Header
  const header = el("div", "tv-modal-header");
  header.innerHTML = "<h2>Export</h2>";
  const closeBtn = document.createElement("button");
  closeBtn.className = "tv-btn tv-btn-icon tv-modal-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = el("div", "tv-modal-body");

  // ── Session Selection ──
  const sessSection = el("div", "tv-modal-section");
  sessSection.innerHTML = "<h3>Sessions</h3>";

  const selectAllRow = el("div", "tv-modal-row");
  const selectAllBtn = document.createElement("button");
  selectAllBtn.className = "tv-btn tv-btn-small";
  selectAllBtn.textContent = "Select All";
  const deselectAllBtn = document.createElement("button");
  deselectAllBtn.className = "tv-btn tv-btn-small";
  deselectAllBtn.textContent = "Deselect All";
  selectAllRow.appendChild(selectAllBtn);
  selectAllRow.appendChild(deselectAllBtn);
  sessSection.appendChild(selectAllRow);

  const exportChecked = new Set<number>(
    state.checkedIndices.size > 0
      ? state.checkedIndices
      : state.selectedIndex >= 0 ? [state.selectedIndex] : []
  );

  const sessList = el("div", "tv-export-session-list");
  for (let i = 0; i < state.trajectories.length; i++) {
    const t = state.trajectories[i];
    const row = el("div", "tv-export-session-row");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = exportChecked.has(i);
    cb.onchange = () => { if (cb.checked) exportChecked.add(i); else exportChecked.delete(i); updateCount(); };
    const label = el("span", "");
    const d = t.session.startTime ? new Date(t.session.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    label.textContent = `${t.source} · ${t.session.model ?? t.session.id.slice(0, 12)} · ${d} · ${t.summary?.totalToolCalls ?? 0} tools`;
    label.style.fontSize = "12px";
    row.appendChild(cb);
    row.appendChild(label);
    sessList.appendChild(row);
  }
  sessSection.appendChild(sessList);

  selectAllBtn.onclick = () => {
    sessList.querySelectorAll("input").forEach((cb) => { (cb as HTMLInputElement).checked = true; });
    for (let i = 0; i < state.trajectories.length; i++) exportChecked.add(i);
    updateCount();
  };
  deselectAllBtn.onclick = () => {
    sessList.querySelectorAll("input").forEach((cb) => { (cb as HTMLInputElement).checked = false; });
    exportChecked.clear();
    updateCount();
  };

  body.appendChild(sessSection);

  // ── Branding ──
  const brandSection = el("div", "tv-modal-section");
  brandSection.innerHTML = "<h3>Branding</h3>";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = "AI Timeline";
  titleInput.className = "tv-modal-source-name";
  titleInput.style.width = "100%";
  titleInput.placeholder = "Page title";
  const titleRow = el("div", "tv-modal-row");
  titleRow.innerHTML = "<span>Title</span>";
  titleRow.appendChild(titleInput);
  brandSection.appendChild(titleRow);

  const logoInput = document.createElement("input");
  logoInput.type = "file";
  logoInput.accept = "image/*";
  let logoBase64: string | undefined;
  logoInput.onchange = async () => {
    if (logoInput.files?.[0]) {
      const reader = new FileReader();
      reader.onload = () => { logoBase64 = reader.result as string; };
      reader.readAsDataURL(logoInput.files[0]);
    }
  };
  const logoRow = el("div", "tv-modal-row");
  logoRow.innerHTML = "<span>Logo (optional)</span>";
  logoRow.appendChild(logoInput);
  brandSection.appendChild(logoRow);

  body.appendChild(brandSection);

  // ── Visual Config ──
  const vizSection = el("div", "tv-modal-section");
  vizSection.innerHTML = "<h3>Views & Layout</h3>";

  const allViews = getAllViews();
  const enabledExportViews = new Set(allViews.map((v) => v.id));
  for (const view of allViews) {
    const row = el("div", "tv-export-session-row");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.onchange = () => { if (cb.checked) enabledExportViews.add(view.id); else enabledExportViews.delete(view.id); };
    const label = el("span", "");
    label.textContent = `${view.name} — ${view.description}`;
    label.style.fontSize = "12px";
    row.appendChild(cb);
    row.appendChild(label);
    vizSection.appendChild(row);
  }

  const sidebarCb = document.createElement("input");
  sidebarCb.type = "checkbox";
  sidebarCb.checked = true;
  const sidebarRow = el("div", "tv-export-session-row");
  sidebarRow.appendChild(sidebarCb);
  const sidebarLabel = el("span", "");
  sidebarLabel.textContent = "Show sidebar (session list & search)";
  sidebarLabel.style.fontSize = "12px";
  sidebarRow.appendChild(sidebarLabel);
  vizSection.appendChild(sidebarRow);

  const themeSelect = document.createElement("select");
  themeSelect.className = "tv-settings-select";
  themeSelect.innerHTML = `<option value="">User's choice (toggle)</option><option value="dark">Force dark</option><option value="light">Force light</option>`;
  const themeRow = el("div", "tv-modal-row");
  themeRow.innerHTML = "<span>Theme</span>";
  themeRow.appendChild(themeSelect);
  vizSection.appendChild(themeRow);

  body.appendChild(vizSection);

  // ── Secret Redaction ──
  const redactSection = el("div", "tv-modal-section");
  redactSection.innerHTML = "<h3>Privacy</h3>";

  const redactCb = document.createElement("input");
  redactCb.type = "checkbox";
  redactCb.checked = true;
  const redactRow = el("div", "tv-export-session-row");
  redactRow.appendChild(redactCb);
  const redactLabel = el("span", "");
  redactLabel.textContent = "Redact secrets (API keys, tokens, passwords, private keys, connection strings)";
  redactLabel.style.fontSize = "12px";
  redactRow.appendChild(redactLabel);
  redactSection.appendChild(redactRow);

  const redactWarning = el("div", "");
  redactWarning.style.cssText = "font-size:10px;color:var(--tv-text-muted);padding:2px 0 0 24px;font-style:italic";
  redactWarning.textContent = "Pattern-based detection — catches common formats (sk-*, ghp_*, JWTs, AWS keys, etc.) but may miss custom or non-standard secrets. Review before sharing publicly.";
  redactSection.appendChild(redactWarning);

  // Show scan preview
  const redactPreview = el("div", "");
  redactPreview.style.cssText = "font-size:11px;color:var(--tv-text-muted);padding:4px 0 0 24px";
  redactSection.appendChild(redactPreview);

  // Scan for secrets in selected sessions
  function updateRedactPreview() {
    import("../common/redact").then(({ countSecrets }) => {
      let total = 0;
      for (const idx of exportChecked) {
        const t = state.trajectories[idx];
        if (!t) continue;
        for (const ev of t.events) {
          if (ev.content) total += countSecrets(ev.content);
          if (ev.toolResult?.output) total += countSecrets(ev.toolResult.output);
          if (ev.toolCall?.arguments) {
            const args = typeof ev.toolCall.arguments === "string" ? ev.toolCall.arguments : JSON.stringify(ev.toolCall.arguments);
            total += countSecrets(args);
          }
        }
      }
      redactPreview.textContent = total > 0
        ? `Found ${total} potential secret${total > 1 ? "s" : ""} in selected sessions`
        : "No secrets detected in selected sessions";
    });
  }
  updateRedactPreview();

  body.appendChild(redactSection);

  // ── Benchmark Metadata (optional) ──
  const benchSection = el("div", "tv-modal-section");
  benchSection.innerHTML = "<h3>Benchmark Metadata (optional)</h3><p class='tv-modal-hint'>Tie sessions to benchmark instances with pass/fail results.</p>";

  const benchNameInput = document.createElement("input");
  benchNameInput.type = "text";
  benchNameInput.className = "tv-modal-source-name";
  benchNameInput.style.width = "100%";
  benchNameInput.placeholder = "e.g., SWE-bench Verified Q2 2026";
  const benchNameRow = el("div", "tv-modal-row");
  benchNameRow.innerHTML = "<span>Benchmark name</span>";
  benchNameRow.appendChild(benchNameInput);
  benchSection.appendChild(benchNameRow);

  const harnessInput = document.createElement("input");
  harnessInput.type = "text";
  harnessInput.className = "tv-modal-source-name";
  harnessInput.style.width = "100%";
  harnessInput.placeholder = "e.g., TicketForge, OpenHands, SWE-Agent";
  const harnessRow = el("div", "tv-modal-row");
  harnessRow.innerHTML = "<span>Harness</span>";
  harnessRow.appendChild(harnessInput);
  benchSection.appendChild(harnessRow);

  body.appendChild(benchSection);

  modal.appendChild(body);

  // ── Footer ──
  const footer = el("div", "tv-modal-footer");
  footer.style.gap = "8px";

  const countLabel = el("span", "tv-session-count");
  const updateCount = () => { countLabel.textContent = `${exportChecked.size} sessions selected`; };
  updateCount();
  footer.appendChild(countLabel);

  const spacer = el("div", "tg-spacer");
  footer.appendChild(spacer);

  const jsonBtn = document.createElement("button");
  jsonBtn.className = "tv-btn";
  jsonBtn.textContent = "Export JSON";
  jsonBtn.onclick = () => {
    const targets = [...exportChecked].map((i) => state.trajectories[i]).filter(Boolean);
    const json = JSON.stringify(targets, null, 2);
    downloadFile(json, "trajectories.json", "application/json");
  };
  footer.appendChild(jsonBtn);

  const csvBtn = document.createElement("button");
  csvBtn.className = "tv-btn";
  csvBtn.textContent = "Export CSV";
  csvBtn.onclick = () => {
    const targets = [...exportChecked].map((i) => state.trajectories[i]).filter(Boolean);
    exportAsCsv(targets);
  };
  footer.appendChild(csvBtn);

  const htmlBtn = document.createElement("button");
  htmlBtn.className = "tv-btn tv-btn-primary";
  htmlBtn.textContent = "Export HTML";
  htmlBtn.onclick = async () => {
    const targets = [...exportChecked].map((i) => state.trajectories[i]).filter(Boolean);
    if (targets.length === 0) { alert("Select at least one session"); return; }

    let benchmark: BenchmarkRun | undefined;
    if (benchNameInput.value.trim()) {
      benchmark = {
        name: benchNameInput.value.trim(),
        harness: harnessInput.value.trim() || "Unknown",
        date: new Date().toISOString(),
        instances: targets.map((t) => ({
          instanceId: t.session.metadata?.instanceId as string ?? t.session.id,
          sessionId: t.session.id,
          status: (t.session.status ?? "unknown") as BenchmarkInstance["status"],
        })),
      };
    }

    // Apply secret redaction if enabled
    let exportTargets = targets;
    if (redactCb.checked) {
      const { redactString } = await import("../common/redact");
      exportTargets = targets.map(t => ({
        ...t,
        events: t.events.map(ev => {
          const e = { ...ev };
          if (e.content) e.content = redactString(e.content);
          if (e.toolResult) {
            e.toolResult = { ...e.toolResult };
            if (e.toolResult.output) e.toolResult.output = redactString(e.toolResult.output);
          }
          if (e.toolCall) {
            e.toolCall = { ...e.toolCall };
            if (typeof e.toolCall.arguments === "string") {
              e.toolCall.arguments = redactString(e.toolCall.arguments);
            } else if (e.toolCall.arguments) {
              e.toolCall.arguments = JSON.parse(redactString(JSON.stringify(e.toolCall.arguments)));
            }
          }
          return e;
        }),
      }));
    }

    const pkg = buildExportPackage(exportTargets, {
      title: titleInput.value || "AI Timeline",
      logoBase64,
      darkModeForced: themeSelect.value,
      enabledViews: [...enabledExportViews],
      showSidebar: sidebarCb.checked,
      benchmark,
    });

    htmlBtn.textContent = "Building...";
    htmlBtn.disabled = true;
    await new Promise((r) => setTimeout(r, 0));

    const html = await buildExportHtml(pkg);
    downloadFile(html, `${(titleInput.value || "ai-timeline").replace(/\s+/g, "-").toLowerCase()}.html`, "text/html");

    overlay.remove();
  };
  footer.appendChild(htmlBtn);

  modal.appendChild(footer);
  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") overlay.remove(); });
  overlay.setAttribute("tabindex", "-1");
  setTimeout(() => overlay.focus(), 0);
  appRoot.appendChild(overlay);
}

function exportAsCsv(trajectories: Trajectory[]) {
  const rows = ["session_id,source,timestamp,type,role,tool_name,model,tokens_in,tokens_out,tokens_cached,duration_ms,is_error,content_preview"];
  for (const t of trajectories) {
    for (const e of t.events) {
      const cols = [
        t.session.id, t.source, e.timestamp, e.type, e.role,
        e.toolCall?.name ?? "", e.model ?? "",
        e.tokens?.input ?? "", e.tokens?.output ?? "", e.tokens?.cacheRead ?? "",
        e.durationMs ?? "", e.toolResult?.isError ?? "",
        (e.content ?? e.toolResult?.output ?? "").slice(0, 100).replace(/"/g, '""').replace(/\n/g, " "),
      ];
      rows.push(cols.map((c) => `"${c}"`).join(","));
    }
  }
  downloadFile(rows.join("\n"), "trajectories.csv", "text/csv");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── HTML Export Builder ───────────────────────────────────────────────

const INLINE_LIMIT = 50; // Sessions with full data embedded

function buildExportPackage(trajectories: Trajectory[], config: {
  title: string;
  logoBase64?: string;
  darkModeForced: string;
  enabledViews: string[];
  showSidebar: boolean;
  benchmark?: BenchmarkRun;
}): ExportPackage {
  const isLarge = trajectories.length > INLINE_LIMIT;

  // Build session index for all
  const sessionIndex: TrajectoryIndex[] = trajectories.map((t) => ({
    sessionId: t.session.id,
    source: t.source,
    startTime: t.session.startTime,
    endTime: t.session.endTime,
    model: t.session.model,
    summary: t.summary ?? computeSummary(t.events),
    benchmarkStatus: t.session.status,
    hasFullData: !isLarge || trajectories.indexOf(t) < INLINE_LIMIT,
  }));

  // For large exports, only include full data for first N
  const inlineTrajectories = isLarge ? trajectories.slice(0, INLINE_LIMIT) : trajectories;

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    title: config.title,
    logoBase64: config.logoBase64,
    darkModeForced: config.darkModeForced as any || null,
    enabledViews: config.enabledViews,
    showSidebar: config.showSidebar,
    trajectories: inlineTrajectories,
    sessionIndex: isLarge ? sessionIndex : undefined,
    benchmark: config.benchmark,
  };
}

async function buildExportHtml(pkg: ExportPackage): Promise<string> {
  // Collect all CSS from the current page
  let css = "";
  for (const sheet of document.styleSheets) {
    try {
      css += [...sheet.cssRules].map((r) => r.cssText).join("\n") + "\n";
    } catch {}
  }
  const viewCss = document.getElementById("tv-view-css")?.textContent ?? "";
  css += viewCss;

  // Collect all JS from the current page's script tags
  let js = "";
  for (const script of document.querySelectorAll("script[src]")) {
    const src = (script as HTMLScriptElement).src;
    try {
      const resp = await fetch(src);
      js += await resp.text() + "\n";
    } catch {}
  }
  // Also grab inline module scripts
  for (const script of document.querySelectorAll('script[type="module"]:not([src])')) {
    js += (script as HTMLScriptElement).textContent + "\n";
  }

  const dataJson = JSON.stringify(pkg);
  const logoHtml = pkg.logoBase64
    ? `<img src="${pkg.logoBase64}" style="height:24px;margin-right:8px" alt="">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(pkg.title)}</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>
// Embedded trajectory data — consumer mode
window.__TRAJECTORY_EXPORT__ = JSON.parse(${JSON.stringify(dataJson)});
</script>
<script type="module">
${js}
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Multi-Select Merge ────────────────────────────────────────────────

/** Returns array of active trajectories — views handle N natively */
function getActiveTrajectories(): Trajectory[] {
  if (state.checkedIndices.size > 0) {
    return [...state.checkedIndices].map((i) => state.trajectories[i]).filter(Boolean);
  }
  if (state.selectedIndex >= 0 && state.trajectories[state.selectedIndex]) {
    return [state.trajectories[state.selectedIndex]];
  }
  return [];
}

async function addNewSource() {
  if (!("showDirectoryPicker" in window)) return;
  try {
    const dirHandle = await (window as any).showDirectoryPicker({ mode: "read", startIn: "desktop" });
    // Use the folder name as default label
    const defaultName = dirHandle.name || "Unnamed Source";
    const label = prompt("Name this source (e.g. 'Claude Code - Work', 'OpenHands Benchmarks'):", defaultName);
    if (label == null) return; // cancelled

    const sourceId = generateSourceId();
    setSourceMeta(sourceId, label || defaultName);
    await scanDirectory(dirHandle, sourceId);
  } catch {
    // User cancelled folder picker
  }
}

function openSessionModal() {
  document.querySelector(".tv-session-modal-overlay")?.remove();

  const overlay = el("div", "tv-session-modal-overlay");
  const panel = el("div", "tv-session-panel");

  // Track checked sessions locally (copy from state)
  const checked = new Set(state.checkedIndices);

  // Header
  const header = el("div", "tv-session-panel-header");
  const titleEl = document.createElement("h3");
  const topLevelCount = state.trajectories.filter(t => !t.parentSessionId).length;
  const subagentCount = state.trajectories.length - topLevelCount;
  titleEl.textContent = subagentCount > 0
    ? `${topLevelCount} Sessions · ${subagentCount} subagents`
    : `${topLevelCount} Sessions`;
  header.appendChild(titleEl);

  const headerBtns = el("div", "tv-sp-header-btns");

  // "View N selected" button — appears when multi-select is active
  const viewSelBtn = document.createElement("button");
  viewSelBtn.className = "tv-btn tv-btn-primary tv-sp-view-btn";
  viewSelBtn.style.display = "none";
  headerBtns.appendChild(viewSelBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "tv-btn tv-btn-icon";
  closeBtn.textContent = "×";
  closeBtn.onclick = () => overlay.remove();
  headerBtns.appendChild(closeBtn);
  header.appendChild(headerBtns);
  panel.appendChild(header);

  function updateViewBtn() {
    if (checked.size > 0) {
      viewSelBtn.textContent = `View ${checked.size} selected`;
      viewSelBtn.style.display = "inline-block";
    } else {
      viewSelBtn.style.display = "none";
    }
  }

  viewSelBtn.onclick = () => {
    state.checkedIndices = new Set(checked);
    state._userPickedView = false;
    overlay.remove();
    renderApp();
  };

  // Search + date filter row
  const filterRow = el("div", "tv-sp-filter-row");

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search sessions...";
  searchInput.className = "tv-session-panel-search";
  searchInput.value = state.searchQuery;
  filterRow.appendChild(searchInput);

  // Date filter
  const dateFilterWrap = el("span", "tv-sp-date-filter");
  const dateLabel = document.createElement("span");
  dateLabel.textContent = "Date:";
  dateLabel.style.cssText = "font-size:11px;color:var(--tv-text-muted);font-weight:600";
  dateFilterWrap.appendChild(dateLabel);
  const dateFrom = document.createElement("input");
  dateFrom.type = "date";
  dateFrom.className = "tv-sp-date-input";
  dateFrom.title = "From date";
  const dateTo = document.createElement("input");
  dateTo.type = "date";
  dateTo.className = "tv-sp-date-input";
  dateTo.title = "To date";
  const dateSep = document.createElement("span");
  dateSep.textContent = "\u2013";
  dateSep.style.cssText = "color:var(--tv-text-muted);font-size:11px";
  dateFilterWrap.appendChild(dateFrom);
  dateFilterWrap.appendChild(dateSep);
  dateFilterWrap.appendChild(dateTo);
  filterRow.appendChild(dateFilterWrap);

  panel.appendChild(filterRow);

  // Select All / None buttons
  const bulkRow = el("div", "tv-sp-bulk-row");
  const selAllBtn = document.createElement("button");
  selAllBtn.className = "tv-btn tv-btn-small";
  selAllBtn.textContent = "Select All";
  selAllBtn.onclick = () => {
    const visible = getVisibleTrajectories();
    for (const t of visible) checked.add(state.trajectories.indexOf(t));
    updateViewBtn();
    buildList();
  };
  bulkRow.appendChild(selAllBtn);

  const selNoneBtn = document.createElement("button");
  selNoneBtn.className = "tv-btn tv-btn-small";
  selNoneBtn.textContent = "Select None";
  selNoneBtn.onclick = () => { checked.clear(); updateViewBtn(); buildList(); };
  bulkRow.appendChild(selNoneBtn);

  const bulkCount = el("span", "tv-sp-bulk-count");
  bulkRow.appendChild(bulkCount);
  panel.appendChild(bulkRow);

  // Session list
  const list = el("div", "tv-session-panel-list");

  function getDateLabel(d: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const sessionDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (sessionDay.getTime() === today.getTime()) return "Today";
    if (sessionDay.getTime() === yesterday.getTime()) return "Yesterday";
    // Within this week
    const daysDiff = Math.floor((today.getTime() - sessionDay.getTime()) / 86400000);
    if (daysDiff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    // Older
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: sessionDay.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }

  function getVisibleTrajectories(): Trajectory[] {
    let sorted = getSortedTrajectories();
    // Hide subagents from this list — they're spawned children of a real
    // session, not first-class sessions. Their events were already merged
    // into their parent (in mergeSubagentTrajectories). Showing them here
    // would mean every "Task" call shows up as its own session, which is
    // never what you actually want to compare against.
    sorted = sorted.filter(t => !t.parentSessionId);
    const fromMs = dateFrom.value ? new Date(dateFrom.value + "T00:00").getTime() : null;
    const toMs = dateTo.value ? new Date(dateTo.value + "T23:59:59").getTime() : null;
    if (fromMs || toMs) {
      sorted = sorted.filter(t => {
        const ts = t.session.startTime ? new Date(t.session.startTime).getTime() : 0;
        if (fromMs && ts < fromMs) return false;
        if (toMs && ts > toMs) return false;
        return true;
      });
    }
    return sorted;
  }

  // Count subagents per top-level session. After merge, a parent's events
  // already include all its subagents' events (each tagged with `agent`).
  // Counting unique `agent` labels gives us the subagent count for the row.
  function getSubagentCount(t: Trajectory): number {
    if (t.parentSessionId) return 0;
    const agents = new Set<string>();
    for (const e of t.events) {
      if (e.agent) agents.add(e.agent);
    }
    return agents.size;
  }

  function buildList() {
    list.innerHTML = "";
    const visible = getVisibleTrajectories();

    bulkCount.textContent = `${checked.size} checked · ${visible.length} shown`;

    let lastDateLabel = "";

    for (let i = 0; i < Math.min(visible.length, 500); i++) {
      const t = visible[i];
      const realIndex = state.trajectories.indexOf(t);
      const isSelected = realIndex === state.selectedIndex && checked.size === 0;
      const isChecked = checked.has(realIndex);

      // Date group header
      const startTime = t.session.startTime ? new Date(t.session.startTime) : null;
      const dateLabel = startTime ? getDateLabel(startTime) : "Unknown";
      if (dateLabel !== lastDateLabel) {
        lastDateLabel = dateLabel;
        const dateHeader = el("div", "tv-sp-date-header");
        dateHeader.textContent = dateLabel;
        list.appendChild(dateHeader);
      }

      const item = el("div", `tv-session-panel-item ${isSelected ? "tv-session-panel-selected" : ""} ${isChecked ? "tv-session-panel-checked" : ""}`);

      const time = startTime ? startTime.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
      const s = t.summary ?? computeSummary(t.events);
      const tools = s.totalToolCalls;
      const dur = fmtMs(s.durationMs);
      const tok = s.totalTokens.output > 0 ? fmtTokShort(s.totalTokens.output) + " tok" : "";
      const retries = s.errorCount > 0 ? ` · ${s.errorCount} retries` : "";
      const subagentN = getSubagentCount(t);
      const subagentTag = subagentN > 0 ? ` · ${subagentN} subagent${subagentN > 1 ? "s" : ""}` : "";

      const firstPrompt = t.events.find(e => e.role === "user" && e.type === "message" && e.content && e.content.length > 5 && !e.content.startsWith("<"));
      const label = firstPrompt?.content?.trim().split("\n")[0].slice(0, 50) ?? "";

      // Checkbox for multi-select
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "tv-sp-checkbox";
      cb.checked = isChecked;
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => {
        if (cb.checked) checked.add(realIndex); else checked.delete(realIndex);
        updateViewBtn();
        buildList();
      };

      const content = el("div", "tv-sp-content");
      content.innerHTML = `
        <div class="tv-sp-date">${time}</div>
        <div class="tv-sp-meta"><span class="tv-sp-source">${t.source.toUpperCase()}</span> ${t.session.model ?? ""}</div>
        <div class="tv-sp-stats">${tools} tools · ${dur}${tok ? " · " + tok : ""}${retries}${subagentTag}</div>
        ${label ? `<div class="tv-sp-label">${escHtml(label)}</div>` : ""}
      `;

      item.appendChild(cb);
      item.appendChild(content);

      // Single click = select this one session
      content.onclick = () => {
        state.selectedIndex = realIndex;
        state.checkedIndices.clear();
        state.expandedEvents.clear();
        state.filterTool = null;
        state._userPickedView = false;
        overlay.remove();
        renderApp();
      };

      list.appendChild(item);
    }

    if (visible.length > 500) {
      const more = el("div", "tv-sp-more");
      more.textContent = `${visible.length - 500} more — use date filter to narrow`;
      list.appendChild(more);
    }
  }

  searchInput.oninput = () => {
    state.searchQuery = searchInput.value;
    buildList();
  };
  dateFrom.onchange = buildList;
  dateTo.onchange = buildList;

  updateViewBtn();
  buildList();
  panel.appendChild(list);

  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.appendChild(panel);
  appRoot.appendChild(overlay);
  searchInput.focus();
}

/** Merge subagent trajectories into their parent sessions */
function mergeSubagentTrajectories(trajectories: Trajectory[]): Trajectory[] {
  // Linkage logic lives in src/common/merge-subagents.ts so it can be
  // unit-tested without spinning up the whole app. This thin wrapper
  // bridges to module-level state (existing parents, agent meta cache)
  // and recomputes summaries on the parents that absorbed children.
  const result = linkSubagents(trajectories, state.trajectories, agentMetaDescriptions);
  if (result.stats.merged > 0) {
    // Walk every parent (loaded + freshly-merged) and recompute summary
    // for the ones that now carry agent-tagged events.
    const allParents = new Map<string, Trajectory>();
    for (const t of state.trajectories) if (!t.parentSessionId) allParents.set(t.session.id, t);
    for (const t of result.kept) if (!t.parentSessionId) allParents.set(t.session.id, t);
    for (const [, parent] of allParents) {
      if (parent.events.some(e => e.agent)) {
        fillEventDurations(parent.events);
        parent.summary = computeSummary(parent.events);
      }
    }
  }

  // Stash stats on the function so the caller can log them.
  (mergeSubagentTrajectories as unknown as { lastStats: Record<string, number> }).lastStats = {
    merged: result.stats.merged,
    unlinked: result.stats.unlinked,
    unlinkedNoParentFile: result.stats.unlinkedNoParentFile,
    unlinkedSidechain: result.stats.unlinkedSidechain,
    unlinkedTemporal: result.stats.unlinkedTemporal,
  };

  return result.kept;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtMs(ms: number): string {
  if (ms < 60000) return Math.round(ms / 1000) + "s";
  const m = Math.round(ms / 60000);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function fmtTokShort(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1000000) return (n / 1000).toFixed(1) + "K";
  return (n / 1000000).toFixed(1) + "M";
}

function openSettingsModal() {
  // Remove existing modal
  document.querySelector(".tv-modal-overlay")?.remove();

  // consumerPkg is resolved here (not relying on renderApp's local scope) —
  // openSettingsModal is a top-level function called from a button click,
  // so it has no closure over renderApp's variables.
  const consumerPkg = getConsumerPkg();

  const overlay = el("div", "tv-modal-overlay");
  const modal = el("div", "tv-modal");

  // Header
  const header = el("div", "tv-modal-header");
  header.innerHTML = `<h2>Settings</h2>`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "tv-btn tv-btn-icon tv-modal-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = el("div", "tv-modal-body");

  // ── General Section ──
  const generalSection = el("div", "tv-modal-section");
  generalSection.innerHTML = `<h3>General</h3>`;

  // ── Theme picker ──
  // (Moved from the header on Apr 30 — themes are a set-and-forget
  // choice and the header was getting crowded.)
  if (!consumerPkg?.darkModeForced) {
    const themeRow = el("div", "tv-modal-row");
    themeRow.innerHTML = `
      <label>
        <span class="tv-modal-label">Theme</span>
        <span class="tv-modal-hint">Color scheme for the app. Persists across reloads.</span>
      </label>
    `;
    const themeSelect = document.createElement("select");
    themeSelect.className = "tv-settings-select";
    themeSelect.setAttribute("aria-label", "Theme");
    const themes = [
      { id: "tv-dataviz", label: "Data Viz (default)" },
      { id: "tv-dark", label: "Dark" },
      { id: "tv-light", label: "Light" },
      { id: "tv-premium", label: "Premium (Light)" },
      { id: "tv-neon", label: "Neon Code" },
      { id: "tv-warm", label: "Amber & Slate" },
      { id: "tv-refined", label: "GitHub Pro" },
    ];
    for (const t of themes) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      if (t.id === state.activeTheme) opt.selected = true;
      themeSelect.appendChild(opt);
    }
    themeSelect.onchange = () => {
      state.activeTheme = themeSelect.value;
      state.darkMode = !["tv-light", "tv-premium"].includes(state.activeTheme);
      settings.activeTheme = themeSelect.value;
      saveSettings(settings);
      // Apply immediately without a full re-render — themes are pure
      // CSS variables, so swapping the root class is enough.
      const root = document.getElementById("app");
      if (root) root.className = `tv-root ${state.activeTheme}`;
    };
    themeRow.appendChild(themeSelect);
    generalSection.appendChild(themeRow);
  }

  const watchRow = el("div", "tv-modal-row");
  watchRow.innerHTML = `
    <label>
      <span class="tv-modal-label">Live file watching interval</span>
      <span class="tv-modal-hint">How often to check for new or changed files</span>
    </label>
  `;
  const watchSelect = document.createElement("select");
  watchSelect.className = "tv-settings-select";
  const watchOptions = [
    { value: "0", label: "Disabled" },
    { value: "2000", label: "2 seconds" },
    { value: "5000", label: "5 seconds" },
    { value: "10000", label: "10 seconds" },
    { value: "30000", label: "30 seconds" },
    { value: "60000", label: "60 seconds" },
  ];
  for (const opt of watchOptions) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    if (parseInt(opt.value) === settings.watchIntervalMs) option.selected = true;
    watchSelect.appendChild(option);
  }
  watchSelect.onchange = () => {
    settings.watchIntervalMs = parseInt(watchSelect.value);
    saveSettings(settings);
    startFileWatcher();
  };
  watchRow.appendChild(watchSelect);
  generalSection.appendChild(watchRow);

  // Cost-display mode
  const costRow = el("div", "tv-modal-row");
  costRow.innerHTML = `
    <label>
      <span class="tv-modal-label">Cost display</span>
      <span class="tv-modal-hint">List-price API estimates only make sense for users paying per token. Pick what fits how you actually pay.</span>
    </label>
  `;
  const costSelect = document.createElement("select");
  costSelect.className = "tv-settings-select";
  const costOptions = [
    { value: "subscription", label: "Subscription (hide $) — flat-fee Claude Pro/Cursor/etc." },
    { value: "list",         label: "API list price — pay-per-token API users" },
    { value: "hidden",       label: "Hidden — never show $ figures" },
  ];
  for (const opt of costOptions) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    if (settings.costMode === opt.value) option.selected = true;
    costSelect.appendChild(option);
  }
  costSelect.onchange = () => {
    settings.costMode = costSelect.value as Settings["costMode"];
    saveSettings(settings);
    renderApp();
  };
  costRow.appendChild(costSelect);
  generalSection.appendChild(costRow);

  body.appendChild(generalSection);

  // ── Views Section ──
  const viewsSection = el("div", "tv-modal-section");
  viewsSection.innerHTML = `<h3>View Plugins</h3><p class="tv-modal-hint">Enable or disable views. Edit CSS overrides per view.</p>`;

  const allViews = getAllViews();
  const isAdvanced = (v: TrajectoryView) => v.tier === "advanced";

  for (const view of allViews) {
    const viewCard = el("div", "tv-modal-view-card");

    // Enable toggle + name
    const viewHeader = el("div", "tv-modal-view-header");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = isViewEnabled(view.id);
    toggle.className = "tv-modal-toggle";
    toggle.onchange = () => {
      if (toggle.checked) {
        // Enable: remove from disabled, add to enabled (for advanced views)
        settings.disabledViews = settings.disabledViews.filter((id) => id !== view.id);
        if (isAdvanced(view) && !settings.enabledViews.includes(view.id)) {
          settings.enabledViews.push(view.id);
        }
      } else {
        // Disable: remove from enabled, add to disabled (for core/standard views)
        settings.enabledViews = settings.enabledViews.filter((id) => id !== view.id);
        if (!isAdvanced(view) && !settings.disabledViews.includes(view.id)) {
          settings.disabledViews.push(view.id);
        }
      }
      saveSettings(settings);
    };
    viewHeader.appendChild(toggle);

    const tierLabel = isAdvanced(view) ? ' <span class="tv-modal-tier-badge">advanced</span>' : "";
    const viewInfo = el("div", "tv-modal-view-info");
    viewInfo.innerHTML = `
      <strong>${esc(view.name)}</strong>${tierLabel}
      <span class="tv-modal-view-desc">${esc(view.description)}</span>
    `;
    viewHeader.appendChild(viewInfo);
    viewCard.appendChild(viewHeader);

    // CSS override editor
    const cssToggle = el("div", "tv-modal-css-toggle");
    cssToggle.textContent = "Custom CSS";
    let cssExpanded = false;
    const cssEditor = document.createElement("textarea");
    cssEditor.className = "tv-modal-css-editor";
    cssEditor.placeholder = `/* Custom CSS overrides for ${view.name} view */`;
    cssEditor.value = settings.viewCssOverrides[view.id] ?? "";
    cssEditor.style.display = "none";
    cssEditor.oninput = () => {
      settings.viewCssOverrides[view.id] = cssEditor.value;
      saveSettings(settings);
    };
    cssToggle.onclick = () => {
      cssExpanded = !cssExpanded;
      cssEditor.style.display = cssExpanded ? "block" : "none";
      cssToggle.textContent = cssExpanded ? "Custom CSS ▾" : "Custom CSS ▸";
    };
    cssToggle.textContent = "Custom CSS ▸";
    viewCard.appendChild(cssToggle);
    viewCard.appendChild(cssEditor);

    viewsSection.appendChild(viewCard);
  }

  body.appendChild(viewsSection);

  // ── Saved Sources Section ──
  const sourcesSection = el("div", "tv-modal-section");
  sourcesSection.innerHTML = `<h3>Saved Sources</h3><p class="tv-modal-hint">Folders that auto-load on startup. Any folder works — we detect the file format automatically.</p>`;

  const sourcesList = el("div", "tv-modal-sources-list");

  for (const [sourceId] of state.scannedDirs) {
    const meta = getSourceMeta(sourceId);
    const label = meta?.label ?? sourceId;

    const sourceCard = el("div", "tv-modal-source-card");

    // Editable name
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "tv-modal-source-name";
    nameInput.value = label;
    nameInput.onblur = () => {
      const newLabel = nameInput.value.trim() || sourceId;
      setSourceMeta(sourceId, newLabel);
    };
    nameInput.onkeydown = (e) => { if (e.key === "Enter") nameInput.blur(); };
    sourceCard.appendChild(nameInput);

    // ID hint
    const idHint = el("div", "tv-modal-source-id");
    idHint.textContent = sourceId;
    sourceCard.appendChild(idHint);

    // Remove button
    const removeBtn = document.createElement("button");
    removeBtn.className = "tv-btn tv-btn-small";
    removeBtn.textContent = "Remove";
    removeBtn.style.color = "var(--tv-error)";
    removeBtn.onclick = async () => {
      state.scannedDirs.delete(sourceId);
      await removeDirHandle(sourceId);
      sourceCard.remove();
    };
    sourceCard.appendChild(removeBtn);

    sourcesList.appendChild(sourceCard);
  }

  sourcesSection.appendChild(sourcesList);

  // Add Source button
  const addSourceBtn = document.createElement("button");
  addSourceBtn.className = "tv-btn tv-btn-primary";
  addSourceBtn.textContent = "+ Add Source Folder";
  addSourceBtn.style.marginTop = "8px";
  addSourceBtn.onclick = async () => {
    overlay.remove(); // Close modal first
    await addNewSource();
  };
  sourcesSection.appendChild(addSourceBtn);

  body.appendChild(sourcesSection);

  modal.appendChild(body);

  // Footer
  const footer = el("div", "tv-modal-footer");
  const doneBtn = document.createElement("button");
  doneBtn.className = "tv-btn tv-btn-primary";
  doneBtn.textContent = "Done";
  doneBtn.onclick = () => {
    overlay.remove();
    renderApp(); // Re-render to apply view enable/disable changes
  };
  footer.appendChild(doneBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") overlay.remove(); });
  overlay.setAttribute("tabindex", "-1");
  setTimeout(() => overlay.focus(), 0);
  appRoot.appendChild(overlay);
}

function setupDragDrop(root: HTMLElement) {
  root.addEventListener("dragover", (e) => {
    e.preventDefault();
    root.classList.add("drag-over");
  });
  root.addEventListener("dragleave", () => {
    root.classList.remove("drag-over");
  });
  root.addEventListener("drop", async (e) => {
    e.preventDefault();
    root.classList.remove("drag-over");
    if (e.dataTransfer?.files) {
      await loadFiles(e.dataTransfer.files);
    }
  });
}

// ── Sorting & Filtering ───────────────────────────────────────────────

function getSortedTrajectories(): Trajectory[] {
  let list = [...state.trajectories];

  // Filter by source
  if (state.filterSource) {
    list = list.filter((t) => t.source === state.filterSource);
  }

  // Filter by search — matches metadata, first prompt, and event content
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter((t) => {
      // Metadata match (fast)
      if (
        t.session.id.toLowerCase().includes(q) ||
        (t.session.model ?? "").toLowerCase().includes(q) ||
        t.source.toLowerCase().includes(q) ||
        (t.session.cwd ?? "").toLowerCase().includes(q) ||
        (t.session.gitBranch ?? "").toLowerCase().includes(q)
      ) return true;
      // First user prompt match — what the user asked the AI to do
      const firstPrompt = t.events.find(e => e.role === "user" && e.type === "message" && e.content);
      if (firstPrompt?.content?.toLowerCase().includes(q)) return true;
      // Event content match — tool names, messages, tool arguments
      return t.events.some(e =>
        (e.content?.toLowerCase().includes(q)) ||
        (e.toolCall?.name?.toLowerCase().includes(q))
      );
    });
  }

  // Sort
  list.sort((a, b) => {
    let cmp = 0;
    switch (state.sortField) {
      case "date": {
        const ta = new Date(a.session.startTime ?? 0).getTime();
        const tb = new Date(b.session.startTime ?? 0).getTime();
        cmp = ta - tb;
        break;
      }
      case "source":
        cmp = a.source.localeCompare(b.source);
        break;
      case "duration":
        cmp = (a.summary?.durationMs ?? 0) - (b.summary?.durationMs ?? 0);
        break;
      case "toolCalls":
        cmp = (a.summary?.totalToolCalls ?? 0) - (b.summary?.totalToolCalls ?? 0);
        break;
      case "tokens": {
        const tokA = a.summary ? a.summary.totalTokens.input + a.summary.totalTokens.output : 0;
        const tokB = b.summary ? b.summary.totalTokens.input + b.summary.totalTokens.output : 0;
        cmp = tokA - tokB;
        break;
      }
    }
    return state.sortDir === "desc" ? -cmp : cmp;
  });

  return list;
}

// ── Rendering ──────────────────────────────────────────────────────────

let appRoot: HTMLElement;

function render(root: HTMLElement) {
  appRoot = root;
  root.innerHTML = "";
  root.className = `tv-root ${state.activeTheme}`;
  renderApp();
}

function renderLoadingOnly() {
  const loader = appRoot.querySelector(".tv-loading-banner");
  if (loader) {
    loader.textContent = state.loadingMessage;
  }
}

function renderApp() {
  if (!appRoot) return;
  appRoot.innerHTML = "";

  const consumer = isConsumerMode();
  const consumerPkg = getConsumerPkg();

  const isVSCode = !!(window as any).__isVSCodeExtension;

  // Header — hidden in VS Code mode (tab name is enough, export moves to sidebar)
  if (!isVSCode) {
    const header = el("div", "tv-header");
    const title = consumerPkg?.title ?? "AI Timeline";
    // Timeline icon — three horizontal Gantt-style bars at varying x offsets,
    // reads as "timeline of events" rather than a generic bar chart.
    const logoHtml = consumerPkg?.logoBase64
      ? `<img src="${consumerPkg.logoBase64}" style="height:24px" alt="">`
      : `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="5" width="14" height="3" rx="1.5"/><rect x="6" y="11" width="16" height="3" rx="1.5"/><rect x="3" y="17" width="9" height="3" rx="1.5"/></svg>`;
    header.innerHTML = `
      <div class="tv-logo">
        ${logoHtml}
        <span class="tv-title">${esc(title)}</span>
        <span class="tv-nav-sep"></span>
      </div>
      <div class="tv-header-actions"></div>
    `;

    // Sessions button — left side, next to logo, like navigation
    const logoEl = header.querySelector(".tv-logo")!;
    if (state.trajectories.length > 0 && !isConsumerMode()) {
      const countBtn = el("button", "tv-btn tv-btn-sessions");
      countBtn.innerHTML = `&#9776; Sessions`;
      countBtn.title = "Open session picker";
      countBtn.onclick = () => openSessionModal();
      logoEl.appendChild(countBtn);
    }

    const actions = header.querySelector(".tv-header-actions")!;

    // Theme picker moved to Settings → General. The header was getting
    // crowded and themes are usually a "set once, forget" decision —
    // no need to keep them one click away from every action.

    // Export / Share button
    if (state.trajectories.length > 0) {
      const exportBtn = el("button", "tv-btn tv-btn-export");
      exportBtn.innerHTML = `&#8599; Share / Export`;
      exportBtn.title = "Export as JSON, CSV, or shareable HTML file";
      exportBtn.onclick = () => openExportMenu(exportBtn);
      actions.appendChild(exportBtn);
    }

    // Live source button — only shown in the header when at least one live
    // source is actually streaming (so the user can see the indicator and
    // open the modal to manage). For first-time users, "Connect…" is a
    // niche feature (VETT live streaming) that 99% of folks won't use, so
    // it's tucked into Settings instead. See the "Live sources" section
    // there for the explainer + GitHub link.
    if (!consumer && state.liveSources.size > 0) {
      const liveBtn = el("button", "tv-btn tv-btn-live");
      liveBtn.innerHTML = `&#9679; Live · ${state.liveSources.size}`;
      liveBtn.title = "Manage active streaming sources";
      liveBtn.onclick = () => openLiveSourceModal();
      actions.appendChild(liveBtn);
    }

    // Settings button (producer mode only)
    if (!consumer) {
      const settingsBtn = el("button", "tv-btn tv-btn-icon");
      settingsBtn.textContent = "Settings";
      settingsBtn.onclick = () => openSettingsModal();
      actions.appendChild(settingsBtn);
    }

    appRoot.appendChild(header);
  }

  // Discovery banner — a probe found a live source; offer one-click connect.
  if (state.liveDiscovery && !state.liveSources.has(state.liveDiscovery.sourceId)) {
    const disc = state.liveDiscovery;
    const banner = el("div", "tv-live-discovery");
    const dot = el("span", "tv-live-discovery-dot");
    dot.textContent = "●";
    const msg = el("span", "tv-live-discovery-msg");
    msg.textContent = disc.label;
    const actions = el("div", "tv-live-discovery-actions");

    const remember = el("label", "tv-live-discovery-remember");
    remember.innerHTML = `<input type="checkbox" id="tv-live-disc-remember" ${getAutoConnect() ? "checked" : ""}> Remember & auto-connect`;
    actions.appendChild(remember);

    const connectBtn = el("button", "tv-btn tv-btn-live");
    connectBtn.textContent = "Connect";
    connectBtn.onclick = () => {
      const cb = remember.querySelector<HTMLInputElement>("#tv-live-disc-remember");
      if (cb?.checked) setAutoConnect(true);
      startLiveSource(disc.sourceId, disc.config);
    };
    actions.appendChild(connectBtn);

    const dismissBtn = el("button", "tv-btn tv-btn-icon");
    dismissBtn.textContent = "Dismiss";
    dismissBtn.onclick = () => {
      dismissDiscoveryThisSession(disc.dismissKey);
      state.liveDiscovery = null;
      renderApp();
    };
    actions.appendChild(dismissBtn);

    banner.appendChild(dot);
    banner.appendChild(msg);
    banner.appendChild(actions);
    appRoot.appendChild(banner);
  }

  // Live banner — one row per active network source. Phase drives color
  // and actions (Stop while live/connecting, Reconnect once ended).
  if (state.liveSources.size > 0) {
    const banner = el("div", "tv-live-banner");
    for (const entry of state.liveSources.values()) {
      const row = el("div", `tv-live-banner-row tv-live-phase-${entry.phase}`);
      row.setAttribute("data-src", entry.id);

      const dot = el("span", "tv-live-dot");
      dot.textContent = "●";
      row.appendChild(dot);

      const name = el("span", "tv-live-banner-name");
      name.textContent = entry.source.name;
      row.appendChild(name);

      const text = el("span", "tv-live-banner-text");
      text.textContent = entry.status;
      row.appendChild(text);

      const spacer = el("span", "tv-live-banner-spacer");
      row.appendChild(spacer);

      // Action button — depends on phase. While live/connecting/reconnecting:
      // Stop. Once ended: Reconnect (and Dismiss to remove from banner).
      if (entry.phase === "ended") {
        const reconnectBtn = el("button", "tv-btn tv-live-action");
        reconnectBtn.innerHTML = "&#8635; Reconnect";
        reconnectBtn.title = "Try connecting to the source again";
        reconnectBtn.onclick = () => {
          const src = entry.source as any;
          if (typeof src.reconnect === "function") {
            entry.phase = "connecting";
            entry.status = "Reconnecting…";
            renderApp();
            src.reconnect();
          } else {
            // Fallback: stop and start fresh
            stopLiveSource(entry.id);
          }
        };
        row.appendChild(reconnectBtn);

        const dismissBtn = el("button", "tv-btn tv-btn-icon tv-live-action");
        dismissBtn.textContent = "Dismiss";
        dismissBtn.title = "Remove from banner";
        dismissBtn.onclick = () => stopLiveSource(entry.id);
        row.appendChild(dismissBtn);
      } else {
        const stopBtn = el("button", "tv-btn tv-live-action tv-btn-live-stop");
        stopBtn.innerHTML = "&times; Disconnect";
        stopBtn.title = `Stop receiving from ${esc(entry.source.name)}`;
        stopBtn.onclick = () => stopLiveSource(entry.id);
        row.appendChild(stopBtn);
      }

      banner.appendChild(row);

      if (entry.error) {
        const err = el("div", "tv-live-banner-error");
        err.textContent = "Error: " + entry.error;
        banner.appendChild(err);
      }
    }
    appRoot.appendChild(banner);
  }

  // Loading banner
  if (state.isLoading) {
    const loading = el("div", "tv-loading-banner");
    loading.textContent = state.loadingMessage;
    appRoot.appendChild(loading);
  }

  // Sample data banner — nudge to load own files
  if (state.isSampleData && state.trajectories.length > 0) {
    const banner = el("div", "tv-sample-banner");
    banner.innerHTML = `Viewing sample data. <strong>Drop your own session file</strong> anywhere to see your data.`;
    banner.ondragover = (e) => e.preventDefault();
    banner.onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = ".jsonl,.json,.traj,.md,.vscdb";
      input.onchange = () => { if (input.files) { state.isSampleData = false; loadFiles(input.files); } };
      input.click();
    };
    appRoot.appendChild(banner);
  }

  // Main content
  if (state.trajectories.length === 0 && !state.isLoading) {
    if (isVSCode) {
      const waiting = el("div", "tv-vscode-welcome");
      waiting.innerHTML = `
        <h2 style="font-size:22px;font-weight:300;color:var(--tv-text);margin-bottom:20px;">AI Timeline</h2>
        <div style="margin-bottom:16px;">
          <p style="font-size:13px;font-weight:600;color:var(--tv-text);margin-bottom:8px;">Start</p>
          <p style="margin:4px 0;"><a href="#" class="tv-vsc-link" data-action="sidebar">Select a session from the sidebar</a></p>
          <p style="margin:4px 0;"><a href="#" class="tv-vsc-link" data-action="multi">Ctrl+click sessions to compare</a></p>
          <p style="margin:4px 0;"><a href="#" class="tv-vsc-link" data-action="folder">Open Folder...</a></p>
        </div>
        <p style="font-size:11px;color:var(--tv-text-muted);margin-top:24px;">Sessions are auto-detected from Claude Code, Cursor, Aider, and Cline.</p>
      `;
      // Style links like VS Code welcome blue links
      const style = document.createElement("style");
      style.textContent = `.tv-vscode-welcome { padding: 40px; max-width: 500px; }
        .tv-vsc-link { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; font-size: 13px; cursor: pointer; }
        .tv-vsc-link:hover { text-decoration: underline; }`;
      waiting.prepend(style);
      // Wire up folder action
      waiting.querySelector('[data-action="folder"]')?.addEventListener("click", (e) => {
        e.preventDefault();
        if ((window as any).vscodeRequestFolder) (window as any).vscodeRequestFolder();
      });
      appRoot.appendChild(waiting);
    } else if (!consumer) appRoot.appendChild(renderSourcePicker());
    else {
      const empty = el("div", "tv-empty");
      empty.innerHTML = "<h2>No sessions in this export</h2><p>The exported file contains no trajectory data.</p>";
      appRoot.appendChild(empty);
    }
  } else if (state.trajectories.length > 0) {
    // Full-width detail — sidebar is now a modal overlay
    const main = el("div", "tv-main");
    main.style.gridTemplateColumns = "1fr";
    main.appendChild(renderDetail());
    appRoot.appendChild(main);
    state._mainEl = main;
  }
}

/**
 * Cheaper re-render path used when ONLY trajectories changed — i.e. a live
 * source dropped a new batch into state.trajectories. Avoids tearing down
 * the header / live banner / theme picker every 200-750ms, which makes the
 * UI noticeably less jarring during an active VETT or Claude Code stream.
 *
 * Critically: builds the new .tv-detail subtree FIRST, then atomically
 * swaps it into place via replaceWith(). That avoids the white-flash an
 * `innerHTML = "" + appendChild()` sequence causes (the empty DOM gets
 * painted as one frame before the new content lands).
 *
 * Falls back to a full renderApp() if the main element isn't mounted yet
 * (first render after the very first batch).
 */
function renderTrajectoriesIncremental() {
  if (!appRoot) return;

  // Update the live-banner event counts / status texts in place. The status
  // strings live inside .tv-live-banner-row[data-src=…] .tv-live-banner-text
  // and are kept current by the source's onStatus callbacks; nothing extra
  // needed here.

  const main = state._mainEl;
  if (!main || !main.isConnected) {
    // First batch (or DOM was rebuilt elsewhere). Need a full render to
    // create the main element so subsequent updates can be incremental.
    renderApp();
    return;
  }

  // Build the fresh subtree off-DOM, then DIFF it into the existing tree
  // with morphdom. Unchanged nodes are left in place; only the text/attrs
  // that actually changed get touched. This is what "in-place update" really
  // means — a stat card whose number didn't change won't even repaint, the
  // surrounding layout doesn't reflow, and CSS transitions on hover etc.
  // don't reset.
  const oldDetail = main.querySelector(".tv-detail") as HTMLElement | null;
  const newDetail = renderDetail();

  if (!oldDetail) {
    // No prior detail — append fresh (no diffable target).
    main.appendChild(newDetail);
    return;
  }

  // Save scroll positions of any scrollable child (Gantt, Conversation,
  // Table, etc.) so morphdom doesn't lose them when nodes are reused.
  const scrollMap = new Map<string, number>();
  oldDetail.querySelectorAll<HTMLElement>("[data-scroll-key], .tv-view-container, .tv-conv-list, .tv-gantt-scroll").forEach((el, i) => {
    const key = el.dataset.scrollKey || `auto-${i}`;
    if (el.scrollTop > 0) scrollMap.set(key, el.scrollTop);
  });

  // Per-element "user state" classes that views toggle on click — selection
  // markers, expanded/collapsed flags, etc. Each view's render() rebuilds
  // the DOM without these classes; morphdom would drop them. We copy them
  // forward so the user's pick / expanded card / open detail panel
  // survives a re-render. Add new classes here as views need them.
  const SELECTION_CLASSES = [
    "tg-selected",         // Gantt bars
    "tac-bar-selected",    // AI Calls bar chart
    "ttu-bar-selected",    // Tools usage bar chart
    "tv-selected",         // generic table-row marker
    "tv-row-selected",     // alt table-row marker
    "dv-open",             // Diff card expanded body / chevron
    "selected",            // catch-all
  ];

  morphdom(oldDetail, newDetail, {
    onBeforeElUpdated(fromEl, toEl) {
      // Explicit static opt-out for view subtrees that manage their own
      // state (charts, editors). Mark with data-static="true" to skip.
      if (fromEl.dataset?.static === "true") return false;

      // Preserve user-selection classes across morphdom updates. View
      // click handlers add e.g. ".tg-selected" / ".tac-bar-selected"
      // directly to the DOM, but the freshly-built tree doesn't carry
      // them. Copy them onto toEl BEFORE morphdom applies it, so the
      // resulting element keeps the selection.
      for (const cls of SELECTION_CLASSES) {
        if (fromEl.classList.contains(cls)) toEl.classList.add(cls);
      }

      // Do NOT copy event-handler properties (.onclick etc.). Old
      // handlers attached to in-DOM elements correctly reference those
      // elements; copying new closures would create dangling refs to
      // detached new-tree nodes.

      return true;
    },
    onBeforeNodeDiscarded(node) {
      // Keep nodes the user is actively interacting with (focused inputs,
      // open dropdowns, etc.) so the live update doesn't yank focus.
      if (node instanceof HTMLElement) {
        if (node === document.activeElement) return false;
        if (node.contains(document.activeElement)) return false;
      }
      return true;
    },
  });

  // Restore scroll positions on whatever the patched DOM now has at those keys.
  oldDetail.querySelectorAll<HTMLElement>("[data-scroll-key], .tv-view-container, .tv-conv-list, .tv-gantt-scroll").forEach((el, i) => {
    const key = el.dataset.scrollKey || `auto-${i}`;
    const saved = scrollMap.get(key);
    if (saved && saved > 0) el.scrollTop = saved;
  });
}

// ── Source Picker (replaces old empty state) ──────────────────────────

function renderSourcePicker(): HTMLElement {
  const picker = el("div", "tv-source-picker");

  // Headline + sub
  const intro = el("div", "tv-picker-intro");
  intro.innerHTML = `
    <h2>Your AI coding sessions are already saved on your machine.</h2>
    <p>This shows you what's in them. <strong>Timelines, tokens, patterns — things the chat UI never shows.</strong></p>
  `;
  picker.appendChild(intro);

  // Screenshot placeholder — TODO: replace with actual screenshot
  // const hero = el("div", "tv-hero-img");
  // hero.innerHTML = `<img src="./assets/screenshot.png" alt="AI Timeline showing a Claude Code session timeline" />`;
  // picker.appendChild(hero);

  // Primary CTA
  const tryWrap = el("div", "tv-try-sample");
  const tryBtn = document.createElement("button");
  tryBtn.className = "tv-btn tv-btn-sample";
  tryBtn.textContent = "See it in action — load a sample session";
  tryBtn.title = "Load a real Claude Code session to see what the tool does";
  tryBtn.onclick = async () => {
    tryBtn.disabled = true;
    tryBtn.textContent = "Loading...";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
      // The sample is one session plus the subagent it spawned, laid out the
      // way Claude Code saves them, so it merges exactly like a folder load.
      const files = [SAMPLE_SESSION, SAMPLE_SUBAGENT];
      const texts = await Promise.all(files.map(async (f) => {
        const resp = await fetch(`./samples/${f}`, { signal: controller.signal });
        if (!resp.ok) throw new Error("Sample not found");
        return resp.text();
      }));
      clearTimeout(timeout);
      const parsed = mergeSubagentTrajectories(
        (await Promise.all(texts.map((t, i) => parseFileAsync(t, files[i])))).flat(),
      );
      if (parsed.length > 0) {
        state.trajectories = parsed;
        state.selectedIndex = 0;
        state.isSampleData = true;
        renderApp();
      }
    } catch {
      tryBtn.textContent = "Sample not available — drop a file instead";
      tryBtn.disabled = false;
    }
  };
  tryWrap.appendChild(tryBtn);
  picker.appendChild(tryWrap);

  // Value props as a clean horizontal line
  const reasons = el("div", "tv-reasons");
  reasons.innerHTML = `See where time went &middot; Find wasted tokens &middot; Share with your team &middot; See hidden agents`;
  picker.appendChild(reasons);

  // File drop area — clearly distinct from the sample button
  const dropArea = el("div", "tv-drop-area");
  dropArea.innerHTML = `<p><strong>Drop your file here</strong></p><p class="tv-drop-sub">.jsonl, .json, .traj, .md, .vscdb &mdash; or <a href="#" class="tv-drop-browse">browse</a></p>`;
  const browseLink = dropArea.querySelector(".tv-drop-browse")!;
  browseLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".jsonl,.json,.traj,.md,.vscdb";
    input.onchange = () => { if (input.files) loadFiles(input.files); };
    input.click();
  });
  // The drop area itself also works as a file picker fallback
  dropArea.onclick = (e) => {
    if ((e.target as HTMLElement).classList?.contains("tv-drop-browse")) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".jsonl,.json,.traj,.md,.vscdb";
    input.onchange = () => { if (input.files) loadFiles(input.files); };
    input.click();
  };
  picker.appendChild(dropArea);

  // Source cards collapsed by default — for people who need help finding files
  const sourcesToggle = el("div", "tv-sources-toggle");
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "tv-btn tv-btn-outline tv-sources-toggle-btn";
  toggleBtn.textContent = "Need help finding your session files?";
  sourcesToggle.appendChild(toggleBtn);
  picker.appendChild(sourcesToggle);

  const sourcesWrap = el("div", "tv-sources-wrap");
  sourcesWrap.style.display = "none";
  let sourcesOpen = false;
  toggleBtn.onclick = () => {
    sourcesOpen = !sourcesOpen;
    sourcesWrap.style.display = sourcesOpen ? "block" : "none";
    toggleBtn.textContent = sourcesOpen ? "Hide source details" : "Need help finding your session files?";
  };

  const PRIMARY_COUNT = 4; // Show top 4 sources by default
  const grid = el("div", "tv-picker-grid");
  const moreGrid = el("div", "tv-picker-grid tv-picker-more-grid");
  moreGrid.style.display = "none";

  function buildSourceCard(source: KnownSource): HTMLElement {
    const card = el("div", "tv-picker-card");
    card.style.borderLeftColor = source.color;

    const pathInfo = source.paths();

    const cta = source.isLive ? "Connect" : "Scan Folder";
    card.innerHTML = `
      <div class="tv-picker-card-header">
        <strong>${source.name}</strong>${source.isLive ? ' <span class="tv-picker-live-pill">LIVE</span>' : ""}
      </div>
      <p class="tv-picker-card-desc">${source.description}</p>
      <code class="tv-picker-card-path ${pathInfo.copyPath ? "tv-copyable" : ""}" title="${pathInfo.copyPath ? "Click to copy path" : ""}">${pathInfo.display}</code>
      ${pathInfo.hint ? `<p class="tv-picker-card-hint">${pathInfo.hint}</p>` : ""}
      <button class="tv-btn tv-btn-primary tv-picker-scan-btn">${cta}</button>
    `;

    if (pathInfo.copyPath) {
      const pathEl = card.querySelector(".tv-picker-card-path")!;
      pathEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(pathInfo.copyPath);
          pathEl.textContent = "Copied to clipboard!";
          setTimeout(() => { pathEl.textContent = pathInfo.display; }, 1500);
        } catch {}
      });
    }

    const btn = card.querySelector("button")!;
    btn.onclick = async () => {
      // Live source: prompt for host:port and connect via SSE.
      if (source.isLive && source.id === "vett-live") {
        const lastTarget = localStorage.getItem("tv-vett-live-target") ?? "localhost:5151";
        const input = window.prompt(
          "VETT live server (host:port). Start it with `vett run --live-port <N>` or `vett run --trajectory-dir <dir> --live-port <N>`.",
          lastTarget,
        );
        if (!input) return;
        const trimmed = input.trim();
        const m = trimmed.match(/^(?:https?:\/\/)?([^:/\s]+)(?::(\d+))?\/?$/);
        if (!m) {
          window.alert(`Couldn't parse "${trimmed}" as host:port. Try e.g. "localhost:5151".`);
          return;
        }
        const host = m[1];
        const port = parseInt(m[2] ?? "5151", 10);
        localStorage.setItem("tv-vett-live-target", `${host}:${port}`);
        startLiveSource("vett-live", { host, port });
        return;
      }

      if ("showDirectoryPicker" in window) {
        try {
          const pickerOpts: any = {
            mode: "read",
            id: `tv-${source.id}`,
            startIn: "desktop",
          };
          const cached = state.scannedDirs.get(source.id);
          if (cached) {
            pickerOpts.startIn = cached;
          }
          const dirHandle = await (window as any).showDirectoryPicker(pickerOpts);
          setSourceMeta(source.id, source.name);
          await scanDirectory(dirHandle, source.id);
        } catch {
          // User cancelled
        }
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".jsonl,.json,.traj,.md,.vscdb";
        input.onchange = () => {
          if (input.files) loadFiles(input.files);
        };
        input.click();
      }
    };

    return card;
  }

  for (let i = 0; i < KNOWN_SOURCES.length; i++) {
    const card = buildSourceCard(KNOWN_SOURCES[i]);
    if (i < PRIMARY_COUNT) {
      grid.appendChild(card);
    } else {
      moreGrid.appendChild(card);
    }
  }

  sourcesWrap.appendChild(grid);

  // "Show more" toggle for remaining sources
  if (KNOWN_SOURCES.length > PRIMARY_COUNT) {
    const moreWrap = el("div", "tv-picker-more-wrap");
    const moreBtn = document.createElement("button");
    moreBtn.className = "tv-btn tv-btn-outline tv-picker-more-btn";
    const remaining = KNOWN_SOURCES.length - PRIMARY_COUNT;
    moreBtn.textContent = `Show ${remaining} more sources`;
    let expanded = false;
    moreBtn.onclick = () => {
      expanded = !expanded;
      moreGrid.style.display = expanded ? "grid" : "none";
      moreBtn.textContent = expanded ? "Show fewer" : `Show ${remaining} more sources`;
    };
    moreWrap.appendChild(moreBtn);
    sourcesWrap.appendChild(moreWrap);
  }

  sourcesWrap.appendChild(moreGrid);
  picker.appendChild(sourcesWrap);

  // Drag-drop hint
  const hint = el("div", "tv-picker-hint");
  hint.innerHTML = `<p>Or just <strong>drag and drop</strong> any .jsonl, .json, .traj, .md, or .vscdb file anywhere on this page.</p>
    <p style="margin-top:8px;font-size:11px;color:var(--tv-text-muted)">100% offline. Your data never leaves your machine. Works with 10 AI coding tools.</p>`;
  picker.appendChild(hint);

  return picker;
}

// ── Sidebar ───────────────────────────────────────────────────────────

function renderSidebar(): HTMLElement {
  const sidebar = el("div", "tv-sidebar");

  // ── Collapse toggle ──
  const toggle = document.createElement("button");
  toggle.className = "tv-sidebar-toggle";
  toggle.title = "Toggle sidebar";
  toggle.textContent = "\u00AB";
  toggle.onclick = () => {
    const main = sidebar.parentElement;
    if (!main) return;
    const collapsed = main.classList.toggle("tv-sidebar-collapsed");
    toggle.textContent = collapsed ? "\u00BB" : "\u00AB";
    try { localStorage.setItem("tv-sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
  };
  // Default to collapsed when sessions are loaded (less noise)
  // Only stay open if user explicitly expanded it
  try {
    const saved = localStorage.getItem("tv-sidebar-collapsed");
    const shouldCollapse = saved === "1" || (saved === null && state.selectedIndex >= 0);
    if (shouldCollapse) {
      requestAnimationFrame(() => {
        const main = sidebar.parentElement;
        if (main) { main.classList.add("tv-sidebar-collapsed"); toggle.textContent = "\u00BB"; }
      });
    }
  } catch {}
  sidebar.appendChild(toggle);

  // ── Controls: search, sort, filter ──
  const controls = el("div", "tv-sidebar-controls");

  // Search
  const searchWrap = el("div", "tv-search-wrap");
  const searchInput = document.createElement("input") as HTMLInputElement;
  searchInput.type = "text";
  searchInput.placeholder = "Search sessions...";
  searchInput.className = "tv-search-input";
  searchInput.setAttribute("aria-label", "Search sessions");
  searchInput.value = state.searchQuery;
  let searchTimeout: number;
  searchInput.oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => {
      state.searchQuery = searchInput.value;
      state.selectedIndex = -1;
      renderApp();
    }, 300);
  };
  searchWrap.appendChild(searchInput);
  controls.appendChild(searchWrap);

  // Sort row
  const sortRow = el("div", "tv-sort-row");

  const sortLabel = el("span", "tv-sort-label");
  sortLabel.textContent = "Sort:";
  sortRow.appendChild(sortLabel);

  const sortOptions: Array<{ field: SortField; label: string }> = [
    { field: "date", label: "Date" },
    { field: "duration", label: "Duration" },
    { field: "toolCalls", label: "Tools" },
    { field: "tokens", label: "Tokens" },
  ];

  for (const opt of sortOptions) {
    const btn = el("button", `tv-sort-btn ${state.sortField === opt.field ? "tv-sort-active" : ""}`);
    const arrow = state.sortField === opt.field ? (state.sortDir === "desc" ? " v" : " ^") : "";
    btn.textContent = opt.label + arrow;
    btn.onclick = () => {
      if (state.sortField === opt.field) {
        state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      } else {
        state.sortField = opt.field;
        state.sortDir = "desc";
      }
      renderApp();
    };
    sortRow.appendChild(btn);
  }

  controls.appendChild(sortRow);

  // Source filter tabs
  const sources = [...new Set(state.trajectories.map((t) => t.source))];
  if (sources.length > 1) {
    const filterRow = el("div", "tv-filter-row");

    const allBtn = el("button", `tv-filter-btn ${!state.filterSource ? "tv-filter-active" : ""}`);
    allBtn.textContent = `All (${state.trajectories.length})`;
    allBtn.onclick = () => {
      state.filterSource = null;
      state.selectedIndex = -1;
      renderApp();
    };
    filterRow.appendChild(allBtn);

    for (const src of sources) {
      const count = state.trajectories.filter((t) => t.source === src).length;
      const btn = el("button", `tv-filter-btn tv-filter-${src} ${state.filterSource === src ? "tv-filter-active" : ""}`);
      btn.textContent = `${src} (${count})`;
      btn.onclick = () => {
        state.filterSource = state.filterSource === src ? null : src;
        state.selectedIndex = -1;
        renderApp();
      };
      filterRow.appendChild(btn);
    }

    controls.appendChild(filterRow);
  }

  sidebar.appendChild(controls);

  // ── Add more sources button ──
  const addBtn = el("button", "tv-btn tv-btn-secondary tv-add-source-btn");
  addBtn.textContent = "+ Add Source Folder";
  addBtn.onclick = () => addNewSource();;
  sidebar.appendChild(addBtn);

  // ── Load More / Load All buttons ──
  if (state.pendingFiles.length > 0) {
    const loadMoreRow = el("div", "tv-load-more-row");

    const loadMoreBtn = el("button", "tv-btn tv-btn-secondary tv-add-source-btn");
    loadMoreBtn.textContent = `Load Next ${Math.min(PAGE_SIZE, state.pendingFiles.length)} Sessions`;
    loadMoreBtn.onclick = () => loadMoreFiles();
    loadMoreRow.appendChild(loadMoreBtn);

    if (state.pendingFiles.length > PAGE_SIZE) {
      const loadAllBtn = el("button", "tv-btn tv-add-source-btn");
      loadAllBtn.textContent = `Load All (${state.pendingFiles.length} remaining)`;
      loadAllBtn.onclick = () => loadAllRemainingFiles();
      loadMoreRow.appendChild(loadAllBtn);
    }

    const pendingNote = el("div", "tv-pending-note");
    pendingNote.textContent = `Showing ${state.trajectories.length} of ${state.totalFilesFound} sessions (most recent first)`;
    loadMoreRow.appendChild(pendingNote);

    sidebar.appendChild(loadMoreRow);
  }

  // ── Session list ──
  const sorted = getSortedTrajectories();
  const listTitle = el("div", "tv-sidebar-title");
  listTitle.textContent = `Sessions (${sorted.length}${sorted.length !== state.trajectories.length ? ` of ${state.trajectories.length}` : ""})`;
  sidebar.appendChild(listTitle);

  const list = el("div", "tv-session-list");

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const realIndex = state.trajectories.indexOf(t);
    const isSelected = realIndex === state.selectedIndex;
    const isChecked = state.checkedIndices.has(realIndex);
    const item = el("div", `tv-session-item ${isSelected ? "tv-selected" : ""} ${isChecked ? "tv-checked" : ""}`);

    // Checkbox for multi-select
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tv-session-checkbox";
    checkbox.checked = isChecked;
    checkbox.onclick = (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        state.checkedIndices.add(realIndex);
      } else {
        state.checkedIndices.delete(realIndex);
      }
      renderApp();
    };

    // Date (prominent)
    const dateRow = el("div", "tv-session-date");
    if (t.session.startTime) {
      const d = new Date(t.session.startTime);
      dateRow.textContent = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } else {
      dateRow.textContent = "Unknown date";
    }

    // Source tag
    const idRow = el("div", "tv-session-id-row");
    const sourceTag = el("span", `tv-source-tag tv-source-${t.source}`);
    sourceTag.textContent = t.source;
    idRow.appendChild(sourceTag);
    if (t.session.model) {
      const modelTag = el("span", "tv-session-model");
      modelTag.textContent = t.session.model;
      idRow.appendChild(modelTag);
    }

    // Stats row
    const statsRow = el("div", "tv-session-stats-mini");
    const parts: string[] = [];
    if (t.summary) {
      if (t.summary.totalToolCalls > 0) parts.push(`${t.summary.totalToolCalls} tools`);
      if (t.summary.durationMs > 0) parts.push(formatDuration(t.summary.durationMs));
      const totalTok = (t.summary.totalTokens.input ?? 0) + (t.summary.totalTokens.output ?? 0);
      if (totalTok > 0) parts.push(`${formatTokens(totalTok)} tok`);
      if (t.summary.errorCount > 0) parts.push(`${t.summary.errorCount} err`);
    }
    statsRow.textContent = parts.join("  ·  ");

    const contentWrap = el("div", "tv-session-content");
    contentWrap.appendChild(dateRow);
    contentWrap.appendChild(idRow);
    contentWrap.appendChild(statsRow);

    item.appendChild(checkbox);
    item.appendChild(contentWrap);

    // Click selects single, checkbox multi-selects
    contentWrap.onclick = () => {
      state.selectedIndex = realIndex;
      state.expandedEvents.clear();
      state.filterTool = null;
      state._userPickedView = false;
      // Auto-collapse sidebar after selecting — give full space to the dashboard
      try { localStorage.setItem("tv-sidebar-collapsed", "1"); } catch {}
      renderApp();
    };

    list.appendChild(item);
  }

  sidebar.appendChild(list);
  return sidebar;
}

// ── Detail Panel ──────────────────────────────────────────────────────

function renderDetail(): HTMLElement {
  const detail = el("div", "tv-detail");

  const trajectories = getActiveTrajectories();
  if (trajectories.length === 0) {
    detail.innerHTML = "<p class='tv-placeholder'>Select a session from the left</p>";
    return detail;
  }

  // ── View Switcher (only show enabled views, gray out unavailable) ──
  const enabledViews = getAllViews().filter((v) => isViewEnabled(v.id));
  const availability = checkDataAvailability(trajectories);

  // Smart default: if session has very few tool calls, Chat view is more useful than Dashboard
  // Only applies on first view of a session (when user hasn't explicitly picked a view yet)
  if (!state._userPickedView && (state.activeViewId === "dashboard" || state.activeViewId === getDefaultViewId())) {
    const allEvents = trajectories.flatMap(t => t.events);
    const toolCallCount = allEvents.filter(e => e.type === "tool_call").length;
    if (toolCallCount < 5 && enabledViews.some(v => v.id === "conversation")) {
      state.activeViewId = "conversation";
    }
  }

  // If active view was disabled, switch to first usable enabled view
  if (!enabledViews.find((v) => v.id === state.activeViewId) && enabledViews.length > 0) {
    const firstUsable = enabledViews.find((v) => isViewUsable(v, availability).usable);
    state.activeViewId = (firstUsable ?? enabledViews[0]).id;
  }

  if (enabledViews.length > 1) {
    const switcher = el("div", "tv-view-switcher");
    switcher.setAttribute("role", "tablist");
    switcher.setAttribute("aria-label", "View selector");

    // Split views by tier
    // Tabs always pinned in the bar, in this exact order. Chat (conversation)
    // is "standard" tier but pinned next to Table so the primary surfaces are
    // always one click away. Insights sits next to Dashboard since they're
    // sibling surfaces (Dashboard = at-a-glance, Insights = deep findings).
    const PINNED_VIEW_IDS = ["dashboard", "insights", "gantt", "table", "conversation"];
    const pinnedViews = PINNED_VIEW_IDS
      .map((id) => enabledViews.find((v) => v.id === id))
      .filter((v): v is typeof enabledViews[number] => v != null);
    const pinnedSet = new Set(pinnedViews.map((v) => v.id));
    const standardViews = enabledViews.filter((v) => v.tier === "standard" && !pinnedSet.has(v.id));
    const advancedViews = enabledViews.filter((v) => v.tier === "advanced" && !pinnedSet.has(v.id));
    // Anything not pinned and not standard/advanced (e.g. an unexpected core
    // view that's not in the pinned list) still surfaces under More.
    const otherCoreViews = enabledViews.filter((v) => (v.tier === "core" || !v.tier) && !pinnedSet.has(v.id));
    const extraViews = [...otherCoreViews, ...standardViews, ...advancedViews];

    // Helper to create a view tab button
    const makeViewBtn = (view: typeof enabledViews[0]) => {
      const { usable, missing } = isViewUsable(view, availability);
      const isActive = state.activeViewId === view.id;
      const btn = el("button", `tv-view-btn ${isActive ? "tv-view-active" : ""} ${!usable ? "tv-view-disabled" : ""}`);
      btn.innerHTML = `<span class="tv-view-icon">${esc(view.icon)}</span> ${esc(view.name)}`;
      btn.title = !usable ? `Requires: ${missing.map(getRequirementLabel).join(", ")}` : view.description;
      btn.onclick = () => {
        const prev = getView(state.activeViewId);
        if (prev?.destroy) prev.destroy();
        state.activeViewId = view.id;
        state._userPickedView = true;
        renderApp();
      };
      return btn;
    };

    // Pinned tabs always visible (Dashboard, Timeline, Table, Chat)
    for (const view of pinnedViews) {
      switcher.appendChild(makeViewBtn(view));
    }

    // If active view is in extras, show it as a tab too
    const activeInExtras = extraViews.find((v) => v.id === state.activeViewId);
    if (activeInExtras) {
      switcher.appendChild(makeViewBtn(activeInExtras));
    }

    // "More" dropdown for standard + advanced views
    if (extraViews.length > 0) {
      const moreWrap = el("div", "tv-more-wrap");
      const moreBtn = el("button", "tv-view-btn tv-more-btn");
      moreBtn.textContent = `More (${extraViews.length})`;
      moreBtn.title = "Show additional views";
      moreBtn.setAttribute("aria-haspopup", "true");
      moreBtn.setAttribute("aria-expanded", "false");
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        const existing = document.querySelector(".tv-more-dropdown");
        if (existing) { existing.remove(); return; }

        const dropdown = el("div", "tv-more-dropdown");

        if (standardViews.length > 0) {
          const label = el("div", "tv-more-label");
          label.textContent = "Standard";
          dropdown.appendChild(label);
          for (const view of standardViews) {
            const { usable, missing } = isViewUsable(view, availability);
            const item = el("div", `tv-more-item ${!usable ? "tv-more-item-disabled" : ""}`);
            item.innerHTML = `<span class="tv-view-icon">${esc(view.icon)}</span> ${esc(view.name)}`;
            item.title = !usable ? `Requires: ${missing.map(getRequirementLabel).join(", ")}` : view.description;
            item.onclick = () => {
              const prev = getView(state.activeViewId);
              if (prev?.destroy) prev.destroy();
              state.activeViewId = view.id;
              dropdown.remove();
              renderApp();
            };
            dropdown.appendChild(item);
          }
        }

        if (advancedViews.length > 0) {
          const label = el("div", "tv-more-label");
          label.textContent = "Advanced";
          dropdown.appendChild(label);
          for (const view of advancedViews) {
            const { usable, missing } = isViewUsable(view, availability);
            const item = el("div", `tv-more-item ${!usable ? "tv-more-item-disabled" : ""}`);
            item.innerHTML = `<span class="tv-view-icon">${esc(view.icon)}</span> ${esc(view.name)}`;
            item.title = !usable ? `Requires: ${missing.map(getRequirementLabel).join(", ")}` : view.description;
            item.onclick = () => {
              const prev = getView(state.activeViewId);
              if (prev?.destroy) prev.destroy();
              state.activeViewId = view.id;
              dropdown.remove();
              renderApp();
            };
            dropdown.appendChild(item);
          }
        }

        moreWrap.appendChild(dropdown);
        setTimeout(() => {
          document.addEventListener("click", function closer() {
            dropdown.remove();
            document.removeEventListener("click", closer);
          });
        }, 0);
      };
      moreWrap.appendChild(moreBtn);
      switcher.appendChild(moreWrap);
    }

    detail.appendChild(switcher);
  }

  // ── Render active view ──
  const activeView = getView(state.activeViewId) ?? (enabledViews.length > 0 ? enabledViews[0] : null);
  if (activeView) {
    // Inject view-specific CSS + user overrides
    const existingStyle = document.getElementById("tv-view-css");
    if (existingStyle) existingStyle.remove();
    const cssOverride = settings.viewCssOverrides[activeView.id] ?? "";
    const combinedCss = (activeView.css ?? "") + (cssOverride ? `\n/* User overrides */\n${cssOverride}` : "");
    if (combinedCss) {
      const style = document.createElement("style");
      style.id = "tv-view-css";
      style.textContent = combinedCss;
      document.head.appendChild(style);
    }

    const viewContainer = el("div", "tv-view-container");
    const viewOptions: ViewOptions = {
      darkMode: state.darkMode,
      filterTool: state.filterTool,
      expandedEvents: state.expandedEvents,
      onStateChange: (update) => {
        if (update.filterTool !== undefined) state.filterTool = update.filterTool;
        if (update.expandedEvents !== undefined) state.expandedEvents = update.expandedEvents;
        if (update.switchView) {
          state.activeViewId = update.switchView;
          state._userPickedView = true;
        }
        // Use a full re-render here. Routing expand/filter through
        // renderTrajectoriesIncremental (morphdom) felt right for the
        // dashboard but broke the Table view's internal virtualizer:
        // morphdom would diff a partial virtualized snapshot and lose
        // the expanded-row content. Full re-render is cheap because the
        // view's own render() rebuilds the virtualizer state cleanly.
        renderApp();
      },
      allTrajectories: state.trajectories,
    };
    // Show info banner if this view has missing data requirements
    const { usable: viewUsable, missing: viewMissing } = isViewUsable(activeView, availability);
    if (!viewUsable && viewMissing.length > 0) {
      const banner = el("div", "tv-view-info-banner");
      banner.innerHTML = `
        <strong>Limited data available</strong>
        <span>This view works best with: ${viewMissing.map((m) => esc(getRequirementLabel(m))).join(", ")}.
        The loaded session format doesn't include this data.</span>
      `;
      viewContainer.appendChild(banner);
    }

    activeView.render(viewContainer, trajectories, viewOptions);
    detail.appendChild(viewContainer);
  }

  return detail;
}

// Detail rendering is handled by the active view plugin (see src/views/)

// ── Helpers ────────────────────────────────────────────────────────────

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(2)}M`;
}
