/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Silent installer for the upstream ai-automatised-pipeline binary.
 *
 * Bootstraps a fresh user machine. Strategy: prebuilt binary fast-path
 * (GitHub Releases, hash-verified, ~10 s) → falls back to source build
 * (rustup → git clone → cargo build, ~5–8 min). Idempotent. All
 * subprocess output is captured. File-locked against concurrent runs.
 *
 * Opt-out env vars: CORTEX_AUTO_INSTALL_PIPELINE=0 (skip all),
 * CORTEX_AUTO_INSTALL_RUST=0 (skip rustup), CORTEX_PIPELINE_GIT_URL=<url>
 * (fork override), CORTEX_DISABLE_PREBUILT=1 (skip release fast-path),
 * CORTEX_RUSTUP_PIN_HASH=0 (skip rustup hash verification).
 *
 * Layer: INFRASTRUCTURE — subprocess + filesystem orchestration.
 * source: Cortex mcp_server/infrastructure/pipeline_installer.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

function _whichBin(name: string): string | null {
  try {
    const result = execSync(
      process.platform === "win32" ? `where ${name}` : `command -v ${name}`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return result.trim().split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

import {
  INSTALL_BIN_DIR,
  INSTALL_SRC_DIR,
  INSTALL_SYMLINK,
} from "./pipeline-discovery.js";
import {
  InstallLockBusy,
  withInstallLock,
} from "./pipeline-install-lock.js";
import { tryInstallPrebuilt } from "./pipeline-install-release.js";
import {
  installRustToolchain,
  resolveCargo,
  CARGO_HOME_BIN,
} from "./pipeline-install-rust.js";
import { rmtreeQuiet, runQuiet } from "./pipeline-installer-common.js";

// source: Cortex mcp_server/infrastructure/pipeline_installer.py — _DEFAULT_GIT_URL
const _DEFAULT_GIT_URL =
  "https://github.com/cdeust/automatised-pipeline.git";

// source: Cortex mcp_server/infrastructure/pipeline_installer.py — _BUILT_BINARY_REL
const _BUILT_BINARY_REL = "target/release/automatised-pipeline";

// source: Cortex mcp_server/infrastructure/pipeline_installer.py — _DISABLE_ENV
const _DISABLE_ENV = "CORTEX_AUTO_INSTALL_PIPELINE";

// Minimum acceptable size for a successfully-built binary.
// source: Cortex mcp_server/infrastructure/pipeline_installer.py — _MIN_BINARY_BYTES = 1_024 * 1_024
const _MIN_BINARY_BYTES = 1_024 * 1_024;

// CI signals — default-skip the install in CI.
// source: Cortex mcp_server/infrastructure/pipeline_installer.py — _CI_ENV_VARS
const _CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
];

/** Audit dict returned by installPipeline. */
export interface PipelineInstallResult {
  action:
    | "already_installed"
    | "installed"
    | "installed_prebuilt"
    | "missing_toolchain"
    | "clone_failed"
    | "build_failed"
    | "symlink_failed"
    | "home_readonly"
    | "disabled"
    | "ci_skipped"
    | "install_in_progress";
  binary?: string;
  missing?: string[];
  rust_install_action?: string;
  detail?: string;
  hash_pin_status?: string;
}

/**
 * True when the binary path exists, is executable, and has plausible size.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer.py:_binary_is_usable
 */
function _binaryIsUsable(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return stat.size >= _MIN_BINARY_BYTES;
  } catch {
    return false;
  }
}

/**
 * True under a recognised CI provider AND not explicitly opted in.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer.py:_is_ci_environment
 */
function _isCiEnvironment(): boolean {
  const disableEnv = process.env[_DISABLE_ENV] ?? "";
  if (["1", "true", "yes"].includes(disableEnv.trim())) {
    return false;
  }
  return _CI_ENV_VARS.some((name) => Boolean(process.env[name]));
}

/**
 * Best-effort silent install of the upstream pipeline binary.
 *
 * Returns audit dict with one of these actions:
 *   already_installed | installed | installed_prebuilt
 *   missing_toolchain | clone_failed | build_failed | symlink_failed
 *   home_readonly | disabled | ci_skipped | install_in_progress
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer.py:install_pipeline
 */
export async function installPipeline(opts: {
  forceRebuild?: boolean;
  gitUrl?: string;
}): Promise<PipelineInstallResult> {
  const disableEnv = process.env[_DISABLE_ENV] ?? "";
  if (["0", "false", "no"].includes(disableEnv.trim())) {
    return { action: "disabled" };
  }

  if (_isCiEnvironment()) {
    return { action: "ci_skipped" };
  }

  const forceRebuild = opts.forceRebuild ?? false;
  if (!forceRebuild && _binaryIsUsable(INSTALL_SYMLINK)) {
    return { action: "already_installed", binary: INSTALL_SYMLINK };
  }

  try {
    return await _withLock(() => _installLocked(forceRebuild, opts.gitUrl));
  } catch (exc) {
    if (exc instanceof InstallLockBusy) {
      return { action: "install_in_progress", detail: String(exc) };
    }
    throw exc;
  }
}

async function _withLock<T>(fn: () => Promise<T>): Promise<T> {
  return withInstallLock(fn);
}

/**
 * Install body, executed under the exclusive file-lock.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer.py:_install_locked
 */
async function _installLocked(
  forceRebuild: boolean,
  gitUrl: string | undefined,
): Promise<PipelineInstallResult> {
  // Re-check usability under the lock
  if (!forceRebuild && _binaryIsUsable(INSTALL_SYMLINK)) {
    return { action: "already_installed", binary: INSTALL_SYMLINK };
  }

  // Fast path: prebuilt release binary. Always-non-fatal.
  if (!forceRebuild) {
    const prebuilt = await tryInstallPrebuilt(INSTALL_SYMLINK);
    if (
      prebuilt.action === "installed_prebuilt" &&
      _binaryIsUsable(INSTALL_SYMLINK)
    ) {
      return prebuilt as PipelineInstallResult;
    }
  }

  let cargo = resolveCargo();
  if (!cargo) {
    const rustResult = installRustToolchain();
    if (
      rustResult.action === "rust_installed" ||
      rustResult.action === "rust_already_present"
    ) {
      cargo = rustResult.cargo ?? null;
    } else {
      return {
        action: "missing_toolchain",
        missing: ["cargo"],
        rust_install_action: rustResult.action,
        detail: rustResult.detail,
        hash_pin_status: rustResult.hash_pin_status,
      };
    }
  }

  const git = _whichBin("git");
  if (!git) {
    return { action: "missing_toolchain", missing: ["git"] };
  }

  const src = INSTALL_SRC_DIR;
  try {
    fs.mkdirSync(path.dirname(src), { recursive: true });
  } catch (exc) {
    return { action: "home_readonly", detail: String(exc) };
  }

  const url =
    gitUrl ??
    process.env["CORTEX_PIPELINE_GIT_URL"] ??
    _DEFAULT_GIT_URL;

  const cloneResult = _ensureSource(src, url, git, forceRebuild);
  if (cloneResult !== null) {
    return cloneResult;
  }

  const binary = path.join(src, _BUILT_BINARY_REL);
  if (forceRebuild || !_binaryIsUsable(binary)) {
    const env = {
      ...process.env,
      PATH: `${CARGO_HOME_BIN}:${process.env["PATH"] ?? ""}`,
    };
    // cargo is non-null here: either resolveCargo() returned it, or rustup installed it above.
    const cargoBin: string = cargo ?? "";
    const [rc, tail] = runQuiet(
      [cargoBin, "build", "--release", "--bin", "automatised-pipeline"],
      { cwd: src, env, timeout: 1800 }, // source: Cortex pipeline_installer.py — _run_quiet(... timeout=1800)
    );
    if (rc !== 0 || !_binaryIsUsable(binary)) {
      return { action: "build_failed", detail: tail };
    }
  }

  return _swapSymlink(binary);
}

/**
 * Clone or refresh the source tree. Return null on success, or
 * a structured failure dict.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer.py:_ensure_source
 */
function _ensureSource(
  src: string,
  url: string,
  git: string,
  forceRebuild: boolean,
): PipelineInstallResult | null {
  // Validate any existing checkout.
  if (fs.existsSync(src) && !fs.existsSync(path.join(src, "Cargo.toml"))) {
    try {
      rmtreeQuiet(src);
    } catch (exc) {
      return {
        action: "clone_failed",
        detail: `stale partial src cleanup: ${String(exc)}`,
      };
    }
  }

  if (!fs.existsSync(src)) {
    // Clone into a .partial sibling, atomic-rename on success.
    const partial = src + ".partial";
    if (fs.existsSync(partial)) {
      rmtreeQuiet(partial);
    }
    const [rc, tail] = runQuiet(
      [git, "clone", "--depth=1", url, partial],
      { timeout: 1800 }, // source: Cortex pipeline_installer.py — _run_quiet([git, "clone", ...], timeout=1800)
    );
    if (rc !== 0 || !fs.existsSync(path.join(partial, "Cargo.toml"))) {
      rmtreeQuiet(partial);
      return { action: "clone_failed", detail: tail };
    }
    fs.renameSync(partial, src);
  } else if (forceRebuild) {
    runQuiet([git, "-C", src, "fetch", "--depth=1", "origin", "HEAD"]);
    runQuiet([git, "-C", src, "reset", "--hard", "FETCH_HEAD"]);
  }
  return null;
}

/**
 * Atomic symlink swap (link-to-temp + fs.renameSync).
 *
 * source: Cortex mcp_server/infrastructure/pipeline_installer.py:_swap_symlink
 */
function _swapSymlink(binary: string): PipelineInstallResult {
  try {
    fs.mkdirSync(INSTALL_BIN_DIR, { recursive: true });
    const tmpLink = INSTALL_SYMLINK + ".new";
    try {
      fs.unlinkSync(tmpLink);
    } catch {
      // may not exist
    }
    fs.symlinkSync(binary, tmpLink);
    fs.renameSync(tmpLink, INSTALL_SYMLINK);
  } catch (exc) {
    return { action: "symlink_failed", detail: String(exc) };
  }
  return { action: "installed", binary: INSTALL_SYMLINK };
}
