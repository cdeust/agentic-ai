import { ServiceError, timeoutError } from '../../src/domain/ports.js';
import { Then, assertMatches } from './helpers.js';

Then('a worker timeout error of {int} ms matches {string}', function (ms: number, expected: string) {
  assertMatches(timeoutError(ms), JSON.parse(expected));
});

Then(
  'a ServiceError with code {string} and message {string} matches {string}',
  function (code: string, message: string, expected: string) {
    assertMatches(new ServiceError(code as ServiceError['code'], message), JSON.parse(expected));
  },
);
