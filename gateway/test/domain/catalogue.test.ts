import { expect, it } from 'vitest';
import { ToolCatalogue } from '../../src/domain/catalogue.js';
import { buildCatalogue } from '../../src/main.js';

it('finds and lists descriptors', () => {
  const catalogue = new ToolCatalogue([{ name: 'a', description: 'd', owner: 'memory' }]);
  expect(catalogue.find('a')?.owner).toBe('memory');
  expect(catalogue.find('b')).toBeUndefined();
  expect(catalogue.list()).toHaveLength(1);
});

it('derives the production catalogue from the shared tool contracts', () => {
  expect(
    buildCatalogue()
      .list()
      .map((t) => [t.name, t.owner]),
  ).toEqual([
    ['recall', 'memory'],
    ['remember', 'memory'],
  ]);
});
