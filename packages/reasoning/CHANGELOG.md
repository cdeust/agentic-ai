# Changelog

All notable changes to this project will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Public-readiness baseline: CONTRIBUTING.md, CODE_OF_CONDUCT.md,
  SECURITY.md.
- GitHub issue templates (bug / feature / audit-finding) and PR template
  with audit-cycle checklist.
- `prd-spec-generator` row in the companion-projects table.

### Changed

- LICENSE copyright corrected to Clément Deust (sole independent author);
  ecosystem-context preamble + explicit non-affiliation statement added.
- LinkedIn post first-comment options refined for algorithm-aware reach.

## [2.13.1] — Tier-1 visibility + memory MCP + PII scanner

### Added

- **Memory MCP.** Local replica of Anthropic's managed-agent
  `memory_20250818` tool with scope-based ACL, queue isolation, and
  full MCP wire compatibility. 241 tests passing across functional, ACL,
  concurrency, stale-lock, MCP, and PII suites.
- **PII / secret scrubbing on memory write path** (contract §7.2).
- **`pre-tool-secret-shield` hook** — blocks any agent from reading
  `.env`, `.aws/credentials`, `*.pem`, `*.key`, or shell-history files.
- **PII scanner daemon.** Persistent process eliminates Python cold-start;
  median scan time reduced 34→8 ms.
- **Memory contract on every agent.** `memory_scope` frontmatter +
  `memory` body block added to all 19 team agents and all 97 genius
  agents (so each agent declares what it persists and where).
- README rewrite (Tier 1 visibility), 6 supporting docs, full CI matrix,
  Codespaces config (subsequently removed per cross-check feedback).

### Changed

- CI concurrency suite made Linux-portable (was macOS-specific).

### Documentation

- LinkedIn post series introducing zetetic (rewritten in plain prose; no
  em-dashes).

---

For older releases (v2.13.0 and earlier), see git history. The project
predates this CHANGELOG; pre-2.13.1 versioning was driven by tag-only
release notes on GitHub.
