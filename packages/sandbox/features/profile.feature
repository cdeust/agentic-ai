Feature: Builder profile template
  profiles/builder.json is a descriptive file: strict schema, variables resolved by the adapter, closed environment.

  Scenario: loads the committed file against the strict schema
    When I load the committed builder profile
    Then the profile grants at least one write path

  Scenario: carries the builder profile adopted in decision 1 (platform-v3-srt.md, §8)
    When I load the committed builder profile
    Then the profile allows writing to at least:
      | ${worktree}                                 |
      | ${repo}/.git/worktrees/${worktreeName}      |
      | ${repo}/.git/objects                        |
      | ${repo}/.git/refs                           |
      | ${repo}/.git/logs                           |
      | ${home}/.cache                              |
      | ${config}                                   |
      | ${tmp}                                      |
    And the profile allows writing to nothing under "${home}/.claude"
    And the profile denies writing to exactly:
      | ${repo}/.git/hooks                                         |
      | ${repo}/.git/config                                        |
      | ${repo}/.git/worktrees/${worktreeName}/commondir           |
      | ${repo}/.git/worktrees/${worktreeName}/gitdir              |
      | ${repo}/.git/worktrees/${worktreeName}/config.worktree     |
      | ${repo}/.git/refs/heads/main                               |
      | ${worktree}/.claude/settings.json                          |
      | ${worktree}/.claude/settings.local.json                    |
      | ${config}/settings.json                                    |
    And the profile denies reading exactly:
      | ${home}/.ssh              |
      | ${home}/.aws              |
      | ${home}/.gnupg            |
      | ${home}/.config/gh        |
      | ${home}/.npmrc            |
      | ${home}/.netrc            |
      | ${home}/.claude           |
      | ${home}/.claude.json      |
      | ${home}/Library/Keychains |
    And the profile allows a pseudo-terminal
    And the profile sets the variable "CLAUDE_CODE_TMPDIR" to "${tmp}"
    And the profile unsets exactly the variables:
      | NO_PROXY |
      | no_proxy |

  Scenario: reaches the model only through the host auth proxy, with a session token and its own config dir
    When I load the committed builder profile
    Then the profile allows the network domains exactly:
      | 127.0.0.1:${authProxyPort} |
      | registry.npmjs.org         |
    And the profile sets the variables:
      | ANTHROPIC_BASE_URL      | http://127.0.0.1:${authProxyPort} |
      | CLAUDE_CODE_OAUTH_TOKEN | ${sessionToken}                   |
      | CLAUDE_CONFIG_DIR       | ${config}                         |
    When I resolve the profile with the test variables
    Then the resolved file "/t/aos/config/settings.json" equals '{"sandbox":{"enabled":false}}'
    And the resolved file "/t/aos/config/.claude.json" contains '{"projects":{"/r":{"hasTrustDialogAccepted":true},"/r/.claude/worktrees/w":{"hasTrustDialogAccepted":true}}}'

  Scenario: never makes the user settings, ~/.claude.json, plugins or the main repo writable
    When I load the committed builder profile
    And I resolve the profile with the test variables
    Then none of these paths is writable:
      | /h/.claude/settings.json                                    |
      | /h/.claude.json                                             |
      | /h/.claude/plugins/x                                        |
      | /r/.git/hooks/pre-commit                                    |
      | /r/.git/config                                              |
      | /r/.git/worktrees/w/commondir                               |
      | /r/.git/worktrees/w/gitdir                                  |
      | /r/.git/worktrees/w/config.worktree                         |
      | /r/.git/refs/heads/main                                     |
      | /r/.git/packed-refs                                         |
      | /r/.claude/worktrees/w/.claude/settings.json                |
      | /r/.claude/worktrees/w/.claude/settings.local.json          |
      | /r/node_modules/.bin/srt                                    |
      | /r/packages/sandbox/profiles/builder.json                   |
      | /t/aos/profile.json                                         |
      | /t/aos/config/settings.json                                 |
    And all of these paths are writable:
      | /r/.claude/worktrees/w/src/a.ts                             |
      | /r/.git/objects/ab/cdef                                     |
      | /r/.git/refs/heads/feat/x                                   |
      | /r/.git/worktrees/w/HEAD                                    |
      | /t/aos/config/projects/p/s.jsonl                            |
      | /t/aos/config/plugins/data/builder-guard-inline/x           |
      | /t/aos/config/.claude.json                                  |
      | /t/aos/tmp/x                                                |

  Scenario Outline: rejects a broken copy with <defect>
    When I break a copy of the committed profile with <defect>
    Then parsing the broken profile fails with "PROFILE_INVALID"

    Examples:
      | defect                                  |
      | a weakening option                      |
      | a misspelt key [T-01]                   |
      | filesystem.disabled                     |
      | allowGitConfig                          |
      | an API key passed through               |
      | a config dir set                        |
      | NO_PROXY passed through                 |
      | a literal token written in the file     |
      | a base URL to another host              |
      | a host Claude variable passed through   |

  Scenario: rejects an unknown profile name and a path-like name
    Then loading the profile "nope" fails with "PROFILE_INVALID"
    And loading the profile "../builder" fails with "PROFILE_INVALID"

  Scenario: substitutes every variable and leaves no placeholder
    When I load the committed builder profile
    And I resolve the profile with the test variables
    Then the resolved profile contains no "${" placeholder
    And the resolved write denials include "/r/.git/worktrees/w/commondir"
    And the resolved environment sets "CLAUDE_CODE_TMPDIR" to "/t/aos/tmp"
    And the resolved environment sets "ANTHROPIC_BASE_URL" to "http://127.0.0.1:4321"
    And the resolved network domains include "127.0.0.1:4321"

  Scenario: rejects an unknown variable and a relative result
    When I resolve a copy of the profile with "${nope}/x" added to allowWrite
    Then resolving it fails with "variable inconnue"
    When I resolve a copy of the profile with "rel/${worktreeName}" added to allowWrite
    Then resolving it fails with "non absolu"
    When I resolve a copy of the profile with a file "${home}/.claude/settings.json" outside allowWrite
    Then resolving it fails with "hors de allowWrite"

  Scenario: builds a closed environment: listed names only, then the fixed values
    When I load the committed builder profile
    And I resolve the profile with the test variables
    And I build the closed environment from the host environment:
      | HOME                    | /h                |
      | PATH                    | /usr/bin          |
      | TERM                    | xterm             |
      | ANTHROPIC_API_KEY       | x                 |
      | CLAUDE_CONFIG_DIR       | /c                |
      | CLAUDE_CODE_OAUTH_TOKEN | host-token        |
      | NO_PROXY                | *                 |
      | NODE_OPTIONS            | --require x       |
      | SECRET                  | s                 |
    Then the closed environment is exactly:
      | HOME                    | /h                                |
      | PATH                    | /usr/bin                          |
      | TERM                    | xterm                             |
      | CLAUDE_CODE_TMPDIR      | /t/aos/tmp                        |
      | CLAUDE_CONFIG_DIR       | /t/aos/config                     |
      | ANTHROPIC_BASE_URL      | http://127.0.0.1:4321             |
      | CLAUDE_CODE_OAUTH_TOKEN | session-token                     |
      | npm_config_cache        | /h/.cache/npm                     |
