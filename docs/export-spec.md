# Export Feature Specification

## Overview

Two user personas:
- **Producer**: Runs benchmarks, selects sessions, configures the export, shares
- **Consumer**: Opens the exported HTML, explores data, can re-export subsets

## Export Configuration (Producer)

When the Producer clicks Export, they get a config modal:

### Session Selection
- Checkboxes for which sessions to include
- Select All / Deselect All
- Filter by source, model, date range

### Benchmark Metadata (Optional)
- **Benchmark name** — e.g., "SWE-bench Verified Q2 2026"
- **Harness** — e.g., "OpenHands", "SWE-Agent", "Aider"
- **Per-session results** — pass/fail/error status, mapped to verification results
- **Instance mapping** — tie session IDs to benchmark instance IDs (e.g., "django__django-15277")
- **Notes** — freeform text per session or for the overall export

### Visual Configuration
- **Which views to include** — checkboxes for Dashboard, Gantt, AI Calls, Tools, Table
- **Sidebar** — include or exclude (if excluded, all sessions are loaded by default)
- **Dark/Light mode** — force one or let consumer toggle
- **Title** — editable, default "AI Timeline"
- **Logo** — upload custom image (base64 embedded)
- **About/attribution** — optional text, link to repo

### Export Format
- **Self-contained HTML** — single file, everything embedded
  - JS bundle (minified)
  - CSS
  - Session data as embedded JSON
  - Custom logo as base64
  - No external dependencies, no network requests

## Consumer Experience

When someone opens the exported HTML:
- Sees the configured title + logo
- Sessions are pre-loaded (no folder picker)
- Available views are what the Producer selected
- Sidebar present or absent per config
- Can search, sort, filter, zoom, playback — full interactivity
- **Can re-export**: select subset of sessions, export again as HTML or JSON/CSV
- Dark/Light toggle (unless forced by Producer)
- Settings may be hidden or simplified (no file watching, no source management)

## Size Budget

| Component | Size |
|-----------|------|
| JS bundle | ~96KB (26KB gzipped) |
| CSS | ~20KB (4KB gzipped) |
| Per session (typical) | 0.5-3MB JSON |
| 5 sessions | ~5-16MB total HTML |
| 20 sessions | ~20-60MB total HTML |

Acceptable for sharing. GitHub can render files up to 10MB in browser; larger files need raw download.

## Benchmark Integration

For harnesses that run N instances:

### Benchmark Run Model
```typescript
interface BenchmarkRun {
  name: string;           // "SWE-bench Verified Run 1074"
  harness: string;        // "OpenHands" | "SWE-Agent" | "Aider"
  date: string;           // ISO date
  config?: Record<string, unknown>; // model, temperature, etc.
  instances: BenchmarkInstance[];
}

interface BenchmarkInstance {
  instanceId: string;     // "django__django-15277"
  sessionId: string;      // maps to Trajectory.session.id
  status: "passed" | "failed" | "error" | "timeout" | "running";
  verificationLog?: string;
  patchApplied?: boolean;
  notes?: string;
}
```

### How it appears in the UI
- Dashboard shows pass/fail rate, per-instance table with status badges
- Gantt shows instance ID as swimlane group header (like a benchmark harness's per-instance tabs)
- Filter by status: All | Passed | Failed | Error
- Click instance → see that session's full trajectory

## Implementation Plan

1. **Benchmark metadata model** — add to common types
2. **Export config modal** — UI for selecting sessions, views, branding
3. **HTML builder** — generates self-contained HTML with embedded data
4. **Consumer mode** — detect embedded data on load, skip file picker
5. **Re-export from consumer** — same export flow but starting from embedded data
