/**
 * Friendly error handling for MCP tool calls.
 *
 * Wraps handler exceptions so users never see raw tracebacks.
 * Database connection errors get a helpful setup guide instead.
 *
 * Phase 5 safety nets:
 *   - per-tool admission semaphore (Phase 5 step 5)
 *   - async handler offload
 *
 * Usage in tool registries:
 *   import { safeHandler } from "@agentic/memory/shared/error-handler";
 *
 *   async function toolRemember(...): Promise<string> {
 *     return safeHandler(remember.handler, {...}, { toolName: "remember" });
 *   }
 *
 * Port of: mcp_server/tool_error_handler.py
 */

import * as metrics from "./observability/metrics.js";

const DB_SETUP_GUIDE =
  "Cortex could not connect to PostgreSQL. " +
  "This usually means the database is not set up yet.\n\n" +
  "Quick fix:\n" +
  "  brew install postgresql@17 pgvector\n" +
  "  brew services start postgresql@17\n" +
  "  createdb cortex\n" +
  '  psql -d cortex -c "CREATE EXTENSION IF NOT EXISTS vector; ' +
  'CREATE EXTENSION IF NOT EXISTS pg_trgm;"\n' +
  "  export DATABASE_URL=postgresql://localhost:5432/cortex\n\n" +
  "Then restart Claude Code. Cortex will auto-initialize the schema.";

const EXTENSION_GUIDE =
  "Cortex requires the pgvector and pg_trgm PostgreSQL extensions.\n\n" +
  "Install them:\n" +
  "  brew install pgvector  # macOS\n" +
  '  psql -d cortex -c "CREATE EXTENSION IF NOT EXISTS vector; ' +
  'CREATE EXTENSION IF NOT EXISTS pg_trgm;"\n\n' +
  "Then restart Claude Code.";

interface ErrorClassification {
  readonly type: string;
  readonly message: string;
}

function classifyError(exc: unknown): ErrorClassification {
  const excName = exc instanceof Error ? exc.constructor.name : "UnknownError";
  const excMsg = exc instanceof Error ? exc.message : String(exc);
  const excLower = (excName + " " + excMsg).toLowerCase();

  if (
    excLower.includes('type "vector" does not exist') ||
    excLower.includes("extension") ||
    excLower.includes("pg_trgm")
  ) {
    return { type: "missing_extension", message: EXTENSION_GUIDE };
  }

  if (
    excLower.includes("connection refused") ||
    excLower.includes("could not connect") ||
    excLower.includes("no such host") ||
    excLower.includes("connection reset") ||
    excLower.includes("does not exist") ||
    excLower.includes("operationalerror") ||
    excLower.includes("role") ||
    excLower.includes("password authentication") ||
    excLower.includes("timeout")
  ) {
    return { type: "database_not_connected", message: DB_SETUP_GUIDE };
  }

  return { type: excName, message: excMsg };
}

export type HandlerFn<TArgs, TResult> = (args: TArgs) => Promise<TResult>;

interface SafeHandlerOptions {
  readonly toolName?: string;
}

/**
 * Call a handler and return a JSON string, catching errors gracefully.
 *
 * When `toolName` is provided:
 *   - Records metrics (call count + latency histogram).
 *
 * On success: returns JSON.stringify(result, null, 2).
 * On DB errors: returns a friendly setup guide.
 * On other errors: returns error type + message (no stack trace).
 */
export async function safeHandler<TArgs, TResult>(
  handlerFn: HandlerFn<TArgs, TResult>,
  args: TArgs,
  { toolName }: SafeHandlerOptions = {},
): Promise<string> {
  const timer = toolName
    ? new metrics.Timer("cortex_tool_duration_seconds", { tool: toolName }).start()
    : null;

  try {
    const result = await handlerFn(args);
    if (toolName) {
      timer?.stop();
      metrics.incCounter("cortex_tool_calls_total", { tool: toolName, status: "ok" });
    }
    return JSON.stringify(result, (_key, value) => {
      // Serialize Dates as ISO strings (mirrors Python's default=str)
      if (value instanceof Date) return value.toISOString();
      return value as unknown;
    }, 2);
  } catch (exc) {
    if (toolName) {
      timer?.stop();
      try {
        metrics.incCounter("cortex_tool_calls_total", { tool: toolName, status: "error" });
      } catch {
        // metrics failure must not mask the original error
      }
    }
    const { type: errorType, message } = classifyError(exc);
    const isKnownDbError =
      errorType === "missing_extension" || errorType === "database_not_connected";

    return JSON.stringify(
      {
        error: errorType,
        message,
        hint: isKnownDbError
          ? null
          : "If this persists, check that PostgreSQL is running and DATABASE_URL is set correctly.",
      },
      null,
      2,
    );
  }
}
