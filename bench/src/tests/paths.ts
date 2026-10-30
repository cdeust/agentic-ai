// Chemins proteges et alias (docs/design/platform-v3-srt.md §9.2 regle de profil, T-34 etendu, T-35 anticipe pour gate-tests).
// Deux familles, a lire separement dans le rapport :
//  - T-02e5, T-02e6 : rejouent T-02e et T-02e2 (fs.ts, inchanges, ils documentent le comportement BRUT de srt) AVEC la regle du profil de la plateforme
//    (chemins sensibles nommes en denyWrite, absolus).
//  - T-34x : alias de chemins contre cette regle. Un echec est rapporte tel quel ; aucune liste de chemins n'est ajoutee pour le masquer.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, linkSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { baseEnv, benchRoot, brief, cmdString, makeWorld, record, runSrtJson, sandboxed, writeProfile, type ProfileOpts } from '../lib/common.ts';

const w = makeWorld('paths');
const probe = sandboxed('path-probe.mjs');
const pdir = path.dirname(probe);
let seq = 0;

type Op = { k: string; op: string; p: string; to?: string };
async function run(name: string, prof: ProfileOpts, ops: Op[], cwd: string) {
  const settings = writeProfile(w, `${name}-${seq++}`, { allowRead: [cwd, pdir], ...prof });
  const argv = ['node', probe, JSON.stringify(ops)];
  const { run: r, json } = await runSrtJson<Record<string, string>>({ settings, argv, cwd, env: baseEnv(w), timeoutMs: 40_000 });
  return { json, r, cmd: cmdString(settings, argv) };
}
/** Instantane d'un arbre sans suivre les liens : chemin relatif -> empreinte (contenu, cible du lien, ou "dir"). */
function snap(root: string): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      const st = lstatSync(p);
      const rel = path.relative(root, p);
      if (st.isSymbolicLink()) m.set(rel, `lien->${readlinkSync(p)}`);
      else if (st.isDirectory()) { m.set(rel, 'dir'); walk(p); }
      else m.set(rel, `fichier:${createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 10)}:${st.nlink}`);
    }
  };
  walk(root);
  return m;
}
const diff = (a: Map<string, string>, b: Map<string, string>): string[] => {
  const out: string[] = [];
  for (const [k, v] of b) if (!a.has(k)) out.push(`cree:${k}`); else if (a.get(k) !== v) out.push(`modifie:${k}`);
  for (const k of a.keys()) if (!b.has(k)) out.push(`supprime:${k}`);
  return out.sort();
};
/** Les chemins que la regle du profil veut protegees : hooks et config git de tout depot, .mcp.json, .claude, et le contenu cible d'un alias. */
const PROTECTED = /(^|\/)(\.git(-old)?\/(hooks|config)|\.mcp\.json|\.claude)(\/|$)|^repo(-old)?\/\.git/;
const sensitive = (d: string[]): string[] => d.filter((x) => PROTECTED.test(x.slice(x.indexOf(':') + 1)));

/** Disposition de depart (creee par l'hote). */
function layout(name: string): string {
  const b = path.join(w.home, name);
  for (const d of ['.git/hooks', 'repo/.git/hooks', 'repo2/.git/hooks']) mkdirSync(path.join(b, d), { recursive: true });
  for (const [f, c] of [['.git/config', '[core]\n'], ['.git/hooks/pre-commit.sample', 'orig\n'], ['.mcp.json', '{}\n'], ['repo/.git/config', '[core]\n'], ['repo2/.git/config', '[core]\n']] as const) writeFileSync(path.join(b, f), c);
  return b;
}
const named = (b: string): string[] => ['.git/hooks', '.git/config', '.mcp.json', '.claude', 'repo/.git/hooks', 'repo/.git/config'].map((x) => path.join(b, x));

// ---- Rejeu de T-02e et T-02e2 avec denyWrite nommes (variante de profil) ----
{
  const b = path.join(w.home, 'e5');
  mkdirSync(b, { recursive: true }); // T-02e : depot absent au lancement
  const targets = [path.join(b, '.git/hooks/pre-commit'), path.join(b, '.mcp.json'), path.join(b, '.claude/agents/a.md')];
  const r = await run('e5', { allowWrite: [b], denyWrite: [path.join(b, '.git/hooks'), path.join(b, '.git/config'), path.join(b, '.mcp.json'), path.join(b, '.claude')] },
    [{ k: 'git-hooks', op: 'mkdirwrite', p: targets[0] as string }, { k: 'mcp-json', op: 'write', p: targets[1] as string }, { k: 'claude-agents', op: 'mkdirwrite', p: targets[2] as string }], b);
  const persisted = targets.filter((t) => existsSync(t));
  record('T-02e5', 'PROFIL PLATEFORME : rejeu de T-02e (depot absent au lancement) avec denyWrite nommes : rien ne persiste sur l\'hote', r.cmd, r.json && persisted.length === 0 ? 'pass' : 'fail',
    `retour sandbox=${JSON.stringify(r.json)} persistes_sur_l_hote=${JSON.stringify(persisted.map((p) => path.relative(b, p)))}`);
}
{
  const b = path.join(w.home, 'e6');
  mkdirSync(path.join(b, 'repo/.git/hooks'), { recursive: true }); // T-02e2 : depot imbrique present au lancement
  const targets = [path.join(b, 'repo/.git/hooks/pre-commit'), path.join(b, 'repo/.git/config')];
  const r = await run('e6', { allowWrite: [b], denyWrite: [path.join(b, '.git/hooks'), path.join(b, '.git/config'), path.join(b, 'repo/.git/hooks'), path.join(b, 'repo/.git/config')] },
    [{ k: 'git-hooks', op: 'write', p: targets[0] as string }, { k: 'git-config', op: 'write', p: targets[1] as string }], b);
  const persisted = targets.filter((t) => existsSync(t));
  record('T-02e6', 'PROFIL PLATEFORME : rejeu de T-02e2 (depot imbrique) avec denyWrite nommes : hooks et config ne persistent pas sur l\'hote', r.cmd, r.json && persisted.length === 0 ? 'pass' : 'fail',
    `retour sandbox=${JSON.stringify(r.json)} persistes_sur_l_hote=${JSON.stringify(persisted.map((p) => path.relative(b, p)))}`);
}

// ---- T-34x : alias de chemins, regle denyWrite nommes active ----
async function alias(id: string, title: string, setup: (b: string) => void, ops: (b: string) => Op[], extraWatch?: (b: string) => string) {
  const b = layout(id.toLowerCase());
  setup(b);
  const before = snap(b);
  const outside = path.join(w.home, `outside-${id}`);
  mkdirSync(outside, { recursive: true });
  const outBefore = snap(outside);
  void extraWatch;
  const r = await run(id, { allowWrite: [b], denyWrite: named(b) }, ops(b).map((o) => ({ ...o, p: o.p.replace('@OUT', outside), to: o.to?.replace('@OUT', outside) })), b);
  const d = diff(before, snap(b));
  const dOut = diff(outBefore, snap(outside));
  // Un repertoire vide cree n'est pas un hook : il est rapporte a part (dirsVides) mais ne compte pas comme persistance de fichier.
  const isDir = (x: string): boolean => lstatSync(path.join(b, x.slice(x.indexOf(':') + 1)), { throwIfNoEntry: false })?.isDirectory() === true;
  const bad = [...sensitive(d).filter((x) => !isDir(x)), ...dOut.map((x) => `hors-perimetre:${x}`)];
  const dirsVides = sensitive(d).filter(isDir);
  record(id, title, r.cmd, r.json && bad.length === 0 ? 'pass' : 'fail',
    `retour sandbox=${JSON.stringify(r.json ?? brief(r.r))} ; PERSISTE_SUR_L_HOTE_en_zone_protegee=${JSON.stringify(bad)} repertoires_proteges_crees_vides=${JSON.stringify(dirsVides)} ; autres_changements_dans_la_zone_inscriptible=${JSON.stringify(d.filter((x) => !sensitive([x]).length))}`);
}
await alias('T-34a', 'alias : lien symbolique cree par la sandbox vers .git/hooks, ecriture par le lien', () => undefined,
  (b) => [{ k: 'ln', op: 'symlink', p: path.join(b, 'lnk'), to: path.join(b, '.git/hooks') }, { k: 'write-via-lien', op: 'write', p: path.join(b, 'lnk/pre-commit') }]);
await alias('T-34b', 'alias : lien symbolique vers .git/config (fichier), ecriture par le lien', () => undefined,
  (b) => [{ k: 'ln', op: 'symlink', p: path.join(b, 'cfg'), to: path.join(b, '.git/config') }, { k: 'write-via-lien', op: 'write', p: path.join(b, 'cfg') }]);
await alias('T-34c', 'alias : lien symbolique pose par l\'hote AVANT le lancement vers .git/hooks, ecriture par le lien', (b) => symlinkSync(path.join(b, '.git/hooks'), path.join(b, 'alias')),
  (b) => [{ k: 'write-via-lien', op: 'write', p: path.join(b, 'alias/pre-commit') }]);
await alias('T-34d', 'alias : lien symbolique vers un repertoire hors de la zone inscriptible, ecriture par le lien', () => undefined,
  (b) => [{ k: 'ln', op: 'symlink', p: path.join(b, 'out'), to: '@OUT' }, { k: 'write-via-lien', op: 'write', p: path.join(b, 'out/f') }]);
await alias('T-34e', 'alias : lien dur vers .git/config dans la zone inscriptible, ecriture par le lien dur (meme inode)', () => undefined,
  (b) => [{ k: 'ln-dur', op: 'link', p: path.join(b, 'hl'), to: path.join(b, '.git/config') }, { k: 'write-via-lien-dur', op: 'write', p: path.join(b, 'hl') }]);
await alias('T-34f', 'alias : renommer .git (et repo) puis recreer le chemin protege', () => undefined,
  (b) => [{ k: 'mv-git', op: 'rename', p: path.join(b, '.git'), to: path.join(b, '.git-old') }, { k: 'recree-hook', op: 'mkdirwrite', p: path.join(b, '.git/hooks/pre-commit') },
    { k: 'mv-repo', op: 'rename', p: path.join(b, 'repo'), to: path.join(b, 'repo-old') }, { k: 'recree-repo-hook', op: 'mkdirwrite', p: path.join(b, 'repo/.git/hooks/pre-commit') }]);
await alias('T-34g', 'alias : supprimer le repertoire protege .git/hooks puis le recreer', () => undefined,
  (b) => [{ k: 'rm-hooks', op: 'rm', p: path.join(b, '.git/hooks') }, { k: 'recree', op: 'mkdirwrite', p: path.join(b, '.git/hooks/pre-commit') }]);
await alias('T-34h', 'depot imbrique SUPPLEMENTAIRE present au lancement (repo2, non nomme en denyWrite) : ecriture de repo2/.git/hooks/pre-commit et repo2/.git/config', () => undefined,
  (b) => [{ k: 'hook', op: 'write', p: path.join(b, 'repo2/.git/hooks/pre-commit') }, { k: 'config', op: 'write', p: path.join(b, 'repo2/.git/config') }]);
await alias('T-34i', 'repertoire de depot CREE APRES le demarrage (repo3/.git/hooks, non nomme) : ecriture du hook et de la config', () => undefined,
  (b) => [{ k: 'hook', op: 'mkdirwrite', p: path.join(b, 'repo3/.git/hooks/pre-commit') }, { k: 'config', op: 'write', p: path.join(b, 'repo3/.git/config') }]);

// ---- gate-tests (T-35 anticipe) : code hostile qui vise gate/ et les chemins persistants hors perimetre ----
{
  const root = path.join(w.root, 'gate-world');
  const gate = path.join(root, 'gate'), work = path.join(root, 'work'), reports = path.join(root, 'reports');
  for (const d of [path.join(gate, 'tools'), path.join(gate, 'node_modules/dummy'), path.join(work, '.github/workflows'), path.join(work, '.git/hooks'), reports]) mkdirSync(d, { recursive: true });
  for (const [f, c] of [[path.join(gate, 'gate.yml'), 'name: gate\n'], [path.join(gate, 'tools/gate.mjs'), 'export default 1;\n'], [path.join(gate, 'node_modules/dummy/index.js'), 'module.exports=1;\n'], [path.join(work, '.github/workflows/gate.yml'), 'name: gate (PR)\n'], [path.join(work, '.git/config'), '[core]\n']] as const) writeFileSync(f, c);
  const uuid = randomUUID();
  const escapes = [path.join(w.home, 'persist.txt'), path.join(w.home, '.config', 'autostart', 'x.desktop'), path.join(w.home, 'Library', 'LaunchAgents', 'x.plist'), `/tmp/escape-${uuid}`, path.join(w.root, 'profiles', 'gate.rewritten')];
  const srtPkg = path.join(benchRoot, 'node_modules/@anthropic-ai/sandbox-runtime/package.json');
  const srtBefore = createHash('sha1').update(readFileSync(srtPkg)).digest('hex');
  const gateBefore = snap(gate);
  const outLink = path.join(w.home, 'outside-gate');
  mkdirSync(outLink, { recursive: true });
  symlinkSync(gate, path.join(work, 'plant')); // lien pose par l'hote dans work/ vers gate/ (cas d'un checkout piege)
  const ops: Op[] = [
    { k: 'g1-modifier-gate', op: 'write', p: path.join(gate, 'tools/gate.mjs') },
    { k: 'g2-creer-dans-gate', op: 'write', p: path.join(gate, 'planted.mjs') },
    { k: 'g3-supprimer-gate.yml', op: 'unlink', p: path.join(gate, 'gate.yml') },
    { k: 'g4-ecrire-via-lien-pose', op: 'write', p: path.join(work, 'plant/tools/gate.mjs') },
    { k: 'g5-lien-sandbox-vers-gate', op: 'symlink', p: path.join(work, 'mine'), to: gate },
    { k: 'g5b-ecrire-via-lien', op: 'write', p: path.join(work, 'mine/gate.yml') },
    { k: 'g6-lien-dur-vers-gate', op: 'link', p: path.join(work, 'hl'), to: path.join(gate, 'gate.yml') },
    { k: 'g6b-ecrire-lien-dur', op: 'write', p: path.join(work, 'hl') },
    { k: 'g7-traversee', op: 'write', p: path.join(reports, '../gate/traversal.mjs') },
    { k: 'g8-home', op: 'write', p: escapes[0] as string },
    { k: 'g8b-autostart', op: 'mkdirwrite', p: escapes[1] as string },
    { k: 'g8c-launchagent', op: 'mkdirwrite', p: escapes[2] as string },
    { k: 'g8d-tmp-global', op: 'write', p: escapes[3] as string },
    { k: 'g8e-profil-srt', op: 'write', p: escapes[4] as string },
    { k: 'g9-srt-installe', op: 'append', p: srtPkg },
    { k: 'g10-lien-vers-hors-perimetre', op: 'symlink', p: path.join(reports, 'out'), to: outLink },
    { k: 'g10b-ecrire-via-lien', op: 'write', p: path.join(reports, 'out/f') },
    { k: 'g11-hook-nomme', op: 'write', p: path.join(work, '.git/hooks/pre-commit') },
    { k: 'g12-reports-legitime', op: 'write', p: path.join(reports, 'rapport.json') },
    { k: 'g13-reseau-exterieur', op: 'connect', p: '93.184.216.34', to: '443' },
    { k: 'g13b-listen-local', op: 'listen', p: '' },
    { k: 'fds', op: 'fds', p: '' },
  ];
  const settings = writeProfile(w, 'gate-tests', {
    allowedDomains: [], allowLocalBinding: true, allowRead: [work, gate, reports, pdir], allowWrite: [work, reports],
    denyWrite: [path.join(work, '.git/hooks'), path.join(work, '.git/config'), path.join(work, '.mcp.json'), path.join(work, '.claude')],
  });
  const profilesBefore = snap(path.join(w.root, 'profiles')); // apres l'ecriture du profil par l'hote
  const argv = ['node', probe, JSON.stringify(ops)];
  const { run: rr, json } = await runSrtJson<Record<string, string>>({ settings, argv, cwd: work, env: baseEnv(w), timeoutMs: 60_000 });
  const gateDiff = diff(gateBefore, snap(gate));
  const escaped = escapes.filter((e) => existsSync(e));
  const srtAfter = createHash('sha1').update(readFileSync(srtPkg)).digest('hex');
  const profilesDiff = diff(profilesBefore, snap(path.join(w.root, 'profiles')));
  const outDiff = readdirSync(outLink);
  const cmd = cmdString(settings, argv);
  const bad = [...gateDiff.map((x) => `gate/${x}`), ...escaped, ...(srtAfter !== srtBefore ? ['srt-installe-modifie'] : []), ...profilesDiff, ...outDiff.map((x) => `hors-perimetre/${x}`), ...(existsSync(path.join(work, '.git/hooks/pre-commit')) ? ['work/.git/hooks/pre-commit'] : [])];
  const net = json?.['g13-reseau-exterieur'];
  record('T-35-pre', 'PROFIL gate-tests (reconstruit du tableau §9.2 ; le document n\'en donne pas le JSON) : code hostile contre gate/, liens, chemins persistants hors perimetre, srt installe, profil', cmd, json && bad.length === 0 && net !== 'CONNECTE' ? 'pass' : 'fail',
    `retours=${JSON.stringify(json ?? brief(rr))} ; PERSISTE_SUR_L_HOTE=${JSON.stringify(bad)} ; reseau_exterieur=${net} ; ecriture reports/ legitime=${existsSync(path.join(reports, 'rapport.json'))} ; ` +
    'NON COUVERT : le vrai code de la porte (tools/test-gate), cucumber-js et Stryker reels sous ce profil, le Postgres de test dans la sandbox, la lecture de node_modules de gate/, pull_request_target et le checkout reel, le serveur TCP de Stryker (seulement listen local), le contenu forge de reports/ (ecriture permise par conception, la porte les lit comme non fiables)');
  record('T-35-pre-fds', 'PROFIL gate-tests : descripteurs ouverts vus par le code hostile (hors lecture du repertoire)', cmd, 'finding', `fds=${json?.['fds']} ; lancement par le helper du banc (FD-PIPES)`);
  void linkSync;
}
process.exit(0);
