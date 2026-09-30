import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// ── Known session locations per tool ──────────────────────────────────

interface ToolSource {
  name: string;
  findPaths(): string[];
  extensions: string[];
}

const TOOL_SOURCES: ToolSource[] = [
  {
    name: "Claude Code",
    findPaths() {
      const home = os.homedir();
      const base = path.join(home, ".claude", "projects");
      if (!fs.existsSync(base)) return [];
      // Return all project directories
      try {
        return fs.readdirSync(base, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(base, d.name));
      } catch { return []; }
    },
    extensions: [".jsonl"],
  },
  {
    name: "Cursor",
    findPaths() {
      const home = os.homedir();
      const locations = [
        path.join(home, ".cursor", "User", "workspaceStorage"),
        path.join(home, "AppData", "Roaming", "Cursor", "User", "workspaceStorage"),
        path.join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage"),
      ];
      return locations.filter(p => fs.existsSync(p));
    },
    extensions: [".vscdb", ".sqlite"],
  },
  {
    name: "Aider",
    findPaths() {
      // Aider stores .aider.chat.history.md in project roots
      // Check workspace folders
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) return [];
      return folders.map(f => f.uri.fsPath).filter(p => {
        try { return fs.existsSync(path.join(p, ".aider.chat.history.md")); } catch { return false; }
      });
    },
    extensions: [".md"],
  },
  {
    name: "Cline",
    findPaths() {
      const home = os.homedir();
      const locations = [
        path.join(home, ".cline", "tasks"),
        path.join(home, "AppData", "Roaming", "Code", "User", "globalStorage", "saoudrizwan.claude-dev"),
      ];
      return locations.filter(p => fs.existsSync(p));
    },
    extensions: [".json"],
  },
];

// ── Session Discovery ─────────────────────────────────────────────────

interface DiscoveredSession {
  tool: string;
  filePath: string;
  relativePath: string; // For subagent merging
  fileName: string;
  modifiedMs: number;
  sizeBytes: number;
  firstPrompt?: string; // First user message, extracted from file
}

/** Extract first real user prompt from a JSONL file.
 *  Two-pass: tries 64KB first (fast), falls back to 512KB for sessions with huge lines (screenshots). */
function extractFirstPrompt(filePath: string): string {
  const result = tryExtractPrompt(filePath, 65536);
  if (result) return result;
  // Retry with larger buffer — some lines are 700KB+ (contain base64 screenshot images)
  return tryExtractPrompt(filePath, 1024 * 1024) || "";
}

function tryExtractPrompt(filePath: string, maxBytes: number): string | null {
  try {
    const fd = fs.openSync(filePath, "r");
    const stat = fs.fstatSync(fd);
    const readSize = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(readSize);
    const bytesRead = fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);
    const chunk = buf.toString("utf-8", 0, bytesRead);
    const lines = chunk.split("\n");

    // Check up to 20 complete lines (skip last — may be truncated)
    const limit = Math.min(lines.length - 1, 20);
    for (let i = 0; i < limit; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);

        // Claude Code format: type=user, message.content is array of {type,text}
        if (obj.type === "user" && obj.message?.content) {
          const content = obj.message.content;
          if (typeof content === "string") {
            const t = content.trim();
            if (t.length > 5 && !t.startsWith("<")) return t.split("\n")[0].slice(0, 200);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                const t = block.text.trim();
                if (t.length > 5 && !t.startsWith("<")) return t.split("\n")[0].slice(0, 200);
              }
            }
          }
        }

        // Generic format: role=human/user with string content
        if ((obj.role === "human" || obj.role === "user") && typeof obj.content === "string") {
          const t = obj.content.trim();
          if (t.length > 5 && !t.startsWith("<")) return t.split("\n")[0].slice(0, 200);
        }
      } catch {}
    }
  } catch {}
  return null;
}

function discoverSessions(): DiscoveredSession[] {
  const sessions: DiscoveredSession[] = [];

  for (const source of TOOL_SOURCES) {
    const paths = source.findPaths();
    for (const basePath of paths) {
      walkForSessions(basePath, basePath, source.name, source.extensions, sessions);
    }
  }

  // Sort by modified time, most recent first
  sessions.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return sessions;
}

function walkForSessions(
  dir: string,
  basePath: string,
  tool: string,
  extensions: string[],
  results: DiscoveredSession[],
  depth = 0
) {
  if (depth > 5) return; // Prevent deep recursion
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "__pycache__", "venv", ".venv"].includes(entry.name)) {
          walkForSessions(fullPath, basePath, tool, extensions, results, depth + 1);
        }
      } else if (entry.isFile()) {
        // Skip meta files and tiny files
        if (entry.name.endsWith(".meta.json")) continue;
        if (!extensions.some(ext => entry.name.endsWith(ext))) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size < 50) continue; // Skip empty/tiny files
          results.push({
            tool,
            filePath: fullPath,
            relativePath: path.relative(basePath, fullPath).replace(/\\/g, "/"),
            fileName: entry.name,
            modifiedMs: stat.mtimeMs,
            sizeBytes: stat.size,
          });
        } catch {}
      }
    }
  } catch {}
}

// ── Benchmark Types & Parsing ─────────────────────────────────────────

type BenchmarkStatus = "passed" | "failed" | "errored" | "skipped" | "unknown";

interface BenchmarkInstance {
  instanceId: string;
  status: BenchmarkStatus;
  trajectoryPath?: string;  // Path to the .traj / .jsonl file
  errorMessage?: string;
  durationSeconds?: number;
  cost?: number;
  testsTotal?: number;
  testsPassed?: number;
  testsFailed?: number;
}

interface BenchmarkRun {
  name: string;          // Display name
  source: string;        // "SWE-agent" | "OpenHands" | "TicketForge" | folder name
  folderPath: string;
  loadedAt: number;
  instances: BenchmarkInstance[];
  outputJsonlPath?: string; // For OpenHands: path to the big output.jsonl
}

/** Auto-detect benchmark format and parse a folder */
function parseBenchmarkFolder(folderPath: string): BenchmarkRun | null {
  try {
    // Try SWE-agent / OpenHands official harness: <instance_id>/trajectories/
    const harnessRun = tryHarnessFormat(folderPath);
    if (harnessRun) return harnessRun;

    // Try mini-swe-agent format: <instance_id>/<instance_id>.traj.json
    const miniRun = tryMiniSweAgent(folderPath);
    if (miniRun) return miniRun;

    // Try OpenHands format: output.jsonl with all instances
    const ohRun = tryOpenHands(folderPath);
    if (ohRun) return ohRun;

    // Try TicketForge JSON/JSONL export
    const tfRun = tryTicketForgeExport(folderPath);
    if (tfRun) return tfRun;

    // Fallback: just list trajectory files
    return tryGenericTrajectories(folderPath);
  } catch { return null; }
}

/** Parse SWE-agent or OpenHands harness output.
 *  Structure: <run_folder>/<instance_id>/trajectories/(agent.traj | trajectory.json)
 *  Results: results.json { resolved: ["id", ...] } OR per-instance eval_report.json */
function tryHarnessFormat(folderPath: string): BenchmarkRun | null {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const instanceDirs = entries.filter(e => e.isDirectory());

  // Load top-level results.json → { resolved: [...] }
  const resolvedSet = new Set<string>();
  const resultsPath = path.join(folderPath, "results.json");
  if (fs.existsSync(resultsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
      if (Array.isArray(data.resolved)) {
        for (const id of data.resolved) resolvedSet.add(id);
      }
    } catch {}
  }

  const instances: BenchmarkInstance[] = [];
  let detectedSource = "Unknown";

  for (const dir of instanceDirs) {
    if (dir.name === "logs" || dir.name === "__pycache__") continue;
    const trajDir = path.join(folderPath, dir.name, "trajectories");
    if (!fs.existsSync(trajDir)) continue;

    // SWE-agent uses agent.traj, OpenHands uses trajectory.json
    const sweAgentTraj = path.join(trajDir, "agent.traj");
    const openHandsTraj = path.join(trajDir, "trajectory.json");
    let trajectoryPath: string | undefined;
    if (fs.existsSync(sweAgentTraj)) {
      trajectoryPath = sweAgentTraj;
      detectedSource = "SWE-agent";
    } else if (fs.existsSync(openHandsTraj)) {
      trajectoryPath = openHandsTraj;
      detectedSource = "OpenHands";
    } else {
      // Try any file in trajectories/
      try {
        const trajFiles = fs.readdirSync(trajDir).filter(f => f.endsWith(".traj") || f.endsWith(".json"));
        if (trajFiles.length > 0) {
          trajectoryPath = path.join(trajDir, trajFiles[0]);
          detectedSource = "Harness";
        }
      } catch {}
    }

    if (!trajectoryPath) continue;

    // Determine pass/fail from results.json or per-instance eval_report.json
    let status: BenchmarkStatus = "unknown";
    let errorMessage: string | undefined;
    let cost: number | undefined;
    let testsTotal: number | undefined;
    let testsPassed: number | undefined;
    let testsFailed: number | undefined;

    // Top-level resolved list
    if (resolvedSet.size > 0) {
      status = resolvedSet.has(dir.name) ? "passed" : "failed";
    }

    // Per-instance eval_report.json (more detailed)
    const evalPath = path.join(folderPath, dir.name, "eval_report.json");
    if (fs.existsSync(evalPath)) {
      try {
        const evalData = JSON.parse(fs.readFileSync(evalPath, "utf-8"));
        const report = evalData[dir.name] || Object.values(evalData)[0];
        if (report) {
          if (report.resolved !== undefined) {
            status = report.resolved ? "passed" : "failed";
          }
          // Count test results
          const ts = report.tests_status;
          if (ts) {
            const f2pSuccess = ts.FAIL_TO_PASS?.success?.length || 0;
            const f2pFail = ts.FAIL_TO_PASS?.failure?.length || 0;
            const p2pSuccess = ts.PASS_TO_PASS?.success?.length || 0;
            const p2pFail = ts.PASS_TO_PASS?.failure?.length || 0;
            testsPassed = f2pSuccess + p2pSuccess;
            testsFailed = f2pFail + p2pFail;
            testsTotal = testsPassed + testsFailed;
          }
        }
      } catch {}
    }

    // Read trajectory metadata (cost, exit status) — just first few KB
    try {
      const fd = fs.openSync(trajectoryPath, "r");
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const head = buf.toString("utf-8", 0, n);
      // SWE-agent: look for model_stats in info block
      const costMatch = head.match(/"instance_cost"\s*:\s*([\d.]+)/);
      if (costMatch) cost = parseFloat(costMatch[1]);
      const exitMatch = head.match(/"exit_status"\s*:\s*"([^"]+)"/);
      if (exitMatch && exitMatch[1] !== "submitted" && exitMatch[1] !== "submit") {
        errorMessage = exitMatch[1];
        if (status === "unknown") status = "errored";
      }
    } catch {}

    instances.push({
      instanceId: dir.name,
      status,
      trajectoryPath,
      cost,
      errorMessage,
      testsTotal,
      testsPassed,
      testsFailed,
    });
  }

  if (instances.length === 0) return null;

  instances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return {
    name: path.basename(folderPath),
    source: detectedSource,
    folderPath,
    loadedAt: Date.now(),
    instances,
  };
}

/** Parse mini-swe-agent format: <instance_id>/<instance_id>.traj.json
 *  Top-level preds.json has patches, exit_statuses*.yaml has statuses */
function tryMiniSweAgent(folderPath: string): BenchmarkRun | null {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const instanceDirs = entries.filter(e => e.isDirectory());

  const instances: BenchmarkInstance[] = [];

  for (const dir of instanceDirs) {
    // Look for <instance_id>.traj.json inside the dir
    const trajFile = path.join(folderPath, dir.name, `${dir.name}.traj.json`);
    if (!fs.existsSync(trajFile)) continue;

    let status: BenchmarkStatus = "unknown";
    let errorMessage: string | undefined;
    let cost: number | undefined;

    // Read trajectory info
    try {
      const data = JSON.parse(fs.readFileSync(trajFile, "utf-8"));
      const info = data.info || {};
      const exitStatus = (info.exit_status || "").toLowerCase();
      if (exitStatus === "submitted" || exitStatus === "submit") {
        status = "passed"; // Submitted = completed successfully (actual test pass/fail needs eval)
      } else if (exitStatus.includes("timeout") || exitStatus === "limitsexceeded") {
        status = "skipped";
        errorMessage = info.exit_status;
      } else if (exitStatus.includes("error") || exitStatus.includes("context")) {
        status = "errored";
        errorMessage = info.exit_status;
      } else if (exitStatus) {
        status = "unknown";
        errorMessage = info.exit_status;
      }
      cost = info.model_stats?.instance_cost;
    } catch {}

    instances.push({
      instanceId: dir.name,
      status,
      trajectoryPath: trajFile,
      cost,
      errorMessage,
    });
  }

  if (instances.length === 0) return null;

  instances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return {
    name: path.basename(folderPath),
    source: "mini-swe-agent",
    folderPath,
    loadedAt: Date.now(),
    instances,
  };
}

/** Parse OpenHands format.
 *  Identifies by: output.jsonl present + eval-report.json with resolved_ids/completed_ids.
 *  Does NOT read the giant output.jsonl for listing — uses eval-report for instance list.
 *  output.jsonl is only read when viewing a specific instance trajectory. */
function tryOpenHands(folderPath: string): BenchmarkRun | null {
  // Must have output.jsonl to be OpenHands
  let outputPath = "";
  const direct = path.join(folderPath, "output.jsonl");
  if (fs.existsSync(direct)) {
    outputPath = direct;
  } else {
    // Search nested dirs (OpenHands uses deep folder structure)
    try {
      const find = (dir: string, depth: number): string => {
        if (depth > 4) return "";
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isFile() && e.name === "output.jsonl") return path.join(dir, e.name);
          if (e.isDirectory() && !["logs", "conversations", "__pycache__"].includes(e.name)) {
            const found = find(path.join(dir, e.name), depth + 1);
            if (found) return found;
          }
        }
        return "";
      };
      outputPath = find(folderPath, 0);
    } catch {}
  }
  if (!outputPath) return null;

  // Verify it's OpenHands format by reading just the first line
  try {
    const fd = fs.openSync(outputPath, "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.toString("utf-8", 0, n);
    // OpenHands output.jsonl has instance_id + test_result (history comes later in the giant line)
    if (!head.includes('"instance_id"') || !head.includes('"test_result"')) return null;
  } catch { return null; }

  // Build instance list from eval-report (fast — no need to read 600MB+ output.jsonl)
  const resolvedSet = new Set<string>();
  const completedSet = new Set<string>();
  const errorSet = new Set<string>();
  const allIds = new Set<string>();

  for (const name of ["eval-report.json", "eval_report.json"]) {
    const reportPath = path.join(folderPath, name);
    if (!fs.existsSync(reportPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      if (Array.isArray(data.resolved_ids)) data.resolved_ids.forEach((id: string) => { resolvedSet.add(id); allIds.add(id); });
      if (Array.isArray(data.unresolved_ids)) data.unresolved_ids.forEach((id: string) => allIds.add(id));
      if (Array.isArray(data.completed_ids)) data.completed_ids.forEach((id: string) => { completedSet.add(id); allIds.add(id); });
      if (Array.isArray(data.error_ids)) data.error_ids.forEach((id: string) => { errorSet.add(id); allIds.add(id); });
      if (Array.isArray(data.empty_patch_ids)) data.empty_patch_ids.forEach((id: string) => allIds.add(id));
      if (Array.isArray(data.incomplete_ids)) data.incomplete_ids.forEach((id: string) => allIds.add(id));
    } catch {}
  }

  const instances: BenchmarkInstance[] = [];

  if (allIds.size > 0) {
    // Build from eval-report — instant, no big file read
    for (const id of allIds) {
      let status: BenchmarkStatus = "unknown";
      if (resolvedSet.has(id)) status = "passed";
      else if (errorSet.has(id)) status = "errored";
      else if (completedSet.has(id)) status = "failed";
      instances.push({ instanceId: id, status });
    }
  } else {
    // No eval-report — scan output.jsonl line by line for just instance_ids
    // Read in chunks to avoid loading 600MB into memory
    try {
      const fd = fs.openSync(outputPath, "r");
      const chunkSize = 2 * 1024 * 1024; // 2MB chunks
      const buf = Buffer.alloc(chunkSize);
      let leftover = "";
      let bytesRead: number;
      let offset = 0;
      do {
        bytesRead = fs.readSync(fd, buf, 0, chunkSize, offset);
        offset += bytesRead;
        const chunk = leftover + buf.toString("utf-8", 0, bytesRead);
        const lines = chunk.split("\n");
        leftover = lines.pop() || ""; // Last line may be incomplete
        for (const line of lines) {
          if (!line.trim()) continue;
          // Extract instance_id without full JSON parse (fast regex)
          const match = line.match(/"instance_id"\s*:\s*"([^"]+)"/);
          if (match) {
            instances.push({ instanceId: match[1], status: "unknown" });
          }
        }
      } while (bytesRead === chunkSize);
      fs.closeSync(fd);
    } catch {}
  }

  if (instances.length === 0) return null;

  instances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return {
    name: path.basename(folderPath),
    source: "OpenHands",
    folderPath,
    loadedAt: Date.now(),
    instances,
    outputJsonlPath: outputPath,
  };
}

function tryTicketForgeExport(folderPath: string): BenchmarkRun | null {
  const entries = fs.readdirSync(folderPath);

  // JSON with { suite, instances: [...] }
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".meta.json") || entry === "results.json" || entry === "eval_report.json") continue;
    const filePath = path.join(folderPath, entry);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (data.instances && Array.isArray(data.instances) && data.instances.length > 0) {
        const instances: BenchmarkInstance[] = data.instances.map((inst: any) => {
          const statusStr = (inst.status || "").toLowerCase();
          let status: BenchmarkStatus = "unknown";
          if (statusStr === "passed" || statusStr === "pass") status = "passed";
          else if (statusStr === "failed" || statusStr === "fail") status = "failed";
          else if (statusStr === "errored" || statusStr === "error") status = "errored";
          else if (statusStr === "skipped" || statusStr === "skip") status = "skipped";
          return {
            instanceId: inst.instanceId || inst.instance_id || inst.id || "unknown",
            status,
            errorMessage: inst.errorMessage || inst.error_message,
            durationSeconds: inst.durationSeconds || inst.duration_seconds,
            cost: inst.costUsd || inst.cost_usd || inst.cost,
            testsTotal: inst.testsTotal || inst.tests_total,
            testsPassed: inst.testsPassed || inst.tests_passed,
            testsFailed: inst.testsFailed || inst.tests_failed,
          };
        });
        return {
          name: data.suite ? `${data.suite} #${data.runId || ""}` : path.basename(entry, ".json"),
          source: "TicketForge",
          folderPath,
          loadedAt: Date.now(),
          instances,
        };
      }
    } catch {}
  }

  // JSONL (one instance per line)
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    try {
      const lines = fs.readFileSync(path.join(folderPath, entry), "utf-8").split("\n").filter(l => l.trim());
      if (lines.length < 2) continue;
      const first = JSON.parse(lines[0]);
      if (!first.instanceId && !first.instance_id) continue;
      const instances: BenchmarkInstance[] = [];
      for (const line of lines) {
        try {
          const inst = JSON.parse(line);
          const s = (inst.status || "").toLowerCase();
          instances.push({
            instanceId: inst.instanceId || inst.instance_id,
            status: s.includes("pass") ? "passed" : s.includes("fail") ? "failed" : s.includes("error") ? "errored" : "unknown",
            errorMessage: inst.errorMessage || inst.error_message,
            durationSeconds: inst.durationSeconds || inst.duration_seconds,
            cost: inst.costUsd || inst.cost_usd,
            testsTotal: inst.testsTotal || inst.tests_total,
            testsPassed: inst.testsPassed || inst.tests_passed,
            testsFailed: inst.testsFailed || inst.tests_failed,
          });
        } catch {}
      }
      if (instances.length > 0) {
        return { name: path.basename(entry, ".jsonl"), source: "TicketForge", folderPath, loadedAt: Date.now(), instances };
      }
    } catch {}
  }
  return null;
}

/** Extract a single instance's line from a large JSONL file by scanning for instance_id.
 *  Returns the raw JSON string or null. Reads in 2MB chunks to avoid loading 600MB+. */
function extractInstanceFromJsonl(jsonlPath: string, instanceId: string): string | null {
  try {
    const fd = fs.openSync(jsonlPath, "r");
    const chunkSize = 2 * 1024 * 1024;
    const buf = Buffer.alloc(chunkSize);
    let leftover = "";
    let bytesRead: number;
    let offset = 0;
    const needle = `"instance_id":"${instanceId}"`;
    const needleSpaced = `"instance_id": "${instanceId}"`;
    do {
      bytesRead = fs.readSync(fd, buf, 0, chunkSize, offset);
      offset += bytesRead;
      const chunk = leftover + buf.toString("utf-8", 0, bytesRead);
      const lines = chunk.split("\n");
      leftover = lines.pop() || "";
      for (const line of lines) {
        if (line.includes(needle) || line.includes(needleSpaced)) {
          fs.closeSync(fd);
          return line;
        }
      }
    } while (bytesRead === chunkSize);
    // Check leftover
    if (leftover.includes(needle) || leftover.includes(needleSpaced)) {
      fs.closeSync(fd);
      return leftover;
    }
    fs.closeSync(fd);
  } catch {}
  return null;
}

/** Single-pass extraction of multiple instances from a large JSONL file.
 *  Scans the file once, collecting all matching lines. Much faster than N separate scans. */
// ── Benchmark Cache ──────────────────────────────────────────────────

/** Get cache directory for a benchmark run's JSONL */
function getBenchmarkCacheDir(jsonlPath: string): string {
  const hash = path.basename(jsonlPath, path.extname(jsonlPath));
  return path.join(os.tmpdir(), "ai-timeline-cache", hash);
}

/** Check if an instance is cached, return its path or null */
function getCachedInstance(jsonlPath: string, instanceId: string): string | null {
  const cacheDir = getBenchmarkCacheDir(jsonlPath);
  const cached = path.join(cacheDir, `${instanceId}.jsonl`);
  return fs.existsSync(cached) ? cached : null;
}

/** Read a cached instance */
function readCachedInstance(jsonlPath: string, instanceId: string): string | null {
  const p = getCachedInstance(jsonlPath, instanceId);
  if (!p) return null;
  try { return fs.readFileSync(p, "utf-8"); } catch { return null; }
}

/** Cache all instances from a JSONL in one pass. Returns count of cached instances. */
function cacheAllInstances(jsonlPath: string, onProgress?: (count: number) => void): number {
  const cacheDir = getBenchmarkCacheDir(jsonlPath);
  // Check if already cached
  const markerFile = path.join(cacheDir, ".cached");
  if (fs.existsSync(markerFile)) {
    return parseInt(fs.readFileSync(markerFile, "utf-8") || "0", 10);
  }

  fs.mkdirSync(cacheDir, { recursive: true });

  let count = 0;
  try {
    const fd = fs.openSync(jsonlPath, "r");
    const chunkSize = 4 * 1024 * 1024; // 4MB chunks for speed
    const buf = Buffer.alloc(chunkSize);
    let leftover = "";
    let bytesRead: number;
    let offset = 0;

    do {
      bytesRead = fs.readSync(fd, buf, 0, chunkSize, offset);
      offset += bytesRead;
      const chunk = leftover + buf.toString("utf-8", 0, bytesRead);
      const lines = chunk.split("\n");
      leftover = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        // Extract instance_id with regex (faster than JSON.parse for 800KB lines)
        const match = line.match(/"instance_id"\s*:\s*"([^"]+)"/);
        if (match) {
          const id = match[1];
          fs.writeFileSync(path.join(cacheDir, `${id}.jsonl`), line, "utf-8");
          count++;
          onProgress?.(count);
        }
      }
    } while (bytesRead === chunkSize);

    // Handle leftover
    if (leftover.trim()) {
      const match = leftover.match(/"instance_id"\s*:\s*"([^"]+)"/);
      if (match) {
        fs.writeFileSync(path.join(cacheDir, `${match[1]}.jsonl`), leftover, "utf-8");
        count++;
      }
    }

    fs.closeSync(fd);
  } catch {}

  // Write marker
  fs.writeFileSync(path.join(cacheDir, ".cached"), String(count), "utf-8");
  return count;
}

/** Read multiple instances from cache (instant) or fallback to extraction */
function readInstanceFiles(jsonlPath: string, instanceIds: Set<string>): Array<{ name: string; contents: string }> {
  const results: Array<{ name: string; contents: string }> = [];
  const uncached: string[] = [];

  for (const id of instanceIds) {
    const content = readCachedInstance(jsonlPath, id);
    if (content) {
      results.push({ name: `${id}.jsonl`, contents: content });
    } else {
      uncached.push(id);
    }
  }

  // If some aren't cached, extract them (and cache while at it)
  if (uncached.length > 0) {
    const extracted = extractMultipleFromJsonl(jsonlPath, new Set(uncached));
    // Cache the extracted ones for next time
    const cacheDir = getBenchmarkCacheDir(jsonlPath);
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const f of extracted) {
      try { fs.writeFileSync(path.join(cacheDir, f.name), f.contents, "utf-8"); } catch {}
    }
    results.push(...extracted);
  }

  return results;
}

function extractMultipleFromJsonl(
  jsonlPath: string,
  instanceIds: Set<string>,
  onProgress?: (found: number, target: number) => void,
): Array<{ name: string; contents: string }> {
  const results: Array<{ name: string; contents: string }> = [];
  const remaining = new Set(instanceIds);
  const target = instanceIds.size;

  try {
    const fd = fs.openSync(jsonlPath, "r");
    const chunkSize = 2 * 1024 * 1024;
    const buf = Buffer.alloc(chunkSize);
    let leftover = "";
    let bytesRead: number;
    let offset = 0;

    do {
      bytesRead = fs.readSync(fd, buf, 0, chunkSize, offset);
      offset += bytesRead;
      const chunk = leftover + buf.toString("utf-8", 0, bytesRead);
      const lines = chunk.split("\n");
      leftover = lines.pop() || "";

      for (const line of lines) {
        if (remaining.size === 0) break;
        for (const id of remaining) {
          if (line.includes(`"instance_id":"${id}"`) || line.includes(`"instance_id": "${id}"`)) {
            results.push({ name: `${id}.jsonl`, contents: line });
            remaining.delete(id);
            onProgress?.(results.length, target);
            break;
          }
        }
      }
      if (remaining.size === 0) break;
    } while (bytesRead === chunkSize);

    // Check leftover
    if (remaining.size > 0 && leftover.trim()) {
      for (const id of remaining) {
        if (leftover.includes(`"instance_id":"${id}"`) || leftover.includes(`"instance_id": "${id}"`)) {
          results.push({ name: `${id}.json`, contents: leftover });
          remaining.delete(id);
        }
      }
    }

    fs.closeSync(fd);
  } catch {}

  return results;
}

function tryGenericTrajectories(folderPath: string): BenchmarkRun | null {
  // Don't match if this looks like a known format we failed to parse
  if (fs.existsSync(path.join(folderPath, "output.jsonl"))) return null;

  const files: BenchmarkInstance[] = [];
  const exts = [".traj", ".jsonl", ".json"];
  function walk(dir: string, depth = 0) {
    if (depth > 3 || files.length > 500) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory() && !["node_modules", ".git", "__pycache__", "logs"].includes(entry.name)) {
          walk(fp, depth + 1);
        } else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext)) && !entry.name.endsWith(".meta.json")) {
          try { if (fs.statSync(fp).size < 100) continue; } catch { continue; }
          files.push({ instanceId: path.relative(folderPath, fp).replace(/\\/g, "/"), status: "unknown", trajectoryPath: fp });
        }
      }
    } catch {}
  }
  walk(folderPath);
  if (files.length === 0) return null;
  return { name: path.basename(folderPath), source: "Generic", folderPath, loadedAt: Date.now(), instances: files };
}

// ── Tree Data Provider ────────────────────────────────────────────────

class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly session?: DiscoveredSession,
    public readonly children?: SessionTreeItem[],
    displayMode: DisplayMode = "prompt",
  ) {
    super(label, collapsibleState);
    if (session) {
      const time = new Date(session.modifiedMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      this.label = `${time}`;
      if (displayMode === "prompt" && session.firstPrompt) {
        this.description = `${formatSize(session.sizeBytes)} · ${session.firstPrompt}`;
      } else {
        this.description = `${formatSize(session.sizeBytes)} · ${session.tool}`;
      }
      this.tooltip = `${session.tool} · ${formatSize(session.sizeBytes)}\n${session.firstPrompt || "(no prompt)"}\n${session.filePath}`;
      this.contextValue = "session";
    }
  }
}

type DisplayMode = "compact" | "prompt";

class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: DiscoveredSession[] = [];
  private enabledSources: Set<string> = new Set(TOOL_SOURCES.map(s => s.name));
  displayMode: DisplayMode = "prompt";
  private customFolders: string[] = [];
  private searchFilter: string = "";
  private benchmarkRuns: BenchmarkRun[] = [];

  /** Get all discovered tool names */
  getAvailableSources(): string[] {
    const tools = new Set(this.sessions.map(s => s.tool));
    return [...tools];
  }

  /** Get all sessions (for compare picker) */
  getSessions(): DiscoveredSession[] {
    return this.sessions.filter(s => !s.relativePath.includes("subagents/"));
  }

  setEnabledSources(sources: Set<string>) {
    this.enabledSources = sources;
    this._onDidChangeTreeData.fire(undefined);
  }

  setSearchFilter(query: string) {
    this.searchFilter = query.toLowerCase();
    this._onDidChangeTreeData.fire(undefined);
  }

  getSearchFilter(): string {
    return this.searchFilter;
  }

  addBenchmarkRun(run: BenchmarkRun) {
    this.benchmarkRuns.push(run);
    this._onDidChangeTreeData.fire(undefined);
  }

  getBenchmarkRuns(): BenchmarkRun[] {
    return this.benchmarkRuns;
  }

  addCustomFolder(folderPath: string) {
    if (!this.customFolders.includes(folderPath)) {
      this.customFolders.push(folderPath);
      this.refresh();
    }
  }

  refresh() {
    this.sessions = discoverSessions();
    // Also scan custom folders
    for (const folder of this.customFolders) {
      walkForSessions(folder, folder, path.basename(folder), [".jsonl", ".json", ".traj"], this.sessions);
    }
    this.sessions.sort((a, b) => b.modifiedMs - a.modifiedMs);
    // Prompts are extracted lazily in getChildren() when groups expand
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem): SessionTreeItem[] {
    if (element) return element.children ?? [];

    const items: SessionTreeItem[] = [];

    // ── Benchmarks section ──
    if (this.benchmarkRuns.length > 0) {
      const benchChildren: SessionTreeItem[] = [];
      for (const run of this.benchmarkRuns) {
        const passed = run.instances.filter(i => i.status === "passed").length;
        const failed = run.instances.filter(i => i.status === "failed").length;
        const errored = run.instances.filter(i => i.status === "errored").length;
        const total = run.instances.length;

        const instanceChildren = run.instances.map(inst => {
          const statusIcon = inst.status === "passed" ? "\u2705"
            : inst.status === "failed" ? "\u274C"
            : inst.status === "errored" ? "\u26A0\uFE0F"
            : inst.status === "skipped" ? "\u23ED\uFE0F"
            : "\u2754";

          const item = new SessionTreeItem(
            `${statusIcon} ${inst.instanceId}`,
            vscode.TreeItemCollapsibleState.None,
          );
          // Build description with available metadata
          const parts: string[] = [];
          if (inst.testsPassed !== undefined && inst.testsTotal !== undefined) {
            parts.push(`${inst.testsPassed}/${inst.testsTotal} tests`);
          }
          if (inst.durationSeconds) parts.push(`${inst.durationSeconds}s`);
          if (inst.cost) parts.push(`$${inst.cost.toFixed(2)}`);
          if (inst.errorMessage) parts.push(inst.errorMessage.slice(0, 60));
          item.description = parts.join(" · ") || inst.status;

          // Make clickable — store benchmark info for loading
          if (inst.trajectoryPath) {
            (item as any).session = {
              tool: run.source,
              filePath: inst.trajectoryPath,
              relativePath: path.basename(inst.trajectoryPath),
              fileName: path.basename(inst.trajectoryPath),
              modifiedMs: run.loadedAt,
              sizeBytes: 0,
            } as DiscoveredSession;
          }
          // Store benchmark context for OpenHands (no trajectoryPath) or run-level loading
          (item as any).benchmarkRun = run;
          (item as any).benchmarkInstance = inst;
          item.contextValue = "benchmarkInstance";

          item.tooltip = `${inst.instanceId}\nStatus: ${inst.status}${inst.errorMessage ? "\nError: " + inst.errorMessage : ""}${inst.trajectoryPath ? "\n" + inst.trajectoryPath : ""}`;

          return item;
        });

        const runLabel = `${run.name} — ${passed}/${total} passed`;
        const runDesc = [run.source];
        if (failed > 0) runDesc.push(`${failed} failed`);
        if (errored > 0) runDesc.push(`${errored} errored`);

        // Add "View All" action at top of instance list
        const viewAllItem = new SessionTreeItem(
          "$(play) View All",
          vscode.TreeItemCollapsibleState.None,
        );
        viewAllItem.description = `Load all ${total} trajectories`;
        viewAllItem.command = { command: "aiTimeline.openBenchmarkRun", title: "View All", arguments: [run] };

        const runItem = new SessionTreeItem(
          runLabel,
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          [viewAllItem, ...instanceChildren],
        );
        runItem.description = runDesc.join(" · ");
        (runItem as any).benchmarkRun = run;
        runItem.contextValue = "benchmarkRun";

        benchChildren.push(runItem);
      }

      // Add "Load more..." action at the end
      const loadMore = new SessionTreeItem(
        "$(add) Load Benchmark Run...",
        vscode.TreeItemCollapsibleState.None,
      );
      loadMore.command = { command: "aiTimeline.loadBenchmark", title: "Load Benchmark" };
      benchChildren.push(loadMore);

      const benchSection = new SessionTreeItem(
        `Benchmarks (${this.benchmarkRuns.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        undefined,
        benchChildren,
      );
      items.push(benchSection);
    } else {
      // Empty state — show load action
      const benchSection = new SessionTreeItem(
        "Benchmarks",
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        [(() => {
          const loadItem = new SessionTreeItem(
            "$(add) Load Benchmark Run...",
            vscode.TreeItemCollapsibleState.None,
          );
          loadItem.command = { command: "aiTimeline.loadBenchmark", title: "Load Benchmark" };
          return loadItem;
        })()],
      );
      items.push(benchSection);
    }

    // ── Sessions section ──
    if (this.sessions.length === 0 && this.benchmarkRuns.length === 0) {
      items.push(new SessionTreeItem("No sessions found", vscode.TreeItemCollapsibleState.None));
      return items;
    }

    // Group by date
    const groups = new Map<string, DiscoveredSession[]>();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;

    for (const session of this.sessions) {
      const sessionDate = new Date(session.modifiedMs);
      const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate()).getTime();

      let label: string;
      if (sessionDay >= today) label = "Today";
      else if (sessionDay >= yesterday) label = "Yesterday";
      else if (sessionDay >= today - 7 * 86400000) label = sessionDate.toLocaleDateString(undefined, { weekday: "long" });
      else label = sessionDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });

      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(session);
    }

    // Filter by enabled sources + exclude subagent files + search filter
    for (const [date, sessions] of groups) {
      let parentSessions = sessions.filter(s => !s.relativePath.includes("subagents/") && this.enabledSources.has(s.tool));
      if (this.searchFilter) {
        parentSessions = parentSessions.filter(s => {
          if (s.firstPrompt === undefined) {
            s.firstPrompt = extractFirstPrompt(s.filePath) || "";
          }
          return s.firstPrompt.toLowerCase().includes(this.searchFilter) ||
            s.fileName.toLowerCase().includes(this.searchFilter) ||
            s.tool.toLowerCase().includes(this.searchFilter);
        });
      }
      if (parentSessions.length === 0) continue;

      const children = parentSessions.slice(0, 50).map(s => {
        if (s.firstPrompt === undefined) {
          s.firstPrompt = extractFirstPrompt(s.filePath) || "";
        }
        return new SessionTreeItem(
          "",
          vscode.TreeItemCollapsibleState.None,
          s,
          undefined,
          this.displayMode,
        );
      });

      const expanded = (date === "Today" || date === "Yesterday")
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;

      items.push(new SessionTreeItem(
        `${date} (${parentSessions.length})`,
        expanded,
        undefined,
        children
      ));
    }

    return items;
  }
}

// ── Webview Panel ─────────────────────────────────────────────────────

class TrajectoryViewerPanel {
  public static currentPanel: TrajectoryViewerPanel | undefined;
  private static readonly viewType = "trajectoryViewer";
  public static onReady: (() => void) | undefined;
  public static onDisposed: (() => void) | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): TrajectoryViewerPanel {
    const column = vscode.ViewColumn.Beside;

    if (TrajectoryViewerPanel.currentPanel) {
      TrajectoryViewerPanel.currentPanel._panel.reveal(column);
      return TrajectoryViewerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      TrajectoryViewerPanel.viewType,
      "AI Timeline",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist", "web"),
          vscode.Uri.file(path.join(os.tmpdir(), "ai-timeline-cache")),
          vscode.Uri.file(path.join(os.tmpdir(), "ai-timeline-bench")),
        ],
      }
    );

    TrajectoryViewerPanel.currentPanel = new TrajectoryViewerPanel(panel, extensionUri);
    return TrajectoryViewerPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.webview.html = this._getHtml();

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "requestFiles": {
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectMany: true,
              filters: { "Session Files": ["jsonl", "json", "traj", "md"] },
            });
            if (uris) {
              this._sendFilePaths(uris.map(u => u.fsPath));
            }
            break;
          }
          case "requestFolder": {
            const uris = await vscode.window.showOpenDialog({
              canSelectFolders: true,
              canSelectFiles: false,
            });
            if (uris?.[0]) {
              this.loadFolder(uris[0].fsPath);
            }
            break;
          }
          case "ready": {
            TrajectoryViewerPanel.onReady?.();
            break;
          }
          case "debug": {
            vscode.window.showInformationMessage(`[Webview] ${message.message}`);
            break;
          }
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => {
      TrajectoryViewerPanel.currentPanel = undefined;
      TrajectoryViewerPanel.onDisposed?.();
      for (const d of this._disposables) d.dispose();
    }, null, this._disposables);
  }

  /** Send pre-read files to the webview */
  public sendFiles(files: Array<{ name: string; contents: string }>) {
    this._panel.webview.postMessage({ type: "filesLoaded", files });
  }

  /** Convert a local file path to a webview URI */
  public getWebviewUri(filePath: string): string {
    return this._panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
  }

  /** Send arbitrary message to the webview */
  public postMessage(msg: any) {
    this._panel.webview.postMessage(msg);
  }

  /** Load all session files in a folder */
  public loadFolder(folderPath: string) {
    const MAX_FILES = 2000;
    const files: Array<{ name: string; contents: string }> = [];
    const extensions = [".jsonl", ".json", ".traj"];

    function walk(dir: string, base: string, depth = 0) {
      if (depth > 5 || files.length >= MAX_FILES) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= MAX_FILES) return;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!["node_modules", ".git", "__pycache__", "venv", ".venv"].includes(entry.name)) {
              walk(fullPath, base, depth + 1);
            }
          } else if (entry.isFile()) {
            if (entry.name.endsWith(".meta.json")) continue;
            if (!extensions.some(ext => entry.name.endsWith(ext))) continue;
            try {
              files.push({
                name: path.relative(base, fullPath).replace(/\\/g, "/"),
                contents: fs.readFileSync(fullPath, "utf-8"),
              });
            } catch {}
          }
        }
      } catch {}
    }

    walk(folderPath, folderPath);

    if (files.length > 0) {
      this._panel.webview.postMessage({ type: "filesLoaded", files });
    } else {
      vscode.window.showInformationMessage("No session files found in that folder.");
    }
  }

  private _sendFilePaths(filePaths: string[]) {
    const files: Array<{ name: string; contents: string }> = [];
    for (const fp of filePaths) {
      try {
        files.push({ name: path.basename(fp), contents: fs.readFileSync(fp, "utf-8") });
      } catch {
        vscode.window.showWarningMessage(`Could not read: ${fp}`);
      }
    }
    if (files.length > 0) {
      this._panel.webview.postMessage({ type: "filesLoaded", files });
    }
  }

  private _getHtml(): string {
    const webview = this._panel.webview;
    const distWebPath = path.join(this._extensionUri.fsPath, "dist", "web");

    // Read the built index.html and rewrite asset paths to webview URIs
    let html: string;
    try {
      html = fs.readFileSync(path.join(distWebPath, "index.html"), "utf-8");
    } catch {
      return "<html><body><h2>Error: dist/web/index.html not found. Run npm run build first.</h2></body></html>";
    }

    const distWebUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "dist", "web"));

    // Rewrite absolute asset paths to webview URIs
    html = html.replace(/(?:src|href)="\/assets\//g, (match) => {
      return match.replace("/assets/", `${distWebUri}/assets/`);
    });

    // Also fix any other absolute paths
    html = html.replace(/href="\/manifest.json"/, `href="${distWebUri}/manifest.json"`);

    // Inject the VS Code bridge script before </body>
    const nonce = getNonce();
    const bridgeScript = `
  <style nonce="${nonce}">
    /* Match VS Code theme — override AI Timeline CSS variables with VS Code's */
    .tv-root {
      --tv-bg: var(--vscode-editor-background);
      --tv-bg-card: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      --tv-bg-hover: var(--vscode-list-hoverBackground);
      --tv-bg-sidebar: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --tv-bg-badge: var(--vscode-badge-background, #21262d);
      --tv-text: var(--vscode-editor-foreground);
      --tv-text-secondary: var(--vscode-descriptionForeground);
      --tv-text-muted: var(--vscode-descriptionForeground);
      --tv-border: var(--vscode-panel-border, var(--vscode-widget-border, #333));
      --tv-accent: var(--vscode-focusBorder, var(--vscode-button-background));
      --tv-accent-hover: var(--vscode-button-hoverBackground, var(--vscode-focusBorder));
      --tv-bar-bg: var(--vscode-progressBar-background, #21262d);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    /* Hide the theme selector in VS Code — theme is inherited */
    .tv-theme-select { display: none !important; }
    /* Let VS Code webview scroll naturally instead of fixed viewport */
    .tv-root {
      height: auto !important;
      min-height: 100vh;
      overflow: visible !important;
    }
    .tv-main {
      overflow: visible !important;
    }
    .tv-detail {
      overflow: visible !important;
    }
    /* View switcher — match VS Code tab bar style */
    .tv-view-switcher {
      background: transparent !important;
      border-bottom: 1px solid var(--vscode-panel-border, var(--tv-border));
      border-radius: 0 !important;
      padding: 0 !important;
      gap: 0 !important;
      width: 100% !important;
    }
    .tv-view-btn {
      border-radius: 0 !important;
      padding: 8px 14px !important;
      color: var(--vscode-tab-inactiveForeground, var(--tv-text-secondary)) !important;
      background: transparent !important;
      border-bottom: 2px solid transparent;
    }
    .tv-view-btn:hover {
      color: var(--vscode-tab-activeForeground, var(--tv-text)) !important;
      background: transparent !important;
    }
    .tv-view-btn.tv-view-active {
      color: var(--vscode-tab-activeForeground, var(--tv-text)) !important;
      background: transparent !important;
      box-shadow: none !important;
      border-bottom: 2px solid var(--vscode-focusBorder, var(--tv-accent)) !important;
      font-weight: 600;
    }
  </style>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    window.__isVSCodeExtension = true;
    window.vscodeRequestFiles = () => vscode.postMessage({ type: 'requestFiles' });
    window.vscodeRequestFolder = () => vscode.postMessage({ type: 'requestFolder' });
    window.vscodeDebugReport = (msg) => vscode.postMessage({ type: 'debug', message: msg });
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'filesLoaded' && window.__trajectoryViewer) {
        window.__trajectoryViewer.loadFiles(msg.files, msg.append);
        // Remove loading overlay after files are loaded
        const overlay = document.getElementById('tv-loading-overlay');
        if (overlay) overlay.remove();
      }
      if (msg.type === 'loading') {
        // Show loading overlay in the webview
        let overlay = document.getElementById('tv-loading-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'tv-loading-overlay';
          overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:var(--vscode-editor-background,#1e1e1e);z-index:9999;flex-direction:column;gap:16px;';
          document.body.appendChild(overlay);
        }
        overlay.innerHTML = '<div style="width:40px;height:40px;border:3px solid var(--vscode-descriptionForeground,#888);border-top-color:var(--vscode-focusBorder,#007acc);border-radius:50%;animation:tv-spin 0.8s linear infinite;"></div>'
          + '<div style="color:var(--vscode-foreground,#ccc);font-size:14px;">' + (msg.message || 'Loading...') + '</div>';
        if (!document.getElementById('tv-spin-style')) {
          const style = document.createElement('style');
          style.id = 'tv-spin-style';
          style.textContent = '@keyframes tv-spin { to { transform: rotate(360deg); } }';
          document.head.appendChild(style);
        }
      }
      if (msg.type === 'fetchFiles' && window.__trajectoryViewer) {
        // Fetch all files directly from disk via webview URIs — no postMessage data transfer
        Promise.all(msg.files.map(async (f) => {
          try {
            const resp = await fetch(f.uri);
            return { name: f.name, contents: await resp.text() };
          } catch { return null; }
        })).then((results) => {
          const valid = results.filter(r => r !== null);
          if (valid.length > 0) {
            window.__trajectoryViewer.loadFiles(valid, false);
          }
          // Remove loading overlay
          const overlay = document.getElementById('tv-loading-overlay');
          if (overlay) overlay.remove();
        });
      }
      if (msg.type === 'openExport' && window.__trajectoryViewer) {
        window.__trajectoryViewer.openExport();
      }
    });
    // Signal ready after a short delay to ensure app has initialized
    setTimeout(() => vscode.postMessage({ type: 'ready' }), 100);
  </script>`;
    html = html.replace("</body>", `${bridgeScript}\n</body>`);

    // Update CSP to allow webview resources + workers
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-inline'; worker-src ${webview.cspSource} blob:; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src ${webview.cspSource};`;
    // Replace existing CSP or inject one
    if (html.includes("Content-Security-Policy")) {
      html = html.replace(/content="default-src[^"]*"/, `content="${csp}"`);
    } else {
      html = html.replace("<head>", `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
    }

    return html;
  }
}

// ── Activation ────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // Create sidebar tree view with multi-select support
  const treeProvider = new SessionTreeProvider();
  const treeView = vscode.window.createTreeView("aiTimeline.sessions", {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
    canSelectMany: true,
  });

  // Auto-discover sessions on activation
  treeProvider.refresh();

  // Restore persisted benchmark runs
  const savedBenchmarks = context.globalState.get<Array<{ folder: string; name: string }>>("aiTimeline.benchmarks", []);
  for (const saved of savedBenchmarks) {
    if (fs.existsSync(saved.folder)) {
      const run = parseBenchmarkFolder(saved.folder);
      if (run) {
        run.name = saved.name;
        treeProvider.addBenchmarkRun(run);
      }
    }
  }

  function persistBenchmarks() {
    const runs = treeProvider.getBenchmarkRuns().map(r => ({ folder: r.folderPath, name: r.name }));
    context.globalState.update("aiTimeline.benchmarks", runs);
  }

  // Track when webview is ready to receive messages
  let webviewReady = false;
  let pendingLoad: (() => void) | undefined;

  function loadSessionsInPanel(sessions: DiscoveredSession[]) {
    const wasAlreadyOpen = !!TrajectoryViewerPanel.currentPanel;
    const panel = TrajectoryViewerPanel.createOrShow(context.extensionUri);
    const count = sessions.length;
    panel.postMessage({ type: "loading", message: count === 1 ? "Loading session..." : `Loading ${count} sessions...` });

    const doLoad = () => {
      // Collect all files from all selected sessions
      const allFiles: Array<{ name: string; contents: string }> = [];
      for (const session of sessions) {
        const sessionFiles = readSessionFiles(session);
        allFiles.push(...sessionFiles);
      }
      if (allFiles.length > 0) {
        panel.sendFiles(allFiles);
      }
    };

    if (wasAlreadyOpen && webviewReady) {
      // Panel already open and ready — send immediately
      doLoad();
    } else if (webviewReady) {
      // Panel was just created but ready flag is stale — wait a tick
      setTimeout(doLoad, 200);
    } else {
      pendingLoad = doLoad;
    }
  }

  /** Load raw file contents directly into the panel */
  function loadFilesInPanel(files: Array<{ name: string; contents: string }>) {
    const wasAlreadyOpen = !!TrajectoryViewerPanel.currentPanel;
    const panel = TrajectoryViewerPanel.createOrShow(context.extensionUri);
    const doLoad = () => {
      if (files.length > 0) panel.sendFiles(files);
    };
    if (wasAlreadyOpen && webviewReady) doLoad();
    else if (webviewReady) setTimeout(doLoad, 200);
    else pendingLoad = doLoad;
  }

  // Handle selection: sessions, benchmark instances, or mixed
  treeView.onDidChangeSelection((e) => {
    // Skip if selection is a command-only item (like "View All" or "Load Benchmark Run")
    if (e.selection.length === 1 && e.selection[0].command) return;

    // Collect all files from all selected items (sessions + benchmarks mixed)
    const allFiles: Array<{ name: string; contents: string }> = [];

    // Regular sessions
    const sessions = e.selection
      .filter((item) => item.session && !(item as any).benchmarkInstance)
      .map((item) => item.session!);
    const benchItems = e.selection.filter((item) => (item as any).benchmarkInstance);
    const totalSelected = sessions.length + benchItems.length;
    if (totalSelected === 0) return;

    // Show spinner based on user selection count, not file count
    const panel = TrajectoryViewerPanel.createOrShow(context.extensionUri);
    panel.postMessage({ type: "loading", message: totalSelected === 1 ? "Loading session..." : `Loading ${totalSelected} sessions...` });
    for (const session of sessions) {
      const sessionFiles = readSessionFiles(session);
      allFiles.push(...sessionFiles);
    }

    // Benchmark instances
    if (benchItems.length > 0) {
      const jsonlExtractions: Array<{ instanceId: string; run: BenchmarkRun }> = [];

      for (const item of benchItems) {
        const inst = (item as any).benchmarkInstance as BenchmarkInstance;
        const run = (item as any).benchmarkRun as BenchmarkRun;

        if (inst.trajectoryPath) {
          try {
            allFiles.push({
              name: `${inst.instanceId}.jsonl`,
              contents: fs.readFileSync(inst.trajectoryPath, "utf-8"),
            });
          } catch {}
        } else if (run.outputJsonlPath) {
          jsonlExtractions.push({ instanceId: inst.instanceId, run });
        }
      }

      if (jsonlExtractions.length > 0) {
        const run = jsonlExtractions[0].run;
        const ids = new Set(jsonlExtractions.map(j => j.instanceId));
        const extracted = readInstanceFiles(run.outputJsonlPath!, ids);
        allFiles.push(...extracted);
      }
    }

    if (allFiles.length > 0) {
      loadFilesInPanel(allFiles);
      return;
    }

    // Benchmark run header click — load all instances that have trajectories
    const runItems = e.selection.filter((item) => (item as any).benchmarkRun && !(item as any).benchmarkInstance);
    if (runItems.length > 0) {
      const run = (runItems[0] as any).benchmarkRun as BenchmarkRun;
      const withTrajectories = run.instances.filter(i => i.trajectoryPath);
      if (withTrajectories.length > 0) {
        // Load up to 50 trajectories for the aggregate view
        const limit = Math.min(withTrajectories.length, 50);
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Loading ${limit} trajectories...` },
          async () => {
            const files: Array<{ name: string; contents: string }> = [];
            for (let i = 0; i < limit; i++) {
              const inst = withTrajectories[i];
              try {
                files.push({
                  name: `${inst.instanceId}.json`,
                  contents: fs.readFileSync(inst.trajectoryPath!, "utf-8"),
                });
              } catch {}
            }
            if (files.length > 0) loadFilesInPanel(files);
          }
        );
      } else if (run.outputJsonlPath) {
        vscode.window.showInformationMessage(
          `${run.name}: ${run.instances.length} instances. Click individual instances to view their trajectories.`
        );
      }
    }
  });

  // Refresh command
  const refreshCmd = vscode.commands.registerCommand("aiTimeline.refresh", () => {
    treeProvider.refresh();
    vscode.window.showInformationMessage("AI Timeline: Sessions refreshed");
  });

  // Open session in viewer (for backward compat / command palette)
  const openSessionCmd = vscode.commands.registerCommand(
    "aiTimeline.openSession",
    (session: DiscoveredSession) => {
      loadSessionsInPanel([session]);
    }
  );

  // Open viewer (empty)
  const openCmd = vscode.commands.registerCommand("aiTimeline.open", () => {
    TrajectoryViewerPanel.createOrShow(context.extensionUri);
  });

  // Open file from explorer context menu
  const openFileCmd = vscode.commands.registerCommand(
    "aiTimeline.openFile",
    (uri: vscode.Uri) => {
      const session: DiscoveredSession = {
        tool: "Unknown",
        filePath: uri.fsPath,
        relativePath: path.basename(uri.fsPath),
        fileName: path.basename(uri.fsPath),
        modifiedMs: Date.now(),
        sizeBytes: 0,
      };
      loadSessionsInPanel([session]);
    }
  );

  // Open folder
  const openFolderCmd = vscode.commands.registerCommand("aiTimeline.openFolder", async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      title: "Select session folder",
    });
    if (uris?.[0]) {
      const panel = TrajectoryViewerPanel.createOrShow(context.extensionUri);
      panel.loadFolder(uris[0].fsPath);
    }
  });

  // Listen for webview ready messages
  TrajectoryViewerPanel.onReady = () => {
    webviewReady = true;
    if (pendingLoad) {
      pendingLoad();
      pendingLoad = undefined;
    }
  };
  TrajectoryViewerPanel.onDisposed = () => {
    webviewReady = false;
    pendingLoad = undefined;
  };

  // File watcher — watch for new sessions
  const home = os.homedir();
  const claudeProjects = path.join(home, ".claude", "projects");
  if (fs.existsSync(claudeProjects)) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(claudeProjects), "**/*.jsonl")
    );
    let debounceTimer: NodeJS.Timeout | undefined;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => treeProvider.refresh(), 1000);
    };
    watcher.onDidCreate(debouncedRefresh);
    watcher.onDidChange(debouncedRefresh);
    context.subscriptions.push(watcher);
  }

  // Export command — triggers the export modal in the webview
  const exportCmd = vscode.commands.registerCommand("aiTimeline.export", () => {
    if (TrajectoryViewerPanel.currentPanel) {
      TrajectoryViewerPanel.currentPanel.postMessage({ type: "openExport" });
    } else {
      vscode.window.showInformationMessage("Open a session first to export.");
    }
  });

  // Source filter — QuickPick with checkboxes for each tool
  const filterCmd = vscode.commands.registerCommand("aiTimeline.filter", async () => {
    const available = treeProvider.getAvailableSources();
    if (available.length === 0) {
      vscode.window.showInformationMessage("No sources found yet.");
      return;
    }
    const items: vscode.QuickPickItem[] = [
      ...available.map(s => ({
        label: s,
        picked: treeProvider["enabledSources"].has(s),
      })),
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(folder-opened) Add folder...", description: "Scan a custom folder for session files" },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: "Filter Sources",
      placeHolder: "Check sources to show in the sidebar",
    });

    if (!picked) return;

    // Check if "Add folder" was selected
    const addFolder = picked.find(p => p.label.includes("Add folder"));
    if (addFolder) {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        title: "Select folder with session files",
      });
      if (uris?.[0]) {
        treeProvider.addCustomFolder(uris[0].fsPath);
      }
    }

    // Update source filter
    const enabled = new Set(picked.filter(p => !p.label.includes("Add folder") && p.kind !== vscode.QuickPickItemKind.Separator).map(p => p.label));
    treeProvider.setEnabledSources(enabled);
  });

  // Compare — QuickPick multi-select sessions to load together
  const compareCmd = vscode.commands.registerCommand("aiTimeline.compare", async () => {
    const sessions = treeProvider.getSessions();
    const benchRuns = treeProvider.getBenchmarkRuns();
    const now = Date.now();
    const dayMs = 86400000;

    const items: Array<vscode.QuickPickItem & { session?: DiscoveredSession; benchRun?: BenchmarkRun; benchInstance?: BenchmarkInstance; preset?: string }> = [];

    // Quick-select presets
    const todayCount = sessions.filter(s => s.modifiedMs >= now - dayMs).length;
    const weekCount = sessions.filter(s => s.modifiedMs >= now - 7 * dayMs).length;
    const monthCount = sessions.filter(s => s.modifiedMs >= now - 30 * dayMs).length;

    items.push({ label: "Quick Select", kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: "$(calendar) Today", description: `${todayCount} sessions`, preset: "today" });
    items.push({ label: "$(history) Last 7 days", description: `${weekCount} sessions`, preset: "7d" });
    items.push({ label: "$(history) Last 30 days", description: `${monthCount} sessions`, preset: "30d" });
    items.push({ label: "$(checklist) All sessions", description: `${sessions.length} sessions (no benchmarks)`, preset: "all-sessions" });
    if (benchRuns.length > 0) {
      items.push({ label: "$(globe) Everything", description: `${sessions.length} sessions + ${benchRuns.reduce((s, r) => s + r.instances.length, 0)} benchmark instances`, preset: "everything" });
    }

    // Add benchmark runs and instances
    if (benchRuns.length > 0) {
      items.push({ label: "Benchmarks", kind: vscode.QuickPickItemKind.Separator });
      for (const run of benchRuns) {
        const passed = run.instances.filter(i => i.status === "passed").length;
        // Add run-level entry
        items.push({
          label: `$(beaker) ${run.name}`,
          description: `${passed}/${run.instances.length} passed · ${run.source} · View All`,
          benchRun: run,
        });
        // Add individual instances (first 50)
        for (const inst of run.instances.slice(0, 50)) {
          const icon = inst.status === "passed" ? "$(check)" : inst.status === "failed" ? "$(x)" : "$(warning)";
          items.push({
            label: `    ${icon} ${inst.instanceId}`,
            description: inst.status,
            benchRun: run,
            benchInstance: inst,
          });
        }
      }
    }

    // Add regular sessions
    if (sessions.length > 0) {
      items.push({ label: "Sessions", kind: vscode.QuickPickItemKind.Separator });
      for (const s of sessions.slice(0, 100)) {
        const time = new Date(s.modifiedMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        const date = new Date(s.modifiedMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const prompt = s.firstPrompt?.slice(0, 50) || s.tool;
        items.push({
          label: `${date} ${time}`,
          description: `${formatSize(s.sizeBytes)} · ${prompt}`,
          session: s,
        });
      }
    }

    if (items.length === 0) {
      vscode.window.showInformationMessage("No sessions or benchmarks to compare.");
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: "Compare Sessions & Benchmarks",
      placeHolder: "Select 2+ items to compare side-by-side",
    });

    if (!picked || picked.length === 0) return;

    // Handle presets — expand into actual sessions
    const presets = picked.filter(p => (p as any).preset);
    if (presets.length > 0) {
      const preset = (presets[0] as any).preset as string;
      let selectedSessions: DiscoveredSession[] = [];
      if (preset === "today") {
        selectedSessions = sessions.filter(s => s.modifiedMs >= now - dayMs);
      } else if (preset === "7d") {
        selectedSessions = sessions.filter(s => s.modifiedMs >= now - 7 * dayMs);
      } else if (preset === "30d") {
        selectedSessions = sessions.filter(s => s.modifiedMs >= now - 30 * dayMs);
      } else if (preset === "all-sessions") {
        selectedSessions = sessions;
      } else if (preset === "everything") {
        // Load all sessions + trigger benchmark loads via fetchFiles
        const allFiles: Array<{ name: string; contents: string }> = [];
        for (const s of sessions) {
          allFiles.push(...readSessionFiles(s));
        }
        // TODO: also include benchmarks via fetchFiles for large sets
        if (allFiles.length > 0) loadFilesInPanel(allFiles);
        return;
      }
      if (selectedSessions.length > 0) {
        loadSessionsInPanel(selectedSessions);
      }
      return;
    }

    // Collect all files to load
    const allFiles: Array<{ name: string; contents: string }> = [];

    for (const p of picked) {
      const item = p as any;
      if (item.session) {
        // Regular session
        const sessionFiles = readSessionFiles(item.session);
        allFiles.push(...sessionFiles);
      } else if (item.benchRun && !item.benchInstance) {
        // Whole benchmark run
        const run = item.benchRun as BenchmarkRun;
        if (run.outputJsonlPath) {
          const limit = run.instances.length;
          const ids = new Set(run.instances.slice(0, limit).map((i: BenchmarkInstance) => i.instanceId));
          const extracted = readInstanceFiles(run.outputJsonlPath, ids);
          allFiles.push(...extracted);
        } else {
          const withTraj = run.instances.filter((i: BenchmarkInstance) => i.trajectoryPath);
          for (const inst of withTraj.slice(0, 10)) {
            try {
              allFiles.push({ name: `${inst.instanceId}.json`, contents: fs.readFileSync(inst.trajectoryPath!, "utf-8") });
            } catch {}
          }
        }
      } else if (item.benchInstance) {
        // Single benchmark instance
        const inst = item.benchInstance as BenchmarkInstance;
        const run = item.benchRun as BenchmarkRun;
        if (inst.trajectoryPath) {
          try {
            allFiles.push({ name: `${inst.instanceId}.json`, contents: fs.readFileSync(inst.trajectoryPath, "utf-8") });
          } catch {}
        } else if (run.outputJsonlPath) {
          const extracted = readInstanceFiles(run.outputJsonlPath, new Set([inst.instanceId]));
          allFiles.push(...extracted);
        }
      }
    }

    if (allFiles.length > 0) {
      loadFilesInPanel(allFiles);
    }
  });

  // Quick search — filter tree by first prompt (instant, no file I/O)
  const findCmd = vscode.commands.registerCommand("aiTimeline.find", async () => {
    const currentFilter = treeProvider.getSearchFilter();

    const query = await vscode.window.showInputBox({
      title: currentFilter ? `Filtered: "${currentFilter}" — clear or type new filter` : "Filter Sessions",
      placeHolder: "Type to filter by prompt text... (leave empty to clear)",
      value: currentFilter,
      prompt: `${treeProvider.getSessions().length} sessions — filters instantly by first prompt`,
    });

    if (query === undefined) return; // cancelled (Escape)
    treeProvider.setSearchFilter(query.trim());
  });

  // Deep search — full-content search across all session files
  const deepSearchCmd = vscode.commands.registerCommand("aiTimeline.deepSearch", async () => {
    const sessions = treeProvider.getSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage("No sessions found.");
      return;
    }

    const query = await vscode.window.showInputBox({
      title: "Deep Search",
      placeHolder: "Search all session content (prompts, responses, tool calls)...",
      prompt: `Will read ${sessions.length} session files`,
    });

    if (!query || !query.trim()) return;
    const term = query.trim().toLowerCase();

    const matches: Array<{ session: DiscoveredSession; matchLine: string }> = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Deep searching sessions..." },
      async (progress) => {
        for (let i = 0; i < sessions.length; i++) {
          const s = sessions[i];
          progress.report({ increment: (100 / sessions.length), message: `${i + 1}/${sessions.length}` });
          try {
            const content = fs.readFileSync(s.filePath, "utf-8");
            const lower = content.toLowerCase();
            const idx = lower.indexOf(term);
            if (idx >= 0) {
              const start = Math.max(0, idx - 60);
              const end = Math.min(content.length, idx + term.length + 100);
              const snippet = content.slice(start, end).replace(/\n/g, " ").trim();
              matches.push({ session: s, matchLine: snippet });
            }
          } catch {}
        }
      }
    );

    if (matches.length === 0) {
      vscode.window.showInformationMessage(`No sessions contain "${query}".`);
      return;
    }

    const items = matches.map(m => {
      const time = new Date(m.session.modifiedMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const date = new Date(m.session.modifiedMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return {
        label: `${date} ${time} · ${formatSize(m.session.sizeBytes)}`,
        description: m.session.firstPrompt?.slice(0, 60) || m.session.tool,
        detail: `...${m.matchLine.slice(0, 150)}...`,
        session: m.session,
      };
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: `${matches.length} sessions match "${query}"`,
      placeHolder: "Select a session to open",
      matchOnDetail: true,
    });

    if (picked) {
      loadSessionsInPanel([(picked as any).session]);
    }
  });

  // Load benchmark run — guided flow
  const loadBenchmarkCmd = vscode.commands.registerCommand("aiTimeline.loadBenchmark", async () => {
    // Step 1: Pick the run folder
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: "Step 1: Select benchmark run folder (e.g. 20250831_swe-agent_gpt-4-1/)",
    });
    if (!uris?.[0]) return;
    const folderPath = uris[0].fsPath;

    // Step 2: Parse and auto-detect
    let run: BenchmarkRun | null = null;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Scanning benchmark folder..." },
      async () => { run = parseBenchmarkFolder(folderPath); }
    );

    if (!run) {
      vscode.window.showWarningMessage(
        "No benchmark data found. Expected: SWE-agent (<instance>/trajectories/agent.traj), " +
        "OpenHands (<instance>/trajectories/trajectory.json), or TicketForge export (.json/.jsonl with instances array)."
      );
      return;
    }

    // Step 3: Let user name it
    const name = await vscode.window.showInputBox({
      title: `Detected ${(run as BenchmarkRun).source} run with ${(run as BenchmarkRun).instances.length} instances`,
      placeHolder: "Name this benchmark run",
      value: (run as BenchmarkRun).name,
      prompt: "Give it a name you'll recognize (e.g. 'GPT-4 SWE-bench Apr 10')",
    });
    if (name === undefined) return; // cancelled
    if (name.trim()) (run as BenchmarkRun).name = name.trim();

    treeProvider.addBenchmarkRun(run as BenchmarkRun);
    persistBenchmarks();

    const r = run as BenchmarkRun;
    const passed = r.instances.filter(i => i.status === "passed").length;
    const failed = r.instances.filter(i => i.status === "failed").length;
    const errored = r.instances.filter(i => i.status === "errored").length;

    const parts = [`${passed}/${r.instances.length} passed`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (errored > 0) parts.push(`${errored} errored`);

    vscode.window.showInformationMessage(`Loaded ${r.source}: ${parts.join(", ")}`);

    // Pre-cache all instances in background (one-time, makes all future access instant)
    if (r.outputJsonlPath) {
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Caching ${r.instances.length} instances (one-time)...`, cancellable: false },
        async (progress) => {
          const count = cacheAllInstances(r.outputJsonlPath!, (n) => {
            progress.report({ message: `${n} cached` });
          });
          vscode.window.showInformationMessage(`Cached ${count} instances — all future loads will be instant`);
        }
      );
    }

    // Auto-load trajectories into viewer
    loadBenchmarkRunInPanel(r);
  });

  // Open benchmark run command
  const openBenchmarkRunCmd = vscode.commands.registerCommand("aiTimeline.openBenchmarkRun", (run: BenchmarkRun) => {
    if (!run.outputJsonlPath) {
      loadBenchmarkRunInPanel(run);
      return;
    }
    // Cache if needed, then tell webview to fetch files directly from disk
    const cacheDir = getBenchmarkCacheDir(run.outputJsonlPath!);
    const markerFile = path.join(cacheDir, ".cached");
    if (!fs.existsSync(markerFile)) {
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Caching benchmark instances (one-time)..." },
        async (progress) => {
          cacheAllInstances(run.outputJsonlPath!, (n) => {
            progress.report({ message: `${n} cached` });
          });
        }
      );
    }

    // Build webview URIs for all cached files
    const panel = TrajectoryViewerPanel.createOrShow(context.extensionUri);
    const fileUris: Array<{ name: string; uri: string }> = [];
    for (const inst of run.instances) {
      const cachedPath = path.join(cacheDir, `${inst.instanceId}.jsonl`);
      if (fs.existsSync(cachedPath)) {
        const webviewUri = panel.getWebviewUri(cachedPath);
        fileUris.push({ name: `${inst.instanceId}.jsonl`, uri: webviewUri });
      }
    }

    // Show loading state in webview, then fetch
    panel.postMessage({ type: "loading", message: `Loading ${fileUris.length} sessions...` });
    panel.postMessage({ type: "fetchFiles", files: fileUris });
  });

  /** Load a benchmark run's trajectories into the viewer panel */
  function loadBenchmarkRunInPanel(run: BenchmarkRun) {
    const withTrajectories = run.instances.filter(i => i.trajectoryPath);
    if (withTrajectories.length > 0) {
      const limit = Math.min(withTrajectories.length, 50);
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading ${limit} of ${run.instances.length} trajectories...` },
        async () => {
          const files: Array<{ name: string; contents: string }> = [];
          for (let i = 0; i < limit; i++) {
            const inst = withTrajectories[i];
            try {
              files.push({
                name: `${inst.instanceId}.json`,
                contents: fs.readFileSync(inst.trajectoryPath!, "utf-8"),
              });
            } catch {}
          }
          if (files.length > 0) loadFilesInPanel(files);
        }
      );
    } else if (run.outputJsonlPath) {
      // OpenHands: cache all instances, then load from cache
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Caching benchmark instances...", cancellable: true },
        async (progress) => {
          cacheAllInstances(run.outputJsonlPath!, (n) => {
            progress.report({ message: `${n} instances cached` });
          });
          const ids = new Set(run.instances.map(i => i.instanceId));
          const files = readInstanceFiles(run.outputJsonlPath!, ids);
          if (files.length > 0) loadFilesInPanel(files);
        }
      );
    }
  }

  // Toggle display mode — cycle between compact and prompt preview
  const toggleDisplayCmd = vscode.commands.registerCommand("aiTimeline.toggleDisplay", () => {
    treeProvider.displayMode = treeProvider.displayMode === "prompt" ? "compact" : "prompt";
    treeProvider["_onDidChangeTreeData"].fire(undefined);
    const label = treeProvider.displayMode === "prompt" ? "Showing prompts" : "Compact view";
    vscode.window.showInformationMessage(`AI Timeline: ${label}`);
  });

  context.subscriptions.push(treeView, refreshCmd, openSessionCmd, openCmd, openFileCmd, openFolderCmd, exportCmd, filterCmd, compareCmd, findCmd, deepSearchCmd, loadBenchmarkCmd, openBenchmarkRunCmd, toggleDisplayCmd);
}

/** Read session file + subagent files into array of {name, contents} */
function readSessionFiles(session: DiscoveredSession): Array<{ name: string; contents: string }> {
  const basePath = path.dirname(session.filePath);
  const sessionId = path.basename(session.filePath, path.extname(session.filePath));
  const subagentDir = path.join(basePath, sessionId, "subagents");
  const files: Array<{ name: string; contents: string }> = [];

  // Load the main session file
  try {
    files.push({
      name: session.relativePath || session.fileName,
      contents: fs.readFileSync(session.filePath, "utf-8"),
    });
  } catch {
    return files;
  }

  // Load subagent files + meta.json if they exist
  if (fs.existsSync(subagentDir)) {
    try {
      const entries = fs.readdirSync(subagentDir);
      for (const entry of entries) {
        if (entry.endsWith(".jsonl") && !entry.includes("compact")) {
          try {
            files.push({
              name: `${sessionId}/subagents/${entry}`,
              contents: fs.readFileSync(path.join(subagentDir, entry), "utf-8"),
            });
          } catch {}
        } else if (entry.endsWith(".meta.json")) {
          try {
            files.push({
              name: `${sessionId}/subagents/${entry}`,
              contents: fs.readFileSync(path.join(subagentDir, entry), "utf-8"),
            });
          } catch {}
        }
      }
    } catch {}
  }

  return files;
}

export function deactivate() {}

// ── Helpers ───────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
