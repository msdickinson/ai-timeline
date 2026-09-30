import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SweAgentParser } from "../../src/parsers/swe-agent";

const parser = new SweAgentParser();
const fixture = readFileSync(
  join(__dirname, "../fixtures/swe-agent-instance.traj"),
  "utf-8"
);

describe("SweAgentParser", () => {
  describe("canParse", () => {
    it("should detect .traj files by extension", () => {
      expect(parser.canParse("sympy__sympy-23456.traj")).toBe(true);
    });

    it("should detect .traj regardless of first line", () => {
      expect(parser.canParse("instance.traj", "anything")).toBe(true);
    });

    it("should reject non-.traj files without trajectory structure", () => {
      expect(parser.canParse("data.json", '{"key": "value"}')).toBe(false);
    });

    it("should reject JSONL files", () => {
      expect(parser.canParse("output.jsonl", '{"history": []}')).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return exactly one trajectory", () => {
      const result = parser.parse(fixture, "sympy__sympy-23456.traj");
      expect(result).toHaveLength(1);
    });

    it("should extract instance metadata", () => {
      const [traj] = parser.parse(fixture, "sympy__sympy-23456.traj");
      expect(traj.source).toBe("swe-agent");
      expect(traj.version).toBe("1.0");
      expect(traj.session.id).toBe("sympy__sympy-23456");
      expect(traj.session.model).toBe("gpt-4");
    });

    it("should extract info metadata", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      expect(traj.session.metadata?.exitStatus).toBe("submitted");
      expect(traj.session.metadata?.hasSubmission).toBe(true);
      expect(traj.session.cost?.totalUsd).toBe(0.15);
      expect(traj.session.metadata?.apiCalls).toBe(8);
    });

    it("should derive status from exit_status", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      expect(traj.session.status).toBe("succeeded"); // exit_status: "submitted"
    });

    it("should handle SWE-Agent 2.0 tool result linking", () => {
      const content = JSON.stringify({
        instance_id: "test-v2-link",
        info: { model: "gpt-4o" },
        history: [
          { role: "assistant", tool_calls: [{ function: { name: "bash", arguments: '{"cmd":"ls"}' }, id: "tc1" }] },
          { role: "tool", content: "file1.py\nfile2.py" },
        ],
      });
      const [traj] = parser.parse(content, "v2link.traj");
      const toolResult = traj.events.find((e) => e.type === "tool_result");
      expect(toolResult).toBeDefined();
      expect(toolResult!.toolResult?.toolCallEventId).toBeDefined();
      const linkedCall = traj.events.find((e) => e.id === toolResult!.toolResult!.toolCallEventId);
      expect(linkedCall).toBeDefined();
      expect(linkedCall!.type).toBe("tool_call");
    });

    it("should parse thinking from trajectory steps", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      const thinking = traj.events.filter((e) => e.type === "thinking");
      expect(thinking.length).toBe(5); // Each step has a thought
      expect(thinking[0].content).toContain("understand the issue");
    });

    it("should parse tool calls from actions", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      expect(toolCalls.length).toBe(5); // bash, open, edit, bash, submit

      const bashCalls = toolCalls.filter(
        (e) => e.toolCall?.name === "bash"
      );
      expect(bashCalls.length).toBe(2);

      const openCalls = toolCalls.filter(
        (e) => e.toolCall?.name === "open"
      );
      expect(openCalls.length).toBe(1);

      const editCalls = toolCalls.filter(
        (e) => e.toolCall?.name === "edit"
      );
      expect(editCalls.length).toBe(1);

      const submitCalls = toolCalls.filter(
        (e) => e.toolCall?.name === "submit"
      );
      expect(submitCalls.length).toBe(1);
    });

    it("should parse bash command arguments", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      const bashCall = traj.events.find(
        (e) => e.type === "tool_call" && e.toolCall?.name === "bash"
      );
      expect(bashCall).toBeDefined();
      expect((bashCall!.toolCall!.arguments as any).command).toContain(
        "find"
      );
    });

    it("should parse tool results from observations", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      const results = traj.events.filter((e) => e.type === "tool_result");
      expect(results.length).toBe(5);

      // First result should be from the find command
      expect(results[0].toolResult?.output).toContain("basic.py");
    });

    it("should link tool results to tool calls", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      const results = traj.events.filter((e) => e.type === "tool_result");
      for (const result of results) {
        expect(result.toolResult?.toolCallEventId).toBeDefined();
        const linked = traj.events.find(
          (e) => e.id === result.toolResult!.toolCallEventId
        );
        expect(linked).toBeDefined();
        expect(linked!.type).toBe("tool_call");
      }
    });

    it("should detect potential errors in observations", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      // None of our fixture observations contain "Error" or "Traceback"
      const errors = traj.events.filter((e) => e.toolResult?.isError);
      expect(errors).toHaveLength(0);
    });

    it("should extract token usage from model_stats", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      const withTokens = traj.events.filter((e) => e.tokens);
      expect(withTokens.length).toBeGreaterThan(0);
      expect(withTokens[0].tokens!.input).toBe(25000);
      expect(withTokens[0].tokens!.output).toBe(3000);
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "test.traj");
      expect(traj.summary).toBeDefined();
      expect(traj.summary!.totalToolCalls).toBe(5);
      expect(traj.summary!.uniqueTools).toContain("bash");
      expect(traj.summary!.uniqueTools).toContain("edit");
      expect(traj.summary!.uniqueTools).toContain("open");
      expect(traj.summary!.uniqueTools).toContain("submit");
      expect(traj.summary!.totalTokens.input).toBe(25000);
      expect(traj.summary!.totalTokens.output).toBe(3000);
    });

    it("should handle malformed JSON gracefully", () => {
      const result = parser.parse("not json {}", "bad.traj");
      expect(result).toHaveLength(0);
    });

    it("should handle empty trajectory array", () => {
      const content = JSON.stringify({
        instance_id: "test",
        info: {},
        trajectory: [],
      });
      const result = parser.parse(content, "empty.traj");
      expect(result).toHaveLength(0);
    });

    it("should handle SWE-Agent 2.0 role-based format", () => {
      const content = JSON.stringify({
        instance_id: "test-v2",
        info: { model: "gpt-4o" },
        history: [
          { role: "system", content: "You are a coding assistant" },
          { role: "user", content: "Fix the bug" },
          {
            role: "assistant",
            content: "Let me look",
            tool_calls: [
              {
                function: {
                  name: "bash",
                  arguments: '{"command": "ls"}',
                },
                id: "tc_1",
              },
            ],
          },
          { role: "tool", content: "file1.py\nfile2.py" },
        ],
      });
      const result = parser.parse(content, "v2.traj");
      expect(result).toHaveLength(1);

      const [traj] = result;
      expect(traj.session.id).toBe("test-v2");

      const system = traj.events.filter((e) => e.type === "system");
      expect(system).toHaveLength(1);

      const toolCalls = traj.events.filter((e) => e.type === "tool_call");
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall?.name).toBe("bash");

      const toolResults = traj.events.filter(
        (e) => e.type === "tool_result"
      );
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].toolResult?.output).toContain("file1.py");
    });
  });
});
