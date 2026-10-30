Feature: InternalToolService
  The internal tools a worker may call; each is a view of one data operation, served only to its owner.

  Scenario: runs the data operation of each internal tool, with the tool defaults applied
    Given an internal tool service for owner "memory" over an in-memory data port
    When the internal tool "memory_insert" is called with '{"content":"release is on Friday"}'
    Then the internal tool answer matches '{"ok":true}'
    And the value of the internal tool answer has a string field "id"
    When the internal tool "memory_search" is called with '{"query":"friday"}'
    Then the internal tool answer matches '{"ok":true,"value":[{"content":"release is on Friday","tags":[]}]}'

  Scenario: refuses invalid input, unknown tools and tools of another owner
    Given an internal tool service for owner "memory" over an in-memory data port
    When the internal tool "memory_insert" is called with '{"content":""}'
    Then the internal tool answer matches '{"ok":false,"status":400}'
    Given an internal tool service for owner "memory" over an in-memory data port
    When the internal tool "sql" is called with '{}'
    Then the internal tool answer matches '{"ok":false,"status":404}'
    Given an internal tool service for owner "billing" over an in-memory data port
    When the internal tool "memory_search" is called with '{"query":"q"}'
    Then the internal tool answer matches '{"ok":false,"status":404}'
