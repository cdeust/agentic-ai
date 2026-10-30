Feature: Test gate diff against the first parent
  `git diff --unified=0 --no-renames <first parent>` against the working tree (O-2: never a merge-base, never a
  branch compared to main), plus untracked files as whole additions. Lines are numbered in the working tree.

  Background:
    Given a gate repository
    And the gate repository file "src/long.mjs" reads:
      """
      // 1
      // 2
      // 3
      // 4
      // 5
      // 6
      // 7
      // 8
      // 9
      // 10
      // 11
      // 12
      // 13
      // 14
      // 15
      """
    And the gate repository file "src/gone.mjs" reads:
      """
      -- a line that shows as --- once removed
      """
    And the gate first parent is committed

  Scenario: modified, added and deleted files, multi-digit hunks, a hunk without count, a pure deletion
    Given the gate repository file "src/long.mjs" reads:
      """
      // 1
      // 2
      // 4
      // 5
      // 6
      // 7
      // 8
      // 9
      // ten
      // eleven
      // twelve
      // 13
      // fourteen
      // 15
      """
    And the gate repository file "src/added.mjs" reads:
      """
      diff --git a/fake b/fake
      @@ -1 +1 @@
      deleted file mode 100644
      """
    And the gate repository file "src/gone.mjs" is removed
    And the gate head is committed
    Then the gate changes against the first parent are:
      """
      src/added.mjs: 1,2,3
      src/gone.mjs (supprimé):
      src/long.mjs: 9,10,11,13
      """

  Scenario: untracked files are additions, line by line, the last one included
    Given the gate head is committed
    And the gate repository file "src/new.mjs" reads:
      """
      export const a = 1;
      export const b = 2;
      """
    Then the gate changes against the first parent are:
      """
      src/new.mjs: 1,2,3
      """
