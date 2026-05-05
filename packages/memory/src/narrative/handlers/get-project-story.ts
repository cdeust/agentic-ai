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
// source: cortex@ed33435 get_project_story.py:50 default
const GET_PROJECT_STORY_DEFAULT_LIMIT = 50;
// source: narrative.py heat threshold 0.5
const HOT_MEMORY_HEAT_THRESHOLD = 0.5;
// source: cortex@ed33435 get_project_story.py:max_topics=10
const GET_PROJECT_STORY_MAX_TOPICS = 10;

export function getProjectStoryHandler(
  store: MemoryPort,
  args: { domain?: string; max_memories?: number; directory?: string; period?: string; max_chapters?: number },
): GetProjectStoryResponse {
  const domain = args.domain?.trim() ?? "default";
  const limit = args.max_chapters ?? args.max_memories ?? GET_PROJECT_STORY_DEFAULT_LIMIT;
  const memories = store.getMemoriesForDomain(domain, 0.0, limit);
  const hotMemories = memories.filter((m) => m.heat >= HOT_MEMORY_HEAT_THRESHOLD);
  const hotTopics = hotMemories.flatMap((m) => (Array.isArray(m.tags) ? m.tags : []));
  const uniqueTopics = [...new Set(hotTopics)].slice(0, GET_PROJECT_STORY_MAX_TOPICS);
  const summary =
    memories.length === 0
      ? `No memories found for domain "${domain}".`
      : `Found ${memories.length.toString()} memories for domain "${domain}". Hot topics: ${uniqueTopics.join(", ") || "none"}.`;
  return { domain, memoriesFound: memories.length, summary, hotTopics: uniqueTopics, sessionCount: 0 };
}
