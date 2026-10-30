import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ArchitectWorld } from '../support/world.js';
import { Given, ROOT, Then, list, stored } from './helpers.js';

interface Service {
  networks?: string[];
  ports?: string[];
  profiles?: string[];
  volumes?: string[];
  cap_drop?: string[];
}
interface Compose {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean }>;
}

const compose = (world: ArchitectWorld) => stored<Compose>(world, 'compose');

Given('the parsed compose.yaml', function () {
  this.state['compose'] = parse(readFileSync(join(ROOT, 'compose.yaml'), 'utf8')) as Compose;
});

Then('the compose networks are {string}', function (expected: string) {
  assert.deepEqual(Object.keys(compose(this).networks).sort(), list(expected));
});

Then(
  'the compose services on the network {string} are {string}',
  function (network: string, expected: string) {
    const on = Object.entries(compose(this).services)
      .filter(([, s]) => s.networks?.includes(network))
      .map(([name]) => name)
      .sort();
    assert.deepEqual(on, list(expected));
  },
);

Then('the compose services that publish a port are {string}', function (expected: string) {
  const published = Object.entries(compose(this).services).filter(([, s]) => (s.ports ?? []).length > 0);
  assert.deepEqual(
    published.map(([name]) => name),
    list(expected),
  );
});

Then('the networks of the compose service {string} are {string}', function (name: string, expected: string) {
  assert.deepEqual(compose(this).services[name]?.networks, list(expected));
});

Then('the compose network {string} is not internal', function (network: string) {
  assert.equal(compose(this).networks[network]?.internal, undefined);
});

Then('the compose network {string} is internal', function (network: string) {
  assert.equal(compose(this).networks[network]?.internal, true);
});

Then('every compose service drops all capabilities, except the build-only ones and postgres', function () {
  for (const [name, service] of Object.entries(compose(this).services)) {
    if (service.profiles?.includes('build-only') || name === 'postgres') continue;
    assert.deepEqual(service.cap_drop, ['ALL'], name);
  }
});
