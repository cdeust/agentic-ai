Feature: .claude descriptive files
  The files Claude Code reads in this repository are checked against the frontmatter schemas of the subagent and
  slash command references. The Examples list the committed files: a new file in .claude/agents or
  .claude/commands adds its row.

  Scenario Outline: subagent <file> has a valid frontmatter and a prompt
    Given the committed file ".claude/agents/<file>"
    Then it has a valid subagent frontmatter and a prompt
    And its subagent name is the name of the file

    Examples:
      | file                       |
      | architecture-reviewer.md   |
      | security-reviewer.md       |
      | test-reviewer.md           |

  Scenario Outline: command <file> has a valid frontmatter, and every subagent it names exists
    Given the committed file ".claude/commands/<file>"
    Then it has a valid command frontmatter and a prompt
    And every subagent it names exists in .claude/agents

    Examples:
      | file         |
      | review-pr.md |

  Scenario: a descriptive file with an invalid frontmatter is rejected
    Then a text without frontmatter is rejected
    And a subagent frontmatter without description is rejected
    And a subagent frontmatter with the misspelt field allowed_tools is rejected

  Scenario: .claude/settings.json stays valid JSON with permission rule lists
    Then the committed .claude/settings.json is valid JSON with permission rule lists
