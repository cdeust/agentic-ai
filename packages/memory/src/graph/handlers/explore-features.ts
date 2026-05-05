/**
 * Handler: explore-features — interpretability exploration.
 *
 * Modes: features, attribution, persona, crosscoder.
 *
 * This is the TS port of mcp_server/handlers/explore_features.py.
 * The handler routing and schema are fully ported. The inner computation
 * modules (attribution_tracer, behavioral_crosscoder, persona_vector,
 * sparse_dictionary) are out-of-scope for this worktree
 * (port/cortex-methodology handles them — merge order #8).
 * Those paths throw typed PORT_PENDING errors with pointers to the
 * Python source.
 *
 * Read-only over profiles.json.
 *
 * source: explore_features.py in mcp_server/handlers/.
 * source: Bricken et al. (2023) "Towards Monosemanticity: Decomposing
 *   Language Models With Dictionary Learning" — sparse dictionary
 *   feature model cited in the Python schema description.
 */

import type { ProfilePort } from "../port.js";

// ── Schema (mirrors Python inputSchema) ──────────────────────────────────

export const schema = {
  title: "Explore features (interpretability lens)",
  description:
    "Inspect the user's cognitive profile through one of four interpretability " +
    "lenses (Bricken et al. 2023): `features`, `attribution`, `persona`, `crosscoder`.", // source: Bricken et al. (2023) "Towards Monosemanticity: Decomposing Language Models With Dictionary Learning"
  inputSchema: {
    type: "object" as const,
    required: ["mode"],
    properties: {
      mode: {
        type: "string" as const,
        enum: ["features", "attribution", "persona", "crosscoder"] as const,
      },
      domain: { type: "string" as const },
      compare_domain: { type: "string" as const },
    },
  },
};

// ── Typed stub error ───────────────────────────────────────────────────────

/**
 * Thrown by inner-computation stubs that are pending a future worktree merge.
 *
 * The error carries a pointer to the Python source so future maintainers
 * know exactly which file to port.
 */
export class ComputationPendingError extends Error {
  readonly pythonSource: string;
  readonly worktree: string;

  constructor(pythonSource: string, worktree: string) {
    super(
      `PORT_PENDING: ${pythonSource} not yet ported. ` +
        `Target worktree: ${worktree}.`,
    );
    this.name = "ComputationPendingError"; // source: port/cortex-methodology — named to distinguish from WikiDbUnavailableError
    this.pythonSource = pythonSource;
    this.worktree = worktree;
  }
}

// ── Mode stubs (pending port/cortex-methodology) ─────────────────────────

/**
 * @stub port/cortex-methodology
 * source: _handle_features in explore_features.py
 * source: build_seed_dictionary in mcp_server/core/sparse_dictionary.py
 */
function handleFeatures(_profiles: Record<string, unknown>): never {
  throw new ComputationPendingError(
    "mcp_server/core/sparse_dictionary.py::build_seed_dictionary",
    "port/cortex-methodology",
  );
}

/**
 * @stub port/cortex-methodology
 * source: _handle_attribution in explore_features.py
 * source: trace_attribution in mcp_server/core/attribution_tracer.py
 */
function handleAttribution(
  _profiles: Record<string, unknown>,
  _domain: string | undefined,
): never {
  throw new ComputationPendingError(
    "mcp_server/core/attribution_tracer.py::trace_attribution",
    "port/cortex-methodology",
  );
}

/**
 * @stub port/cortex-methodology
 * source: _handle_persona in explore_features.py
 * source: build_persona_vector in mcp_server/core/persona_vector.py
 */
function handlePersona(
  _profiles: Record<string, unknown>,
  _domain: string | undefined,
): never {
  throw new ComputationPendingError(
    "mcp_server/core/persona_vector.py::build_persona_vector",
    "port/cortex-methodology",
  );
}

/**
 * @stub port/cortex-methodology
 * source: _handle_crosscoder in explore_features.py
 * source: compare_feature_profiles in mcp_server/core/behavioral_crosscoder.py
 */
function handleCrosscoder(
  _profiles: Record<string, unknown>,
  _domain: string | undefined,
  _compareDomain: string | undefined,
): never {
  throw new ComputationPendingError(
    "mcp_server/core/behavioral_crosscoder.py::compare_feature_profiles",
    "port/cortex-methodology",
  );
}

// ── Handler ────────────────────────────────────────────────────────────────

export interface ExploreArgs {
  mode: "features" | "attribution" | "persona" | "crosscoder";
  domain?: string;
  compare_domain?: string;
}

/**
 * Route explore-features request to the appropriate mode handler.
 *
 * Returns `{status: "port_pending"}` for all modes until
 * port/cortex-methodology is merged. The stub functions throw typed errors
 * that this handler catches and surfaces as structured responses so the
 * MCP server does not crash.
 *
 * source: handler in explore_features.py.
 */
export async function handler(
  args: Record<string, unknown>,
  port: ProfilePort,
): Promise<Record<string, unknown>> {
  const mode = args["mode"] as string | undefined;
  const domain = args["domain"] as string | undefined;
  const compareDomain = args["compare_domain"] as string | undefined;

  const profiles = await port.loadProfiles();

  const domains = (profiles["domains"] as Record<string, unknown>) ?? {};
  if (Object.keys(domains).length === 0) {
    return {
      status: "no_data",
      message: "No profiles built yet. Run rebuild_profiles first.",
    };
  }

  try {
    if (mode === "features") return handleFeatures(profiles);
    if (mode === "attribution") return handleAttribution(profiles, domain);
    if (mode === "persona") return handlePersona(profiles, domain);
    if (mode === "crosscoder") return handleCrosscoder(profiles, domain, compareDomain);
    return { status: "error", message: `Unknown mode: ${mode ?? "(none)"}` };
  } catch (err) {
    if (err instanceof ComputationPendingError) {
      return {
        status: "port_pending",
        message: err.message,
        pythonSource: err.pythonSource,
        worktree: err.worktree,
      };
    }
    throw err;
  }
}
