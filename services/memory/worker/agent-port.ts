import type { Cost, Evidence, MemoryItem } from '@agentic-ai/contracts';

/** Tools the agent may call. Served by the memory service on the exec network. */
export interface InternalTools {
  search(query: string, limit: number): Promise<MemoryItem[]>;
  insert(content: string, tags: string[]): Promise<{ id: string }>;
}

export interface AgentRequest {
  tool: string;
  input: unknown;
  systemPrompt: string;
  /** JSON Schema the structured output must satisfy. */
  outputSchema: Record<string, unknown>;
  limits: { maxTurns: number; maxBudgetUsd: number };
  tools: InternalTools;
}

export interface AgentOutcome {
  structured: unknown;
  evidence: Evidence[];
  cost: Cost;
}

/** Port to the agent runtime. The Claude Agent SDK adapter is sdk-agent.ts; tests inject a scripted agent. */
export interface AgentPort {
  run(request: AgentRequest): Promise<AgentOutcome>;
}
