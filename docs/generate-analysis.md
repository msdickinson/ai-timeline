# Generating Session Analysis

AI Timeline displays analysis — it doesn't generate it. The analysis comes from running your trajectories through any LLM. Here's how.

## Quick Start (2 minutes)

Pipe any trajectory file through Claude Code with this system prompt:

```bash
claude -p "$(cat <<'PROMPT'
Analyze this AI coding session trajectory. Return ONLY valid JSON matching this schema:

{
  "analyzedBy": "your-model-name",
  "analyzedAt": "ISO-8601-timestamp",
  "verdict": "correct | incorrect | partial | inconclusive",
  "confidence": 0.0-1.0,
  "summary": "One sentence: what happened",
  "explanation": "2-3 sentences: why it succeeded or failed",
  "rootCause": "category string if failed (e.g., wrong_file, timeout, tool_misuse, context_overload, incomplete_fix, wrong_scope, tunnel_vision)",
  "failureReasons": ["specific reason 1", "specific reason 2"],
  "strengths": ["what went right"],
  "recommendations": ["what to improve"],
  "tags": ["categorization", "tags"],
  "taskDifficulty": "easy | medium | hard | very_hard",
  "iterationCount": number_of_edit_test_fix_cycles,
  "phaseBreakdown": {
    "exploration": percent,
    "implementation": percent,
    "debugging": percent,
    "verification": percent
  }
}

Focus on: Did it solve the task? If not, why? What patterns do you see?
PROMPT
)" < your-trajectory.jsonl > analysis.json
```

Then add the analysis to your trajectory JSON:

```json
{
  "version": "1.0",
  "source": "openhands",
  "session": { ... },
  "events": [ ... ],
  "analysis": { <-- paste analysis.json content here }
}
```

Load in AI Timeline → the **Findings** view aggregates patterns across sessions.

## Batch Analysis (50+ sessions)

For benchmark runs, script it:

```bash
#!/bin/bash
# analyze-batch.sh — generates analysis for each instance in an OpenHands output.jsonl

INPUT="output.jsonl"
OUTPUT_DIR="analyses"
mkdir -p "$OUTPUT_DIR"

# Split multi-instance JSONL into individual files
i=0
while IFS= read -r line; do
  instance_id=$(echo "$line" | jq -r '.instance_id')
  echo "$line" > "$OUTPUT_DIR/${instance_id}.jsonl"
  ((i++))
done < "$INPUT"

echo "Split $i instances. Now analyzing..."

# Analyze each (use any model — Claude, GPT, local LLM)
for f in "$OUTPUT_DIR"/*.jsonl; do
  instance=$(basename "$f" .jsonl)
  echo "Analyzing $instance..."
  
  claude -p "Analyze this AI coding session. Return JSON with verdict, rootCause, failureReasons, strengths, recommendations, tags, taskDifficulty. Be specific." \
    < "$f" > "$OUTPUT_DIR/${instance}.analysis.json" 2>/dev/null
done

echo "Done. Load trajectories + analyses in AI Timeline."
```

## Using a Local LLM

Any OpenAI-compatible endpoint works:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model",
    "messages": [
      {"role": "system", "content": "Analyze this AI coding session trajectory. Return JSON with: verdict, rootCause, failureReasons, strengths, recommendations, tags."},
      {"role": "user", "content": "'$(cat trajectory.jsonl | head -c 50000)'"}
    ]
  }' | jq '.choices[0].message.content' -r > analysis.json
```

## What the Findings View Shows

When you load sessions with analysis attached, the **Findings** view aggregates:

- **Verdict distribution** — how many correct / incorrect / partial
- **Root cause grouping** — "wrong_scope: 15, tunnel_vision: 8, tool_misuse: 5"
- **Recurring recommendations** — patterns across all sessions
- **Tag cloud** — visual frequency of categorization tags
- **Difficulty breakdown** — pass rate by task difficulty

This is how the blog post found "5 recurring failure patterns across 270 sessions."

## Common Root Cause Categories

From benchmarking experience, these categories cover ~90% of failures:

| Category | Description | Example |
|---|---|---|
| `wrong_scope` | Edited at wrong abstraction level | Patched base class instead of subclass |
| `tunnel_vision` | Stuck on one approach, never pivoted | 15 retries of same regex pattern |
| `tool_misuse` | Used wrong tool or used it inefficiently | grep 10x when cat would show the answer |
| `context_overload` | Lost track after too much output | Correct at turn 8, contradicted at turn 45 |
| `incomplete_fix` | Passed target test, broke others | Fixed auth but broke session handling |
| `wrong_file` | Edited the wrong file | utils.py instead of util_helpers.py |
| `timeout` | Ran out of iterations/time | Hit max 100 turns without submitting |
| `infrastructure` | Docker, build, env issue — not the model | Image didn't build, deps missing |

## SessionAnalysis Schema Reference

Full schema in `src/common/types.ts`. Key fields:

```typescript
interface SessionAnalysis {
  analyzedBy: string;         // "claude-opus-4-6" or "gpt-4o" or "human"
  analyzedAt: string;         // ISO timestamp
  verdict: "correct" | "incorrect" | "partial" | "inconclusive";
  confidence?: number;        // 0-1
  summary: string;            // One line
  explanation: string;        // Why it passed or failed
  rootCause?: string;         // Category from table above
  failureReasons?: string[];  // Specific reasons
  strengths?: string[];       // What went right
  recommendations?: string[]; // What to improve
  tags?: string[];            // For grouping/filtering
  taskDifficulty?: "easy" | "medium" | "hard" | "very_hard";
  iterationCount?: number;    // Edit-test-fix cycles
  phaseBreakdown?: {          // Time allocation
    exploration?: number;     // % of session
    implementation?: number;
    debugging?: number;
    verification?: number;
  };
}
```
