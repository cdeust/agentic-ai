// E-03 : enfant hostile sous srt. Modes : garbage, huge, die, forged.
const mode = process.argv[2];
setTimeout(() => process.exit(0), 6000).unref();
if (mode === 'garbage') { process.stdout.write('pas du json\n{"jsonrpc":"2.0"\n'); setTimeout(() => process.exit(0), 300); }
if (mode === 'huge') { process.stdout.write('x'.repeat(11 * 1024 * 1024)); setTimeout(() => process.exit(0), 1200); }
if (mode === 'die') { process.stdin.once('data', () => process.exit(9)); }
if (mode === 'forged') {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '1' }, _meta: { task: 'AUTRE' } } }) + '\n');
  process.stdin.on('data', () => setTimeout(() => process.exit(0), 100));
}
