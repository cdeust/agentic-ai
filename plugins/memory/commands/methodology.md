---
name: methodology
description: View your cognitive methodology profile and reasoning patterns
---

Use the `cortex:query_methodology` tool with the current working directory to retrieve the user's cognitive profile for this domain.

Display the `context` field as a summary paragraph, then offer:
1. Run `cortex:rebuild_profiles` if the profile seems stale or the user wants a fresh analysis
2. Run `cortex:list_domains` to show all detected domains
3. Run `cortex:get_methodology_graph` to get visualization data

If no profile exists yet, run `cortex:rebuild_profiles` first to build one from session history.
