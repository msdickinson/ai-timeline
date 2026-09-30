import { describe, it, expect } from "vitest";
import { Trajectory, TrajectoryEvent } from "../../src/common/types";
import {
  decideLinkage,
  mergeChildIntoParent,
  chooseAgentLabel,
  linkSubagents,
} from "../../src/common/merge-subagents";

// ── fixtures ─────────────────────────────────────────────────────────

function ev(id: number, ts: string, type: TrajectoryEvent["type"], extra: Partial<TrajectoryEvent> = {}): TrajectoryEvent {
  return { id, timestamp: ts, type, ...extra } as TrajectoryEvent;
}

function parent(opts: { id: string; start?: string; end?: string; events?: TrajectoryEvent[] }): Trajectory {
  return {
    version: "1.0",
    source: "claude-code",
    session: { id: opts.id, startTime: opts.start, endTime: opts.end },
    events: opts.events ?? [ev(0, opts.start ?? "2026-04-01T10:00:00Z", "message")],
  };
}

function child(opts: { id: string; parentId: string; start?: string; end?: string; events?: TrajectoryEvent[] }): Trajectory {
  return {
    version: "1.0",
    source: "claude-code",
    session: { id: opts.id, startTime: opts.start, endTime: opts.end },
    events: opts.events ?? [ev(0, opts.start ?? "2026-04-01T10:30:00Z", "message", { agent: "Agent xyz" } as Partial<TrajectoryEvent>)],
    parentSessionId: opts.parentId,
  };
}

// ── decideLinkage ────────────────────────────────────────────────────

describe("decideLinkage", () => {
  it("links a child whose path UUID matches a loaded parent and timestamps fit", () => {
    const p = parent({ id: "p1", start: "2026-04-01T10:00:00Z", end: "2026-04-01T11:00:00Z" });
    const c = child({ id: "c1", parentId: "p1", start: "2026-04-01T10:15:00Z" });
    const decision = decideLinkage(c, new Map([["p1", p]]));
    expect(decision).toEqual({ kind: "linked", parentId: "p1" });
  });

  it("drops sidechain children — no path-extracted parent exists", () => {
    const c = child({ id: "c1", parentId: "__sidechain__" });
    const decision = decideLinkage(c, new Map());
    expect(decision).toEqual({ kind: "unlinked-no-path-parent" });
  });

  it("drops a child whose path-parent isn't loaded", () => {
    const c = child({ id: "c1", parentId: "p-archived" });
    const decision = decideLinkage(c, new Map());
    expect(decision).toEqual({ kind: "unlinked-no-parent-file" });
  });

  it("rejects a child that predates its parent by more than 5 min", () => {
    const p = parent({ id: "p1", start: "2026-04-22T08:00:00Z", end: "2026-04-23T00:00:00Z" });
    // Child starts a week BEFORE parent — clearly impossible.
    const c = child({ id: "c1", parentId: "p1", start: "2026-04-15T12:00:00Z" });
    const decision = decideLinkage(c, new Map([["p1", p]]));
    expect(decision).toEqual({ kind: "unlinked-temporal" });
  });

  it("rejects a child that starts after the parent ended", () => {
    const p = parent({ id: "p1", start: "2026-04-01T08:00:00Z", end: "2026-04-01T09:00:00Z" });
    // Child starts 1 hour after parent ended.
    const c = child({ id: "c1", parentId: "p1", start: "2026-04-01T10:30:00Z" });
    const decision = decideLinkage(c, new Map([["p1", p]]));
    expect(decision).toEqual({ kind: "unlinked-temporal" });
  });

  it("allows the 5-minute grace window for clock skew", () => {
    const p = parent({ id: "p1", start: "2026-04-01T10:00:00Z", end: "2026-04-01T11:00:00Z" });
    // Child starts 3 min before parent — within grace, should link.
    const c = child({ id: "c1", parentId: "p1", start: "2026-04-01T09:57:00Z" });
    const decision = decideLinkage(c, new Map([["p1", p]]));
    expect(decision).toEqual({ kind: "linked", parentId: "p1" });
  });

  it("uses parent.summary.durationMs when endTime is missing", () => {
    const p: Trajectory = parent({ id: "p1", start: "2026-04-01T10:00:00Z" });
    p.summary = { durationMs: 30 * 60 * 1000 } as never; // 30 min
    // Child starts 35 min in — past end (10:00 + 30 = 10:30), past grace (10:35) — REJECTED.
    const c = child({ id: "c1", parentId: "p1", start: "2026-04-01T10:36:00Z" });
    const decision = decideLinkage(c, new Map([["p1", p]]));
    expect(decision).toEqual({ kind: "unlinked-temporal" });
  });
});

// ── mergeChildIntoParent ─────────────────────────────────────────────

describe("mergeChildIntoParent", () => {
  it("re-numbers child event IDs to avoid collision with parent", () => {
    const p = parent({
      id: "p1",
      events: [
        ev(0, "2026-04-01T10:00:00Z", "message"),
        ev(1, "2026-04-01T10:01:00Z", "message"),
      ],
    });
    const c = child({
      id: "c1",
      parentId: "p1",
      events: [
        ev(0, "2026-04-01T10:30:00Z", "tool_call"),
        ev(1, "2026-04-01T10:30:05Z", "tool_result"),
      ],
    });
    mergeChildIntoParent(p, c, "Agent foo");
    // Original IDs 0,1 should be preserved on parent's existing events.
    // Child events should now be at IDs 2,3 (offset = max(0,1) + 1 = 2).
    const ids = p.events.map(e => e.id).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3]);
    // No duplicates.
    expect(new Set(ids).size).toBe(4);
  });

  it("re-writes tool_result.toolCallEventId references through the same offset", () => {
    const p = parent({
      id: "p1",
      events: [
        ev(0, "2026-04-01T10:00:00Z", "message"),
        ev(5, "2026-04-01T10:01:00Z", "message"),
      ],
    });
    // Child has a tool_call (id=0) followed by a tool_result that references id 0.
    const c = child({
      id: "c1",
      parentId: "p1",
      events: [
        ev(0, "2026-04-01T10:30:00Z", "tool_call", { toolCall: { name: "Bash", arguments: {} } } as Partial<TrajectoryEvent>),
        ev(1, "2026-04-01T10:30:05Z", "tool_result", { toolResult: { toolCallEventId: 0, output: "" } } as Partial<TrajectoryEvent>),
      ],
    });
    mergeChildIntoParent(p, c, "Agent foo");
    // Offset = max parent id (5) + 1 = 6. So child 0 → 6, child 1 → 7.
    // The tool_result's reference to call id=0 should now point at 6.
    const result = p.events.find(e => e.type === "tool_result");
    expect(result?.toolResult?.toolCallEventId).toBe(6);
  });

  it("stamps the agent label on every child event", () => {
    const p = parent({ id: "p1" });
    const c = child({ id: "c1", parentId: "p1", events: [
      ev(0, "2026-04-01T10:30:00Z", "message"),
      ev(1, "2026-04-01T10:30:05Z", "tool_call"),
    ]});
    mergeChildIntoParent(p, c, "Agent foo");
    const merged = p.events.filter(e => e.id !== 0); // exclude parent's original
    for (const e of merged) {
      expect(e.agent).toBe("Agent foo");
    }
  });

  it("uses undefined agent when label is empty (compact mode)", () => {
    const p = parent({ id: "p1" });
    const c = child({ id: "c1", parentId: "p1" });
    mergeChildIntoParent(p, c, "");
    const merged = p.events.find(e => e.timestamp.includes("10:30"));
    expect(merged?.agent).toBeUndefined();
  });

  it("re-sorts merged events by timestamp", () => {
    const p = parent({
      id: "p1",
      events: [
        ev(0, "2026-04-01T10:00:00Z", "message"),
        ev(1, "2026-04-01T11:00:00Z", "message"), // late parent event
      ],
    });
    const c = child({ id: "c1", parentId: "p1", events: [
      ev(0, "2026-04-01T10:30:00Z", "message"), // between the two parent events
    ]});
    mergeChildIntoParent(p, c, "Agent foo");
    const ts = p.events.map(e => e.timestamp);
    expect(ts).toEqual([
      "2026-04-01T10:00:00Z",
      "2026-04-01T10:30:00Z",
      "2026-04-01T11:00:00Z",
    ]);
  });
});

// ── chooseAgentLabel ─────────────────────────────────────────────────

describe("chooseAgentLabel", () => {
  it("returns empty string for compact-style children (silent merge)", () => {
    const p = parent({ id: "p1" });
    const c = child({ id: "c1", parentId: "p1", events: [
      ev(0, "2026-04-01T10:30:00Z", "message", { agent: "Agent compact-summary-abc" } as Partial<TrajectoryEvent>),
    ]});
    expect(chooseAgentLabel(c, p, new Map())).toBe("");
  });

  it("prefers the meta description when available", () => {
    const p = parent({ id: "p1" });
    const c = child({ id: "c1", parentId: "p1", events: [
      ev(0, "2026-04-01T10:30:00Z", "message", { agent: "Agent xyz" } as Partial<TrajectoryEvent>),
    ]});
    const meta = new Map([["xyz", "Refactor utils.ts"]]);
    expect(chooseAgentLabel(c, p, meta)).toBe("Refactor utils.ts");
  });

  it("falls back to a short agent ID when no meta", () => {
    const p = parent({ id: "p1" });
    const c = child({ id: "c1", parentId: "p1", events: [
      ev(0, "2026-04-01T10:30:00Z", "message", { agent: "Agent reviewer-9f2c8a3b1d4e" } as Partial<TrajectoryEvent>),
    ]});
    // Trailing 12+ hex chars are stripped, then first 12 chars taken.
    expect(chooseAgentLabel(c, p, new Map())).toBe("Agent reviewer");
  });

  it("falls back to Agent #N when no agent ID at all", () => {
    const p = parent({
      id: "p1",
      events: [
        ev(0, "2026-04-01T10:00:00Z", "message"),
        // already-merged agent in parent → should bump #N
        ev(1, "2026-04-01T10:01:00Z", "message", { agent: "Agent foo" } as Partial<TrajectoryEvent>),
      ],
    });
    const c = child({ id: "c1", parentId: "p1", events: [
      ev(0, "2026-04-01T10:30:00Z", "message", {} as Partial<TrajectoryEvent>),
    ]});
    expect(chooseAgentLabel(c, p, new Map())).toBe("Agent #2");
  });
});

// ── linkSubagents (full pass) ────────────────────────────────────────

describe("linkSubagents", () => {
  it("merges path-matched children, drops sidechain + no-parent + temporal mismatches", () => {
    const p = parent({ id: "p1", start: "2026-04-01T10:00:00Z", end: "2026-04-01T11:00:00Z" });
    const goodChild = child({ id: "c1", parentId: "p1", start: "2026-04-01T10:30:00Z" });
    const sidechain = child({ id: "c2", parentId: "__sidechain__", start: "2026-04-01T10:31:00Z" });
    const noParent = child({ id: "c3", parentId: "p-gone", start: "2026-04-01T10:32:00Z" });
    const tooEarly = child({ id: "c4", parentId: "p1", start: "2026-03-01T10:00:00Z" });

    const result = linkSubagents([p, goodChild, sidechain, noParent, tooEarly], [], new Map());

    expect(result.stats.merged).toBe(1);
    expect(result.stats.unlinked).toBe(3);
    expect(result.stats.unlinkedSidechain).toBe(1);
    expect(result.stats.unlinkedNoParentFile).toBe(1);
    expect(result.stats.unlinkedTemporal).toBe(1);

    // kept = parent only (children either merged or dropped)
    expect(result.kept).toEqual([p]);
    // Parent absorbed the good child's events
    expect(p.events.length).toBe(2);
    expect(p.events.some(e => e.agent)).toBe(true);
  });

  it("links to a parent already present in existingParents (cross-batch loads)", () => {
    const existingParent = parent({ id: "p1", start: "2026-04-01T10:00:00Z", end: "2026-04-01T11:00:00Z" });
    const c = child({ id: "c1", parentId: "p1", start: "2026-04-01T10:30:00Z" });

    const result = linkSubagents([c], [existingParent], new Map());

    expect(result.stats.merged).toBe(1);
    // The existingParent itself isn't in the new batch's kept list — only freshly-parsed
    // standalone trajectories are kept. existingParent gets mutated in place.
    expect(result.kept).toEqual([]);
    expect(existingParent.events.some(e => e.agent)).toBe(true);
  });

  it("returns empty stats when there are no children at all", () => {
    const p = parent({ id: "p1" });
    const result = linkSubagents([p], [], new Map());
    expect(result.stats).toEqual({
      merged: 0, unlinked: 0,
      unlinkedNoParentFile: 0, unlinkedSidechain: 0, unlinkedTemporal: 0,
    });
    expect(result.kept).toEqual([p]);
  });

  it("handles many children for the same parent without ID collisions", () => {
    const p = parent({
      id: "p1", start: "2026-04-01T10:00:00Z", end: "2026-04-01T13:00:00Z",
      events: [ev(0, "2026-04-01T10:00:00Z", "message")],
    });
    const children = Array.from({ length: 10 }, (_, i) => child({
      id: `c${i}`, parentId: "p1",
      start: `2026-04-01T1${1 + Math.floor(i / 5)}:${(i * 5).toString().padStart(2, "0")}:00Z`,
      events: [
        ev(0, `2026-04-01T1${1 + Math.floor(i / 5)}:${(i * 5).toString().padStart(2, "0")}:00Z`, "tool_call"),
        ev(1, `2026-04-01T1${1 + Math.floor(i / 5)}:${(i * 5).toString().padStart(2, "0")}:05Z`, "tool_result", {
          toolResult: { toolCallEventId: 0, output: "" },
        } as Partial<TrajectoryEvent>),
      ],
    }));

    const result = linkSubagents([p, ...children], [], new Map());
    expect(result.stats.merged).toBe(10);

    // Every event ID is unique
    const allIds = p.events.map(e => e.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    // Every tool_result references a tool_call ID that actually exists in the parent
    const callIds = new Set(p.events.filter(e => e.type === "tool_call").map(e => e.id));
    for (const r of p.events.filter(e => e.type === "tool_result")) {
      expect(callIds.has(r.toolResult!.toolCallEventId!)).toBe(true);
    }
  });
});
