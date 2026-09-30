import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { VettParser } from "../../src/parsers/vett";

const fx = (name: string) =>
  readFileSync(join(__dirname, "..", "fixtures", name), "utf-8");

describe("VettParser — CS3 LiveSink JSONL (new 2026-04-25 format)", () => {
  const parser = new VettParser();
  const filename = "events.jsonl";
  const contents = fx("vett-livesink-events.jsonl");
  const firstLine = contents.split("\n")[0];

  it("canParse identifies the LiveSink envelope by seq+type+data fingerprint", () => {
    expect(parser.canParse(filename, firstLine)).toBe(true);
  });

  it("does NOT match plain JSONL without the envelope keys", () => {
    expect(parser.canParse("foo.jsonl", '{"hello":"world"}')).toBe(false);
  });

  it("produces one Trajectory per instance_id (run-level events filtered out)", () => {
    const trajectories = parser.parse(contents, filename);
    // Two instances in the fixture, plus run_start/run_end with instance_id=null
    expect(trajectories).toHaveLength(2);
    const ids = trajectories.map((t) => t.session.metadata?.instanceId).sort();
    expect(ids).toEqual(["django__django-15987", "sympy__sympy-16886"]);
  });

  it("preserves source = 'vett' and tags metadata.source = 'vett-livesink'", () => {
    const t = parser.parse(contents, filename)[0];
    expect(t.source).toBe("vett");
    expect(t.session.metadata?.source).toBe("vett-livesink");
  });

  it("maps tool_call_start + tool_call_end into linked tool_call/tool_result events", () => {
    const t = parser.parse(contents, filename).find(
      (x) => x.session.metadata?.instanceId === "django__django-15987",
    )!;
    const calls = t.events.filter((e) => e.type === "tool_call");
    const results = t.events.filter((e) => e.type === "tool_result");
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // The first tool_result must link back to its tool_call by event id
    const firstResult = results[0];
    expect(firstResult.toolResult?.toolCallEventId).toBeDefined();
    const linkedCall = t.events.find((e) => e.id === firstResult.toolResult!.toolCallEventId!);
    expect(linkedCall?.toolCall?.name).toBe("terminal");
  });

  it("marks failed tool_call_end as toolResult.isError", () => {
    const t = parser.parse(contents, filename).find(
      (x) => x.session.metadata?.instanceId === "sympy__sympy-16886",
    )!;
    const errResult = t.events.find(
      (e) => e.type === "tool_result" && e.toolResult?.isError === true,
    );
    expect(errResult).toBeDefined();
    expect(errResult!.toolResult!.output).toContain("Error");
  });

  it("captures llm_response token usage and turnIndex", () => {
    const t = parser.parse(contents, filename).find(
      (x) => x.session.metadata?.instanceId === "django__django-15987",
    )!;
    const llm = t.events.find(
      (e) => e.type === "message" && e.role === "assistant" && e.tokens?.input,
    );
    expect(llm).toBeDefined();
    expect(llm!.tokens!.input).toBe(12500);
    expect(llm!.tokens!.output).toBe(234);
    expect(llm!.turnIndex).toBe(1);
  });

  it("session_recovery becomes a system message", () => {
    const t = parser.parse(contents, filename).find(
      (x) => x.session.metadata?.instanceId === "django__django-15987",
    )!;
    const recovery = t.events.find(
      (e) => e.type === "system" && e.content?.includes("Session recovered"),
    );
    expect(recovery).toBeDefined();
    expect(recovery!.content).toContain("iter 12");
    expect(recovery!.content).toContain("consecutive_terminal_failures");
  });

  it("instance_end maps to status: finish_tool=succeeded, max_iterations=failed", () => {
    const trajectories = parser.parse(contents, filename);
    const finishTool = trajectories.find(
      (t) => t.session.metadata?.instanceId === "django__django-15987",
    )!;
    const maxIter = trajectories.find(
      (t) => t.session.metadata?.instanceId === "sympy__sympy-16886",
    )!;
    expect(finishTool.session.status).toBe("succeeded");
    expect(maxIter.session.status).toBe("failed");
    expect(finishTool.session.metadata?.endReason).toBe("finish_tool");
    expect(maxIter.session.metadata?.endReason).toBe("max_iterations");
  });

  it("computes summary with token totals and tool call counts", () => {
    const t = parser.parse(contents, filename).find(
      (x) => x.session.metadata?.instanceId === "django__django-15987",
    )!;
    expect(t.summary).toBeDefined();
    expect(t.summary!.totalTokens.input).toBe(12500);
    expect(t.summary!.totalTokens.output).toBe(234);
    expect(t.summary!.toolCallCounts.terminal).toBe(1);
  });

  it("groups events correctly even when interleaved by time across instances", () => {
    // The fixture interleaves django + sympy events. Verify each instance's
    // events end up in the right Trajectory (not bleeding across).
    const trajectories = parser.parse(contents, filename);
    for (const t of trajectories) {
      const instId = t.session.metadata?.instanceId as string;
      // No event in the per-instance trajectory should reference the OTHER instance's call_id.
      // (call-1 belongs to django, call-2 belongs to sympy.)
      const calls = t.events.filter((e) => e.type === "tool_call");
      if (instId === "django__django-15987") {
        expect(calls.length).toBe(1);
        expect(calls[0].toolCall?.name).toBe("terminal");
      } else if (instId === "sympy__sympy-16886") {
        expect(calls.length).toBe(1);
        expect(calls[0].toolCall?.name).toBe("file_editor");
      }
    }
  });
});

describe("VettParser — team-bench session log (per-member tracks)", () => {
  const parser = new VettParser();
  const filename = "vett-team-bench/empty-git-repo-20260708/_bench-session.jsonl";
  const contents = fx("vett-team-bench-session.jsonl");
  const firstLine = contents.split("\n").find((l) => l.trim())!;

  it("canParse identifies the {ts,type,data}+thread_id bench log (no seq/instance_id)", () => {
    expect(parser.canParse(filename, firstLine)).toBe(true);
  });

  it("does NOT hijack the LiveSink stream (which has seq)", () => {
    const liveSink = '{"seq":1,"ts":"t","type":"llm_response","instance_id":"x","data":{"thread_id":"main"}}';
    // canParse still routes seq-bearing lines through the LiveSink branch,
    // not the bench branch — both return true, but parse() must group by
    // instance_id (LiveSink), which the dedicated test below covers.
    expect(parser.canParse("events.jsonl", liveSink)).toBe(true);
  });

  it("emits ONE trajectory for the whole team run", () => {
    const trajs = parser.parse(contents, filename);
    expect(trajs).toHaveLength(1);
    expect(trajs[0].session.metadata?.source).toBe("vett-team-bench");
  });

  it("tags leader events with NO agent (main lanes, like a Claude parent)", () => {
    const t = parser.parse(contents, filename)[0];
    // The leader's assign_task tool call must stay in the main lanes.
    const leaderCall = t.events.find(
      (e) => e.type === "tool_call" && e.toolCall?.name === "assign_task",
    )!;
    expect(leaderCall.agent).toBeUndefined();
  });

  it("splits each dispatched member into its own agent track", () => {
    const t = parser.parse(contents, filename)[0];
    const agents = new Set(t.events.map((e) => e.agent).filter(Boolean));
    expect([...agents].sort()).toEqual(["implementer-1", "implementer-2"]);
    // metadata surfaces the member roster for a quick glance
    expect(t.session.metadata?.members).toEqual(["implementer-1", "implementer-2"]);
  });

  it("preserves real tool_call arguments from the bench log", () => {
    const t = parser.parse(contents, filename)[0];
    const memberEdit = t.events.find(
      (e) => e.agent === "implementer-1" && e.type === "tool_call" && e.toolCall?.name === "file_editor",
    )!;
    expect(typeof memberEdit.toolCall!.arguments).toBe("object");
    expect((memberEdit.toolCall!.arguments as Record<string, unknown>).path).toBe("README.md");
  });

  it("extracts assistant narration text from llm_response content", () => {
    const t = parser.parse(contents, filename)[0];
    const narration = t.events.find(
      (e) => e.type === "message" && e.role === "assistant" && e.content?.includes("dispatch an implementer"),
    );
    expect(narration).toBeDefined();
  });

  it("surfaces a leader dispatch marker per member", () => {
    const t = parser.parse(contents, filename)[0];
    const markers = t.events.filter((e) => e.content?.startsWith("Dispatched implementer"));
    expect(markers.length).toBe(2);
    expect(markers[0].agent).toBeUndefined(); // marker lives on the leader track
  });
});

describe("VettParser — team CHAT log (extension LiveSink + thread_id)", () => {
  const parser = new VettParser();
  const filename = "chat-session.jsonl";
  const contents = fx("vett-team-chat-livesink.jsonl");

  it("produces one trajectory with leader + member tracks", () => {
    const trajs = parser.parse(contents, filename);
    expect(trajs).toHaveLength(1);
    const t = trajs[0];
    expect(t.session.metadata?.source).toBe("vett-livesink");
    const agents = new Set(t.events.map((e) => e.agent).filter(Boolean));
    expect([...agents]).toEqual(["implementer-1"]);
    // leader (thread_id=main) tool call stays in main lanes
    const accept = t.events.find((e) => e.toolCall?.name === "accept_dispatch")!;
    expect(accept.agent).toBeUndefined();
  });

  it("member tool call keeps its arguments (chat path)", () => {
    const t = parser.parse(contents, filename)[0];
    const edit = t.events.find(
      (e) => e.agent === "implementer-1" && e.toolCall?.name === "file_editor",
    )!;
    expect((edit.toolCall!.arguments as Record<string, unknown>).path).toBe("hello.txt");
  });

  it("single-agent LiveSink logs (no thread_id) get NO agent tags — zero regression", () => {
    const solo = fx("vett-livesink-events.jsonl");
    const trajs = parser.parse(solo, "events.jsonl");
    for (const t of trajs) {
      expect(t.events.every((e) => e.agent === undefined)).toBe(true);
    }
  });
});

describe("VettParser — backward-compat with older formats", () => {
  const parser = new VettParser();

  it("still recognises aggregate RunResult JSON", () => {
    const stub = '{"profile_name":"openhands","instances":[]}';
    expect(parser.canParse("run.json", stub)).toBe(true);
  });

  it("still recognises legacy trace JSONL (per-iteration messages)", () => {
    const stub =
      '{"iteration":1,"messages":[{"role":"system","content":"x"}],"assistant_content":"y"}';
    expect(parser.canParse("trace.jsonl", stub)).toBe(true);
  });

  it("rejects neither-format JSONL", () => {
    expect(parser.canParse("foo.jsonl", '{"random":"data"}')).toBe(false);
  });
});
