Feature: HttpDataClient
  The memory service reaches data through typed operations over HTTP; every failure is a named DATA_UNAVAILABLE.

  Scenario: posts typed operations to /v1/ops and validates the answer
    Given an HttpDataClient for "http://data:8082" whose fetch answers 200 with '{"id":"r1","service":"memory","tool":"recall","input":{},"status":"running","created_at":"now"}'
    When the data client creates a run for tool "recall" with input '{"query":"q"}'
    Then the data client answer is '{"id":"r1"}'
    And the first data client request is '{"url":"http://data:8082/v1/ops/runs.create","body":{"service":"memory","tool":"recall","input":{"query":"q"}}}'

  Scenario: maps rejections, transport errors and malformed answers to DATA_UNAVAILABLE
    Given an HttpDataClient for "http://d" whose fetch answers 404 with '{"code":"NOT_FOUND"}'
    When the data client appends the event "run.created" with payload '{}' to run "x"
    Then the data client call is rejected with code "DATA_UNAVAILABLE"
    Given an HttpDataClient for "http://d" whose fetch fails with 'ECONNREFUSED'
    When the data client calls the operation "memory.search" with '{"query":"q"}'
    Then the data client call is rejected with code "DATA_UNAVAILABLE"
    Given an HttpDataClient for "http://d" whose fetch answers 200 with '{"nope":true}'
    When the data client calls the operation "memory.search" with '{"query":"q"}'
    Then the data client call is rejected with code "DATA_UNAVAILABLE"
