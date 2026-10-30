Feature: Internal tools endpoint
  The worker reaches its internal tools over a real local HTTP server (port 0), served by the memory service.

  Scenario: serves the worker HttpInternalTools adapter end to end
    Given an internal tools host on a free local port
    When the worker HttpInternalTools adapter calls "memory_insert" with '{"content":"the cache TTL is 60s","tags":["cache"]}'
    And the worker HttpInternalTools adapter calls "memory_search" with '{"query":"cache ttl","limit":3}'
    Then the worker search answer lists the inserted memory

  Scenario: rejects malformed bodies and unknown paths
    Given an internal tools host on a free local port
    When the body '{"limit":"x"}' is posted to the internal path "/internal/memory_search"
    Then the internal tools host answers with status 400
    When the body '{}' is posted to the internal path "/internal/sql"
    Then the internal tools host answers with status 404
