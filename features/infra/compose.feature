Feature: compose.yaml network zones

  Background:
    Given the parsed compose.yaml

  Scenario: compose.yaml declares the four zones
    Then the compose networks are "app, data, exec, public"

  Scenario: compose.yaml exposes the proxy only: it alone is on public and alone publishes a port
    Then the compose services on the network "public" are "proxy"
    And the compose services that publish a port are "proxy"

  Scenario: compose.yaml puts gateway, memory, data (and the proxy) on app; only data and postgres on data
    Then the compose services on the network "app" are "data, gateway, memory, proxy"
    And the compose services on the network "data" are "data, postgres"

  Scenario: compose.yaml keeps workers away from data: exec carries memory only, and postgres is on no other zone
    Then the compose services on the network "exec" are "memory"
    And the networks of the compose service "postgres" are "data"

  Scenario: compose.yaml makes every zone except public internal (no route to the outside)
    Then the compose network "public" is not internal
    And the compose network "app" is internal
    And the compose network "exec" is internal
    And the compose network "data" is internal

  Scenario: compose.yaml drops all capabilities on every long-running service
    Then every compose service drops all capabilities, except the build-only ones and postgres
