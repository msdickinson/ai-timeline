/**
 * Raw JSON View — tree-based data inspector for debugging.
 * Collapsible nodes, search filter, copy button, syntax highlighting.
 */

import { Trajectory, TrajectoryEvent } from "../common/types";
import { TrajectoryView, ViewOptions } from "../common/registry";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** Syntax-highlight a JSON string (already escaped) */
function highlightJson(json: string): string {
  return esc(json)
    .replace(/"([^"]+)":/g, '<span class="rw-key">"$1"</span>:')
    .replace(/: "((?:[^"\\]|\\.)*)"/g, ': <span class="rw-str">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="rw-num">$1</span>')
    .replace(/: (true|false)/g, ': <span class="rw-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="rw-null">$1</span>');
}

function copyText(text: string, btn: HTMLElement): void {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1200);
  }).catch(() => {});
}

export const rawView: TrajectoryView = {
  id: "raw",
  name: "Raw JSON",
  description: "Tree-based data inspector with collapsible nodes, search, copy, and syntax highlighting",
  icon: "{",
  tier: "advanced",

  css: `
.rw-empty { padding: 40px; text-align: center; color: var(--tv-text-muted, #888); }
.rw-search { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
.rw-search input { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--tv-border, #333); background: var(--tv-card-bg, #1a1a2e); color: var(--tv-text, #e0e0e0); font-size: 13px; font-family: inherit; outline: none; }
.rw-search input:focus { border-color: var(--tv-accent, #4f8ff7); }
.rw-search-count { font-size: 12px; color: var(--tv-text-muted, #888); white-space: nowrap; }
.rw-tree { font-family: var(--tv-mono, 'Fira Code', 'Cascadia Code', monospace); font-size: 12px; line-height: 1.5; }
.rw-node { margin-left: 16px; }
.rw-node-root { margin-left: 0; }
.rw-header { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; cursor: pointer; user-select: none; }
.rw-header:hover { background: var(--tv-hover, rgba(255,255,255,0.04)); }
.rw-toggle { width: 16px; text-align: center; color: var(--tv-text-muted, #666); font-size: 10px; flex-shrink: 0; }
.rw-label { font-weight: 600; color: var(--tv-accent, #4f8ff7); }
.rw-preview { color: var(--tv-text-muted, #666); margin-left: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 500px; }
.rw-copy-btn { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--tv-border, #333); background: transparent; color: var(--tv-text-muted, #888); font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.15s; }
.rw-header:hover .rw-copy-btn { opacity: 1; }
.rw-copy-btn:hover { background: var(--tv-border, #333); color: var(--tv-text, #e0e0e0); }
.rw-content { display: none; }
.rw-content.rw-open { display: block; }
.rw-json { background: var(--tv-card-bg, #0d0d1a); border-radius: 6px; padding: 12px; margin: 4px 0 8px 22px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; border: 1px solid var(--tv-border, #222); }
.rw-key { color: #9f7aea; }
.rw-str { color: #48bb78; }
.rw-num { color: #ed8936; }
.rw-bool { color: #4f8ff7; }
.rw-null { color: #fc8181; }
.rw-hidden { display: none; }
.rw-match { background: rgba(237, 137, 54, 0.25); border-radius: 2px; }
`,

  render(container: HTMLElement, trajectories: Trajectory[], _options: ViewOptions): void {
    if (trajectories.length === 0) {
      const msg = el("p", "rw-empty");
      msg.textContent = "No sessions selected";
      container.appendChild(msg);
      return;
    }

    // Search box
    const searchBar = el("div", "rw-search");
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search events by content...";
    searchBar.appendChild(searchInput);
    const countLabel = el("span", "rw-search-count");
    searchBar.appendChild(countLabel);
    container.appendChild(searchBar);

    const tree = el("div", "rw-tree");
    const allEventNodes: Array<{ node: HTMLElement; json: string }> = [];

    for (let si = 0; si < trajectories.length; si++) {
      const traj = trajectories[si];
      const sessionNode = buildNode(
        `Session ${si + 1}: ${traj.session.id}`,
        () => JSON.stringify(traj.session, null, 2),
        true
      );
      sessionNode.classList.add("rw-node-root");
      tree.appendChild(sessionNode);

      // Summary node
      if (traj.summary) {
        const summaryNode = buildNode("Summary", () => JSON.stringify(traj.summary, null, 2));
        sessionNode.querySelector(".rw-content")!.appendChild(summaryNode);
      }

      // Events container
      const eventsLabel = `Events (${traj.events.length})`;
      const eventsNode = buildNode(eventsLabel, null);
      const eventsContent = eventsNode.querySelector(".rw-content")!;

      for (const event of traj.events) {
        const evLabel = `#${event.id} [${event.type}] ${event.toolCall?.name ?? event.role ?? ""}`;
        const evJson = JSON.stringify(event, null, 2);
        const evNode = buildNode(evLabel, () => evJson);
        allEventNodes.push({ node: evNode, json: evJson.toLowerCase() });
        eventsContent.appendChild(evNode);
      }

      sessionNode.querySelector(".rw-content")!.appendChild(eventsNode);
    }

    container.appendChild(tree);

    // Search handler
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      let matched = 0;

      for (const { node, json } of allEventNodes) {
        if (!query) {
          node.classList.remove("rw-hidden");
          matched++;
        } else if (json.includes(query)) {
          node.classList.remove("rw-hidden");
          matched++;
        } else {
          node.classList.add("rw-hidden");
        }
      }

      countLabel.textContent = query ? `${matched}/${allEventNodes.length} events` : "";
    });
  },
};

function buildNode(label: string, getJson: (() => string) | null, startOpen?: boolean): HTMLElement {
  const node = el("div", "rw-node");

  const header = el("div", "rw-header");
  const toggle = el("span", "rw-toggle");
  toggle.textContent = startOpen ? "\u25BC" : "\u25B6";
  header.appendChild(toggle);

  const labelEl = el("span", "rw-label");
  labelEl.textContent = label;
  header.appendChild(labelEl);

  if (getJson) {
    const preview = el("span", "rw-preview");
    // Show a short preview of the JSON
    try {
      const raw = getJson();
      preview.textContent = raw.length > 80 ? raw.slice(0, 80).replace(/\n/g, " ") + "..." : raw.replace(/\n/g, " ");
    } catch { preview.textContent = ""; }
    header.appendChild(preview);
  }

  const copyBtn = el("button", "rw-copy-btn") as HTMLButtonElement;
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const text = getJson ? getJson() : label;
    copyText(text, copyBtn);
  });
  header.appendChild(copyBtn);

  const content = el("div", `rw-content${startOpen ? " rw-open" : ""}`);

  if (getJson) {
    const jsonBlock = el("div", "rw-json");
    let loaded = false;

    const loadJson = () => {
      if (loaded) return;
      loaded = true;
      jsonBlock.innerHTML = highlightJson(getJson());
    };

    if (startOpen) loadJson();
    content.appendChild(jsonBlock);

    header.addEventListener("click", () => {
      const open = content.classList.toggle("rw-open");
      toggle.textContent = open ? "\u25BC" : "\u25B6";
      if (open) loadJson();
    });
  } else {
    header.addEventListener("click", () => {
      const open = content.classList.toggle("rw-open");
      toggle.textContent = open ? "\u25BC" : "\u25B6";
    });
  }

  node.appendChild(header);
  node.appendChild(content);
  return node;
}
