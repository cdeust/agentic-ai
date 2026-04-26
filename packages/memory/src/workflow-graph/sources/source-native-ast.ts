/**
 * Native AST source for the workflow graph — STUB.
 *
 * This module is a structural stub pending coordination with the
 * cortex-codebase-analysis worktree (merge order #5), which owns the
 * codebase_parser / ast_parser / codebase_graph infrastructure.
 *
 * The Python original (workflow_graph_source_native_ast.py) uses:
 *   - mcp_server.core.ast_parser.parse_file_ast  (tree-sitter)
 *   - mcp_server.core.codebase_parser.parse_file  (regex fallback)
 *   - mcp_server.core.codebase_graph.build_resolved_call_edges
 *   - mcp_server.core.codebase_graph.resolve_all_imports
 *
 * All four are out-of-scope for this first-pass port. The stub exports
 * the correct public interface (matching WorkflowGraphASTSource's API)
 * so the handler can import it without type errors.
 *
 * AST-substrate coordination: this stub should be replaced during the
 * cortex-codebase-analysis (#5) merge, which will bring the
 * FileAnalysis / symbol extraction types into the shared monorepo.
 *
 * source: Cortex mcp_server/infrastructure/workflow_graph_source_native_ast.py
 */

export class WorkflowGraphNativeASTSource {
  /**
   * In-process AST source — tree-sitter when installed, regex fallback
   * otherwise. STUB: returns empty arrays until codebase_parser is
   * available in the monorepo.
   */

  enabled(): boolean {
    // source: workflow_graph_source_native_ast.py always returns True
    // (regex fallback handles all languages). Stub returns false until wired.
    return false;
  }

  astAvailable(): boolean {
    /** Tree-sitter proper is installed (deeper extraction). */
    return false;
  }

  loadSymbols(_filePaths: Iterable<string>): Record<string, unknown>[] {
    /**
     * Return one symbol row per function/class/method definition found
     * in each readable file.
     * STUB: returns [] until codebase_parser is available.
     */
    return [];
  }

  loadAstEdges(_filePaths: Iterable<string>): Record<string, unknown>[] {
    /**
     * Return CALLS, IMPORTS, and MEMBER_OF edges for the given files.
     * STUB: returns [] until codebase_graph is available.
     */
    return [];
  }
}
