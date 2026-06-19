#!/usr/bin/env node
/**
 * smoke-mcpb.mjs — Runtime smoke-test GATE for the packed .mcpb. Exits non-zero
 * (failing CI) unless the bundle actually BOOTS and works OFFLINE. This is the
 * gate the v0.3.0 release lacked: CI proved build+pack but never ran the bundle,
 * shipping a .mcpb with three load-time crashes (double shebang, `pg` named
 * import, node-fetch dynamic require) and no bundled models.
 *
 * Usage: node smoke-mcpb.mjs <extracted-bundle-dir> [--min-tools N]
 *
 * Checks (all with the HuggingFace network DISABLED, so any success is offline):
 *   1. `node dist/index.js` boots and answers MCP `initialize`        (shebang/pg/require)
 *   2. tools/list returns >= min-tools                                (composition root intact)
 *   3. remember x2 + recall succeed, recall returns results           (embedding model offline)
 *   4. the bundled FlashRank ONNX loads and discriminates a CE pair   (reranker/fusion offline)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const BUNDLE = process.argv[2];
const MIN_TOOLS = Number((process.argv.includes("--min-tools") ? process.argv[process.argv.indexOf("--min-tools") + 1] : 48));
if (!BUNDLE || !existsSync(join(BUNDLE, "dist/index.js"))) {
  console.error(`smoke-mcpb: bundle dir with dist/index.js required, got: ${BUNDLE}`);
  process.exit(2);
}

const FLASHRANK_DIR = join(BUNDLE, "models/flashrank");
const FLASHRANK_ONNX = join(FLASHRANK_DIR, "ms-marco-MiniLM-L-12-v2", "flashrank-MiniLM-L-12-v2_Q.onnx");
const home = mkdtempSync(join(tmpdir(), "mcpb-smoke-"));
const offlineEnv = {
  ...process.env,
  HOME: home,
  CORTEX_DB_PATH: join(home, "smoke.db"),
  FLASHRANK_CACHE_DIR: FLASHRANK_DIR,
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1",
  HF_ENDPOINT: "http://127.0.0.1:9",
  HF_HOME: join(home, ".hf"),
  CORTEX_TELEMETRY_DISABLED: "1",
  CORTEX_CONSOLIDATION_DISABLED: "1",
  CORTEX_GROOMING_DAEMON: "0",
  CORTEX_INGEST_BACKGROUND: "0",
  CORTEX_CONSOLIDATE_BACKGROUND: "0",
};
delete offlineEnv.DATABASE_URL;
for (const k of Object.keys(offlineEnv)) if (k.startsWith("PG")) delete offlineEnv[k];

const fail = (msg) => { console.error(`smoke-mcpb: FAIL — ${msg}`); process.exit(1); };

async function driveServer() {
  const proc = spawn("node", [join(BUNDLE, "dist/index.js")], { cwd: BUNDLE, env: offlineEnv, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", err = "";
  const pending = new Map();
  proc.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  proc.stderr.on("data", (d) => { err += d.toString(); });
  proc.on("exit", (code) => { for (const r of pending.values()) r({ __exit: code, err }); });

  let id = 0;
  const rpc = (method, params, timeoutMs) => new Promise((resolve) => {
    const cid = ++id;
    const timer = setTimeout(() => { pending.delete(cid); resolve({ __timeout: true, err }); }, timeoutMs);
    pending.set(cid, (m) => { clearTimeout(timer); resolve(m); });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: cid, method, params }) + "\n");
  });
  const tool = async (name, args, t) => {
    const r = await rpc("tools/call", { name, arguments: args }, t);
    if (r.__exit !== undefined) fail(`server exited (code ${r.__exit}) during ${name}.\n--- stderr ---\n${r.err}`);
    if (r.__timeout) fail(`timeout during ${name}.\n--- stderr ---\n${r.err}`);
    const txt = (r.result?.content || []).map((c) => c.text || "").join("");
    if (r.result?.isError) fail(`tool ${name} returned isError.\n${txt}`);
    return txt;
  };

  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-gate", version: "1.0.0" } }, 60000);
  if (init.__exit !== undefined) fail(`server crashed on initialize (code ${init.__exit}).\n--- stderr ---\n${init.err}`);
  if (init.__timeout || !init.result) fail(`no initialize response.\n--- stderr ---\n${init.err}`);
  console.error(`smoke-mcpb: boot OK — ${init.result.serverInfo?.name}@${init.result.serverInfo?.version}`);

  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tl = await rpc("tools/list", {}, 30000);
  const count = tl.result?.tools?.length ?? 0;
  if (count < MIN_TOOLS) fail(`tools/list returned ${count} < ${MIN_TOOLS}`);
  console.error(`smoke-mcpb: tools/list OK — ${count} tools`);

  await tool("remember", { content: "The Eiffel Tower is a wrought-iron lattice tower in Paris, France." }, 150000);
  await tool("remember", { content: "Mount Fuji is the tallest mountain in Japan." }, 40000);
  const recallTxt = await tool("recall", { query: "Where is the Eiffel Tower located?", max_results: 5 }, 90000);
  if (!/Eiffel/.test(recallTxt)) fail(`recall did not return the expected memory (offline embedding broken?).\n${recallTxt.slice(0, 300)}`);
  console.error("smoke-mcpb: remember + recall OK (embedding model loaded offline)");

  proc.kill();
}

async function checkFusion() {
  if (!existsSync(FLASHRANK_ONNX)) fail(`FlashRank ONNX not bundled at ${FLASHRANK_ONNX} (reranker/fusion would be disabled offline)`);
  const bundleRequire = createRequire(join(BUNDLE, "package.json"));
  const ort = (await import(pathToFileURL(bundleRequire.resolve("onnxruntime-node")).href)).default;
  const { AutoTokenizer } = await import(pathToFileURL(bundleRequire.resolve("@xenova/transformers")).href);
  const session = await ort.InferenceSession.create(FLASHRANK_ONNX);
  const tokenizer = await AutoTokenizer.from_pretrained("Xenova/ms-marco-MiniLM-L-12-v2");
  const score = async (q, p) => {
    const enc = tokenizer(q, { text_pair: p, padding: false, truncation: true, return_tensor: false });
    const ids = Array.from(enc.input_ids), mask = Array.from(enc.attention_mask);
    const types = enc.token_type_ids ? Array.from(enc.token_type_ids) : new Array(ids.length).fill(0);
    const n = ids.length;
    const r = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, n]),
      attention_mask: new ort.Tensor("int64", BigInt64Array.from(mask.map((x) => BigInt(x))), [1, n]),
      token_type_ids: new ort.Tensor("int64", BigInt64Array.from(types.map((x) => BigInt(x))), [1, n]),
    });
    return 1 / (1 + Math.exp(-Number(r.logits?.data[0] ?? 0)));
  };
  const rel = await score("Where is the Eiffel Tower located?", "The Eiffel Tower is in Paris, France.");
  const irr = await score("Where is the Eiffel Tower located?", "Mount Fuji is the tallest mountain in Japan.");
  if (!(rel > irr) || rel < 0.5 || irr > 0.5) fail(`reranker did not discriminate offline (relevant=${rel}, irrelevant=${irr})`);
  console.error(`smoke-mcpb: fusion OK — CE relevant=${rel.toFixed(4)} > irrelevant=${irr.toFixed(6)} (offline)`);
}

await driveServer();
await checkFusion();
console.error("smoke-mcpb: PASS — bundle boots, 48 tools, embedding + reranker work offline.");
process.exit(0);
