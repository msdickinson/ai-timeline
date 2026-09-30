import { describe, it, expect } from "vitest";
import {
  AmazonQParser,
  ClineParser,
  CodexCliParser,
  ContinueDevParser,
  CopilotChatParser,
  ClaudeCodeParser,
  OpenHandsParser,
  SweAgentParser,
  AiderParser
} from "../src/parsers/index";

describe("Parser Crash Tests - Real Crashes", () => {
  
  describe("AmazonQParser", () => {
    it("CRASH: should not crash when messages array contains null", () => {
      const input = JSON.stringify({
        conversationId: "test",
        messages: [
          { role: "user", content: "test" },
          null,
          { role: "assistant", content: "test" }
        ]
      });
      
      const parser = new AmazonQParser();
      expect(() => parser.parse(input, "test.json")).not.toThrow();
    });

    it("should not crash when messages contains non-objects", () => {
      const input = JSON.stringify({
        conversationId: "test",
        messages: [
          { role: "user", content: "test" },
          "string instead of object",
          123,
          { role: "assistant", content: "test" }
        ]
      });
      
      const parser = new AmazonQParser();
      expect(() => parser.parse(input, "test.json")).not.toThrow();
    });
  });

  describe("ClineParser", () => {
    it("should not crash on message content that is not string or array", () => {
      const input = JSON.stringify({
        messages: [
          { role: "user", content: 12345 },
          { role: "assistant", content: true }
        ]
      });
      
      const parser = new ClineParser();
      expect(() => parser.parse(input, "test.json")).not.toThrow();
    });
  });

  describe("CodexCliParser", () => {
    it("should not crash with tool_calls array containing invalid objects", () => {
      const input = JSON.stringify({
        messages: [
          {
            role: "assistant",
            content: "test",
            tool_calls: [
              null,
              { function: null },
              { function: { name: null, arguments: null } },
              { function: { name: "valid", arguments: '{"key":"value"}' } }
            ]
          }
        ],
        model: "gpt-4",
        instructions: "test"
      });
      
      const parser = new CodexCliParser();
      expect(() => parser.parse(input, "test.json")).not.toThrow();
    });
  });

  describe("ContinueDevParser", () => {
    it("should not crash when history contains null entries", () => {
      const input = JSON.stringify({
        sessionId: "test",
        history: [
          { role: "user", content: "test" },
          null,
          { role: "assistant", content: "test" }
        ]
      });
      
      const parser = new ContinueDevParser();
      expect(() => parser.parse(input, "test.json")).not.toThrow();
    });
  });

  describe("CopilotChatParser", () => {
    it("should not crash with null response array entries", () => {
      const input = JSON.stringify({
        requests: [
          {
            message: { text: "test" },
            response: [
              { content: { value: "test" } },
              null,
              { content: null }
            ]
          }
        ]
      });
      
      const parser = new CopilotChatParser();
      expect(() => parser.parse(input, "test.json")).not.toThrow();
    });
  });

  describe("ClaudeCodeParser", () => {
    it("should not crash when content block type is unknown", () => {
      const input = JSON.stringify({
        message: {
          role: "assistant",
          content: [
            { type: "unknown_type", data: "test" },
            { type: "text", text: "valid" },
            null
          ]
        },
        timestamp: "2026-01-01T00:00:00Z"
      });
      
      const parser = new ClaudeCodeParser();
      expect(() => parser.parse(input, "test.jsonl")).not.toThrow();
    });
  });

  describe("OpenHandsParser", () => {
    it("should not crash with null entries in history array", () => {
      const input = JSON.stringify({
        instance_id: "test",
        history: [
          { timestamp: "2026-01-01T00:00:00Z", kind: "MessageEvent", source: "user", thought: "test" },
          null,
          { timestamp: "2026-01-01T00:00:01Z", kind: "ActionEvent", source: "agent" }
        ]
      });
      
      const parser = new OpenHandsParser();
      expect(() => parser.parse(input, "test.jsonl")).not.toThrow();
    });
  });

  describe("SweAgentParser", () => {
    it("should not crash with null entries in trajectory", () => {
      const input = JSON.stringify({
        trajectory: [
          { action: "test", observation: "test" },
          null,
          { thought: "test", action: "bash\nls" }
        ],
        info: {}
      });
      
      const parser = new SweAgentParser();
      expect(() => parser.parse(input, "test.traj")).not.toThrow();
    });
  });
});
