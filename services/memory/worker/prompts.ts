import { readFile } from 'node:fs/promises';
import { TOOLS, TOOL_NAMES } from '@architect-os/contracts';

/** Directory of the system prompts, one `<tool>.md` per intent tool (copied next to dist/worker in the image). */
export const PROMPTS_DIR = new URL('./prompts/', import.meta.url);

/**
 * Loads the system prompt of every intent tool this worker serves. Rejects when one is missing or empty,
 * so a broken prompt directory fails at start (and in `npm test`) instead of on the first call.
 */
export async function loadPrompts(directory: URL, owner = 'memory'): Promise<Record<string, string>> {
  const prompts: Record<string, string> = {};
  for (const tool of TOOL_NAMES.filter((name) => TOOLS[name].owner === owner)) {
    const text = (await readFile(new URL(`${tool}.md`, directory), 'utf8')).trim();
    if (text === '') throw new Error(`prompt ${tool}.md is empty`);
    prompts[tool] = text;
  }
  return prompts;
}
