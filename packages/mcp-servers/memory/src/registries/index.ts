/**
 * registries/index.ts — barrel re-export for all 7 tool registries.
 * source: cortex@ed33435 mcp_server/tool_registry_*.py
 */
export { register as registerCore }      from "./registry-core.js";
export { register as registerMemory }    from "./registry-memory.js";
export { register as registerManage }    from "./registry-manage.js";
export { register as registerNav }       from "./registry-nav.js";
export { register as registerAdvanced }  from "./registry-advanced.js";
export { register as registerIngest }    from "./registry-ingest.js";
export { register as registerWiki }      from "./registry-wiki.js";
export type { MemoryRegistryDeps }   from "./registry-memory.js";
export type { ManageRegistryDeps }   from "./registry-manage.js";
export type { NavRegistryDeps }      from "./registry-nav.js";
export type { AdvancedRegistryDeps } from "./registry-advanced.js";
export type { IngestRegistryDeps }   from "./registry-ingest.js";
