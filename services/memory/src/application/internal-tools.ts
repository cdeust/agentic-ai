import { INTERNAL_TOOLS, type InternalToolName } from '@architect-os/contracts';
import type { DataPort } from '../domain/ports.js';

export type InternalToolAnswer =
  { ok: true; value: unknown } | { ok: false; status: 400 | 404; message: string };

/** Tools the worker's agent may call back into: each validates its input and runs its data operation. */
export class InternalToolService {
  constructor(
    private readonly data: DataPort,
    private readonly owner: string,
  ) {}

  async call(name: string, raw: unknown): Promise<InternalToolAnswer> {
    const tool = Object.hasOwn(INTERNAL_TOOLS, name) ? INTERNAL_TOOLS[name as InternalToolName] : undefined;
    if (tool === undefined || tool.owner !== this.owner)
      return { ok: false, status: 404, message: 'no such tool' };
    const input = tool.input.safeParse(raw);
    if (!input.success) return { ok: false, status: 400, message: input.error.message };
    return { ok: true, value: await this.data.call(tool.op, input.data) };
  }
}
