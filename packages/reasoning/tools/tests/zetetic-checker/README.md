# zetetic-checker regression fixtures

These fixtures prove that zetetic-checker correctly identifies true positives, accepts properly-sourced code, and skips generated files. Run:

```bash
bash tools/tests/zetetic-checker/run-tests.sh
```

Exit 0 = all fixtures behave as expected.

## Fixtures

- `fixture-true-positive.py` — unsourced 4-decimal float. MUST fire MAGIC_NUMBER.
- `fixture-sourced.py` — same constant, with `# source:` annotation. MUST pass.
- `fixture-absolute-claim.py` — comment contains "always works" without citation. MUST fire UNSOURCED (error).
- `fixture-todo-issue-ref.py` — TODO with `#264` reference. MUST pass.
- `fixture-todo-no-ref.py` — TODO without any reference. MUST fire TODO_NO_REF.
- `fixture-Cargo.lock` — simulated lock file with many version numbers. MUST be skipped (0 findings).
- `fixture-integer-hyperparam.py` — `batch_size=128`, `epochs=50`. MUST pass (integers not flagged per documented blind spot).

## Invariants enforced

1. **True positives fire** — the checker catches actual unsourced constants and absolute claims.
2. **Sourced constants pass** — proper `source:` annotations silence the checker.
3. **Lock files skip** — auto-generated files produce zero findings regardless of content.
4. **Integer hyperparameters don't fire** — documented blind spot; tightening here is out of scope.
5. **Issue references work** — `#264`, `JIRA-123`, `DB#7` all count as TODO tracking.
