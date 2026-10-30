Feature: code.json, the descriptive file of the 1a.0 tool

  Scenario: loads against the strict schema: builder profile, claude, builder-guard plugin
    When I load the committed code.json
    Then the tool profile is "builder"
    And the tool command is exactly "claude"
    And the tool plugin directories are exactly "plugins/builder-guard"
    And the tool auth proxy upstream is "https://api.anthropic.com"
    And the plugin manifest of the first plugin directory exists in the repository

  Scenario Outline: rejects a broken copy with <defect>
    When I break a copy of the committed code.json with <defect>
    Then parsing the broken code.json fails

    Examples:
      | defect                 |
      | a misspelt key         |
      | an empty command       |
      | a plain-http upstream  |
      | an unanchored route    |
