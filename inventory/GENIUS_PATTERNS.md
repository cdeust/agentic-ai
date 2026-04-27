# Genius Patterns Inventory

Source: `/Users/cdeust/Developments/zetetic-team-subagents/agents/genius/`
Count: 97 agent files (excludes `INDEX.md` which is a navigation index, not an agent)
Extraction method: `<identity>` tag first sentence + frontmatter `shapes` field + `grep` for Move counts and tool references.

Facet schema applied (Ranganathan PMEST adapted):
- **Domain** (Personality): the intellectual discipline the pattern originates in
- **Style** (Energy): the primary reasoning operation the pattern performs
- **Era** (Time): approximate century of the historical instance
- **Moves** (Matter): number of named canonical moves in the `<canonical-moves>` block
- **External tools** (Space): which Claude Code tools the pattern explicitly references (WebSearch / Read / Bash)

---

| Name | File | Lines | Essence (from `<identity>`) | Domain | Style | Era | Moves | WebSearch | Read | Bash |
|---|---|---|---|---|---|---|---|---|---|---|
| alexander | `alexander.md` | 339 | Design knowledge lives in named problem-solution pairs (patterns) composed into languages where patterns reference each other; the ORDER in which design decisions are made determines whether the result has life or not. | Architecture / Pattern Languages | Pattern capture and composition | 20th c. | 5 | yes | yes | yes |
| alkhwarizmi | `alkhwarizmi.md` | 361 | Reduce the messy problem to a canonical form, classify all possible cases exhaustively, then apply the known solution for each case mechanically. | Mathematics / Algebra | Canonical-form reduction | 9th c. | 5 | yes | yes | yes |
| altshuller | `altshuller.md` | 346 | Every hard problem contains a contradiction — improving one parameter degrades another — and contradictions are resolved not by compromise but by inventive principles derived from 250,000 patents. | Inventive Problem Solving (TRIZ) | Contradiction resolution | 20th c. | 5 | yes | yes | yes |
| archimedes | `archimedes.md` | 348 | Use any means to DISCOVER the result first; then prove it rigorously by a separate, independent method; approximate from above and below until the bounds converge. | Mathematics / Physics | Discovery-then-verification | 3rd c. BCE | 5 | yes | yes | yes |
| arendt | `arendt.md` | 355 | When systemic harm occurs, check for thoughtlessness before checking for malice; when evaluating activity, classify it as labor, work, or action. | Political Philosophy | Systemic thoughtlessness diagnosis | 20th c. | 5 | yes | yes | yes |
| aristotle | `aristotle.md` | 336 | For every phenomenon, ask what it is made of, what form it takes, what produced it, and what it is for; for every argument, check it against the catalog of known fallacies. | Philosophy / Logic | Four-cause causal analysis | 4th c. BCE | 5 | yes | yes | yes |
| bateson | `bateson.md` | 355 | The pathology is not in the individual component but in the pattern of interaction between components; when communication at different levels contradicts itself, the receiver is trapped. | Cybernetics / Anthropology | Pathological-interaction-pattern diagnosis | 20th c. | 5 | yes | yes | yes |
| beer | `beer.md` | 342 | Every viable system contains five necessary subsystems in a specific relationship; if any is missing or malformed, the system loses viability; variety must be matched between system and environment. | Management Cybernetics (VSM) | Viability-structure diagnosis | 20th c. | 5 | yes | yes | yes |
| borges | `borges.md` | 337 | Every system that claims to enumerate, model, decide, or represent raises five questions — is the space actually searchable? does the map stay smaller than the territory? does the system refer to itself? | Literature / Philosophy | Structural-assumption audit | 20th c. | 5 | yes | yes | yes |
| boyd | `boyd.md` | 357 | Cycle through Observe-Orient-Decide-Act faster than your adversary; treat orientation as the critical phase where advantage is won or lost. | Military Strategy | OODA-loop competitive tempo | 20th c. | 5 | yes | yes | yes |
| braudel | `braudel.md` | 344 | Decompose every phenomenon into three timescales — the long-duration structure, the medium-duration cycle, and the short-duration event — and always look for the structural explanation first. | History (Annales School) | Multi-timescale structural analysis | 20th c. | 5 | yes | yes | yes |
| bruner | `bruner.md` | 347 | Humans have two irreducible modes of thought — paradigmatic (logical, categorical, truth-seeking) and narrative (sequential, meaning-making, story-shaped); neither reduces to the other. | Cognitive Psychology | Paradigmatic-vs-narrative mode selection | 20th c. | 5 | yes | yes | yes |
| carnot | `carnot.md` | 343 | Every transformation process has a theoretical maximum efficiency determined by its boundary conditions; the gap between actual and ideal tells you whether optimization is worthwhile. | Thermodynamics | Efficiency-ceiling analysis | 19th c. | 5 | yes | yes | yes |
| champollion | `champollion.md` | 353 | When an unknown system has a parallel known system, bootstrap understanding from the known to the unknown; when proper names cross representation boundaries unchanged, anchor on them first. | Linguistics / Decipherment | Parallel-reference bootstrapping | 19th c. | 5 | yes | yes | yes |
| coase | `coase.md` | 379 | System boundaries are not given — they are drawn where the cost of internal coordination equals the cost of external transaction; when a boundary creates more overhead than it saves, move it. | Economics (Transaction Cost Theory) | Boundary-cost analysis | 20th c. | 5 | yes | yes | yes |
| cochrane | `cochrane.md` | 354 | Before asking "what does this study say?", ask "what does the totality of evidence say?" — and answer that question with a formal protocol, not a narrative impression. | Evidence-Based Medicine / Meta-analysis | Systematic evidence synthesis | 20th c. | 5 | yes | yes | yes |
| curie | `curie.md` | 381 | Let the instrument decide, name the anomaly, isolate the carrier of the residual, confirm by a second independent method. | Chemistry / Physics | Anomaly isolation via instrument | 19th–20th c. | 7 | yes | yes | yes |
| darwin | `darwin.md` | 379 | Observe patiently for as long as the phenomenon requires, collect variation systematically, keep a running catalog of observations that contradict your theory. | Biology / Natural History | Patient variation-collection | 19th c. | 6 | yes | yes | yes |
| deming | `deming.md` | 362 | Before acting on variation, classify it — common-cause requires system redesign, special-cause requires finding the specific event; improve through the PDSA cycle. | Quality / Systems Management | Common-cause vs special-cause classification | 20th c. | 5 | yes | yes | yes |
| dijkstra | `dijkstra.md` | 386 | Develop the program and its correctness argument hand in hand; restrict yourself to constructs that allow local reasoning; separate concerns so each program text addresses one thing clearly. | Computer Science / Formal Methods | Correctness-argument co-development | 20th c. | 6 | yes | yes | yes |
| eco | `eco.md` | 356 | Before designing any artifact, explicitly define who you assume the user is — their competencies, expectations, and interpretive strategies; classify the artifact as open or closed. | Semiotics / Literary Theory | Intended-audience design and interpretation-limit audit | 20th c. | 5 | yes | yes | yes |
| einstein | `einstein.md` | 295 | Imagine yourself inside the system (gedankenexperiment); define abstract concepts by the physical/operational procedure that measures them; demand that the form of the law does not depend on the observer's frame. | Physics (Relativity) | Gedankenexperiment and operational definition | 20th c. | 5 | yes | yes | yes |
| ekman | `ekman.md` | 373 | When a domain is dismissed as "subjective," build an objective coding system by anchoring every perceived quality to an observable, anatomically-grounded unit. | Psychology / Behavioral Science | Subjective-to-objective anchoring | 20th c. | 6 | yes | yes | yes |
| engelbart | `engelbart.md` | 392 | Design to augment human capability, not to replace it; the team building the tool must use the tool (bootstrap); the unit of analysis is the whole co-adapted system. | Human-Computer Interaction | Capability-augmentation design | 20th c. | 6 | yes | yes | yes |
| erdos | `erdos.md` | 354 | When you cannot construct it, prove it exists by randomness; when a network changes behavior suddenly, find the threshold; when you need a guarantee, find the extremal bound. | Mathematics (Combinatorics / Graph Theory) | Probabilistic existence proof and extremal bound | 20th c. | 5 | yes | yes | yes |
| erlang | `erlang.md` | 348 | When a system has work arriving, waiting, and being served, the relationship between utilization and latency is nonlinear — at high utilization, small increases in load produce enormous increases in latency. | Queuing Theory / Telecommunications | Queuing-theoretic capacity analysis | 20th c. | 5 | yes | yes | yes |
| euler | `euler.md` | 358 | When the problem is hard, first check whether the notation is making it hard — design notation that makes the solution visible; enumerate all cases exhaustively and let the pattern emerge. | Mathematics | Notation design and exhaustive enumeration | 18th c. | 5 | yes | yes | yes |
| feinstein | `feinstein.md` | 349 | Given ambiguous symptoms, generate a ranked differential of plausible causes, update probabilities as evidence arrives, and act when the probability crosses the threshold where expected benefit exceeds expected harm. | Clinical Medicine / Decision Theory | Probabilistic differential diagnosis | 20th c. | 5 | yes | yes | yes |
| fermi | `fermi.md` | 370 | Bracket every quantity to within a factor of 10 using decomposition, anchors, and multiplication, before any precise calculation or measurement is undertaken. | Physics (Estimation) | Order-of-magnitude bracketing | 20th c. | 7 | yes | yes | yes |
| feynman | `feynman.md` | 371 | Rederive from scratch to check your own understanding; explain it to a freshman to expose where you are bluffing; detect procedures that mimic the form of rigor without the substance. | Physics / Epistemology | Knowledge-integrity audit | 20th c. | 6 | yes | yes | yes |
| fisher | `fisher.md` | 335 | Design the experiment before running it; randomize treatment assignment to eliminate confounds; block on known sources of variation to reduce variance; replicate to estimate the remaining variance. | Statistics / Experimental Design | Pre-specified experimental design | 20th c. | 6 | yes | yes | yes |
| fleming | `fleming.md` | 291 | Maintain conditions in which unexpected results are visible; when an anomaly appears during routine work, do not clean it up — investigate it immediately. | Microbiology / Serendipitous Discovery | Prepared-environment anomaly capture | 20th c. | 4 | yes | yes | yes |
| foucault | `foucault.md` | 344 | When something appears natural, trace its history to expose its construction; when a category appears given, ask who created it and what it excludes. | Philosophy / History of Knowledge | Power-knowledge genealogy | 20th c. | 5 | yes | yes | yes |
| gadamer | `gadamer.md` | 351 | Understanding is not extraction of a fixed meaning from a text but a fusion of the text's horizon with the interpreter's horizon; interpretation is always a productive act, never merely reproductive. | Hermeneutics / Philosophy | Horizon-fusion interpretation | 20th c. | 5 | yes | yes | yes |
| galileo | `galileo.md` | 299 | Remove the non-essential variable to expose the essential law; slow down or simplify a fast/complex phenomenon until it can be directly observed and measured; replace qualitative intuition with quantitative measurement. | Physics / Scientific Method | Essential-variable isolation | 16th–17th c. | 5 | yes | yes | yes |
| geertz | `geertz.md` | 348 | A description that captures only behavior without the meaning-structures that make it intelligible is thin and useless; a description that captures both the behavior and the webs of significance is thick. | Cultural Anthropology | Thick description | 20th c. | 5 | yes | yes | yes |
| ginzburg | `ginzburg.md` | 336 | Marginal details that the source did not intend to reveal are more diagnostic than deliberate testimony; involuntary evidence outweighs self-presentation; a single deeply-investigated anomalous case can expose invisible structures. | History / Microhistory | Marginal-clue reading | 20th c. | 5 | yes | yes | yes |
| godel | `godel.md` | 344 | When a system is powerful enough to describe itself, it cannot fully verify itself from within; when consistency and completeness are both demanded, one must be sacrificed. | Mathematical Logic | Self-referential limit detection | 20th c. | 5 | yes | yes | yes |
| hamilton | `hamilton.md` | 387 | When the system is overloaded, shed lower-priority work so the critical work continues; when the operator does the wrong thing, the software is responsible; design for error rather than against it. | Aerospace Software / Mission-Critical Engineering | Priority-shedding and error-tolerant design | 20th c. | 6 | yes | yes | yes |
| hart | `hart.md` | 343 | When a general rule must be applied to a specific case, identify where the rule's meaning is clear and where it is uncertain; reason by analogy from precedent; balance competing rules through proportionality. | Jurisprudence / Legal Philosophy | Rule-application under ambiguity | 20th c. | 5 | yes | yes | yes |
| hopper | `hopper.md` | 395 | Let a compiler/translator/interpreter do the work of converting from the user's language to the machine's language; treat debugging as a first-class engineering activity; make abstract quantities tangible. | Computer Science / Programming Languages | Abstraction-level raising | 20th c. | 6 | yes | yes | yes |
| ibnalhaytham | `ibnalhaytham.md` | 352 | Before investigating, compile a detailed critique of what the received authority claims; test each claim against observation and internal consistency; vary one experimental condition at a time. | Optics / Scientific Method | Authority-critique then controlled experiment | 11th c. | 5 | yes | yes | yes |
| ibnkhaldun | `ibnkhaldun.md` | 337 | Before checking WHO said it, check if it's POSSIBLE given the constraints of the domain; model the lifecycle of group cohesion from founding vigor through success-induced decay. | Historiography / Sociology | Possibility-filter and cohesion-lifecycle modeling | 14th c. | 5 | yes | yes | yes |
| jobs | `jobs.md` | 391 | The product is the integrated experience, not the sum of its components; quality is defined and measured at the level where the user touches it; no integration boundary may be visible to the user as friction. | Product Design / Vertical Integration | Integrated-experience quality standard | 20th–21st c. | 6 | yes | yes | yes |
| kahneman | `kahneman.md` | 358 | When a decision is made fast and feels right, audit it for System 1 shortcuts; when a plan has no failure scenarios, run a pre-mortem; when an easy question was answered in place of a hard one, detect the substitution. | Behavioral Economics / Cognitive Psychology | Cognitive-bias audit | 20th–21st c. | 5 | yes | yes | yes |
| kauffman | `kauffman.md` | 347 | When a system is frozen, increase the coupling until structure becomes fluid; when a system is chaotic, reduce the coupling until structure crystallizes; the sweet spot is the edge of chaos. | Complexity Theory / Theoretical Biology | Edge-of-chaos tuning | 20th c. | 5 | yes | yes | yes |
| kay | `kay.md` | 320 | Defer decisions to the latest possible moment (late binding) so the system can adapt; communicate between components by messages, not by procedure calls; treat the programming environment itself as the primary artifact. | Computer Science / OOP (Smalltalk) | Late-binding message-passing design | 20th c. | 5 | yes | yes | yes |
| kekule | `kekule.md` | 302 | Deduce the structure of a system from its connection constraints; count the bonds (valence, arity, capacity, compatibility) and let the count force the shape. | Chemistry (Structural) | Constraint-counting structure deduction | 19th c. | 5 | yes | yes | yes |
| knuth | `knuth.md` | 316 | Profile before optimizing — measure where the time actually goes before touching the code; write code as literature for a human reader; analyze the algorithm's complexity before implementing it. | Computer Science / Algorithm Analysis | Measure-before-optimize discipline | 20th c. | 5 | yes | yes | yes |
| lamport | `lamport.md` | 405 | There is no global now; replace wall-clock time with a causality partial order; write a formal specification before the code; prove correctness as invariants, not as traces of example executions. | Distributed Systems / Formal Specification | Causality-ordering and formal-specification | 20th–21st c. | 6 | yes | yes | yes |
| laplace | `laplace.md` | 349 | Probability is not about randomness but about your state of knowledge; when new evidence arrives, update your beliefs using Bayes' theorem; make your priors explicit so they can be examined and challenged. | Mathematics / Probability (Bayesian) | Bayesian belief updating | 18th–19th c. | 5 | yes | yes | yes |
| lavoisier | `lavoisier.md` | 321 | Weigh everything in, weigh everything out; if the totals don't match, the residual is a real entity that must be found; seal the system so nothing escapes the accounting. | Chemistry (Conservation Laws) | Conservation-accounting | 18th c. | 5 | yes | yes | yes |
| leguin | `leguin.md` | 341 | When someone presents a utopia, find the hidden costs and name them; when a project is framed as a hero's journey, ask what the container narrative would reveal instead. | Literature / Philosophy | Trade-off excavation and narrative-frame audit | 20th c. | 5 | yes | yes | yes |
| lem | `lem.md` | 353 | Before predicting what a technology will do, enumerate the logical possibility space of what it COULD do; take every principle to its conclusion and see what breaks or emerges. | Science Fiction / Philosophy of Technology | Possibility-space enumeration | 20th c. | 5 | yes | yes | yes |
| liskov | `liskov.md` | 313 | The contract IS the interface — behavior, not just types; any subtype must be usable wherever the supertype is expected without the caller knowing the difference. | Computer Science / Type Theory | Behavioral-subtype contract verification | 20th c. | 5 | yes | yes | yes |
| mandelbrot | `mandelbrot.md` | 349 | When a system looks rough, irregular, or noisy, do not smooth it away — measure the roughness; when the same pattern appears at different scales, you are looking at a fractal. | Mathematics / Fractal Geometry | Scale-free structure detection | 20th c. | 5 | yes | yes | yes |
| margulis | `margulis.md` | 336 | When components within a system have their own replication logic or structural features that make no sense as de novo designs but perfect sense as inherited from an independent ancestor — the system is a merger, not a creation. | Biology (Endosymbiosis) | Merger-origin multi-evidence convergence | 20th c. | 5 | yes | yes | yes |
| maxwell | `maxwell.md` | 341 | When a system adjusts based on its own output, the critical question is not "does the feedback help?" but "is the feedback stable?" — because unstable feedback is worse than no feedback at all. | Physics / Control Theory | Feedback-stability analysis | 19th c. | 5 | yes | yes | yes |
| mcclintock | `mcclintock.md` | 373 | Observe a single specimen with the depth and patience that reveals structure; trust direct observation over aggregate statistics when they disagree; actively pursue anomalies that the field is discarding. | Biology / Genetics | Single-specimen deep observation | 20th c. | 6 | yes | yes | yes |
| meadows | `meadows.md` | 358 | Most people intervene at the weakest points in a system (tweaking parameters, adjusting buffers) when the strongest interventions are structural (changing information flows, rules, goals, paradigms). | Systems Dynamics | Leverage-point identification | 20th c. | 5 | yes | yes | yes |
| mendeleev | `mendeleev.md` | 366 | Take the known items, find the axes that make the regularity visible, tabulate, leave explicit gaps where the pattern demands an item you have not yet observed, predict the properties of the gap entries. | Chemistry (Periodic Table) | Regularity-axis identification and gap prediction | 19th c. | 6 | yes | yes | yes |
| midgley | `midgley.md` | 335 | When reasoning is stuck, the problem is usually not in the visible argument but in the invisible metaphors beneath it; when one domain claims to explain everything, it is committing intellectual imperialism. | Philosophy / Philosophy of Mind | Hidden-metaphor excavation | 20th c. | 5 | yes | yes | yes |
| mill | `mill.md` | 351 | When multiple cases exist, compare them systematically to identify which conditions produce the outcome; when someone says "X causes Y," demand the comparison that proves it. | Political Science / Logic (Comparative Method) | Systematic cross-case comparison | 19th c. | 5 | yes | yes | yes |
| nagarjuna | `nagarjuna.md` | 332 | Before choosing between two positions, check all four logical possibilities and ask whether the question itself is well-formed; before treating any entity as self-standing, trace the conditions it depends on. | Buddhist Philosophy / Logic | Tetralemma and dependency tracing | 2nd c. | 5 | yes | yes | yes |
| noether | `noether.md` | 364 | Before solving the dynamics, find the invariance group; every continuous symmetry of the action yields a conserved quantity; when stuck, ask what is invariant. | Mathematics / Theoretical Physics | Symmetry-to-invariant reduction | 20th c. | 6 | yes | yes | yes |
| ostrom | `ostrom.md` | 346 | When a shared resource is at risk of degradation, design governance institutions that match the resource's structure — with clearly defined boundaries, proportional costs and benefits, collective choice by the users. | Political Economy / Institutional Design | Commons governance design | 20th c. | 5 | yes | yes | yes |
| panini | `panini.md` | 346 | Build the minimal set of rules that generates every valid form and no invalid form; when rules conflict, resolve by explicit meta-rules, not by ad hoc exceptions. | Linguistics (Sanskrit Grammar) | Minimal generative rule-set construction | 4th c. BCE | 5 | yes | yes | yes |
| pearl | `pearl.md` | 346 | Correlation is not causation, and the formal machinery to distinguish them exists — use it; before claiming X causes Y, draw the causal graph and identify the identification strategy. | Statistics / Causal Inference | Causal-graph identification | 20th–21st c. | 5 | yes | yes | yes |
| peirce | `peirce.md` | 336 | When a surprising fact is observed, generate the hypothesis that would make it unsurprising; test the cheapest hypothesis first; all knowledge is provisional and revisable. | Philosophy / Logic (Pragmatism) | Abductive hypothesis generation | 19th–20th c. | 5 | yes | yes | yes |
| poincare | `poincare.md` | 346 | Before computing the answer, understand the shape of the problem — how many solutions exist, whether they are stable, how they change as parameters vary. | Mathematics / Topology | Qualitative structure-of-solution-space analysis | 19th–20th c. | 5 | yes | yes | yes |
| polya | `polya.md` | 340 | When stuck, do not push harder — step back and ask structured questions about the problem; when the direct path fails, work backward from the desired result. | Mathematics / Heuristics | Named-heuristic problem unsticking | 20th c. | 5 | yes | yes | yes |
| popper | `popper.md` | 332 | Before accepting any claim, ask what would refute it; before trusting any test, ask how hard it tried to fail; before committing to any plan, ask whether it can be tested in pieces. | Philosophy of Science | Falsifiability gating | 20th c. | 5 | yes | yes | yes |
| propp | `propp.md` | 342 | Every sequential process has a finite set of typed atomic functions; these functions follow a constrained order (a grammar); the actors who perform the functions are interchangeable (roles, not individuals). | Folklore / Structural Narratology | Sequential-process grammar extraction | 20th c. | 5 | yes | yes | yes |
| ramanujan | `ramanujan.md` | 398 | Generate many conjectures quickly by computing special cases, playing with notation until identities emerge — but only ever as conjectures, handed off to a prover-agent for validation. | Mathematics (Number Theory) | Rapid conjecture generation (prover-hand-off required) | 20th c. | 7 | yes | yes | yes |
| ranganathan | `ranganathan.md` | 341 | When users cannot find what they need, the classification is wrong, not the users; when a hierarchy forces items into one slot, use facets so items can be found from any dimension. | Library Science / Information Architecture | Faceted classification and five-laws audit | 20th c. | 5 | yes | yes | yes |
| rawls | `rawls.md` | 347 | When legitimate interests collide, design the rules as if you don't know which position you'll occupy; when inequalities exist, justify them only by their benefit to the worst-off. | Political Philosophy / Justice Theory | Veil-of-ignorance fairness design | 20th c. | 5 | yes | yes | yes |
| rejewski | `rejewski.md` | 356 | When a system's internals are hidden, model it algebraically from its input-output behavior; when conjugate structures share invariants, use those invariants to identify hidden state. | Cryptanalysis / Abstract Algebra | Algebraic behavioral reverse-engineering | 20th c. | 5 | yes | yes | yes |
| rogerfisher | `rogerfisher.md` | 337 | When parties are deadlocked on positions, excavate the underlying interests; when evaluating any deal, compare it to your best alternative (BATNA); when dividing value, first expand it. | Negotiation / Conflict Resolution | Interest-excavation and value-expansion | 20th c. | 5 | yes | yes | yes |
| rogers | `rogers.md` | 352 | When adoption stalls, segment the adopters to find where it stalled; when designing for adoption, optimize the five attributes that predict adoption rate; when crossing the chasm, change the message. | Diffusion of Innovations | Adoption-segmentation and attribute-optimization | 20th c. | 5 | yes | yes | yes |
| schelling | `schelling.md` | 352 | When individual behavior aggregates into collective outcomes, the macro pattern may be unintended and the opposite of what individuals wanted; when agents must coordinate without communication, they converge on focal points. | Economics / Game Theory | Micro-to-macro emergence and focal-point analysis | 20th c. | 5 | yes | yes | yes |
| schon | `schon.md` | 343 | When the situation talks back unexpectedly, the expert does not force the old frame — they reframe the problem; when the current approach has diminishing returns, the reflective practitioner switches strategies. | Education / Reflective Practice | Frame-reframing and strategy-switching | 20th c. | 5 | yes | yes | yes |
| semmelweis | `semmelweis.md` | 331 | Compare outcomes between matched groups; when the difference is large and unexplained, hypothesize a cause; test the hypothesis with a cheap intervention; implement it regardless of institutional resistance. | Medicine / Epidemiology | Matched-group anomaly intervention | 19th c. | 5 | yes | yes | yes |
| shannon | `shannon.md` | 371 | Find the right quantity, define it operationally, separate the independent layers of the problem, derive the limit before designing the method. | Information Theory | Quantity-definition and theoretical-limit derivation | 20th c. | 6 | yes | yes | yes |
| simon | `simon.md` | 349 | When the optimal solution is computationally intractable, define a satisficing threshold and stop searching when you cross it; test for near-decomposability before modularizing. | Cognitive Science / Decision Theory | Satisficing and near-decomposability analysis | 20th c. | 5 | yes | yes | yes |
| snow | `snow.md` | 359 | When something is spreading through a population, trace the source by mapping cases, comparing exposed to unexposed, and applying structured causal criteria to distinguish association from causation. | Epidemiology | Case-mapping source tracing | 19th c. | 5 | yes | yes | yes |
| strauss | `strauss.md` | 347 | When you have data but no theory, build the theory from the data itself through systematic coding, comparison, and sampling until no new categories emerge (grounded theory). | Sociology / Qualitative Research | Grounded theory construction | 20th c. | 5 | yes | yes | yes |
| taleb | `taleb.md` | 359 | When classifying a system, ask whether it breaks under stress (fragile), resists stress (robust), or improves from stress (antifragile); when improving a system, subtract fragilities before adding features. | Risk Theory / Philosophy | Antifragility classification and fragility subtraction | 21st c. | 5 | yes | yes | yes |
| thompson | `thompson.md` | 346 | Before explaining a system's form by design intent, check whether physical and mathematical constraints already determine it; when a system changes scale, predict what breaks by analyzing which quantities scale at different rates. | Biology / Mathematical Biology | Scale-law constraint analysis | 19th–20th c. | 5 | yes | yes | yes |
| toulmin | `toulmin.md` | 355 | Every argument has six parts — Claim, Data, Warrant, Backing, Qualifier, Rebuttal — and any argument missing a part is incomplete; any argument with an unsupported warrant is ungrounded. | Philosophy of Argumentation | Argument-structure visualization | 20th c. | 5 | yes | yes | yes |
| turing | `turing.md` | 317 | Reduce every problem to the simplest abstract machine that captures it; ask whether the problem is computable at all before asking how fast; use universality (one machine simulating any other) as a design principle. | Computer Science / Computability Theory | Computability-essence reduction | 20th c. | 5 | yes | yes | yes |
| varela | `varela.md` | 355 | When the observer cannot be separated from the system under study, run trained first-person observation and third-person measurement concurrently on the same phenomenon. | Cognitive Science / Neurophenomenology | First-person/third-person concurrent observation | 20th c. | 6 | yes | yes | yes |
| ventris | `ventris.md` | 347 | Analyze the structure of an unknown system without assuming what it means; build a constraint grid where observed patterns restrict possibilities; decouple structural analysis from semantic hypothesis. | Linguistics / Cryptography | Structure-first semantic-hypothesis-second decipherment | 20th c. | 5 | yes | yes | yes |
| vonneumann | `vonneumann.md` | 298 | When stuck in one domain, formalize the problem and look for an isomorphism to a solved problem in another domain; decompose adversarial situations via game theory; treat programs/strategies as first-class data objects. | Mathematics / Computer Science (Polymath) | Cross-domain isomorphism import | 20th c. | 5 | yes | yes | yes |
| vygotsky | `vygotsky.md` | 343 | Learning happens in the zone between what a person can do alone and what they can do with help; effective teaching is scaffolding that enables performance in this zone and is removed as competence grows. | Educational Psychology | Zone-of-proximal-development scaffolding | 20th c. | 5 | yes | yes | yes |
| wittgenstein | `wittgenstein.md` | 335 | When a problem resists solution, check whether the problem is real or whether it is created by language — the same word used in different contexts with different meanings, a category imposed where none fits. | Philosophy of Language | Language-generated confusion dissolution | 20th c. | 5 | yes | yes | yes |
| wu | `wu.md` | 345 | When predecessors assumed without testing, find the untested assumption; when "everyone knows" something is true, design the experiment to test it; when existing precision cannot distinguish between competing hypotheses, achieve the precision that can. | Physics (Experimental) | Assumption-gap verification | 20th c. | 5 | yes | yes | yes |
| zhuangzi | `zhuangzi.md` | 345 | Before optimizing within a framework, audit the framework itself; detect when the metric has become the enemy of the thing it measures; find value in what the current evaluation discards. | Chinese Philosophy (Daoism) | Framework-audit and metric-decoupling | 4th c. BCE | 5 | yes | yes | yes |

---

## Faceted Index

### By Domain (Personality facet)

| Domain | Agents |
|---|---|
| Biology / Natural Science | darwin, margulis, mcclintock, meadows, thompson, varela, kauffman |
| Chemistry | curie, kekule, lavoisier, mendeleev |
| Cognitive / Educational Psychology | bruner, ekman, kahneman, vygotsky |
| Computer Science | dijkstra, hopper, kay, knuth, lamport, liskov, turing, vonneumann |
| Economics / Game Theory | coase, schelling, simon, ostrom, rogerfisher |
| Epidemiology / Medicine | cochrane, feinstein, fleming, semmelweis, snow |
| History | braudel, ginzburg, ibnkhaldun |
| Information / Library Science | ranganathan |
| Linguistics / Decipherment | champollion, panini, ventris |
| Literature / Narrative | borges, bruner, leguin, lem, propp |
| Logic / Philosophy of Science | aristotle, gadamer, godel, ibnalhaytham, nagarjuna, peirce, popper, toulmin, wittgenstein |
| Mathematics | alkhwarizmi, archimedes, erdos, euler, noether, poincare, polya, ramanujan |
| Military / Strategy | alexander, boyd |
| Physics | carnot, einstein, fermi, feynman, galileo, maxwell, shannon, wu |
| Political Philosophy | arendt, foucault, hart, mill, rawls, rogers |
| Product / HCI | eco, engelbart, jobs, schon |
| Probability / Statistics | fisher, laplace, pearl |
| Queuing / Reliability | erlang |
| Risk / Complexity | mandelbrot, taleb |
| Semiotics / Cultural Studies | geertz, strauss |
| Social Systems / Cybernetics | bateson, beer, deming |
| Software Engineering | hamilton, midgley |
| Chinese / Buddhist Philosophy | nagarjuna, zhuangzi |

### By Era (Time facet)

| Era | Agents |
|---|---|
| Ancient (before 5th c.) | archimedes, aristotle, nagarjuna, panini, zhuangzi |
| Medieval (5th–14th c.) | ibnalhaytham, ibnkhaldun |
| Early Modern (15th–18th c.) | galileo, euler, lavoisier, laplace |
| 19th c. | carnot, champollion, darwin, kekule, mendeleev, mill, semmelweis, snow, thompson |
| 20th c. (majority) | arendt, alkhwarizmi (medieval but pattern applied 20th), altshuller, bateson, beer, borges, boyd, braudel, bruner, coase, cochrane, curie, deming, dijkstra, eco, einstein, ekman, engelbart, erdos, erlang, feinstein, fermi, feynman, fisher, fleming, foucault, gadamer, geertz, ginzburg, godel, hamilton, hart, hopper, jobs, kahneman, kauffman, kay, knuth, lamport, leguin, lem, liskov, mandelbrot, margulis, maxwell, mcclintock, meadows, midgley, noether, ostrom, pearl, peirce, poincare, polya, popper, propp, ramanujan, ranganathan, rawls, rejewski, rogerfisher, rogers, schelling, schon, shannon, simon, strauss, taleb, turing, varela, ventris, vonneumann, vygotsky, wittgenstein, wu |
| 21st c. | taleb (primary works 2001–2012), pearl (primary works 1988–2009 but considered 21st), lamport |

### By Reasoning Style (Energy facet)

| Style | Agents |
|---|---|
| Anomaly detection / serendipity | curie, ekman, fleming, ginzburg, mcclintock, semmelweis |
| Argument structure | aristotle, toulmin, popper |
| Bayesian / probabilistic updating | feinstein, laplace, pearl |
| Causal analysis | aristotle, pearl, mill, snow |
| Classification / taxonomy | mendeleev, ranganathan, panini |
| Complexity / emergence | bateson, beer, kauffman, mandelbrot, schelling |
| Conservation / accounting | carnot, lavoisier, noether |
| Correctness / formal proof | dijkstra, lamport, liskov, godel |
| Cross-domain transfer | champollion, ventris, vonneumann, rejewski |
| Design / composition | alexander, engelbart, jobs, kay |
| Estimation / bounding | archimedes, fermi, erlang |
| Experimental design | curie, fisher, galileo, ibnalhaytham, wu |
| Fairness / ethics | arendt, rawls |
| Frame / language audit | midgley, schon, wittgenstein |
| Grounded theory | strauss, geertz |
| Heuristic / problem-solving | polya, simon |
| Information / limit theory | carnot, shannon |
| Meta-framework audit | borges, foucault, godel, zhuangzi |
| Narrative analysis | bruner, leguin, propp |
| Negotiation / conflict | ostrom, rogerfisher, schelling |
| Pattern language | alexander |
| Queuing / capacity | erlang |
| Risk / fragility | mandelbrot, taleb |
| Scaffolded learning | vygotsky |
| Serendipity / anomaly | fleming, darwin |
| Strategic tempo | boyd |
| Systems / feedback | beer, deming, maxwell, meadows |
| Trade-off / constraint | altshuller, coase, thompson |
