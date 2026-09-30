/**
 * Format Comparison — analyzes exactly what each parser produces.
 * Generates a compatibility matrix showing which features each tool supports.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseFile } from "../src/parsers/index";
import { Trajectory } from "../src/common/types";

interface FormatCapabilities {
  source: string;
  hasTimestamps: boolean;      // Real timestamps (not synthetic)
  hasTokens: boolean;          // Per-event token data
  hasTokenInput: boolean;
  hasTokenOutput: boolean;
  hasCacheTokens: boolean;     // Cache read/write tokens
  hasModel: boolean;           // Model name
  hasToolCalls: boolean;       // Structured tool calls
  hasToolArgs: boolean;        // Tool call arguments
  hasToolResults: boolean;     // Tool results with output
  hasToolLinking: boolean;     // Results linked to calls
  hasDuration: boolean;        // Event durations
  hasStatus: boolean;          // Session pass/fail status
  hasCost: boolean;            // Cost tracking
  hasThinking: boolean;        // Thinking/reasoning blocks
  hasSystemPrompt: boolean;    // System messages
  hasGitBranch: boolean;       // Git branch info
  hasCwd: boolean;             // Working directory
  hasMultiSession: boolean;    // Multiple sessions per file
  hasErrorDetection: boolean;  // Errors flagged
  eventCount: number;
  toolCallCount: number;
  uniqueToolCount: number;
  uniqueToolNames: string[];
}

function analyzeTrajectory(trajs: Trajectory[]): FormatCapabilities {
  const allEvents = trajs.flatMap((t) => t.events);
  const firstTraj = trajs[0];

  const toolCalls = allEvents.filter((e) => e.type === "tool_call");
  const toolResults = allEvents.filter((e) => e.type === "tool_result");
  const linkedResults = toolResults.filter((e) => e.toolResult?.toolCallEventId != null);
  const withTokens = allEvents.filter((e) => e.tokens);
  const thinking = allEvents.filter((e) => e.type === "thinking");
  const system = allEvents.filter((e) => e.type === "system");
  const errors = allEvents.filter((e) => e.type === "error" || e.toolResult?.isError);
  const withDuration = allEvents.filter((e) => e.durationMs != null && e.durationMs > 0);

  // Check if timestamps are real (vary) or synthetic (evenly spaced)
  const timestamps = allEvents.map((e) => new Date(e.timestamp).getTime()).filter((t) => !isNaN(t));
  const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
  const allSameGap = gaps.length > 2 && gaps.every((g) => Math.abs(g - gaps[0]) < 100);
  const hasRealTimestamps = !allSameGap && timestamps.length > 1;

  return {
    source: firstTraj.source,
    hasTimestamps: hasRealTimestamps,
    hasTokens: withTokens.length > 0,
    hasTokenInput: withTokens.some((e) => (e.tokens?.input ?? 0) > 0),
    hasTokenOutput: withTokens.some((e) => (e.tokens?.output ?? 0) > 0),
    hasCacheTokens: withTokens.some((e) => (e.tokens?.cacheRead ?? 0) > 0 || (e.tokens?.cacheWrite ?? 0) > 0),
    hasModel: !!firstTraj.session.model,
    hasToolCalls: toolCalls.length > 0,
    hasToolArgs: toolCalls.some((e) => e.toolCall?.arguments != null),
    hasToolResults: toolResults.length > 0,
    hasToolLinking: linkedResults.length > 0,
    hasDuration: withDuration.length > 0,
    hasStatus: !!firstTraj.session.status,
    hasCost: !!firstTraj.session.cost,
    hasThinking: thinking.length > 0,
    hasSystemPrompt: system.length > 0,
    hasGitBranch: !!firstTraj.session.gitBranch,
    hasCwd: !!firstTraj.session.cwd,
    hasMultiSession: trajs.length > 1,
    hasErrorDetection: errors.length > 0 || toolResults.some((e) => e.toolResult?.isError === false), // at least tracks errors
    eventCount: allEvents.length,
    toolCallCount: toolCalls.length,
    uniqueToolCount: new Set(toolCalls.map((e) => e.toolCall?.name)).size,
    uniqueToolNames: [...new Set(toolCalls.map((e) => e.toolCall?.name ?? ""))].sort(),
  };
}

const fixtures: Array<{ name: string; file: string; filename: string }> = [
  { name: "Claude Code", file: "./fixtures/claude-code-session.jsonl", filename: "session.jsonl" },
  { name: "OpenHands", file: "./fixtures/openhands-output.jsonl", filename: "output.jsonl" },
  { name: "SWE-Agent", file: "./fixtures/swe-agent-instance.traj", filename: "instance.traj" },
  { name: "Cline", file: "./fixtures/cline-conversation.json", filename: "api_conversation_history.json" },
  { name: "Continue.dev", file: "./fixtures/continue-session.json", filename: ".continue/sessions/abc.json" },
  { name: "Aider", file: "./fixtures/aider-chat-history.md", filename: ".aider.chat.history.md" },
  { name: "Codex CLI", file: "./fixtures/codex-session.json", filename: "codex-session.json" },
  { name: "Copilot Chat", file: "./fixtures/copilot-chat-session.json", filename: "chatSessions/abc.json" },
  { name: "Amazon Q", file: "./fixtures/amazonq-history.json", filename: "amazonq.json" },
];

describe("Format Comparison Matrix", () => {
  const results: Record<string, FormatCapabilities> = {};

  for (const f of fixtures) {
    const contents = readFileSync(join(__dirname, f.file), "utf-8");
    const trajs = parseFile(contents, f.filename);
    if (trajs.length > 0) {
      results[f.name] = analyzeTrajectory(trajs);
    }
  }

  // Also add SQLite if fixture exists
  const sqlitePath = join(__dirname, "../tests/fixtures/cursor-state.vscdb");
  if (existsSync(sqlitePath)) {
    // SQLite is async — skip in sync test, covered separately
  }

  it("should parse all 9 fixtures", () => {
    expect(Object.keys(results).length).toBe(9);
  });

  it("should print the compatibility matrix", () => {
    const features = [
      "hasTimestamps",
      "hasTokens",
      "hasTokenInput",
      "hasTokenOutput",
      "hasCacheTokens",
      "hasModel",
      "hasToolCalls",
      "hasToolArgs",
      "hasToolResults",
      "hasToolLinking",
      "hasDuration",
      "hasStatus",
      "hasCost",
      "hasThinking",
      "hasSystemPrompt",
      "hasGitBranch",
      "hasCwd",
      "hasMultiSession",
      "hasErrorDetection",
    ] as const;

    const featureLabels: Record<string, string> = {
      hasTimestamps: "Real Timestamps",
      hasTokens: "Token Data",
      hasTokenInput: "Input Tokens",
      hasTokenOutput: "Output Tokens",
      hasCacheTokens: "Cache Tokens",
      hasModel: "Model Name",
      hasToolCalls: "Tool Calls",
      hasToolArgs: "Tool Arguments",
      hasToolResults: "Tool Results",
      hasToolLinking: "Call→Result Linking",
      hasDuration: "Event Duration",
      hasStatus: "Pass/Fail Status",
      hasCost: "Cost Tracking",
      hasThinking: "Thinking Blocks",
      hasSystemPrompt: "System Prompt",
      hasGitBranch: "Git Branch",
      hasCwd: "Working Directory",
      hasMultiSession: "Multi-Session File",
      hasErrorDetection: "Error Detection",
    };

    console.log("\n\n=== AI TIMELINE FORMAT COMPATIBILITY MATRIX ===\n");

    // Header
    const tools = Object.keys(results);
    const colWidth = 14;
    const labelWidth = 22;
    let header = "Feature".padEnd(labelWidth) + "│";
    for (const tool of tools) {
      header += tool.slice(0, colWidth - 1).padEnd(colWidth) + "│";
    }
    console.log(header);
    console.log("─".repeat(labelWidth) + "┼" + ("─".repeat(colWidth) + "┼").repeat(tools.length));

    // Rows
    for (const feature of features) {
      let row = (featureLabels[feature] ?? feature).padEnd(labelWidth) + "│";
      for (const tool of tools) {
        const val = results[tool][feature as keyof FormatCapabilities];
        const display = val === true ? "  ✅" : val === false ? "  ❌" : `  ${val}`;
        row += display.padEnd(colWidth) + "│";
      }
      console.log(row);
    }

    console.log("─".repeat(labelWidth) + "┼" + ("─".repeat(colWidth) + "┼").repeat(tools.length));

    // Stats rows
    const statRows = [
      { label: "Events", key: "eventCount" },
      { label: "Tool Calls", key: "toolCallCount" },
      { label: "Unique Tools", key: "uniqueToolCount" },
    ] as const;

    for (const stat of statRows) {
      let row = stat.label.padEnd(labelWidth) + "│";
      for (const tool of tools) {
        const val = results[tool][stat.key as keyof FormatCapabilities];
        row += `  ${val}`.padEnd(colWidth) + "│";
      }
      console.log(row);
    }

    console.log("\n=== TOOL NAMES PER FORMAT ===\n");
    for (const tool of tools) {
      const names = results[tool].uniqueToolNames;
      console.log(`${tool}: ${names.length > 0 ? names.join(", ") : "(no tool calls)"}`);
    }

    // Feature coverage summary
    console.log("\n=== COVERAGE SUMMARY ===\n");
    for (const feature of features) {
      const supported = tools.filter((t) => results[t][feature as keyof FormatCapabilities] === true).length;
      const pct = Math.round((supported / tools.length) * 100);
      const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
      console.log(`${(featureLabels[feature] ?? feature).padEnd(22)} ${bar} ${pct}% (${supported}/${tools.length})`);
    }

    console.log("\n=== WHAT YOU LOSE PER FORMAT ===\n");
    for (const tool of tools) {
      const missing = features.filter((f) => results[tool][f as keyof FormatCapabilities] === false);
      const missingLabels = missing.map((f) => featureLabels[f] ?? f);
      if (missingLabels.length > 0) {
        console.log(`${tool}: Missing ${missingLabels.join(", ")}`);
      } else {
        console.log(`${tool}: Full coverage ✅`);
      }
    }

    // This test always passes — it's for output
    expect(true).toBe(true);
  });
});
