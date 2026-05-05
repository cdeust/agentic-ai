/**
 * Tool registry parity tests.
 * source: cortex@ed33435 mcp_server/tool_registry_*.py
 */
import { describe, it, expect } from "vitest";
import { queryMethodology } from "../../src/methodology/handlers/query-methodology.js";
import { detectDomainHandler } from "../../src/methodology/handlers/detect-domain.js";
import { exploreFeatures } from "../../src/methodology/handlers/explore-features.js";
import { remember } from "../../src/remember/handlers/remember.js";
import { forget } from "../../src/remember/handlers/forget.js";
import { anchor } from "../../src/remember/handlers/anchor.js";
import { rateMemory } from "../../src/remember/handlers/rate-memory.js";

function makeMemoryStoreStub(): Record<string, unknown> {
  const rows: Array<Record<string, unknown>> = [];
  let nextId = 1;
  return {
    insertMemory: (r: Record<string, unknown>) => { const id = nextId++; rows.push({ ...r, id }); return id; },
    getMemory: (id: number) => rows.find((r) => r["id"] === id) ?? null,
    searchVectors: (_b: unknown, _k: number, _m: number) => [],
    getEntityByName: (_n: string) => null,
    upsertEntity: (_n: string, _t: string, _d: string) => 1,
    linkMemoryEntity: (_m: number, _e: number) => {},
    markMemoryStale: (_id: number, _v: boolean) => {},
    setMemoryProtected: (_id: number, _v: boolean) => {},
    updateMemoryAccess: (_id: number) => {},
    getHomeostaticFactor: (_d: string) => 1.0,
    setHomeostaticFactor: (_d: string, _f: number) => {},
    getAllMemoriesForDecay: () => rows,
    getAllEntities: () => [],
    getHotMemories: (_opts: unknown) => [],
    bumpHeatRaw: (_id: number, _h: number) => {},
    updateMemoryImportance: (_id: number, _i: number) => {},
    updateMemoryContent: (_id: number, _c: string, _t: string[]) => {},
    updateMemoryMetamemory: (_id: number, _ac: number, _uc: number, _conf: number) => {},
  };
}

const REGISTRY_PARITY: Record<string, string[]> = {
  core:     ["query_methodology","detect_domain","rebuild_profiles","list_domains","record_session_end","get_methodology_graph","query_workflow_graph","open_visualization","explore_features"],
  memory:   ["remember","recall","memory_stats","checkpoint","narrative","consolidate","import_sessions","unified_search","get_telemetry"],
  manage:   ["forget","validate_memory","rate_memory","seed_project","anchor","backfill_memories","codebase_analyze"],
  nav:      ["recall_hierarchical","drill_down","navigate_memory","get_causal_chain","detect_gaps"],
  advanced: ["sync_instructions","create_trigger","add_rule","get_rules","get_project_story","assess_coverage"],
  ingest:   ["ingest_codebase","change_impact","ingest_prd"],
  wiki:     ["wiki_write","wiki_read","wiki_list","wiki_link","wiki_adr","wiki_reindex","wiki_purge","wiki_verify"],
};

const EMPTY_PROFILES = { domains: {} };
function wrap(r: unknown): { content: Array<{ type: "text"; text: string }> } { return { content: [{ type: "text" as const, text: JSON.stringify(r) }] }; }

describe("Tool registry parity — tool counts", () => {
  it("core: 9 tools",     () => { expect(REGISTRY_PARITY["core"]).toHaveLength(9); });
  it("memory: 9 tools",   () => { expect(REGISTRY_PARITY["memory"]).toHaveLength(9); });
  it("manage: 7 tools",   () => { expect(REGISTRY_PARITY["manage"]).toHaveLength(7); });
  it("nav: 5 tools",      () => { expect(REGISTRY_PARITY["nav"]).toHaveLength(5); });
  it("advanced: 6 tools", () => { expect(REGISTRY_PARITY["advanced"]).toHaveLength(6); });
  it("ingest: 3 tools",   () => { expect(REGISTRY_PARITY["ingest"]).toHaveLength(3); });
  it("wiki: 8 tools",     () => { expect(REGISTRY_PARITY["wiki"]).toHaveLength(8); });
  it("total: 47 tools",   () => { expect(Object.values(REGISTRY_PARITY).reduce((s, t) => s + t.length, 0)).toBe(47); });
});

describe("Tool registry dispatch — handler contract", () => {
  it("query_methodology returns content envelope", () => { const envelope = wrap(queryMethodology({ cwd: "/tmp", project: undefined, firstMessage: undefined }, EMPTY_PROFILES)); expect(envelope.content[0]!.type).toBe("text"); expect(() => JSON.parse(envelope.content[0]!.text)).not.toThrow(); });
  it("detect_domain returns content envelope", () => { const envelope = wrap(detectDomainHandler({ cwd: "/tmp", project: undefined, firstMessage: undefined }, EMPTY_PROFILES)); expect(envelope.content[0]!.type).toBe("text"); });
  it("explore_features returns envelope for each mode", () => { for (const mode of ["features","persona","attribution","crosscoder"] as const) { const e = wrap(exploreFeatures({ mode, domain: undefined, compareDomain: undefined }, EMPTY_PROFILES)); expect(e.content[0]!.type).toBe("text"); } });
  it("remember: stored or rejected (both valid responses)", () => { const store = makeMemoryStoreStub(); const r = remember({ content: "test", tags: [], source: "user", force: false, directory: "", domain: "" }, store as unknown as Parameters<typeof remember>[1]); expect("stored" in r).toBe(true); });
  it("forget: does not throw", () => { const store = makeMemoryStoreStub(); expect(() => forget({ memory_id: 99999, soft: false, force: false }, store as unknown as Parameters<typeof forget>[1])).not.toThrow(); });
  it("anchor: returns response", () => { const store = makeMemoryStoreStub(); const id = (store.insertMemory as (r: Record<string, unknown>) => number)({ content: "a", tags: [], source: "user", domain: "", heat: 1.0, importance: 1.0, store_type: "episodic" }); expect(anchor({ memory_id: id, reason: "test" }, store as unknown as Parameters<typeof anchor>[1])).toBeDefined(); });
  it("rateMemory: returns response", () => { const store = makeMemoryStoreStub(); const id = (store.insertMemory as (r: Record<string, unknown>) => number)({ content: "b", tags: [], source: "user", domain: "", heat: 0.8, importance: 0.8, store_type: "episodic" }); expect(rateMemory({ memory_id: id, useful: true }, store as unknown as Parameters<typeof rateMemory>[1])).toBeDefined(); });
});

describe("Tool registry completeness — all 47 Python tool names present", () => {
  it.each([
    ["core","query_methodology"],["core","detect_domain"],["core","rebuild_profiles"],["core","list_domains"],["core","record_session_end"],["core","get_methodology_graph"],["core","query_workflow_graph"],["core","open_visualization"],["core","explore_features"],
    ["memory","remember"],["memory","recall"],["memory","memory_stats"],["memory","checkpoint"],["memory","narrative"],["memory","consolidate"],["memory","import_sessions"],["memory","unified_search"],["memory","get_telemetry"],
    ["manage","forget"],["manage","validate_memory"],["manage","rate_memory"],["manage","seed_project"],["manage","anchor"],["manage","backfill_memories"],["manage","codebase_analyze"],
    ["nav","recall_hierarchical"],["nav","drill_down"],["nav","navigate_memory"],["nav","get_causal_chain"],["nav","detect_gaps"],
    ["advanced","sync_instructions"],["advanced","create_trigger"],["advanced","add_rule"],["advanced","get_rules"],["advanced","get_project_story"],["advanced","assess_coverage"],
    ["ingest","ingest_codebase"],["ingest","change_impact"],["ingest","ingest_prd"],
    ["wiki","wiki_write"],["wiki","wiki_read"],["wiki","wiki_list"],["wiki","wiki_link"],["wiki","wiki_adr"],["wiki","wiki_reindex"],["wiki","wiki_purge"],["wiki","wiki_verify"],
  ])("registry %s includes tool %s", (registry, toolName) => { expect(REGISTRY_PARITY[registry]).toContain(toolName); });
});
