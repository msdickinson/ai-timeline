/**
 * Web Worker for parsing trajectory files off the main thread.
 *
 * Keeps the UI responsive while parsing large files (70MB+ sessions).
 * The main thread sends file contents + filename, this worker runs all
 * text-based parsers and sends back the parsed Trajectory[].
 *
 * SQLite (.vscdb) files are NOT handled here — they need the sql.js
 * WASM module which stays on the main thread.
 */

import { parseFile, parseFiles } from "../parsers/index";
import type { Trajectory } from "../common/types";

export interface ParseRequest {
  id: number;
  type: "parseFile" | "parseFiles";
  /** For parseFile */
  contents?: string;
  filename?: string;
  /** For parseFiles (batch) */
  files?: Array<{ name: string; contents: string }>;
}

export interface ParseResponse {
  id: number;
  trajectories: Trajectory[];
  error?: string;
  parseTimeMs: number;
}

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const req = e.data;
  const start = performance.now();

  try {
    let trajectories: Trajectory[];

    if (req.type === "parseFiles" && req.files) {
      trajectories = parseFiles(req.files);
    } else if (req.type === "parseFile" && req.contents != null && req.filename) {
      trajectories = parseFile(req.contents, req.filename);
    } else {
      trajectories = [];
    }

    const resp: ParseResponse = {
      id: req.id,
      trajectories,
      parseTimeMs: performance.now() - start,
    };
    self.postMessage(resp);
  } catch (err) {
    const resp: ParseResponse = {
      id: req.id,
      trajectories: [],
      error: err instanceof Error ? err.message : String(err),
      parseTimeMs: performance.now() - start,
    };
    self.postMessage(resp);
  }
};
