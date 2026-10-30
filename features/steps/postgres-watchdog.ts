import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, stopServerSync, type Server } from '../support/pg-server.js';
import { Given, Then, When, stored } from './helpers.js';

const WITHIN_MS = 15_000;

/** postmaster.pid holds the server's pid on its first line (PostgreSQL documentation, "The Database Cluster"). */
const serverPid = (server: Server): number =>
  Number(readFileSync(join(server.dir, 'data', 'postmaster.pid'), 'utf8').split('\n')[0]);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

Given('a PostgreSQL server started on behalf of a separate process', { timeout: 120_000 }, async function () {
  // A bare node process that imports nothing of cucumber and only waits: the owner whose death is simulated.
  const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  assert.ok(owner.pid !== undefined, 'the owner process did not start');
  const server = await startServer(owner.pid);
  // Failsafe if an assertion fails before the watchdog has done its work.
  this.cleanups.push(() => {
    owner.kill('SIGKILL');
    stopServerSync(server);
  });
  this.state['owner'] = owner;
  this.state['server'] = server;
  this.state['serverPid'] = serverPid(server);
});

Given('the server is running', function () {
  assert.equal(alive(stored<number>(this, 'serverPid')), true);
  assert.equal(existsSync(stored<Server>(this, 'server').dir), true);
});

When('the separate process is killed with SIGKILL', async function () {
  const owner = stored<ChildProcess>(this, 'owner');
  const exited = new Promise((resolve) => owner.once('exit', resolve));
  owner.kill('SIGKILL');
  await exited;
});

Then(
  'within 15 seconds the server process is gone and its directory is removed',
  { timeout: WITHIN_MS + 5_000 },
  async function () {
    const pid = stored<number>(this, 'serverPid');
    const dir = stored<Server>(this, 'server').dir;
    const deadline = Date.now() + WITHIN_MS;
    while ((alive(pid) || existsSync(dir)) && Date.now() < deadline) await sleep(250);
    assert.equal(alive(pid), false, `the server process ${pid} is still running`);
    assert.equal(existsSync(dir), false, `${dir} still exists`);
  },
);
