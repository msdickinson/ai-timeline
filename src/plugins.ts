/**
 * Plugin Manifest — the single file that loads all parsers and views.
 *
 * To add a new parser: import it and call registerParser().
 * To add a new view: import it and call registerView().
 *
 * That's it. The app discovers everything through the registry.
 */

import { registerParser, registerView } from "./common/registry";

// ── Parsers ─────────────────────────────────────────────────────────────
// Each parser is a drop-in. Add a line here to support a new format.

import { ClaudeCodeParser } from "./parsers/claude-code";
import { OpenHandsParser } from "./parsers/openhands";
import { SweAgentParser } from "./parsers/swe-agent";
import { ClineParser } from "./parsers/cline";
import { ContinueDevParser } from "./parsers/continue-dev";
import { AiderParser } from "./parsers/aider";
import { CodexCliParser } from "./parsers/codex-cli";
import { CopilotChatParser } from "./parsers/copilot-chat";
import { AmazonQParser } from "./parsers/amazon-q";
import { VSCodeSqliteParser } from "./parsers/vscode-sqlite";
import { VettParser } from "./parsers/vett";

// Order matters: most specific first.
// VettParser handles three formats (aggregate JSON, legacy trace JSONL, and
// the 2026-04-25+ CS3 LiveSink event-stream JSONL). Sniffs by content keys,
// so order doesn't matter much, but most-specific-first keeps the convention.
registerParser(new VettParser());
registerParser(new OpenHandsParser());
registerParser(new AmazonQParser());
registerParser(new ContinueDevParser());
registerParser(new CodexCliParser());
registerParser(new CopilotChatParser());
registerParser(new ClineParser());
registerParser(new SweAgentParser());
registerParser(new AiderParser());
registerParser(new VSCodeSqliteParser());
registerParser(new ClaudeCodeParser());

// ── Live Data Sources ────────────────────────────────────────────────
// Each source self-registers on import. They feed Trajectory updates into
// the same renderer the file parsers do — the views don't care where the
// data came from.
import "./sources";

// ── Views ─────────────────────────────────────────────────────────────

// Core views — always visible in tab bar (3 tabs: the essentials)
import { ganttView } from "./views/gantt";
import { dashboardV2View } from "./views/dashboard-v2";
import { dashboardV3View } from "./views/dashboard-v3";
import { tableV2View } from "./views/table-v2";

// Standard views — in "More" dropdown
import { aiCallsView } from "./views/ai-calls";
import { toolUsageView } from "./views/tool-usage";
import { conversationView } from "./views/conversation";
import { diffView } from "./views/diff";
import { errorsView } from "./views/errors";
// findingsView is intentionally NOT imported. The implementation is
// half-built; we don't want users finding it via Settings. The file
// stays on disk so we can finish it later, but it's invisible at
// runtime.

// Standard — also in "More" dropdown
import { costView } from "./views/cost";

// Prototype tools — half-baked / unrefined views kept on disk so we can
// pick them up later, but NOT registered with the UI. They don't show up
// in tabs, in the More dropdown, or in Settings → View Plugins. To bring
// one back, uncomment its import + registerView() line below and (if
// it's not already) bump its tier to "standard" or "core" in its own
// source file.
//
// Why kept around: each took real effort to build and several have
// kernels that work — we just haven't decided which ones earn permanent
// real estate. Test Results in particular is paused until we have a real
// test-output integration story.
//
// import { contextUsageView } from "./views/context-usage";
// import { fileImpactView } from "./views/file-impact";
// import { heatmapView } from "./views/heatmap";
// import { iterationAnalysisView } from "./views/iteration-analysis";
// import { rawView } from "./views/raw";
// import { strategyView } from "./views/strategy";
// import { summaryView } from "./views/summary";
// import { testResultsView } from "./views/test-results";
// import { timelineCompactView } from "./views/timeline-compact";
// import { tokenEfficiencyView } from "./views/token-efficiency";
// import { tokenFlowView } from "./views/token-flow";
// import { toolPatternsView } from "./views/tool-patterns";

// Core — always in tab bar
registerView(dashboardV2View);
registerView(dashboardV3View);
registerView(ganttView);
registerView(tableV2View);

// Standard — in "More" dropdown
registerView(aiCallsView);
registerView(toolUsageView);
registerView(conversationView);
registerView(diffView);
registerView(errorsView);
registerView(costView);

// (No advanced views registered — see "Prototype tools" comment block above.)
