import { expect, it } from 'vitest';
import { ServiceError, timeoutError } from '../../src/domain/ports.js';

it('names adapter failures with the Result error code they stand for', () => {
  expect(timeoutError(250)).toMatchObject({ code: 'WORKER_TIMEOUT', message: 'worker exceeded 250 ms' });
  expect(new ServiceError('DATA_UNAVAILABLE', 'down')).toMatchObject({
    name: 'ServiceError',
    code: 'DATA_UNAVAILABLE',
  });
});
