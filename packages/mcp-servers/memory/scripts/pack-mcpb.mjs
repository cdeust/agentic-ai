#!/usr/bin/env node
/**
 * pack-mcpb.mjs — Build a Node.js .mcpb (Desktop Extension) for
 * @agentic/mcp-server-memory, suitable for the Anthropic MCPB directory.
 *
 * WHY this shape (verified 2026-06-19):
 *   - The package depends on three workspace packages (@agentic/core, /memory,
 *     /memory-dashboard, all "workspace:*"). They are NOT published to npm, so
 *     `pnpm deploy` is the only workspace-aware bundler — but pnpm 10 refuses it
 *     unless the whole monorepo sets inject-workspace-packages=true. We do not
 *     flip a repo-wide setting just to package one server.
 *   - Instead: esbuild inlines ALL pure-JS code (the @agentic/* workspace deps +
 *     @modelcontextprotocol/sdk + zod) into one dist/index.js. Then the ONLY
 *     remaining dependencies are NATIVE/ML packages, and those are all PUBLISHED
 *     on npm — so a plain `npm install` in the bundle dir resolves them with
 *     platform-correct native builds. Verified: esbuild bundles cleanly (2.4 MB,
 *     no unresolvable internal dynamic imports).
 *
 * NATIVE externals (must ship as real node_modules, per MCPB "all dependencies
 *   must be bundled in node_modules"):
 *     better-sqlite3, sqlite-vec, onnxruntime-node, @xenova/transformers, pg
 *     (+ optional tree-sitter* grammars for codebase tools).
 *   The bundle is therefore PLATFORM-SPECIFIC (~400–500 MB; @xenova bundles
 *   onnxruntime-node@1.14 AND the reranker loads 1.25.1 directly → two ORT runtimes).
 *
 * Embedding model (Xenova/all-MiniLM-L6-v2, ~90 MB) is downloaded at first use to
 *   the HF cache by default. Pass --bundle-model to ship it offline.
 *
 * Layout produced (the runtime reads ../package.json for name+version, so
 *   package.json MUST sit at the bundle root, one level above dist/):
 *     <out>/bundle/
 *       manifest.json
 *       icon.png
 *       package.json        (name=@agentic/mcp-server-memory, version, deps=natives)
 *       dist/index.js       (esbuild bundle)
 *       node_modules/       (npm-installed native deps)
 *       [models/]           (only with --bundle-model)
 *
 * Usage:
 *   node scripts/pack-mcpb.mjs [--out dist-mcpb] [--bundle-model]
 *                              [--keep-tree-sitter] [--no-pack]
 *
 * source: anthropics/mcpb MANIFEST.md (manifest_version "0.3", server.type "node")
 * source: MCPB README — `mcpb pack <dir>` packs+validates a directory into .mcpb
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const OUT = resolve(PKG_ROOT, opt("--out", "dist-mcpb"));
const BUNDLE = join(OUT, "bundle");
// Models are bundled BY DEFAULT so the .mcpb is fully offline (transformer +
// reranker present in the binary, like Cortex). Opt out with --no-bundle-model
// for a slim bundle that downloads models at first use. `--bundle-model` is
// still accepted as an explicit no-op for back-compat.
const BUNDLE_MODEL = !flag("--no-bundle-model");
const KEEP_TREE_SITTER = flag("--keep-tree-sitter");
const DO_PACK = !flag("--no-pack");

// Target platform = the runner executing this script. The native deps shipped in
// the bundle (better-sqlite3, sqlite-vec, onnxruntime-node, sharp) install only the
// HOST-matching prebuild (sqlite-vec/sharp are per-platform), so the bundle's real
// target is whatever we are building on — there is no cross-build. We stamp the
// bundle with that os/arch: the manifest's compatibility.platforms (OS gate) and the
// .mcpb filename (which also carries arch, since the manifest has no arch field).
// source: anthropics/mcpb MANIFEST.md (no arch field); sqlite-vec per-platform optionalDependencies
const TARGET_OS = process.platform; // "darwin" | "linux" | "win32"
const TARGET_ARCH = process.arch; // "arm64" | "x64"
const PLATFORM_TAG = `${TARGET_OS}-${TARGET_ARCH}`;

// Native/ML deps to ship as real node_modules. Versions pinned to what the
// engine was verified against (reranker parity needs onnxruntime-node@1.25.1).
// source: packages/memory/package.json dependencies (resolved store versions)
const NATIVE_DEPS = {
  "better-sqlite3": "12.9.0",
  "sqlite-vec": "0.1.9",
  "onnxruntime-node": "1.25.1",
  "@xenova/transformers": "2.17.2",
  pg: "8.13.0",
};
const TREE_SITTER_DEPS = {
  "tree-sitter": "0.21.0",
  "tree-sitter-typescript": "0.21.0",
  "tree-sitter-javascript": "0.21.0",
  "tree-sitter-python": "0.21.0",
  "tree-sitter-rust": "0.21.0",
  "tree-sitter-go": "0.21.0",
  "tree-sitter-swift": "0.5.0",
};

const log = (m) => process.stderr.write(`[pack-mcpb] ${m}\n`);

function readPkg() {
  return JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
}

function esbuildBin() {
  // esbuild is a root devDep in this pnpm monorepo, not a direct dep of this
  // package, so a bare `import "esbuild"` does not resolve from here. Invoke the
  // CLI binary from the workspace root instead (verified present: esbuild 0.28.0).
  const root = resolve(PKG_ROOT, "../../..");
  const bin = join(root, "node_modules/.bin/esbuild");
  return existsSync(bin) ? bin : null;
}

function bundleEntry() {
  log("esbuild: bundling src/index.ts (natives external) …");
  const external = Object.keys({ ...NATIVE_DEPS, ...TREE_SITTER_DEPS }).flatMap((p) => [
    `--external:${p}`,
  ]);
  const args = [
    join(PKG_ROOT, "src/index.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    `--outfile=${join(BUNDLE, "dist/index.js")}`,
    // NO shebang banner. esbuild already PRESERVES the entry file's shebang
    // (src/index.ts:1), so a `--banner:js=#!/usr/bin/env node` here produced a
    // SECOND shebang on line 2. Node strips only the line-1 shebang and parses
    // line 2 as JS → "SyntaxError: Invalid or unexpected token", and the server
    // never boots. This shipped in v0.3.0 (verified non-functional 2026-06-19).
    // The shebang is unused anyway: the manifest runs `node .../dist/index.js`.
    "--log-level=warning",
    ...external,
  ];
  const bin = esbuildBin();
  if (bin) execFileSync(bin, args, { stdio: "inherit" });
  else execFileSync("npx", ["--yes", "esbuild", ...args], { stdio: "inherit" });
  postProcessBundle(join(BUNDLE, "dist/index.js"));
  log("esbuild: done.");
}

// Two deterministic fixes applied to the esbuild ESM output:
//   1. Strip any leading shebang. esbuild preserves the entry's shebang, but the
//      .mcpb runs `node dist/index.js`, so it is unused — and a stray `#!` on any
//      line but line 1 is a SyntaxError (this broke v0.3.0).
//   2. Prepend a CommonJS `require` shim. Bundled CJS deps (e.g. node-fetch@2)
//      call require() for Node builtins; in an ESM bundle esbuild's __require
//      helper throws 'Dynamic require of "stream" is not supported' UNLESS a real
//      `require` exists (it checks `typeof require !== "undefined"` and delegates).
//      createRequire(import.meta.url) provides it. source: esbuild docs — ESM
//      output + CJS deps require this shim; evaw/esbuild issues #1921, #1944.
function postProcessBundle(outPath) {
  const original = readFileSync(outPath, "utf8");
  const withoutShebang = original.replace(/^(#![^\n]*\n)+/, "");
  const requireShim =
    'import { createRequire as __mcpbCreateRequire } from "node:module";\n' +
    "const require = __mcpbCreateRequire(import.meta.url);\n";
  writeFileSync(outPath, requireShim + withoutShebang);
}

function writeBundlePackageJson(pkg) {
  // name MUST stay @agentic/mcp-server-memory so the runtime's serverInfo.name
  // (read from this file) is unchanged. version stays in lockstep with source.
  const deps = KEEP_TREE_SITTER ? { ...NATIVE_DEPS, ...TREE_SITTER_DEPS } : { ...NATIVE_DEPS };
  const bundlePkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: "module",
    main: "dist/index.js",
    dependencies: deps,
  };
  writeFileSync(join(BUNDLE, "package.json"), JSON.stringify(bundlePkg, null, 2) + "\n");
  log(`bundle package.json: ${pkg.name}@${pkg.version} + ${Object.keys(deps).length} native deps`);
}

function installNatives() {
  log("npm install (native deps, platform builds) … this downloads/builds ~400–500 MB");
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: BUNDLE,
    stdio: "inherit",
  });
  log("npm install: done.");
}

// Models shipped so the .mcpb is fully OFFLINE (no first-use download). Three
// artifacts, two distinct load paths:
//   1. Xenova/all-MiniLM-L6-v2        384-d fp32 embeddings (remember/recall)  ~90 MB
//        @xenova resolves it from its PACKAGE-RELATIVE .cache (the engine does NOT
//        override cacheDir; transformers.js@2.17.2 defaults to <pkg>/.cache —
//        verified: the locally-downloaded copy lives in that .cache). Ship whole.
//   2. Xenova/ms-marco-MiniLM-L-12-v2  reranker TOKENIZER ONLY (tokenizer.json)
//        @xenova's ms-marco ONNX is NOT used (wrong INT8 logits — see reranker.ts),
//        so its onnx/ subdir is skipped to save ~133 MB.
//   3. FlashRank flashrank-MiniLM-L-12-v2_Q.onnx  cross-encoder MODEL           ~135 MB
//        loaded by onnxruntime-node DIRECTLY from FLASHRANK_CACHE_DIR (reranker.ts).
//        Shipped under bundle/models/flashrank/<name>/ and pointed to by the
//        manifest env FLASHRANK_CACHE_DIR=${__dirname}/models/flashrank.
// source: transformers-embedding-engine.ts (DEFAULT_MODEL_ID, quantized:false)
// source: recall/reranker.ts (FLASHRANK_CACHE_DIR, FLASHRANK_ONNX_FILE, ort direct)
const XENOVA_MODELS = ["all-MiniLM-L6-v2", "ms-marco-MiniLM-L-12-v2"];
const XENOVA_TOKENIZER_ONLY = new Set(["ms-marco-MiniLM-L-12-v2"]); // skip its onnx/
const FLASHRANK_MODEL_NAME = "ms-marco-MiniLM-L-12-v2";
const FLASHRANK_ONNX_FILE = "flashrank-MiniLM-L-12-v2_Q.onnx";

function findXenovaModelSource(modelName) {
  // @xenova/transformers@2.17.2 resolves models from its package-relative .cache.
  // Hunt the model in the known local caches (pnpm store + HF hub).
  const roots = [
    join(PKG_ROOT, "../../../node_modules/.pnpm/@xenova+transformers@2.17.2/node_modules/@xenova/transformers/.cache/Xenova"),
    join(homedir(), ".cache/huggingface/hub/Xenova"),
  ];
  for (const r of roots) {
    const p = join(r, modelName);
    if (existsSync(p)) return p;
  }
  return null;
}

function findFlashrankOnnxSource() {
  // reranker.ts reads FLASHRANK_CACHE_DIR ?? os.tmpdir(); the file is downloaded
  // to <cacheDir>/<model>/<onnx>. Locally it lives under ~/.cache/flashrank (the
  // user's configured FLASHRANK_CACHE_DIR). Hunt every plausible root.
  const roots = [process.env["FLASHRANK_CACHE_DIR"], join(homedir(), ".cache/flashrank"), tmpdir()].filter(Boolean);
  for (const r of roots) {
    const p = join(r, FLASHRANK_MODEL_NAME, FLASHRANK_ONNX_FILE);
    if (existsSync(p)) return p;
  }
  return null;
}

function maybeBundleModel(manifest) {
  if (!BUNDLE_MODEL) {
    log("model: NOT bundled (--no-bundle-model) — xenova + FlashRank download at first use (needs network once).");
    return manifest;
  }
  // (1)+(2) xenova embedding model + reranker tokenizer → bundled package .cache.
  const xenovaCache = join(BUNDLE, "node_modules/@xenova/transformers/.cache/Xenova");
  mkdirSync(xenovaCache, { recursive: true });
  for (const m of XENOVA_MODELS) {
    const src = findXenovaModelSource(m);
    if (!src) {
      log(`WARNING: xenova model ${m} not found in any local cache — offline use falls back to a network download. Populate it (run a remember + a reranked recall once) then re-pack.`);
      continue;
    }
    const dst = join(xenovaCache, m);
    if (XENOVA_TOKENIZER_ONLY.has(m)) {
      log(`model: copying ${m} (tokenizer only, skipping onnx/) -> node_modules/@xenova/transformers/.cache/Xenova/${m}`);
      cpSync(src, dst, { recursive: true, filter: (s) => basename(s) !== "onnx" });
    } else {
      log(`model: copying ${m} -> node_modules/@xenova/transformers/.cache/Xenova/${m}`);
      cpSync(src, dst, { recursive: true });
    }
  }
  // (3) FlashRank cross-encoder ONNX → bundle/models/flashrank/<name>/, wired via env.
  const flashSrc = findFlashrankOnnxSource();
  if (!flashSrc) {
    log(`WARNING: FlashRank ONNX ${FLASHRANK_ONNX_FILE} not found (looked in FLASHRANK_CACHE_DIR, ~/.cache/flashrank, tmpdir). The cross-encoder reranker will be DISABLED offline (graceful fallback). Populate it (run a reranked recall once) then re-pack.`);
  } else {
    const flashDir = join(BUNDLE, "models/flashrank", FLASHRANK_MODEL_NAME);
    mkdirSync(flashDir, { recursive: true });
    cpSync(flashSrc, join(flashDir, FLASHRANK_ONNX_FILE));
    manifest.server = manifest.server ?? {};
    manifest.server.mcp_config = manifest.server.mcp_config ?? {};
    manifest.server.mcp_config.env = {
      ...(manifest.server.mcp_config.env ?? {}),
      FLASHRANK_CACHE_DIR: "${__dirname}/models/flashrank",
    };
    log(`model: copied FlashRank ONNX -> models/flashrank/${FLASHRANK_MODEL_NAME}/${FLASHRANK_ONNX_FILE}; manifest env FLASHRANK_CACHE_DIR set.`);
  }
  return manifest;
}

function writeManifestAndAssets(pkg) {
  const manifestSrc = join(PKG_ROOT, "mcpb/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestSrc, "utf8"));
  manifest.version = pkg.version; // keep manifest in lockstep with package.json
  // Narrow the OS gate to the runner we are building on: the native binaries only
  // run on this OS. Arch (arm64 vs x64) cannot be expressed in the manifest, so it
  // is disambiguated by the .mcpb filename instead. source: anthropics/mcpb MANIFEST.md
  manifest.compatibility = { ...manifest.compatibility, platforms: [TARGET_OS] };
  const withModel = maybeBundleModel(manifest);
  writeFileSync(join(BUNDLE, "manifest.json"), JSON.stringify(withModel, null, 2) + "\n");

  const iconSrc = join(PKG_ROOT, "mcpb/icon.png");
  if (existsSync(iconSrc)) cpSync(iconSrc, join(BUNDLE, "icon.png"));
  else log("WARNING: mcpb/icon.png missing — add a PNG icon before submitting.");

  // Guard: refuse to pack a manifest still carrying TODO_ placeholders.
  const raw = readFileSync(join(BUNDLE, "manifest.json"), "utf8");
  if (raw.includes("TODO_")) {
    log("WARNING: manifest still contains TODO_ placeholders (author.url, privacy, license …). Fill them before submission.");
  }
}

function packMcpb(pkg) {
  if (!DO_PACK) {
    log(`--no-pack: bundle assembled at ${BUNDLE} (not packed).`);
    return;
  }
  // Filename carries os+arch because the bundle is platform-specific (native deps)
  // and the MCPB manifest has no arch field. source: anthropics/mcpb MANIFEST.md
  const outFile = join(OUT, `agentic-memory-${pkg.version}-${PLATFORM_TAG}.mcpb`);
  log(`mcpb pack -> ${outFile}`);
  execFileSync("npx", ["--yes", "@anthropic-ai/mcpb", "pack", BUNDLE, outFile], {
    cwd: PKG_ROOT,
    stdio: "inherit",
  });
  log(`DONE: ${outFile}`);
}

async function main() {
  const pkg = readPkg();
  log(`packaging ${pkg.name}@${pkg.version} → ${OUT}`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(BUNDLE, "dist"), { recursive: true });
  await bundleEntry();
  writeBundlePackageJson(pkg);
  installNatives();
  writeManifestAndAssets(pkg);
  packMcpb(pkg);
}

main().catch((err) => {
  log(`FAILED: ${err?.stack || String(err)}`);
  process.exit(1);
});
