# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- The repository was replaced by the architecture skeleton. The previous content is archived under the tag `archive/v1-2026-10-29` and is no longer maintained.

### Added

- Four-tier skeleton: `proxy`, `gateway`, `services/memory` (with `worker`), `data`, and `packages/contracts`.
- `Result<T>` contract, run registry and typed data operations, SQL migrations 0001 (runs) and 0002 (memory with pgvector).
- Architecture guard (`npm run arch`) and its proof test; end-to-end test through the gateway with in-memory adapters.
- `compose.yaml` with four network zones; worker and service Dockerfiles.
- `CLAUDE.md`, `.claude/settings.json`, review subagents, `/review-pr`, and documentation under `docs/`.
- GitHub workflows: `ci.yml`, and `claude.yml` / `claude-code-review.yml` from `anthropics/claude-code-action`.
- Behaviour expressed in descriptive files (docs/design.md, ADR 12): data operations as `data/sql/*.sql` with the table `data/sql/operations.json` and one generic executor; migration 0003 makes a completed run immutable in the database; worker system prompts as `services/memory/worker/prompts/<tool>.md`; internal tools declared once in `INTERNAL_TOOLS`; gateway routes derived from the tool owners. Each descriptive file is checked by a load-and-schema test.
