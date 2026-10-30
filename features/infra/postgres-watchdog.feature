Feature: Disposable PostgreSQL servers do not outlive their test process
  Stryker kills its test-runner workers, so the AfterAll hook never runs. Each orphan server keeps one SysV shared
  memory segment and macOS allows 32 of them (kern.sysv.shmmni). A detached watchdog stops the server when the
  process that started it is gone, however it died.

  Scenario: the watchdog stops the server and removes its directory within seconds of the SIGKILL of its owner
    Given a PostgreSQL server started on behalf of a separate process
    And the server is running
    When the separate process is killed with SIGKILL
    Then within 15 seconds the server process is gone and its directory is removed
