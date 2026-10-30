// Watchdog of a disposable PostgreSQL server (features/support/pg-server.ts). Usage:
//   node pg-watchdog.mjs <owner pid> <pg_ctl> <data dir> <temp dir>
// The server's lifetime is bound to the process that started it: Stryker kills its test-runner workers, so the
// AfterAll hook never runs, and each orphan server keeps one SysV shared memory segment (macOS: kern.sysv.shmmni=32).
// Plain JavaScript on purpose: it is spawned detached with `node`, with nothing to compile or load.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const [ownerArg, pgCtl, data, dir] = process.argv.slice(2);
const owner = Number(ownerArg);
// Never remove a directory that is not a disposable server directory.
if (!Number.isInteger(owner) || !pgCtl || !data || !dir || !dir.includes('aos-pg-')) process.exit(2);

const alive = () => {
  try {
    process.kill(owner, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === 'EPERM';
  }
};

const timer = setInterval(() => {
  if (alive()) return;
  clearInterval(timer);
  try {
    execFileSync(pgCtl, ['-D', data, '-m', 'immediate', '-w', 'stop'], {
      env: { ...process.env, LC_ALL: 'C' },
      stdio: 'ignore',
    });
  } catch {
    // already stopped by the AfterAll hook
  }
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}, 1000);
