import {
  Trajectory,
  TrajectoryEvent,
  TrajectoryParser,
  computeSummary,
  safeTimestamp,
} from "../common/types";

/**
 * Parser for SWE-Agent trajectory files (.traj).
 * Location: trajectories/<run>/<instance_id>.traj
 * Single JSON object per file with a "trajectory" or "history" array.
 *
 * SWE-Agent format has two main variants:
 * 1. Original SWE-Agent: { info: {}, trajectory: [...] }
 * 2. SWE-Agent 2.0: { history: [...], info: {...} }
 *
 * Each trajectory step has: { action, observation, thought, state, ... }
 */

interface SweAgentFile {
  instance_id?: string;
  info?: {
    model_stats?: {
      instance_cost?: number;
      tokens_sent?: number;
      tokens_received?: number;
      api_calls?: number;
    };
    exit_status?: string;
    submission?: string;
    model?: string;
    [key: string]: unknown;
  };
  trajectory?: SweAgentStep[];
  history?: SweAgentStep[];
  [key: string]: unknown;
}

interface SweAgentStep {
  action?: string;
  observation?: string;
  thought?: string;
  response?: string;
  state?: string;
  message?: string;
  role?: string;
  timestamp?: string;
  duration?: number;
  // SWE-Agent 2.0 fields
  tool_calls?: Array<{
    function?: { name?: string; arguments?: string };
    id?: string;
  }>;
  content?: string;
  [key: string]: unknown;
}

export class SweAgentParser implements TrajectoryParser {
  canParse(filename: string, firstLine?: string): boolean {
    // .traj files are always SWE-Agent
    if (filename.endsWith(".traj")) return true;

    // JSON files with trajectory/history + info structure
    if (filename.endsWith(".json") && firstLine) {
      try {
        const obj = JSON.parse(firstLine);
        return (
          (obj.trajectory != null || obj.history != null) &&
          obj.info != null
        );
      } catch {
        // Might be a multi-line JSON — will try full parse
        return false;
      }
    }
    return false;
  }

  parse(contents: string, filename: string): Trajectory[] {
    let data: SweAgentFile;
    try {
      data = JSON.parse(contents);
    } catch {
      return [];
    }

    const steps = data.trajectory ?? data.history ?? [];
    if (!Array.isArray(steps) || steps.length === 0) return [];

    const events: TrajectoryEvent[] = [];
    let eventId = 0;

    // SWE-Agent doesn't always have timestamps — generate synthetic ones
    const baseTime = new Date().toISOString();
    let stepIndex = 0;
    let lastToolCallId = -1; // for v2.0 tool result linking

    for (const step of steps) {
      if (!step || typeof step !== "object") { stepIndex++; continue; }
      const timestamp = safeTimestamp(
        step.timestamp,
        new Date(new Date(baseTime).getTime() + stepIndex * 5000).toISOString()
      );

      // Handle SWE-Agent 2.0 format (role-based messages with tool_calls)
      if (step.role) {
        if (step.role === "system") {
          events.push({
            id: eventId++,
            timestamp,
            type: "system",
            role: "system",
            content: step.content ?? step.message ?? "",
          });
        } else if (step.role === "user") {
          events.push({
            id: eventId++,
            timestamp,
            type: "message",
            role: "user",
            content: step.content ?? step.message ?? "",
          });
        } else if (step.role === "assistant") {
          // Check for tool calls
          if (step.tool_calls && step.tool_calls.length > 0) {
            for (const tc of step.tool_calls) {
              const eid = eventId++;
              lastToolCallId = eid;
              events.push({
                id: eid,
                timestamp,
                type: "tool_call",
                role: "assistant",
                content: step.content ?? step.thought,
                toolCall: {
                  name: tc.function?.name ?? "unknown",
                  arguments: tc.function?.arguments
                    ? tryParseJson(tc.function.arguments)
                    : undefined,
                },
              });
            }
          } else {
            events.push({
              id: eventId++,
              timestamp,
              type: "message",
              role: "assistant",
              content: step.content ?? step.thought ?? step.response ?? "",
            });
          }
        } else if (step.role === "tool") {
          events.push({
            id: eventId++,
            timestamp,
            type: "tool_result",
            role: "environment",
            toolResult: {
              output: (step.content ?? step.observation ?? "").slice(0, 10000),
              isError: false,
              toolCallEventId: lastToolCallId >= 0 ? lastToolCallId : undefined,
            },
          });
          lastToolCallId = -1; // reset after linking
        }
        stepIndex++;
        continue;
      }

      // Handle original SWE-Agent format (action/observation pairs)
      if (step.thought) {
        events.push({
          id: eventId++,
          timestamp,
          type: "thinking",
          role: "assistant",
          content: step.thought,
        });
      }

      if (step.action && typeof step.action === "string") {
        const { toolName, args } = parseAction(step.action);
        const eid = eventId++;
        events.push({
          id: eid,
          timestamp,
          type: "tool_call",
          role: "assistant",
          toolCall: {
            name: toolName,
            arguments: args,
          },
          durationMs: step.duration ? step.duration * 1000 : undefined,
        });

        if (step.observation != null) {
          events.push({
            id: eventId++,
            timestamp: safeTimestamp(
              new Date(timestamp).getTime() + (step.duration ?? 1) * 1000,
              timestamp
            ),
            type: "tool_result",
            role: "environment",
            toolResult: {
              output: step.observation.slice(0, 10000),
              isError:
                step.observation.includes("Error") ||
                step.observation.includes("Traceback"),
              toolCallEventId: eid,
            },
            durationMs: step.duration ? step.duration * 1000 : undefined,
          });
        }
      }

      stepIndex++;
    }

    if (events.length === 0) return [];

    // Extract token info from info.model_stats
    const stats = data.info?.model_stats;
    if (stats) {
      // Add accumulated tokens to first event
      events[0].tokens = {
        input: stats.tokens_sent,
        output: stats.tokens_received,
      };
    }

    const instanceId =
      data.instance_id ??
      filename.replace(/\.traj$/, "").split("/").pop() ??
      "unknown";

    // Derive status from exit_status
    let status: "succeeded" | "failed" | "error" | "timeout" | "unknown" = "unknown";
    const exitStatus = data.info?.exit_status;
    if (exitStatus === "submitted") status = "succeeded";
    else if (exitStatus === "failed" || exitStatus === "exit_error") status = "failed";
    else if (exitStatus === "timeout" || exitStatus === "early_exit") status = "timeout";
    else if (exitStatus === "error") status = "error";

    const trajectory: Trajectory = {
      version: "1.0",
      source: "swe-agent",
      session: {
        id: instanceId,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1]?.timestamp,
        model: data.info?.model,
        status,
        cost: stats?.instance_cost ? { totalUsd: stats.instance_cost } : undefined,
        metadata: {
          instanceId,
          exitStatus,
          hasSubmission: !!data.info?.submission,
          apiCalls: stats?.api_calls,
        },
      },
      events,
    };

    trajectory.summary = computeSummary(events);
    return [trajectory];
  }
}

/** Parse SWE-Agent action string into tool name + args */
function parseAction(action: string): {
  toolName: string;
  args?: Record<string, unknown>;
} {
  // Common patterns:
  // "bash\ncommand here" or "edit <file>\n..."
  const firstLine = action.split("\n")[0].trim();

  if (firstLine.startsWith("bash") || firstLine.startsWith("terminal")) {
    return {
      toolName: "bash",
      args: { command: action.replace(/^(bash|terminal)\s*\n?/, "") },
    };
  }
  if (firstLine.startsWith("edit")) {
    const path = firstLine.replace(/^edit\s+/, "").trim();
    return {
      toolName: "edit",
      args: { path, content: action.split("\n").slice(1).join("\n") },
    };
  }
  if (firstLine.startsWith("open")) {
    return {
      toolName: "open",
      args: { path: firstLine.replace(/^open\s+/, "").trim() },
    };
  }
  if (firstLine.startsWith("search") || firstLine.startsWith("find")) {
    return {
      toolName: "search",
      args: { query: action.replace(/^(search|find)\s*/, "") },
    };
  }
  if (firstLine.startsWith("submit")) {
    return { toolName: "submit" };
  }

  // Unknown — use first word as tool name
  const parts = firstLine.split(/\s+/);
  return {
    toolName: parts[0] || "unknown",
    args:
      parts.length > 1
        ? { raw: action }
        : undefined,
  };
}

function tryParseJson(s: string): Record<string, unknown> | string {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
