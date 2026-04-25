# LinkedIn post — Zetetic Team Subagents (2026-04-25)

**Status:** ready to post (human-voice rewrite, em-dashes removed).
**Cross-checks applied:** Bruner (narrative arc), Feynman (integrity).
**Voice rewrite by:** Bruner (social/narrative domain), with explicit constraint of no em-dashes and a conversational founder register.
**Target length:** ~2000 chars.

---

## Final post (copy-paste ready)

The other week I watched a Claude Code agent quote a paper it had never read. With confidence. The number it cited was off by a decimal place, and there was no way to know without going back to the source.

That bothered me enough to spend a few weekends on it.

The result is something I just open sourced: 𝗭𝗲𝘁𝗲𝘁𝗶𝗰 𝗧𝗲𝗮𝗺 𝗦𝘂𝗯𝗮𝗴𝗲𝗻𝘁𝘀. 116 Claude Code agents whose whole design philosophy is "the agent should be able to say I don't know."

Each genius agent (there are 97 of them, one per published reasoning pattern) ships with a citation to the primary source it draws from, plus written conditions under which it refuses. Ask the engineer agent to slap a try/except around a failing call and it refuses, produces a root-cause analysis, and proposes the architectural fix instead.

What I find more interesting is what happens at commit time. A pre-commit hook scans your staged changes and blocks the commit if it finds floating-point constants without a source annotation, or comments containing absolute claims like "always" or "never" with no citation. Not a warning. The commit just fails with exit code 2. Screenshot attached.

In the repo:

• 97 reasoning-pattern agents (Dijkstra, Curie, Hamilton, Cochrane, and so on) with primary-source citations
• 19 role-based team agents (engineer, architect, dba, etc.)
• 63 slash-command workflows like /deep-research and /paper-vs-code-audit
• A local implementation of Anthropic's memory_20250818 tool with scope-based ACL
• 241 tests passing in CI

What it does NOT do, called out on the front page of the README:

• It cannot tell whether a citation you write is real. It only checks that one is there.
• The hook only fires when you commit through Claude Code. Regular terminal commits walk past it.
• Refusal conditions are intent statements in agent prompts. They are not runtime contracts.

I think the four-pillar zetetic discipline (logical, critical, rational, essential) is mostly useful as a reading lens. The hook is what turns it into an enforced default instead of a habit you keep forgetting.

MIT, no telemetry, public repo. If you try it and find a place where it lies to you, please open an issue.

🔗 https://github.com/cdeust/zetetic-team-subagents

#ClaudeCode #LLMEngineering #OpenSource #ResponsibleAI

---

## Voice rewrite notes

**Constraints applied:**
- No em-dashes (—) anywhere. Replaced with parentheses, commas, or new sentences.
- No tricolons or "Not X. Y." sharp-parallelism rhythm patterns that read as AI cadence.
- First-person voice throughout ("I watched", "spend a few weekends", "I think", "I find more interesting").
- Specific opening anecdote (the quoted paper that wasn't real) instead of generic "most agents lie".
- Conversational hedges: "mostly boring" replaced with "more interesting" register, "and so on", "etc.", "a few weekends".
- Imperfect sentence rhythm: short fragment "Screenshot attached." after the long technical sentence, mirrors how a person actually writes.
- Closing CTA is a request, not a marketing call: "If you try it and find a place where it lies to you, please open an issue."
- Limits section reframed: "called out on the front page of the README" instead of "Honest limits". Same content, less rehearsed.

**Bruner's narrative arc preserved:**
- Setup: "I watched an agent fabricate a citation"
- Complication: "no way to know without going back to the source"
- Intervention: "spend a few weekends on it" + the system description
- Resolution: "what's in the box" + the limits
- Meaning: the four-pillar / hook reframing as the closing beat

**Hashtags trimmed to 4:** #ClaudeCode #LLMEngineering #OpenSource #ResponsibleAI. Drop #SoftwareEngineering as too generic.

---

## Posting checklist

- [ ] Test the 𝗭𝗲𝘁𝗲𝘁𝗶𝗰 𝗧𝗲𝗮𝗺 𝗦𝘂𝗯𝗮𝗴𝗲𝗻𝘁𝘀 unicode bold on mobile (LinkedIn doesn't support markdown bold; unicode is the standard workaround)
- [ ] **Attach the screenshot of the actual checker output.** Capture command:
  ```bash
  cd /tmp && rm -rf zet-shot && mkdir zet-shot && cd zet-shot
  git init -q
  printf '# It always works\nDELAY = 2.741592\n' > retry.py
  git add retry.py
  ZETETIC_PROFILE=strict bash /Users/cdeust/Developments/zetetic-team-subagents/tools/zetetic-checker.sh --staged
  ```
- [ ] Image alt text: "Zetetic checker output blocking a commit with two violations: UNSOURCED comment and MAGIC_NUMBER float without source annotation"
