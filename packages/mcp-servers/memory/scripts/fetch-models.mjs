#!/usr/bin/env node
/**
 * fetch-models.mjs — Provision the THREE offline models that pack-mcpb bundles,
 * into the local caches it reads from. Run this in CI BEFORE pack-mcpb so the
 * produced .mcpb is fully offline (no first-use HuggingFace download).
 *
 * Direct HTTPS downloads (no @xenova/transformers / flashrank dependency, so it
 * works from any cwd and never depends on the pnpm store layout):
 *   1. Xenova/all-MiniLM-L6-v2        embedding model, fp32 (engine uses quantized:false)
 *        -> ~/.cache/huggingface/hub/Xenova/all-MiniLM-L6-v2/{config,tokenizer,...}, onnx/model.onnx
 *   2. Xenova/ms-marco-MiniLM-L-12-v2 reranker tokenizer (json files only)
 *        -> ~/.cache/huggingface/hub/Xenova/ms-marco-MiniLM-L-12-v2/{config,tokenizer,...}
 *   3. FlashRank ms-marco-MiniLM-L-12-v2.zip  cross-encoder ONNX
 *        -> $FLASHRANK_CACHE_DIR (default ~/.cache/flashrank)/ms-marco-MiniLM-L-12-v2/flashrank-MiniLM-L-12-v2_Q.onnx
 *
 * These are exactly the paths pack-mcpb.mjs findXenovaModelSource / findFlashrankOnnxSource hunt.
 *
 * source: URLs verified 2026-06-19 (HEAD 200) —
 *   huggingface.co/Xenova/all-MiniLM-L6-v2, /Xenova/ms-marco-MiniLM-L-12-v2,
 *   huggingface.co/prithivida/flashrank (flashrank library's model host).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

const log = (m) => process.stderr.write(`[fetch-models] ${m}\n`);
const HF = "https://huggingface.co";

function curlTo(url, dest) {
  mkdirSync(join(dest, ".."), { recursive: true });
  execFileSync("curl", ["-fsSL", "--retry", "3", "--retry-delay", "2", "-o", dest, url], { stdio: ["ignore", "ignore", "inherit"] });
}

function fetchXenovaModel(model, files) {
  const root = join(homedir(), ".cache/huggingface/hub/Xenova", model);
  for (const f of files) {
    const dest = join(root, f);
    if (existsSync(dest)) continue;
    log(`xenova ${model}: ${f}`);
    curlTo(`${HF}/Xenova/${model}/resolve/main/${f}`, dest);
  }
}

const FLASHRANK_URL = `${HF}/prithivida/flashrank/resolve/main/ms-marco-MiniLM-L-12-v2.zip`;
const FLASHRANK_CACHE_DIR = process.env["FLASHRANK_CACHE_DIR"] || join(homedir(), ".cache/flashrank");
const FLASHRANK_ONNX = join(FLASHRANK_CACHE_DIR, "ms-marco-MiniLM-L-12-v2", "flashrank-MiniLM-L-12-v2_Q.onnx");

function fetchFlashrank() {
  if (existsSync(FLASHRANK_ONNX)) {
    log(`flashrank: already present at ${FLASHRANK_ONNX}`);
    return;
  }
  mkdirSync(FLASHRANK_CACHE_DIR, { recursive: true });
  const zip = join(tmpdir(), "flashrank-ms-marco.zip");
  log(`flashrank: downloading ${FLASHRANK_URL}`);
  execFileSync("curl", ["-fsSL", "--retry", "3", "--retry-delay", "2", "-o", zip, FLASHRANK_URL], { stdio: ["ignore", "ignore", "inherit"] });
  log(`flashrank: unzipping into ${FLASHRANK_CACHE_DIR}`);
  // zip extracts to ms-marco-MiniLM-L-12-v2/flashrank-MiniLM-L-12-v2_Q.onnx (verified 2026-06-19)
  execFileSync("unzip", ["-oq", zip, "-x", "__MACOSX/*", "-d", FLASHRANK_CACHE_DIR], { stdio: "inherit" });
  rmSync(zip, { force: true });
  if (!existsSync(FLASHRANK_ONNX)) throw new Error(`flashrank: expected ${FLASHRANK_ONNX} after unzip`);
  log(`flashrank: ready at ${FLASHRANK_ONNX}`);
}

// source: transformers-embedding-engine.ts uses quantized:false → fp32 onnx/model.onnx
fetchXenovaModel("all-MiniLM-L6-v2", ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model.onnx"]);
// reranker.ts uses Xenova/ms-marco only as the TOKENIZER → json files, no onnx
fetchXenovaModel("ms-marco-MiniLM-L-12-v2", ["config.json", "tokenizer.json", "tokenizer_config.json"]);
fetchFlashrank();
log("done — all 3 offline models provisioned.");
