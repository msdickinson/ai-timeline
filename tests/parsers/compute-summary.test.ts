import { describe, it, expect } from "vitest";
import { computeSummary, TrajectoryEvent } from "../../src/common/types";

describe("computeSummary", () => {
  it("should handle empty events array", () => {
    const summary = computeSummary([]);
    expect(summary.totalEvents).toBe(0);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.durationMs).toBe(0);
    expect(summary.errorCount).toBe(0);
    expect(summary.uniqueTools).toHaveLength(0);
  });

  it("should handle events with no tool calls", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "user", content: "hi" },
      { id: 1, timestamp: "2026-01-01T00:00:01Z", type: "message", role: "assistant", content: "hello" },
    ];
    const summary = computeSummary(events);
    expect(summary.totalEvents).toBe(2);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.uniqueTools).toHaveLength(0);
    expect(summary.durationMs).toBe(1000);
  });

  it("should count all error types", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "error", role: "system" },
      { id: 1, timestamp: "2026-01-01T00:00:01Z", type: "tool_result", role: "environment", toolResult: { isError: true, output: "fail" } },
      { id: 2, timestamp: "2026-01-01T00:00:02Z", type: "tool_result", role: "environment", toolResult: { isError: false, output: "ok" } },
    ];
    const summary = computeSummary(events);
    expect(summary.errorCount).toBe(2);
  });

  it("should compute duration from min/max timestamps", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "user" },
      { id: 1, timestamp: "2026-01-01T00:00:30Z", type: "message", role: "assistant" },
    ];
    const summary = computeSummary(events);
    expect(summary.durationMs).toBe(30000);
  });

  it("should handle invalid timestamps gracefully", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "invalid", type: "message", role: "user" },
      { id: 1, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "assistant" },
    ];
    const summary = computeSummary(events);
    expect(summary.totalEvents).toBe(2);
    // Should not crash — duration may be 0 since only one valid timestamp
    expect(summary.durationMs).toBe(0);
  });

  it("should calculate per-tool call counts", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "tool_call", role: "assistant", toolCall: { name: "Read" } },
      { id: 1, timestamp: "2026-01-01T00:00:01Z", type: "tool_call", role: "assistant", toolCall: { name: "Bash" } },
      { id: 2, timestamp: "2026-01-01T00:00:02Z", type: "tool_call", role: "assistant", toolCall: { name: "Read" } },
      { id: 3, timestamp: "2026-01-01T00:00:03Z", type: "tool_call", role: "assistant", toolCall: { name: "Read" } },
    ];
    const summary = computeSummary(events);
    expect(summary.totalToolCalls).toBe(4);
    expect(summary.uniqueTools).toContain("Read");
    expect(summary.uniqueTools).toContain("Bash");
    expect(summary.toolCallCounts["Read"]).toBe(3);
    expect(summary.toolCallCounts["Bash"]).toBe(1);
  });

  it("should calculate average tool duration", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "tool_call", role: "assistant", toolCall: { name: "Bash" } },
      { id: 1, timestamp: "2026-01-01T00:00:01Z", type: "tool_result", role: "environment", durationMs: 1000, toolResult: { isError: false, toolCallEventId: 0 } },
      { id: 2, timestamp: "2026-01-01T00:00:02Z", type: "tool_call", role: "assistant", toolCall: { name: "Bash" } },
      { id: 3, timestamp: "2026-01-01T00:00:04Z", type: "tool_result", role: "environment", durationMs: 3000, toolResult: { isError: false, toolCallEventId: 2 } },
    ];
    const summary = computeSummary(events);
    expect(summary.toolAvgDurationMs["Bash"]).toBe(2000);
  });

  it("should aggregate token usage", () => {
    const events: TrajectoryEvent[] = [
      { id: 0, timestamp: "2026-01-01T00:00:00Z", type: "message", role: "assistant", tokens: { input: 100, output: 20, cacheRead: 50 } },
      { id: 1, timestamp: "2026-01-01T00:00:01Z", type: "message", role: "assistant", tokens: { input: 200, output: 30, cacheRead: 100, cacheWrite: 10 } },
    ];
    const summary = computeSummary(events);
    expect(summary.totalTokens.input).toBe(300);
    expect(summary.totalTokens.output).toBe(50);
    expect(summary.totalTokens.cacheRead).toBe(150);
    expect(summary.totalTokens.cacheWrite).toBe(10);
  });
});
