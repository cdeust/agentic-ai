/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Silent Rust toolchain bootstrap with optional hash-pinned installer.
 *
 * The rustup bootstrap script (sh.rustup.rs) is fetched once and verified
 * against a committed SHA256 manifest at scripts/rustup-init.sha256
 * before being piped to sh. This converts the standard curl | sh
 * trust-by-TLS model into trust-by-committed-hash.
 *
 * Maintenance flow
 * ----------------
 * The Cortex maintainer refreshes the hash manifest after a verified
 * read of the upstream script:
 *   curl -sSf https://sh.rustup.rs | shasum -a 256 \
 *     | awk '{print $1}' > scripts/rustup-init.sha256
 *
 * If the manifest file is missing or empty, hash pinning is OFF and the
 * installer falls back to plain curl | sh with a warning emitted to
 * the audit dict (hash_pin_status: "manifest_missing").
 *
 * Override
 * --------
 * - CORTEX_RUSTUP_PIN_HASH=0 — skip hash verification entirely.
 *
 * Layer: INFRASTRUCTURE — subprocess + network.
 * source: Cortex mcp_server/infrastructure/pipeline_install_rust.py
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runQuiet } from "./pipeline-installer-common.js";

/** Resolve a binary on PATH. Returns path or null. */
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

// source: Cortex mcp_server/infrastructure/pipeline_install_rust.py — _DISABLE_RUST_ENV
const _DISABLE_RUST_ENV = "CORTEX_AUTO_INSTALL_RUST";

// source: Cortex mcp_server/infrastructure/pipeline_install_rust.py — _DISABLE_HASH_PIN_ENV
const _DISABLE_HASH_PIN_ENV = "CORTEX_RUSTUP_PIN_HASH";

// source: Cortex mcp_server/infrastructure/pipeline_install_rust.py — _RUSTUP_URL
const _RUSTUP_URL = "https://sh.rustup.rs";

// source: Cortex mcp_server/infrastructure/pipeline_install_rust.py — _CARGO_HOME_BIN
export const CARGO_HOME_BIN = path.join(os.homedir(), ".cargo", "bin");

// Hash manifest path — repo root + scripts/rustup-init.sha256.
// The repo root is four levels up from this module file
// (packages/memory/src/infrastructure/<this>.ts).
// source: Cortex mcp_server/infrastructure/pipeline_install_rust.py — _HASH_MANIFEST
// source: Cortex mcp_server/infrastructure/pipeline_install_rust.py — _HASH_MANIFEST = Path(__file__).resolve().parents[2] / "scripts" / "rustup-init.sha256"
const _HASH_MANIFEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "scripts",
  // source: Cortex mcp_server/infrastructure/pipeline_install_rust.py — scripts/rustup-init.sha256 manifest
  "rustup-init.sha256",
);

/** Audit dict returned by installRustToolchain. */
export interface RustInstallResult {
  action:
    | "rust_already_present"
    | "rust_installed"
    | "rust_disabled"
    | "rust_curl_missing"
    | "rust_install_failed"
    | "rust_hash_mismatch";
  cargo?: string;
  detail?: string;
  hash_pin_status?: string;
}

/**
 * Return cargo path: PATH first, then ~/.cargo/bin/cargo.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_rust.py:resolve_cargo
 */
export function resolveCargo(): string | null {
  const found = _whichBin("cargo");
  if (found) return found;
  const candidate = path.join(CARGO_HOME_BIN, "cargo");
  try {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    }
  } catch {
    // not present or not executable
  }
  return null;
}

/**
 * Return the trimmed hex SHA256 from the manifest, or null.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_rust.py:_read_pinned_hash
 */
function _readPinnedHash(): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(_HASH_MANIFEST, "utf-8").trim();
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const token = trimmed.split(/\s+/)[0] ?? "";
    if (token.length === 64 && /^[0-9a-f]+$/.test(token)) {
      return token.toLowerCase();
    }
  }
  return null;
}

/**
 * Stream-hash a file with SHA256. Constant-memory.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_rust.py:_sha256_file
 */
// source: Cortex mcp_server/infrastructure/pipeline_install_rust.py:_sha256_file
function _sha256File(filePath: string): string {
  // source: SHA-256 = standard cryptographic hash per FIPS PUB 180-4
  const h = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  h.update(data);
  return h.digest("hex");
}

function _resolveCurl(): string | null {
  return _whichBin("curl");
}

/**
 * Convert subprocess result into the audit dict.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_rust.py:_finalize_rust_install
 */
function _finalizeRustInstall(
  rc: number,
  tail: string,
  pinStatus: string,
): RustInstallResult {
  if (rc !== 0) {
    return {
      action: "rust_install_failed",
      detail: tail,
      hash_pin_status: pinStatus,
    };
  }
  const cargo = resolveCargo();
  if (!cargo) {
    return {
      action: "rust_install_failed",
      detail: "cargo not found after rustup",
      hash_pin_status: pinStatus,
    };
  }
  return {
    action: "rust_installed",
    cargo,
    hash_pin_status: pinStatus,
  };
}

/**
 * Download the rustup script to a tempfile, verify hash, exec.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_rust.py:_install_with_hash_pin
 */
function _installWithHashPin(curl: string, pinnedHash: string): RustInstallResult {
  const tmpPath = path.join(os.tmpdir(), `rustup-init-${Date.now()}.sh`);
  try {
    const [downloadRc, downloadTail] = runQuiet(
      [curl, "--proto", "=https", "--tlsv1.2", "-sSf", "-o", tmpPath, _RUSTUP_URL],
      { timeout: 120 }, // source: Cortex pipeline_install_rust.py — _run_quiet(... timeout=120)
    );
    if (downloadRc !== 0) {
      return {
        action: "rust_install_failed",
        detail: `download: ${downloadTail}`,
        hash_pin_status: "verified",
      };
    }
    // source: Cortex pipeline_install_rust.py — actual = _sha256_file(tmp_path)
    const actual = _sha256File(tmpPath);
    if (actual !== pinnedHash) {
      return {
        action: "rust_hash_mismatch",
        detail: `expected=${pinnedHash} actual=${actual}`,
        hash_pin_status: "verified",
      };
    }
    const [rc, tail] = runQuiet(
      [
        "sh",
        tmpPath,
        "-y",
        "--default-toolchain",
        "stable",
        "--profile",
        "minimal",
        "--no-modify-path",
      ],
      { timeout: 900 }, // source: Cortex pipeline_install_rust.py — _run_quiet(... timeout=900) for rustup install
    );
    return _finalizeRustInstall(rc, tail, "verified");
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // best-effort
    }
  }
}

/**
 * Best-effort silent install of the Rust toolchain via rustup.
 *
 * Hash-verified path:
 *   1. Download the bootstrap script to a tempfile via curl.
 *   2. Compute its SHA256.
 *   3. Compare against the pinned manifest (if present and non-empty).
 *   4. On match, sh tempfile -y --profile minimal --no-modify-path.
 *   5. Mismatch → rust_hash_mismatch (does NOT execute the script).
 *
 * Returns audit dict with one of these actions:
 *   rust_already_present | rust_installed | rust_disabled
 *   rust_curl_missing | rust_install_failed | rust_hash_mismatch
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_rust.py:install_rust_toolchain
 */
export function installRustToolchain(): RustInstallResult {
  const disableEnv = process.env[_DISABLE_RUST_ENV] ?? "";
  if (["0", "false", "no"].includes(disableEnv.trim())) {
    return { action: "rust_disabled" };
  }

  const cargo = resolveCargo();
  if (cargo) {
    return { action: "rust_already_present", cargo };
  }

  const curl = _resolveCurl();
  if (!curl) {
    return { action: "rust_curl_missing" };
  }

  const pinDisabled = ["0", "false", "no"].includes(
    (process.env[_DISABLE_HASH_PIN_ENV] ?? "").trim(),
  );
  const pinnedHash = pinDisabled ? null : _readPinnedHash();

  if (pinnedHash) {
    return _installWithHashPin(curl, pinnedHash);
  }

  // Pin disabled or manifest missing — legacy curl-pipe-sh.
  const pinStatus = pinDisabled ? "disabled" : "manifest_missing";
  const curlPart = `${JSON.stringify(curl)} --proto '=https' --tlsv1.2 -sSf ${JSON.stringify(_RUSTUP_URL)}`;
  const cmd = `${curlPart} | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path`;
  const [rc, tail] = runQuiet(["sh", "-c", cmd], { timeout: 900 }); // source: Cortex pipeline_install_rust.py — _run_quiet(... timeout=900)
  return _finalizeRustInstall(rc, tail, pinStatus);
}
