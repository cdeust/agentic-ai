Feature: Repository hygiene
  Typecheck and format are scenarios (docs/design/platform-v3-srt.md §7). `npm run typecheck` and `npm run format:check`
  are conveniences that run the same commands.

  Scenario: the repository typechecks
    When the repository is typechecked with tsc
    Then the typecheck exits with status 0

  Scenario: the repository is formatted
    When the repository is checked with prettier
    Then the format check exits with status 0
