export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(what: string, id: string) {
    super(`${what} ${id} not found`);
    this.name = 'NotFoundError';
  }
}

export class InvalidOperationError extends Error {
  readonly code = 'INVALID_OPERATION';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationError';
  }
}

export class InvalidInputError extends Error {
  readonly code = 'INVALID_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}
