/**
 * VettLiveDataSource — connects to a running `vett run --live-port N` and
 * pushes trajectory updates into the viewer in real time.
 *
 * VETT exposes a Server-Sent Events stream at http://host:port/events. Each
 * frame is one envelope:
 *   { seq, ts, type, instance_id, data }
 *
 * The existing VettParser already knows how to turn an envelope stream into
 * Trajectory objects (one per instance_id). To stay DRY, we accumulate the
 * received envelopes as JSONL text and re-run the parser on every debounced
 * batch. That's O(N) per batch in the total event count — fine for typical
 * 25-instance / 500-iter runs (a few thousand events), would want incremental
 * builds for very long runs.
 *
 * Reconnect on transient drops; surface persistent failures via onError.
 */

import { parseFile, registerDataSource } from "../common/registry";
import type {
  DataSource,
  DataSourceCallbacks,
  DataSourceConfig,
  DataSourcePhase,
} from "../common/registry";
import { Trajectory } from "../common/types";

interface VettLiveConfig extends DataSourceConfig {
  /** Hostname or IP of the box running vett (e.g. "localhost"). */
  host?: string;
  /** Port passed to `vett run --live-port`. */
  port?: number;
  /** Override full URL (skips host/port). Use this for proxied setups. */
  url?: string;
}

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 5151;
/** Debounce window: re-parse + emit at most every this many ms.
 * Calibrated for "feels live without flicker" — 750ms is fast enough that
 * a tool call landing as you watch is visible within ~1s, but slow enough
 * that bursty event streams don't trigger render storms. */
const DEBOUNCE_MS = 750;
/** After this many consecutive reconnect attempts with NO successful event
 * landing, treat the stream as ended (don't keep auto-retrying forever). */
const MAX_RECONNECT_ATTEMPTS_BEFORE_ENDED = 3;
/** A `/healthz` probe that fails this many times in a row → declare ended. */
const HEALTHZ_FAIL_THRESHOLD = 2;

export class VettLiveDataSource implements DataSource {
  id = "vett-live";
  name = "VETT (live)";
  description =
    "Connect to a running `vett run --live-port N` over Server-Sent Events. " +
    "Trajectories appear and update as instances execute.";
  supportsLive = true;

  private es: EventSource | null = null;
  private callbacks: DataSourceCallbacks | null = null;
  private url = "";
  private host = "";
  private port = 0;
  /** Accumulated JSONL — one envelope per line. Re-parsed on each batch. */
  private buffer = "";
  private eventCount = 0;
  private debounceTimer: number | null = null;
  private stopped = false;
  /** Lifecycle state for the banner. Updated alongside onStatus calls. */
  private phase: DataSourcePhase = "connecting";
  /** How many times in a row onerror fired without an intervening onmessage. */
  private consecutiveErrors = 0;
  /** Healthz probe state for confirming "stream really ended" vs just slow. */
  private healthzFailCount = 0;
  private healthzTimer: number | null = null;

  start(config: VettLiveConfig, callbacks: DataSourceCallbacks): void {
    this.callbacks = callbacks;
    this.stopped = false;
    this.buffer = "";
    this.eventCount = 0;
    this.consecutiveErrors = 0;
    this.healthzFailCount = 0;

    this.host = config.host || DEFAULT_HOST;
    this.port = config.port || DEFAULT_PORT;
    this.url = resolveUrl(config);
    this.setPhase("connecting", `Connecting to ${this.url}…`);

    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.healthzTimer !== null) {
      clearTimeout(this.healthzTimer);
      this.healthzTimer = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.callbacks?.onStatus("Disconnected.", "ended");
  }

  private setPhase(phase: DataSourcePhase, message: string) {
    this.phase = phase;
    this.callbacks?.onStatus(message, phase);
  }

  renderConfig(container: HTMLElement): void {
    // Pre-fill from the last successful connection — almost always what the
    // user wants. The explicit `DEFAULT_HOST = "localhost"` is only correct
    // when VETT is running on the same box as the browser (the rare case);
    // VETT often runs on a separate machine.
    let host = DEFAULT_HOST;
    let port = DEFAULT_PORT;
    try {
      const savedHost = localStorage.getItem("tv-live-vett-host");
      const savedPort = localStorage.getItem("tv-live-vett-port");
      if (savedHost) host = savedHost;
      if (savedPort && Number(savedPort) > 0) port = Number(savedPort);
    } catch { /* ignore storage errors */ }

    container.innerHTML = `
      <div class="tv-live-config">
        <label>Host
          <input type="text" id="vett-live-host" value="${escapeHtml(host)}" placeholder="localhost">
        </label>
        <label>Port
          <input type="number" id="vett-live-port" value="${port}" min="1" max="65535">
        </label>
        <p class="tv-hint">
          Run <code>vett run … --live-port ${port}</code> on the host machine,
          then enter that host:port here. Stream is at
          <code>http://&lt;host&gt;:&lt;port&gt;/events</code>.
        </p>
      </div>
    `;
  }

  /** Read user input from the rendered config UI. Returns the prepared config. */
  collectConfig(container: HTMLElement): VettLiveConfig {
    const hostEl = container.querySelector<HTMLInputElement>("#vett-live-host");
    const portEl = container.querySelector<HTMLInputElement>("#vett-live-port");
    return {
      host: hostEl?.value.trim() || DEFAULT_HOST,
      port: portEl ? Number(portEl.value) : DEFAULT_PORT,
    };
  }

  private connect(): void {
    if (this.stopped) return;
    try {
      this.es = new EventSource(this.url);
    } catch (err) {
      this.callbacks?.onError(`Failed to open EventSource: ${err}`);
      return;
    }

    this.es.onopen = () => {
      // Successful (re)connection — reset error counters. Don't flip to
      // "live" yet; wait for an actual event to land. (A server can be
      // accepting connections while having no data to send.)
      this.consecutiveErrors = 0;
      this.healthzFailCount = 0;
      if (this.phase === "reconnecting") {
        this.setPhase("connecting", `Reconnected to ${this.url} — waiting for events…`);
      }
    };

    this.es.onmessage = (ev) => {
      // Each VETT SSE frame is "data: <json>\n\n". EventSource gives us the
      // unprefixed JSON in ev.data.
      const line = (ev.data ?? "").trim();
      if (!line) return;
      // Validate it's parsable JSON before buffering — drop garbage early.
      try {
        JSON.parse(line);
      } catch {
        return;
      }
      this.buffer += line + "\n";
      this.eventCount++;
      this.consecutiveErrors = 0;
      this.healthzFailCount = 0;
      // First event after (re)connection — promote phase to live.
      if (this.phase !== "live") {
        this.setPhase(
          "live",
          `Live · ${this.host}:${this.port} · ${this.eventCount} events`
        );
      }
      this.scheduleEmit();
    };

    this.es.onerror = () => {
      // EventSource auto-retries roughly every 3-5s. We track consecutive
      // errors to distinguish a transient drop from a stream that has
      // really ended (smoke run finished, server gone).
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= MAX_RECONNECT_ATTEMPTS_BEFORE_ENDED) {
        // Probe /healthz once. If it succeeds, server is up but we're
        // having trouble — keep reconnecting. If it fails too, the server
        // is gone — declare ended and stop trying.
        this.probeHealthzAndMaybeEnd();
        this.setPhase(
          "reconnecting",
          `Lost connection · trying to reach ${this.host}:${this.port} · ${this.eventCount} events received`
        );
      } else {
        this.setPhase(
          "reconnecting",
          `Reconnecting to ${this.host}:${this.port}… · ${this.eventCount} events received`
        );
      }
    };
  }

  /**
   * Confirm-or-end heuristic. After several consecutive EventSource errors,
   * actively probe /healthz. Two failures → stream ended. One success →
   * keep retrying (the server is alive, the SSE just hiccupped).
   */
  private probeHealthzAndMaybeEnd(): void {
    if (this.healthzTimer !== null) return; // probe already pending
    this.healthzTimer = window.setTimeout(async () => {
      this.healthzTimer = null;
      if (this.stopped) return;

      const ok = await this.probeHealthz();
      if (ok) {
        this.healthzFailCount = 0;
        return; // server alive; let EventSource keep retrying
      }
      this.healthzFailCount++;
      if (this.healthzFailCount >= HEALTHZ_FAIL_THRESHOLD) {
        // Server gone. Close the EventSource so the browser stops retrying.
        if (this.es) {
          this.es.close();
          this.es = null;
        }
        this.setPhase(
          "ended",
          `Stream ended · ${this.eventCount} events received`
        );
      } else {
        // One failure — schedule another probe.
        this.probeHealthzAndMaybeEnd();
      }
    }, 1500);
  }

  private async probeHealthz(): Promise<boolean> {
    try {
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 1500);
      const res = await fetch(`http://${this.host}:${this.port}/healthz`, {
        signal: ac.signal,
        mode: "cors",
      });
      window.clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Manual reconnect from the UI when the stream was declared ended. */
  reconnect(): void {
    if (!this.callbacks) return;
    this.consecutiveErrors = 0;
    this.healthzFailCount = 0;
    this.setPhase("connecting", `Reconnecting to ${this.url}…`);
    this.connect();
  }

  private scheduleEmit(): void {
    if (this.debounceTimer !== null) return;
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.emit();
    }, DEBOUNCE_MS);
  }

  /** Re-parse the accumulated buffer and push the resulting trajectories. */
  private emit(): void {
    if (this.stopped) return;
    if (!this.callbacks) return;
    if (this.buffer.length === 0) return;

    let trajectories: Trajectory[] = [];
    try {
      // We name it events.jsonl so the VettParser sniffs it as the LiveSink
      // format and uses parseLiveSinkJsonl.
      trajectories = parseFile(this.buffer, "events.jsonl");
    } catch (err) {
      this.callbacks.onError(`Parse failure: ${err}`);
      return;
    }

    this.callbacks.onData(trajectories);
    if (this.phase === "live") {
      this.callbacks.onStatus(
        `Live · ${this.host}:${this.port} · ${this.eventCount} events · ${trajectories.length} instance(s)`,
        "live"
      );
    }
  }
}

function resolveUrl(config: VettLiveConfig): string {
  if (config.url && config.url.length > 0) {
    return rstrip(config.url, "/") + "/events";
  }
  const host = config.host || DEFAULT_HOST;
  const port = config.port || DEFAULT_PORT;
  return `http://${host}:${port}/events`;
}

function rstrip(s: string, ch: string): string {
  while (s.endsWith(ch)) s = s.slice(0, -ch.length);
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
    : c === "<" ? "&lt;"
    : c === ">" ? "&gt;"
    : c === '"' ? "&quot;"
    : "&#39;"
  );
}

// Auto-register on module import so plugins.ts only needs `import "..."`.
registerDataSource(new VettLiveDataSource());
