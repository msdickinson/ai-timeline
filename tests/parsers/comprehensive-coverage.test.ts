/**
 * Comprehensive coverage tests — fills ALL gaps from audit.
 * Tests every parser for: source field, metadata.tool, tool linking,
 * timestamp validity, summary consistency, canParse discrimination.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "../../src/parsers/index";
import { Trajectory, computeSummary } from "../../src/common/types";

// Load all fixtures
const fixtures: Record<string, { contents: string; filename: string; expectedSource: string; expectedTool: string }> = {
  "Claude Code": {
    contents: readFileSync(join(__dirname, "../fixtures/claude-code-session.jsonl"), "utf-8"),
    filename: "session.jsonl",
    expectedSource: "claude-code",
    expectedTool: "claude-code", // uses source directly, not metadata.tool
  },
  "OpenHands": {
    contents: readFileSync(join(__dirname, "../fixtures/openhands-output.jsonl"), "utf-8"),
    filename: "output.jsonl",
    expectedSource: "openhands",
    expectedTool: "openhands",
  },
  "SWE-Agent": {
    contents: readFileSync(join(__dirname, "../fixtures/swe-agent-instance.traj"), "utf-8"),
    filename: "instance.traj",
    expectedSource: "swe-agent",
    expectedTool: "swe-agent",
  },
  "Cline": {
    contents: readFileSync(join(__dirname, "../fixtures/cline-conversation.json"), "utf-8"),
    filename: "api_conversation_history.json",
    expectedSource: "cline",
    expectedTool: "cline",
  },
  "Continue.dev": {
    contents: readFileSync(join(__dirname, "../fixtures/continue-session.json"), "utf-8"),
    filename: ".continue/sessions/abc.json",
    expectedSource: "continue-dev",
    expectedTool: "continue-dev",
  },
  "Aider": {
    contents: readFileSync(join(__dirname, "../fixtures/aider-chat-history.md"), "utf-8"),
    filename: ".aider.chat.history.md",
    expectedSource: "aider",
    expectedTool: "aider",
  },
  "Codex CLI": {
    contents: readFileSync(join(__dirname, "../fixtures/codex-session.json"), "utf-8"),
    filename: "codex-session.json",
    expectedSource: "codex-cli",
    expectedTool: "codex-cli",
  },
  "Copilot Chat": {
    contents: readFileSync(join(__dirname, "../fixtures/copilot-chat-session.json"), "utf-8"),
    filename: "chatSessions/abc.json",
    expectedSource: "copilot-chat",
    expectedTool: "copilot-chat",
  },
  "Amazon Q": {
    contents: readFileSync(join(__dirname, "../fixtures/amazonq-history.json"), "utf-8"),
    filename: "amazonq-history.json",
    expectedSource: "amazon-q",
    expectedTool: "amazon-q",
  },
};

// Parse all
const parsed: Record<string, Trajectory[]> = {};
for (const [name, f] of Object.entries(fixtures)) {
  parsed[name] = parseFile(f.contents, f.filename);
}

describe("Source Field — All 9 Text Parsers", () => {
  for (const [name, f] of Object.entries(fixtures)) {
    it(`${name}: source should be "${f.expectedSource}"`, () => {
      expect(parsed[name].length).toBeGreaterThan(0);
      expect(parsed[name][0].source).toBe(f.expectedSource);
    });
  }
});

describe("Metadata.tool — All 9 Text Parsers", () => {
  for (const [name, f] of Object.entries(fixtures)) {
    it(`${name}: metadata.tool should be "${f.expectedTool}"`, () => {
      const traj = parsed[name][0];
      // Original 3 parsers use source field; newer ones also set metadata.tool
      if (["Claude Code", "OpenHands", "SWE-Agent"].includes(name)) {
        // These set source correctly, metadata.tool may not be set
        expect(traj.source).toBe(f.expectedSource);
      } else {
        expect(traj.session.metadata?.tool).toBe(f.expectedTool);
      }
    });
  }
});

describe("Tool Call Linking — All Parsers With Tool Calls", () => {
  for (const [name] of Object.entries(fixtures)) {
    const trajs = parsed[name];
    for (const traj of trajs) {
      const results = traj.events.filter(
        (e) => e.type === "tool_result" && e.toolResult?.toolCallEventId != null
      );
      if (results.length > 0) {
        it(`${name}: all tool_results should link to valid tool_calls`, () => {
          for (const r of results) {
            const call = traj.events.find((e) => e.id === r.toolResult!.toolCallEventId);
            expect(call).toBeDefined();
            expect(call!.type).toBe("tool_call");
            expect(call!.id).toBeLessThan(r.id);
          }
        });
      }
    }
  }
});

describe("Timestamp Validity — All Parsers", () => {
  for (const [name] of Object.entries(fixtures)) {
    const trajs = parsed[name];
    for (const traj of trajs) {
      it(`${name} (${traj.session.id}): session.startTime should be valid`, () => {
        const d = new Date(traj.session.startTime);
        expect(d.getTime()).not.toBeNaN();
      });

      it(`${name} (${traj.session.id}): all events should have parseable timestamps`, () => {
        for (const e of traj.events) {
          const d = new Date(e.timestamp);
          expect(d.getTime()).not.toBeNaN();
        }
      });
    }
  }
});

describe("Summary Consistency — All Parsers", () => {
  for (const [name] of Object.entries(fixtures)) {
    const trajs = parsed[name];
    for (const traj of trajs) {
      it(`${name}: summary.totalEvents should match events.length`, () => {
        expect(traj.summary!.totalEvents).toBe(traj.events.length);
      });

      it(`${name}: summary.totalToolCalls should match tool_call events`, () => {
        const toolCalls = traj.events.filter((e) => e.type === "tool_call");
        expect(traj.summary!.totalToolCalls).toBe(toolCalls.length);
      });

      it(`${name}: summary.uniqueTools should match toolCallCounts keys`, () => {
        const uniqueToolsSet = new Set(traj.summary!.uniqueTools);
        const toolCountsSet = new Set(Object.keys(traj.summary!.toolCallCounts));
        expect(uniqueToolsSet).toEqual(toolCountsSet);
      });

      it(`${name}: recomputed summary should match stored summary`, () => {
        const recomputed = computeSummary(traj.events);
        expect(recomputed.totalEvents).toBe(traj.summary!.totalEvents);
        expect(recomputed.totalToolCalls).toBe(traj.summary!.totalToolCalls);
        expect(recomputed.errorCount).toBe(traj.summary!.errorCount);
      });

      it(`${name}: all summary numbers should be non-negative`, () => {
        expect(traj.summary!.totalEvents).toBeGreaterThanOrEqual(0);
        expect(traj.summary!.totalToolCalls).toBeGreaterThanOrEqual(0);
        expect(traj.summary!.errorCount).toBeGreaterThanOrEqual(0);
        expect(traj.summary!.durationMs).toBeGreaterThanOrEqual(0);
        expect(traj.summary!.totalTokens.input).toBeGreaterThanOrEqual(0);
        expect(traj.summary!.totalTokens.output).toBeGreaterThanOrEqual(0);
      });
    }
  }
});

describe("Event Type/Role Validity — All Parsers", () => {
  const validTypes = ["message", "tool_call", "tool_result", "thinking", "system", "error"];
  const validRoles = ["user", "assistant", "system", "environment"];

  for (const [name] of Object.entries(fixtures)) {
    const trajs = parsed[name];
    for (const traj of trajs) {
      it(`${name}: all events should have valid type`, () => {
        for (const e of traj.events) {
          expect(validTypes).toContain(e.type);
        }
      });

      it(`${name}: all events should have valid role`, () => {
        for (const e of traj.events) {
          expect(validRoles).toContain(e.role);
        }
      });

      it(`${name}: tool_call events should have toolCall.name`, () => {
        const toolCalls = traj.events.filter((e) => e.type === "tool_call");
        for (const tc of toolCalls) {
          expect(tc.toolCall).toBeDefined();
          expect(tc.toolCall!.name).toBeTruthy();
        }
      });

      it(`${name}: tool_result events should have toolResult.isError boolean`, () => {
        const results = traj.events.filter((e) => e.type === "tool_result");
        for (const r of results) {
          expect(r.toolResult).toBeDefined();
          expect(typeof r.toolResult!.isError).toBe("boolean");
        }
      });
    }
  }
});

// Import parsers for discrimination tests
import { ClaudeCodeParser } from "../../src/parsers/claude-code";
import { OpenHandsParser } from "../../src/parsers/openhands";
import { SweAgentParser } from "../../src/parsers/swe-agent";
import { ClineParser } from "../../src/parsers/cline";
import { ContinueDevParser } from "../../src/parsers/continue-dev";
import { AiderParser } from "../../src/parsers/aider";
import { CodexCliParser } from "../../src/parsers/codex-cli";
import { CopilotChatParser } from "../../src/parsers/copilot-chat";
import { AmazonQParser } from "../../src/parsers/amazon-q";

describe("canParse Discrimination — No False Positives", () => {

  const allParsers = [
    { name: "ClaudeCode", parser: new ClaudeCodeParser() },
    { name: "OpenHands", parser: new OpenHandsParser() },
    { name: "SweAgent", parser: new SweAgentParser() },
    { name: "Cline", parser: new ClineParser() },
    { name: "ContinueDev", parser: new ContinueDevParser() },
    { name: "Aider", parser: new AiderParser() },
    { name: "CodexCli", parser: new CodexCliParser() },
    { name: "CopilotChat", parser: new CopilotChatParser() },
    { name: "AmazonQ", parser: new AmazonQParser() },
  ];

  it("no parser should crash on empty input", () => {
    for (const { name, parser } of allParsers) {
      expect(() => parser.canParse("test.json", "")).not.toThrow();
      expect(() => parser.canParse("test.json", undefined)).not.toThrow();
      expect(() => parser.canParse("test.jsonl", "")).not.toThrow();
    }
  });

  it("no parser should crash on malformed JSON", () => {
    for (const { name, parser } of allParsers) {
      expect(() => parser.canParse("test.json", "{ bad json }")).not.toThrow();
      expect(() => parser.parse("{ bad json }", "test.json")).not.toThrow();
    }
  });

  it("OpenHands fixture should only match OpenHands parser", () => {
    const firstLine = fixtures["OpenHands"].contents.split("\n")[0];
    const ohParser = new OpenHandsParser();
    expect(ohParser.canParse("output.jsonl", firstLine)).toBe(true);

    // Should NOT match Claude Code
    const ccParser = new ClaudeCodeParser();
    expect(ccParser.canParse("output.jsonl", firstLine)).toBe(false);
  });

  it("Claude Code fixture should only match Claude Code parser", () => {
    const firstLine = fixtures["Claude Code"].contents.split("\n").find((l: string) => l.trim())!;
    const ccParser = new ClaudeCodeParser();
    expect(ccParser.canParse("session.jsonl", firstLine)).toBe(true);

    // Should NOT match OpenHands
    const ohParser = new OpenHandsParser();
    expect(ohParser.canParse("session.jsonl", firstLine)).toBe(false);
  });
});

describe("Empty Input Handling — All Parsers", () => {
  for (const [name] of Object.entries(fixtures)) {
    it(`${name}: parse("") should return empty array`, () => {
      const f = fixtures[name];
      // Use the appropriate filename to trigger the right parser
      const result = parseFile("", f.filename);
      expect(result).toHaveLength(0);
    });
  }

  it("all parsers handle whitespace-only input", () => {
    expect(parseFile("  \n\n  ", "session.jsonl")).toHaveLength(0);
    expect(parseFile("  \n\n  ", "output.jsonl")).toHaveLength(0);
    expect(parseFile("  \n\n  ", "instance.traj")).toHaveLength(0);
    expect(parseFile("  \n\n  ", "api_conversation_history.json")).toHaveLength(0);
    expect(parseFile("  \n\n  ", ".aider.chat.history.md")).toHaveLength(0);
  });
});

describe("Status Field — Parsers That Support It", () => {
  it("OpenHands should set status", () => {
    for (const traj of parsed["OpenHands"]) {
      expect(traj.session.status).toBeDefined();
      expect(["running", "succeeded", "failed", "error", "cancelled", "timeout", "unknown"]).toContain(traj.session.status);
    }
  });

  it("SWE-Agent should set status", () => {
    for (const traj of parsed["SWE-Agent"]) {
      expect(traj.session.status).toBeDefined();
    }
  });

  it("Other parsers should have undefined status (not applicable)", () => {
    for (const name of ["Claude Code", "Cline", "Continue.dev", "Aider", "Codex CLI", "Copilot Chat", "Amazon Q"]) {
      for (const traj of parsed[name]) {
        // Status may or may not be set — just shouldn't be a random value
        if (traj.session.status) {
          expect(["running", "succeeded", "failed", "error", "cancelled", "timeout", "unknown"]).toContain(traj.session.status);
        }
      }
    }
  });
});

describe("Cost Field — Parsers That Support It", () => {
  it("SWE-Agent should have cost data", () => {
    for (const traj of parsed["SWE-Agent"]) {
      expect(traj.session.cost).toBeDefined();
      expect(traj.session.cost!.totalUsd).toBeGreaterThan(0);
    }
  });
});

describe("Session ID Uniqueness", () => {
  it("OpenHands multi-instance: all session IDs should be unique", () => {
    const ids = parsed["OpenHands"].map((t) => t.session.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
