# Type Inventory — Cross-Repo Survey

> Generated: 2026-04-26. Read-only snapshot of types across all four source repos.
> Every row maps to exactly one entry in `CORE_TYPESPACE.md`.
> Semantic category column uses: Memory | Codebase | Reasoning | PRD | Cross-cutting.

---

## Survey methodology

Each source repo was read in full at the type-definition level:
- Python (Cortex): Pydantic `BaseModel` subclasses + handler JSON schemas.
- Rust (ai-automatised-pipeline): `tool_schemas.rs` JSON Schema `inputSchema` objects — each schema = one type.
- Bash/MD (zetetic-team-subagents): Agent `.md` filenames define the `GeniusAgent` and `TeamAgent` enum members.
- TypeScript (prd-spec-generator): Zod schemas + exported TypeScript interfaces.

---

## Table 1 — Memory domain (source: Cortex)

| Type name | Source repo | Source path | Source language form | Semantic category |
|---|---|---|---|---|
| `Memory` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel (60+ fields, thermodynamic + engram) | Memory |
| `Entity` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel | Memory |
| `Relationship` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel (stochastic synaptic fields) | Memory |
| `ProspectiveTrigger` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel | Memory |
| `Checkpoint` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel | Memory |
| `MemoryArchive` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel | Memory |
| `ConsolidationLog` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel | Memory |
| `MemoryStats` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel | Memory |
| `RecallResult` | Cortex | `mcp_server/shared/memory_types.py` | Pydantic BaseModel | Memory |
| `RecallRequest` (inferred) | Cortex | `mcp_server/tool_registry_memory.py` handler signature | Tool handler args (query, domain, directory, max_results, min_heat, agent_topic) | Memory |
| `RememberRequest` (inferred) | Cortex | `mcp_server/tool_registry_memory.py` handler signature | Tool handler args (content, tags, directory, domain, source, force, agent_topic) | Memory |
| `RecallResponse` (inferred) | Cortex | `mcp_server/handlers/recall.py` outputSchema | JSON Schema (memories array + intent enum) | Memory |
| `ConversationMeta` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Memory |
| `MemoryMeta` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Memory |

## Table 2 — Reasoning / Interpretability domain (source: Cortex)

| Type name | Source repo | Source path | Source language form | Semantic category |
|---|---|---|---|---|
| `GraphNode` (cognitive) | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `GraphEdge` (cognitive) | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `GraphData` (cognitive) | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `TopSignal` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `BehavioralFeature` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `SparseActivation` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `AttributionNode` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `AttributionEdge` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `AttributionGraph` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `PersonaVector` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel (12D cognitive profile) | Reasoning |
| `PersistentFeature` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `FeatureDictionary` | Cortex | `mcp_server/shared/types.py` | Pydantic BaseModel | Reasoning |
| `EntryPoint` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `RecurringPattern` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `ToolPreference` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `SessionShape` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `CognitiveStyle` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `GlobalStyle` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `Bridge` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `BlindSpot` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `DetectionContext` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `AlternativeDomain` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `DetectionResult` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `DomainProfile` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel (aggregate profile) | Reasoning |
| `ProfilesV2` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `SessionLogEntry` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |
| `SessionLog` | Cortex | `mcp_server/shared/types_profiles.py` | Pydantic BaseModel | Reasoning |

## Table 3 — Codebase domain (source: ai-automatised-pipeline)

| Type name | Source repo | Source path | Source language form | Semantic category |
|---|---|---|---|---|
| `IndexCodebaseInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `index_codebase_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `QueryGraphInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `query_graph_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `GetSymbolInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `get_symbol_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `ResolveGraphInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `resolve_graph_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `ClusterGraphInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `cluster_graph_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `GetProcessesInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `get_processes_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `GetImpactInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `get_impact_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `SearchCodebaseInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `search_codebase_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `GetContextInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `get_context_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `AnalyzeCodebaseInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `analyze_codebase_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `LspResolveInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `lsp_resolve_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `DetectChangesInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `detect_changes_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `PreparePrdInputInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `prepare_prd_input_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `ValidatePrdAgainstGraphInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `validate_prd_against_graph_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `CheckSecurityGatesInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `check_security_gates_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `VerifySemanticDiffInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `verify_semantic_diff_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `ExtractFindingInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `extract_finding_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `RefineFindingInput` + sub-types (`RefinedPrompt`, `Refinement`, `AddedContext`) | ai-automatised-pipeline | `src/tool_schemas.rs` `refine_finding_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `StartVerificationInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `start_verification_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `AppendClarificationInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `append_clarification_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `FinalizeVerificationInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `finalize_verification_schema()` | Rust serde_json::json! inputSchema | Codebase |
| `AbortVerificationInput` | ai-automatised-pipeline | `src/tool_schemas.rs` `abort_verification_schema()` | Rust serde_json::json! inputSchema | Codebase |

## Table 4 — Reasoning / Agent identity (source: zetetic-team-subagents)

| Type name | Source repo | Source path | Source language form | Semantic category |
|---|---|---|---|---|
| `GeniusAgent` (97-member enum) | zetetic-team-subagents | `agents/genius/*.md` (one file per member) | Markdown filename conventions | Reasoning |
| `TeamAgent` (19-member enum) | zetetic-team-subagents | `agents/*.md` (top-level, excl. genius/) | Markdown filename conventions | Reasoning |
| `AgentIdentity` (discriminated union) | zetetic-team-subagents | implied by agent routing tooling | Bash/MD convention | Reasoning |

## Table 5 — PRD domain (source: prd-spec-generator)

| Type name | Source repo | Source path | Source language form | Semantic category |
|---|---|---|---|---|
| `Verdict` (5-level enum) | prd-spec-generator | `packages/core/src/domain/verdict.ts` | Zod `z.enum` | PRD |
| `PRDContext` (8-member enum) | prd-spec-generator | `packages/core/src/domain/prd-context.ts` | Zod `z.enum` | PRD |
| `PRDContextConfig` | prd-spec-generator | `packages/core/src/domain/prd-context.ts` | TS interface | PRD |
| `SectionType` (17-member enum) | prd-spec-generator | `packages/core/src/domain/section-type.ts` | Zod `z.enum` | PRD |
| `HardOutputRule` (64-member enum) | prd-spec-generator | `packages/core/src/domain/hard-output-rule.ts` | Zod `z.enum` | PRD |
| `ThinkingStrategy` (16-member enum) | prd-spec-generator | `packages/core/src/domain/thinking-strategy.ts` | Zod `z.enum` | PRD |
| `ClarificationAnswer` | prd-spec-generator | `packages/core/src/domain/clarification.ts` | Zod `z.object` | PRD |
| `ClarificationState` | prd-spec-generator | `packages/core/src/domain/clarification.ts` | Zod `z.object` | PRD |
| `PRDSection` | prd-spec-generator | `packages/core/src/domain/prd-document.ts` | Zod `z.object` | PRD |
| `PRDDocument` | prd-spec-generator | `packages/core/src/domain/prd-document.ts` | Zod `z.object` | PRD |
| `HardOutputRuleViolation` | prd-spec-generator | `packages/core/src/domain/validation-result.ts` | Zod `z.object` | PRD |
| `ValidationReport` | prd-spec-generator | `packages/core/src/domain/validation-result.ts` | Zod `z.object` | PRD |
| `CrossRefValidationResult` | prd-spec-generator | `packages/core/src/domain/validation-result.ts` | Zod `z.object` | PRD |
| `Capabilities` | prd-spec-generator | `packages/core/src/domain/capabilities.ts` | TS interface | PRD |
| `Claim` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod `z.object` | PRD |
| `JudgeVerdict` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod `z.object` | PRD |
| `JudgeRequest` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod `z.object` | PRD |
| `GeniusAgent` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod `z.enum` (97-member) | Reasoning |
| `TeamAgent` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod `z.enum` (19-member) | Reasoning |
| `AgentIdentity` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod discriminated union | Reasoning |
| `SubagentInvocation` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod `z.object` | Reasoning |
| `SubagentResponse` | prd-spec-generator | `packages/core/src/domain/agent.ts` | Zod `z.object` | Reasoning |
| `StrategyExecution` | prd-spec-generator | `packages/core/src/persistence/evidence-repository.ts` | TS interface | PRD |
| `PRDQualityScore` | prd-spec-generator | `packages/core/src/persistence/evidence-repository.ts` | TS interface | PRD |
| `AdaptiveThreshold` | prd-spec-generator | `packages/core/src/persistence/evidence-repository.ts` | TS interface | PRD |
| `StrategyPerformanceSummary` | prd-spec-generator | `packages/core/src/persistence/evidence-repository.ts` | TS interface | PRD |

## Table 6 — Wiki domain (source: Cortex, new to TS ecosystem)

| Type name | Source repo | Source path | Source language form | Semantic category |
|---|---|---|---|---|
| `WikiPageKind` (inferred enum: adr, spec, note, file_doc, lesson, convention, guide, reference, journal) | Cortex | `mcp_server/core/wiki_pages.py` path segments + `mcp_server/handlers/wiki_list.py` examples | Python string literal convention | Cross-cutting |
| `WikiPage` (inferred) | Cortex | `mcp_server/core/wiki_pages.py` `PageDocument` dataclass + frontmatter dict | Python dataclass | Cross-cutting |
| `WikiWriteInput` (inferred) | Cortex | `mcp_server/tool_registry_wiki.py` tool signature | Tool handler args | Cross-cutting |

---

## Conflict register

| Conflict ID | Type | Repos in conflict | Description | Resolution |
|---|---|---|---|---|
| C-001 | `Memory.id` | Cortex: `int \| None`; unified TS: no integer IDs exposed at port layer | Cortex uses integer primary keys internally; public RecallResult uses string UUID in JSON schema | Use `string` for public-facing id; keep `number \| null` for internal Memory model |
| C-002 | `RecallResponse` shape | Cortex recall.py outputSchema returns full memory objects; CLAUDE.md recall usage returns formatted strings | Two different consumers need different shapes | Define `RecallResultItem` (rich) and let `RecallResponse` carry `items: RecallResultItem[]`; callers extract `.content` for string use |
| C-003 | `GraphNode` name collision | Cortex types.py has `GraphNode` for cognitive map visualization; ai-automatised-pipeline has codebase graph nodes (implicit) | Same name, different domain semantics | Namespace: `CognitiveGraphNode` (Reasoning domain), `CodeSymbolNode` (Codebase domain) — distinct types, no aliasing |
| C-004 | `source` field on Memory | Cortex: string enum "session", "tool", "user", "consolidation"; prd-spec-generator ClarificationAnswer has `source: z.enum(["user_freeform","user_selection","codebase_inferred","default"])` | Same field name, incompatible enum sets | Two separate types: `MemorySource` (Cortex values) and `ClarificationSource` (prd-spec-generator values) — no merger |

---

## Summary counts

| Domain | Types inventoried |
|---|---|
| Memory | 14 |
| Reasoning / Profile | 27 |
| Codebase | 22 |
| PRD | 26 |
| Wiki / Cross-cutting | 3 |
| **Total** | **92** |
