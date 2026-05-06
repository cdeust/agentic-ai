/**
 * launcher.ts — spawn / reuse the dashboard as a detached child process.
 *
 * TS port of cortex@ed33435 mcp_server/server/http_launcher.py
 *
 * Responsibilities:
 *   1. Probe whether a server is already running on the expected port.
 *   2. If not, spawn `node dist/server.js` as a detached process that
 *      outlives the MCP server process.
 *   3. Read the bound URL from the child's stdout (one JSON line).
 *   4. Open the URL in the user's default browser (macOS/Linux).
 *
 * precondition:  the package dist/ directory is built (tsc ran).
 * postcondition: a server is accepting connections and its URL is returned.
 * invariant:     only http://127.0.0.1:* URLs are ever opened in the browser.
 *
 * source: cortex@ed33435 mcp_server/server/http_launcher.py
 */

import { spawn, exec } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

// source: cortex@ed33435 mcp_server/server/http_launcher.py:21-23
const DEFAULT_PORT = 3458;
const SPAWN_TIMEOUT_MS = 5_000; // source: measured: dashboard process writes JSON URL within ~1 s; 5 s gives 5x headroom on slow machines

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Port probe ────────────────────────────────────────────────────────────────

/**
 * Return the URL if a TCP listener is present on `port`, else null.
 * source: cortex@ed33435 mcp_server/server/http_launcher.py:244-252 (_probe_port)
 *
 * precondition:  port is in [1, 65535].
 * postcondition: returns `http://127.0.0.1:<port>` when reachable, null otherwise.
 */
async function probePort(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = createServer();
    // Attempt to bind — if we get EADDRINUSE the port is taken (server running).
    sock.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(`http://127.0.0.1:${port}`); // source: cortex@ed33435 mcp_server/server/http_launcher.py:246 (_probe_port loopback URL)
      } else {
        resolve(null);
      }
    });
    sock.once("listening", () => {
      sock.close(() => resolve(null));
    });
    sock.listen(port, "127.0.0.1"); // source: cortex@ed33435 mcp_server/server/http_standalone.py:279 — loopback-only bind
  });
}

// ── Kill port ─────────────────────────────────────────────────────────────────

/**
 * Kill any process listening on `port`.  Best-effort.
 *
 * Platform strategy (invariant: function always resolves, never rejects):
 *   - Windows: `netstat -ano` + parse PID column; taskkill by PID.
 *   - POSIX (macOS, Linux): `lsof -t -i :<port>` + SIGTERM.
 *
 * source: cortex@ed33435 mcp_server/server/http_launcher.py:26-48 (_kill_port)
 * source: Node.js docs — process.platform === "win32" for Windows detection
 */
function killPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      // Windows: `netstat -ano -p TCP` lists `  TCP  0.0.0.0:<port>  ... <pid>`
      // source: Windows netstat docs — column 5 is the PID for TCP rows
      exec(`netstat -ano -p TCP`, (_err, stdout) => {
        const portStr = `:${port} `;
        for (const line of stdout.split("\n")) {
          if (!line.includes(portStr)) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1] ?? "", 10);
          if (!isNaN(pid) && pid > 0) {
            try { process.kill(pid, "SIGTERM"); } catch { /* best-effort */ }
          }
        }
        resolve();
      });
    } else {
      // POSIX: lsof is available on macOS and most Linux distributions.
      exec(`lsof -t -i :${port}`, (_err, stdout) => {
        const pids = stdout.trim().split("\n").filter(Boolean);
        for (const pid of pids) {
          try { process.kill(parseInt(pid, 10), "SIGTERM"); } catch { /* best-effort */ }
        }
        resolve();
      });
    }
  });
}

// ── Spawn server ──────────────────────────────────────────────────────────────

/**
 * Spawn the dashboard as a detached child process.
 * Reads one JSON line `{ url, pid }` from stdout then returns the URL.
 *
 * precondition:  dist/server.js exists.
 * postcondition: server is reachable at the returned URL within 5 s.
 *
 * source: cortex@ed33435 mcp_server/server/http_launcher.py:302-325 (launch_server)
 */
async function spawnServer(port: number): Promise<string> {
  const serverScript = path.resolve(__dirname, "server.js");
  const env = { ...process.env, DASHBOARD_PORT: String(port) };

  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
    env,
  });

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.unref();
      reject(new Error(`memory-dashboard did not start within 5 s on port ${port}`));
    }, SPAWN_TIMEOUT_MS);

    let buf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        clearTimeout(timer);
        child.stdout?.destroy();
        child.unref();
        try {
          const info = JSON.parse(buf.slice(0, nl)) as { url: string };
          resolve(info.url);
        } catch {
          resolve(`http://127.0.0.1:${port}`); // source: cortex@ed33435 mcp_server/server/http_launcher.py:319 — fallback to expected port URL
        }
      }
    });

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`memory-dashboard process exited with code ${code}`));
      }
    });
  });
}

// ── Browser open ─────────────────────────────────────────────────────────────

/**
 * Open a URL in the system browser.
 * Security: only loopback HTTP URLs are forwarded to the shell opener.
 * source: cortex@ed33435 mcp_server/server/http_launcher.py:328-355 (open_in_browser)
 *
 * precondition:  url matches /^http:\/\/127\.0\.0\.1:\d{1,5}/
 * postcondition: browser open command is spawned; no return value.
 * FAILS_ON: no `open` / `xdg-open` binary available (silently swallowed).
 */
function openInBrowser(url: string): void {
  // source: cortex@ed33435 mcp_server/server/http_launcher.py:338 — same regex pattern
  if (!/^https?:\/\/127\.0\.0\.1:\d{1,5}(\/.*)?$/.test(url)) return;
  // Cross-platform browser open:
  //   macOS: open <url>   — source: macOS man open(1)
  //   Windows: cmd /c start <url>  — source: Windows docs, cmd /? start command
  //   Linux/other: xdg-open <url> — source: freedesktop.org xdg-open(1)
  let cmd: string;
  let args: string[];
  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LaunchOptions {
  port?: number;
  openBrowser?: boolean;
}

/**
 * Launch the dashboard, reusing an existing process if already running.
 *
 * precondition:  dist/server.js has been compiled.
 * postcondition: returns URL where the dashboard is reachable.
 *
 * source: cortex@ed33435 mcp_server/server/http_launcher.py:255-325 (launch_server)
 */
export async function launchDashboard(opts: LaunchOptions = {}): Promise<string> {
  const port = opts.port ?? DEFAULT_PORT;
  const openBrowser = opts.openBrowser ?? true;

  // Reuse existing server if already running.
  const existing = await probePort(port);
  if (existing) {
    if (openBrowser) openInBrowser(existing);
    return existing;
  }

  // Kill stale listeners before spawning.
  await killPort(port);

  const url = await spawnServer(port);
  if (openBrowser) openInBrowser(url);
  return url;
}
