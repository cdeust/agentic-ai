// `npm run code -- <arguments de claude>` : lance Claude Code sous srt dans le worktree courant (brique 1a.0).
// Composition seulement : la description de l'outil est dans `code.json`, le profil dans `profiles/`.
// Le lanceur, srt et les plugins doivent vivre hors du worktree visé (refus sinon) : depuis le worktree,
// `npm --prefix <checkout du lanceur> run code`. Le répertoire visé est INIT_CWD, fixé par npm.
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';
import { SandboxError, type SandboxExit } from './port.js';
import { SrtSandboxRunner } from './srt-runner.js';
import { loadTool } from './tool.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PKG, '..', '..');

async function main(): Promise<number> {
  const tool = loadTool(join(PKG, 'code.json'));
  const plugins = tool.pluginDirs.map((dir) => resolve(ROOT, dir));
  const runner = new SrtSandboxRunner({
    profilesDir: join(PKG, 'profiles'),
    srtCli: createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js'),
    node: process.execPath,
    canaryProbe: join(PKG, 'src', 'canary-probe.mjs'),
    tmpRoot: tmpdir(),
    home: homedir(),
    hostEnv: process.env,
    trusted: [PKG, join(ROOT, 'package.json'), ...plugins],
  });
  const request = {
    profile: tool.profile,
    cwd: process.env['INIT_CWD'] ?? process.cwd(),
    command: [...tool.command, ...plugins.flatMap((dir) => ['--plugin-dir', dir]), ...process.argv.slice(2)],
  };
  let exit: SandboxExit;
  if ([0, 1, 2].every((fd) => isatty(fd))) {
    exit = await runner.runInTerminal(request);
  } else {
    const sandbox = await runner.start(request);
    process.stdin.pipe(sandbox.stdin);
    sandbox.stdout.pipe(process.stdout);
    sandbox.stderr.pipe(process.stderr);
    exit = await sandbox.exited;
    process.stdin.unpipe(sandbox.stdin);
    process.stdin.destroy();
  }
  return exit.code ?? 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `architect-os code: ${error instanceof SandboxError ? error.message : String(error)}\n`,
    );
    process.exit(2);
  },
);
