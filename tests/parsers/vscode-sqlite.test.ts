import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { VSCodeSqliteParser } from "../../src/parsers/vscode-sqlite";

const parser = new VSCodeSqliteParser();
const fixturePath = join(__dirname, "../fixtures/cursor-state.vscdb");
const hasFixture = existsSync(fixturePath);

describe("VSCodeSqliteParser", () => {
  describe("canParse", () => {
    it("should detect .vscdb files with state in name", () => {
      expect(parser.canParse("state.vscdb")).toBe(true);
    });

    it("should detect cursor state files", () => {
      expect(parser.canParse("cursor/User/globalStorage/state.vscdb")).toBe(true);
    });

    it("should detect windsurf state files", () => {
      expect(parser.canParse("windsurf/User/globalStorage/state.vscdb")).toBe(true);
    });

    it("should detect trae state files", () => {
      expect(parser.canParse("trae/state.vscdb")).toBe(true);
    });

    it("should reject non-sqlite files", () => {
      expect(parser.canParse("data.json")).toBe(false);
    });

    it("should reject random .db files without state/cursor/windsurf", () => {
      expect(parser.canParse("random.db")).toBe(false);
    });
  });

  describe("parse (text mode)", () => {
    it("should return empty for text content (SQLite needs binary)", () => {
      const result = parser.parse("not binary data", "state.vscdb");
      expect(result).toHaveLength(0);
    });
  });

  describe.skipIf(!hasFixture)("parseBinary (real SQLite fixture)", () => {
    it("should parse the cursor state.vscdb fixture", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");
      expect(result.length).toBeGreaterThan(0);
      console.log(`  Trajectories from SQLite: ${result.length}`);
    });

    it("should extract conversations with messages", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");

      for (const traj of result) {
        expect(traj.events.length).toBeGreaterThan(0);
        expect(traj.session.id).toBeTruthy();
        console.log(`  Session ${traj.session.id}: ${traj.events.length} events`);
      }
    });

    it("should have both user and assistant messages", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");

      const allEvents = result.flatMap((t) => t.events);
      const userMsgs = allEvents.filter((e) => e.role === "user");
      const assistantMsgs = allEvents.filter((e) => e.role === "assistant");
      expect(userMsgs.length).toBeGreaterThan(0);
      expect(assistantMsgs.length).toBeGreaterThan(0);
      console.log(`  User: ${userMsgs.length}, Assistant: ${assistantMsgs.length}`);
    });

    it("should extract model info", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");

      const withModel = result.filter((t) => t.session.model);
      expect(withModel.length).toBeGreaterThan(0);
      console.log(`  Models: ${withModel.map((t) => t.session.model).join(", ")}`);
    });

    it("should detect tool as cursor", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");

      for (const traj of result) {
        expect(traj.session.metadata?.tool).toBe("cursor");
      }
    });

    it("should compute valid summaries", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");

      for (const traj of result) {
        expect(traj.summary).toBeDefined();
        expect(traj.summary!.totalEvents).toBe(traj.events.length);
        expect(traj.summary!.totalEvents).toBeGreaterThan(0);
      }
    });

    it("should have valid timestamps", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");

      for (const traj of result) {
        const d = new Date(traj.session.startTime);
        expect(d.getTime()).not.toBeNaN();
      }
    });

    it("should extract content from messages", async () => {
      const data = readFileSync(fixturePath);
      const result = await parser.parseBinary(data.buffer as ArrayBuffer, "cursor-state.vscdb");

      const allEvents = result.flatMap((t) => t.events);
      const withContent = allEvents.filter((e) => e.content && e.content.length > 10);
      expect(withContent.length).toBeGreaterThan(0);

      // Check that the binary search content made it through
      const hasBinarySearch = allEvents.some((e) => e.content?.includes("binary_search") || e.content?.includes("binary search"));
      expect(hasBinarySearch).toBe(true);
    });
  });
});
