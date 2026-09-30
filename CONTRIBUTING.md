# Contributing to AI Timeline

AI Timeline uses a plugin architecture. The two most common contributions are **parsers** (support a new AI coding tool) and **views** (new way to visualize data).

## Setup

```bash
git clone https://github.com/YourUsername/ai-timeline.git
cd ai-timeline
npm install
npm run dev    # http://localhost:5173
npm test       # 1000+ tests
```

## Adding a Parser

A parser reads session files from an AI tool and converts them to AI Timeline's common format.

**1. Create the parser** (`src/parsers/my-tool.ts`):

```typescript
import { Trajectory, TrajectoryParser, computeSummary, safeTimestamp } from "../common/types";

export class MyToolParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    // Return true if this file is your tool's format
    return filename.endsWith(".mytool");
  }

  parse(contents: string, filename: string): Trajectory[] {
    const data = JSON.parse(contents);
    const events = []; // ... map your format to TrajectoryEvent[]

    return [{
      version: "1.0",
      source: "my-tool",
      session: { id: "...", startTime: safeTimestamp(data.timestamp) },
      events,
      summary: computeSummary(events),
    }];
  }
}
```

**2. Register it** in `src/plugins.ts`:

```typescript
import { MyToolParser } from "./parsers/my-tool";
registerParser(new MyToolParser());
```

**3. Add a test fixture** (`tests/fixtures/my-tool-session.json`) — a small real or realistic sample file.

**4. Add tests** (`tests/parsers/my-tool.test.ts`):

```typescript
import { MyToolParser } from "../../src/parsers/my-tool";
const parser = new MyToolParser();
const fixture = readFileSync("tests/fixtures/my-tool-session.json", "utf-8");

describe("MyToolParser", () => {
  it("should detect the format", () => {
    expect(parser.canParse("session.mytool")).toBe(true);
  });
  it("should parse", () => {
    const result = parser.parse(fixture, "session.mytool");
    expect(result.length).toBeGreaterThan(0);
  });
});
```

**5. Run tests**: `npm test`

### Parser guidelines

- Use `safeTimestamp()` for all timestamp conversions (handles null, NaN, invalid dates)
- Add `if (!item || typeof item !== "object") continue;` when iterating arrays from user data
- Set `source` to your tool name (add it to the union type in `types.ts`)
- Escape nothing — parsers produce data objects, not HTML

## Adding a View

Views render trajectory data. Each is a self-contained plugin.

**1. Create the view** (`src/views/my-view.ts`):

```typescript
import { Trajectory } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

export const myView: TrajectoryView = {
  id: "my-view",
  name: "My View",
  description: "What this view shows",
  icon: "M",
  tier: "standard", // "core" | "standard" | "advanced"

  render(container, trajectories, options) {
    // Build DOM, append to container
  },
};
```

**2. Register it** in `src/plugins.ts`:

```typescript
import { myView } from "./views/my-view";
registerView(myView);
```

### View guidelines

- Handle `trajectories = []` gracefully (show a message)
- Handle missing data (no tokens, no tools) — show "no data" message
- Use `textContent` for user data, not `innerHTML`
- Add `requires: ["tokens"]` if the view needs specific data
- Set `tier` to control default visibility

## Testing

```bash
npm test              # All tests
npm run test:watch    # Watch mode
```

Every parser needs fixture + tests. Every view is tested by the render safety suite (renders without crashing across 5 data scenarios).

## Code Style

- TypeScript strict mode
- No runtime dependencies except sql.js (lazy-loaded for SQLite)
- CSS via inline `css` property on views (scoped, removed on view switch)

## Questions?

Open an issue on GitHub.
