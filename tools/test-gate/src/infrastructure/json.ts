import { z } from 'zod';
import type { ReadFailure } from '../domain/violation.js';

/** A value as the gate writes JSON: indented by two spaces, one final newline. */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** JSON text checked against a zod schema (z.prettifyError: node_modules/zod/v4/core/errors.d.ts). */
export function parseJson<T>(schema: z.ZodType<T>, text: string): T | ReadFailure {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { failure: `JSON invalide : ${(error as Error).message}` };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? parsed.data
    : { failure: `hors schéma : ${z.prettifyError(parsed.error).replaceAll('\n', ' ')}` };
}
