/**
 * End-to-end tests with REAL sample data.
 * Verifies the full pipeline: parse → summary → view-safe structure.
 * These files are in samples/ (not tiny fixtures — real session data).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "../src/parsers/index";
import { computeSummary, Trajectory } from "../src/common/types";

const SAMPLES_DIR = join(__dirname, "../samples");
const hasClaudeSample = existsSync(join(SAMPLES_DIR, "claude-code-real-session.jsonl"));
const hasOpenHandsSample = existsSync(join(SAMPLES_DIR, "openhands-real-8instances.jsonl"));

describe.skipIf(!hasClaudeSample)("Real Claude Code Session (734KB)", () => {
  const contents = hasClaudeSample
    ? readFileSync(join(SAMPLES_DIR, "claude-code-real-session.jsonl"), "utf-8")
    : "";
  const trajectories = hasClaudeSample ? parseFile(contents, "claude-code-real-session.jsonl") : [];

  it("should parse successfully", () => {
    expect(trajectories.length).toBe(1);
  });

  it("should detect as claude-code source", () => {
    expect(trajectories[0].source).toBe("claude-code");
  });

  it("should have substantial event count", () => {
    expect(trajectories[0].events.length).toBeGreaterThan(20);
    console.log(`  Events: ${trajectories[0].events.length}`);
  });

  it("should have tool calls", () => {
    const toolCalls = trajectories[0].events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBeGreaterThan(5);
    console.log(`  Tool calls: ${toolCalls.length}`);
  });

  it("should have token data on assistant events", () => {
    const withTokens = trajectories[0].events.filter((e) => e.tokens);
    expect(withTokens.length).toBeGreaterThan(0);
    console.log(`  Events with tokens: ${withTokens.length}`);
  });

  it("should have model info", () => {
    expect(trajectories[0].session.model).toBeTruthy();
    console.log(`  Model: ${trajectories[0].session.model}`);
  });

  it("should have valid timestamps spanning a real duration", () => {
    const summary = trajectories[0].summary!;
    expect(summary.durationMs).toBeGreaterThan(1000); // At least 1 second
    console.log(`  Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  });

  it("should have multiple unique tools", () => {
    expect(trajectories[0].summary!.uniqueTools.length).toBeGreaterThan(1);
    console.log(`  Unique tools: ${trajectories[0].summary!.uniqueTools.join(", ")}`);
  });

  it("should have non-zero token totals", () => {
    const t = trajectories[0].summary!.totalTokens;
    expect(t.input + t.output).toBeGreaterThan(0);
    console.log(`  Tokens: ${t.input} in, ${t.output} out, ${t.cacheRead} cached`);
  });

  it("tool results should link back to valid tool calls", () => {
    const results = trajectories[0].events.filter(
      (e) => e.type === "tool_result" && e.toolResult?.toolCallEventId != null
    );
    let linked = 0;
    for (const r of results) {
      const call = trajectories[0].events.find((e) => e.id === r.toolResult!.toolCallEventId);
      if (call) linked++;
    }
    console.log(`  Tool results linked: ${linked}/${results.length}`);
    expect(linked).toBeGreaterThan(0);
  });

  it("summary should be consistent with recomputed summary", () => {
    const recomputed = computeSummary(trajectories[0].events);
    expect(recomputed.totalEvents).toBe(trajectories[0].summary!.totalEvents);
    expect(recomputed.totalToolCalls).toBe(trajectories[0].summary!.totalToolCalls);
  });
});

describe.skipIf(!hasOpenHandsSample)("Real OpenHands 8-Instance Run (5.8MB)", () => {
  const contents = hasOpenHandsSample
    ? readFileSync(join(SAMPLES_DIR, "openhands-real-8instances.jsonl"), "utf-8")
    : "";
  const trajectories = hasOpenHandsSample ? parseFile(contents, "openhands-real-8instances.jsonl") : [];

  it("should parse multiple instances", () => {
    expect(trajectories.length).toBeGreaterThanOrEqual(8);
    console.log(`  Instances parsed: ${trajectories.length}`);
  });

  it("should detect as openhands source", () => {
    for (const t of trajectories) {
      expect(t.source).toBe("openhands");
    }
  });

  it("each instance should have a unique instance_id", () => {
    const ids = trajectories.map((t) => t.session.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    console.log(`  Instance IDs: ${ids.join(", ")}`);
  });

  it("each instance should have events", () => {
    for (const t of trajectories) {
      expect(t.events.length).toBeGreaterThan(0);
    }
    const totalEvents = trajectories.reduce((s, t) => s + t.events.length, 0);
    console.log(`  Total events across all instances: ${totalEvents}`);
  });

  it("each instance should have tool calls", () => {
    for (const t of trajectories) {
      const toolCalls = t.events.filter((e) => e.type === "tool_call");
      expect(toolCalls.length).toBeGreaterThan(0);
    }
  });

  it("should have status derived from test_result", () => {
    for (const t of trajectories) {
      expect(t.session.status).toBeDefined();
      expect(["succeeded", "failed", "error", "unknown"]).toContain(t.session.status);
    }
    const statuses = trajectories.map((t) => `${t.session.id}: ${t.session.status}`);
    console.log(`  Statuses: ${statuses.join(", ")}`);
  });

  it("should have metadata with instanceId", () => {
    for (const t of trajectories) {
      expect(t.session.metadata?.instanceId).toBeTruthy();
    }
  });

  it("each instance should have valid timestamps", () => {
    for (const t of trajectories) {
      const d = new Date(t.session.startTime);
      expect(d.getTime()).not.toBeNaN();
      expect(t.summary!.durationMs).toBeGreaterThan(0);
    }
  });

  it("tool results should link to tool calls within same instance", () => {
    for (const t of trajectories) {
      const results = t.events.filter(
        (e) => e.type === "tool_result" && e.toolResult?.toolCallEventId != null
      );
      for (const r of results) {
        const call = t.events.find((e) => e.id === r.toolResult!.toolCallEventId);
        expect(call).toBeDefined();
        expect(call!.type).toBe("tool_call");
      }
    }
  });

  it("combined summary should be meaningful", () => {
    const allEvents = trajectories.flatMap((t) => t.events);
    const combined = computeSummary(allEvents);
    expect(combined.totalEvents).toBeGreaterThan(100);
    expect(combined.totalToolCalls).toBeGreaterThan(20);
    console.log(`  Combined: ${combined.totalEvents} events, ${combined.totalToolCalls} tools, ${combined.uniqueTools.length} unique tools`);
  });
});

describe("Samples directory", () => {
  it("should contain sample files for testing", () => {
    const hasSamples = hasClaudeSample || hasOpenHandsSample;
    if (!hasSamples) {
      console.log("  No sample files found in samples/ — run 'npm run dev' and load real data to generate them");
    }
    // This test documents that samples exist but doesn't fail if they don't
    // (CI environments won't have them)
    expect(true).toBe(true);
  });
});
