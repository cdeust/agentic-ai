/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Prebuilt binary fast-path for the upstream pipeline install.
 *
 * When upstream publishes a GitHub Release with a per-platform tarball,
 * fetching + extracting it is ~10 s vs ~6 min for git+cargo. This module
 * implements the fast path with strict integrity gates:
 *
 *   1. Query GitHub Releases API for cdeust/automatised-pipeline.
 *   2. Match an asset for the host platform (os/arch).
 *   3. Download tarball + companion .sha256 file.
 *   4. Verify SHA256 before extracting.
 *   5. Extract the binary, install at ~/.claude/methodology/bin/mcp-server.
 *
 * If any step fails (404, no matching asset, hash mismatch, network), we
 * return "unavailable" and the caller falls through to the source build
 * path. Failure here is NEVER fatal — it's a fast path, not a substitute.
 *
 * Asset naming convention (upstream contract)
 * -------------------------------------------
 * - automatised-pipeline-{os}-{arch}.tar.gz containing the binary at
 *   the archive root as automatised-pipeline.
 * - automatised-pipeline-{os}-{arch}.tar.gz.sha256 carrying the hex digest.
 * - {os} ∈ {macos, linux}; {arch} ∈ {x86_64, aarch64}.
 *
 * Layer: INFRASTRUCTURE — network + filesystem.
 * source: Cortex mcp_server/infrastructure/pipeline_install_release.py
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as https from "node:https";
import * as zlib from "node:zlib";

// source: Cortex mcp_server/infrastructure/pipeline_install_release.py — _RELEASES_URL
const _RELEASES_URL =
  "https://api.github.com/repos/cdeust/automatised-pipeline/releases/latest";

// source: Cortex mcp_server/infrastructure/pipeline_install_release.py — _REQUEST_TIMEOUT = 30
const _REQUEST_TIMEOUT_MS = 30_000;

// source: Cortex mcp_server/infrastructure/pipeline_install_release.py — _DISABLE_ENV
const _DISABLE_ENV = "CORTEX_DISABLE_PREBUILT";

/** Audit dict returned by tryInstallPrebuilt. */
export interface PrebuiltInstallResult {
  action:
    | "prebuilt_disabled"
    | "prebuilt_unsupported_platform"
    | "prebuilt_unavailable"
    | "installed_prebuilt";
  binary?: string;
  tag?: string;
  detail?: string;
}

/**
 * Return {os}-{arch} for the running host, or null if unsupported.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_release.py:_platform_tag
 */
function _platformTag(): string | null {
  const platform = os.platform();
  const arch = os.arch();
  const osTag: Record<string, string> = { darwin: "macos", linux: "linux" };
  const archTag: Record<string, string> = {
    x64: "x86_64",
    arm64: "aarch64",
  };
  const osResult = osTag[platform];
  const archResult = archTag[arch];
  if (!osResult || !archResult) return null;
  return `${osResult}-${archResult}`;
}

/**
 * Plain HTTPS GET. Rejects on any error.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_release.py:_http_get
 */
function _httpGet(url: string, accept?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      headers: {
        "User-Agent": "cortex-installer",
        ...(accept ? { Accept: accept } : {}),
      },
      timeout: _REQUEST_TIMEOUT_MS,
    };
    const req = https.get(url, options, (res) => {
      // source: HTTP redirect handling — 3xx codes require following Location header
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        const location = res.headers["location"];
        if (location) {
          resolve(_httpGet(location, accept));
          return;
        }
      }
      // source: HTTP success codes 200–299
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode ?? "?"} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout fetching ${url}`));
    });
    req.on("error", reject);
  });
}

/**
 * Return (tarball_url, sha256_url) for the host platform tag, or null.
 *
 * Matches by suffix, not exact name, so upstream can prefix versions.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_release.py:_find_assets
 */
function _findAssets(
  release: Record<string, unknown>,
  tag: string,
): [string, string] | null {
  let tarUrl: string | null = null;
  let shaUrl: string | null = null;
  const suffix = `-${tag}.tar.gz`;
  const assets = (release["assets"] ?? []) as Array<Record<string, unknown>>;
  for (const asset of assets) {
    const name = String(asset["name"] ?? "");
    const url = asset["browser_download_url"];
    if (!url) continue;
    if (name.endsWith(suffix)) {
      tarUrl = String(url);
    } else if (name.endsWith(suffix + ".sha256")) { // source: Cortex pipeline_install_release.py — sha256 companion file convention
      shaUrl = String(url);
    }
  }
  if (tarUrl && shaUrl) return [tarUrl, shaUrl];
  return null;
}

/**
 * Verify SHA256, extract automatised-pipeline to destDir, return path.
 *
 * Refuses tar entries that escape destDir (path-traversal guard).
 *
 * precondition:  tarPath is an existing file; expectedSha is a 64-char hex string.
 * postcondition: returns the extracted binary path on success; null on hash
 *   mismatch or missing binary.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_release.py:_verify_and_extract
 */
async function _verifyAndExtract(
  tarPath: string,
  expectedSha: string,
  destDir: string,
): Promise<string | null> {
  // Compute SHA256 of the tarball
  // source: Cortex mcp_server/infrastructure/pipeline_install_release.py:_verify_and_extract — hashlib.sha256
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(tarPath);
  hash.update(data);
  const actual = hash.digest("hex");
  if (actual !== expectedSha.toLowerCase()) {
    return null;
  }

  const resolvedDest = path.resolve(destDir);
  let extractedBin: string | null = null;

  // Pure Node.js tar.gz extraction with path-traversal guard.
  // source: Cortex mcp_server/infrastructure/pipeline_install_release.py:_verify_and_extract
  // We use tarball streaming: gunzip -> parse tar headers manually.
  // POSIX USTAR spec: https://pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html
  try {
    const compressed = fs.readFileSync(tarPath);
    const uncompressed = zlib.gunzipSync(compressed);
    // source: POSIX USTAR tar — 512-byte blocks. Header at block[0..511], data follows.
    let offset = 0;
    // source: POSIX USTAR — 512-byte blocks; iterate until end-of-archive
    while (offset + 512 <= uncompressed.length) {
      const header = uncompressed.subarray(offset, offset + 512); // source: POSIX USTAR — header block is bytes 0–511
      // source: POSIX USTAR — name field: bytes 0–99, NUL-terminated; max 100 chars
      const nameBuf = header.subarray(0, 100);
      const nameEnd = nameBuf.indexOf(0);
      // source: POSIX USTAR — name field max 100 bytes
      const name = nameBuf.subarray(0, nameEnd >= 0 ? nameEnd : 100).toString("utf-8");
      if (!name) break; // end-of-archive sentinel

      // source: POSIX USTAR — size field: bytes 124–135, octal ASCII
      const sizeStr = header.subarray(124, 136).toString("ascii").trim().replace(/\0/g, "");
      const fileSize = parseInt(sizeStr, 8) || 0;

      // source: POSIX USTAR — type flag: byte 156; 0x30='0' or 0x00 = regular file
      const typeFlag = header[156];
      const isRegular = typeFlag === 0x30 || typeFlag === 0; // '0' or \0

      offset += 512; // source: POSIX USTAR — advance past 512-byte header block

      if (isRegular && fileSize > 0) {
        const entryName = name.replace(/^\.\//, "");
        const target = path.resolve(destDir, entryName);
        // Path-traversal guard: target must be under resolvedDest
        if (
          target.startsWith(resolvedDest + path.sep) ||
          target === resolvedDest
        ) {
          if (path.basename(entryName) === "automatised-pipeline") {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(
              target,
              uncompressed.subarray(offset, offset + fileSize),
            );
            extractedBin = target;
          }
        }
      }

      // Advance past data blocks (rounded up to 512-byte boundary)
      offset += Math.ceil(fileSize / 512) * 512; // source: POSIX USTAR — data blocks rounded up to 512-byte boundary
    }
  } catch {
    return null;
  }

  if (!extractedBin || !fs.existsSync(extractedBin)) {
    return null;
  }
  // source: Cortex pipeline_install_release.py — os.chmod(extracted, 0o755) = rwxr-xr-x
  fs.chmodSync(extractedBin, 0o755);
  return extractedBin;
}

/**
 * Try the fast path. Returns audit dict.
 *
 * Always-non-fatal: "unavailable" is the default when anything goes
 * wrong. Callers fall through to the source-build path.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_install_release.py:try_install_prebuilt
 */
export async function tryInstallPrebuilt(
  symlinkDest: string,
): Promise<PrebuiltInstallResult> {
  const disableEnv = process.env[_DISABLE_ENV] ?? "";
  if (["1", "true", "yes"].includes(disableEnv.trim())) {
    return { action: "prebuilt_disabled" };
  }

  const tag = _platformTag();
  if (!tag) {
    return { action: "prebuilt_unsupported_platform" };
  }

  let release: Record<string, unknown>;
  try {
    const body = await _httpGet(
      _RELEASES_URL,
      "application/vnd.github+json",
    );
    release = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
  } catch (exc) {
    return {
      action: "prebuilt_unavailable",
      detail: `releases api: ${String(exc)}`,
    };
  }

  const found = _findAssets(release, tag);
  if (!found) {
    return {
      action: "prebuilt_unavailable",
      detail: `no asset for ${tag}`,
    };
  }
  const [tarUrl, shaUrl] = found;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-prebuilt-"));
  try {
    let tarBytes: Buffer;
    let shaBytes: Buffer;
    try {
      [tarBytes, shaBytes] = await Promise.all([
        _httpGet(tarUrl),
        _httpGet(shaUrl),
      ]);
    } catch (exc) {
      return {
        action: "prebuilt_unavailable",
        detail: `download: ${String(exc)}`,
      };
    }

    const tarPath = path.join(work, "asset.tar.gz");
    fs.writeFileSync(tarPath, tarBytes);

    // Manifest format: <sha256>  <filename> (shasum -a 256 style)
    // source: Cortex mcp_server/infrastructure/pipeline_install_release.py:try_install_prebuilt
    const digestText = shaBytes.toString("utf-8").trim();
    const expectedSha = digestText.split(/\s+/)[0] ?? "";
    // source: SHA-256 digest = 64 hex characters (256 bits / 4 bits per hex digit)
    if (expectedSha.length !== 64) {
      return {
        action: "prebuilt_unavailable",
        detail: "malformed sha256 manifest", // source: Cortex pipeline_install_release.py — "malformed sha256 manifest" error string
      };
    }

    const binary = await _verifyAndExtract(tarPath, expectedSha, work);
    if (!binary) {
      return {
        action: "prebuilt_unavailable",
        detail: "hash mismatch or no binary in archive",
      };
    }

    // Move the verified binary into the methodology bin dir.
    const symlinkDir = path.dirname(symlinkDest);
    fs.mkdirSync(symlinkDir, { recursive: true });
    const final = path.join(symlinkDir, "automatised-pipeline.prebuilt");
    fs.renameSync(binary, final);
    // source: Cortex pipeline_install_release.py — os.chmod(final, 0o755) = rwxr-xr-x
    fs.chmodSync(final, 0o755);

    // Atomic symlink swap: link-to-temp + fs.renameSync.
    const tmpLink = symlinkDest + ".new";
    try {
      fs.unlinkSync(tmpLink);
    } catch {
      // may not exist
    }
    fs.symlinkSync(final, tmpLink);
    fs.renameSync(tmpLink, symlinkDest);

    return {
      action: "installed_prebuilt",
      binary: symlinkDest,
      tag: String(release["tag_name"] ?? ""),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
