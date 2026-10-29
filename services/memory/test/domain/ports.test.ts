import { expect, it } from 'vitest';
import { DataUnavailableError, WorkerTimeoutError, WorkerUnavailableError } from '../../src/domain/ports.js';

it('names the domain errors the application maps to Result error codes', () => {
  expect(new WorkerTimeoutError(250)).toMatchObject({
    name: 'WorkerTimeoutError',
    message: 'worker exceeded 250 ms',
  });
  expect(new WorkerUnavailableError('no docker').name).toBe('WorkerUnavailableError');
  expect(new DataUnavailableError('down').name).toBe('DataUnavailableError');
});
