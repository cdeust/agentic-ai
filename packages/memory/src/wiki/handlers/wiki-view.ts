/**
 * Handler: wiki-view — execute a saved view or inline query.
 *
 * A view is a wiki/_views/<name>.md page with a cortex-query fenced block.
 * The user authors views as ordinary wiki pages; this handler loads the
 * view, compiles it via the safe DSL, executes the SQL, and returns rows.
 *
 * Modes:
 *   named view:       wiki_view({ name: "open-questions" })
 *   inline (testing): wiki_view({ query: "table: pages\nlimit: 5" })
 *   list views:       wiki_view({ list: true })
 *
 * source: mcp_server/handlers/wiki_view.py
 */

export interface WikiViewArgs {
  readonly name?: string | null;
  readonly query?: string | null;
  readonly list?: boolean;
}

export interface ViewMeta {
  readonly name: string;
  readonly rel_path: string | null;
}

export interface WikiViewResult {
  readonly view?: ViewMeta;
  readonly table?: string;
  readonly row_count?: number;
  readonly rows?: readonly Record<string, unknown>[];
  readonly sql?: string;
  readonly views?: ReadonlyArray<{ name: string; rel_path: string; description: string }>;
  readonly count?: number;
  readonly error?: string;
  readonly errors?: readonly string[];
}

export interface CompiledView {
  readonly ok: boolean;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly table: string;
  readonly errors: readonly string[];
}

export interface WikiViewDeps {
  readonly wikiRoot: string;
  readonly loadRegistry: (root: string) => { views: Record<string, { name: string; rel_path: string; description: string; query: string }> };
  readonly compileView: (queryText: string) => CompiledView;
  readonly executeQuery: (sql: string, params: readonly unknown[]) => Promise<Record<string, unknown>[]>;
}

export async function handler(args: WikiViewArgs, deps: WikiViewDeps): Promise<WikiViewResult> {
  if (args.list) {
    const registry = deps.loadRegistry(deps.wikiRoot);
    return {
      views: Object.values(registry.views).map((v) => ({
        name: v.name,
        rel_path: v.rel_path,
        description: v.description,
      })),
      count: Object.keys(registry.views).length,
    };
  }

  const name = args.name;
  const inlineQuery = args.query;

  let queryText: string;
  let viewMeta: ViewMeta;

  if (name) {
    const registry = deps.loadRegistry(deps.wikiRoot);
    const view = registry.views[name];
    if (!view) {
      return { error: `view ${JSON.stringify(name)} not found`, views: Object.values(registry.views).map((v) => ({ name: v.name, rel_path: v.rel_path, description: v.description })) };
    }
    queryText = view.query;
    viewMeta = { name: view.name, rel_path: view.rel_path };
  } else if (inlineQuery) {
    queryText = inlineQuery;
    viewMeta = { name: "<inline>", rel_path: null };
  } else {
    return { error: "provide either name= or query=" };
  }

  const compiled = deps.compileView(queryText);
  if (!compiled.ok) {
    return { view: viewMeta, error: "compile failed", errors: compiled.errors, sql: compiled.sql };
  }

  try {
    const rows = await deps.executeQuery(compiled.sql, compiled.params);
    return { view: viewMeta, table: compiled.table, row_count: rows.length, rows, sql: compiled.sql };
  } catch (err) {
    return { view: viewMeta, error: `execution failed: ${String(err)}`, sql: compiled.sql };
  }
}

export const schema = {
  description:
    "Run a saved wiki view (a wiki/_views/<name>.md page that contains a " +
    "`cortex-query` fenced block) or an ad-hoc inline cortex-query and return " +
    "the resulting rows. Read-only; never mutates.",
  inputSchema: {
    type: "object" as const,
    required: [] as const,
    properties: {
      name: { type: "string" as const },
      query: { type: "string" as const },
      list: { type: "boolean" as const, default: false },
    },
  },
} as const;
