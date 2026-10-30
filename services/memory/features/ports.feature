Feature: Memory service ports

  Scenario: names adapter failures with the Result error code they stand for
    Then a worker timeout error of 250 ms matches '{"code":"WORKER_TIMEOUT","message":"worker exceeded 250 ms"}'
    And a ServiceError with code "DATA_UNAVAILABLE" and message "down" matches '{"name":"ServiceError","code":"DATA_UNAVAILABLE"}'
