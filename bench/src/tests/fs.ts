// T-02 (denyRead, allowRead, chemins proteges) et I-1 (isolation filesystem entre deux tasks).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { baseEnv, brief, cmdString, makeWorld, record, runSrtJson, sandboxed, writeProfile, type ProfileOpts, type Result } from '../lib/common.ts';

const w = makeWorld('fs');
const probe = sandboxed('fs-probe.mjs');
const pdir = path.dirname(probe);
const inst = path.join(w.home, 'inst');
mkdirSync(inst, { recursive: true });
writeFileSync(path.join(inst, 'mod.mjs'), 'export default 1;\n');
mkdirSync(path.join(w.work, 'sub'), { recursive: true });
writeFileSync(path.join(w.work, 'sub', 's.txt'), 'sub');
writeFileSync(path.join(w.work, 'own.txt'), 'own');
mkdirSync(path.join(w.home, 'x'), { recursive: true });
writeFileSync(path.join(w.home, 'x', 'y.txt'), 'y');
mkdirSync(path.join(w.work, 'repo', '.git', 'hooks'), { recursive: true });

type Op = { k: string; op: string; p: string };
async function probeRun(name: string, prof: ProfileOpts, ops: Op[], cwd = w.work) {
  const settings = writeProfile(w, name, { allowRead: [w.work, pdir], ...prof });
  const argv = ['node', probe, JSON.stringify(ops)];
  const { run, json } = await runSrtJson<Record<string, string>>({ settings, argv, cwd, env: baseEnv(w), timeoutMs: 30_000 });
  return { json, run, cmd: cmdString(settings, argv) };
}
const refused = (v: string | undefined): boolean => v !== undefined && v !== 'OK' && v !== 'LU-CANARI';
function check(id: string, title: string, cmd: string, json: Record<string, string> | undefined, run: Parameters<typeof brief>[0], expect: Record<string, 'OK' | 'refuse'>) {
  if (!json) return record(id, title, cmd, 'fail', brief(run));
  const bad = Object.entries(expect).filter(([k, e]) => (e === 'OK' ? json[k] !== 'OK' : !refused(json[k])));
  const result: Result = bad.length === 0 ? 'pass' : 'fail';
  return record(id, title, cmd, result, `${JSON.stringify(json)}${bad.length ? ` ATTENDU-NON-TENU=${bad.map(([k, e]) => `${k}:${e}`).join(',')}` : ''}`);
}

{
  const r = await probeRun('p1', {}, [
    { k: 'node', op: 'read', p: probe },
    { k: 'ssh-dir', op: 'readdir', p: path.join(w.home, '.ssh') },
    { k: 'ssh-key', op: 'read', p: path.join(w.home, '.ssh', 'id_test') },
    { k: 'zshrc', op: 'read', p: path.join(w.home, '.zshrc') },
    { k: 'home', op: 'readdir', p: w.home },
  ]);
  check('T-02b', 'faux ~/.ssh, ~/.zshrc, ~ : lecture refusee, node tourne', r.cmd, r.json, r.run, { node: 'OK', 'ssh-dir': 'refuse', 'ssh-key': 'refuse', zshrc: 'refuse', home: 'refuse' });
}
{
  const out = path.join(w.home, 'outside.txt');
  const r = await probeRun('p2', {}, [
    { k: 'in-cwd', op: 'write', p: path.join(w.work, 'ok.txt') },
    { k: 'outside-home', op: 'write', p: out },
    { k: 'parent', op: 'write', p: path.join(w.work, '..', 'parent.txt') },
  ]);
  check('T-02d', 'ecriture dans . ok ; ecriture hors . refusee', r.cmd, r.json, r.run, { 'in-cwd': 'OK', 'outside-home': 'refuse', parent: 'refuse' });
  record('T-02d2', 'le fichier hors . est absent sur disque', 'existsSync', !existsSync(out) && !existsSync(path.join(w.home, 'parent.txt')) ? 'pass' : 'fail', `outside.txt=${existsSync(out)}`);
}
{
  const r1 = await probeRun('p3', {}, [
    { k: 'git-hooks', op: 'mkdirwrite', p: path.join(w.work, '.git', 'hooks', 'pre-commit') },
    { k: 'mcp-json', op: 'write', p: path.join(w.work, '.mcp.json') },
    { k: 'claude-agents', op: 'mkdirwrite', p: path.join(w.work, '.claude', 'agents', 'a.md') },
  ]);
  check('T-02e', 'chemins proteges, depot absent : .git/hooks, .mcp.json, .claude/agents refuses', r1.cmd, r1.json, r1.run, { 'git-hooks': 'refuse', 'mcp-json': 'refuse', 'claude-agents': 'refuse' });
  const r2 = await probeRun('p3b', {}, [
    { k: 'git-hooks', op: 'write', p: path.join(w.work, 'repo', '.git', 'hooks', 'pre-commit') },
    { k: 'git-config', op: 'write', p: path.join(w.work, 'repo', '.git', 'config') },
  ]);
  check('T-02e2', 'chemins proteges, depot git existant : .git/hooks et .git/config refuses', r2.cmd, r2.json, r2.run, { 'git-hooks': 'refuse', 'git-config': 'refuse' });
}
{
  const f = await probeRun('p4', {}, [{ k: 'import-inst', op: 'import', p: path.join(inst, 'mod.mjs') }]);
  check('T-02f', 'module sous ~ sans allowRead : import refuse', f.cmd, f.json, f.run, { 'import-inst': 'refuse' });
  const g = await probeRun('p5', { allowRead: [w.work, pdir, inst] }, [{ k: 'import-inst', op: 'import', p: path.join(inst, 'mod.mjs') }]);
  check('T-02g', 'module sous ~ avec allowRead sur son repertoire : import ok', g.cmd, g.json, g.run, { 'import-inst': 'OK' });
}
{
  const h = await probeRun('p6', { denyRead: ['~', path.join(w.work, 'sub')] }, [
    { k: 'sub', op: 'read', p: path.join(w.work, 'sub', 's.txt') },
    { k: 'own', op: 'read', p: path.join(w.work, 'own.txt') },
  ]);
  check('T-02h', 'denyRead plus precis que allowRead (./sub sous .) : refuse, le reste lisible', h.cmd, h.json, h.run, { sub: 'refuse', own: 'OK' });
  const i = await probeRun('p7', { denyRead: ['../x'] }, [
    { k: 'x', op: 'read', p: path.join(w.home, 'x', 'y.txt') },
    { k: 'zshrc', op: 'read', p: path.join(w.home, '.zshrc') },
  ]);
  check('T-02i', 'denyRead relatif ../x : refuse, temoin ~/.zshrc lisible (la regle est ciblee)', i.cmd, i.json, i.run, { x: 'refuse', zshrc: 'OK' });
}
// I-1 : deux tasks, chacune son repertoire ; A ne lit ni n'ecrit B, et reciproquement.
{
  const dirs = { A: path.join(w.home, 'tasks', 'A'), B: path.join(w.home, 'tasks', 'B') };
  for (const d of Object.values(dirs)) { mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, 'secret.txt'), 'CANARY-secret-of-task'); }
  const res: Record<string, Record<string, string> | undefined> = {};
  let cmd = '';
  for (const [me, other] of [['A', 'B'], ['B', 'A']] as const) {
    const r = await probeRun(`task-${me}`, { allowRead: [dirs[me], pdir], allowWrite: [dirs[me]] }, [
      { k: 'own-read', op: 'read', p: path.join(dirs[me], 'secret.txt') },
      { k: 'own-write', op: 'write', p: path.join(dirs[me], 'w.txt') },
      { k: 'other-read', op: 'read', p: path.join(dirs[other], 'secret.txt') },
      { k: 'other-list', op: 'readdir', p: dirs[other] },
      { k: 'other-write', op: 'write', p: path.join(dirs[other], 'w.txt') },
    ], dirs[me]);
    res[me] = r.json; cmd = r.cmd;
  }
  const ok = (['A', 'B'] as const).every((t) => {
    const j = res[t];
    return j !== undefined && j['own-read'] === 'LU-CANARI' && j['own-write'] === 'OK' && refused(j['other-read']) && refused(j['other-list']) && refused(j['other-write']);
  });
  const leaked = existsSync(path.join(dirs.A, 'w.txt')) && existsSync(path.join(dirs.B, 'w.txt'));
  record('I-1', 'isolation filesystem entre deux tasks (lecture, liste, ecriture croisees refusees)', cmd, ok && leaked ? 'pass' : 'fail', JSON.stringify(res));
}
process.exit(0);
