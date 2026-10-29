/** Named failure of a data operation. The HTTP API maps the code to a status. */
export type DataErrorCode = 'NOT_FOUND' | 'INVALID_OPERATION' | 'INVALID_INPUT';

export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DataError';
  }
}
