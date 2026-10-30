Feature: Data operations
  The use cases validate every input and output against the contracts before and after the store.

  Scenario: runs the lifecycle create, appendEvent, complete
    Given data operations over an in-memory store
    When I execute "runs.create" with the input '{"service":"memory","tool":"recall","input":{}}'
    And I keep the answer id as "run"
    And I execute "runs.appendEvent" with the input '{"run_id":"$run","type":"run.created"}'
    And I execute "runs.complete" with the input '{"run_id":"$run","status":"ok","result":{"a":1}}'
    And I execute "runs.events" with the input '{"run_id":"$run"}'
    Then the answer has 1 items
    When I execute "runs.get" with the input '{"run_id":"$run"}'
    Then the answer matches '{"status":"ok"}'

  Scenario: rejects input that does not match the contract schema with INVALID_INPUT
    Given data operations over an in-memory store
    When I execute "runs.create" with the input '{"service":1}' and it is refused
    Then the failure code is "INVALID_INPUT"
    When I execute "runs.complete" with the input '{"run_id":"not-a-uuid","status":"ok","result":null}' and it is refused
    Then the failure code is "INVALID_INPUT"
    When I execute "memory.insert" with the input '{"content":"x","embedding":[1,2]}' and it is refused
    Then the failure code is "INVALID_INPUT"

  Scenario: accepts an embedding of the contract dimension
    Given data operations over an in-memory store
    When I execute "memory.insert" with the input '{"content":"x","embedding":"$filled0.5"}'
    Then the answer has the field "id"

  Scenario: refuses a store answer that breaks the output contract
    Given data operations over a store that always answers '{"nope":true}'
    When I execute "memory.insert" with the input '{"content":"x"}' and it is refused
    Then the failure message contains "outside its contract"

  Scenario: knows exactly the typed operations and no raw SQL operation
    Given data operations over an in-memory store
    Then the operations know "runs.create"
    And the operations do not know "sql"
    And the operations do not know "query"

  Scenario: inserts and searches memory
    Given data operations over an in-memory store
    When I execute "memory.insert" with the input '{"content":"hello world"}'
    And I execute "memory.search" with the input '{"query":"hello"}'
    Then the answer has 1 items
