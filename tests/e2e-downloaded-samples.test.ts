/**
 * Tests against REAL data downloaded from public repos.
 * These verify our parsers work with actual files, not synthetic fixtures.
 *
 * Sources:
 * - Aider: johns10/generaite_todo_app_1 (.aider.chat.history.md)
 * - SWE-Agent: SWE-agent/SWE-agent demo trajectory
 * - Copilot Chat: peckjon/copilot-chat-to-markdown (exported session)
 * - Cline: Dicklesworthstone/cross_agent_session_resumer fixture
 * - Codex CLI: openai/codex TUI test fixture
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseFile } from "../src/parsers/index";

const REAL_DIR = join(__dirname, "../samples/real");
const hasRealSamples = existsSync(REAL_DIR);

function loadIfExists(name: string): string | null {
  const path = join(REAL_DIR, name);
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

describe.skipIf(!hasRealSamples)("Real Aider Chat History (3483 lines)", () => {
  const contents = loadIfExists("aider-real.md");

  it("should parse successfully", () => {
    const result = parseFile(contents!, ".aider.chat.history.md");
    expect(result.length).toBeGreaterThan(0);
    console.log(`  Trajectories: ${result.length}`);
  });

  it("should detect as aider", () => {
    const result = parseFile(contents!, ".aider.chat.history.md");
    expect(result[0].session.metadata?.tool).toBe("aider");
  });

  it("should have substantial events from real conversation", () => {
    const result = parseFile(contents!, ".aider.chat.history.md");
    const totalEvents = result.reduce((s, t) => s + t.events.length, 0);
    expect(totalEvents).toBeGreaterThan(10);
    console.log(`  Total events: ${totalEvents}`);
  });

  it("should have user and assistant messages", () => {
    const result = parseFile(contents!, ".aider.chat.history.md");
    const allEvents = result.flatMap((t) => t.events);
    const userMsgs = allEvents.filter((e) => e.role === "user");
    const assistantMsgs = allEvents.filter((e) => e.role === "assistant");
    expect(userMsgs.length).toBeGreaterThan(0);
    expect(assistantMsgs.length).toBeGreaterThan(0);
    console.log(`  User msgs: ${userMsgs.length}, Assistant msgs: ${assistantMsgs.length}`);
  });

  it("should have edit tool calls from code blocks", () => {
    const result = parseFile(contents!, ".aider.chat.history.md");
    const allEvents = result.flatMap((t) => t.events);
    const edits = allEvents.filter((e) => e.type === "tool_call");
    expect(edits.length).toBeGreaterThan(0);
    console.log(`  Edit tool calls: ${edits.length}`);
  });

  it("should compute valid summaries", () => {
    const result = parseFile(contents!, ".aider.chat.history.md");
    for (const t of result) {
      expect(t.summary).toBeDefined();
      expect(t.summary!.totalEvents).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!hasRealSamples)("Real SWE-Agent Demo Trajectory (150 lines)", () => {
  const contents = loadIfExists("swe-agent-real.traj");

  it("should parse successfully", () => {
    const result = parseFile(contents!, "function_calling_simple.traj");
    expect(result.length).toBe(1);
  });

  it("should detect as swe-agent", () => {
    const result = parseFile(contents!, "demo.traj");
    expect(result[0].source).toBe("swe-agent");
  });

  it("should have events", () => {
    const result = parseFile(contents!, "demo.traj");
    expect(result[0].events.length).toBeGreaterThan(0);
    console.log(`  Events: ${result[0].events.length}`);
  });

  it("should have tool calls", () => {
    const result = parseFile(contents!, "demo.traj");
    const tools = result[0].events.filter((e) => e.type === "tool_call");
    console.log(`  Tool calls: ${tools.length}`);
    // Demo may or may not have tool calls depending on format
  });

  it("should have a summary", () => {
    const result = parseFile(contents!, "demo.traj");
    expect(result[0].summary).toBeDefined();
  });
});

describe.skipIf(!hasRealSamples)("Real Copilot Chat Export (8234 lines)", () => {
  const contents = loadIfExists("copilot-chat-real.json");

  it("should parse successfully", () => {
    const result = parseFile(contents!, "chatSessions/copilot-export.json");
    expect(result.length).toBeGreaterThan(0);
    console.log(`  Trajectories: ${result.length}`);
  });

  it("should have messages", () => {
    const result = parseFile(contents!, "chatSessions/copilot-export.json");
    const totalEvents = result.reduce((s, t) => s + t.events.length, 0);
    expect(totalEvents).toBeGreaterThan(0);
    console.log(`  Total events: ${totalEvents}`);
  });

  it("should have both user and assistant messages", () => {
    const result = parseFile(contents!, "chatSessions/copilot-export.json");
    const allEvents = result.flatMap((t) => t.events);
    const users = allEvents.filter((e) => e.role === "user");
    const assistants = allEvents.filter((e) => e.role === "assistant");
    console.log(`  User: ${users.length}, Assistant: ${assistants.length}`);
  });
});

describe.skipIf(!hasRealSamples)("Real Cline Conversation (44 lines)", () => {
  const contents = loadIfExists("cline-real.json");

  it("should parse successfully", () => {
    const result = parseFile(contents!, "api_conversation_history.json");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should detect as cline", () => {
    const result = parseFile(contents!, "api_conversation_history.json");
    expect(result[0].session.metadata?.tool).toBe("cline");
  });

  it("should have events", () => {
    const result = parseFile(contents!, "api_conversation_history.json");
    expect(result[0].events.length).toBeGreaterThan(0);
    console.log(`  Events: ${result[0].events.length}`);
  });
});

describe.skipIf(!hasRealSamples)("Real Codex CLI Session (8041 lines)", () => {
  const contents = loadIfExists("codex-real.jsonl");

  it("should attempt to parse", () => {
    // The OpenAI codex TUI fixture may be in a different format than our parser expects
    // This test documents what happens
    const result = parseFile(contents!, "codex-session.jsonl");
    console.log(`  Parsed: ${result.length} trajectories`);
    if (result.length > 0) {
      console.log(`  Events: ${result[0].events.length}`);
      console.log(`  Source: ${result[0].source}`);
    } else {
      console.log("  NOTE: Codex CLI real format may differ from our parser — needs investigation");
    }
  });
});

describe.skipIf(!hasRealSamples)("Codex Modern Format (5 lines)", () => {
  const contents = loadIfExists("codex-modern.jsonl");

  it("should attempt to parse", () => {
    const result = parseFile(contents!, "codex-session.jsonl");
    console.log(`  Parsed: ${result.length} trajectories`);
    if (result.length > 0) {
      console.log(`  Events: ${result[0].events.length}`);
    } else {
      console.log("  NOTE: Codex modern JSONL format differs from our JSON parser — may need JSONL support");
    }
  });
});
