/**
 * ClaudeCodeLiveDataSource — tails a directory of Claude Code session files
 * (.jsonl) and pushes trajectory updates as the files grow.
 *
 * Browser version: takes a FileSystemDirectoryHandle that the user already
 * granted permission to (typically `~/.claude/projects/`). Polls on a short
 * interval and re-parses changed files. Naive but correct — works for any
 * append-only session format.
 *
 * VSCode-extension version: the extension can pass `node:fs` paths via a
 * config bridge; that wiring lives in the extension.ts side and ultimately
 * funnels into the same parser. Not implemented in this file (browser only).
 *
 * NOTE: this source is intentionally generic — it does NOT assume the
 * Claude Code format. Any .jsonl/.json file in the watched dir gets handed
 * to the parser registry and dispatched to the right parser. The "Claude
 * Code" name is just the most common use case.
 */

import { parseFile, registerDataSource } from "../common/registry";
import type {
  DataSource,
  DataSourceCallbacks,
  DataSourceConfig,
} from "../common/registry";
import { Trajectory } from "../common/types";

interface ClaudeCodeLiveConfig extends DataSourceConfig {
  /** A handle the user has already granted read permission on. */
  dirHandle?: FileSystemDirectoryHandle;
  /** Poll interval in ms. Default 1000. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_MS = 1000;
const SUPPORTED_EXTS = [".jsonl", ".json", ".traj", ".md"];

interface FileSnapshot {
  /** name + size makes a stable-ish key across writes */
  key: string;
  lastModified: number;
  trajectories: Trajectory[];
}

export class ClaudeCodeLiveDataSource implements DataSource {
  id = "claude-code-live";
  name = "Claude Code (live)";
  description =
    "Tail a Claude Code projects directory (or any folder of session files) " +
    "and update views as new turns are written. Browser uses the File System " +
    "Access API; you'll be prompted to grant read permission once.";
  supportsLive = true;

  private callbacks: DataSourceCallbacks | null = null;
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private pollHandle: number | null = null;
  private snapshots = new Map<string, FileSnapshot>();
  private stopped = false;

  start(config: ClaudeCodeLiveConfig, callbacks: DataSourceCallbacks): void {
    this.callbacks = callbacks;
    this.stopped = false;
    this.snapshots.clear();

    if (!config.dirHandle) {
      callbacks.onError(
        "No directory handle provided. Use the browser's folder picker to grant " +
          "access to your Claude Code projects directory first."
      );
      return;
    }
    this.dirHandle = config.dirHandle;

    const interval = config.pollIntervalMs ?? DEFAULT_POLL_MS;
    callbacks.onStatus(`Live · polling every ${interval}ms`);

    // Kick off an immediate first scan, then start polling.
    void this.scan();
    this.pollHandle = window.setInterval(() => void this.scan(), interval);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.dirHandle = null;
    this.callbacks?.onStatus("Disconnected.");
  }

  renderConfig(container: HTMLElement): void {
    container.innerHTML = `
      <div class="tv-live-config">
        <button id="cc-live-pick" class="tv-btn">Pick directory…</button>
        <span id="cc-live-pick-status" class="tv-hint" style="margin-left:.5rem"></span>
        <p class="tv-hint">
          On macOS / Linux: <code>~/.claude/projects/</code>.
          On Windows: <code>%USERPROFILE%\\.claude\\projects</code>.
          The viewer will tail every <code>.jsonl</code> in this folder
          (and subfolders) and update as you use Claude Code.
        </p>
      </div>
    `;

    const status = container.querySelector<HTMLSpanElement>("#cc-live-pick-status");
    const btn = container.querySelector<HTMLButtonElement>("#cc-live-pick");
    if (btn) {
      btn.onclick = async () => {
        try {
          const handle = await (window as any).showDirectoryPicker({
            id: "claude-code-live",
            mode: "read",
          });
          this.dirHandle = handle;
          if (status) status.textContent = `Selected: ${handle.name}`;
        } catch {
          // User cancelled — leave handle as-is.
        }
      };
    }
  }

  collectConfig(_container: HTMLElement): ClaudeCodeLiveConfig {
    return {
      dirHandle: this.dirHandle ?? undefined,
      pollIntervalMs: DEFAULT_POLL_MS,
    };
  }

  // ─────────────────────────────────────────────────────────────────────

  private async scan(): Promise<void> {
    if (this.stopped) return;
    if (!this.dirHandle || !this.callbacks) return;

    let changedAnything = false;

    try {
      for await (const file of walk(this.dirHandle, "")) {
        const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
        if (!SUPPORTED_EXTS.includes(ext)) continue;

        const key = `${file.relativePath}::${file.fileObj.size}`;
        const prior = this.snapshots.get(file.relativePath);
        // Re-parse if: never seen, OR mtime advanced, OR size changed.
        if (
          prior &&
          prior.lastModified === file.fileObj.lastModified &&
          prior.key === key
        ) {
          continue;
        }

        let text: string;
        try {
          text = await file.fileObj.text();
        } catch {
          continue;
        }

        let trajectories: Trajectory[] = [];
        try {
          trajectories = parseFile(text, file.relativePath);
        } catch {
          // Parser failure on a partially-written file is normal — try again
          // next tick when more bytes have landed.
          continue;
        }

        this.snapshots.set(file.relativePath, {
          key,
          lastModified: file.fileObj.lastModified,
          trajectories,
        });
        changedAnything = true;
      }
    } catch (err) {
      this.callbacks.onError(`Scan failed: ${err}`);
      return;
    }

    if (changedAnything) {
      const all: Trajectory[] = [];
      for (const snap of this.snapshots.values()) {
        all.push(...snap.trajectories);
      }
      this.callbacks.onData(all);
      this.callbacks.onStatus(
        `Live · ${this.snapshots.size} file(s) · ${all.length} session(s)`
      );
    }
  }
}

interface WalkedFile {
  fileObj: File;
  /** Path under the root, slash-separated. */
  relativePath: string;
  /** Just the filename. */
  name: string;
}

async function* walk(
  dir: FileSystemDirectoryHandle,
  prefix: string
): AsyncGenerator<WalkedFile> {
  for await (const entry of (dir as any).values() as AsyncIterable<
    FileSystemHandle
  >) {
    const ePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "file") {
      try {
        const f = await (entry as FileSystemFileHandle).getFile();
        yield { fileObj: f, relativePath: ePath, name: entry.name };
      } catch {
        /* skip unreadable */
      }
    } else if (entry.kind === "directory") {
      // Skip noisy / huge dirs
      if (
        ["node_modules", ".git", "__pycache__", "venv", ".venv"].includes(
          entry.name
        )
      ) {
        continue;
      }
      yield* walk(entry as FileSystemDirectoryHandle, ePath);
    }
  }
}

registerDataSource(new ClaudeCodeLiveDataSource());
