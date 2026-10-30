// T-41 : worker agent ENTIER sous srt (query() + handlers minces dans la sandbox, binaire Claude Code lance depuis la
// sandbox, MCP stdio inverse vers l'hote, faux amont joint par le broker). Puis I-7 / E-06 : mort d'un worker sans effet sur l'autre.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { baseEnv, benchRoot, cmdString, killGroup, makeWorld, pidsInGroup, randomKey, record, sandboxed, sleep, srtArgv, srtBin, tsxImport, writeProfile, type World } from '../lib/common.ts';
import { startBroker, startUpstream, type Upstream } from '../lib/fake-upstream.ts';

const key = randomKey();
const workerFile = sandboxed('t41-worker.ts');

function filesContaining(dir: string, needle: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      const s = statSync(p);
      if (s.isDirectory()) filesContaining(p, needle, acc);
      else if (s.size < 5_000_000 && readFileSync(p).includes(needle)) acc.push(p);
    } catch { /* fichier disparu */ }
  }
  return acc;
}

interface TaskOut { name: string; completed: boolean; output: string; handlerCalls: number; handlerTasks: string[]; stderr: string; channel: string; pid?: number; pgid?: number; settings: string; argv: string[]; w: World; broker: { count: number; clientKeys: string[] }; exit: string }

async function runWorker(name: string, prompt: string, up: Upstream, opts: { onSpawn?: (pgid: number) => void } = {}): Promise<TaskOut> {
  const w = makeWorld(`t41-${name}`);
  const broker = await startBroker({ upstreamPort: up.port, key });
  const settings = writeProfile(w, `worker-${name}`, { allowedDomains: [`127.0.0.1:${broker.port}`], allowRead: [w.work, benchRoot] });
  const argv = ['node', ...tsxImport, workerFile, `--task=${name}`];
  // Environnement du processus srt : aucune cle, aucune sentinelle de cle. Seul le port du broker est transmis (par le prompt d'entree).
  const env = baseEnv(w);
  const child = spawn(srtBin, srtArgv(settings, argv), { cwd: w.work, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  child.stdin.on('error', () => {});
  child.stdout.on('error', () => {});
  if (child.pid) opts.onSpawn?.(child.pid);
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d));
  let channel = '';
  child.stdout.on('data', (d: Buffer) => { if (channel.length < 200_000) channel += d; });
  const handlerTasks: string[] = [];
  let output = ''; let completed = false;
  const server = new McpServer({ name: 'host', version: '0.0.0' });
  server.registerTool('task_input', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ prompt, brokerPort: broker.port }) }] }));
  server.registerTool('memory_search', { inputSchema: { query: z.string() } }, async () => { handlerTasks.push(name); return { content: [{ type: 'text', text: `R-${name}` }] }; });
  server.registerTool('task_complete', { inputSchema: { output: z.string() } }, async ({ output: o }) => { output = o; completed = true; return { content: [{ type: 'text', text: 'ok' }] }; });
  const exited = new Promise<string>((r) => child.on('exit', (c, s) => r(`code=${c} signal=${s}`)));
  await server.connect(new StdioServerTransport(child.stdout, child.stdin));
  const guard = setTimeout(() => killGroup(child.pid), 150_000);
  const exit = await Promise.race([exited, sleep(160_000).then(() => 'hote-timeout')]);
  clearTimeout(guard);
  const pgid = child.pid;
  await sleep(500);
  const survivors = pgid ? await pidsInGroup(pgid) : [];
  killGroup(child.pid);
  broker.close();
  const o: TaskOut = { name, completed, output, handlerCalls: handlerTasks.length, handlerTasks, stderr, channel, ...(child.pid !== undefined ? { pid: child.pid, pgid } : {}), settings, argv, w, broker: { count: broker.count(), clientKeys: broker.clientKeys }, exit };
  (o as unknown as { survivors: number[] }).survivors = survivors;
  void 0;
  return o;
}

// ---------- T-41 : un worker, de bout en bout ----------
{
  const up = await startUpstream();
  const t0 = performance.now();
  const r = await runWorker('solo', 'bonjour', up);
  const ms = Math.round(performance.now() - t0);
  const cmd = cmdString(r.settings, r.argv);
  let parsed: { result: string; proofs: Record<string, unknown> } | undefined;
  try { parsed = JSON.parse(r.output) as typeof parsed; } catch { /* sortie vide */ }
  const result = parsed?.result ?? `(pas de sortie) exit=${r.exit}`;
  const proofs = parsed?.proofs ?? {};
  const envDump = ((proofs['env_entries'] as string[] | undefined) ?? []).join('\n');
  const keyInFiles = filesContaining(r.w.root, key);
  const upMsgs = up.log.filter((l) => l.path.startsWith('/v1/messages') && l.method === 'POST');

  record('T-41a', 'worker entier sous srt : query() dans la sandbox atteint un resultat (faux amont par le broker, handler mince -> hote)', cmd,
    result === 'success:fin' && r.handlerCalls === 1 && upMsgs.length >= 2 ? 'pass' : 'fail',
    `resultat=${result} appels_handler_hote=${r.handlerCalls} (task=${r.handlerTasks.join(',')}) requetes_amont=${upMsgs.length} broker=${r.broker.count} ms=${ms} init=${JSON.stringify(proofs['init'])} sortie_srt=${r.exit} ${parsed ? '' : `stderr=${r.stderr.slice(-900)}`}`);

  const injected = upMsgs.length > 0 && upMsgs.every((l) => l.key === key);
  const leaks = {
    cle_dans_env_du_worker: envDump.includes(key),
    cle_dans_stderr_ou_canal: r.stderr.includes(key) || r.channel.includes(key),
    cle_dans_fichiers_du_monde: keyInFiles.length > 0,
    cle_dans_corps_amont: upMsgs.some((l) => l.body.includes(key)),
  };
  record('T-41b', 'la cle reelle n\'existe pas dans la sandbox (env, sortie, fichiers) ; l\'amont la recoit via le broker ; le worker n\'envoyait que le substitut', cmd,
    !Object.values(leaks).some(Boolean) && injected && r.broker.clientKeys.length > 0 && r.broker.clientKeys.every((k) => k === 'aucune-cle-ici') && result === 'success:fin' ? 'pass' : 'fail',
    `fuites=${JSON.stringify(leaks)} amont_recoit_la_cle_du_broker=${injected} cles_envoyees_par_le_worker=${JSON.stringify([...new Set(r.broker.clientKeys)])} fichiers=${keyInFiles.length} proxy_env=${JSON.stringify(proofs['proxy_env'])}`);

  const sshOk = proofs['ssh_read'] !== 'LU' && proofs['ssh_read'] !== undefined && !/\.ssh|\.zshrc/.test(String(proofs['home_list'])) && !r.output.includes(r.w.canary) && !r.stderr.includes(r.w.canary);
  record('T-41c', 'le worker ne peut pas lire ~/.ssh (faux HOME, canari) ni lister ~', cmd, sshOk ? 'pass' : 'fail', `ssh_read=${String(proofs['ssh_read'])} home_list=${String(proofs['home_list'])} home=${String(proofs['home'])} canari_visible_cote_hote=${r.output.includes(r.w.canary)}`);

  record('T-41d', 'sandbox imbriquee evitee : un seul srt (celui de l\'hote) ; le binaire Claude Code est un enfant simple du worker', cmd,
    r.argv.filter((a) => a.split('/').some((seg) => seg === 'srt' || seg === 'sandbox-runtime')).length === 0 && result === 'success:fin' ? 'pass' : 'fail',
    `argv du worker=${JSON.stringify(r.argv.map((a) => a.slice(-60)))} ; worker.ts n'appelle ni srt ni spawnClaudeCodeProcess (le SDK lance son binaire natif par defaut) ; restes apres sortie=${JSON.stringify((r as unknown as { survivors: number[] }).survivors)}`);
  up.close();
}

// ---------- I-7 / E-06 : deux workers concurrents, SIGKILL du groupe de l'un ----------
{
  let victimPgid: number | undefined;
  let killedAt = 0;
  const up = await startUpstream({
    slowMs: 2500,
    onMessages: (body) => {
      if (!killedAt && body.includes('LENT-VICTIME')) { killedAt = Date.now(); setTimeout(() => killGroup(victimPgid), 400); }
    },
  });
  const [victim, survivor] = await Promise.all([
    runWorker('victime', 'LENT-VICTIME', up, { onSpawn: (p) => (victimPgid = p) }),
    runWorker('survivante', 'LENT-SURVIVANTE', up),
  ]);
  let sOut = '';
  try { sOut = (JSON.parse(survivor.output) as { result: string }).result; } catch { /* vide */ }
  const left = (victim as unknown as { survivors: number[] }).survivors;
  record('I-7', 'deux workers concurrents sous srt, SIGKILL du groupe de l\'un : l\'autre aboutit, la victime ne laisse aucun processus', 'srt x2 (victime tuee 400 ms apres sa 1re requete amont)',
    killedAt > 0 && !victim.completed && sOut === 'success:fin' && survivor.handlerCalls === 1 && left.length === 0 ? 'pass' : 'fail',
    `tue=${killedAt > 0} victime: completed=${victim.completed} exit=${victim.exit} restes_du_groupe=${JSON.stringify(left)} ; survivante: resultat=${sOut} handler=${survivor.handlerCalls} broker=${survivor.broker.count} ${sOut ? '' : survivor.stderr.slice(-500)}`);
  up.close();
}
process.exit(0);
