import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTool, parseTool, type Tool } from '../../src/tool.js';
import { PKG, ROOT, Then, When, stored } from './helpers.js';

const committed = (): Record<string, any> =>
  JSON.parse(readFileSync(join(PKG, 'code.json'), 'utf8')) as Record<string, any>;

// Named defects of the committed file, one per row of the "rejects a broken copy" Examples.
const DEFECTS: Record<string, (t: Record<string, any>) => unknown> = {
  'a misspelt key': (t) => (t['plugins'] = []),
  'an empty command': (t) => (t['command'] = []),
  'a plain-http upstream': (t) => (t['authProxy']['upstream'] = 'http://api.anthropic.com'),
  'an unanchored route': (t) => (t['authProxy']['routes'] = ['/v1/messages']),
};

When('I load the committed code.json', function () {
  this.state['tool'] = loadTool(join(PKG, 'code.json'));
});

Then('the tool profile is {string}', function (profile: string) {
  assert.equal(stored<Tool>(this, 'tool').profile, profile);
});

Then('the tool command is exactly {string}', function (command: string) {
  assert.deepEqual(stored<Tool>(this, 'tool').command, [command]);
});

Then('the tool plugin directories are exactly {string}', function (dir: string) {
  assert.deepEqual(stored<Tool>(this, 'tool').pluginDirs, [dir]);
});

Then('the tool auth proxy upstream is {string}', function (upstream: string) {
  assert.equal(stored<Tool>(this, 'tool').authProxy.upstream, upstream);
});

Then('the plugin manifest of the first plugin directory exists in the repository', function () {
  const dir = stored<Tool>(this, 'tool').pluginDirs[0] as string;
  assert.doesNotThrow(() => readFileSync(join(ROOT, dir, '.claude-plugin', 'plugin.json')));
});

When('I break a copy of the committed code.json with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const broken = committed();
  breakIt(broken);
  this.state['broken'] = broken;
});

Then('parsing the broken code.json fails', function () {
  assert.throws(() => parseTool(stored(this, 'broken')));
});
