import type { DataOpInput, DataOpName } from '@agentic-ai/contracts';

/**
 * Executes one typed data operation on validated input. Rejects with DataError
 * (NOT_FOUND, INVALID_OPERATION) for the named failures; there is no free-form query.
 */
export interface DataStore {
  execute<Op extends DataOpName>(op: Op, input: DataOpInput<Op>): Promise<unknown>;
}
