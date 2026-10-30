Feature: Worker
  runWorker reads one JSON request on stdin, runs a scripted agent in tests (no network, no Anthropic call) and prints a WorkerOutput.

  Scenario: runs the agent with the tool prompt and internal tools and emits an ok WorkerOutput
    Given a scripted agent that searches the memory for "alpha" and answers the summary "one fact" with the memories found
    When the worker runs the tool "recall" with input '{"query":"alpha"}'
    Then the worker exit code is 0
    And the worker stdout matches '{"status":"ok","cost":{"input_tokens":3,"output_tokens":2,"usd":0.0002},"data":{"summary":"one fact"}}'
    And the first agent request matches '{"limits":{"maxTurns":3,"maxBudgetUsd":0.2},"tool":"recall","systemPrompt":"recall prompt"}'
    And the first agent request matches '{"outputSchema":{"type":"object"}}'

  Scenario: turns an agent error into a failed WorkerOutput with a named code
    Given a scripted agent that throws 'agent stopped: error_max_turns'
    When the worker runs the tool "recall" with input '{"query":"q"}'
    Then the worker stdout matches '{"status":"failed","error":{"code":"WORKER_FAILED"}}'
    And the worker stdout error message contains "error_max_turns"

  Scenario Outline: exits with code 2 on <case>
    Given a scripted agent that answers an empty object
    When the worker runs with stdin '<stdin>' and prompts '<prompts>'
    Then the worker exit code is 2
    And the scripted agent was never run

    Examples:
      | case                    | stdin                                                                                           | prompts                                                |
      | not JSON                | nope                                                                                            | {"recall":"recall prompt","remember":"remember prompt"} |
      | an unknown tool         | {"run_id":"r1","tool":"teleport","input":{},"limits":{"max_turns":3,"max_budget_usd":0.2}}      | {"recall":"recall prompt","remember":"remember prompt"} |
      | a malformed envelope    | {"tool":1}                                                                                      | {"recall":"recall prompt","remember":"remember prompt"} |
      | a tool without a prompt | {"run_id":"r1","tool":"recall","input":{"query":"q"},"limits":{"max_turns":3,"max_budget_usd":0.2}} | {}                                                 |

  Scenario: loads a non-empty committed prompt for every intent tool the worker serves
    When the committed worker prompts are loaded
    Then the worker prompt names are "recall, remember"
    And the worker prompt "recall" contains "memory_search"
    And the worker prompt "remember" contains "memory_insert"

  Scenario: rejects a directory with a missing or an empty prompt
    Given a worker prompts directory with the files '{"recall.md":"x"}'
    Then loading the worker prompts is rejected
    Given a worker prompts directory with the files '{"recall.md":"x","remember.md":"  \n"}'
    Then loading the worker prompts is rejected with a message containing "empty"
