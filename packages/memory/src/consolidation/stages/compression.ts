/**
 * Compression stage: memory content compression.
 *
 * Full-text → gist → tag compression for cold but informative memories.
 * Operates on memories below a heat threshold.
 *
 * Port of: mcp_server/handlers/consolidation/compression.py
 */

export interface CompressionStore {
  getColdMemories(heatThreshold: number, limit: number): Promise<Record<string, unknown>[]>;
  compressMemoryToGist(id: number, gist: string): Promise<void>;
  compressMemoryToTags(id: number, tags: string[]): Promise<void>;
}

export interface CompressionSettings {
  COLD_THRESHOLD: number;
}

export interface CompressionStageResult {
  compressed_to_gist: number;
  compressed_to_tag: number;
  scanned: number;
  duration_ms?: number;
}

const GIST_HEAT_MAX = 0.2;
const TAG_HEAT_MAX = 0.1;
const MAX_GIST_LENGTH = 200;

function extractGist(content: string): string {
  // Simple gist: take first sentence or first MAX_GIST_LENGTH characters.
  const firstSentence = content.split(/[.!?]\s/)[0] ?? "";
  const gist = firstSentence.length > 0 ? firstSentence : content.slice(0, MAX_GIST_LENGTH);
  return gist.slice(0, MAX_GIST_LENGTH);
}

function extractTags(content: string, existingTags: string[]): string[] {
  if (existingTags.length > 0) return existingTags.slice(0, 5);
  // Fallback: first 5 words as tags
  return content
    .split(/\s+/)
    .slice(0, 5)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 2);
}

/** Run compression cycle: full-text → gist → tag for cold memories. */
export async function runCompressionCycle(
  store: CompressionStore,
  settings: CompressionSettings,
  _embeddings: unknown,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<CompressionStageResult> {
  const coldMemories = memories
    ? memories.filter((m) => ((m["heat"] as number | undefined) ?? 0) < settings.COLD_THRESHOLD)
    : await store.getColdMemories(settings.COLD_THRESHOLD, 500);

  let compressedToGist = 0;
  let compressedToTag = 0;

  for (const mem of coldMemories) {
    const heat = (mem["heat"] as number | undefined) ?? 0;
    const content = (mem["content"] as string | undefined) ?? "";
    const id = mem["id"] as number;

    if (heat <= TAG_HEAT_MAX && content.length > 50) {
      const existingTags = (mem["tags"] as string[] | undefined) ?? [];
      const tags = extractTags(content, existingTags);
      await store.compressMemoryToTags(id, tags);
      compressedToTag++;
    } else if (heat <= GIST_HEAT_MAX && content.length > MAX_GIST_LENGTH) {
      const gist = extractGist(content);
      await store.compressMemoryToGist(id, gist);
      compressedToGist++;
    }
  }

  return {
    compressed_to_gist: compressedToGist,
    compressed_to_tag: compressedToTag,
    scanned: coldMemories.length,
  };
}
