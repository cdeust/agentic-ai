#!/bin/sh
# npm run gate [-- --job macos]: the CI gate in one local command (docs/design/platform-v3-srt.md §7).
#   1. test-gate plan: diff against the first parent, perimeter, Stryker mutate list -> reports/gate-plan.json
#   2. cucumber-js (job macos: profile macos, features/sandbox only); its exit code is never read
#   3. Stryker, linux job only and only when the plan mutates something
#   4. test-gate check: the verdict, from the reports only; its exit code is the exit code of this script
# Previous reports are removed first: a stale report must never be read as the result of this run.
set -u
job=linux
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != "--job" ]; then
    echo "usage: npm run gate [-- --job <name>]" >&2
    exit 1
  fi
  job=$2
fi
gate="node --import tsx tools/test-gate/src/main.ts"
rm -f reports/cucumber.ndjson reports/mutation/mutation.json reports/gate-plan.json reports/gate-report.md reports/gate-base.json
$gate plan --job "$job" || exit 1
if [ "$job" = linux ]; then
  cucumber-js
else
  cucumber-js --profile "$job"
fi
if [ "$job" = linux ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync("reports/gate-plan.json","utf8")).mutate.length > 0 ? 0 : 1)'; then
  started=$(date +%s)
  stryker run
  echo "stryker: $(($(date +%s) - started)) s"
fi
exec $gate check --job "$job"
