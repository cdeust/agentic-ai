# Dashboard UI Verification

Date: 2026-05-06
Branch: fix/dashboard-ui-verification-2026-05-06
Verified by: Popper falsification protocol — each view is WORKING if and only if
  (a) HTTP 200 with non-empty real-data body, AND
  (b) the SPA shell exposes a navigable UI element that calls the endpoint.

---

## View name mapping (user names ↔ route files)

| User name  | Route file     | API endpoint(s)                         | SPA element        |
|------------|----------------|-----------------------------------------|--------------------|
| Graph      | graph.ts       | GET /api/graph, /api/graph/progress,    | `#panel-graph`     |
|            |                | GET /api/graph/phase                    | `#tab-graph` btn   |
| Knowledge  | memories.ts    | GET /api/memories,                      | `#panel-knowledge` |
|            |                | GET /api/memories/facets                | `#tab-knowledge`   |
| Board      | sankey.ts      | GET /api/sankey                         | `#panel-board`     |
|            |                |                                         | `#tab-board`       |

Additional routes not surfaced as user-visible tabs (working, not broken):
- `/api/wiki/*` (wiki.ts) — used internally; pages array returned from METHODOLOGY_DIR
- `/api/discussions` (discussions.ts) — session listing from ~/.claude/projects/
- `/api/file-diff` (file-diff.ts) — git diff for entity nodes (on-demand)
- `/health` (health.ts) — liveness probe

---

## Pre-fix finding: MISSING-VIEW

Before this commit, `index.html` was a single-panel view with no tab navigation.
All three API routes (graph, memories/facets, sankey) existed and returned correct data,
but the SPA had no Graph / Knowledge / Board tabs — the user could not switch views.

Failure mode: MISSING-VIEW (API complete; UI incomplete — zero tab/nav elements in HTML).

---

## Fix applied

`packages/memory-dashboard/src/static/index.html` was rewritten to add:
- A `<nav>` tab bar with three buttons: Graph | Knowledge | Board
- Three `<div role="tabpanel">` panels: `#panel-graph`, `#panel-knowledge`, `#panel-board`
- Tab-switching JS that activates panels on click and lazy-loads each tab's data
- Knowledge tab: memory table with domain/stage filters and keyset-pagination controls
- Board tab: Canvas-rendered Sankey diagram of consolidation transitions + per-stage metrics cards
- Graph tab: retained original graph canvas + progress bar, plus improved legend

The index.html is served as a static file — no build step required (Fastify static plugin).
No route code was changed. The fix is in the presentation layer only, wiring existing API endpoints.

---

## Per-view HTTP verification transcripts

All tests run against a seeded SQLite DB at /tmp/memory-dashboard-e2e-seed.db
(5 memories, 3 entities, 3 stage_transitions across 4 domains).
Server: node dist/server.js, DB_PATH=/tmp/memory-dashboard-e2e-seed.db, port 3458.

### Static SPA shell

```
GET / HTTP/1.1
Host: 127.0.0.1:3458

HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
content-length: 10234

[body excerpt: tab-graph, tab-knowledge, tab-board, panel-graph, panel-knowledge, panel-board all present]
```

VERDICT: WORKING

---

### Graph tab

**Endpoint: GET /api/graph**

```
GET /api/graph HTTP/1.1

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8

{
  "nodes": [
    {"id":"domain:engineering","kind":"domain","type":"domain","label":"engineering"},
    {"id":"domain:ml","kind":"domain","type":"domain","label":"ml"},
    {"id":"domain:product","kind":"domain","type":"domain","label":"product"},
    {"id":"domain:research","kind":"domain","type":"domain","label":"research"},
    {"id":"memory:m1","kind":"memory","heat":0.9,"domain":"engineering",...},
    ... (5 memory nodes, 3 entity nodes)
  ],
  "edges": [
    {"source":"memory:m1","target":"domain:engineering","kind":"in_domain","weight":1},
    ... (8 total edges)
  ],
  "meta": {
    "schema": "workflow_graph.v1",
    "node_count": 12,
    "edge_count": 8,
    "stage": "baseline",
    "domain_count": 4,
    "memory_count": 5,
    "entity_count": 3
  }
}
```

**Endpoint: GET /api/graph/progress**

```
HTTP/1.1 200 OK
{"phase":"full_ready","pct":1,"baseline_ready":true,"full_ready":true,"node_count":12,"edge_count":8}
```

**Endpoint: GET /api/graph/phase?name=L0**

```
HTTP/1.1 200 OK
{"phase":"L0","ready":true,"nodes":[...4 domain nodes...],"edges":[]}
```

**Endpoint: GET /api/graph/phase?name=L5**

```
HTTP/1.1 200 OK
{"phase":"L5","ready":true,"nodes":[...8 memory+entity nodes...],"edges":[...5 in_domain edges...]}
```

VERDICT: WORKING — 12 nodes, 8 edges, phase=full_ready, both phase payloads populated

---

### Knowledge tab

**Endpoint: GET /api/memories**

```
GET /api/memories HTTP/1.1

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 3427

{
  "memories": [
    {"id":"m1","content":"Graph verification: memory about engineering patterns","heat":0.9,"store_type":"episodic","domain":"engineering","consolidation_stage":"labile","is_protected":true},
    {"id":"m2","content":"Knowledge base entry: research synthesis on distributed systems","heat":0.7,"store_type":"semantic","domain":"research","consolidation_stage":"consolidated"},
    {"id":"m4","content":"Sankey chart shows consolidation pipeline flow","heat":0.6,"store_type":"semantic","domain":"engineering","consolidation_stage":"late_ltp"},
    {"id":"m3","content":"Board task: implement dashboard graph route","heat":0.5,"store_type":"episodic","domain":"product","consolidation_stage":"early_ltp"},
    {"id":"m5","content":"Entity extraction from session logs","heat":0.4,"store_type":"episodic","domain":"ml","consolidation_stage":"reconsolidating"}
  ],
  "total": 5,
  "has_more": false,
  "next_after": "m5"
}
```

**Endpoint: GET /api/memories/facets**

```
HTTP/1.1 200 OK

{
  "by_domain": [
    {"domain":"engineering","count":2},
    {"domain":"research","count":1},
    {"domain":"product","count":1},
    {"domain":"ml","count":1}
  ],
  "by_stage": [
    {"consolidation_stage":"consolidated","count":1},
    {"consolidation_stage":"early_ltp","count":1},
    {"consolidation_stage":"labile","count":1},
    {"consolidation_stage":"late_ltp","count":1},
    {"consolidation_stage":"reconsolidating","count":1}
  ],
  "totals": {"total":5,"protected":1,"global":0}
}
```

VERDICT: WORKING — 5 memories returned, correct facets, domain/stage filters wired in UI

---

### Board tab

**Endpoint: GET /api/sankey**

```
GET /api/sankey HTTP/1.1

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 1505

{
  "transitions": [
    {"from_stage":"early_ltp","to_stage":"late_ltp","count":1},
    {"from_stage":"labile","to_stage":"early_ltp","count":1},
    {"from_stage":"late_ltp","to_stage":"consolidated","count":1}
  ],
  "timing": {
    "early_ltp->late_ltp": {"avg_hours":14.5,"min_hours":14.5,"max_hours":14.5},
    "labile->early_ltp":   {"avg_hours":3.2,"min_hours":3.2,"max_hours":3.2},
    "late_ltp->consolidated": {"avg_hours":72.0,"min_hours":72.0,"max_hours":72.0}
  },
  "stage_metrics": {
    "labile":         {"count":1,"avg_heat":0.9,"avg_hours":0.0,...},
    "early_ltp":      {"count":1,"avg_heat":0.5,"avg_hours":0.0,...},
    "late_ltp":       {"count":1,"avg_heat":0.6,"avg_hours":0.0,...},
    "consolidated":   {"count":1,"avg_heat":0.7,"avg_hours":0.0,...},
    "reconsolidating":{"count":1,"avg_heat":0.4,"avg_hours":0.0,...}
  },
  "total_memories": 5
}
```

VERDICT: WORKING — 3 transitions, 3 timing entries, all 5 stages present in stage_metrics

---

## Test suite

```
pnpm --filter @agentic/memory-dashboard test

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Duration  400ms
```

All 13 tests green. No regressions.

---

## JS asset list (static files served from src/static/)

The SPA uses only inline `<script type="module">` — no external JS files are bundled.
All rendering is vanilla browser JS (Canvas 2D API). No external CDN dependencies.

```
GET /  → src/static/index.html (10,234 bytes) — the SPA shell
```

No STATIC-ASSET-404 failures possible: there are no separate JS/CSS files to serve.

---

## Summary

| View       | Pre-fix status  | Post-fix status | Falsification condition met?        |
|------------|-----------------|-----------------|-------------------------------------|
| Graph      | API WORKING,    | WORKING         | Yes: 200 + 12 nodes non-empty       |
|            | UI MISSING-VIEW |                 |                                     |
| Knowledge  | API WORKING,    | WORKING         | Yes: 200 + 5 memories non-empty     |
|            | UI MISSING-VIEW |                 |                                     |
| Board      | API WORKING,    | WORKING         | Yes: 200 + 3 transitions non-empty  |
|            | UI MISSING-VIEW |                 |                                     |

Root cause: single-panel SPA with no tab navigation.
Fix: added Graph | Knowledge | Board tab nav + three wired panels to index.html.
Approach: presentation-layer only; zero changes to route code or server code.
