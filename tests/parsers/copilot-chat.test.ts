import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CopilotChatParser } from "../../src/parsers/copilot-chat";

const parser = new CopilotChatParser();
const fixture = readFileSync(join(__dirname, "../fixtures/copilot-chat-session.json"), "utf-8");

describe("CopilotChatParser", () => {
  describe("canParse", () => {
    it("should detect files with chatSession in name", () => {
      expect(parser.canParse("chatSessions/abc.json", "{")).toBe(true);
    });

    it("should detect files with copilot in name", () => {
      expect(parser.canParse("copilot-export.json", "{")).toBe(true);
    });

    it("should detect compact JSON with requester/responder", () => {
      const compact = JSON.stringify(JSON.parse(fixture));
      expect(parser.canParse("session.json", compact)).toBe(true);
    });

    it("should reject non-JSON", () => {
      expect(parser.canParse("copilot.txt", "hi")).toBe(false);
    });
  });

  describe("parse", () => {
    it("should return one trajectory", () => {
      const result = parser.parse(fixture, "copilot-session.json");
      expect(result).toHaveLength(1);
    });

    it("should extract session metadata", () => {
      const [traj] = parser.parse(fixture, "copilot-session.json");
      expect(traj.session.metadata?.tool).toBe("copilot-chat");
    });

    it("should parse requester messages as user", () => {
      const [traj] = parser.parse(fixture, "copilot.json");
      const user = traj.events.filter((e) => e.type === "message" && e.role === "user");
      expect(user.length).toBe(2);
      expect(user[0].content).toContain("retry logic");
      expect(user[1].content).toContain("exponential backoff");
    });

    it("should parse responder results as assistant", () => {
      const [traj] = parser.parse(fixture, "copilot.json");
      const assistant = traj.events.filter((e) => e.type === "message" && e.role === "assistant");
      expect(assistant.length).toBe(2);
      expect(assistant[0].content).toContain("fetchWithRetry");
    });

    it("should interleave user and assistant messages", () => {
      const [traj] = parser.parse(fixture, "copilot.json");
      // Should alternate: user, assistant, user, assistant
      expect(traj.events[0].role).toBe("user");
      expect(traj.events[1].role).toBe("assistant");
      expect(traj.events[2].role).toBe("user");
      expect(traj.events[3].role).toBe("assistant");
    });

    it("should compute summary", () => {
      const [traj] = parser.parse(fixture, "copilot.json");
      expect(traj.summary!.totalEvents).toBe(4);
      expect(traj.summary!.errorCount).toBe(0);
    });

    it("should handle flat messages format", () => {
      const flat = JSON.stringify({
        messages: [
          { role: "user", message: "Hello", agent: "@workspace" },
          { role: "assistant", message: "Hi there!" },
        ],
      });
      const result = parser.parse(flat, "copilot-flat.json");
      expect(result).toHaveLength(1);
      expect(result[0].events.length).toBe(2);
    });

    it("should handle empty session", () => {
      expect(parser.parse('{"requester":[],"responder":[]}', "copilot.json")).toHaveLength(0);
    });

    it("should handle error responses", () => {
      const withError = JSON.stringify({
        requester: [{ message: "test" }],
        responder: [{ result: { errorDetails: { message: "Rate limited" } } }],
      });
      const result = parser.parse(withError, "copilot.json");
      expect(result).toHaveLength(1);
      const errors = result[0].events.filter((e) => e.type === "error");
      expect(errors.length).toBe(1);
      expect(errors[0].content).toContain("Rate limited");
    });

    it("should handle malformed JSON", () => {
      expect(parser.parse("bad json", "copilot.json")).toHaveLength(0);
    });
  });
});
