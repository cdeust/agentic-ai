// E-02 (roles inverses : hote = serveur MCP, sandbox = client) et E-03 (enfant hostile). Identite = fermeture du handler.
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { baseEnv, cmdString, makeWorld, record, sandboxed, srtArgv, srtBin, tsxImport, writeProfile, benchRoot, killGroup, type Result } from '../lib/common.ts';

const w = makeWorld('inverted');
const settings = writeProfile(w, 'inverted', { allowRead: [w.work, benchRoot] });
const clientFile = sandboxed('inverted-client.ts');
const hostile = sandboxed('hostile.mjs');
process.on('uncaughtException', (e) => { record('E-03-host', 'hote vivant apres enfants hostiles', 'process', 'fail', `uncaughtException ${(e as NodeJS.ErrnoException).code ?? e.message}`); process.exit(70); });

function runTask(taskId: string, n: number, sandboxedRun: boolean): Promise<string> {
  const argv = ['node', ...tsxImport, clientFile];
  return new Promise((resolve, reject) => {
    const child = sandboxedRun
      ? spawn(srtBin, srtArgv(settings, argv), { cwd: w.work, env: baseEnv(w), stdio: ['pipe', 'pipe', 'inherit'], detached: true })
      : spawn(argv[0] as string, argv.slice(1), { cwd: benchRoot, env: baseEnv(w), stdio: ['pipe', 'pipe', 'inherit'] });
    child.stdin.on('error', () => {}); // sans ceci : write EPIPE non gere (E-02), l'hote tombe
    const server = new McpServer({ name: 'host', version: '0.0.0' });
    const seen: string[] = [];
    const guard = setTimeout(() => { killGroup(child.pid); reject(new Error(`timeout ${taskId}`)); }, 60_000);
    server.registerTool('task_input', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ n }) }] }));
    server.registerTool('memory_search', { inputSchema: { query: z.string() } }, async ({ query }) => {
      seen.push(taskId);
      return { content: [{ type: 'text', text: JSON.stringify({ echoed: Number(query), task: taskId }) }] };
    });
    server.registerTool('task_complete', { inputSchema: { output: z.string() } }, async ({ output }) => {
      clearTimeout(guard);
      resolve(`${taskId} seen=${seen.length} allsame=${seen.every((s) => s === taskId)} ${output}`);
      setTimeout(() => killGroup(child.pid), 300);
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    child.on('error', reject);
    void server.connect(new StdioServerTransport(child.stdout, child.stdin));
  });
}
const cmd = cmdString(settings, ['node', ...tsxImport, clientFile]);
try {
  const bare = await runTask('t0', 1000, false);
  record('E-02-temoin', 'roles inverses SANS srt (temoin)', 'node inverted-client.ts', /seen=1000 allsame=true.*"sum":499500/.test(bare) ? 'pass' : 'fail', bare);
  const one = await runTask('t1', 1000, true);
  record('E-02', 'roles inverses SOUS srt : 1000 appels, identite par fermeture, outil hors profil refuse', cmd,
    /seen=1000 allsame=true.*"sum":499500.*"denied":true/.test(one) ? 'pass' : 'fail', one);
  const two = await Promise.all([runTask('A', 200, true), runTask('B', 200, true)]);
  record('E-02-concurrent', 'deux tasks concurrentes sous srt : chacune ne voit que ses propres appels', cmd,
    two[0]?.includes('seen=200 allsame=true') && two[1]?.includes('seen=200 allsame=true') ? 'pass' : 'fail', two.join(' | '));
} catch (e) {
  record('E-02', 'roles inverses sous srt', cmd, 'fail', `EXCEPTION ${(e as Error).message}`);
}

// E-03
const alive: string[] = [];
for (const mode of ['garbage', 'huge', 'die', 'forged']) {
  const argv = ['node', hostile, mode];
  const child = spawn(srtBin, srtArgv(settings, argv), { cwd: w.work, env: baseEnv(w), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  child.stdin.on('error', (e: NodeJS.ErrnoException) => alive.push(`${mode}: stdin error gere ${e.code}`));
  let childErr = ''; child.stderr.on('data', (d: Buffer) => (childErr += d));
  const server = new McpServer({ name: 'h', version: '0' });
  let calledBy = '';
  server.registerTool('memory_search', { inputSchema: { query: z.string() } }, async () => { calledBy = `t-${mode}`; return { content: [{ type: 'text', text: calledBy }] }; });
  const errs: string[] = [];
  server.server.onerror = (e) => errs.push(e.message.slice(0, 90));
  await server.connect(new StdioServerTransport(child.stdout, child.stdin));
  if (mode === 'die') child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
  const code = await new Promise<number | null>((r) => { const t = setTimeout(() => { killGroup(child.pid); r(-1); }, 20_000); child.on('exit', (c) => { clearTimeout(t); r(c); }); });
  await new Promise((r) => setTimeout(r, 150));
  killGroup(child.pid);
  const expect: Record<string, boolean> = {
    garbage: errs.length >= 1,
    huge: errs.some((m) => m.includes('exceeded maximum size')),
    die: code === 9,
    forged: calledBy === 't-forged',
  };
  const result: Result = expect[mode] ? 'pass' : 'fail';
  record(`E-03-${mode}`, `enfant hostile (${mode}) : hote vivant, comportement attendu`, cmdString(settings, argv), result, `exit=${code} erreurs=${errs.length} ${errs[0] ?? ''} handler=${calledBy || '-'} ${childErr.slice(0, 120)} ${alive.join(';')}`);
  await server.close().catch(() => {});
}
record('E-03', 'hote vivant apres les quatre enfants hostiles', 'process', 'pass', `hote vivant ; ${alive.join(' ; ')}`);
process.exit(0);
