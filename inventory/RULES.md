# Rules Inventory

Source: `/Users/cdeust/Developments/zetetic-team-subagents/rules/`
Count: 1 rule file

---

| File | Path | Lines | Purpose | Applies To | Canonical? |
|---|---|---|---|---|---|
| `coding-standards.md` | `rules/coding-standards.md` | 263 | Defines the zetetic coding standards: SOLID principles (SRP, OCP, LSP, ISP, DIP), Clean Architecture with concentric layers and an absolute dependency rule, the 3R's (Readability, Reliability, Reusability), hard size limits (500-line file, 50-line function, 300-line class, 4-parameter max, 3-level nesting max), Reverse DI + Factory pattern, Root-cause thinking (not band-aids), Local reasoning (structured constructs only), Zetetic source discipline (no source → no implementation), Anti-patterns list, Stakes-calibrated application (High/Medium/Low), and a compliance-check procedure for agents. | `engineer`, `architect`, `code-reviewer`, `frontend-engineer`, `dba`, `devops-engineer`, `test-engineer`, `mlops`, `refactorer` | **YES** — this is the single authoritative coding standard for the entire system |

---

## Rule File Details

**`coding-standards.md`**

Source path: `/Users/cdeust/Developments/zetetic-team-subagents/rules/coding-standards.md`

Frontmatter fields:
```
name: coding-standards
description: Zetetic coding standards — SOLID, Clean Architecture, 3R (readability/reliability/reusability), size limits, reverse dependency injection, factory pattern.
version: 1.0.0
applies_to: [engineer, architect, code-reviewer, frontend-engineer, dba, devops-engineer, test-engineer, mlops, refactorer]
```

Sections (11 numbered):
1. SOLID Principles (SRP, OCP, LSP, ISP, DIP) — cites Martin (2000) and Liskov (1987)
2. Clean Architecture — concentric layers, absolute dependency rule, ports and adapters — cites Martin (2017)
3. The 3R's — Readability, Reliability, Reusability
4. Size Limits — file 500 lines, method 50 lines, class 300 lines, params 4, nesting 3 — cites Martin (2008) Clean Code
5. Reverse DI + Factory Pattern — cites Martin (2017) Ch. 11, 22
6. Root-Cause Thinking — 5-step root-cause protocol, architectural failure symptoms
7. Local Reasoning — structured constructs only, default-refuse table for dangerous constructs — cites Dijkstra (1968)
8. Zetetic Source Discipline — no source → no implementation; multiple sources preferred; `// source:` annotation required
9. Anti-Patterns — 12 enumerated refusals
10. Stakes-Calibrated Application — High/Medium/Low stakes criteria
11. Compliance Check — how agents use this file

Primary sources listed:
- Martin, R. C. (2000). "Design Principles and Design Patterns." Object Mentor.
- Martin, R. C. (2008). Clean Code. Prentice Hall.
- Martin, R. C. (2017). Clean Architecture. Prentice Hall.
- Liskov, B. (1987). "Data Abstraction and Hierarchy." OOPSLA '87.
- Dijkstra, E. W. (1968). "Go To Statement Considered Harmful." CACM 11(3).
- Fowler, M. (2018). Refactoring, 2nd ed. Addison-Wesley.
- Feathers, M. (2004). Working Effectively with Legacy Code. Prentice Hall.
- Evans, E. (2003). Domain-Driven Design. Addison-Wesley.

## Port Notes

This file is referenced by the `refactorer` agent as its operative rule set. It is also embedded verbatim in the user's global `~/.claude/rules/coding-standards.md` (confirmed by `<system-reminder>` in session context). The port must:
1. Move the file AS-IS to `packages/reasoning/rules/coding-standards.md` (it is Markdown, not code).
2. Expose it via the `ReasoningPort` as a loadable rule document (`getRuleFile(name: 'coding-standards'): string`).
3. The `refactorer` agent's `<domain-context>` reference path must be updated to the new location.
