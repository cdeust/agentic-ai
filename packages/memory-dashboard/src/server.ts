/**
 * server.ts — Fastify entry point for the memory-dashboard HTTP server.
 *
 * TS port of cortex@ed33435 mcp_server/server/http_standalone.py
 * Architecture: handlers layer — wires HTTP transport to @agentic/memory domain objects.
 *
 * precondition:  DB_PATH env var points to an existing SQLite file, OR
 *   the caller passes options.dbPath explicitly.
 * postcondition: Fastify server is listening on options.port (default 3458)
 *   and returns the bound URL string.
 *
 * Invariant: the server is bound to 127.0.0.1 only (loopback) — never 0.0.0.0.
 * source: cortex@ed33435 mcp_server/server/http_standalone.py:279
 *         ("127.0.0.1" hardcoded in _bind_server)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerWikiRoutes } from "./routes/wiki.js";
import { registerSankeyRoutes } from "./routes/sankey.js";
import { registerDiscussionRoutes } from "./routes/discussions.js";
import { registerFileDiffRoutes } from "./routes/file-diff.js";
import { registerMemoriesRoutes } from "./routes/memories.js";
import { registerHealthRoutes } from "./routes/health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Constants ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/server/http_launcher.py:21-23
const DEFAULT_PORT = 3458;

// source: cortex@ed33435 mcp_server/server/http_standalone_state.py:21
const IDLE_TIMEOUT_MS = 600_000; // 10 minutes

export interface DashboardOptions {
  /** SQLite DB file path. Default: DB_PATH env var. */
  dbPath?: string;
  /** Port to listen on. Default 3458. */
  port?: number;
  /** Host to bind. Default 127.0.0.1 (loopback only). */
  host?: string;
  /** Absolute path to the static UI directory. Defaults to src/static/. */
  staticDir?: string;
}

export interface DashboardServer {
  url: string;
  stop: () => Promise<void>;
  fastify: FastifyInstance;
}

/**
 * Build and start the dashboard Fastify server.
 *
 * precondition:  opts.dbPath resolves to a readable SQLite file.
 * postcondition: server is bound, all routes registered, URL returned.
 * invariant:     host is always a loopback address.
 */
export async function startDashboard(
  opts: DashboardOptions = {},
): Promise<DashboardServer> {
  const dbPath = opts.dbPath ?? process.env["DB_PATH"] ?? "";
  const port = opts.port ?? DEFAULT_PORT;
  // Invariant: only bind to loopback — never to 0.0.0.0 or an external interface.
  // source: cortex@ed33435 mcp_server/server/http_standalone.py:279 — loopback-only bind
  const host = opts.host ?? "127.0.0.1";
  const staticDir =
    opts.staticDir ?? path.resolve(__dirname, "..", "src", "static");

  const fastify = Fastify({ logger: false });

  // CORS: strict-reflect loopback-only (mirrors http_security.py behaviour).
  // source: cortex@ed33435 mcp_server/server/http_security.py:103-119
  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) { cb(null, false); return; }
      try {
        const u = new URL(origin);
        const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"]; // source: cortex@ed33435 mcp_server/server/http_security.py:22 (_LOOPBACK_HOSTS)
        cb(null, loopback.includes(u.hostname));
      } catch {
        cb(null, false);
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
  });

  // Static assets — the bundled Three.js viz HTML + JS/CSS.
  await fastify.register(fastifyStatic, {
    root: staticDir,
    prefix: "/",
    decorateReply: false,
  });

  // API routes — one concern per file.
  await registerHealthRoutes(fastify);
  await registerGraphRoutes(fastify, { dbPath });
  await registerWikiRoutes(fastify);
  await registerSankeyRoutes(fastify, { dbPath });
  await registerDiscussionRoutes(fastify);
  await registerFileDiffRoutes(fastify);
  await registerMemoriesRoutes(fastify, { dbPath });

  // Idle-timeout watchdog: shut down after IDLE_TIMEOUT_MS of no requests.
  // source: cortex@ed33435 mcp_server/server/http_standalone.py:64-74
  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void fastify.close();
    }, IDLE_TIMEOUT_MS);
    // Allow Node.js to exit even if the timer is pending.
    idleTimer.unref();
  };
  fastify.addHook("onRequest", async () => { resetIdle(); });
  resetIdle();

  await fastify.listen({ port, host });
  const address = fastify.server.address();
  const actualPort =
    address && typeof address === "object" ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    url,
    fastify,
    stop: async () => {
      if (idleTimer) clearTimeout(idleTimer);
      await fastify.close();
    },
  };
}

// ── Standalone entry point ────────────────────────────────────────────────────
// When invoked as `node dist/server.js` write the URL to stdout then serve.
// source: cortex@ed33435 mcp_server/server/http_standalone.py:286-289 (_announce)
if (
  process.argv[1] != null &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^.*\//, ""))
) {
  const port = parseInt(process.env["DASHBOARD_PORT"] ?? String(DEFAULT_PORT), 10);
  startDashboard({ port })
    .then(({ url }) => {
      process.stdout.write(JSON.stringify({ url, pid: process.pid }) + "\n");
      process.stdout.uncork?.();
    })
    .catch((err: unknown) => {
      process.stderr.write(`[memory-dashboard] failed to start: ${String(err)}\n`);
      process.exit(1);
    });
}
