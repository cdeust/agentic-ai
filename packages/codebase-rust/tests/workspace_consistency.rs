// workspace_consistency.rs — regression test confirming the Rust workspace is
// internally consistent after relocation into packages/codebase-rust/.
//
// source: docs/PHASE_3_PLAN.md §5.4#1 — "Add a regression test: a tiny Rust unit
// test that exercises one parser module, proving the Rust workspace is internally
// consistent in its new home."
//
// Design constraints (per coding-standards.md §7 local reasoning):
//   - No I/O, no filesystem access, no network.
//   - Pure function calls against public library surface.
//   - Single concern: tool count + schema shape invariant.
//
// Precondition: Cargo.toml declares `name = "ai-architect-mcp"` with a library
//   target at src/lib.rs that re-exports `tool_schemas`.
// Postcondition: `tool_schemas::tools_list()` returns a JSON object whose
//   `tools` array has exactly 23 elements — one per documented MCP tool in
//   inventory/MCP_TOOLS.md.

use ai_architect_mcp::tool_schemas;

/// Invariant: the tools list must contain exactly 23 entries.
///
/// source: inventory/MCP_TOOLS.md — 23 tools enumerated (health_check through
/// verify_semantic_diff). Any deviation indicates a schema-count drift between
/// the Rust source and the TS adapter's CodebasePort interface.
#[test]
fn tool_schemas_returns_23_tools() {
    let list = tool_schemas::tools_list();
    let tools = list
        .get("tools")
        .expect("tools_list() must return an object with a 'tools' key")
        .as_array()
        .expect("'tools' value must be a JSON array");

    // source: inventory/MCP_TOOLS.md — 23 tools enumerated.
    assert_eq!(
        tools.len(),
        23,
        "expected 23 tools (per inventory/MCP_TOOLS.md); got {}",
        tools.len()
    );
}

/// Invariant: every tool schema must declare a 'name' and 'inputSchema' field.
///
/// source: inventory/MCP_TOOLS.md — each tool has an explicit name and
/// inputSchema. A missing field indicates a schema construction bug.
#[test]
fn every_tool_schema_has_name_and_input_schema() {
    let list = tool_schemas::tools_list();
    let tools = list["tools"]
        .as_array()
        .expect("'tools' must be an array");

    for (i, tool) in tools.iter().enumerate() {
        let name = tool.get("name").unwrap_or_else(|| {
            panic!("tool[{}] is missing the 'name' field", i)
        });
        assert!(
            name.is_string(),
            "tool[{}].name must be a string, got {:?}",
            i,
            name
        );
        assert!(
            !name.as_str().unwrap().is_empty(),
            "tool[{}].name must not be empty",
            i
        );
        assert!(
            tool.get("inputSchema").is_some(),
            "tool '{}' (index {}) is missing 'inputSchema'",
            name.as_str().unwrap(),
            i
        );
    }
}

/// Invariant: health_check is tool[0] with an empty properties object.
///
/// source: src/main.rs — dispatch order matches tools_list() order;
/// health_check is always stage-0 and first in the list.
#[test]
fn health_check_is_first_tool_with_empty_schema() {
    let list = tool_schemas::tools_list();
    let tools = list["tools"].as_array().expect("'tools' must be an array");

    let first = &tools[0];
    assert_eq!(
        first["name"].as_str().unwrap(),
        "health_check",
        "first tool must be 'health_check'"
    );
    let props = &first["inputSchema"]["properties"];
    assert!(
        props.is_object() && props.as_object().unwrap().is_empty(),
        "health_check inputSchema.properties must be an empty object (no inputs)"
    );
}
