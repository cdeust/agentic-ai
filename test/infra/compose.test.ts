import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

const compose = parse(readFileSync(join(ROOT, 'compose.yaml'), 'utf8')) as Compose;
const on = (network: string) =>
  Object.entries(compose.services)
    .filter(([, s]) => s.networks?.includes(network))
    .map(([name]) => name)
    .sort();

describe('compose.yaml network zones', () => {
  it('declares the four zones', () => {
    expect(Object.keys(compose.networks).sort()).toEqual(['app', 'data', 'exec', 'public']);
  });

  it('exposes the proxy only: it alone is on public and alone publishes a port', () => {
    expect(on('public')).toEqual(['proxy']);
    const published = Object.entries(compose.services).filter(([, s]) => (s.ports ?? []).length > 0);
    expect(published.map(([name]) => name)).toEqual(['proxy']);
  });

  it('puts gateway, memory, data (and the proxy) on app; only data and postgres on data', () => {
    expect(on('app')).toEqual(['data', 'gateway', 'memory', 'proxy']);
    expect(on('data')).toEqual(['data', 'postgres']);
  });

  it('keeps workers away from data: exec carries memory only, and postgres is on no other zone', () => {
    expect(on('exec')).toEqual(['memory']);
    expect(compose.services['postgres']?.networks).toEqual(['data']);
  });

  it('makes every zone except public internal (no route to the outside)', () => {
    expect(compose.networks['public']?.internal).toBeUndefined();
    for (const zone of ['app', 'exec', 'data']) expect(compose.networks[zone]?.internal).toBe(true);
  });

  it('drops all capabilities on every long-running service', () => {
    for (const [name, service] of Object.entries(compose.services)) {
      if (service.profiles?.includes('build-only') || name === 'postgres') continue;
      expect(service.cap_drop, name).toEqual(['ALL']);
    }
  });
});
