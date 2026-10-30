// T-02 (denyRead, allowRead, chemins proteges) et I-1 (isolation filesystem entre deux tasks).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
async function probeRun(name: string, prof: ProfileOpts, ops: Op[], cwd = w.work, tmp = w.tmp) {
  const settings = writeProfile(w, name, { allowRead: [w.work, pdir], tmp: [tmp], ...prof });
  const argv = ['node', probe, JSON.stringify(ops)];
  const { run, json } = await runSrtJson<Record<string, string>>({ settings, argv, cwd, env: baseEnv(w, { CLAUDE_CODE_TMPDIR: tmp }), timeoutMs: 30_000 });
  return { json, run, cmd: cmdString(settings, argv) };
}
const refused = (v: string | undefined): boolean => v !== undefined && v !== 'OK' && v !== 'LU-CANARI' && !v.startsWith('LISTE:');
// Linux masque ~ par un tmpfs (ENOENT, liste vide) ; macOS refuse (EPERM). Dans les deux cas rien de sensible n'est visible.
const hidden = (v: string | undefined): boolean => v !== undefined && !(v.startsWith('LISTE:') && /\.ssh|\.zshrc/.test(v));
function check(id: string, title: string, cmd: string, json: Record<string, string> | undefined, run: Parameters<typeof brief>[0], expect: Record<string, 'OK' | 'refuse' | 'hidden'>) {
  if (!json) return record(id, title, cmd, 'fail', brief(run));
  const bad = Object.entries(expect).filter(([k, e]) => (e === 'OK' ? json[k] !== 'OK' : e === 'hidden' ? !hidden(json[k]) : !refused(json[k])));
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
  check('T-02b', 'faux ~/.ssh, ~/.zshrc, ~ : lecture refusee, node tourne', r.cmd, r.json, r.run, { node: 'OK', 'ssh-dir': 'hidden', 'ssh-key': 'refuse', zshrc: 'refuse', home: 'hidden' });
}
{
  const out = path.join(w.home, 'outside.txt');
  const r = await probeRun('p2', {}, [
    { k: 'in-cwd', op: 'write', p: path.join(w.work, 'ok.txt') },
    { k: 'outside-home', op: 'write', p: out },
    { k: 'parent', op: 'write', p: path.join(w.work, '..', 'parent.txt') },
  ]);
  check('T-02d', 'ecriture dans . ok (hors . : voir T-02d2, aucun effet sur le disque de l hote)', r.cmd, r.json, r.run, { 'in-cwd': 'OK' });
  // Sous Linux ~ est un tmpfs ephemere : l'ecriture y reussit sans toucher l'hote. La propriete est donc : rien n'atteint le disque de l'hote (T-02d2).
  record('T-02d2', 'le fichier hors . est absent sur disque', 'existsSync', !existsSync(out) && !existsSync(path.join(w.home, 'parent.txt')) ? 'pass' : 'fail', `outside.txt=${existsSync(out)}`);
}
{
  // Propriete : un fichier protege (hook git, .mcp.json, agent) ne PERSISTE jamais sur le disque de l'hote.
  const persisted = (paths: string[]): string[] => paths.filter((p) => existsSync(p));
  const bare = [path.join(w.work, '.git', 'hooks', 'pre-commit'), path.join(w.work, '.mcp.json'), path.join(w.work, '.claude', 'agents', 'a.md')];
  const r1 = await probeRun('p3', {}, [
    { k: 'git-hooks', op: 'mkdirwrite', p: bare[0] as string },
    { k: 'mcp-json', op: 'write', p: bare[1] as string },
    { k: 'claude-agents', op: 'mkdirwrite', p: bare[2] as string },
  ]);
  const p1 = persisted(bare);
  record('T-02e', 'chemins proteges, depot absent : .git/hooks, .mcp.json, .claude/agents ne persistent pas sur l\'hote', r1.cmd, r1.json && p1.length === 0 ? 'pass' : 'fail',
    `retour sandbox=${JSON.stringify(r1.json)} persistes_sur_l_hote=${JSON.stringify(p1.map((p) => path.relative(w.work, p)))}`);
  const nested = [path.join(w.work, 'repo', '.git', 'hooks', 'pre-commit'), path.join(w.work, 'repo', '.git', 'config')];
  const r2 = await probeRun('p3b', {}, [
    { k: 'git-hooks', op: 'write', p: nested[0] as string },
    { k: 'git-config', op: 'write', p: nested[1] as string },
  ]);
  const p2 = persisted(nested);
  record('T-02e2', 'chemins proteges, depot git imbrique (work/repo/.git) : hooks et config ne persistent pas sur l\'hote', r2.cmd, r2.json && p2.length === 0 ? 'pass' : 'fail',
    `retour sandbox=${JSON.stringify(r2.json)} persistes_sur_l_hote=${JSON.stringify(p2.map((p) => path.relative(w.work, p)))}`);
  // Cas du builder reel : la copie jetable EST le depot, .git a la racine du cwd, cree par l'hote.
  const rootRepo = path.join(w.root, 'builder');
  mkdirSync(path.join(rootRepo, '.git', 'hooks'), { recursive: true });
  writeFileSync(path.join(rootRepo, '.git', 'config'), '[core]\n');
  const rootPaths = [path.join(rootRepo, '.git', 'hooks', 'pre-commit'), path.join(rootRepo, '.git', 'config.new')];
  const configBefore = readFileSync(path.join(rootRepo, '.git', 'config'), 'utf8');
  const r3 = await probeRun('p3c', { allowRead: [rootRepo, pdir], allowWrite: [rootRepo] }, [
    { k: 'git-hooks', op: 'write', p: rootPaths[0] as string },
    { k: 'git-config', op: 'write', p: path.join(rootRepo, '.git', 'config') },
  ], rootRepo);
  const p3 = persisted([rootPaths[0] as string]);
  const configChanged = readFileSync(path.join(rootRepo, '.git', 'config'), 'utf8') !== configBefore;
  record('T-02e3', 'depot du builder (.git a la racine du cwd, cree par l\'hote) : hook non persiste, .git/config inchange', r3.cmd, r3.json && p3.length === 0 && !configChanged ? 'pass' : 'fail',
    `retour sandbox=${JSON.stringify(r3.json)} hook_persiste=${p3.length > 0} config_modifiee=${configChanged}`);
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
  for (const d of Object.values(dirs)) { mkdirSync(path.join(d, '.tmp'), { recursive: true }); writeFileSync(path.join(d, 'secret.txt'), 'CANARY-secret-of-task'); }
  const res: Record<string, Record<string, string> | undefined> = {};
  let cmd = '';
  for (const [me, other] of [['A', 'B'], ['B', 'A']] as const) {
    const r = await probeRun(`task-${me}`, { allowRead: [dirs[me], pdir], allowWrite: [dirs[me]] }, [
      { k: 'own-read', op: 'read', p: path.join(dirs[me], 'secret.txt') },
      { k: 'own-write', op: 'write', p: path.join(dirs[me], 'w.txt') },
      { k: 'other-read', op: 'read', p: path.join(dirs[other], 'secret.txt') },
      { k: 'other-list', op: 'readdir', p: dirs[other] },
      { k: 'other-write', op: 'write', p: path.join(dirs[other], 'w.txt') },
    ], dirs[me], path.join(dirs[me], '.tmp'));
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
