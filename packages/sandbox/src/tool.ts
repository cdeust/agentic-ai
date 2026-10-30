import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Description d'un outil lancé sous srt : `code.json` pour l'outil de code de 1a.0. */
export const ToolSchema = z.strictObject({
  description: z.string().min(1),
  /** Gabarit de `profiles/`. */
  profile: z.string().min(1),
  /** argv de base ; les arguments de l'appelant suivent. */
  command: z.array(z.string().min(1)).min(1),
  /** Plugins chargés pour la session par `--plugin-dir`, relatifs à la racine du checkout du lanceur. */
  pluginDirs: z.array(z.string().min(1)),
});
export type Tool = z.infer<typeof ToolSchema>;

export const parseTool = (raw: unknown): Tool => ToolSchema.parse(raw);
export const loadTool = (file: string): Tool => parseTool(JSON.parse(readFileSync(file, 'utf8')));
