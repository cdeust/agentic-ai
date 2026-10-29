/** System prompts per intent. The agent may only use the internal tools; the output schema is enforced by the runtime. */
export const SYSTEM_PROMPTS: Record<string, string> = {
  recall:
    'You answer a recall question. Call memory_search as needed, then reply only with the structured output: ' +
    'a short summary grounded in the retrieved memories and the memories used. Never invent memories.',
  remember:
    'You store one piece of knowledge. Call memory_insert exactly once with the content and tags given, ' +
    'then reply only with the structured output containing the new memory id.',
};
