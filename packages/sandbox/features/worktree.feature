Feature: resolveWorktree
  A linked worktree under <repo>/.claude/worktrees/<name> is accepted; anything else is NOT_A_WORKTREE.
  The git layout is written by hand: no git runs.

  Scenario: resolves repo, worktree and name from the worktree or a folder under it
    Given a hand-written git layout for the linked worktree "w"
    Then resolving the worktree gives its repo, itself and the name "w"
    And resolving the folder "src" under the worktree gives the same

  Scenario: refuses the main checkout
    Given a hand-written git layout for the linked worktree "w"
    Then resolving the main checkout fails with "NOT_A_WORKTREE.*dépôt principal"

  Scenario: refuses a worktree outside <repo>/.claude/worktrees
    Given a hand-written git layout for the linked worktree "w" placed at "elsewhere/w" outside the repository
    Then resolving the worktree fails with "NOT_A_WORKTREE.*hors de <repo>/\.claude/worktrees"

  Scenario: refuses a .git pointer rewritten to another gitdir
    Given a hand-written git layout for the linked worktree "w"
    And a hand-written git layout for the linked worktree "other"
    When the .git pointer of the worktree "w" is rewritten to the git directory of "other"
    Then resolving the worktree fails with "NOT_A_WORKTREE"

  Scenario: refuses a commondir that does not lead to <repo>/.git
    Given a hand-written git layout for the linked worktree "w"
    When the commondir of "w" is rewritten to a folder outside the repository
    Then resolving the worktree fails with "NOT_A_WORKTREE.*commondir"
