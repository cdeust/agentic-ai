# ADR-0014 — Cortex HTTP server restored: pure-TS port via Fastify

**Status:** Accepted — supersedes ADR-0011
**Date:** 2026-05-04
**Branch:** `port/no-deferrals-http-dashboard`
**Directive:** User directive 2026-05-04 — "No deferrals nor stub accepted."

## Context

ADR-0011 deferred the Cortex HTTP dashboard (15 Python files, ~3 668 LOC
under `mcp_server/server/`) to a post-cutover phase because:

1. The port was estimated at 2–3 person-weeks.
2. It pulled in frontend tooling (D3, Three.js, bundling) that the rest of
   the monorepo does not need.
3. The dashboard mixes memory, wiki, and codebase-graph data across
   multiple packages.

The user has explicitly rescinded ADR-0011 with the directive:
**"No deferrals nor stubs accepted."** The `open_visualization` tool in
`packages/mcp-servers/memory/src/tools/ingest.ts` was throwing
`PortPendingError` citing ADR-0011. That throw is removed in this PR.

## Decision

**Port as a pure-TS package** (`packages/memory-dashboard/`) using:

- **Fastify v5** — HTTP routing (replaces Python's `http.server.BaseHTTPRequestHandler`).
- **`@fastify/static`** — static asset serving for the HTML/CSS/JS viz bundle.
- **`@fastify/cors`** — strict-reflect loopback-only CORS
  (mirrors `mcp_server/server/http_security.py`).
- **`better-sqlite3`** — already a `@agentic/memory` dependency; reused for
  direct DB reads on the API routes that need raw SQL.

**No Python runtime dependency.** Path B (subprocess-wrap) was rejected:
the user wants a clean monorepo.

**Static UI:** The Cortex UI assets (`ui/unified-viz.html` + `ui/unified/js/*.js`)
are not bundled into this package. The server's `staticDir` option defaults to
`src/static/` (a minimal standalone HTML dashboard). When the Cortex dev
checkout is present, callers can pass `staticDir: path.join(cortexRoot, "ui")`
to serve the full constellation map — this mirrors the
`_detect_dev_source` / `_sync_dev_source` pattern in
`cortex@ed33435 mcp_server/server/http_launcher.py:51-96`.

## New package: `@agentic/memory-dashboard`

```
packages/memory-dashboard/
  src/
    server.ts          — Fastify entry point (port of http_standalone.py)
    launcher.ts        — spawn/reuse logic (port of http_launcher.py)
    routes/
      graph.ts         — /api/graph, /api/graph/progress, /api/graph/phase
      wiki.ts          — /api/wiki/*
      sankey.ts        — /api/sankey
      discussions.ts   — /api/discussions, /api/discussion/:id
      file-diff.ts     — /api/file-diff
      memories.ts      — /api/memories, /api/memories/facets
      health.ts        — /health
    static/
      index.html       — minimal standalone dashboard HTML
  __tests__/
    routes.test.ts     — Fastify inject() tests (deterministic, no real ports)
```

## Wire-up: `open_visualization`

`packages/mcp-servers/memory/src/tools/ingest.ts:open_visualization`
now calls `launchDashboard()` from `@agentic/memory-dashboard/launcher`
instead of throwing `PortPendingError`.

## Acceptance

```bash
grep -rEn "open_visualization.*PortPendingError|PortPendingError.*open_visualization|deferred per ADR-0011" packages
# → 0 lines
```

## Consequences

- ADR-0011 is superseded. Its "Verification" gate (demand threshold before
  Phase 7 entry) no longer applies.
- The full 3D constellation map (Three.js / D3 `unified-viz.html`) requires
  pointing `staticDir` at the Cortex UI directory — the standalone HTML in
  `src/static/index.html` is a minimal Canvas-based fallback.
- Future work: serve the Cortex `unified-viz.html` bundle directly from the
  package by copying the upstream JS/CSS assets into `src/static/` as part
  of a `postinstall` script (post-ADR-0014 task).

## Sources

- `cortex@ed33435 mcp_server/server/http_standalone.py` — composition root
- `cortex@ed33435 mcp_server/server/http_launcher.py` — launch / reuse logic
- `cortex@ed33435 mcp_server/server/http_standalone_graph.py` — graph build state machine
- `cortex@ed33435 mcp_server/server/http_standalone_endpoints.py` — endpoint bodies
- `cortex@ed33435 mcp_server/server/http_standalone_wiki.py` — wiki endpoints
- `cortex@ed33435 mcp_server/server/http_standalone_response.py` — response helpers
- `cortex@ed33435 mcp_server/server/http_security.py` — CORS / DNS-rebinding / CSRF
- `cortex@ed33435 mcp_server/server/http_file_diff.py` — file diff endpoint
- `cortex@ed33435 mcp_server/server/http_dashboard_data.py` — data formatting
