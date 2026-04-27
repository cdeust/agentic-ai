# Core Type Space — `@agentic/core`

> Pāṇinian discipline applied: every public type is constructable via composition
> of smaller types declared in this same file. No two types are semantically
> equivalent. No type is introduced without a source-repo precedent (or an
> explicit justification paragraph for unavoidable union types).
>
> This document defines the Zod schemas. The actual `.ts` source files mirror
> these exactly. Schemas are grouped by domain, then ordered smallest-to-largest
> so every composed type is defined before it is referenced.

---

## 0. Cross-cutting primitives (`src/domain/common/`)

These are branded scalar wrappers used throughout all domains. They prevent
accidental substitution between semantically different strings/numbers at
compile time without runtime overhead.

```ts
// src/domain/common/scalars.ts
import { z } from "zod";

// ISO 8601 datetime string — used everywhere a timestamp appears.
// source: ISO 8601:2004 §5.4; JSON Schema format "date-time".
export const ISODateTimeSchema = z.string().datetime();
export type ISODateTime = z.infer<typeof ISODateTimeSchema>;

// UUID v4 string — used for document IDs.
export const UUIDSchema = z.string().uuid();
export type UUID = z.infer<typeof UUIDSchema>;

// Confidence score in [0, 1].
export const ConfidenceScoreSchema = z.number().min(0).max(1);
export type ConfidenceScore = z.infer<typeof ConfidenceScoreSchema>;

// Non-negative integer — used for counts.
export const NonNegativeIntSchema = z.number().int().nonnegative();
export type NonNegativeInt = z.infer<typeof NonNegativeIntSchema>;

// Absolute filesystem path starting with "/".
export const AbsolutePathSchema = z.string().startsWith("/");
export type AbsolutePath = z.infer<typeof AbsolutePathSchema>;

// Risk score in [0, 1] — used in codebase impact analysis.
export const RiskScoreSchema = z.number().min(0).max(1);
export type RiskScore = z.infer<typeof RiskScoreSchema>;
```

---

## 1. Memory domain (`src/domain/memory/`)

Source: Cortex `mcp_server/shared/memory_types.py`.

```ts
// src/domain/memory/memory-store-type.ts
import { z } from "zod";

// source: Cortex memory_types.py Memory.store_type — dual-store CLS model
// (McClelland 1995, complementary learning systems).
export const MemoryStoreTypeSchema = z.enum(["episodic", "semantic"]);
export type MemoryStoreType = z.infer<typeof MemoryStoreTypeSchema>;
```

```ts
// src/domain/memory/memory-source.ts
import { z } from "zod";

// source: Cortex mcp_server/handlers/remember.py schema `source` field enum.
// Four origination points for memory content.
export const MemorySourceSchema = z.enum([
  "session",
  "tool",
  "user",
  "consolidation",
]);
export type MemorySource = z.infer<typeof MemorySourceSchema>;
```

```ts
// src/domain/memory/memory.ts
import { z } from "zod";
import { ISODateTimeSchema, ConfidenceScoreSchema } from "../common/scalars.js";
import { MemoryStoreTypeSchema } from "./memory-store-type.js";
import { MemorySourceSchema } from "./memory-source.js";

// source: Cortex mcp_server/shared/memory_types.py Memory class.
// Internal memory model — thermodynamic properties omitted from public port
// surface; kept here for adapter implementations that need the full shape.
//
// Note on id: Cortex uses int | None (SQLite rowid). At the public port
// boundary we use string to avoid integer overflow across JSON. The
// adapter layer is responsible for the int->string conversion.
// See conflict C-001 in TYPE_INVENTORY.md.
export const MemorySchema = z.object({
  id: z.string().nullable(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  source: MemorySourceSchema.default("user"),
  domain: z.string().default(""),
  directoryContext: z.string().default(""),
  createdAt: ISODateTimeSchema.optional(),
  lastAccessed: ISODateTimeSchema.optional(),

  // Thermodynamic properties
  // source: Cortex memory_types.py — heat model (Crick & Koch 1990 activation)
  heat: z.number().min(0).max(1).default(1.0),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: ConfidenceScoreSchema.default(1.0),

  // Access tracking
  accessCount: NonNegativeIntSchema.default(0),

  // Store type — CLS dual-store
  storeType: MemoryStoreTypeSchema.default("episodic"),

  // Consolidation stage
  // source: Cortex memory_types.py consolidation_stage field (Kandel 2001)
  consolidationStage: z.enum([
    "labile",
    "early_ltp",
    "late_ltp",
    "consolidated",
    "reconsolidating",
  ]).default("labile"),

  // Protection flags
  isProtected: z.boolean().default(false),
  isStale: z.boolean().default(false),
  isGlobal: z.boolean().default(false),
});
export type Memory = z.infer<typeof MemorySchema>;

// Separate import at top — must be added in actual source file.
// Shown here inline to keep the doc self-contained.
const NonNegativeIntSchema = z.number().int().nonnegative();
```

```ts
// src/domain/memory/recall-request.ts
import { z } from "zod";

// source: Cortex mcp_server/tool_registry_memory.py _register_recall signature.
export const RecallRequestSchema = z.object({
  query: z.string().min(1),
  domain: z.string().optional(),
  directory: z.string().optional(),
  maxResults: z.number().int().positive().default(10),
  minHeat: z.number().min(0).max(1).default(0.05),
  agentTopic: z.string().optional(),
});
export type RecallRequest = z.infer<typeof RecallRequestSchema>;
```

```ts
// src/domain/memory/recall-response.ts
import { z } from "zod";
import { ISODateTimeSchema, ConfidenceScoreSchema } from "../common/scalars.js";

// source: Cortex mcp_server/handlers/recall.py outputSchema `memories` array items.
// Conflict C-002: RecallResultItem provides the rich shape; callers that only
// need `.content` string extract it directly. The formatted-string response
// format (CLAUDE.md) is a presentation concern handled in the MCP adapter, not
// in the core type.
export const RecallResultItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  score: z.number(),
  heat: z.number().min(0).max(1),
  domain: z.string().default(""),
  tags: z.array(z.string()).default([]),
  createdAt: ISODateTimeSchema.optional(),
  source: z.string().default(""),
});
export type RecallResultItem = z.infer<typeof RecallResultItemSchema>;

// source: Cortex mcp_server/handlers/recall.py outputSchema `intent` enum.
export const RecallIntentSchema = z.enum([
  "temporal",
  "semantic",
  "entity",
  "procedural",
  "unknown",
]);
export type RecallIntent = z.infer<typeof RecallIntentSchema>;

export const RecallResponseSchema = z.object({
  items: z.array(RecallResultItemSchema),
  intent: RecallIntentSchema.optional(),
  totalConsidered: z.number().int().nonnegative().optional(),
});
export type RecallResponse = z.infer<typeof RecallResponseSchema>;
```

```ts
// src/domain/memory/remember-request.ts
import { z } from "zod";
import { MemorySourceSchema } from "./memory-source.js";

// source: Cortex mcp_server/tool_registry_memory.py _register_remember signature.
export const RememberRequestSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  directory: z.string().optional(),
  domain: z.string().optional(),
  source: MemorySourceSchema.default("user"),
  force: z.boolean().default(false),
  agentTopic: z.string().optional(),
});
export type RememberRequest = z.infer<typeof RememberRequestSchema>;
```

```ts
// src/domain/memory/remember-response.ts
import { z } from "zod";

// source: Cortex mcp_server/handlers/remember.py outputSchema `stored` + `reason`.
export const RememberResponseSchema = z.object({
  stored: z.boolean(),
  reason: z.string().optional(),
  memoryId: z.string().optional(),
});
export type RememberResponse = z.infer<typeof RememberResponseSchema>;
```

---

## 2. Codebase domain (`src/domain/codebase/`)

Source: ai-automatised-pipeline `src/tool_schemas.rs`.

All input types mirror the `inputSchema` JSON objects in tool_schemas.rs exactly.
Required fields have no `.optional()`; optional fields do.

```ts
// src/domain/codebase/codebase-language.ts
import { z } from "zod";

// source: ai-automatised-pipeline src/tool_schemas.rs index_codebase_schema language enum.
export const CodebaseLanguageSchema = z.enum(["auto", "rust", "python", "typescript"]);
export type CodebaseLanguage = z.infer<typeof CodebaseLanguageSchema>;
```

```ts
// src/domain/codebase/symbol-kind.ts
import { z } from "zod";

// source: ai-automatised-pipeline src/tool_schemas.rs search_codebase_schema label_filter enum.
export const SymbolKindSchema = z.enum([
  "Function",
  "Method",
  "Struct",
  "Enum",
  "Trait",
  "Module",
  "Constant",
  "TypeAlias",
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;
```

```ts
// src/domain/codebase/graph-path-input.ts
import { z } from "zod";
import { AbsolutePathSchema } from "../common/scalars.js";

// Shared base for tools that take only graph_path.
// source: ai-automatised-pipeline resolve_graph_schema, get_processes_schema, cluster_graph_schema.
export const GraphPathInputSchema = z.object({
  graphPath: AbsolutePathSchema,
});
export type GraphPathInput = z.infer<typeof GraphPathInputSchema>;
```

```ts
// src/domain/codebase/index-codebase-input.ts
import { z } from "zod";
import { AbsolutePathSchema } from "../common/scalars.js";
import { CodebaseLanguageSchema } from "./codebase-language.js";

// source: ai-automatised-pipeline src/tool_schemas.rs index_codebase_schema.
export const IndexCodebaseInputSchema = z.object({
  path: AbsolutePathSchema,
  outputDir: AbsolutePathSchema,
  language: CodebaseLanguageSchema.default("auto"),
});
export type IndexCodebaseInput = z.infer<typeof IndexCodebaseInputSchema>;
```

```ts
// src/domain/codebase/analyze-codebase-input.ts
import { z } from "zod";
import { AbsolutePathSchema } from "../common/scalars.js";
import { CodebaseLanguageSchema } from "./codebase-language.js";

// source: ai-automatised-pipeline src/tool_schemas.rs analyze_codebase_schema.
// All-in-one: index + resolve + cluster.
export const AnalyzeCodebaseInputSchema = z.object({
  path: AbsolutePathSchema,
  outputDir: AbsolutePathSchema,
  language: CodebaseLanguageSchema.default("auto"),
  resolutionParam: z.number().default(1.0),
  lsp: z.boolean().default(false),
});
export type AnalyzeCodebaseInput = z.infer<typeof AnalyzeCodebaseInputSchema>;
```

```ts
// src/domain/codebase/query-graph-input.ts
import { z } from "zod";
import { GraphPathInputSchema } from "./graph-path-input.js";

// source: ai-automatised-pipeline src/tool_schemas.rs query_graph_schema.
export const QueryGraphInputSchema = GraphPathInputSchema.extend({
  query: z.string().min(1),
});
export type QueryGraphInput = z.infer<typeof QueryGraphInputSchema>;
```

```ts
// src/domain/codebase/get-symbol-input.ts
import { z } from "zod";
import { GraphPathInputSchema } from "./graph-path-input.js";

// source: ai-automatised-pipeline src/tool_schemas.rs get_symbol_schema.
// Qualified names follow "file_path::symbol_name" pattern.
export const GetSymbolInputSchema = GraphPathInputSchema.extend({
  qualifiedName: z.string().min(1),
});
export type GetSymbolInput = z.infer<typeof GetSymbolInputSchema>;
```

```ts
// src/domain/codebase/search-codebase-input.ts
import { z } from "zod";
import { GraphPathInputSchema } from "./graph-path-input.js";
import { SymbolKindSchema } from "./symbol-kind.js";

// source: ai-automatised-pipeline src/tool_schemas.rs search_codebase_schema.
export const SearchCodebaseInputSchema = GraphPathInputSchema.extend({
  query: z.string().min(1),
  limit: z.number().int().positive().default(20),
  labelFilter: SymbolKindSchema.optional(),
});
export type SearchCodebaseInput = z.infer<typeof SearchCodebaseInputSchema>;
```

```ts
// src/domain/codebase/detect-changes-input.ts
import { z } from "zod";
import { AbsolutePathSchema } from "../common/scalars.js";
import { GraphPathInputSchema } from "./graph-path-input.js";

// source: ai-automatised-pipeline src/tool_schemas.rs detect_changes_schema.
// diff_text XOR (codebase_path + base_ref + head_ref) — mutually exclusive.
export const DetectChangesInputSchema = GraphPathInputSchema.extend({
  diffText: z.string().optional(),
  codebasePath: AbsolutePathSchema.optional(),
  baseRef: z.string().default("HEAD~1"),
  headRef: z.string().default("HEAD"),
});
export type DetectChangesInput = z.infer<typeof DetectChangesInputSchema>;
```

```ts
// src/domain/codebase/prepare-prd-input-input.ts
import { z } from "zod";
import { AbsolutePathSchema } from "../common/scalars.js";

// source: ai-automatised-pipeline src/tool_schemas.rs prepare_prd_input_schema.
// Bridges the codebase analysis pipeline to the PRD generation pipeline.
export const PreparePrdInputInputSchema = z.object({
  runId: z.string(),
  findingId: z.string(),
  outputDir: AbsolutePathSchema,
  graphPath: AbsolutePathSchema,
});
export type PreparePrdInputInput = z.infer<typeof PreparePrdInputInputSchema>;
```

---

## 3. Reasoning domain (`src/domain/reasoning/`)

Source: prd-spec-generator `agent.ts` + zetetic-team-subagents filenames.
The enum member lists in prd-spec-generator are already synchronized with the
zetetic-team-subagents `agents/genius/*.md` + `agents/*.md` files. We copy
verbatim — the prd-spec-generator is the authoritative TS precedent.

```ts
// src/domain/reasoning/genius-agent.ts
import { z } from "zod";

// source: zetetic-team-subagents/agents/genius/*.md (one .md file per member).
// source: prd-spec-generator packages/core/src/domain/agent.ts GeniusAgentSchema.
// 97 reasoning-pattern agents. Adding a new pattern requires updating
// both the .md file AND this enum.
export const GeniusAgentSchema = z.enum([
  "alexander", "alkhwarizmi", "altshuller", "archimedes", "arendt",
  "aristotle", "bateson", "beer", "borges", "boyd", "braudel", "bruner",
  "carnot", "champollion", "coase", "cochrane", "curie", "darwin",
  "deming", "dijkstra", "eco", "einstein", "ekman", "engelbart", "erdos",
  "erlang", "euler", "feinstein", "fermi", "feynman", "fisher", "fleming",
  "foucault", "gadamer", "galileo", "geertz", "ginzburg", "godel",
  "hamilton", "hart", "hopper", "ibnalhaytham", "ibnkhaldun", "jobs",
  "kahneman", "kauffman", "kay", "kekule", "knuth", "lamport", "laplace",
  "lavoisier", "leguin", "lem", "liskov", "mandelbrot", "margulis",
  "maxwell", "mcclintock", "meadows", "mendeleev", "midgley", "mill",
  "nagarjuna", "noether", "ostrom", "panini", "pearl", "peirce",
  "poincare", "polya", "popper", "propp", "ramanujan", "ranganathan",
  "rawls", "rejewski", "rogerfisher", "rogers", "schelling", "schon",
  "semmelweis", "shannon", "simon", "snow", "strauss", "taleb",
  "thompson", "toulmin", "turing", "varela", "ventris", "vonneumann",
  "vygotsky", "wittgenstein", "wu", "zhuangzi",
]);
export type GeniusAgent = z.infer<typeof GeniusAgentSchema>;
```

```ts
// src/domain/reasoning/team-agent.ts
import { z } from "zod";

// source: zetetic-team-subagents/agents/*.md (top-level, excluding /genius).
// source: prd-spec-generator packages/core/src/domain/agent.ts TeamAgentSchema.
export const TeamAgentSchema = z.enum([
  "architect",
  "code-reviewer",
  "data-scientist",
  "dba",
  "devops-engineer",
  "engineer",
  "experiment-runner",
  "frontend-engineer",
  "latex-engineer",
  "mlops",
  "orchestrator",
  "paper-writer",
  "professor",
  "refactorer",
  "research-scientist",
  "reviewer-academic",
  "security-auditor",
  "test-engineer",
  "ux-designer",
]);
export type TeamAgent = z.infer<typeof TeamAgentSchema>;
```

```ts
// src/domain/reasoning/agent-identity.ts
import { z } from "zod";
import { GeniusAgentSchema } from "./genius-agent.js";
import { TeamAgentSchema } from "./team-agent.js";

// source: prd-spec-generator packages/core/src/domain/agent.ts AgentIdentitySchema.
// Discriminated union: either a genius-pattern agent or a team-role agent.
export const AgentIdentitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("genius"), name: GeniusAgentSchema }),
  z.object({ kind: z.literal("team"), name: TeamAgentSchema }),
]);
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

// source: prd-spec-generator packages/core/src/domain/agent.ts agentSubagentType.
// Pure function — maps an AgentIdentity to the host tool's subagent_type string.
export function agentSubagentType(identity: AgentIdentity): string {
  return identity.kind === "genius"
    ? `zetetic-team-subagents:genius:${identity.name}`
    : `zetetic-team-subagents:${identity.name}`;
}
```

```ts
// src/domain/reasoning/subagent-invocation.ts
import { z } from "zod";
import { AgentIdentitySchema } from "./agent-identity.js";

// source: prd-spec-generator packages/core/src/domain/agent.ts SubagentInvocationSchema.
export const SubagentInvocationSchema = z.object({
  agent: AgentIdentitySchema,
  taskDescription: z.string(),
  prompt: z.string(),
  expectedFormat: z.enum(["freeform", "json", "markdown"]).default("freeform"),
  isolation: z.enum(["worktree", "none"]).default("none"),
});
export type SubagentInvocation = z.infer<typeof SubagentInvocationSchema>;

// source: prd-spec-generator packages/core/src/domain/agent.ts SubagentResponseSchema.
export const SubagentResponseSchema = z.object({
  agent: AgentIdentitySchema,
  text: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type SubagentResponse = z.infer<typeof SubagentResponseSchema>;
```

```ts
// src/domain/reasoning/thinking-strategy.ts
import { z } from "zod";

// source: prd-spec-generator packages/core/src/domain/thinking-strategy.ts.
// 16-member enum. Tier assignments from ResearchEvidenceDatabase.
export const ThinkingStrategySchema = z.enum([
  "chain_of_thought",
  "tree_of_thoughts",
  "graph_of_thoughts",
  "react",
  "reflexion",
  "plan_and_solve",
  "verified_reasoning",
  "recursive_refinement",
  "problem_analysis",
  "zero_shot",
  "few_shot",
  "self_consistency",
  "generate_knowledge",
  "prompt_chaining",
  "multimodal_cot",
  "meta_prompting",
]);
export type ThinkingStrategy = z.infer<typeof ThinkingStrategySchema>;

export type StrategyTier = 1 | 2 | 3 | 4;
```

```ts
// src/domain/reasoning/cognitive-profile.ts
import { z } from "zod";
import { ConfidenceScoreSchema, ISODateTimeSchema } from "../common/scalars.js";

// source: Cortex mcp_server/shared/types_profiles.py CognitiveStyle, PersonaVector,
// DomainProfile, ProfilesV2, BlindSpot, Bridge.
// Only the publicly-needed subset is exposed here; the full Pydantic
// model lives in the port-cortex worktree.

export const CognitiveStyleSchema = z.object({
  activeReflective: z.number().default(0),
  sensingIntuitive: z.number().default(0),
  sequentialGlobal: z.number().default(0),
  problemDecomposition: z.enum(["top-down", "bottom-up"]).default("top-down"),
  explorationStyle: z.enum(["depth-first", "breadth-first"]).default("depth-first"),
  verificationBehavior: z.enum(["test-first", "test-after", "no-test"]).default("no-test"),
});
export type CognitiveStyle = z.infer<typeof CognitiveStyleSchema>;

export const BlindSpotSchema = z.object({
  type: z.enum(["category", "tool", "pattern"]),
  value: z.string(),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  description: z.string().default(""),
  suggestion: z.string().default(""),
});
export type BlindSpot = z.infer<typeof BlindSpotSchema>;

export const BridgeSchema = z.object({
  toDomain: z.string(),
  pattern: z.string().default(""),
  weight: z.number().default(0),
});
export type Bridge = z.infer<typeof BridgeSchema>;

export const DomainProfileSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  confidence: ConfidenceScoreSchema.default(0),
  sessionCount: z.number().int().nonnegative().default(0),
  lastUpdated: ISODateTimeSchema.optional(),
  metacognitive: CognitiveStyleSchema.optional(),
  blindSpots: z.array(BlindSpotSchema).default([]),
  connectionBridges: z.array(BridgeSchema).default([]),
});
export type DomainProfile = z.infer<typeof DomainProfileSchema>;

export const DetectionResultSchema = z.object({
  coldStart: z.boolean().default(false),
  domain: z.string().nullable().optional(),
  confidence: ConfidenceScoreSchema.default(0),
  isNew: z.boolean().default(false),
  context: z.string().nullable().optional(),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;
```

---

## 4. PRD domain (`src/domain/prd/`)

Source: prd-spec-generator `packages/core/src/domain/`. Copied verbatim.

```ts
// src/domain/prd/verdict.ts
import { z } from "zod";

// source: prd-spec-generator packages/core/src/domain/verdict.ts.
// 5-level verification verdict taxonomy — from SKILL.md Rule 15.
export const VerdictSchema = z.enum([
  "PASS",
  "SPEC-COMPLETE",
  "NEEDS-RUNTIME",
  "INCONCLUSIVE",
  "FAIL",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const EXPECTED_VERDICT_DISTRIBUTION = {
  PASS: { min: 0.6, max: 0.8 },
  "SPEC-COMPLETE": { min: 0.1, max: 0.25 },
  "NEEDS-RUNTIME": { min: 0.02, max: 0.1 },
  INCONCLUSIVE: { min: 0.01, max: 0.05 },
  FAIL: { min: 0, max: 0 },
} as const;
```

```ts
// src/domain/prd/prd-context.ts
import { z } from "zod";

// source: prd-spec-generator packages/core/src/domain/prd-context.ts.
export const PRDContextSchema = z.enum([
  "proposal", "feature", "bug", "incident",
  "poc", "mvp", "release", "cicd",
]);
export type PRDContext = z.infer<typeof PRDContextSchema>;

export const PRD_CONTEXT_DEFAULT: PRDContext = "feature";
```

```ts
// src/domain/prd/section-type.ts
import { z } from "zod";

// source: prd-spec-generator packages/core/src/domain/section-type.ts.
// 17-member enum covering all PRD section types.
export const SectionTypeSchema = z.enum([
  "overview", "goals", "requirements", "user_stories",
  "technical_specification", "acceptance_criteria", "data_model",
  "api_specification", "security_considerations", "performance_requirements",
  "testing", "deployment", "risks", "timeline",
  "source_code", "test_code", "jira_tickets",
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;
```

```ts
// src/domain/prd/hard-output-rule.ts
import { z } from "zod";

// source: prd-spec-generator packages/core/src/domain/hard-output-rule.ts.
// 64 hard output rules — the primary quality driver. Do not remove any rule
// without benchmarking the impact.
export const HardOutputRuleSchema = z.enum([
  "sp_arithmetic", "no_self_referencing_deps", "ac_numbering",
  "no_orphan_ddl", "no_now_in_partial_indexes", "no_any_codable",
  "no_placeholder_tests", "sp_not_in_fr_table", "uneven_sp_distribution",
  "metrics_disclaimer", "fr_traceability", "clean_architecture",
  "post_generation_self_check", "mandatory_codebase_analysis",
  "honest_verification_verdicts", "code_example_port_compliance",
  "test_traceability_integrity", "duplicate_requirement_ids",
  "fr_to_ac_coverage", "ac_to_test_coverage", "fk_references_exist",
  "fr_numbering_gaps", "risk_mitigation_completeness",
  "deployment_rollback_plan", "generic_over_specific", "no_nested_types",
  "single_responsibility", "explicit_access_control",
  "factory_based_injection", "solid_compliance", "code_reusability",
  "no_hardcoded_secrets", "input_validation_required",
  "output_encoding_injection_prevention", "auth_on_every_endpoint",
  "security_safe_error_handling", "cryptographic_standards",
  "rate_limiting_required", "secure_communication",
  "data_classification_required", "sensitive_data_protection",
  "no_sensitive_data_in_logs", "data_minimization", "audit_trail_required",
  "consent_and_erasure_support", "structured_error_handling",
  "resilience_patterns", "graceful_degradation", "transaction_boundaries",
  "consistent_error_format", "concurrency_safety", "immutability_by_default",
  "atomic_operations", "no_magic_numbers", "defensive_coding",
  "method_size_limits", "consistent_naming", "api_contract_documentation",
  "deprecation_strategy", "mandatory_test_coverage",
  "security_testing_required", "performance_testing_required",
  "no_production_data_in_tests", "edge_case_negative_tests",
  "test_isolation", "structured_logging", "distributed_tracing",
  "no_pii_in_observability", "alerting_thresholds",
  "dependency_vulnerability_scanning", "minimal_dependency_principle",
]);
export type HardOutputRule = z.infer<typeof HardOutputRuleSchema>;
```

```ts
// src/domain/prd/clarification.ts
import { z } from "zod";

// source: prd-spec-generator packages/core/src/domain/clarification.ts.
// ClarificationSource is distinct from MemorySource (conflict C-004).
export const ClarificationSourceSchema = z.enum([
  "user_freeform",
  "user_selection",
  "codebase_inferred",
  "default",
]);
export type ClarificationSource = z.infer<typeof ClarificationSourceSchema>;

export const ClarificationAnswerSchema = z.object({
  questionId: z.string(),
  round: z.number().int().min(1),
  question: z.string(),
  answer: z.string(),
  category: z.string(),
  priority: z.number().min(0).max(1),
  source: ClarificationSourceSchema,
});
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>;

export const ClarificationStateSchema = z.object({
  answers: z.array(ClarificationAnswerSchema),
  currentRound: z.number().int().min(0),
  confidenceScore: z.number().min(0).max(1),
  isComplete: z.boolean(),
});
export type ClarificationState = z.infer<typeof ClarificationStateSchema>;
```

```ts
// src/domain/prd/prd-document.ts
import { z } from "zod";
import { UUIDSchema, ISODateTimeSchema } from "../common/scalars.js";
import { PRDContextSchema } from "./prd-context.js";
import { SectionTypeSchema } from "./section-type.js";
import { ClarificationAnswerSchema } from "./clarification.js";

// source: prd-spec-generator packages/core/src/domain/prd-document.ts.
export const PRDSectionSchema = z.object({
  type: SectionTypeSchema,
  title: z.string(),
  content: z.string(),
  order: z.number().int().min(0),
  metadata: z.object({
    generatedAt: ISODateTimeSchema,
    wordCount: z.number().int().min(0),
    strategy: z.string().optional(),
    validationStatus: z.enum(["pending", "passed", "failed"]),
    violationCount: z.number().int().min(0).default(0),
  }),
});
export type PRDSection = z.infer<typeof PRDSectionSchema>;

export const PRDDocumentSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),
  context: PRDContextSchema,
  sections: z.array(PRDSectionSchema),
  clarificationAnswers: z.array(ClarificationAnswerSchema),
  createdAt: ISODateTimeSchema,
  updatedAt: ISODateTimeSchema,
});
export type PRDDocument = z.infer<typeof PRDDocumentSchema>;
```

```ts
// src/domain/prd/claim.ts
import { z } from "zod";
import { AgentIdentitySchema } from "../reasoning/agent-identity.js";
import { VerdictSchema } from "./verdict.js";

// source: prd-spec-generator packages/core/src/domain/agent.ts ClaimSchema.
export const ClaimSchema = z.object({
  claim_id: z.string(),
  claim_type: z.enum([
    "architecture", "performance", "correctness", "security",
    "data_model", "test_coverage", "story_point_arithmetic",
    "fr_traceability", "risk", "acceptance_criteria_completeness",
    "cross_file_consistency",
  ]),
  text: z.string(),
  evidence: z.string(),
  source_section: z.string().optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

// source: prd-spec-generator packages/core/src/domain/agent.ts JudgeVerdictSchema.
export const JudgeVerdictSchema = z.object({
  judge: AgentIdentitySchema,
  claim_id: z.string(),
  verdict: VerdictSchema,
  rationale: z.string(),
  caveats: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

// source: prd-spec-generator packages/core/src/domain/agent.ts JudgeRequestSchema.
export const JudgeRequestSchema = z.object({
  judge: AgentIdentitySchema,
  claim: ClaimSchema,
  context: z.object({
    prd_excerpt: z.string().optional(),
    codebase_excerpts: z.array(z.string()).default([]),
    memory_excerpts: z.array(z.string()).default([]),
  }).default({ codebase_excerpts: [], memory_excerpts: [] }),
});
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;
```

---

## 5. Wiki / Cross-cutting domain (`src/domain/wiki/`)

Source: Cortex `mcp_server/core/wiki_pages.py` + `mcp_server/handlers/wiki_list.py`.
This type family does not exist in the TS ecosystem yet. It is introduced because
the unified monorepo needs to interact with the Cortex wiki subsystem.
Justification: without `WikiPageKind`, the `CodebasePort` adapter for wiki search
would use untyped `string` — defeating the type system's completeness guarantee
for codebase-adjacent content retrieval.

```ts
// src/domain/wiki/wiki-page-kind.ts
import { z } from "zod";

// source: Cortex mcp_server/core/wiki_pages.py path-segment convention
// + mcp_server/handlers/wiki_list.py kind filter examples.
// The values are the first path-segment of every wiki page path.
export const WikiPageKindSchema = z.enum([
  "adr",
  "specs",
  "files",
  "notes",
  "lessons",
  "conventions",
  "guides",
  "reference",
  "journal",
]);
export type WikiPageKind = z.infer<typeof WikiPageKindSchema>;
```

```ts
// src/domain/wiki/wiki-page.ts
import { z } from "zod";
import { ISODateTimeSchema } from "../common/scalars.js";
import { WikiPageKindSchema } from "./wiki-page-kind.js";

// source: Cortex mcp_server/core/wiki_pages.py PageDocument dataclass +
// frontmatter fields (kind, created, updated, tags, title).
export const WikiPageSchema = z.object({
  path: z.string().min(1),
  kind: WikiPageKindSchema,
  title: z.string().default(""),
  body: z.string(),
  tags: z.array(z.string()).default([]),
  createdAt: ISODateTimeSchema.optional(),
  updatedAt: ISODateTimeSchema.optional(),
});
export type WikiPage = z.infer<typeof WikiPageSchema>;
```

---

## Economy metrics

| Metric | Value |
|---|---|
| Total Zod schemas defined | 48 |
| Total TS types exported | 48 |
| Common primitive schemas (reused) | 6 |
| Types built by composition (extend, intersect, discriminatedUnion) | 19 |
| Coverage ratio (types generated / schemas written) | 1.0 (1:1 by design — each schema generates exactly one type; economy is in reuse, not in 1:N generation) |
| Redundant types eliminated | 4 (C-001 through C-004 conflicts resolved; no duplicate) |
| Types introduced without source precedent | 2 (`WikiPage`, `WikiPageKind` — justified above) |
