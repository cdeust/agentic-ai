/**
 * methodology.ts — MCP tool adapters for the methodology/profiling topic.
 *
 * Tools registered (5):
 *   query_methodology, detect_domain, rebuild_profiles, list_domains,
 *   explore_features
 *
 * Phase 7 Group D — DI wiring: ProfilesStore is now loaded from the filesystem
 * JSON store at ~/.claude/methodology/profiles.json and passed to each handler.
 * No stub paths remain.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §Tier1Core
 * source: packages/memory/src/methodology/handlers/ (all five handlers)
 * source: packages/memory/src/hooks/session-lifecycle.ts (profiles I/O pattern)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProfilesStore } from "@agentic/memory/methodology/types.js";
import { queryMethodology } from "@agentic/memory/methodology/handlers/query-methodology.js";
import { detectDomainHandler } from "@agentic/memory/methodology/handlers/detect-domain.js";
import { rebuildProfiles, checkSkip } from "@agentic/memory/methodology/handlers/rebuild-profiles.js";
import { exploreFeatures } from "@agentic/memory/methodology/handlers/explore-features.js";

// ── Profiles I/O (filesystem adapter) ────────────────────────────────────────
//
// Profiles live at ~/.claude/methodology/profiles.json — the same path the
// Python server writes to. We read them at tool-call time (not at startup) so
// we always return fresh state without a daemon restart.
//
// source: packages/memory/src/hooks/session-lifecycle.ts::loadProfiles (pattern)

function methodologyDir(): string {
  return join(homedir(), ".claude", "methodology");
}

function loadProfiles(): ProfilesStore {
  const profilePath = join(methodologyDir(), "profiles.json");
  if (!existsSync(profilePath)) return { domains: {} };
  try {
    const raw = JSON.parse(readFileSync(profilePath, "utf-8")) as ProfilesStore;
    if (!raw.domains) raw.domains = {};
    return raw;
  } catch {
    return { domains: {} };
  }
}

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerMethodologyTools ──────────────────────────────────────────────────

/**
 * Registers the 5 methodology/profiling MCP tools.
 *
 * precondition:  server is a live McpServer instance.
 * postcondition: 5 tools registered; each body calls the real domain handler.
 *
 * source: MCP_TOOLS.md §"query_methodology", §"detect_domain",
 *         §"rebuild_profiles", §"list_domains", §"explore_features"
 * source: cortex@ed33435 mcp_server/handlers/{query_methodology,detect_domain,
 *         rebuild_profiles,list_domains,explore_features}.py
 */
export function registerMethodologyTools(server: McpServer): void {
  // ── query_methodology ─────────────────────────────────────────────────────
  server.registerTool(
    "query_methodology",
    {
      description:
        "Returns cognitive profile for the current domain (thinking style, entry patterns, blind spots, cross-domain bridges).",
      inputSchema: {
        cwd:           z.string().optional().describe("Current working directory"),
        project:       z.string().optional().describe("Project identifier"),
        first_message: z.string().optional().describe("First message of the session"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/methodology/handlers/query-methodology.ts::queryMethodology
        const profiles = loadProfiles();
        const response = queryMethodology(
          { cwd: args.cwd, project: args.project, firstMessage: args.first_message },
          profiles,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("query_methodology", err);
      }
    },
  );

  // ── detect_domain ─────────────────────────────────────────────────────────
  server.registerTool(
    "detect_domain",
    {
      description:
        "Lightweight domain classification from cwd/project without full profile assembly.",
      inputSchema: {
        cwd:           z.string().optional().describe("Current working directory"),
        project:       z.string().optional().describe("Project identifier"),
        first_message: z.string().optional().describe("First message for hint"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/methodology/handlers/detect-domain.ts::detectDomainHandler
        const profiles = loadProfiles();
        const response = detectDomainHandler(
          { cwd: args.cwd, project: args.project, firstMessage: args.first_message },
          profiles,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("detect_domain", err);
      }
    },
  );

  // ── rebuild_profiles ──────────────────────────────────────────────────────
  server.registerTool(
    "rebuild_profiles",
    {
      description:
        "Full rescan of all session data to rebuild methodology profiles from scratch.",
      inputSchema: {
        domain: z.string().optional().describe("Limit rebuild to a single domain"),
        force:  z.boolean().default(false).describe("Force rebuild even if fresh"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/methodology/handlers/rebuild-profiles.ts::rebuildProfiles
        const existingProfiles = loadProfiles();
        const skipCheck = checkSkip(existingProfiles, args.force);
        if (skipCheck.skip) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            rebuilt: skipCheck.domains ?? [],
            duration_ms: 0,
            skipped: true,
            reason: skipCheck.reason,
          }) }] };
        }
        const result = rebuildProfiles({
          byProject: {},
          existingProfiles,
          targetDomain: args.domain,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({
          rebuilt:        result.domains,
          total_sessions: result.totalSessions,
          duration_ms:    0,
        }) }] };
      } catch (err) {
        return errorText("rebuild_profiles", err);
      }
    },
  );

  // ── list_domains ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_domains",
    {
      description:
        "Overview of all detected cognitive domains with session counts and last-seen dates.",
      inputSchema: {},
    },
    async (_args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/list_domains.py — builds domain list
        const profiles = loadProfiles();
        const domains = Object.entries(profiles.domains).map(([id, domain]) => ({
          id,
          label:         domain.label ?? id,
          session_count: domain.sessionCount ?? 0,
          last_active:   domain.lastUpdated ?? null,
          confidence:    domain.confidence ?? 0,
          projects:      domain.projects ?? [],
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ domains }) }] };
      } catch (err) {
        return errorText("list_domains", err);
      }
    },
  );

  // ── explore_features ──────────────────────────────────────────────────────
  server.registerTool(
    "explore_features",
    {
      description:
        "Explore interpretability features: persona vector, attribution trace, crosscoder patterns.",
      inputSchema: {
        mode:           z.enum(["features", "persona", "attribution", "crosscoder"]).describe("Exploration mode"),
        domain:         z.string().optional().describe("Domain filter"),
        compare_domain: z.string().optional().describe("Domain to compare against"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/methodology/handlers/explore-features.ts::exploreFeatures
        const profiles = loadProfiles();
        const response = exploreFeatures(
          { mode: args.mode, domain: args.domain, compareDomain: args.compare_domain },
          profiles,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("explore_features", err);
      }
    },
  );
}
