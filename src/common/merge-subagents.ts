/**
 * Subagent → parent linkage logic, extracted from app.ts so it can be
 * unit-tested without spinning up the whole app shell. Pure functions:
 * inputs in, decision + (optionally mutated) trajectories out.
 *
 * REALITY CHECK (verified against ~/.claude/projects/ via
 * scripts/inspect-claude-subagents.py): Claude Code does NOT store a
 * cross-session uuid linkage between subagents and their parents.
 * 0/1163 subagent files in real data had a usable cross-file
 * `parentUuid`. The only definitive signal is the directory path:
 *
 *     <parent-uuid>/subagents/agent-<id>.jsonl
 *
 * We merge IFF that <parent-uuid> matches a currently-loaded session
 * AND timestamps make it possible (subagent can't predate the parent
 * by >5 min, can't run >5 min after the parent ended). Everything else
 * stays unlinked. We do NOT guess via time-overlap — that produced the
 * "1000 subagents under whatever session has the longest duration"
 * misattribution that fooled the user.
 */

import { Trajectory } from "./types";

const TEMPORAL_GRACE_MS = 5 * 60 * 1000;

export type LinkDecision =
  | { kind: "linked"; parentId: string }
  | { kind: "unlinked-no-path-parent" } // child.parentSessionId === "__sidechain__"
  | { kind: "unlinked-no-parent-file" }  // path-extracted UUID isn't loaded
  | { kind: "unlinked-temporal" };       // path UUID matches but timestamps disagree

export interface LinkStats {
  merged: number;
  unlinked: number;
  unlinkedNoParentFile: number;
  unlinkedSidechain: number;
  unlinkedTemporal: number;
}

/**
 * Decide whether (and to which loaded parent) a subagent trajectory
 * should be linked. Pure — does not mutate inputs.
 *
 * @param child the subagent trajectory (must have parentSessionId set)
 * @param parents map of loaded parent session.id → trajectory
 */
export function decideLinkage(
  child: Trajectory,
  parents: Map<string, Trajectory>,
): LinkDecision {
  if (child.parentSessionId === "__sidechain__") {
    return { kind: "unlinked-no-path-parent" };
  }
  if (!child.parentSessionId) {
    // Caller shouldn't have given us a non-subagent, but be defensive.
    return { kind: "unlinked-no-path-parent" };
  }
  const candidate = parents.get(child.parentSessionId);
  if (!candidate) return { kind: "unlinked-no-parent-file" };

  const childStart = child.session.startTime
    ? new Date(child.session.startTime).getTime() : 0;
  const parentStart = candidate.session.startTime
    ? new Date(candidate.session.startTime).getTime() : 0;
  const parentEnd = candidate.session.endTime
    ? new Date(candidate.session.endTime).getTime()
    : parentStart + (candidate.summary?.durationMs ?? 0);

  const tooEarly = childStart > 0 && parentStart > 0 && (childStart + TEMPORAL_GRACE_MS) < parentStart;
  const tooLate = childStart > 0 && parentEnd > 0 && childStart > parentEnd + TEMPORAL_GRACE_MS;
  if (tooEarly || tooLate) return { kind: "unlinked-temporal" };

  return { kind: "linked", parentId: child.parentSessionId };
}

/**
 * Mutates `parent.events` to absorb `child.events`, with:
 *   - subagent-event ID re-numbering (so they don't collide with parent IDs)
 *   - tool_result.toolCallEventId references rewritten through the same offset
 *   - per-event `agent` label stamped (empty string => merges into main lanes)
 *   - re-sorted by timestamp
 *
 * Caller is responsible for recomputing parent.summary afterwards
 * (because we don't want to import computeSummary into this module
 * just for the merge path).
 *
 * @param agentLabel "" means "merge silently into main lanes" — use for
 *                   compact-style child sessions that aren't really
 *                   subagents in the user's mental model.
 */
export function mergeChildIntoParent(
  parent: Trajectory,
  child: Trajectory,
  agentLabel: string,
): void {
  const maxParentId = parent.events.reduce((max, e) => Math.max(max, e.id), 0);
  const idOffset = maxParentId + 1;

  for (const ev of child.events) {
    ev.id = ev.id + idOffset;
    ev.agent = agentLabel || undefined;
    if (ev.toolResult?.toolCallEventId != null) {
      ev.toolResult.toolCallEventId = ev.toolResult.toolCallEventId + idOffset;
    }
  }
  parent.events.push(...child.events);
  parent.events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Compute the agent label to stamp on a child's events.
 *
 * - Compact-style children (whose first event's `agent` field contains
 *   "compact") merge silently — empty string returned.
 * - Otherwise, prefer the human-readable description from
 *   `agentMetaDescriptions` (sourced from the subagent .meta.json
 *   files Claude Code writes alongside each subagent jsonl).
 * - Falls back to a short version of the agent ID, or `Agent #N`
 *   where N is one-based across already-merged agents in the parent.
 */
export function chooseAgentLabel(
  child: Trajectory,
  parent: Trajectory,
  agentMetaDescriptions: Map<string, string>,
): string {
  const rawLabel = child.events[0]?.agent || "";
  const fullAgentId = rawLabel.replace("Agent ", "");
  if (fullAgentId.includes("compact")) return "";

  const metaDesc = agentMetaDescriptions.get(fullAgentId);
  if (metaDesc) return metaDesc;

  const shortId = fullAgentId.replace(/-[a-f0-9]{10,}$/, "").slice(0, 12);
  if (shortId) return `Agent ${shortId}`;

  const existingAgents = new Set(parent.events.filter(e => e.agent).map(e => e.agent!));
  return `Agent #${existingAgents.size + 1}`;
}

/**
 * Run the full subagent-linkage pass over a batch of newly-loaded
 * trajectories, with knowledge of any parents already in app state.
 * Returns the surviving "top-level" trajectories (parents and
 * unlinked-with-no-parent-file children kept; temporally-impossible
 * and sidechain children dropped).
 *
 * NOTE: this DOES mutate trajectories that get merged (their events
 * are absorbed into the parent and they're discarded).
 */
export function linkSubagents(
  newTrajectories: Trajectory[],
  existingParents: Trajectory[],
  agentMetaDescriptions: Map<string, string>,
): { kept: Trajectory[]; stats: LinkStats } {
  const parentMap = new Map<string, Trajectory>();
  const children: Trajectory[] = [];
  const standalone: Trajectory[] = [];

  for (const t of newTrajectories) {
    if (t.parentSessionId) children.push(t);
    else { parentMap.set(t.session.id, t); standalone.push(t); }
  }
  for (const t of existingParents) {
    if (!t.parentSessionId && !parentMap.has(t.session.id)) {
      parentMap.set(t.session.id, t);
    }
  }

  const stats: LinkStats = {
    merged: 0, unlinked: 0,
    unlinkedNoParentFile: 0, unlinkedSidechain: 0, unlinkedTemporal: 0,
  };

  for (const child of children) {
    const decision = decideLinkage(child, parentMap);
    if (decision.kind === "linked") {
      const parent = parentMap.get(decision.parentId)!;
      const label = chooseAgentLabel(child, parent, agentMetaDescriptions);
      mergeChildIntoParent(parent, child, label);
      stats.merged++;
    } else {
      stats.unlinked++;
      if (decision.kind === "unlinked-no-parent-file") stats.unlinkedNoParentFile++;
      else if (decision.kind === "unlinked-no-path-parent") stats.unlinkedSidechain++;
      else stats.unlinkedTemporal++;
    }
  }

  return { kept: standalone, stats };
}
