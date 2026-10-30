# Contributing

Thank you for contributing. Read `CLAUDE.md` first: it is the contract the review applies.

## Workflow

1. Fork or branch from `main`. Work in a branch; never push to `main` directly.
2. `nvm use && npm ci`.
3. Make the change with its tests (see "Adding a brick" in `CLAUDE.md`).
4. Run `npm run check` and make it pass (`npm test`: typecheck, prettier, tests and architecture guard are all scenarios). Run `npm run format` to fix formatting.
5. Open a pull request. A pull request is mandatory for every change. CI runs `npm run check`; the Claude review runs on the pull request and applies `CLAUDE.md`.
6. Address review comments with new commits on the same branch.

## Rules that are checked

- Layers and boundaries are enforced by `npm run arch`; do not weaken `.dependency-cruiser.cjs` without a documented reason.
- A brick without tests is refused. Each port has a contract test run against every adapter.
- Dependencies are pinned to exact versions (verify with `npm view <pkg> version`) and `package-lock.json` is committed.
- No secret in code, tests, logs or images.
- No branch-to-`main` comparison in CI or scripts.
- Update `docs/` and `CLAUDE.md` when a change alters architecture, boundaries or commands.

## Commits

Imperative subject (`feat: add quota adapter`), body explaining why when it is not obvious.
