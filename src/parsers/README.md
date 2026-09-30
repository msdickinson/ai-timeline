# Parsers

Each file parses one AI coding tool's session format into the common `Trajectory` type. To add a new parser:

1. Create `my-tool.ts` in this folder
2. Register it in [`../plugins.ts`](../plugins.ts) — one import, one `registerParser()` call
3. Add a test fixture in [`../../tests/fixtures/`](../../tests/fixtures/)

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the full template and guidelines.
