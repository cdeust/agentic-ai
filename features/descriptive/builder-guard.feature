Feature: builder-guard plugin (descriptive files)
  plugins/builder-guard/hooks/rules.json and hooks.json describe the PreToolUse guard of the builder profile.
  A rule or hook added to them adds a row below.

  Scenario: builder-guard loads rules.json and hooks.json against their strict schemas
    Given the committed builder-guard rules.json
    Then it satisfies the strict builder-guard rules schema
    And the committed builder-guard hooks.json satisfies its strict schema
    And the builder-guard hook matcher covers "Bash", "Read", "Write" and "Edit"

  Scenario Outline: builder-guard rejects a broken rules.json copy with <breakage>
    Given the committed builder-guard rules.json
    When I break the copy with <breakage>
    Then it no longer satisfies the strict builder-guard rules schema

    Examples:
      | breakage                       |
      | an invalid regular expression  |
      | a rule without reason          |
      | a misspelt key                 |

  Scenario Outline: builder-guard denies the Bash command <command> (<rule>)
    When builder-guard decides on the Bash command <command>
    Then builder-guard denies it by the rule <rule>

    Examples:
      | command                                        | rule                   |
      | git push origin main                           | push-main              |
      | git push --dry-run nowhere main               | push-main              |
      | git push origin HEAD:main                      | push-main              |
      | git push origin feat/x:refs/heads/main         | push-main              |
      | cd x && git -C . push -u origin main           | push-main              |
      | git push --force origin feat/x                 | push-force             |
      | git push -f origin feat/x                      | push-force             |
      | git push -uf origin feat/x                     | push-force             |
      | git push --force-with-lease origin feat/x      | push-force             |
      | git push origin +feat/x                        | push-force             |
      | security find-generic-password -s x            | keychain               |
      | security find-internet-password -s github.com -w | keychain             |
      | /usr/bin/security dump-keychain -d             | keychain               |
      | cat ~/.ssh/id_ed25519                          | secret-files           |
      | ls $HOME/.aws                                  | secret-files           |
      | cat ~/.npmrc                                   | secret-files           |
      | cat ~/.netrc                                   | secret-files           |
      | gpg --homedir ~/.gnupg -k                      | secret-files           |
      | cat ~/.config/gh/hosts.yml                     | secret-files           |
      | echo x > ../../../.git/hooks/pre-commit        | git-hooks-config-write |
      | cp payload .git/hooks/post-checkout            | git-hooks-config-write |
      | echo "[core]" >> /r/.git/config                | git-hooks-config-write |
      | git config core.hooksPath /tmp/h               | git-config-write       |
      | git config --local user.name x                 | git-config-write       |

  Scenario Outline: builder-guard allows the Bash command <command>
    When builder-guard decides on the Bash command <command>
    Then builder-guard allows it

    Examples:
      | command                              |
      | git push origin feat/tool-1a0        |
      | git push -u origin feat/x            |
      | git commit -m "maintain the domain"  |
      | git log main..HEAD                   |
      | git checkout -b mainline             |
      | npm run check                        |
      | git config --get user.name           |
      | git config -l                        |
      | cat .git/config                      |
      | ls .git/hooks                        |
      | security --help                      |
      | echo sshd                            |

  Scenario Outline: builder-guard denies <tool> on <path> (<rule>)
    When builder-guard decides on the <tool> tool for the path <path>
    Then builder-guard denies it by the rule <rule>

    Examples:
      | tool  | path                      | rule                   |
      | Read  | /home/u/.ssh/id_rsa       | secret-files           |
      | Read  | /home/u/.aws/credentials  | secret-files           |
      | Read  | /home/u/.npmrc            | secret-files           |
      | Edit  | /r/.netrc                 | secret-files           |
      | Write | /r/.git/hooks/pre-commit  | git-hooks-config-write |
      | Edit  | /r/.git/config            | git-hooks-config-write |

  Scenario Outline: builder-guard allows <tool> on <path>
    When builder-guard decides on the <tool> tool for the path <path>
    Then builder-guard allows it

    Examples:
      | tool  | path                                  |
      | Read  | /r/.git/config                        |
      | Write | /r/src/config.ts                      |
      | Edit  | /r/docs/ssh.md                        |
      | Read  | /r/.claude/worktrees/w/package.json   |

  Scenario: builder-guard denies by exit code 2 with the reason on stderr when run as the hook command
    When the builder-guard hook command receives this input:
      """
      {"tool_name":"Bash","tool_input":{"command":"git push origin main"}}
      """
    Then the builder-guard hook command exits with code 2 and its standard error contains "builder-guard [push-main]"
    When the builder-guard hook command receives this input:
      """
      {"tool_name":"Bash","tool_input":{"command":"security find-generic-password -s x"}}
      """
    Then the builder-guard hook command exits with code 2 and its standard error contains "builder-guard [keychain]"
    When the builder-guard hook command receives this input:
      """
      {"tool_name":"Bash","tool_input":{"command":"git status"}}
      """
    Then the builder-guard hook command exits with code 0 and an empty standard error
    When the builder-guard hook command receives this input:
      """
      {not json
      """
    Then the builder-guard hook command exits with code 2
