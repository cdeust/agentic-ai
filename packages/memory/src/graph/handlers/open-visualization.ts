/**
 * open-visualization.ts — schema + stub for the open_visualization handler.
 *
 * Port of: mcp_server/handlers/open_visualization.py
 *
 * The Python handler launches an HTTP server and opens a browser tab
 * (subprocess.run, os.kill, urllib.request). These operations require
 * a Python process and OS-level APIs not available in the Node.js
 * MCP plugin runtime that this TS package targets.
 *
 * This file ports:
 *   - The MCP schema (input/output shape) verbatim.
 *   - A typed handler stub that returns a structured error explaining the
 *     runtime mismatch, so callers receive a useful message rather than
 *     a silent failure.
 *
 * When the TS runtime gains subprocess/browser-launch capabilities, replace
 * openVisualizationHandler with the full implementation.
 *
 * source: cortex@ed33435 mcp_server/handlers/open_visualization.py
 */

// ── Schema ────────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/open_visualization.py schema

export const schema = {
  title: "Open visualization",
  description:
    "Open the bundled Cortex visualization in the user's default browser — " +
    "a force-directed neural graph combining methodology profiles, memory nodes, " +
    "and the knowledge graph, plus the Wiki, Atlas, Emotion, Board, Pipeline, " +
    "and Knowledge views. Starts the local HTTP server on 127.0.0.1:3458 if not " +
    "already running and auto-shuts-down after 10 minutes of idle. Use this for " +
    "visual exploration, screenshots, or presenting Cortex state. " +
    "Distinct from `get_methodology_graph` (returns JSON, no browser launched) " +
    "and `list_domains` (text overview, no graph). " +
    "Side effects: spawns an HTTP server process and opens a browser tab.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      domain: {
        type: "string",
        description:
          "Restrict the initial graph view to a single cognitive domain. " +
          "Omit to show the full graph (all domains visible).",
        examples: ["cortex", "auth-service"],
      },
    },
  },
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpenVisualizationArgs {
  domain?: string;
}

export interface OpenVisualizationResult {
  url: string | null;
  message: string;
  dev_source: string | null;
  runtime?: string;
}

// ── Handler stub ──────────────────────────────────────────────────────────────

/**
 * Open visualization — TS runtime stub.
 *
 * The Python handler spawns an HTTP server (http_launcher.py) and opens
 * a browser tab via subprocess/urllib. These capabilities are not available
 * in the Node.js MCP plugin runtime.
 *
 * Returns a structured message directing the user to invoke the Python
 * MCP plugin for visualization, or to navigate to 127.0.0.1:3458 manually
 * if they have already started the server.
 *
 * source: cortex@ed33435 mcp_server/handlers/open_visualization.py:handler
 */
export async function openVisualizationHandler(
  args: OpenVisualizationArgs | null | undefined,
): Promise<OpenVisualizationResult> {
  const domain = args?.domain ?? "";
  const url = domain
    ? `http://127.0.0.1:3458/?domain=${encodeURIComponent(domain)}`
    : "http://127.0.0.1:3458/";

  return {
    url,
    message:
      "Visualization requires the Python MCP plugin runtime. " +
      "If the Cortex HTTP server is already running, navigate to: " +
      url +
      ". Otherwise, start the server via `cortex-visualize` in the Python plugin.",
    dev_source: null,
    runtime: "ts-stub", // source: this file — marks the stub boundary for future full port
  };
}
