import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CodexCliParser } from "../../src/parsers/codex-cli";

const parser = new CodexCliParser();
const fixture = readFileSync(join(__dirname, "../fixtures/codex-session.json"), "utf-8");

describe("CodexCliParser", () => {
  describe("canParse", () => {
    it("should detect files with codex in name", () => {
      expect(parser.canParse("codex-session.json", "{")).toBe(true);
    });

    it("should detect compact JSON with messages + model + instructions", () => {
      const compact = JSON.stringify(JSON.parse(fixture));
      expect(parser.canParse("session.json", compact)).toBe(true);
    });

    it("should reject non-JSON", () => {
      expect(parser.canParse("codex.txt", "hello")).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return one trajectory", () => {
      const result = parser.parse(fixture, "codex-session.json");
      expect(result).toHaveLength(1);
    });

    it("should extract session metadata", () => {
      const [traj] = parser.parse(fixture, "codex-session.json");
      expect(traj.session.id).toBe("codex-session-001");
      expect(traj.session.model).toBe("o4-mini");
      expect(traj.session.metadata?.tool).toBe("codex-cli");
    });

    it("should parse user messages", () => {
      const [traj] = parser.parse(fixture, "codex.json");
      const user = traj.events.filter((e) => e.type === "message" && e.role === "user");
      expect(user.length).toBe(1);
      expect(user[0].content).toContain("TODO");
    });

    it("should parse system messages", () => {
      const [traj] = parser.parse(fixture, "codex.json");
      const sys = traj.events.filter((e) => e.type === "system");
      expect(sys.length).toBe(1);
    });

    it("should parse tool calls", () => {
      const [traj] = parser.parse(fixture, "codex.json");
      const calls = traj.events.filter((e) => e.type === "tool_call");
      expect(calls.length).toBe(3); // shell, shell, apply_patch
      expect(calls[0].toolCall?.name).toBe("shell");
      expect(calls[2].toolCall?.name).toBe("apply_patch");
    });

    it("should parse tool results and link to calls", () => {
      const [traj] = parser.parse(fixture, "codex.json");
      const results = traj.events.filter((e) => e.type === "tool_result");
      expect(results.length).toBe(3);
      for (const r of results) {
        expect(r.toolResult?.toolCallEventId).toBeDefined();
        const call = traj.events.find((e) => e.id === r.toolResult!.toolCallEventId);
        expect(call?.type).toBe("tool_call");
      }
    });

    it("should parse tool call arguments as JSON", () => {
      const [traj] = parser.parse(fixture, "codex.json");
      const shellCall = traj.events.find((e) => e.toolCall?.name === "shell");
      expect(shellCall).toBeDefined();
      const args = shellCall!.toolCall!.arguments as Record<string, unknown>;
      expect(args.command).toContain("grep");
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "codex.json");
      expect(traj.summary!.totalToolCalls).toBe(3);
      expect(traj.summary!.uniqueTools).toContain("shell");
      expect(traj.summary!.uniqueTools).toContain("apply_patch");
    });

    it("should handle empty messages", () => {
      expect(parser.parse('{"messages":[]}', "codex.json")).toHaveLength(0);
    });

    it("should handle malformed JSON", () => {
      expect(parser.parse("bad", "codex.json")).toHaveLength(0);
    });
  });
});
