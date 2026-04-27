# Team Agents Inventory

Source: `/Users/cdeust/Developments/zetetic-team-subagents/agents/` (top-level `.md` files only, not `genius/`)
Count: 19 team specialist agents
Extraction method: `<identity>` tag first sentence + `grep` for Move counts and tool references.

Note: Marketplace metadata (`marketplace.json`) advertises "19 team agents (incl. refactorer)". This matches the 19 files found.

---

| Name | File | Lines | Essence (from `<identity>`) | Domain / Role | Moves | WebSearch | Read | Bash |
|---|---|---|---|---|---|---|---|---|
| architect | `architect.md` | 487 | Procedure for deciding where seams go, which dependencies are permitted, and whether a structural change is worth its blast radius. Owns: module/layer boundary placement, dependency direction, blast-radius analysis, reversibility classification (one-way vs two-way door), ADR record. | Software Architecture | 8 | no | yes | yes |
| code-reviewer | `code-reviewer.md` | 453 | Procedure for deciding whether a change set is mergeable. Produces: APPROVE / REQUEST CHANGES / COMMENT verdict backed by observable evidence from the diff, with structured comments tied to `file:line`. | Code Review | 7 | no | yes | yes |
| data-scientist | `data-scientist.md` | 423 | Procedure for deciding what the data actually is, how it should be modeled, and whether the reported result is defensible. Owns: dataset profile, missing-data regime (MCAR/MAR/MNAR), bias audit, uncertainty on every modeled quantity. | Data Science / Statistics | 7 | yes | yes | yes |
| dba | `dba.md` | 412 | Procedure for deciding what the schema should be, how a query should execute, and whether a migration is safe to run. Owns: schema shape, query execution plan, migration safety classification. | Database Engineering | 7 | no | yes | yes |
| devops-engineer | `devops-engineer.md` | 428 | Procedure for deciding what ships, how it ships, how it is observed, and how it is undone. Owns: blast-radius calibration (canary/blue-green/rolling), rollback path, observability contract (SLIs), CI/CD step structure. | DevOps / Platform Engineering | 6 | no | yes | yes |
| engineer | `engineer.md` | 477 | Procedure for deciding where code belongs, how it is derived, and whether it is ready to ship. Owns: layer assignment (core/domain/infrastructure/handlers), function derivation from contract, root-cause verdict for each bug. | Software Engineering | 7 | no | yes | yes |
| experiment-runner | `experiment-runner.md` | 428 | Procedure for deciding what counts as evidence from an experiment, and what the experiment is allowed to claim. Owns: pre-registration artifact, reproducibility manifest, ablation matrix, negative-result log. | Experimental Science / ML Research | 7 | no | yes | yes |
| frontend-engineer | `frontend-engineer.md` | 434 | Procedure for deciding how UI is decomposed, where state lives, and whether a screen is ready for users. Owns: presentational/container split, state ownership tier, accessibility posture, performance budget, loading/error/empty/success coverage. | Frontend Engineering | 7 | no | yes | yes |
| latex-engineer | `latex-engineer.md` | 407 | Procedure for deciding which template, which figure format, which bibliography discipline, and which compile-error fix belongs in a scientific LaTeX document. | Scientific Publishing / LaTeX | 6 | no | yes | yes |
| mlops | `mlops.md` | 434 | Procedure for deciding whether an ML system is fit to train, fit to serve, and fit to monitor. Owns: training pipeline contract, serving contract (latency, throughput), rollout plan (canary → shadow → full), drift-monitoring configuration. | MLOps / ML Engineering | 8 | no | yes | yes |
| orchestrator | `orchestrator.md` | 459 | Procedure for deciding how a task is decomposed, which agents execute which subtasks, and how their outputs are merged into a coherent whole. Owns: decomposition into independent subtasks, agent assignment (genius or team), parallelism plan, merge strategy. | Orchestration / Multi-agent Coordination | 8 | no | yes | yes |
| paper-writer | `paper-writer.md` | 462 | Procedure for deciding what a paper claims, what evidence supports each claim, and whether the narrative earns its conclusion. Owns: claim-evidence chain, argument structure audit (Toulmin), limitations ranking. | Academic Writing | 9 | yes | yes | yes |
| professor | `professor.md` | 402 | Procedure for deciding what the student already knows, what they need to know next, and whether the explanation has actually landed. Owns: audience assessment (prerequisites), mental-model construction around 2–3 core concepts, cargo-cult check. | Education / Knowledge Transfer | 7 | yes | yes | yes |
| refactorer | `refactorer.md` | 491 | Procedure for bringing non-compliant code into compliance with `rules/coding-standards.md` without changing observable behavior. Owns: violation priority, refactoring catalog pattern selection, behavior-preservation verification. | Refactoring / Code Quality | 8 | no | yes | yes |
| research-scientist | `research-scientist.md` | 466 | Procedure for deciding what to investigate, how to diagnose failure, and whether a result is real. Owns: baseline-vs-improvement verdict, failure-mode classification, literature-derived justification, reproducibility certification. | Research / Scientific Method | 8 | yes | yes | yes |
| reviewer-academic | `reviewer-academic.md` | 417 | Procedure for deciding whether a paper's claims are supported, whether the work is reproducible, and whether the contribution is significant enough for the target venue. Owns: claim-to-evidence mapping, reproducibility verdict, accept/revise/reject recommendation. | Academic Peer Review | 8 | yes | yes | yes |
| security-auditor | `security-auditor.md` | 485 | Procedure for deciding what can go wrong, who can make it go wrong, and what independent controls prevent it. Owns: STRIDE threat model, attack-surface enumeration, defense-in-depth verdict (≥2 independent controls), supply-chain verdict. | Security Engineering | 8 | yes | yes | yes |
| test-engineer | `test-engineer.md` | 419 | Procedure for deciding what must be tested, how each test derives from a contract, and whether a test suite is trustworthy enough to gate a release. Owns: postcondition→test mapping, flaky-test root-cause classification, unit-vs-integration boundary, wiring check. | Test Engineering | 7 | no | yes | yes |
| ux-designer | `ux-designer.md` | 427 | Procedure for deciding what interface a user should encounter, why, and on what evidence. Owns: user task flow (who, what, success criterion, failure modes), accessibility constraint envelope (WCAG 2.1 AA), design-system consistency verdict. | UX Design | 6 | yes | yes | no |

---

## Notes

- **ux-designer** has no Bash tool reference (0 occurrences) — the only team agent that does not invoke Bash. All others invoke Bash.
- **code-reviewer**, **dba**, **architect**, **devops-engineer**, **engineer**, **frontend-engineer**, **latex-engineer**, **mlops**, **orchestrator**, **refactorer**, **test-engineer** have no WebSearch reference — they operate entirely on the local codebase.
- **refactorer** has the highest line count (491) among team agents; **professor** has the lowest (402).
- **paper-writer** has the most Moves (9) of any agent in the entire corpus (genius + team).
- All team agents are pure Markdown files — LLM-facing prompt content, no executable code.
