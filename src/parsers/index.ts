/**
 * Parser barrel export — for backward compatibility with tests.
 * The app uses the registry (common/registry.ts) via plugins.ts.
 * Tests can import directly from here.
 */

import { Trajectory, TrajectoryParser, computeSummary, fillEventDurations } from "../common/types";
import { ClaudeCodeParser } from "./claude-code";
import { OpenHandsParser } from "./openhands";
import { SweAgentParser } from "./swe-agent";
import { ClineParser } from "./cline";
import { ContinueDevParser } from "./continue-dev";
import { AiderParser } from "./aider";
import { CodexCliParser } from "./codex-cli";
import { CopilotChatParser } from "./copilot-chat";
import { AmazonQParser } from "./amazon-q";
import { VSCodeSqliteParser } from "./vscode-sqlite";
import { VettParser } from "./vett";

/** All parsers, checked in order — most specific first */
const parsers: TrajectoryParser[] = [
  new VettParser(),           // suite_name + profile_name + instances[]
  new OpenHandsParser(),      // history[] + instance_id
  new AmazonQParser(),        // conversationId + messages
  new ContinueDevParser(),    // sessionId + history
  new CodexCliParser(),       // messages + model + instructions
  new CopilotChatParser(),    // requester/responder or chatSession
  new ClineParser(),          // JSON array with role + content blocks
  new SweAgentParser(),       // .traj extension
  new AiderParser(),          // .md with #### headings
  new VSCodeSqliteParser(),   // .vscdb/.sqlite binary (Cursor/Windsurf/Trae)
  new ClaudeCodeParser(),     // Most generic — last
];

export function parseFile(contents: string, filename: string): Trajectory[] {
  const firstLine = contents.split("\n").find((l) => l.trim()) ?? "";

  for (const parser of parsers) {
    if (parser.canParse(filename, firstLine)) {
      try {
        return parser.parse(contents, filename);
      } catch (e) {
        console.error(`Parser failed for ${filename}:`, e);
      }
    }
  }

  return [];
}

export function parseFiles(
  files: Array<{ name: string; contents: string }>
): Trajectory[] {
  const results: Trajectory[] = [];
  for (const file of files) {
    // Skip .meta.json files (subagent metadata, not sessions)
    if (file.name.endsWith(".meta.json")) continue;
    results.push(...parseFile(file.contents, file.name));
  }
  return mergeSubagents(preferVettRichTraces(results));
}

/**
 * When a Vett run is loaded with both its aggregate JSON and its rich
 * `--trace` JSONL sidecars, both parsers produce trajectories for the
 * same instance — thin (aggregate) and rich (full message history).
 * Prefer the rich version when available so AI Timeline shows the
 * full conversation instead of the summary.
 */
function preferVettRichTraces(trajectories: Trajectory[]): Trajectory[] {
  const richByInstance = new Map<string, Trajectory>();
  for (const t of trajectories) {
    if (t.source !== "vett") continue;
    const isRich = t.session.metadata?.vettRichTrace === true;
    if (!isRich) continue;
    const instanceId = t.session.metadata?.instanceId as string | undefined;
    if (instanceId) richByInstance.set(instanceId, t);
  }
  if (richByInstance.size === 0) return trajectories;

  return trajectories.filter(t => {
    if (t.source !== "vett") return true;
    if (t.session.metadata?.vettRichTrace === true) return true;
    const instanceId = t.session.metadata?.instanceId as string | undefined;
    // Drop thin trajectory when a rich one exists for the same instance
    if (instanceId && richByInstance.has(instanceId)) return false;
    return true;
  });
}

/** Merge subagent trajectories into their parent sessions */
function mergeSubagents(trajectories: Trajectory[]): Trajectory[] {
  const parentMap = new Map<string, Trajectory>();
  const children: Trajectory[] = [];
  const standalone: Trajectory[] = [];

  for (const t of trajectories) {
    if (t.parentSessionId) {
      children.push(t);
    } else {
      parentMap.set(t.session.id, t);
      standalone.push(t);
    }
  }

  if (children.length === 0) return standalone;

  // Merge each child's events into parent
  for (const child of children) {
    const parent = parentMap.get(child.parentSessionId!);
    if (parent) {
      // Assign incrementing agent labels based on order
      const existingAgents = new Set(parent.events.filter(e => e.agent).map(e => e.agent!));
      const agentNum = existingAgents.size + 1;
      const label = child.events[0]?.agent || `Agent #${agentNum}`;
      for (const ev of child.events) {
        ev.agent = label;
      }
      parent.events.push(...child.events);
      // Re-sort by timestamp
      parent.events.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime();
        const tb = new Date(b.timestamp).getTime();
        return ta - tb;
      });
    } else {
      // Parent not loaded — show as standalone
      standalone.push(child);
    }
  }

  // Recompute summaries for parents that got children merged
  for (const [, parent] of parentMap) {
    if (parent.events.some(e => e.agent)) {
      fillEventDurations(parent.events);
      parent.summary = computeSummary(parent.events);
    }
  }

  return standalone;
}

export { ClaudeCodeParser, OpenHandsParser, SweAgentParser, ClineParser, ContinueDevParser, AiderParser, CodexCliParser, CopilotChatParser, AmazonQParser, VSCodeSqliteParser, VettParser };
