Feature: Data HTTP API
  The data component serves its typed operations over HTTP and nothing else.

  Scenario: serves health
    Given the data HTTP API over an in-memory store
    When I GET "/healthz"
    Then the response status is 200

  Scenario: serves every typed operation and nothing else
    Given the data HTTP API over an in-memory store
    Then POSTing '{}' to every typed operation never answers 404
    When I POST '{"text":"select 1"}' to "/v1/ops/sql"
    Then the response status is 404
    When I POST '{"text":"select 1"}' to "/v1/query"
    Then the response status is 404

  Scenario: maps domain errors to HTTP statuses with a code
    Given the data HTTP API over an in-memory store
    When I POST '{"service":"memory","tool":"recall","input":{}}' to "/v1/ops/runs.create"
    Then the response status is 200
    When I POST '{"run_id":"00000000-0000-4000-8000-000000000000"}' to "/v1/ops/runs.get"
    Then the response status is 404
    And the response body matches '{"code":"NOT_FOUND"}'
    When I POST '{"service":1}' to "/v1/ops/runs.create"
    Then the response status is 400
    When I POST '{"service":"a","tool":"b","input":1}' to "/v1/ops/runs.create"
    And I keep the response id as "run"
    And I POST '{"run_id":"$run","status":"ok","result":null}' to "/v1/ops/runs.complete"
    And I POST '{"run_id":"$run","status":"ok","result":null}' to "/v1/ops/runs.complete"
    Then the response status is 409
