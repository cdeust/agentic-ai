/**
 * Handler: get_project_story — retrieve structured project narrative.
 *
 * source: cortex@ed33435 mcp_server/handlers/get_project_story.py
 * Layer: narrative/handlers — application layer
 */

import type { MemoryPort } from "./narrative.js";

export interface GetProjectStoryResponse {
  domain: string;
  memoriesFound: number;
  summary: string;
  hotTopics: string[];
  sessionCount: number;
}

/**
 * Retrieve a structured project story from memory.
 *
 * precondition:  store is a valid MemoryPort.
 * postcondition: returns GetProjectStoryResponse with memoriesFound >= 0.
 *
 * source: cortex@ed33435 mcp_server/handlers/get_project_story.py::handler
 */
export function getProjectStoryHandler(
  store: MemoryPort,
  args: { domain?: string; max_memories?: number },
): GetProjectStoryResponse {
  const domain = args.domain?.trim() ?? "default";
  const limit = args.max_memories ?? 50; // source: cortex@ed33435 get_project_story.py:50 default
  const memories = store.getMemoriesForDomain(domain, 0.0, limit);
  const hotMemories = memories.filter((m) => m.heat >= 0.5); // source: narrative.py heat threshold 0.5
  const hotTopics = hotMemories.flatMap((m) => (Array.isArray(m.tags) ? m.tags : []));
  const uniqueTopics = [...new Set(hotTopics)].slice(0, 10); // source: cortex@ed33435 get_project_story.py:max_topics=10
  const summary =
    memories.length === 0
      ? `No memories found for domain "${domain}".`
      : `Found ${memories.length.toString()} memories for domain "${domain}". Hot topics: ${uniqueTopics.join(", ") || "none"}.`;
  return { domain, memoriesFound: memories.length, summary, hotTopics: uniqueTopics, sessionCount: 0 };
}
