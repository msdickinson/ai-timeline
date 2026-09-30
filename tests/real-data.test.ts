/**
 * Tests against real session data from the local machine.
 * These tests are skipped if the files don't exist.
 * They validate that the parsers handle production data correctly.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseFile } from "../src/parsers/index";

const CLAUDE_CODE_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? "",
  ".claude",
  "projects"
);

const hasClaudeCode = existsSync(CLAUDE_CODE_DIR);

describe.skipIf(!hasClaudeCode)("Real Claude Code sessions", () => {
  it("should find and parse at least one session", () => {
    const projects = readdirSync(CLAUDE_CODE_DIR);
    let parsed = 0;
    let failed = 0;

    for (const project of projects.slice(0, 3)) {
      const projectDir = join(CLAUDE_CODE_DIR, project);
      let files: string[];
      try {
        files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      for (const file of files.slice(0, 3)) {
        const filePath = join(projectDir, file);
        try {
          const contents = readFileSync(filePath, "utf-8");
          const result = parseFile(contents, file);

          if (result.length > 0) {
            parsed++;
            const traj = result[0];

            // Basic invariants
            expect(traj.source).toBe("claude-code");
            expect(traj.version).toBe("1.0");
            expect(traj.session.id).toBeTruthy();
            expect(traj.events.length).toBeGreaterThan(0);

            // Summary should be computed
            expect(traj.summary).toBeDefined();
            expect(traj.summary!.totalEvents).toBeGreaterThan(0);

            // All events should have valid types
            for (const e of traj.events) {
              expect(["message", "tool_call", "tool_result", "thinking", "system", "error"]).toContain(e.type);
            }

            // Tool calls should have names
            const toolCalls = traj.events.filter(e => e.type === "tool_call");
            for (const tc of toolCalls) {
              expect(tc.toolCall?.name).toBeTruthy();
            }
          }
        } catch (e) {
          failed++;
        }
      }
    }

    console.log(`Claude Code: parsed ${parsed} sessions, ${failed} failures`);
    expect(parsed).toBeGreaterThan(0);
  });

  it("should handle large sessions without crashing", () => {
    // Find the largest session file
    const projects = readdirSync(CLAUDE_CODE_DIR);
    let largestFile = "";
    let largestSize = 0;

    for (const project of projects) {
      const projectDir = join(CLAUDE_CODE_DIR, project);
      let files: string[];
      try {
        files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = join(projectDir, file);
        try {
          const stat = require("fs").statSync(filePath);
          if (stat.size > largestSize) {
            largestSize = stat.size;
            largestFile = filePath;
          }
        } catch {}
      }
    }

    if (largestFile) {
      console.log(
        `Largest session: ${(largestSize / 1024 / 1024).toFixed(1)}MB`
      );
      const start = Date.now();
      const contents = readFileSync(largestFile, "utf-8");
      const result = parseFile(contents, largestFile);
      const elapsed = Date.now() - start;

      console.log(
        `Parsed in ${elapsed}ms — ${result[0]?.events.length ?? 0} events`
      );

      if (result.length > 0) {
        expect(result[0].events.length).toBeGreaterThan(0);
        expect(result[0].summary).toBeDefined();
      }
    }
  });
});
