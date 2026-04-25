# LinkedIn post — Zetetic Team Subagents (2026-04-25)

**Status:** ready to post.
**Cross-checks applied:** Bruner (narrative), Feynman (integrity). Counts independently verified — see Notes.
**Target length:** ~1700 chars.
**Audience:** AI engineers, hiring managers, researchers, indie devs evaluating Claude Code stacks.

---

## Final post

Your Claude Code agent just cited a paper it hasn't read. With conviction.

I built the gate that would have caught that.

𝗭𝗲𝘁𝗲𝘁𝗶𝗰 𝗧𝗲𝗮𝗺 𝗦𝘂𝗯𝗮𝗴𝗲𝗻𝘁𝘀 — 116 Claude Code agents that can say "I don't know."

Each genius agent is a reasoning procedure drawn from primary sources — Dijkstra's correctness discipline, Curie's residual-with-a-carrier method, Hamilton's fault-tolerance protocol, Cochrane's evidence synthesis — with documented refusal conditions and a citation to its source paper.

The differentiator: a pre-commit hook that BLOCKS commits with floating-point constants lacking source annotations. Not a warning. A gate. Exit 2.

What that looks like on a real two-line file (zetetic-checker output + pre-commit wrapper):

→ UNSOURCED  retry.py:1: # It always works
→ MAGIC_NUMBER  retry.py:2: DELAY = 2.741592
→ FAILED: 2 blocking violation(s).
→ BLOCKED: Zetetic violations in staged files.

(Screenshot of the terminal attached for the full strict-profile output.)

What's in the box:
• 97 genius agents (reasoning patterns from primary sources)
• 19 team agents (engineer, architect, dba, security-auditor, …)
• 63 multi-step skills (/deep-research, /incident-investigation, /paper-vs-code-audit, /autoresearch-loop)
• Commit-time gates that catch unsourced constants and absolute claims
• Local replica of Anthropic's memory_20250818 tool with scope-based ACL
• 241 tests passing on every push

Honest limits — published in the README:
• Citation presence ≠ citation validity. The gate enforces a citation IS THERE, not that it's true.
• Hooks fire only inside Claude Code's invocation path. Manual `git commit` bypasses them.
• Refusal conditions are intent statements documented in agent prompts, not enforced contracts at runtime.

The four pillars — logical / critical / rational / essential — are the lens. The hooks are how the standard stops being aspirational.

MIT licensed. No telemetry. Built in the open.

🔗 https://github.com/cdeust/zetetic-team-subagents

#ClaudeCode #LLMEngineering #OpenSource #ResponsibleAI #SoftwareEngineering

---

## Cross-check notes

### Bruner (narrative) — applied:
- Hook reframed: "Most AI systems..." → "Your Claude Code agent..." (puts reader in the story)
- "I built the opposite" → "I built the gate" (Feynman's scope-correction also closes the overclaim)
- Verbatim output block now has a 1-line label above it (mobile readers see the claim before the code)
- Four-pillars line moved to second-to-last position; license footer follows it (closes on meaning, not technical metadata)
- Hashtags swapped: dropped generic #AI / #AIAgents; added #LLMEngineering and #ResponsibleAI for the rigorous-practitioners segment

### Feynman (integrity) — applied + corrected:
- ✅ "I built the opposite" → "I built the gate" (narrows scope honestly)
- ✅ Verbatim block now labeled as combined checker + pre-commit-hook output (matches what the README says, no surprise for a reader who runs the tool)
- ❌ Feynman's count corrections (118 agents / 61 skills / 6 scopes) were WRONG. Verified locally:
  - team agents: 19 ✓
  - genius agents (excluding INDEX.md): 97 ✓
  - total: 116 ✓
  - skills: 63 ✓
  - scopes: 24 ✓
- "Most AI systems" softened to "Your Claude Code agent" — sidesteps the unverified quantifier entirely

### Posting checklist
- [ ] Test the 𝗭𝗲𝘁𝗲𝘁𝗶𝗰 𝗧𝗲𝗮𝗺 𝗦𝘂𝗯𝗮𝗴𝗲𝗻𝘁𝘀 unicode bold on mobile (LinkedIn doesn't support markdown bold; unicode is the standard workaround)
- [ ] **Attach a screenshot of the actual terminal output** — LinkedIn doesn't render code blocks. The text uses "→" prefix lines for visual scanning; the image carries the verbatim proof. Capture: `cd /tmp && mkdir t && cd t && git init -q && printf '# It always works\nDELAY = 2.741592\n' > retry.py && git add retry.py && ZETETIC_PROFILE=strict bash <repo>/tools/zetetic-checker.sh --staged` then screenshot the full output.
- [ ] Image alt text: "Zetetic checker output blocking a commit with two violations: UNSOURCED comment and MAGIC_NUMBER float without source annotation"
