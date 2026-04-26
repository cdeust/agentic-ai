/**
 * AST-backed loader for the workflow graph (ADR-0046) — STUB.
 *
 * This module is a structural stub pending coordination with the
 * cortex-codebase-analysis worktree (merge order #5), which owns the
 * ap_bridge / APBridge infrastructure that this module would delegate to
 * in Python.
 *
 * The Python original (workflow_graph_source_ast.py) spawns the
 * automatised-pipeline (AP) MCP subprocess, sends Cypher queries over
 * stdin/stdout via APBridge, and returns builder-shaped dicts. That
 * subprocess IPC and the KuzuDB Cypher dialect are out of scope for this
 * first-pass port.
 *
 * AST-substrate coordination decision:
 *   The AP bridge machinery belongs with cortex-codebase-analysis (#5)
 *   because that worktree already owns the codebase_graph + ast_parser
 *   infrastructure. This stub exports the correct public interface so the
 *   workflow-graph handler can import it without type errors; the
 *   implementation will be filled in during the #5 merge.
 *
 * source: Cortex mcp_server/infrastructure/workflow_graph_source_ast.py
 */

export class WorkflowGraphASTSource {
  /**
   * AST-layer loader via the automatised-pipeline MCP bridge.
   * STUB — returns empty arrays until the ap_bridge is available.
   */

  enabled(): boolean {
    // source: workflow_graph_source_ast.py WorkflowGraphASTSource.enabled
    // Returns false when CORTEX_MEMORY_AP_ENABLED=0. Stub always false.
    return false;
  }

  loadSymbols(_filePaths: Iterable<string>): Record<string, unknown>[] {
    /**
     * Return one row per AST symbol defined in a file Cortex knows about.
     * Row shape: {file_path, qualified_name, symbol_type, signature,
     *             language, line, domain}.
     * STUB: returns [] until ap_bridge is wired.
     */
    return [];
  }

  loadAstEdges(_filePaths: Iterable<string>): Record<string, unknown>[] {
    /**
     * Return CALLS / IMPORTS / MEMBER_OF edges across every project graph.
     * STUB: returns [] until ap_bridge is wired.
     */
    return [];
  }

  close(): void {
    // no-op in stub
  }
}
