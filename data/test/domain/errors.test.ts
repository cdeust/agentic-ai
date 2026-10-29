import { expect, it } from 'vitest';
import { InvalidInputError, InvalidOperationError, NotFoundError } from '../../src/domain/errors.js';

it('names every domain error with a stable code', () => {
  expect(new NotFoundError('run', 'r1')).toMatchObject({ code: 'NOT_FOUND', message: 'run r1 not found' });
  expect(new InvalidOperationError('x').code).toBe('INVALID_OPERATION');
  expect(new InvalidInputError('x').code).toBe('INVALID_INPUT');
});
