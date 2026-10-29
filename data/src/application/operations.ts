import { DATA_OPS, type DataOpName } from '@agentic-ai/contracts';
import { DataError } from '../domain/errors.js';
import type { DataStore } from '../domain/ports.js';

/** The complete surface of the data component: input and output of every operation are checked against its contract. */
export class DataOperations {
  constructor(private readonly store: DataStore) {}

  has(op: string): op is DataOpName {
    return Object.hasOwn(DATA_OPS, op);
  }

  async execute(op: DataOpName, raw: unknown): Promise<unknown> {
    const input = DATA_OPS[op].input.safeParse(raw);
    if (!input.success) throw new DataError('INVALID_INPUT', input.error.message);
    const output = DATA_OPS[op].output.safeParse(await this.store.execute(op, input.data as never));
    if (!output.success)
      throw new Error(`the store answered ${op} outside its contract: ${output.error.message}`);
    return output.data;
  }
}
