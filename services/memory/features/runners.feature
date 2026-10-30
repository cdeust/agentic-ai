Feature: ContainerRunner adapters
  Every ContainerRunner adapter satisfies one contract; the Docker runner also pins its isolation flags.

  Scenario Outline: ContainerRunner contract: returns the worker stdout and exit code
    Given the "<adapter>" container runner whose worker prints '{"a":1}' and exits with 0
    When the container runner runs a recall request with a timeout of 50 ms
    Then the container runner returned exit code 0 and stdout '{"a":1}'

    Examples:
      | adapter            |
      | in-process         |
      | docker (fake exec) |

  Scenario Outline: ContainerRunner contract: reports a non-zero exit code without throwing
    Given the "<adapter>" container runner whose worker prints '' and exits with 3
    When the container runner runs a recall request with a timeout of 50 ms
    Then the container runner exit code is 3

    Examples:
      | adapter            |
      | in-process         |
      | docker (fake exec) |

  Scenario Outline: ContainerRunner contract: rejects with WORKER_TIMEOUT when the worker exceeds the timeout
    Given the "<adapter>" container runner whose worker never finishes
    When the container runner runs a recall request with a timeout of 50 ms
    Then the container runner is rejected with code "WORKER_TIMEOUT"

    Examples:
      | adapter            |
      | in-process         |
      | docker (fake exec) |

  Scenario: DockerContainerRunner uses a read-only filesystem, no capabilities, no privilege escalation and a non-root user
    Given the docker runner arguments of the test configuration
    Then the docker arguments include "--read-only"
    And the docker arguments include "--cap-drop"
    And the docker arguments include "ALL"
    And the docker arguments include "--security-opt"
    And the docker arguments include "no-new-privileges"
    And the docker argument after "--user" is "10001:10001"

  Scenario: DockerContainerRunner joins only the configured exec network and ends with the image
    Given the docker runner arguments of the test configuration
    Then the docker argument after "--network" is "exec"
    And the last docker argument is "worker:test"

  Scenario: DockerContainerRunner forwards only the configured environment
    Given the docker runner arguments of the test configuration
    Then the forwarded docker environment is '["INTERNAL_TOOLS_URL=http://memory:8083"]'

  Scenario: DockerContainerRunner names the container after the run and removes it when the worker times out
    Given a docker runner whose exec records its calls and times out on run
    When the docker runner runs a request for run "run/42" with a timeout of 5 ms
    Then the docker runner is rejected with code "WORKER_TIMEOUT"
    And docker call number 1 includes "--name" and "agentic-worker-run-42"
    And docker call number 2 is '["rm","-f","agentic-worker-run-42"]'

  Scenario: DockerContainerRunner sends the worker input on stdin and maps a spawn failure to WORKER_UNAVAILABLE
    Given a docker runner whose exec records its stdin and succeeds
    When the docker runner runs a request for run "r" with a timeout of 10 ms
    Then the docker worker stdin matches '{"run_id":"r","tool":"t","input":1}'
    Given a docker runner whose exec fails with 'docker: not found'
    When the docker runner runs a request for run "r" with a timeout of 10 ms
    Then the docker runner is rejected with code "WORKER_UNAVAILABLE"
