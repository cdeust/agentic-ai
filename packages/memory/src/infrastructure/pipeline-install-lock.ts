/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Filesystem-level mutual exclusion for pipeline-installer.
 *
 * Prevents concurrent setup runs (or a SessionStart auto-install racing
 * the user's manual setup) from corrupting the shared install state:
 * half-cloned src/, racy symlink swap, JSON config truncation.
 *
 * Uses a lock file with an exclusive open (O_EXCL). Non-blocking acquire —
 * contended runs return immediately so callers can surface a clear
 * install_in_progress action rather than hanging the user's terminal.
 *
 * Note: Node.js does not expose fcntl.flock(). We use O_EXCL atomic create
 * as the nearest equivalent. The lock file is cleaned up on release.
 *
 * Layer: INFRASTRUCTURE — filesystem locking.
 * source: Cortex mcp_server/infrastructure/pipeline_install_lock.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// source: Cortex mcp_server/infrastructure/pipeline_install_lock.py — _LOCK_FILE
const _LOCK_FILE = path.join(
  os.homedir(),
  ".claude",
  "methodology",
  ".install.lock",
);

/** Raised when another install_pipeline holder owns the lock. */
export class InstallLockBusy extends Error {
  constructor(lockPath: string) {
    super(`install lock busy: ${lockPath}`);
    this.name = "InstallLockBusy";
  }
}

/**
 * Acquire an exclusive non-blocking lock on the install file.
 *
 * Throws InstallLockBusy immediately on contention so callers can
 * return a structured install_in_progress action instead of blocking
 * for the duration of someone else's build.
 *
 * The lock is released when the returned disposable is disposed.
 *
 * precondition:  the lock file parent directory is writable.
 * postcondition: on success, lock file exists exclusively;
 *   on InstallLockBusy, no lock is held.
 * invariant:     after dispose(), the lock file is removed.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_lock.py:install_lock
 */
export function acquireInstallLock(): { release(): void } {
  fs.mkdirSync(path.dirname(_LOCK_FILE), { recursive: true });

  let fd: number;
  try {
    // O_EXCL guarantees atomic create — if file exists, EEXIST is thrown.
    // source: Cortex mcp_server/infrastructure/pipeline_install_lock.py — fcntl.flock LOCK_EX|LOCK_NB; 0o644 = rw-r--r--
    fd = fs.openSync(_LOCK_FILE, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "EEXIST") {
      throw new InstallLockBusy(_LOCK_FILE);
    }
    throw e;
  }

  return {
    release(): void {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort
      }
      try {
        fs.unlinkSync(_LOCK_FILE);
      } catch {
        // best-effort
      }
    },
  };
}

/**
 * Run fn under the exclusive install lock; release on completion.
 *
 * Throws InstallLockBusy if the lock is already held.
 *
 * precondition:  fn is a callable returning T.
 * postcondition: fn's return value is returned; lock is released
 *   whether fn succeeds or throws.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_lock.py:install_lock context manager
 */
export function withInstallLock<T>(fn: () => T): T {
  const lock = acquireInstallLock();
  try {
    return fn();
  } finally {
    lock.release();
  }
}
