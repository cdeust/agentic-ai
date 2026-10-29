---
allowed-tools: Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)
argument-hint: '[pr-number]'
description: Review a pull request against CLAUDE.md with the architecture, test and security reviewers
---

Review pull request $ARGUMENTS (or the current PR when none is given). Read `CLAUDE.md` first: its "What the review must refuse" list is the bar.

Perform a comprehensive code review using subagents for key areas:

- architecture-reviewer (layers, boundaries, dependency guard)
- test-reviewer (every brick ships with unit tests per layer, port contract tests, end-to-end case)
- security-reviewer (secrets, container and network isolation, database access outside data, supply chain)

Instruct each to only provide noteworthy feedback. Once they finish, review the feedback and post only the feedback that you also deem noteworthy.

Review the PR diff as GitHub presents it (`gh pr diff`). Do not compare any branch to `main` yourself: no merge-base, no branch tips, no update-branch.

Provide feedback using inline comments for specific issues.
Use top-level comments for general observations or praise.
Keep feedback concise. Request changes when any item in "What the review must refuse" applies.

---
