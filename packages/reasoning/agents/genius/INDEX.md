# Genius Agent Index — Route by Problem Shape

The orchestrator selects genius agents by **problem shape**, not by field or historical person. Each shape is a trigger pattern — a recognizable structure in the problem that activates a specific reasoning procedure. A single agent may serve multiple shapes; a single problem may invoke multiple agents in sequence (see "Pairs well with" in each agent's frontmatter).

> **Rule:** if no shape below matches the problem, do not force a genius agent. Use a standard team agent instead.

---

## Shape → Agent Lookup

### Measurement, Signal, and Isolation

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **residual-with-a-carrier** | measured > predicted from known parts, gap outside noise | [curie](curie.md) | Chase the excess; isolate by enrichment with control substitution |
| **instrument-before-hypothesis** | "we want to improve X" but no instrument reads X | [curie](curie.md) | Fix the instrument and its unit before deciding what to look for |
| **name-the-anomaly** | quantifiable deviation observed, no term for it yet | [curie](curie.md) | Coin a name and operational definition; forbid mechanism talk |
| **two-independent-methods** | a result from one method only | [curie](curie.md) | Require a second independent confirmation before claiming |
| **observer-effect-audit** | measurement may perturb the system (test leakage, Heisenbugs, observability overhead) | [curie](curie.md) | Audit back-action before trusting any measurement |

### Estimation and Bounding

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **order-of-magnitude-first** | decision blocked by "we don't have data" | [fermi](fermi.md) | Decompose into bracketable factors; multiply bounds |
| **bracket-before-solve** | false precision masking bad assumptions | [fermi](fermi.md) | Produce a two-sided bound + dominant uncertainty |
| **refuse-false-precision** | single-number estimate presented without bracket | [fermi](fermi.md) | Convert to bracket; name the dominant factor |
| **sanity-check** | a claimed number that nobody has cross-checked | [fermi](fermi.md) | Two independent decompositions must agree to ×10 |
| **feasibility-bound** | "is this even possible?" before committing resources | [fermi](fermi.md) | Bracket the quantity; if the high end is below viability, kill it early |

### Hard Real-Time and Failure Design

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **hard-real-time** | system must meet deadlines under overload | [hamilton](hamilton.md) | Priority-displaced scheduling by criticality |
| **priority-under-failure** | "what happens when everything goes wrong simultaneously?" | [hamilton](hamilton.md) | Shed by criticality, not by arrival order |
| **graceful-degradation** | default failure mode is crash, not degrade | [hamilton](hamilton.md) | Design the degraded state as a first-class behavior |
| **asynchronous-first** | design assumes synchronous behavior by default | [hamilton](hamilton.md) | Rewrite every "and then X happens" as "when X arrives (if ever)" |
| **defensive-by-default** | "users will never…" or "our clients always…" | [hamilton](hamilton.md) | Reverse the assumption; software handles the wrong input |

### Defining the Right Measure

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **define-the-measure-first** | "improving X" where X has no formal definition | [shannon](shannon.md) | Axiomatize the quantity; derive from properties |
| **limit-before-method** | someone proposes a method without knowing the theoretical limit | [shannon](shannon.md) | Derive the limit; compare current state; decide if method is worth it |
| **source-channel-code-separation** | layers are tangled (data, transport, processing) | [shannon](shannon.md) | Separate into independently-analyzable layers |
| **operational-definition** | a "metric" without a repeatable measurement procedure | [shannon](shannon.md) | Tie the quantity to a limit of a repeatable process |
| **noise-as-parameter** | plan starts with "eliminate the noise" | [shannon](shannon.md) | Characterize the noise; design around it |

### Distributed Systems and Formal Correctness

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **distributed-causality** | design uses wall-clock time for correctness | [lamport](lamport.md) | Replace "when" with happens-before |
| **proof-before-code** | non-trivial concurrent/distributed code with no written spec | [lamport](lamport.md) | Write the spec; model-check on small instances |
| **invariants-not-traces** | correctness argued by walking through example executions | [lamport](lamport.md) | State the invariant; prove by induction over transitions |
| **spec-first** | team debates behavior by telling stories instead of checking invariants | [lamport](lamport.md) | Write the spec as a predicate; the code refines it |
| **partial-failure-default** | design assumes messages arrive, services respond, disks don't fail | [lamport](lamport.md) | Assume every external interaction can fail in three phases |

### Long-Horizon Observation

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **long-horizon-observation** | phenomenon unfolds over weeks/months/years; snapshots will mislead | [darwin](darwin.md) | Start the notebook; match cadence to the phenomenon's timescale |
| **variation-as-data** | variation is being averaged away instead of examined | [darwin](darwin.md) | Look at the distribution, the outliers, the tails |
| **difficulty-book** | theory has no catalog of its own contradicting evidence | [darwin](darwin.md) | Open a difficulty book on day one; every contradiction goes in |
| **hardest-case-first** | theory being defended on its easiest cases | [darwin](darwin.md) | Name the hardest case; address it explicitly before shipping |
| **delay-vs-avoidance** | team delaying past readiness without a stopping rule | [darwin](darwin.md) | Set a forcing function tied to the difficulty book, not to "more confidence" |

### Symmetry and Invariance

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **symmetry-first** | problem feels intractable in direct form; hidden regularity suspected | [noether](noether.md) | Find the invariance group; quotient before solving |
| **invariance-to-conservation** | a quantity is conserved but nobody knows why | [noether](noether.md) | Find the symmetry that yields it (first theorem) |
| **find-the-group** | system has equivalences nobody has written down | [noether](noether.md) | Enumerate the symmetry group explicitly |
| **equivalence-reduction** | search space contains redundant configurations | [noether](noether.md) | Quotient by the symmetry group to shrink the space |
| **gauge-vs-global** | "conservation law" claimed from a symmetry — but is it really? | [noether](noether.md) | Classify: global → conservation; local/gauge → identity, not conservation |
| **symmetry-breaking-as-signal** | an expected symmetry is violated | [noether](noether.md) | The breaking is data; localize it to find the perturbation |

### Predictive Taxonomy

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **tabulate-and-predict-gaps** | many known items, suspected hidden regularity | [mendeleev](mendeleev.md) | Find the right axes; leave explicit gaps; predict gap properties |
| **organize-by-hidden-axis** | classification feels "almost there" with unnamed holes | [mendeleev](mendeleev.md) | Try multiple axis pairs; pick the one that maximizes gap visibility |
| **falsifiable-taxonomy** | taxonomy presented with no predictions | [mendeleev](mendeleev.md) | List what the taxonomy predicts; defend axes by predictions |
| **fill-the-empty-cell** | a gap in a matrix is suspected to be a real missing item | [mendeleev](mendeleev.md) | Predict the gap's properties from neighbors before looking for it |
| **reorder-when-prediction-fails** | a table prediction fails and an ad-hoc exception is proposed | [mendeleev](mendeleev.md) | Diagnose: mismeasurement, wrong axis, or new phenomenon |

### Understanding and Integrity

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **rederive-from-scratch** | a result is being cited without the ability to reproduce its derivation | [feynman](feynman.md) | Close the book; rederive from premises; note where you fail |
| **explain-to-freshman** | jargon used without the ability to define it in simpler terms | [feynman](feynman.md) | Explain without jargon; the failure points are understanding gaps |
| **cargo-cult-detector** | procedure followed because "successful people do it" without knowing why | [feynman](feynman.md) | Require the causal mechanism; no mechanism = cargo cult candidate |
| **integrity-audit** | a result is suspiciously clean; self-deception possible | [feynman](feynman.md) | List what could invalidate the result; the hardest items go in the report |
| **sum-over-histories** | committed to first plausible explanation without alternatives | [feynman](feynman.md) | Enumerate alternatives; the answer is where multiple lines converge |

### Single-Specimen and Anomaly

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **anomaly-others-discarded** | a class of observations is being trimmed, filtered, or labeled noise | [mcclintock](mcclintock.md) | Investigate the discarded class; the anomaly may be the phenomenon |
| **single-specimen-deep-observation** | aggregate metric smooth but specific case weird | [mcclintock](mcclintock.md) | Pick one instance; observe deeply; do not aggregate |
| **trust-direct-over-aggregate** | direct observation contradicts aggregate statistic | [mcclintock](mcclintock.md) | Investigate the disagreement; do not default to trusting the aggregate |
| **rejected-but-correct** | finding will be unfashionable for years | [mcclintock](mcclintock.md) | Publish, wait, do not retract, do not escalate beyond evidence |
| **perceptual-expertise** | vague "something is off" from someone experienced | [mcclintock](mcclintock.md) | Ground the feeling in a specific observation before acting or dismissing |

### Program Correctness and Discipline

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **proof-and-program-together** | correctness-critical code with no derivation from spec | [dijkstra](dijkstra.md) | Develop code and correctness argument hand-in-hand |
| **locality-of-reasoning** | a construct defeats understanding from surrounding context | [dijkstra](dijkstra.md) | Restrict to constructs that admit local reasoning |
| **separation-of-concerns** | one function/module addresses multiple concerns | [dijkstra](dijkstra.md) | Identify concerns; split into independently-reasonable pieces |
| **elegance-as-correctness** | code is ugly, invariant hard to state, reader struggles | [dijkstra](dijkstra.md) | Refactor until invariant and correctness are both visible |
| **tests-insufficient** | team leaning on tests for code whose failure modes tests can't cover | [dijkstra](dijkstra.md) | Name the uncovered mode; recommend the appropriate stronger discipline |

### Abstraction and Tool Design

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **compile-as-abstraction-barrier** | users forced to think in implementation vocabulary | [hopper](hopper.md) | Build a translator so users stay in domain language |
| **debugging-as-first-class** | debugging treated as shameful or under-invested | [hopper](hopper.md) | Elevate debugging: tools, vocabulary, logging, culture |
| **make-abstract-tangible** | decisions on quantities nobody can feel | [hopper](hopper.md) | Create a tangible representation the decision-maker can perceive |
| **anticipate-obsolescence** | defending a tool out of familiarity, not merit | [hopper](hopper.md) | Evaluate honestly; lead the transition |
| **ask-forgiveness-not-permission** | valuable move blocked by process (with bounded risk, demonstrable benefit) | [hopper](hopper.md) | Build first, legitimize after — but only with all four preconditions met |

### Augmentation and Human Capability

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **augment-not-automate** | default framing is "automate this" when "augment the person" is ignored | [engelbart](engelbart.md) | Ask what the human uniquely contributes; amplify that |
| **bootstrap-your-own-tools** | team building a tool doesn't use it themselves | [engelbart](engelbart.md) | Restructure so the tool is the team's daily working environment |
| **h-lam-t-system** | tool designed without attention to language, methodology, training | [engelbart](engelbart.md) | Inventory all five H-LAM/T components; design together |
| **demo-as-argument** | arguing by slide deck when a live demo is feasible | [engelbart](engelbart.md) | Build the demo; let it carry the argument |
| **raise-the-ceiling** | design entirely optimized for novice onboarding, no expert capability growth | [engelbart](engelbart.md) | Ask what experts can do after a month, a year; design for both floor and ceiling |
| **co-evolve-tool-and-practice** | assuming existing work practice won't change when tool is introduced | [engelbart](engelbart.md) | Treat tool and practice as a single coupled design object |

### Rapid Hypothesis Generation (PROVER REQUIRED)

| Shape | Trigger | Agent | Key move |
|---|---|---|---|
| **conjecture-generator** | need many candidate patterns quickly in a formal domain | [ramanujan](ramanujan.md) | Compute special cases; state conjectures; **hand off to prover** |
| **pattern-from-special-cases** | analytical approach too slow; computed examples likely to reveal structure | [ramanujan](ramanujan.md) | Compute 50+ specific instances; spot the pattern |
| **notation-driven-discovery** | stuck in one notation; pattern may be visible in another | [ramanujan](ramanujan.md) | Rewrite in multiple forms until identities emerge |
| **intuition-plus-prover** | strong pattern intuition available but rigorous checking is slow | [ramanujan](ramanujan.md) | Generate at high rate; paired prover verifies each |
| **deferred-rigor-with-mandatory-handoff** | speed of generation is valuable but correctness must not be assumed | [ramanujan](ramanujan.md) | Label everything as conjecture; **NEVER ship without prover verification** |

---

## Quick Reference: Agent → Shapes

| Agent | Shapes |
|---|---|
| [curie](curie.md) | residual-with-a-carrier, instrument-before-hypothesis, name-the-anomaly, two-independent-methods, observer-effect-audit |
| [fermi](fermi.md) | order-of-magnitude-first, bracket-before-solve, refuse-false-precision, sanity-check, feasibility-bound |
| [hamilton](hamilton.md) | hard-real-time, priority-under-failure, graceful-degradation, asynchronous-first, defensive-by-default |
| [shannon](shannon.md) | define-the-measure-first, limit-before-method, source-channel-code-separation, operational-definition, noise-as-parameter |
| [lamport](lamport.md) | distributed-causality, proof-before-code, invariants-not-traces, spec-first, partial-failure-default |
| [darwin](darwin.md) | long-horizon-observation, variation-as-data, difficulty-book, hardest-case-first, delay-vs-avoidance |
| [noether](noether.md) | symmetry-first, invariance-to-conservation, find-the-group, equivalence-reduction, gauge-vs-global, symmetry-breaking-as-signal |
| [mendeleev](mendeleev.md) | tabulate-and-predict-gaps, organize-by-hidden-axis, falsifiable-taxonomy, fill-the-empty-cell, reorder-when-prediction-fails |
| [feynman](feynman.md) | rederive-from-scratch, explain-to-freshman, cargo-cult-detector, integrity-audit, sum-over-histories |
| [mcclintock](mcclintock.md) | anomaly-others-discarded, single-specimen-deep-observation, trust-direct-over-aggregate, rejected-but-correct, perceptual-expertise |
| [dijkstra](dijkstra.md) | proof-and-program-together, locality-of-reasoning, separation-of-concerns, elegance-as-correctness, tests-insufficient |
| [hopper](hopper.md) | compile-as-abstraction-barrier, debugging-as-first-class, make-abstract-tangible, anticipate-obsolescence, ask-forgiveness-not-permission |
| [engelbart](engelbart.md) | augment-not-automate, bootstrap-your-own-tools, h-lam-t-system, demo-as-argument, raise-the-ceiling, co-evolve-tool-and-practice |
| [ramanujan](ramanujan.md) | conjecture-generator, pattern-from-special-cases, notation-driven-discovery, intuition-plus-prover, deferred-rigor-with-mandatory-handoff |

---

## Common Pairings

| Situation | Agent sequence |
|---|---|
| Anomaly found → isolate → explain | mcclintock → curie → shannon or noether |
| Estimate → measure → formalize | fermi → curie → shannon |
| Conjecture → prove → implement | ramanujan → dijkstra or lamport → engineer |
| Design under failure → specify → implement | hamilton → lamport → engineer |
| Slow phenomenon → formalize → predict gaps | darwin → shannon → mendeleev |
| Integrity audit of a result | feynman (+ curie for re-measurement) |
| New tool design | engelbart (augmentation frame) → hopper (abstraction layer) → dijkstra (correctness) |
| Symmetry reduction → formal spec | noether → lamport |
| Cargo cult detected → rederive → rebuild | feynman → dijkstra or hopper |

---

## Shapes NOT YET Covered (Round 3 Candidates)

These reasoning shapes have been identified but no agent yet covers them. Each would require a new agent built to the same template:

| Shape | Candidate person | What it adds |
|---|---|---|
| **reduce-to-mechanism / universality** | Turing | "What is the simplest machine that computes this?" — universality, decidability, reduction to automata |
| **cross-domain-formal-transfer** | von Neumann | Formalize a problem in one domain using the algebra of another; game theory, automata, self-replication |
| **mass-balance-the-whole-system** | Lavoisier | Quantitative conservation — nothing created, nothing destroyed; every input must appear as an output somewhere |
| **controlled-experiment-design** | Pasteur / Fisher | Design the experiment with controls, blinding, randomization before running it |
| **statistical-experimental-design** | Fisher | Block, randomize, replicate; ANOVA as the method; design of experiments as a discipline |
| **substitutability-as-contract** | Liskov | Behavioral subtyping; the contract IS the interface; substitutability is the correctness criterion |
| **literate-programming / measure-before-optimizing** | Knuth | Code as literature; "premature optimization" in its real context (profile first) |
| **late-binding / messaging-over-procedure** | Kay | Malleability as the primary design value; objects communicate by messages, not by procedure calls |
| **inclined-plane / idealize-away-friction** | Galileo | Simplify the problem by removing the non-essential variable to expose the law |
| **chance-favors-the-prepared** | Pasteur | Design readiness for serendipity; structured note-taking so accidents become discoveries |
