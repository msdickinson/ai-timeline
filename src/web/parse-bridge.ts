/**
 * Bridge between main thread and parse worker.
 * Provides async parseFile/parseFiles that run off the main thread.
 * Falls back to synchronous parsing if Workers aren't available.
 */

import type { Trajectory } from "../common/types";
import type { ParseRequest, ParseResponse } from "./parse-worker";
import { parseFile as parseFileSync, parseFiles as parseFilesSync } from "../parsers/index";

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (t: Trajectory[]) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./parse-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      const { id, trajectories, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) {
        p.reject(new Error(error));
      } else {
        p.resolve(trajectories);
      }
    };
    worker.onerror = (e) => {
      // Worker failed to load — fall back to sync for all pending
      console.warn("Parse worker error, falling back to sync:", e.message);
      worker = null;
      for (const [, p] of pending) {
        p.reject(new Error("Worker failed"));
      }
      pending.clear();
    };
    return worker;
  } catch {
    // Workers not supported
    return null;
  }
}

/**
 * Parse a single file off the main thread.
 * Falls back to synchronous parsing if worker isn't available.
 */
export async function parseFileAsync(contents: string, filename: string): Promise<Trajectory[]> {
  const w = getWorker();
  if (!w) {
    return parseFileSync(contents, filename);
  }

  const id = requestId++;
  return new Promise<Trajectory[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: ParseRequest = { id, type: "parseFile", contents, filename };
    try {
      w.postMessage(req);
    } catch {
      // postMessage can fail on very large strings in some browsers
      pending.delete(id);
      resolve(parseFileSync(contents, filename));
    }
  }).catch(() => {
    // Worker failed for this request — fall back to sync
    return parseFileSync(contents, filename);
  });
}

/**
 * Parse multiple files off the main thread.
 * Falls back to synchronous parsing if worker isn't available.
 */
export async function parseFilesAsync(files: Array<{ name: string; contents: string }>): Promise<Trajectory[]> {
  const w = getWorker();
  if (!w) {
    return parseFilesSync(files);
  }

  const id = requestId++;
  return new Promise<Trajectory[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: ParseRequest = { id, type: "parseFiles", files };
    try {
      w.postMessage(req);
    } catch {
      pending.delete(id);
      resolve(parseFilesSync(files));
    }
  }).catch(() => {
    return parseFilesSync(files);
  });
}

/**
 * Terminate the worker (cleanup).
 */
export function terminateParseWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    pending.clear();
  }
}
