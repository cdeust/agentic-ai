Feature: SQL store, statement table and migrations
  The SQL lives in sql/ and migrations/; one executor binds every value as a parameter.

  Scenario: loads the committed table: every contract operation has a statement and its SQL file
    When I load the committed statement table
    Then the table has 7 distinct operations
    And every statement of the table has a non-empty text

  Scenario Outline: rejects a table with <defect>
    When I copy the sql directory and rewrite "<file>" as "<rewrite>"
    Then loading the statement table from the copy fails

    Examples:
      | defect                                         | file            | rewrite                                |
      | an operation without a statement               | operations.json | drop the first statement               |
      | an operation the contracts do not know         | operations.json | rename the first operation to sql.raw  |
      | a parameter list shorter than the placeholders | runs.create.sql | append the placeholder $4              |
      | an unknown field                               | operations.json | add the unknown field cache            |
      | a SQL file that does not exist                 | operations.json | point the first statement at nope.sql  |
      | not JSON                                       | operations.json | replace the content by an opening brace |

  Scenario: binds every value as a parameter, never into the SQL text
    Given a SQL data store over a recording executor answering the run row
    When I execute "runs.create" with:
      """
      {"service":"s'; DROP TABLE runs;--","tool":"t","input":{"a":1}}
      """
    Then the recorded statement 0 does not contain "DROP"
    And the recorded statement 0 has the parameters:
      """
      ["s'; DROP TABLE runs;--","t","{\"a\":1}"]
      """
    And the answer as JSON equals:
      """
      {"id":"r","service":"s","tool":"t","input":{},"status":"running","created_at":"1970-01-01T00:00:00.000Z"}
      """

  Scenario: chooses the vector statement only when an embedding is given
    Given a SQL data store over a recording executor answering no row
    When I execute "memory.search" with the input '{"query":"100%_x","limit":3}'
    And I execute "memory.search" with the input '{"query":"","embedding":[1,2],"limit":2}'
    Then the recorded statement 0 has the parameters '["100%_x",3]'
    And the recorded statement 0 contains "ILIKE"
    And the recorded statement 1 has the parameters '["[1,2]",2]'
    And the recorded statement 1 contains "<=>"

  Scenario: maps declared SQLSTATEs to named failures and an empty answer to NOT_FOUND
    Given a SQL data store over a recording executor failing with SQLSTATE "23503" and message 'violates foreign key constraint "run_events_run_id_fkey"'
    When I execute "runs.appendEvent" with the input '{"run_id":"r","type":"run.created","payload":{}}' and it is refused
    Then the failure matches '{"code":"NOT_FOUND","message":"runs.appendEvent: not found"}'
    Given a SQL data store over a recording executor answering no row
    When I execute "runs.get" with the input '{"run_id":"r"}' and it is refused
    Then the failure code is "NOT_FOUND"

  Scenario: applies each versioned migration once, in order
    When I migrate twice from the committed migrations directory with an in-memory ledger
    Then the first migration applies "0001_runs.sql, 0002_memory.sql, 0003_runs_immutable.sql"
    And the second migration applies nothing
    And the migration statements include "CREATE EXTENSION IF NOT EXISTS vector"
