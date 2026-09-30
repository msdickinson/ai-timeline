import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFile, parseFiles } from "../../src/parsers/index";

const claudeFixture = readFileSync(join(__dirname, "../fixtures/claude-code-session.jsonl"), "utf-8");
const openhandsFixture = readFileSync(join(__dirname, "../fixtures/openhands-output.jsonl"), "utf-8");
const sweagentFixture = readFileSync(join(__dirname, "../fixtures/swe-agent-instance.traj"),
  "utf-8"
);

describe("Auto-detection (parseFile)", () => {
  it("should auto-detect Claude Code format", () => {
    const result = parseFile(claudeFixture, "session.jsonl");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe("claude-code");
  });

  it("should auto-detect OpenHands format", () => {
    const result = parseFile(openhandsFixture, "output.jsonl");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe("openhands");
  });

  it("should auto-detect SWE-Agent format by extension", () => {
    const result = parseFile(sweagentFixture, "instance.traj");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe("swe-agent");
  });

  it("should auto-detect Cline format", () => {
    const clineFixture = readFileSync(join(__dirname, "../fixtures/cline-conversation.json"), "utf-8");
    const result = parseFile(clineFixture, "api_conversation_history.json");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].session.metadata?.tool).toBe("cline");
  });

  it("should auto-detect Continue.dev format", () => {
    const continueFixture = readFileSync(join(__dirname, "../fixtures/continue-session.json"), "utf-8");
    const result = parseFile(continueFixture, ".continue/sessions/abc.json");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].session.metadata?.tool).toBe("continue-dev");
  });

  it("should auto-detect Aider format", () => {
    const aiderFixture = readFileSync(join(__dirname, "../fixtures/aider-chat-history.md"), "utf-8");
    const result = parseFile(aiderFixture, ".aider.chat.history.md");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].session.metadata?.tool).toBe("aider");
  });

  it("should return empty for unrecognized files", () => {
    const result = parseFile("just some text", "readme.txt");
    expect(result).toHaveLength(0);
  });

  it("should return empty for unrecognized JSONL", () => {
    const result = parseFile('{"foo": "bar"}', "unknown.jsonl");
    expect(result).toHaveLength(0);
  });
});

describe("Batch parsing (parseFiles)", () => {
  it("should parse multiple files of different formats", () => {
    const result = parseFiles([
      { name: "claude.jsonl", contents: claudeFixture },
      { name: "openhands.jsonl", contents: openhandsFixture },
      { name: "sweagent.traj", contents: sweagentFixture },
    ]);

    expect(result.length).toBe(3);

    const sources = result.map((t) => t.source);
    expect(sources).toContain("claude-code");
    expect(sources).toContain("openhands");
    expect(sources).toContain("swe-agent");
  });

  it("should handle empty file list", () => {
    const result = parseFiles([]);
    expect(result).toHaveLength(0);
  });

  it("should skip unparseable files and parse the rest", () => {
    const result = parseFiles([
      { name: "readme.md", contents: "# Hello" },
      { name: "session.jsonl", contents: claudeFixture },
      { name: "garbage.jsonl", contents: "not json" },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].source).toBe("claude-code");
  });
});

describe("Common format invariants", () => {
  const allTrajectories = [
    ...parseFile(claudeFixture, "claude.jsonl"),
    ...parseFile(openhandsFixture, "openhands.jsonl"),
    ...parseFile(sweagentFixture, "sweagent.traj"),
  ];

  it("all trajectories should have version 1.0", () => {
    for (const t of allTrajectories) {
      expect(t.version).toBe("1.0");
    }
  });

  it("all trajectories should have a session id", () => {
    for (const t of allTrajectories) {
      expect(t.session.id).toBeTruthy();
    }
  });

  it("all trajectories should have events", () => {
    for (const t of allTrajectories) {
      expect(t.events.length).toBeGreaterThan(0);
    }
  });

  it("all events should have sequential IDs", () => {
    for (const t of allTrajectories) {
      for (let i = 0; i < t.events.length; i++) {
        // IDs should be monotonically increasing (not necessarily sequential due to thinking events)
        if (i > 0) {
          expect(t.events[i].id).toBeGreaterThan(t.events[i - 1].id);
        }
      }
    }
  });

  it("all events should have a valid type", () => {
    const validTypes = [
      "message",
      "tool_call",
      "tool_result",
      "thinking",
      "system",
      "error",
    ];
    for (const t of allTrajectories) {
      for (const e of t.events) {
        expect(validTypes).toContain(e.type);
      }
    }
  });

  it("all events should have a valid role", () => {
    const validRoles = ["user", "assistant", "system", "environment"];
    for (const t of allTrajectories) {
      for (const e of t.events) {
        expect(validRoles).toContain(e.role);
      }
    }
  });

  it("all tool_call events should have toolCall data", () => {
    for (const t of allTrajectories) {
      const toolCalls = t.events.filter((e) => e.type === "tool_call");
      for (const tc of toolCalls) {
        expect(tc.toolCall).toBeDefined();
        expect(tc.toolCall!.name).toBeTruthy();
      }
    }
  });

  it("all tool_result events should have toolResult data", () => {
    for (const t of allTrajectories) {
      const toolResults = t.events.filter((e) => e.type === "tool_result");
      for (const tr of toolResults) {
        expect(tr.toolResult).toBeDefined();
        expect(typeof tr.toolResult!.isError).toBe("boolean");
      }
    }
  });

  it("all trajectories should have a computed summary", () => {
    for (const t of allTrajectories) {
      expect(t.summary).toBeDefined();
      expect(t.summary!.totalEvents).toBeGreaterThan(0);
      expect(t.summary!.totalToolCalls).toBeGreaterThan(0);
      expect(t.summary!.uniqueTools.length).toBeGreaterThan(0);
    }
  });
});
