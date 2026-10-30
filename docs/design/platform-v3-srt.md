# Plateforme v3 sous sandbox-runtime (srt) : document de conception

Statut : proposition, révision du 30 octobre 2026, amendée par la décision D-8 du propriétaire, par les deuxième et troisième revues externes (§1.2, §1.3), par la contre-expertise adversariale du 30 octobre (§1.4) et par les onze décisions du propriétaire du 2026-10-30, DC-1 à DC-11 (§1.5). Aucun code applicatif ni test n'est modifié par ce document. Le banc 1b.0 a tourné sur Linux et macOS : T-38, T-39, T-41 (§19.1), puis T-42, T-43, T-45 et leurs ajouts, 106 tests, run 41044838678, conclusion `failure` (§19.2). L'ordre d'exécution place d'abord l'outil de code isolé, brique 1a.0 (DC-10, §15), puis l'épinglage 1a.1 et ce qui reste de 1b.0.

Nom : `ai-architect.tools` reste la marque. `architect-os` est un **nom provisoire**, le choix définitif est suspendu par le propriétaire ; son isolation est décrite au §7.2 pour qu'un renommage reste mécanique.
Base : `feat/marketplace-srt` à `1746cc8`, amendée depuis `584ac03` ; banc 1b.0 et cette révision à `70a146f`. Cible : la vision « ai-architect.tools, architecture plateforme v3 » (29 octobre 2026), ci-après **v3** (`docs/design/platform-v3.html`, inchangé), amendée par les décisions du §1.

Conventions de preuve, appliquées à chaque affirmation technique :

- **[V: source]** : lu en source primaire (documentation officielle, `.d.ts` ou README de la version épinglée, fichier du dépôt).
- **[E-xx] / [T-xx]** : expérience exécutée en isolation, consignée au §20 avec commande et sortie, échecs compris.
- **[À PROUVER: T-xx, banc, brique]** : pas encore de preuve. Le test, le banc et la brique sont nommés ; rien de ce qui est ainsi marqué n'est livré avant que le test ait tourné.

Les expériences E-xx et T-xx de ce document ont d'abord tourné sur macOS 27 (`arm64`, Node 26.11.1, srt 0.0.81, MCP SDK 1.32.2, Agent SDK 0.3.312, Claude Code 2.1.312). Le banc 1b.0 (`bench/`, journal `bench/JOURNAL.md`) a ensuite tourné sur `ubuntu-24.04` et `macos-latest` : run https://github.com/cdeust/architect-os/actions/runs/41038015293 (conclusion `failure`, job Linux rouge), commit `b6fc924`, résultats au §19.1 et au §20, échecs compris. Le même banc, étendu à T-42, T-43, T-45, T-34 et FD-PIPES, a ensuite tourné au run https://github.com/cdeust/architect-os/actions/runs/41044838678 (commit `70a146f`, conclusion `failure`, §19.2). **Aucun appel réel à l'API Anthropic n'a eu lieu**, ni sur le poste ni sur le banc : le binaire Claude Code a parlé à un faux amont local, et le profil srt ne laissait passer que le broker du banc. Le banc Linux avait **trois échecs réels** (T-02e, T-02e2, T-07-fd0) au premier run ; il en a **cinq** au run 41044838678 (T-02e, T-02e2, T-07-fd0, T-34h, T-34i), et le banc macOS un, E-03-huge, qui est un défaut du banc et non de srt (§19.2). Tous sont conservés ; le premier essai Linux de E-07 (§20) est levé par ce banc.

---

## 0. Ce que cette révision change

| Avant (`1746cc8`) | Maintenant | Preuve |
|---|---|---|
| Protocole JSON lines maison entre `platformd` et les sandboxes | **Supprimé.** MCP stdio avec le SDK officiel pour l'executor, le worker et les modules ; le SDK garde son canal vers le binaire, dans la sandbox | E-01, E-02, E-04 |
| `platformd`, démon superviseur avec socket de contrôle et clé Anthropic | **Supprimé** (D-9). Une bibliothèque de lancement, port `SandboxRunner`, appelée par la seule gateway (§4.8), et une table de modules au format `.mcp.json` | E-02, E-05, E-06 ; [À PROUVER: T-47, Gherkin, brique 1b] |
| Clé masquée par srt (`mask` + `tlsTerminate`), repli broker | **Inversé** (D-10). Broker par task, seul détenteur de la clé Anthropic. Le masquage est écarté pour cette clé ; une autorisation de task, de faible valeur, remplace le port comme identité (§11.2) | T-04 (échec adversarial), E-05, T-23 ; T-42a à T-42g et T-43a, T-43b passent sur les deux OS avec un faux amont (run 41044838678, §19.2) ; T-43d et T-42h restent des constats (§11.2) |
| Worker Node dans la sandbox, stdin/stdout JSON, outils relayés en HTTP | **Worker entier sous srt** (D-8) : `query()`, handlers minces et binaire Claude Code dans la même sandbox. stdin/stdout portent MCP vers la gateway, sur le patron de l'executor. Plus de JSON maison ni de HTTP interne | E-02 pour le transport ; E-04, E-05 pour le SDK et le binaire ; [V: T-41, banc 1b.0, §19.1] |
| Modules `kind: data\|workflow` natifs | **Sous srt, en stdio, plugins compris** (D-8) | E-01 pour le transport ; [V: T-38, banc 1b.0, §19.1] |
| Profils de task propriétaires | Fichiers `agents/<nom>.md` au format Claude Code + profil srt JSON statique | E-04b, E-08 |
| Gabarits `{{runtime}}`, `{{repo}}` | **Supprimés.** Chemins relatifs à la task, `~` natif | T-02c à T-02i |
| `@cucumber/cucumber` 13.3.0 | **12.9.0**, 13.x casse le runner Stryker | T-14 |
| « Validation » d'un budget ou d'un jeton à l'entrée de la gateway | Réservation atomique en base ; jeton d'appel vérifié par le module | T-20, T-21 |
| Repli srt : un port, srt comme unique adaptateur (D-11) | **Un port, deux adaptateurs** (DC-1) : srt d'abord, OCI/Docker seulement là où srt n'est pas supporté, choisi par configuration explicite, canari fermé à l'échec | Contre-expertise §3 ; [À PROUVER: T-41D, T-38D, T-06D, T-34D, T-43D, banc Docker sur `ubuntu-24.04`] |
| `settle` : verrou de la réservation, puis du budget ; « aucun 40P01 » | **Verrou de `budgets` d'abord**, ordre uniforme (DC-3) ; interblocage `reserve(X)` rejoué × `settle(X)` reproduit | `fable/pg` ; T-45k ne le couvrait pas ; [À PROUVER: T-45 rejoué sur le SQL amendé, T-45l] |
| Copie du builder non définie (§9.2) | Clone `--no-hardlinks`, jamais un worktree ; sortie par bundle ; l'hôte ne lance rien dans la copie (DC-2) | `fable/git` ; T-34h et T-34i restent `fail` sous Linux |
| Stage 0 : paquet `@architect-os/stage0` | **Outil de code isolé** = stage 0 simplifié, brique 1a.0 avant le reste de 1a (DC-10) ; le premier stage 0 est construit hors sandbox | §14, §15 |

## 1. Décisions du propriétaire appliquées

| # | Décision | Où elle s'applique ici |
|---|---|---|
| D-1 | Tout ce qui était conteneur Docker devient un processus sandboxé par `@anthropic-ai/sandbox-runtime` 0.0.81. Le superviseur de processus devient une bibliothèque sans démon (D-9) | §4, §9 |
| D-2 | Marketplace à la racine (`.claude-plugin/marketplace.json`, plugins sous `plugins/<nom>/`) | §7, §8 |
| D-3 | Gateway séparée (auth, profils, DAG, budgets, jetons, `max_result_tokens`, registre, méta-tools). Couches en processus séparés | §4, §11 |
| D-4 | Par tool : `kind: workflow` dès que le comportement est stable ; `kind: agent` sinon, le worker entier toujours sous srt (D-8) | §10 |
| D-5 | Postgres 17 natif (BM25, `float[]`, pgvector installé mais désactivé) | §4, §17 O-11 |
| D-6 | Porte de merge = résultat des tests ; exécutés = base + ajoutés − supprimés, dérivé du diff ; aucune validation par hash des sorties de build | §13, §14 |
| D-6a | Seuls des tests Gherkin prouvent une CI, e2e et unitaire | §13 |
| D-6b | Trois familles font foi : e2e Gherkin, unitaires Gherkin, mutation | §13 |
| D-6c | Mutation : 0 survivant sur le code modifié, équivalents marqués seuls tolérés | §13.6 |
| D-7 | Brique 0 (baseline M1/M2) reportée ; seuils v3 non bloquants jusqu'à la mesure du propriétaire | §15 |
| O-1 | **Décidée.** Porte en `pull_request_target`, code de porte et `cucumber.mjs` pris sur la base, tests pris sur le merge | §13.8 |
| O-2 | **Décidée.** `CLAUDE.md` du dépôt amendé (brique 1a) pour autoriser le diff des `.feature` du commit de merge contre son premier parent | §13.5 |
| O-3 | **Décidée.** « Aucun hash » vise la validation des sorties de build. Hors portée : intégrité npm du lockfile, SHA de commit utilisés comme identifiants | §12 |
| O-14 | **Décidée.** cucumber-js partout, vitest retiré | §13.2 |
| D-8 | **Aucune exécution hors du conteneur : un conteneur v3 = un processus srt.** Chaque module data ou workflow, plugins compris, et le worker agent entier tournent sous srt. Exceptions nommées et prouvées : gateway, broker, data, Postgres | §4.7 |
| D-9 | `platformd` retiré (ancienne O-20, validée par le propriétaire) | §4.6, §4.8 |
| D-10 | Broker dédié, seul détenteur de la clé (ancienne O-18bis, validée avec la deuxième revue) | §11.2 |
| D-11 | Repli srt : un seul port d'exécution, critères de déclenchement écrits, candidats évalués sans décision. **Amendée par DC-1** : srt n'est plus l'unique adaptateur, un adaptateur OCI/Docker s'y ajoute | §4.11 |

### 1.1 Deux constats de la première revue externe refusés par le propriétaire

| Refus | Raison | Risque résiduel |
|---|---|---|
| Aucune comparaison de digests entre build-1 et build-2 | D-6 : seule la porte de tests fait foi. La garantie de stage 0 est nommée pour ce qu'elle est (§14) | Une différence entre les deux builds qu'aucun scénario n'observe reste invisible, et la reproductibilité binaire n'est pas établie |
| Mutation à 0 survivant sans seuil différent par composant | D-6c : une règle unique, sans négociation par composant | Coût concentré sur les fichiers souvent modifiés et sur le code mal couvert, borné par le périmètre de diff. Mesuré : M-01, §13.6. Un équivalent mal justifié peut passer la forme, et seule la revue le juge (C-11) |

### 1.2 Deuxième revue externe

| Constat | Sort | Traitement |
|---|---|---|
| Le port du broker n'est pas une identité (P0) | **Accepté** | Autorisation de task sans secret lisible par le modèle, §11.2. Test du processus natif étranger : T-43 |
| Une PR peut produire un rapport vert sans assertion (P0) | **Accepté, joué : la PR passe** | T-44 au §20. I-8 reformulé (§11.5), résidu au §13.8. Pas de refonte de la CI |
| Budgets : réservation identifiée, idempotente, états persistés (P1) | **Accepté** | §4.5 |
| Handlers : Zod protège la structure, pas la sémantique (P1) | **Accepté** | §4.10 |
| Ordre : banc Linux 1b.0 avant la migration complète 1a | **Accepté** | §15, critères de sortie inchangés |
| « Agent SDK hors sandbox, cohérent » | **Rejeté par le propriétaire** (D-8) | Le SDK tourne dans la frontière. Anthropic le dit aussi : l'application Agent SDK « runs inside the isolation boundary » [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment#isolation-technologies] |
| Pas de digest, 0 mutant survivant, retrait de `platformd` | **Conservés** | §1.1, §13.6, D-9 |

### 1.3 Troisième revue externe

Écrite sans les résultats du banc 1b.0. Chaque constat a été vérifié contre le texte de la révision précédente avant intégration.

| Constat | Vérification dans le texte | Sort | Traitement |
|---|---|---|---|
| §4.5 budgets (P0) : `UPDATE budgets` puis `INSERT … ON CONFLICT DO NOTHING` peut retenir le budget alors que l'insertion est ignorée ; `budget.settle` rejouable | **Exact, par lecture du SQL** (ancien §4.5, `budget.reserve` : le `NOT EXISTS` lit l'instantané de l'instruction, deux appels au même `reservation_id` passent tous deux avant l'insertion, le second `INSERT` est ignoré après que l'`UPDATE` a retenu le montant ; `budget.settle` : ni identifiant de réservation, ni garde d'état, montant et coût pris des paramètres). Défaut **non rejoué** : T-45 jouera l'ancien SQL comme témoin | **Accepté** | SQL réécrit en une transaction, §4.5 ; non prouvé jusqu'à T-45 |
| §10 (P1) : `egress: [gateway]` et `egress: none` dans le même manifeste, alors que la règle impose l'égalité de `egress` avec le réseau du profil | **Exact** : l'exemple `memory-recall` portait les deux, et `codebase-ask` portait `egress: [broker]` | **Accepté** | `egress` = sortie externe seule ; accès interne = champ `internal_access`, §10 et §9.2 |
| §11.2 (P1) : la garantie du broker reposait sur le retrait de la clé dans les réponses | **Exact** : « le broker retire la clé des réponses » était présenté comme le mécanisme ; une valeur transformée, encodée, fragmentée ou répartie dans un flux SSE échappe à un retrait | **Accepté** | Garantie reformulée en amont ; retrait = défense supplémentaire ; T-42 conservé, §11.2 |
| Le broker devrait tourner sous la même frontière srt que le worker | La revue a été écrite sans les résultats du banc | **Non retenu** : contraire à D-8 (le broker est une des quatre exceptions natives, détenteur de la clé), à T-07 et à T-39b (un processus sous srt ne sert pas un listener joignable par l'hôte : macOS `EPERM`, Linux `ECONNREFUSED` côté hôte) | Le broker reste natif ; T-41 a été prouvé ainsi sur les deux OS |

**État réel au 30 octobre 2026.** T-41 et T-38 sont passés (§19.1). T-42, T-43 et T-45 ont été joués au run 41044838678, sur un faux amont et un Postgres 17 réel (§19.2) ; le SQL amendé de `settle` (DC-3) reste à rejouer. Ordre demandé par la revue : 1a.1, puis la suite de 1b.0 ; le §15 y ajoute la brique 1a.0 avant tout (DC-10).

### 1.4 Contre-expertise adversariale du 30 octobre 2026 : vérification

Rapport hors dépôt (`scratchpad/fable/rapport-contre-expertise.md`, expériences reproductibles dans `fable/git`, `fable/pg`, `fable/e03`, `fable/lat`). Périmètre : ce document, `bench/`, `services/memory/src/infrastructure/docker-runner.ts`, `.github/workflows/*`, `CLAUDE.md` et les deux rapports JSON du run 41044838678. Limites déclarées par le rapport : srt sous Linux n'est pas testable dans la VM Colima locale (`kernel.apparmor_restrict_unprivileged_userns = 1`, aucun sysctl modifié), donc tout ce qui concerne srt sous Linux vient des JSON du banc CI ; aucune clé lue, aucun appel à l'API Anthropic. Chaque constat ci-dessous a été revérifié ici dans les JSON ou le rapport avant intégration.

| # | Constat | Verdict du rapport | Traitement |
|---|---|---|---|
| 1 | T-34h/i : l'hôte n'exécute rien de la copie, récupère par bundle | Valide avec correction : copie jamais worktree ni clone par liens durs ; mécanisme de copie absent du document | DC-2, §9.2 |
| 2 | T-43d : accepté en local, uid dédié sur serveur | Valide avec correction : périmètre lisible = hôte seulement ; T-43e à ajouter | DC-5, §11.1 |
| 3 | T-42h : accepté en attendant T-04R | Valide avec correction : le broker ne relaie jamais `/v1/oauth/*` | DC-6, §11.2 |
| 4 | Ordre des verrous | Valide, et la prémisse « aucun 40P01 » est réfutée (`40P01` reproduit) | DC-3, §4.5 |
| 5 | SQL témoin et `pg` dans `bench/` | Valide avec correction : `bench/` hors production, source unique du SQL en fichier `.sql` | DC-8, DC-3 |
| 6 | `ci.yml` épinglé par SHA | Valide avec correction : quatre workflows, dont deux avec un secret OAuth ; `main` non protégée | DC-4, §13.8 |
| 7 | Statut du banc : « brut » contre profil | Valide avec correction : T-34h/i échouent avec la règle active ; E-03-huge est un défaut du banc | DC-7, §19.2 |
| 8 | Portée Docker, option (a) | Valide avec corrections | DC-1, §4.11 |
| 9 | Outil de code avec le compte Claude du propriétaire | Valide avec corrections | DC-9, DC-10, §11.2, §15 |

### 1.5 Décisions du propriétaire du 2026-10-30 après la contre-expertise

Numérotées DC-1 à DC-11 ici pour ne pas les confondre avec D-1 à D-11 ci-dessus (ce sont D1 à D11 dans la demande du propriétaire). **Toutes sont décidées.**

| # | Décision | Où elle s'applique |
|---|---|---|
| DC-1 | Adaptateurs : srt d'abord, Docker seulement là où srt n'est pas supporté. Un port `SandboxRunner`, deux adaptateurs (srt, OCI/Docker ; Docker testé en premier, Podman ensuite par les mêmes flags), même signature fermée, même suite Gherkin. Amende D-11, §4.11 (« aucun second adaptateur »), T-52 (garde étendue : `child_process`, srt et docker seulement dans `packages/sandbox`) et les briques 1b.5 et 1b.6 : `docker-runner.ts` devient la lignée de l'adaptateur OCI. Le socket Docker n'est monté dans aucun conteneur, mode rootless visé. Choix par configuration explicite, jamais de bascule automatique ; test canari au démarrage, fermé à l'échec (`ISOLATION_UNAVAILABLE`) | §4.8, §4.11, §11.3, §15 |
| DC-2 | Copie du builder : clone `--no-hardlinks`, jamais un worktree. Sortie par bundle produit dans la sandbox, `git fetch <bundle>` côté hôte avec `fetch.fsckObjects=true`. L'hôte ne lance rien dans la copie et ne l'ouvre dans aucun outil ; `npm ci --ignore-scripts`. Nommage et `denyWrite` restent une défense en profondeur, liés à T-34h et T-34i, qui restent `fail` sous Linux tant que le scénario de copie n'est pas prouvé | §9.2, §11.3 |
| DC-3 | SQL §4.5 : `settle` verrouille `budgets` d'abord, ordre uniforme partout. « Aucun 40P01 » corrigé ; T-45l ajouté comme témoin ; source unique en `data/sql/*.sql` à partir de 1b.3. Le SQL amendé n'a pas encore passé T-45 | §4.5, §15 |
| DC-4 | Workflows : les quatre épinglés par SHA (`ci.yml`, `claude.yml`, `claude-code-review.yml` ; `bench-sandbox.yml` déjà fait), `--ignore-scripts` dans `ci.yml`, protection de `main` avec la porte requise avant 1a.8. Lecture de `docs/security.md` de `claude-code-action` avant 1a, à cause du secret `CLAUDE_CODE_OAUTH_TOKEN` | §12, §13.8, §15 |
| DC-5 | T-43d accepté en local mono-utilisateur, uid dédié à la plateforme sur serveur ; le §11.1 nomme « poste du propriétaire, un seul uid » ; T-43e ajouté | §11.1, §11.3 |
| DC-6 | T-42h accepté jusqu'à T-04R. Le broker ne relaie que `/v1/messages`, jamais `/v1/oauth/*` | §11.2 |
| DC-7 | Banc : résultat brut attendu par OS, changement signalé dans les deux sens, T-34h et T-34i restent rouges, E-03-huge est un défaut du banc à corriger, T-34h-variante (`hooks` non vide) à ajouter ; §4.8 reformulé : « descripteurs créés par l'adaptateur, jamais hérités » | §4.8, §19.2 |
| DC-8 | `bench/` est hors production : à écrire dans `CLAUDE.md` lors de l'amendement O-2 de 1a, avec une garde interdisant d'importer `bench/` depuis un workspace | §15 (1a.6) |
| DC-9 | Compte Claude du propriétaire pour l'outil de code personnel : broker détenteur du jeton OAuth et de son rafraîchissement, mode `Authorization: Bearer`, aucun identifiant dans la sandbox, aucun relais OAuth. Clé API obligatoire dès que la plateforme sert quelqu'un d'autre | §11.2 |
| DC-10 | Outil de code isolé et stage 0 : ce système simplifié est le stage 0. Brique 1a.0, tirée de 1b.1 et placée avant le reste de 1a. Le reste de 1a et 1b se construit à l'intérieur de cet outil. Le premier stage 0 est construit hors sandbox | §14, §15 |
| DC-11 | O-31 reportée à la brique D, avec un test de Docker/Podman rootless sans sysctl | §17, §15 (D) |

## 2. Trois piliers

| Pilier | Statut |
|---|---|
| I. Recherche reproductible | **Fait** : sources Anthropic lues (§16), bancs exécutés avec échecs consignés (§20), expérience adversariale T-44, test de pérennité daté (§4.11), contre-expertise adversariale avec expériences reproductibles (§1.4), run 41044838678 lu dans les JSON (§19.2). **Prévu brique 1a.1 puis 1b.0** : les expériences du §20 deviennent `features/sandbox/*.feature`, rejouées sur Linux et macOS, une commande, avant la migration complète. **Prévu brique 1a** : `npm run gate` rejoue la porte en une commande. **Prévu briques 2 et 3** : M1, M2 et R relevés, non bloquants (§15.1). **Prévu brique 0, reportée par D-7** : baseline des vingt tâches |
| II. SSDLC | **Fait** : STRIDE mis à jour pour chaque changement de topologie (§11.3), étendu à l'adaptateur OCI, à la copie du builder, au jeton OAuth et aux actions de CI (DC-1, DC-2, DC-9, DC-4), supply chain et `npm audit` (§12). **Prévu brique 1a** : SAST = porte Gherkin + mutation, limite écrite (I-8). **Prévu briques 1b.0 et 1b.7** : DAST = suite d'évasion contre de vrais processus srt (§11.4), test du natif étranger (T-43), rejouée à chaque montée de version de srt |
| III. Opérationnel | **Fait** en conception : moindre privilège par profil (§9), aucune exécution hors du conteneur hors quatre exceptions prouvées (§4.7), aucun secret dans une sandbox de modèle (§4.2), modèle de confiance écrit (§11.1) ; la contre-expertise et cette révision n'ont lu aucun secret (les secrets de workflow ne sont cités que par leur nom). **Prévu brique 1b** : invariants du §11.5 prouvés sur les deux OS. **Sans objet** pour l'IRB tant qu'aucune donnée humaine ou stratégique n'est traitée ; réévalué en brique 4 si memory reçoit des données personnelles |

## 3. Écarts vs v3

| Élément v3 | Version srt | Raison |
|---|---|---|
| `compose.yaml` « identique laptop et serveur » | `topology/modules.mcp.json` au format `.mcp.json` : chaque module y est `type: stdio`, `command: srt` ; seuls `broker` et `data` sont déclarés natifs, le schéma refuse tout autre. Mêmes processus, sémantiques OS différentes (Seatbelt, bubblewrap) | D-1, D-8. Format de Claude Code [V: https://code.claude.com/docs/en/mcp]. Un module `type: http` est refusé par schéma : T-39b montre qu'un module sous srt ne peut pas servir en HTTP à la gateway (macOS : `EPERM` ; Linux : `listen` accepté, mais l'hôte reçoit `ECONNREFUSED`) |
| [1] Reverse proxy | Hors plateforme, serveur seulement, un `Caddyfile` descriptif ; aucun code n'en dépend | §5.1 |
| [2] Gateway en conteneur | Processus natif ; ne peut pas tourner sous srt | T-07 : fd ≥ 3 non transmis sur les deux OS ; `listen` sur fd 0 refusé sur macOS, **mais utilisable sous Linux (T-07-fd0, échec)** ; T-39b |
| [3] Executor, pool chaud | `srt -- node executor.js`, réseau nul, client MCP sur ses stdin/stdout ; le serveur en face est la gateway | E-02 ; T-10 : surcoût de lancement 211 ms |
| Conteneurs de task | Worker entier sous srt : `srt -- node worker.js`, avec `query()`, handlers minces et binaire Claude Code ; profil `agents/<nom>.md` + `<nom>.srt.json` | D-8 ; E-04, E-05 ; [V: T-41, banc 1b.0, §19.1] |
| [4] Modules en conteneur (légende v3 §2 : « les autres conteneurs sont des workflows déterministes ») | Un processus srt par module, en stdio, plugins compris. Le `containers: []` de v3 §6 visait le conteneur de task, pas le module | D-8 ; E-01 ; [V: T-38, banc 1b.0, §19.1] |
| [5] Structurer, Judge, Embedder en conteneur | Modules workflow sous srt, placés au §4.7, décidés en brique 8 | D-8 |
| Orchestrateur, « clés API injectées par task » | **Aucune clé dans une task.** Broker hors sandbox, un listener et une autorisation par task | T-04, E-05, T-23, T-42 (deux OS, §19.2) ; [À PROUVER: T-04R] ; [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment#the-proxy-pattern] |
| « Jeton par task, révoqué à l'annulation » | Jeton d'appel Ed25519 vérifié par le module cible. L'executor et le worker n'en détiennent aucun ; un module sous srt détient seulement celui de son appel en cours | T-21, §4.4 |
| `--memory`, `--pids-limit` | Linux : `systemd-run --scope` autour de `srt`, sans script. macOS : aucune limite par sandbox, résidu assumé | T-09, §11.1 |
| Postgres en conteneur | Natif, `listen_addresses=''`, `peer` sur socket Unix | E-09 : 119/119 sur ce montage |
| Plugins + dépôt `marketplace` séparé | Marketplace à la racine, plugins clients sous `plugins/`, modules serveur sous `modules/` | D-2, O-10 |
| Manifeste `containers:` | `sandboxes:` (profil, écritures, modèle, budget) | D-1 |
| `stage0/Dockerfile`, `fixpoint.sh` « digests comparés » | Paquet npm `@architect-os/stage0` épinglé, aucun shell | D-6, §14 |
| `platform-build.yml` dans le conteneur stage 0 | `gate.yml` : porte Gherkin + mutation, Linux **et** macOS | D-6, §13 |
| `agent-approval-check`, `spec-lint` requis | Seule la porte est requise ; `spec-lint` devient un scénario | D-6, C-9 |
| Runner auto-hébergé pour tout | Workflows Claude seulement ; la porte tourne sur runners hébergés | §13.8 |
| D-1 : « tout ce qui était conteneur Docker devient un processus srt » | Exception décidée (DC-1) : un adaptateur OCI/Docker du même port, seulement là où srt n'est pas supporté, par configuration explicite. Aucun conteneur ne reçoit la socket Docker | §4.11 |

## 4. Topologie

### 4.1 Figure

```
              client (Claude Code / Codex / claude-code-action)
                        |  MCP http ; 127.0.0.1 sur un poste, TLS par le déploiement sur un serveur
                        v
 ---------------- hôte : quatre exceptions NATIVES, chacune prouvée (§4.7) -------------
 [gateway]   écoute 127.0.0.1:8080 ; seul point de politique ; seul parent des sandboxes
             auth, profils, DAG calls_allowed, budgets, registre, max_result_tokens
             SandboxRunner : seule autorité de lancement, entrées fermées (§4.8) ; adaptateurs srt et OCI (§4.11)
             un serveur MCP par sandbox, posé sur les flux stdio de l'enfant
             détient : clé privée Ed25519 des jetons d'appel, table des clients
             ne contient ni pg, ni Agent SDK, ni clé Anthropic
 [data]      seul importeur de pg ; opérations typées en tools MCP ; budgets et capacité
             -> socket Unix Postgres, authentification peer, aucun mot de passe
 [postgres 17]  listen_addresses='' ; pg_hba : local peer
 [broker]    seul détenteur de la clé Anthropic ; un listener par task ; POST /v1/messages seul ;
             chaque requête porte l'autorisation de sa task (§11.2) ; réserve puis réconcilie
 ---------------------------------------------------------------------------------------
      | MCP stdio uniquement (fd 0-2) ; srt ne transmet aucun autre descripteur [T-07]
      v
 ---------------- processus SOUS srt -------------------------------------------------
 srt --settings executor.srt.json -- node executor.js                    (1 par session)
    réseau : AUCUN ; client MCP sur stdin/stdout ; aucun secret, aucun jeton
 srt --settings module-<nom>.srt.json -- node module.js   (1 par module data|workflow)
    memory-recall, code-index, verify, manifest-registry, plugins, Structurer, Judge
    serveur MCP sur stdin/stdout ; egress : aucun ; accès interne : gateway par le proxy srt, rien d'autre
 srt --settings scout.srt.json -- env -u NO_PROXY -u no_proxy node worker.js (1 par task)
    query(), handlers minces, binaire Claude Code enfant ; client MCP sur stdin/stdout
    egress : aucun ; accès interne : broker de CETTE task seul ; aucune clé ; lecture : "." ; ./repo en lecture seule
 srt --settings builder.srt.json …           écriture : copie jetable ".", clone --no-hardlinks (§9.2)
 srt --settings zetetic-reviewer.srt.json …  lecture de ./repo et du diff ; écriture "."
 srt --settings web-scout.srt.json -- node web-scout.js   décidée (propriétaire, 2026-10-30, O-27)
    allowlist du manifeste, plages privées refusées, sans modèle
 srt --settings db-migrator.srt.json -- …                 décidée (propriétaire, 2026-10-30, O-28)
    Postgres jetable dans la sandbox, sans modèle, aucun accès à la base réelle
 --------------------------------------------------------------------------------------
 Proxys srt : un couple HTTP/SOCKS par processus srt, côté hôte
```

### 4.2 Qui détient quel secret

| Secret | Détenteur | Jamais présent dans |
|---|---|---|
| Clé Anthropic (runtime) | `broker` seul, lue depuis un fichier 0600 sous `~/.architect-os/` | gateway, data, sandboxes (ni clé, ni sentinelle de cette clé) |
| Jeton OAuth du compte du propriétaire et son rafraîchissement (outil de code, poste, DC-9) | `broker` seul, fichier 0600 propre au broker (le rafraîchissement le réécrit) | gateway, data, sandboxes, `CLAUDE_CONFIG_DIR` d'une task ; jamais relayé (`/v1/oauth/*` refusé) |
| Autorisation de task (§11.2) | broker, gateway le temps du lancement, proxy srt de la task côté hôte | sandbox : le modèle ne voit qu'une sentinelle |
| Clé privée Ed25519 des jetons d'appel, table des clients | gateway | modules (clé publique seule), sandboxes |
| Jeton d'appel | gateway et module cible sous srt, le temps d'un appel | executor, worker agent |
| Identifiants Postgres | aucun : `peer` sur socket Unix [E-09] | partout |
| Clé TLS du serveur | déploiement (§5.1) | plateforme |
| CI : `GATEWAY_CI_TOKEN` | secret GitHub du workflow Claude | porte de tests |
| CI : accès Anthropic | fédération OIDC, `id-token: write` [V: https://code.claude.com/docs/en/github-actions#set-up-for-an-organization] | dépôt |

Une sandbox de modèle n'a donc **aucun secret à voler**. Un module sous srt ne détient que le jeton de son appel en cours, limité à cette audience, ces capacités et cette échéance. Le risque résiduel est l'usage du broker pendant la task : une sandbox compromise peut consommer son propre budget, pas celui d'une autre, et pas lire la clé.

### 4.3 Un seul patron de canal, aucun protocole maison

**Executor, code mode (E-02).** L'enfant est **client** MCP sur ses propres stdin/stdout, la gateway est **serveur** sur les flux stdio de l'enfant. Aucune ligne de protocole à écrire, parce que `StdioServerTransport` est un `Transport` symétrique et accepte deux flux quelconques [V: `@modelcontextprotocol/sdk` 1.32.2, `dist/esm/server/stdio.d.ts`].

```ts
// gateway : un serveur par sandbox ; l'identité de la task est la fermeture du handler
const sandbox = await runner.start({ profile: 'executor', task: taskId });   // SandboxRunner, §4.8
const server = new McpServer({ name: 'host', version });
registerToolsOfProfile(server, taskId);
await server.connect(new StdioServerTransport(sandbox.stdout, sandbox.stdin, { maxBufferSize }));

// sandbox : aucun code de protocole
const client = new Client({ name: 'task', version });
await client.connect(new StdioServerTransport());
```

Les trois messages JSON lines disparaissent : `start` devient le tool `task_input`, `call` devient `tools/call`, `output` devient `task_complete`. Ces tools vivent sur les flux stdio de l'enfant, jamais dans le catalogue du client. Résultats : 1 000 allers-retours en 45 ms sous srt contre 38 ms sans, charge de 8 Mio passée, deux tasks concurrentes sans mélange, `tools/list` limité au profil, tool hors profil refusé. Un `_meta.task` forgé par l'enfant est ignoré, la gateway ne lit que la fermeture [E-03]. Un enfant hostile qui écrit du faux JSON ou une ligne de 11 Mio produit une erreur de transport, l'hôte reste vivant [E-03]. Le sens standard (hôte client, enfant serveur) marche aussi [E-01] et sert aux modules, qui exposent des tools ; il ne permet pas à l'enfant d'appeler des tools : MCP ne prévoit de requêtes serveur vers client que pour l'échantillonnage, l'élicitation et les racines. D'où le sens inversé pour l'executor et le worker, et le rappel de la gateway par le proxy srt pour un module (T-38).

**Agents, même patron.** Le worker entier est l'enfant : `query()`, ses handlers et le binaire Claude Code que le SDK lance tournent dans la sandbox. Il est client MCP de la gateway sur ses stdin/stdout, le SDK garde ses propres tubes vers le binaire. Chaque handler de `createSdkMcpServer` ne fait que relayer vers la gateway. E-04 et E-05 prouvent le SDK, le binaire et le broker sous srt, E-02 prouve le transport ; leur réunion dans une seule sandbox a tourné au banc 1b.0 sur Linux et macOS, avec un faux amont et une seule couche srt (T-41a à T-41d, §19.1). Limites : aucun appel réel à Anthropic (T-04R reste à jouer en 1b) ; T-41 a utilisé `allowedDomains: ["127.0.0.1:<port>"]` vers le broker du banc, pas l'autorisation de task, donc il ne prouve rien du mécanisme de T-42.

```ts
// worker.ts, sous srt : aucun secret, aucun canal hors stdio et le broker
const host = new Client({ name: 'worker', version });
await host.connect(new StdioServerTransport());
const { prompt, limits } = await taskInput(host);              // pris par l'enfant, jamais par argv
const relay = toolsOfProfile.map((t) => tool(t.name, t.description, t.shape,
  (args) => host.callTool({ name: t.name, arguments: args })));   // handler mince : aucun effet local
for await (const m of query({ prompt, options: {
  agent: 'scout', agents: loadAgents('agents/'),   // §9.1
  mcpServers: { platform: createSdkMcpServer({ name: 'platform', tools: relay }) },
  tools: […], allowedTools: […], permissionMode: 'dontAsk', settingSources: [], strictMcpConfig: true,
  persistSession: false, maxTurns: limits.turns, maxBudgetUsd: limits.usd,
  env: { PATH, HOME, ANTHROPIC_BASE_URL: `https://broker.localhost:${leasePort}`,
         ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,     // sentinelle srt, §11.2
         CLAUDE_CONFIG_DIR: '.cfg', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
}})) { if (m.type === 'result') await complete(host, m); }      // task_complete ; la gateway valide
```

Dans le code actuel, `internal-http.ts` et l'API `/internal/<tool>` disparaissent ; `internal-tools.ts` devient le client MCP ci-dessus ; `worker/main.ts` et `run-worker.ts` gardent le worker, sans JSON maison ; `docker-runner.ts` devient l'adaptateur srt. `spawnClaudeCodeProcess` n'est plus utilisée : c'était une option présente dans `sdk.d.ts` seulement, et la conception n'en dépend plus.

Pourquoi srt autour du worker et non l'option `sandbox` du SDK : le sandbox intégré ne couvre que Bash et ses enfants, les tools intégrés, MCP et les hooks restent dehors [V: https://code.claude.com/docs/en/sandboxing#what-runs-outside-the-sandbox]. Le runtime, lui, « wraps an entire process », MCP et hooks compris, et sert aussi aux serveurs MCP autonomes [V: https://code.claude.com/docs/en/sandbox-environments#sandbox-runtime].

### 4.4 Jetons d'appel

Chaque appel relayé par la gateway porte un jeton Ed25519 signé pour cet appel : `{ aud, task, cap, exp, budget, jti, parent }`, soit module cible, tâche, tools permis, échéance de l'appel, réservation budgétaire, identifiant unique, appel parent. Le module vérifie signature, audience, capacité, expiration et unicité du `jti` avec la **clé publique seule** [T-21 : autre module, hors capacité, expiré, rejeu et task falsifiée refusés ; 0,10 ms à l'émission, 0,20 ms à la vérification]. Le jeton voyage dans `_meta` du `tools/call`. L'executor et le worker n'ont aucun jeton : leur identité est la fermeture du handler, et la gateway émet un jeton neuf par appel, ce qui règle la question d'un script qui fait N appels. Un module qui rappelle la plateforme présente le jeton de son appel en cours à `127.0.0.1:8080` par le proxy srt ; la gateway contrôle `calls_allowed` et l'échéance, puis émet un jeton neuf, `parent` = ce `jti`. Le test de bout en bout est [À PROUVER: T-25, Gherkin, brique 2].

### 4.5 Budgets

Chaque requête vers le modèle, et chaque appel budgété, passe par une **réservation identifiée, idempotente et persistée avant le premier octet transmis**, dans **une seule transaction** qui verrouille d'abord la task, crée la réservation, change l'état une fois et actualise le budget. Si `data` est injoignable, le broker refuse : pas de réservation, pas d'envoi. Opérations typées de `data`, en fichiers `.sql` (`CLAUDE.md` : SQL seulement dans `data/`), identifiant `reservation_id` choisi par l'appelant. **Source unique** (DC-3) : à partir de 1b.3 le SQL vit dans `data/sql/*.sql`, et le banc comme les Gherkin le lisent là. Jusqu'à 1b.3 le banc l'extrait du bloc ci-dessous (`bench/src/tests/t45.ts:22-28`), ce qui fait de ce fichier markdown une entrée d'exécution du banc : défaut relevé par la contre-expertise, à supprimer en 1b.3 :

| État | Sens | Effet sur le disponible | Transitions |
|---|---|---|---|
| `reserved` | Persistée, envoi possible | Montant retenu | `observed`, `unknown`, `settled` (`not_sent` seulement) |
| `observed` | `usage` lu dans la réponse complète | Montant réservé retenu ; l'`usage` lu est consigné et appliqué au règlement | `settled`, `settled_admin` |
| `unknown` | Interruption : broker mort, flux coupé, réponse sans `usage` | **Montant réservé retenu, jamais libéré** | `settled`, `settled_admin` |
| `settled` | Réconciliation définitive, source `usage`, `invoice` ou `not_sent` | Coût final | Terminal |
| `settled_admin` | Réconciliation administrative, avec auteur et motif | Coût décidé | Terminal |

- **Idempotence** : rejouer `budget.reserve` avec le même `reservation_id` renvoie la ligne existante et ne retient rien de plus, **y compris en parallèle**. Ce n'est pas un `NOT EXISTS` qui le garantit (il lit un instantané), c'est le verrou de la ligne de budget de la task, pris avant toute lecture, puis l'`INSERT … ON CONFLICT DO NOTHING` sur l'identifiant.
- **Règlement unique** : `budget.settle` est identifié par `reservation_id`. La task et le montant retenu viennent de la **ligne persistée**, jamais des paramètres de réconciliation (qui ne fournissent que la source, le coût réel, et pour `settled_admin` l'auteur et le motif). La transition d'état se fait **une seule fois**, dans la même instruction que l'actualisation du budget ; un rejeu ne trouve plus de transition permise et ne débite rien.
- **Ordre des verrous** (DC-3) : toute transaction verrouille la ligne de `budgets` de la task **avant** toute ligne de `budget_reservations`, dans `reserve` comme dans `settle`. `observe` et `mark_unknown` ne touchent qu'une ligne de `budget_reservations` et n'attendent jamais `budgets`. Le texte précédent de `settle` prenait la ligne de la réservation puis celle du budget, à l'inverse de `reserve` : voir l'interblocage plus bas.
- **`not_sent`** : seul le broker peut l'écrire, et seulement s'il prouve qu'aucun octet n'a quitté le processus. Tout autre doute donne `unknown`. Une migration impose `settled_cost = 0` quand la source est `not_sent`.
- **Reprise** : au démarrage du broker, chaque `reserved` encore ouverte passe `unknown`.
- **Autorité** : une `unknown` se règle sur l'API Usage and Cost ou la Console, sinon par décision administrative. Aucune tâche de fond ne l'efface pour libérer le budget.
- **Facture supérieure à la réservation** : `spent` enregistre le montant réel, même au-delà du plafond. La tâche passe `overdrawn`, toute nouvelle réservation est refusée, et `BUDGET_OVERRUN` entre au registre. Le dépassement n'est ni absorbé ni tronqué : il attend une décision administrative.

SQL exact, une transaction par opération, `READ COMMITTED` (chaque instruction voit les écritures déjà validées une fois le verrou obtenu). **Statut.** `reserve` et la forme précédente de `settle` ont tourné au banc sur Postgres 17 réel (T-45a à T-45k, run 41044838678, §19.2). Le `settle` ci-dessous, qui prend `budgets` d'abord, **n'a pas passé T-45** : seule une variante dont le préfixe est identique a été jouée, en T-45j et T-45k (« corrigé », 0 × `40P01` sur les deux OS), et dans le scénario `fable/pg` (§4.5 plus bas). **T-45 est à rejouer sur ce texte, avec T-45l.**

```sql
-- budget.reserve($1 task, $2 reservation_id, $3 amount)
BEGIN;
-- 1. verrou de la ligne de budget : sérialise toute réservation et tout règlement de cette task
SELECT cap FROM platform.budgets WHERE task = $1 FOR UPDATE;
-- 2. création unique de la réservation, seulement si le plafond tient ; un identifiant déjà présent ne crée rien
--    3. le budget n'est actualisé que pour une ligne réellement insérée, dans la même instruction
WITH ins AS (
  INSERT INTO platform.budget_reservations (id, task, amount, state)
  SELECT $2, b.task, $3, 'reserved'
    FROM platform.budgets b
   WHERE b.task = $1 AND NOT b.overdrawn AND b.reserved + b.spent + $3 <= b.cap
  ON CONFLICT (id) DO NOTHING
  RETURNING task, amount)
UPDATE platform.budgets b SET reserved = b.reserved + ins.amount FROM ins WHERE b.task = ins.task;
-- 4. résultat : la ligne persistée, nouvelle ou existante ; zéro ligne = refus (plafond, task inconnue)
SELECT id, task, amount, state FROM platform.budget_reservations WHERE id = $2;
COMMIT;
-- l'appelant compare task et amount à sa demande : une ligne existante qui diffère donne RESERVATION_CONFLICT

-- budget.settle($1 reservation_id, $2 source, $3 coût réel, $4 auteur, $5 motif)
-- task et montant retenu viennent de la ligne persistée ; aucun paramètre ne les fournit
BEGIN;
-- 1. verrou de la ligne de budget de la task de la réservation, AVANT toute ligne de budget_reservations :
--    même ordre que budget.reserve (budgets, puis budget_reservations). La task d'une réservation ne change jamais,
--    la lecture sans verrou est sûre. Réservation inconnue : aucun verrou, aucune ligne, refus plus bas
SELECT b.task FROM platform.budgets b WHERE b.task = (SELECT task FROM platform.budget_reservations WHERE id = $1) FOR UPDATE;
-- 2. transition d'état unique et actualisation du budget, dans la même instruction
WITH tr AS (
  UPDATE platform.budget_reservations r
     SET state = CASE WHEN $2 = 'admin' THEN 'settled_admin' ELSE 'settled' END,
         settled_source = $2, settled_cost = $3, settled_by = $4, settled_reason = $5
   WHERE r.id = $1
     AND EXISTS (SELECT 1 FROM platform.budget_transitions x
                  WHERE x.from_state = r.state AND x.source = $2)
  RETURNING r.task, r.amount)
UPDATE platform.budgets b
   SET reserved = b.reserved - tr.amount,
       spent = b.spent + $3,
       overdrawn = b.overdrawn OR b.spent + $3 > b.cap
  FROM tr WHERE b.task = tr.task
RETURNING b.task, b.reserved, b.spent, b.overdrawn;
COMMIT;
-- zéro ligne rendue : règlement déjà fait ou transition interdite, rien n'a été débité ;
-- l'appelant lit la ligne : même source et même coût = rejeu accepté, sinon RESERVATION_CONFLICT
```

`platform.budget_transitions (from_state, source)` est une table de migration : `(reserved, not_sent)`, `(observed, usage)`, `(observed, invoice)`, `(unknown, usage)`, `(unknown, invoice)`, `(observed, admin)`, `(unknown, admin)`. Elle est l'unique endroit où la table des états ci-dessus est écrite. `budget.observe` et `budget.mark_unknown` sont des `UPDATE` gardés de la même forme, sans toucher à `budgets` : le montant retenu reste celui de la réservation jusqu'au règlement, et l'`usage` lu est consigné sur la ligne.

Une migration (`data/migrations`) contraint les états et les colonnes, chaque changement écrit une ligne append-only, `settled_by` et `settled_reason` sont obligatoires pour `settled_admin`, et l'ancien `CHECK (reserved + spent <= cap)` disparaît : il rendrait une facture réelle impossible à enregistrer. Le plafond est tenu à la réservation. **T-20 a mesuré l'ancien SQL** (Postgres réel, 300 réservations parallèles de 10 sur un plafond de 1 000 : exactement 100 acceptées ; après réconciliation à un coût réel de 7, 30 nouvelles passent). Il ne couvrait ni le rejeu concurrent d'un même `reservation_id`, ni le règlement rejoué.

**T-45 sur le texte précédent de ce SQL (run 41044838678, deux OS)** : T-45d rejoue T-20 (100 acceptées, `reserved 1000` ; après règlement `reserved 0, spent 700` ; 30 nouvelles) ; T-45a (50 `reserve` simultanés du même identifiant, 6 manches : `reserved` 10 à chaque manche), T-45b (50 `settle` simultanés : `spent 7`, `reserved 0`, une ligne rendue par manche), T-45c (règlement rejoué : zéro ligne), T-45e (états), T-45f (facture supérieure : `spent 150`, `overdrawn`), T-45h (task inconnue, conflit de montant) passent. Les **témoins** de l'ancien SQL échouent comme prévu, ce qui donne leur valeur aux passages : T-45a-témoin, budget sur-retenu 5 manches sur 6 sous macOS (`reserved` 20, 20, 10, 30, 30, 410) et 6 sur 6 sous Linux (20, 60, 40, 30, 60, 60) ; T-45b-témoin `spent 350, reserved -490` ; T-45c-témoin `reserved -969`. **Ces passages portent sur le `settle` d'avant DC-3 : à rejouer sur le texte ci-dessus.** Le banc doit être mis à jour pour cela, il n'est pas modifié ici : `T-45-sync` y compte `settle=1` instruction et `FIXED_SETTLE` ajoute déjà ce même préfixe en tête.

**Interblocage : l'affirmation « aucun 40P01 » est corrigée.** Ce document écrivait que T-45 couvrait « l'absence d'interblocage entre `reserve` (verrou du budget, puis insertion) et `settle` (verrou de la réservation, puis du budget) », et le banc l'appuyait : T-45g, T-45j-document, T-45k-document, 0 × `40P01` sur les deux OS. La contre-expertise l'a réfutée sur Postgres 17 local (`fable/pg/deadlock.mjs`, SQL extrait de ce bloc comme le fait `t45.ts`) : A = `reserve(t, X)` **rejoué** tient `budgets(t)` ; B = `settle(X)` verrouille la ligne de X puis attend `budgets(t)` ; A exécute alors `INSERT … ON CONFLICT DO NOTHING` sur X et attend la transaction de B, qui détient la ligne conflictuelle. Cycle. Résultat avec le SQL du document d'alors : B `40P01`, A valide, budget `reserved 10 / spent 0`, X reste `observed` (`pg.log` : 1 interblocage). Avec l'ordre uniforme : A et B valident, `reserved 0 / spent 7`, X `settled`. Pourquoi le banc ne l'a pas vu : T-45k rejoue des `reserve` d'identifiants neufs (`n-*`) et des `settle` d'identifiants pré-réservés (`p-*`), jamais le rejeu d'un `reserve` dont l'identifiant est en cours de `settle` (`t45.ts:337-340`) ; T-45j prend `i-new` pour `reserve` et `i-pre` pour `settle`, et son commentaire de banc pose qu'aucune instruction de `reserve` ne demande une ligne de réservation existante, ce qui est faux pour un `reserve` rejoué. **T-45l**, témoin à ajouter (banc puis Gherkin 1b.3) : cet entrelacement ; le SQL d'avant DC-3 **doit** y donner `40P01`, sinon le test ne prouve rien ; le SQL amendé doit valider les deux transactions avec `reserved 0, spent 7` et X `settled`. Coût du correctif : une instruction de plus par `settle`, `settle` sérialisé derrière les `reserve` de la même task (déjà le cas à sa dernière instruction). Un interblocage ne corrompt rien (B annulé, invariant tenu), son coût est un retry. Probabilité faible dans le flux prévu (un broker ne rejoue pas `reserve` pendant son propre `settle`), correctif bon marché. Le SQL amendé n'est pas déclaré prouvé.

Reprise après redémarrage et états : T-45e a joué les transitions permises et refusées ; la reprise (`reserved` ouvertes passées `unknown` au démarrage du broker) reste [À PROUVER: T-30, Gherkin, brique 1b]. Facture supérieure : T-45f au banc, [À PROUVER: T-46, Gherkin, 1b.3]. Le broker réserve avant de transmettre et réconcilie à partir de `usage` ; `maxBudgetUsd` et `maxTurns` restent en second rempart. `total_cost_usd` est une estimation côté client, l'autorité étant l'API Usage and Cost ou la Console [V: https://code.claude.com/docs/en/agent-sdk/cost-tracking] : la facturation ne s'appuie jamais dessus.

### 4.6 Ce que `platformd` détenait, et où cela va

| Fonction | Devient | Preuve |
|---|---|---|
| Clé Anthropic | `broker`, seul détenteur ; `platformd` n'existe plus | E-05, T-23 |
| Relais des appels | La gateway : serveur MCP de chaque enfant, client MCP de chaque module, politique dans le même processus. Un relais unique, celui du point de politique | E-02, E-01 ; [V: T-38, banc 1b.0, §19.1] |
| Lancement de srt | Port `SandboxRunner`, adaptateur srt dans `packages/sandbox`, appelé par la seule gateway (§4.8) | T-06 ; [À PROUVER: T-47, Gherkin, brique 1b] |
| Socket de contrôle | Supprimée | sans objet, plus rien à contrôler |
| `topology/processes.yaml` | `topology/modules.mcp.json`, format Claude Code | [V: mcp.md] ; lecture par la gateway [À PROUVER: T-29, Gherkin, brique 1b] |
| Quotas par tâche | Budgets §4.5 | T-20 (ancien SQL) ; T-45d (SQL d'avant DC-3) ; T-45 à rejouer sur le `settle` amendé, T-45l |
| Concurrence globale | Même mécanisme que les budgets : `capacity.acquire` avec expiration, `capacity.release`, même ordre de verrous | Mécanisme de §4.5 (T-45) ; [À PROUVER: T-27, Gherkin, brique 1b] |
| Terminaison | `detached: true`, `kill(-pgid)`, contrôle `pgrep -g`, puis `SIGKILL` ; erreur nommée `WORKER_TIMEOUT` | T-06 : sur les deux OS, tuer le groupe ne laisse aucun descendant (T-06-g) ; tuer `srt` seul en laisse (SIGKILL : 10 sur 11 sous Linux, 2 sur 3 sous macOS ; SIGTERM : 0 et 1), donc l'adaptateur tue toujours le groupe. Résidu macOS T-06b |
| Redémarrage | Tableau ci-dessous | [À PROUVER: T-30, Gherkin, brique 1b] |
| Isolement des pannes | Un enfant par task : la mort de l'un ne touche pas les autres | E-06 |

| Processus | Politique de redémarrage explicite |
|---|---|
| Sandbox (task, executor) | **Jamais** : la task échoue avec un code nommé, le client décide. Toute réservation ouverte passe `unknown` |
| Module stdio, sous srt | Reconnexion par la gateway, 3 essais avec délai croissant, puis `SERVICE_UNAVAILABLE` (code existant dans `mcp-service-client.ts`) |
| Broker | Comme un module. Sa mort fait échouer les tasks en cours avec une erreur nommée, sans effet sur les modules sans modèle. Ses réservations ouvertes passent `unknown` à la reprise |
| Gateway, Postgres | Poste : aucun, le développeur relance. Serveur : `Restart=on-failure` dans l'unité (§5.1). La mort de la gateway ferme les flux stdio : modules et workers lisent EOF et s'arrêtent. C'est le coût du parent unique ; résidu macOS T-06b |

### 4.7 Où s'exécute chaque traitement (normatif)

Toute ligne absente de ce tableau n'a pas le droit de s'exécuter. Un écart est un bug de conception.

| Traitement | Lieu | v3 | Code exécuté ou contenu non fiable | Preuve |
|---|---|---|---|---|
| Code soumis à `execute` | **srt**, réseau nul | Conteneur | Exécute le code écrit par le modèle | E-02, I-2 |
| Boucle `query()` et handlers minces | **srt**, dans le worker | Conteneur | Sortie de modèle, arguments d'outil | [V: T-41, banc 1b.0, §19.1] |
| Binaire Claude Code | **srt**, enfant du worker | Conteneur | Tools, dépôt, diff | E-04 ; T-41 |
| Tasks scout, builder, zetetic-reviewer | **srt**, un worker par task | Conteneur | Dépôt, code du builder, diff de PR | T-41 |
| Modules data et workflow, plugins compris : memory-recall, memory-write, memory-consolidate, code-index, verify, spec-lint, manifest-registry | **srt**, un processus par module | Conteneur | Dépôt (tree-sitter), mémoire, sorties de code, code de plugin | E-01 ; [V: T-38, banc 1b.0, §19.1] |
| Agents de module : codebase-ask, spec-draft, remember jusqu'à la brique 4 | **srt**, worker par task | Conteneur | Comme les tasks | T-41 |
| Structurer, Judge, Embedder | **srt**, modules workflow ; Judge distant : allowlist du manifeste | Conteneur | Contenu à structurer ou reclasser | Brique 8 ; Embedder désactivé par défaut |
| web-scout (O-27) | **srt**, sans modèle | Conteneur | Web hostile, sortie en quarantaine | Brique 8 |
| db-migrator (O-28) | **srt**, sans modèle, Postgres jetable dans la sandbox | Conteneur | SQL de plugin | [À PROUVER: T-49, Gherkin, brique 4] |
| Copie jetable `./repo` | **srt**, profil `repo-prepare` | Conteneur | Dépôt cloné | T-38 |
| **gateway, exception** | **Natif** | Conteneur | Enveloppes MCP, résultats comptés et bornés, jamais interprétés (§4.8) | T-07 : `listen` refusé sur macOS, mais fd 0 utilisable sous Linux (T-07-fd0), d'où l'obligation de l'adaptateur (§4.8) ; T-39b ; T-03f : `allowLocalBinding` ouvre tout le loopback sur macOS ; §11.7 |
| **broker, exception** | **Natif** | Absent | Corps de requête et de réponse, retrait de la clé, lecture de `usage` | Mêmes raisons (T-07, T-39b) ; détenteur de la clé, E-05, T-23 |
| **data, exception** | **Natif** | Absent | Paramètres typés, SQL fixe | Socket Unix Postgres : sous Linux `allowUnixSockets` est ignoré [V: README srt, « Unix Socket Settings »], et `allowAllUnixSockets` est interdit par schéma (§11.3). `pg` ne passe pas par le proxy. E-09 ne vaut que sur macOS |
| **Postgres 17, exception** | **Natif** | Conteneur | Requêtes de `data` | D-5, mêmes raisons que `data` |

### 4.8 Qui détient l'autorité de lancer une sandbox

`platformd` n'est pas remplacé par un autre démon. L'autorité tient dans **une fonction** du port `SandboxRunner`, adaptateurs `packages/sandbox/src/infrastructure/srt-runner.ts` (défaut) et `oci-runner.ts` (lignée de `docker-runner.ts`, §4.11), appelée par la seule gateway, seule exception native qui lance. Les modules et les workers sont sous srt : ils ne peuvent lancer que des enfants dans leur propre sandbox.

```ts
interface SandboxRunner {
  start(req: { profile: ProfileName; task: TaskId; lease?: BrokerLease }): Promise<Sandbox>;
}
// ProfileName : enum figé au démarrage depuis sandboxes/profiles/, validé par schéma strict
// TaskId : UUID généré par la gateway ; BrokerLease : port et autorisation fournis par le broker
// Sandbox : { stdin, stdout, stop() }, deux flux opaques et un arrêt vérifié
```

Comment ce code ignore le contenu non fiable :

1. **Par la signature.** Aucun paramètre ne peut recevoir un script, un prompt, un argument d'outil ou une sortie de modèle. Le contenu arrive plus tard, sur stdin, quand l'enfant appelle `task_input`.
2. **Par l'argv.** `command` et `args` viennent du profil statique, `cwd` = `~/.architect-os/tasks/<TaskId>/`, l'environnement est une liste fermée, où figure `CLAUDE_CODE_TMPDIR` : un dossier temporaire créé par l'hôte pour cette seule sandbox (§9.2). Aucun shell, aucune interpolation.
3. **Par l'absence de lecture.** L'adaptateur renvoie des flux qu'il ne lit pas. Il ne contient ni parseur JSON ni import du SDK MCP. Il observe seulement le code de sortie et l'arbre de processus (`detached`, `kill(-pgid)`, contrôle `pgrep -g`, puis `SIGKILL`).
4. **Par la garde d'architecture.** `child_process`, `@anthropic-ai/sandbox-runtime` et le lancement de `docker` ne s'importent ni ne s'exécutent que dans `packages/sandbox` (DC-1 ; le lancement de `docker` passe par `child_process`, que la même règle restreint, une fixture le montre), le port ne s'importe que dans `gateway/src/infrastructure`, le scénario échoue sinon.
5. **Par les descripteurs (obligation de l'hôte).** Les descripteurs 0 à 2 de l'enfant sont **créés par l'adaptateur, jamais hérités** (DC-7). Le mot « tubes » de la version précédente était inexact : un `spawn` Node avec `stdio: 'pipe'` donne des sockets `AF_UNIX` (`0:socket 1:socket 2:socket`, prouvé en local par la contre-expertise ; `T-35-pre-fds` du banc montre `1:socket, 2:socket` sur les deux OS), et le seccomp de srt ne filtre pas les opérations sur des sockets hérités [V: README srt, « Security limitations » de la couche seccomp]. Ce qui compte est donc l'origine du descripteur, pas son type. srt ne l'impose pas sous Linux : **T-07-fd0, échec réel** (run 41044838678 : le client reçoit `servi-depuis-sandbox` d'une sandbox qui sert depuis un socket d'écoute reçu en fd 0 ; macOS : `EPERM`). La garde de l'hôte existe au banc (`assertStdioPipes`, `bench/src/lib/common.ts:191`) et FD-PIPES-a à f passent sur les deux OS : handle, fd numérique de type socket, `inherit` et socket en fd 1 ou 2 refusés, fichier ordinaire refusé, FIFO et `pipe` acceptés. Limite relevée : le helper accepte `'pipe'` mais refuserait le même descripteur passé en numérique, parce que son type est socket ; sa règle est à réécrire en « descripteurs créés par l'adaptateur », sans vocabulaire de tubes. Reprise dans l'adaptateur et scénario Gherkin : [À PROUVER: brique 1a.0 puis 1b.1].

La gateway, elle, lit le contenu qu'elle relaie. Elle s'en tient aux enveloppes : validation de schéma, `calls_allowed`, compte des tokens, résumé déterministe avec handle. Elle ne fait aucun `eval`, aucun accès fichier ni requête construits depuis un argument. Une compromission de la gateway reste totale, elle détient déjà la clé de signature : c'est le résidu écrit au §11.1, et la raison de garder son code court. Sur serveur, `--permission` doit être compatible avec ce lancement (§11.7). Preuves : [À PROUVER: T-47, Gherkin, brique 1b], enfant hostile [À PROUVER: T-40, Gherkin, brique 1b].

### 4.9 Parcours `execute` (normatif)

Le modèle exprime l'intention et reçoit un résultat borné. Aucun résultat intermédiaire n'entre dans son contexte, aucune étape n'ajoute de tool visible ni de tour de raisonnement.

| # | De → vers | Quoi |
|---|---|---|
| 1 | Client → gateway | `execute(script)`, un des trois méta-tools |
| 2 | Gateway | Auth, profil, DAG, `budget.reserve`, `capacity.acquire`, `trace` |
| 3 | Gateway | `SandboxRunner.start({ profile: 'executor', task })` ; aucun script en argv |
| 4 | Executor → gateway | `initialize`, `tools/list` limité au profil, `task_input` qui rend le script |
| 5 | Executor → gateway | `tools/call memory.recall` ; identité = fermeture du handler |
| 6 | Gateway → module | `calls_allowed`, puis `tools/call` avec jeton neuf ; le module vérifie et exécute sous srt |
| 7 | Module → gateway → executor | Résultat typé, jamais au client ; `budget.observe` |
| 8 | Executor | Le script filtre et agrège ; les étapes 5 à 8 se répètent |
| 9 | Executor → gateway | `task_complete` avec la sortie ; l'arbre srt est arrêté et contrôlé |
| 10 | Gateway → verify | Si du code est produit : `tools/call verify`, sous srt |
| 11 | Gateway → registre | Verdict validé ou gradé, tokens par couche et par modèle, appels (`task`, `jti`), `budget.settle` |
| 12 | Gateway → client | ≤ `max_result_tokens`, sinon résumé + handle |

Les étapes 4 à 10 ne traversent jamais le contexte du client. Preuve : invariant I-9, [À PROUVER: T-48, Gherkin, brique 3]. Le chemin `kind: agent` est atteint par un `tools/call` à l'étape 6, et seulement pour le non stabilisable : `kind: agent → worker sous srt (Agent SDK, Claude Code, handlers minces) → gateway`.

### 4.10 Les arguments restent non fiables, même sous srt

Zod protège la structure, pas la sémantique. Une valeur bien typée peut viser le mauvais fichier, la mauvaise task ou un volume démesuré. **Les capacités et les contraintes de ressources se vérifient au point où l'effet s'exécute**, jamais seulement à l'entrée du relais.

| Effet | Point d'exécution | Vérification à ce point |
|---|---|---|
| Lecture ou écriture en base | Opération de `data` | `task` et `cap` pris du jeton, jamais d'un argument ; `owner` et `writes_tables` contrôlés par opération ; limite de lignes et d'octets |
| Lecture de fichier, citations | Module sous srt | `realpath` sous `./repo`, refus de `..` et des liens sortants, taille bornée ; le validateur `citations` tourne dans `verify`, jamais dans la gateway |
| Écriture de fichier | Worker builder | Frontière srt, et refus du module pour un chemin hors copie jetable |
| Réseau | Proxy srt, `web-scout` | Allowlist du profil, `deniedResolvedAddresses` ; taille et type bornés à la réception |
| Quarantaine | Opération de `data` | Source = `task` du jeton ; aucune lecture hors `quarantine` sans capacité dédiée |
| Coût de modèle | Broker | Réservation persistée avant envoi, §4.5 |
| Appel d'un autre module | Gateway puis module cible | `calls_allowed` à la gateway, `aud` et `cap` au module |

Preuve : [À PROUVER: T-51, Gherkin, briques 1b et 5] : argument bien typé mais hors capacité, `task` forgée en argument, chemin `../`, lien symbolique sortant, volume au-delà de la borne.

### 4.11 Un port, deux adaptateurs : srt d'abord, OCI/Docker là où srt n'est pas supporté (DC-1)

**Port.** Un seul port d'exécution, `SandboxRunner`, héritier de `ContainerRunner`, et **deux adaptateurs** derrière la même signature fermée (§4.8) et la même suite `features/sandbox/*.feature` : **srt**, par défaut ; **OCI/Docker** (`packages/sandbox/src/infrastructure/oci-runner.ts`), lignée de `docker-runner.ts`, **seulement là où srt n'est pas supporté**. Docker est testé en premier, Podman ensuite par les mêmes flags, sans troisième adaptateur. Rien hors de `packages/sandbox` ne dépend de srt ou de docker : le reste du code ne connaît qu'un nom de profil et deux flux MCP stdio, et seul l'adaptateur lit `sandboxes/profiles/*`. L'adaptateur en mémoire des tests n'isole rien et reste hors du chemin de production. `docker-runner.ts` n'est plus supprimé en 1b.5 : il est déplacé et réduit, avec ses options durcies (`--read-only`, `--cap-drop ALL`, `--pids-limit`, `--memory`, `docker-runner.ts:41-64`). **Le socket Docker n'est monté dans aucun conteneur** (le `compose.yaml` actuel le monte, l.51 : il n'est pas repris) ; mode rootless visé. Garde : règle dependency-cruiser avec fixture, qui échoue si `@anthropic-ai/sandbox-runtime`, `child_process` ou le lancement de `docker` apparaissent hors de `packages/sandbox` [À PROUVER: T-52 étendu, Gherkin, brique 1a.0 puis 1b.1]. Fuite connue : l'autorisation de task du broker repose sur `mask` (§11.2) avec srt ; l'adaptateur OCI la remplace par un socket Unix par task (ci-dessous).

**Choix de l'adaptateur : configuration explicite, jamais de bascule automatique.** Le choix est un champ de configuration (`topology/`), pas une détection : un hôte où srt échoue ne passe pas tout seul sur Docker.

**Critère « srt non supporté »** (contre-expertise, §3 du rapport), à écrire dans l'adaptateur. srt est tenu pour non supporté si l'un de ces faits est établi :

1. Système ou architecture hors du support : tout hôte qui n'est ni macOS avec `/usr/bin/sandbox-exec`, ni Linux x64 ou arm64 avec `bwrap`, `socat`, `ripgrep` **et** des espaces de noms utilisateur porteurs de capacités. Windows est couvert par srt (README srt, ACL) : à décider, pas « non supporté ».
2. Linux avec `kernel.apparmor_restrict_unprivileged_userns = 1` sans profil AppArmor (E-07 prouvé ; `bench-sandbox.yml` pose le sysctl).
3. Tout conteneur sans espaces de noms utilisateur (E-07 : `--privileged` ne suffit pas).
4. Appelant root sans `CAP_SETFCAP` (README srt, « Running as root »).
5. Échec d'un test obligatoire du banc à la montée de version (T-54).

**Détection : canari au démarrage, fermé à l'échec.** À son démarrage, l'adaptateur choisi lance une sandbox canari qui **doit** échouer à lire un fichier hors `allowRead` et à joindre une IP hors allowlist. Tout autre résultat, y compris une erreur de lancement, est un refus de démarrer : `ISOLATION_UNAVAILABLE`, aucun repli silencieux. `enableWeakerNestedSandbox` est refusé par schéma (§11.3). Le canari de l'adaptateur OCI (fichier hors montage, `--network none`) est à écrire avec lui [À PROUVER: Gherkin, 1b.1].

**Paradoxe de la niche Docker, tel qu'écrit par la contre-expertise.** Là où srt échoue faute d'espaces de noms utilisateur, Docker exige soit un démon root (indisponible dans un conteneur, un runner non privilégié, un pod), soit rootless (qui exige aussi des espaces de noms utilisateur). La niche réelle de Docker est donc un **hôte Linux avec un démon Docker rootful et un sysctl non modifiable**. Lu dans la VM Colima du poste (Engine 28.3.3, VM Ubuntu 24.04.2, noyau 6.8) : profils AppArmor `rootlesskit`, `podman`, `unprivileged_userns` et `linux-sandbox` présents, **aucun profil `bwrap`**. Rootless Docker ou Podman pourraient donc y tourner sans sysctl là où srt non : lu, **pas testé**. C'est O-31, reportée à la brique D avec un test de Docker/Podman rootless sans sysctl (DC-11).

**Identité du broker sous Docker : à prouver.** `--env` mettrait l'autorisation de task **dans** le conteneur, lisible par le modèle, et `mask` n'existe pas hors de srt. Le patron lu chez Anthropic est `--network none` plus un socket Unix monté vers le proxy de l'hôte, « the same architecture used by sandbox-runtime » [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment]. Ici : un **socket Unix par task**, fichier dans un répertoire propre à la task et monté dans ce seul conteneur ; l'identité est le fichier. L'identification du pair par `SO_PEERCRED` exigerait un addon natif (`node:net` n'expose aucun identifiant de pair, §11.2) : elle n'est pas retenue tant que non prouvée. Déduit, jamais joué : [À PROUVER: T-43D, banc Docker sur `ubuntu-24.04`].

**Conséquences sur les tests** (rien de ce qui suit n'a été joué sous Docker) :

- T-34h, T-34i : un bind mount persiste pareil. Copie en lecture seule plus volume d'écriture plus bundle (la page Anthropic dit de monter seulement les répertoires nécessaires, en lecture seule de préférence), et la règle de copie de DC-2 (§9.2) s'applique à l'identique : [À PROUVER: T-34D].
- T-07-fd0 : les stdio du conteneur sont créés par le runtime, le risque se déplace sur le client `docker run -i` (jamais de descripteur hérité). T-06 : tuer le client ne tue pas le conteneur (`docker-runner.ts:78`) ; il faut `docker rm -f` et `--init`, et la logique `kill(-pgid)` est sans objet : [À PROUVER: T-06D].
- T-43d : sous Docker l'exposition de l'autorisation par l'environnement d'un processus du même uid disparaît, mais la **socket Docker** apparaît : voir STRIDE ci-dessous.
- T-41, T-38 : image avec Node, binaire Claude Code et worker ; broker joignable par socket Unix monté ; les octets MCP traversent le client Docker et un démon root ; `--read-only`, `--cap-drop ALL`, `--pids-limit`, `--memory` remplacent `systemd-run` (T-09L) : [À PROUVER: T-41D, T-38D].
- CI : Docker sur `ubuntu-24.04`. Sur `macos-latest`, l'absence de Docker est **déduite, non vérifiée** (à confirmer sur la liste des images runner de GitHub) ; l'adaptateur OCI n'aurait alors qu'un OS de preuve.
- Démarrage, mesuré sur le poste (`fable/lat`) : `docker run --rm node:26-bookworm-slim node -e 1` 87 ms de médiane (85 ms durci), `srt + node` 316 ms, `node` seul 107 ms. Réserve : noyaux différents (VM Linux arm64 contre macOS), image déjà présente ; un module reste lancé, le coût ne pèse qu'au démarrage.
- Licence de Docker Desktop : sans objet (Colima prouvé localement, Docker Engine sur serveur). Anthropic classe « Containers (Docker) » comme dépendant de la mise en place, risque faible à moyen, et donne la commande durcie ; cohérent avec « TypeScript, npm, fichiers descriptifs » si l'adaptateur reste un `argv` statique.

**STRIDE (E).** Sous Docker, **la gateway, qui lance des conteneurs par la socket, est équivalente à root** sur l'hôte : une compromission de la gateway vaut root sous Docker, un uid seulement sous srt. `--userns-remap` ou le mode rootless atténuent. Détail au §11.3.

**Déclenchement des autres candidats.** L'adaptateur OCI n'attend pas ces faits : il existe pour les hôtes que le critère ci-dessus déclare non supportés. Les faits suivants ouvrent l'évaluation d'un autre candidat que Docker et Podman (Kata, fork de srt, adaptateur fin), et le propriétaire décide :

1. T-41 échoue pour une raison structurelle sur un OS ciblé. **État au 30 octobre 2026 : non déclenché.** T-41 passe sur Linux et macOS avec un faux amont et une seule couche srt (§19.1, §19.2) ; O-30 est sans objet. Limite : aucun appel réel à Anthropic, T-04R reste à jouer en 1b.
2. Un test d'évasion réussit (fichiers, réseau, secrets, autre session), et srt ne peut pas le corriger.
3. Une montée de version de srt casse une propriété prouvée, ce que détecte le banc rejoué à chaque montée de version [À PROUVER: T-54, `npm run bench:sandbox`, brique 1b].

**Critères de pérennité.** Aucune alternative de niche. Un candidat doit passer les cinq : licence open source ; gouvernance par une fondation ou plusieurs organisations ; activité récente ; adoption réelle ; pas de dépendance à un seul éditeur. Mesure du **30 octobre 2026**, rejouée **au déclenchement** parce que ces informations vieillissent : `gh api repos/<dépôt>`, `/releases/latest`, et domaines des auteurs sur les 100 derniers commits de 90 jours au plus. Tout ce tableau est **à évaluer au déclenchement, sans décision**.

| Candidat | Licence | Gouvernance | Dernière version, auteurs | Part des commits | Adoption | Verdict |
|---|---|---|---|---|---|---|
| Podman [V: github.com/containers/podman, cncf.io/projects/podman] | Apache-2.0 | CNCF, niveau Sandbox, depuis le 21 janvier 2025 | v6.1.4, 12 oct. 2026 ; 29 | redhat.com 43, autres organisations et individus 57 | 33 152 étoiles ; indicateur faible, à compléter au déclenchement | **Retenu**, second adaptateur OCI après Docker, mêmes flags (DC-1). Linux : rootless, sans démon. macOS : `podman machine`, VM libkrun ou applehv |
| Kata Containers [V: github.com/kata-containers/kata-containers, katacontainers.io] | Apache-2.0 | OpenInfra Foundation | 4.3.1, 21 oct. 2026 ; 20 | nvidia.com 31, fidencio.org 24, antgroup.com 15, IBM 9, microsoft.com 8 | Baidu en production | **Retenu.** VM légères ; exige la virtualisation matérielle |
| bubblewrap [V: github.com/containers/bubblewrap] | LGPL (`COPYING`) | Organisation `containers` | v0.13.1, 14 oct. 2026 ; 9 | collabora.com 30, redhat.com 20 | Flatpak, rpm-ostree, srt | **Retenu comme primitive.** Pas de filtre réseau, ne remplace pas srt seul |
| Landlock [V: docs.kernel.org/userspace-api/landlock.html] | GPL-2.0, noyau | Noyau Linux | Linux 5.13 et suivants ; 15 auteurs sur 12 mois | mic@digikod.net 47 sur 85, `security/landlock` | Noyau mainline ; usage applicatif non établi ici | **Retenu comme primitive.** Fichiers et ports TCP, pas de filtre par domaine ; un mainteneur dominant |
| gVisor [V: github.com/google/gvisor, gvisor.dev/users] | Apache-2.0 | Dépôt de Google, aucune fondation | release-20261026.0, 28 oct. 2026 ; 15 | google.com 87 | Large : Cloudflare, Ant Group, OpenAI, Anthropic | **Écarté : un seul éditeur.** Excellent techniquement selon Anthropic, écarté pour la pérennité seule |
| Firecracker [V: github.com/firecracker-microvm/firecracker] | Apache-2.0 | AWS, aucune fondation | v1.17.0, 10 sept. 2026 ; 11 | amazon.* 96 | AWS Lambda, Fly.io, E2B | **Écarté : un seul éditeur.** Reste accessible comme hyperviseur de Kata |
| `apple/container` [V: github.com/apple/container] | Apache-2.0 | Dépôt d'Apple, aucune fondation | 1.6.1, 23 oct. 2026 ; 37 | apple.com 57 | 50 973 étoiles | **Écarté : un seul éditeur**, macOS 26 et Apple silicon seulement |
| Virtualization.framework [V: developer.apple.com/documentation/virtualization] | Propriétaire | Apple | macOS 11+ | sans objet | Socle de `applehv` | **Écarté comme candidat**, reste le socle macOS de Podman. Tout repli sur macOS dépend d'Apple |
| srt lui-même [V: github.com/anthropics/sandbox-runtime] | Apache-2.0 | Dépôt d'Anthropic | v0.0.81, 20 oct. 2026 ; 7 ; 14 versions en 90 jours | anthropic.com 96 | Claude Code | **Échouerait au critère éditeur** : d'où ce port et l'option de fork |

**Par cas, sans décision.**

| Cas | Candidats à évaluer au déclenchement |
|---|---|
| Linux où srt n'est pas supporté (critère du §4.11) | Adaptateur OCI : Docker d'abord, Podman rootless ensuite ; l'existence de la niche rootless est à prouver en brique D (O-31, DC-11) |
| Contenu hostile ou multi-utilisateur (O-22) | Kata Containers |
| Échec sur macOS | `podman machine` |
| srt abandonné ou divergent | Fork de srt, ou adaptateur fin ci-dessous |
| Le propriétaire ne veut plus gérer l'isolation | Sandbox hébergé par Anthropic : [sessions cloud](https://code.claude.com/docs/en/sandbox-environments#cloud-sessions) ou [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview). **Non open source**, dépendance à un seul éditeur assumée, hors critères. Managed Agents est en bêta et non éligible à la rétention zéro |

**Deux options open source, évaluées sans décision.**

| Option | Pour | Coût réel |
|---|---|---|
| **(a) Forker et maintenir srt** (Apache-2.0) | Mêmes profils, mêmes tests, aucun changement hors de l'adaptateur. Immédiat si Anthropic abandonne ou diverge | 23 160 lignes de JS publié, binaires seccomp x64 et arm64, proxy et terminaison TLS expérimentale. Au rythme observé de 14 versions en 90 jours, environ une version par semaine à trier, avec les changements de Seatbelt, bubblewrap et du noyau à suivre seuls |
| **(b) Adaptateur fin écrit par nous**, avec assistance IA, sur Seatbelt, bubblewrap, Landlock, seccomp | Surface réduite à notre besoin : aucun réseau, un port, une allowlist [déduit]. Primitives Linux pérennes | Code critique pour la sécurité, à bus factor faible. L'IA accélère l'écriture, pas la preuve : une évasion ne se voit pas à la relecture. `sandbox-exec` est marqué DEPRECATED (`man sandbox-exec`, macOS 27), donc la voie macOS est fragile. Filtre par domaine et autorisation du broker à réécrire. Taille non estimée à ce stade |

**Preuve indispensable, quel que soit le code.** Aucune option n'est adoptée sans la suite d'évasion du §11.4, T-41, T-42 et T-43 verts sur chaque OS ciblé, rejoués à chaque montée de version ; pour l'adaptateur OCI, leurs équivalents T-41D, T-38D, T-06D, T-34D et T-43D.

## 5. Audit élément par élément

### 5.1 Ce qui n'est ni TypeScript, ni npm, ni fichier descriptif, ni brique Anthropic

| Élément | Verdict | Par quoi / raison | Preuve |
|---|---|---|---|
| `fixpoint.sh` (v3) | **Retiré** | `tools/build` en TypeScript, étapes YAML | §14 ; absent du dépôt |
| `stage0/promote.sh` (v3, `platform-build.yml`) | **Retiré** | Promotion = étapes YAML, `npm publish` puis PR d'épinglage. Absent du dépôt à `1746cc8` | `platform-v3.html` ligne 607 ; §14 |
| `.gitignore` cite `scripts/gate.sh` | **Retiré** en 1a | Remplacé par `npm run gate` | `.gitignore` |
| Caddy, edge | **Retiré de la plateforme**, gardé en dépôt comme `deploy/edge/Caddyfile` | Aucun code n'en dépend, le poste n'en a pas. Aucune brique Anthropic ne fait TLS public ni ACME. Sur serveur, tout terminateur convient | Choix du terminateur : O-7. Serveur [À PROUVER: T-31, banc serveur, brique de déploiement] |
| Unités système | **Gardées sur serveur seulement**, fichiers descriptifs `deploy/systemd/*.service` | Aucun script. Poste : `npm start` | [À PROUVER: T-26, banc serveur, brique de déploiement] |
| Utilisateurs OS (`agentic-gw`, `agentic-sup`, `agentic-data`) | **`agentic-sup` retiré** (`platformd` n'existe plus). **`agentic-gw` → `architect-os-gateway`**, **`agentic-data` → `architect-os-data`**, **`architect-os-broker` ajouté**, serveur seulement. Modules et workers n'ont pas d'utilisateur propre : leur frontière est srt, et le profil refuse l'état de la gateway. Poste mono-utilisateur | Preuve de la nécessité : sous Linux, un processus du même uid lit `/proc/<pid>/environ` d'un autre, un autre uid reçoit `Permission denied`. Sans utilisateurs dédiés, une gateway compromise lit la clé du broker | T-24 |
| Socket Unix Postgres | **Gardée** ; `/run/agentic/pg` → `/run/architect-os/pg` | Auth `peer`, aucun mot de passe, donc aucun secret. Le pilote `pg` s'y connecte. Depuis une sandbox : `EPERM`. `allowUnixSockets` ne l'ouvre que sur macOS, il est ignoré sous Linux | E-09 ; [V: README srt, « Unix Socket Settings »] |
| Socket de contrôle `platformd` | **Retirée** | §4.6 | §4.6 |
| Sockets Unix de srt sous Linux | **Gardées** | Interne à srt, pont vers ses proxys | [V: README srt, « Network Isolation »] |
| Gabarits `{{runtime}}`, `{{repo}}` | **Retirés** | Chemins relatifs, `~` natif ; seul le port du broker varie, ajouté par `JSON.stringify` au profil validé | T-02c à T-02i, E-05 |
| Binaire Node | **Gardé** | Socle `.nvmrc`, version exacte | sans objet |
| `bubblewrap`, `socat`, `ripgrep` (Linux), `ripgrep` (macOS) | **Gardés** | Exigés par srt | [V: README srt, « Platform-Specific Dependencies »] ; T-16 |
| Postgres 17, `pgvector` | **Gardés** (D-5) | `postgresql-17` absent des dépôts d'`ubuntu-24.04` (16.15 et pgvector 0.6.0 seulement) : dépôt PGDG dans `gate.yml`, Homebrew sur macOS | T-16 ; installation PGDG [À PROUVER: T-32, `gate-linux`, brique 1a] |
| Extension BM25 | **Ouvert** (O-11) | Non nommée en v3 | Brique 4 |
| `systemd-run` | **Gardé** sur serveur | Limites mémoire et PID, argv dans le TypeScript, sans script | [À PROUVER: T-09L, `gate-linux`, brique 1b] |
| Dockerfiles, `compose.yaml` | **`compose.yaml` non repris** : il monte la socket Docker dans un conteneur (`compose.yaml` l.51), ce que DC-1 interdit ; sort à décider en 1b.6. **`Dockerfile` et image worker** : repris comme image de l'adaptateur OCI, à confirmer en 1b.1 | | §4.11, §6 |

### 5.2 Ce qui réinvente une fonction d'une brique Anthropic

| Élément | Verdict | Remplacé par | Preuve |
|---|---|---|---|
| Protocole JSON lines | **Supprimé** | MCP stdio, SDK officiel | E-01, E-02, E-03 |
| `platformd` | **Supprimé** (D-9) | Agent SDK + MCP SDK + port `SandboxRunner` | §4.6, §4.8 |
| Worker `main.ts`, entrée/sortie JSON | **Réduit** | `query()` + `outputFormat` dans le worker sous srt, MCP stdio vers la gateway | E-04, E-02 ; T-41 |
| Outils internes HTTP (`internal-http.ts`, `HttpInternalTools`) | **Supprimés** | `createSdkMcpServer` avec handlers minces, relais MCP stdio vers la gateway | E-02, E-04 ; T-41 |
| API HTTP de `data` (`/v1/ops/<op>`, `HttpDataClient`) | **Remplacée** | `McpServer` généré par une boucle sur `DATA_OPS`, comme `createGatewayServer` | Patron existant ; [À PROUVER: T-33, Gherkin, brique 1b] |
| Masquage de clé srt | **Écarté pour la clé Anthropic** | Broker, patron recommandé par Anthropic ; `mask` ne porte plus qu'une autorisation de task de faible valeur | T-04, T-23, T-42 ; [V: secure-deployment#the-proxy-pattern] |
| Jetons de task signés maison | **Gardés, durcis** | Forme `AuthInfo` du SDK côté http, `expectedResource` pour l'audience ; signature `node:crypto` | [V: `dist/esm/server/auth/types.d.ts`, `bearerAuth.d.ts`] ; T-21 |
| Registre (`platform.executions`) | **Gardé** | Aucune brique ne couvre un registre transverse. `SessionStore` persiste des sessions, pas des exécutions de modules. OTel reste optionnel | [V: https://code.claude.com/docs/en/agent-sdk/hosting#observability] |
| Profils de task | **Remplacés** | `agents/<nom>.md` au format Claude Code + `<nom>.srt.json`. `settings.json` de plugin ne porte que `agent` et `subagentStatusLine`, donc pas de politique par ce biais | E-04b, E-08 ; [V: plugins-reference#settings] |
| Profils clients de la gateway | **Gardés**, fichier descriptif | Aucune brique ne filtre un catalogue par client | §10 |
| `search` / `describe` | **Gardés pour tout client à exécution, Claude Code compris.** Fusion proposée, non décidée (O-21) | Tool Search différerait les schémas, mais le modèle appellerait alors lui-même les tools des modules : c'est l'orchestration que Code Execution with MCP retire du contexte. Le serveur des méta-tools se déclare `alwaysLoad` | [V: mcp#configure-tool-search, mcp#exempt-a-server-from-deferral] |
| `execute` | **Gardé** | Aucune brique client ne filtre les résultats intermédiaires hors du contexte | [V: https://www.anthropic.com/engineering/code-execution-with-mcp] |
| Catalogue de repli | **Gardé pour les seuls clients sans exécution**, comme en v3, sans code neuf | La boucle `registerTool` déjà présente dans `gateway/src/presentation/mcp-server.ts`. Point d'entrée distinct, sans `alwaysLoad`, pour que Tool Search s'y applique et que le seuil de définitions tienne | Fichier du dépôt ; [V: mcp.md] |
| `max_result_tokens`, résumé + handle | **Gardé** | Claude Code alerte à 10 000 tokens et plafonne à 25 000 : largement au-dessus des 1 000 visés par v3 | [V: mcp#mcp-output-limits-and-warnings] |
| Tasks (extension MCP) | **Reporté** | Le SDK marque `experimental.tasks` « may change without notice » | [V: `dist/esm/client/index.d.ts`] |

## 6. Correspondance avec le squelette actuel

| Actuel (`1746cc8`) | Devient | Statut |
|---|---|---|
| `compose.yaml`, `Dockerfile`, `.dockerignore`, `services/memory/worker/Dockerfile`, `test/infra/compose.test.ts` | `topology/modules.mcp.json`, `sandboxes/profiles/*`, `features/infra/`, `features/sandbox/` | `compose.yaml` et son test **supprimés** ; `Dockerfile` et image worker **repris** par l'adaptateur OCI (DC-1, 1b.6) |
| `proxy/Caddyfile` | `deploy/edge/Caddyfile` | **déplacé** (1b) |
| `.env.example` | `topology/env.example`, sans mot de passe ni `BROKER_URL` | **réduit** (1b) |
| `docker-runner.ts` (`DockerContainerRunner`, préfixe `agentic-worker-`) | `packages/sandbox/src/infrastructure/oci-runner.ts` (lignée de `docker-runner.ts`) **et** `srt-runner.ts` (défaut), deux adaptateurs du port `SandboxRunner` | OCI **déplacé et réduit**, srt **nouveau** (1a.0, 1b.1) |
| `in-process-runner.ts` | adaptateur en mémoire, indispensable à la mutation (§13.6) | **gardé** |
| Port `ContainerRunner` | `SandboxRunner` | **renommé** |
| `worker/main.ts`, `run-worker.ts`, `internal-tools.ts`, `src/presentation/internal-http.ts`, `prompts/recall.md` | §4.3 : `worker/main.ts` et `run-worker.ts` réduits, `internal-tools.ts` devient client MCP, `internal-http.ts` supprimé. `prompts/remember.md` devient `agents/` (O-29) ; `prompts/recall.md` supprimé en brique 2 | **réduits, supprimés** (1b) |
| `worker/sdk-agent.ts` | options de `query()`, dans le worker sous srt | **réduit** |
| `gateway/` | + `profiles`, `tokens`, `policy`, `registry`, `codefront` (serveur MCP par sandbox), appel de `SandboxRunner`, lecture de `modules.mcp.json` | **étendu** |
| `data/src/presentation/http-api.ts`, `services/memory/src/infrastructure/data-client.ts` | Serveur MCP généré, client MCP | **remplacés** (1b) |
| `data/` | + `budget.*`, `capacity.*`, `owner` dans `operations.json` | **étendu** |
| `0002_memory.sql` (pgvector actif) | Migration `0004` (D-5) ; pgvector requis jusque-là par les 6 tests §13.9 | **nouveau** |
| `packages/contracts` | + schémas stricts des profils srt et du manifeste | **étendu** |
| `.dependency-cruiser.cjs` | `@anthropic-ai/sandbox-runtime`, `child_process` et le lancement de `docker` seulement dans `packages/sandbox` (DC-1) ; aucun import de `bench/` depuis un workspace (DC-8) ; port importé seulement par `gateway/src/infrastructure` ; Agent SDK seulement dans `services/*/worker` et `modules/*/worker` | **modifié** |
| `*.test.ts` vitest (119 cas exécutés, 95 appels statiques) | `.feature` + steps | **migrés** (1a) |
| `vitest`, `vitest.config.ts` | `@cucumber/cucumber` 12.9.0, Stryker, `tsx` | **retirés** (1a) |
| `ci.yml` | `gate.yml` | **remplacé** (1a) |
| `claude.yml`, `claude-code-review.yml` | `claude-mention.yml`, `claude-review.yml`, fédération OIDC | **remplacés** (1c) |
| `.claude/agents/*`, `.claude/commands/review-pr.md`, `.claude/settings.json` | conservés ; écritures refusées par srt (T-02e) | **gardés** |
| `.nvmrc` = `26` | version exacte | **modifié** (C-10) |
| — | `.claude-plugin/marketplace.json`, `plugins/architect-os-gateway/`, `plugins/ai-architect-standards/`, `packages/sandbox/`, `sandboxes/`, `agents/`, `modules/`, `topology/`, `deploy/`, `stage0/`, `tools/`, `features/`, `decisions/` | **nouveaux** |

## 7. Arborescence cible et isolation du nom

### 7.1 Arborescence

```
architect-os/
├── .claude-plugin/marketplace.json        # D-2
├── plugins/
│   ├── architect-os-gateway/              # plugin d'entrée : MCP http -> gateway
│   └── ai-architect-standards/            # standards (skills/agents) utilisés en CI
├── CLAUDE.md                              # moins de 200 lignes
├── platform.json                          # source unique du nom (§7.2)
├── topology/
│   ├── modules.mcp.json                   # format .mcp.json ; stdio local, http distant
│   └── env.example
├── agents/                                # profils de task, format Claude Code (§9.1)
├── sandboxes/
│   ├── profiles/*.srt.json                # profils srt statiques + schéma strict (§9.2)
│   └── executor/                          # runtime de l'executor
├── packages/
│   ├── contracts/
│   └── sandbox/                           # port SandboxRunner, adaptateurs srt et OCI, seul importeur de srt, de child_process et de docker
├── gateway/
├── modules/
│   ├── broker/  manifest-registry/  db-migrator/  web-scout/
│   └── manifest.schema.json
├── services/memory/
├── data/
├── deploy/                                # serveur seulement, descriptif
│   ├── edge/Caddyfile
│   └── systemd/*.service
├── stage0/
├── tools/{build,test-gate}/
├── features/{e2e,infra,sandbox,arch,descriptive,contracts}/  + steps/
├── <composant>/features/
├── stryker.config.json
├── cucumber.mjs
├── baseline/{tasks,results}/              # brique 0, reportée
├── bench/                                 # banc de preuve, hors production, importé par rien (DC-8)
└── decisions/
```

### 7.2 Isolation du nom provisoire

Un seul fichier source, `platform.json` : `{ "name": "architect-os" }`. Tout le reste en dérive, et le scénario `features/descriptive/name.feature` échoue dès que le littéral apparaît hors de cette liste. Un renommage = changer une valeur, relancer `tools/build`, renommer le dépôt.

| Occurrence dérivée | Valeur provisoire |
|---|---|
| Dépôt, `package.json` racine | `architect-os` |
| Scope npm | `@architect-os/*`, dont `@architect-os/stage0` |
| Marketplace, plugin d'entrée | `architect-os`, `architect-os-gateway` |
| Serveur MCP de la gateway (`gateway/src/presentation/mcp-server.ts`) | `architect-os-gateway` |
| Noms de tools côté client | `mcp__plugin_architect-os-gateway_gateway__*` : à renommer en même temps dans les profils clients |
| Utilisateurs OS, serveur | `architect-os-gateway`, `architect-os-broker`, `architect-os-data` |
| Socket Postgres, serveur | `/run/architect-os/pg/.s.PGSQL.5432` |
| État local | `~/.architect-os/` |

Restes dans le dépôt, hors de ce document, qui disparaissent avec le code qui les porte (non modifiés ici, pas d'implémentation) : `compose.yaml` (`POSTGRES_USER: agentic`, `POSTGRES_DB: agentic`, `DATABASE_URL`), `services/memory/src/infrastructure/docker-runner.ts` et `docs/infrastructure.md` (préfixe `agentic-worker-`). `CHANGELOG.md` cite l'ancien nom à titre d'historique et ne change pas.

## 8. Marketplace et plugin d'entrée

### 8.1 `.claude-plugin/marketplace.json`

Fichier à `.claude-plugin/marketplace.json` ; `name`, `owner`, `plugins` requis ; chaque entrée exige `name` et `source` ; une source relative commence par `./` [V: https://code.claude.com/docs/en/plugins/marketplace-reference]. Pas de `version` dans les entrées, `plugin.json` la porte [V: même page]. `description` et `author` sont obligatoires en pratique : leur absence fait échouer `--strict` [T-11].

```json
{
  "name": "architect-os",
  "description": "Plateforme : MCP d'entrée vers la gateway et standards ai-architect.tools",
  "owner": { "name": "Clément Deust" },
  "plugins": [
    {
      "name": "architect-os-gateway",
      "source": "./plugins/architect-os-gateway",
      "description": "Déclare le serveur MCP d'entrée vers la gateway",
      "category": "platform"
    },
    {
      "name": "ai-architect-standards",
      "source": "./plugins/ai-architect-standards",
      "description": "Standards de revue ai-architect.tools",
      "category": "standards"
    }
  ]
}
```

### 8.2 `plugins/architect-os-gateway/.claude-plugin/plugin.json`

`mcpServers` inline, `type: "http"`, `userConfig` strict, `sensitive` stocké dans le coffre du système [V: plugins-reference#user-configuration]. OAuth est impossible en headless et dans le SDK : le jeton passe par `headers` [V: agent-sdk/mcp#oauth2-authentication]. `${user_config.gateway_url}` dans `url` passe `claude plugin validate . --strict`, code 0 [T-11].

```json
{
  "name": "architect-os-gateway",
  "displayName": "Gateway de la plateforme",
  "version": "0.1.0",
  "description": "MCP d'entrée vers la gateway",
  "author": { "name": "Clément Deust" },
  "license": "MIT",
  "mcpServers": {
    "gateway": {
      "type": "http",
      "url": "${user_config.gateway_url}",
      "headers": { "Authorization": "Bearer ${user_config.gateway_token}" },
      "alwaysLoad": true
    }
  },
  "userConfig": {
    "gateway_url": { "type": "string", "title": "URL de la gateway", "description": "Point MCP de la gateway", "default": "http://127.0.0.1:8080/mcp", "required": true },
    "gateway_token": { "type": "string", "title": "Jeton client", "description": "Jeton émis pour votre profil", "sensitive": true, "required": true }
  }
}
```

- `alwaysLoad` empêche que le méta-tool `search` soit lui-même différé [V: mcp#exempt-a-server-from-deferral]. Il ne porte que sur le serveur des méta-tools : le catalogue de repli a son propre point d'entrée (§5.2). Présence de la clé dans ce schéma [À PROUVER: T-11b, Gherkin, brique 1c].
- CI : `userConfig` suppose une invite humaine ; la CI garde `--mcp-config`, `plugin_marketplaces`, `plugins: ai-architect-standards@architect-os` [V: github-actions#run-a-skill]. Les deux formes de noms de tools figurent dans les profils clients.
- Validation : `claude plugin validate . --strict`, en scénario Gherkin (D-6).

## 9. Profils : moindre privilège par fichier descriptif

Un profil tient en deux fichiers au format de l'amont, sans format maison.

### 9.1 `agents/scout.md`, format Claude Code

```markdown
---
name: scout
description: Lit le dépôt en lecture seule et répond avec des citations.
tools: Read, Grep, mcp__platform__memory_search
model: sonnet
maxTurns: 8
---
Prompt du profil.
```

Champs reconnus et clés inconnues ignorées [V: sub-agents#frontmatter-reference]. **Chargement** : le worker lit ces fichiers (frontmatter + corps, 15 lignes avec `yaml`, déjà dépendance du dépôt) et les passe par `agents` + `agent`. Le chargement par `plugins` + `agent` a appliqué `model` et `tools` mais **le corps du prompt n'a pas atteint le modèle** sur Claude Code 2.1.312 ; `agents` et `systemPrompt` fonctionnent [E-08]. Les agents de plugin ignorent de toute façon `hooks`, `mcpServers` et `permissionMode` [V: sub-agents#choose-the-subagent-scope]. La politique (`permissionMode: 'dontAsk'`, `settingSources: []`, `strictMcpConfig`) reste dans le code : c'est un plancher de sécurité, pas un comportement (`CLAUDE.md`, « Descriptive files before code »).

### 9.2 `sandboxes/profiles/scout.srt.json`

```json
{
  "network": { "allowedDomains": [], "deniedDomains": [], "strictAllowlist": true },
  "filesystem": { "denyRead": ["~"], "allowRead": ["."], "allowWrite": ["."],
                  "denyWrite": ["./repo", ".git/hooks", ".git/config", ".mcp.json", ".claude"] }
}
```

Faits établis :

- **Clés inconnues tolérées** : `strictAllowlistt` passe sans erreur, donc un schéma zod strict du dépôt, en scénario Gherkin, est obligatoire. Fichier absent ou type invalide : srt refuse de démarrer [T-01].
- `denyRead: ["~"]` masque le home, Node démarre, `allowRead` rouvre `.` et `~/inst`, un `denyRead` plus spécifique reste refusé, un chemin relatif `../x` est accepté [T-02]. **Le refus n'a pas la même forme selon l'OS** : macOS répond `EPERM`, Linux monte un `tmpfs` à la place de `~` (`ENOENT` sur `~/.ssh`, liste de `~` = le seul dossier de travail, écritures éphémères) [T-38, T-41c, banc 1b.0]. Les assertions portent donc sur « rien de sensible visible, rien de persisté sur l'hôte » (T-02b, T-02d2, T-02e*), jamais sur un code d'erreur précis.
- Tâche = répertoire jetable sous `~/.architect-os/tasks/<id>/`, `cwd` de la sandbox. Le home étant refusé, l'état de la plateforme et les autres tasks le sont aussi. `./repo` est une copie jetable, faite elle-même sous srt (profil `repo-prepare`) depuis une source déclarée par le profil client, donc aucun chemin variable, aucun gabarit. Le mécanisme de la copie est fixé par la règle de copie ci-dessous (DC-2).
- L'adaptateur ajoute au profil validé la seule valeur dynamique, le port du broker, et écrit le résultat **hors** de `allowWrite`. Il passe toujours `--settings` : sans lui, le runtime démarre sur ses réglages par défaut [V: https://code.claude.com/docs/en/sandbox-environments#what-the-runtime-blocks-on-its-own].
- srt doit être installé hors de tout chemin inscriptible : une copie dans un `node_modules` inscriptible serait réécrite puis exécutée sans sandbox [V: README srt, « Where This Package Is Installed »]. Scénario d'évasion dédié.
- **Chemins protégés : règle de profil.** Les chemins sensibles (`.git/hooks`, `.git/config`, `.mcp.json`, `.claude`, à la racine de la copie **et** dans un dépôt imbriqué `repo/.git/…`) sont **nommés en `denyWrite`**, chacun en chemin littéral, jamais laissés à la protection automatique de srt. Sous Linux, srt ne protège que ce qui existe au lancement : **T-02e et T-02e2 ont échoué** au banc (une sandbox a écrit `.git/hooks/pre-commit` et `repo/.git/config`, qui **persistent sur l'hôte**, où un `git` exécuté hors sandbox les lira ou les exécutera). T-02e3 (dépôt présent à la racine au lancement) tient. **T-02e4, avec `denyWrite` explicite, passe sur les deux OS** (Linux : `ENOENT`, `EROFS`, `EACCES` ; macOS : `EPERM` ; rien ne persiste). La règle s'applique au profil builder et à **tout profil qui écrit** (executor, modules, scout, zetetic-reviewer, agent-worker, repo-prepare, web-scout, db-migrator, gate-tests). L'adaptateur écrit ces chemins en absolus sous le `cwd` de la task, comme T-02e4. Le schéma strict du profil refuse un profil avec écriture dépourvu de ces `denyWrite`. À faire en 1b.1, avec son scénario ; le banc ne teste que la forme absolue.
- **Copie du builder (DC-2).** Le document ne disait pas comment `./repo` est copié (contre-expertise, §2.1) ; c'est décidé.
  1. **Clone `git clone --no-hardlinks`** (ou clone depuis un bundle), **jamais un `git worktree`** ni un clone local par liens durs. Prouvé pour le worktree (`fable/git`) : `wt/.git` est un **fichier** `gitdir: …/main/.git/worktrees/wt`, `git rev-parse --git-path hooks|config|objects` résout depuis la copie dans `main/.git/…`, un `pre-commit` écrit « depuis la copie » est apparu dans `main/.git/hooks/` et a été **exécuté** par un `git commit` dans le dépôt de l'hôte ; `denyWrite: repo/.git/hooks` est sans objet puisque `repo/.git` n'est pas un répertoire. Déduit, non joué : un clone local sans `--no-hardlinks` partage les fichiers d'objets par liens durs avec la source, et la sandbox, propriétaire des inodes, peut `chmod` puis écrire, donc corrompre le magasin d'objets de l'hôte ; T-34e ne couvre pas ce cas (il montre que **créer** un lien dur vers une zone protégée est refusé, `EPERM` sous macOS, `EXDEV` sous Linux, et le fichier écrit est un fichier neuf).
  2. **Sortie par bundle.** La sandbox produit un `git bundle` dans la copie ; l'hôte fait `git fetch <bundle>` avec `fetch.fsckObjects=true`. Prouvé (`GIT_TRACE`) : `git fetch <chemin>` lance `git-upload-pack` **dans** la copie, qui lit la configuration de la copie (et `objects/info/alternates`, déduit) ; avec un bundle créé dans la copie et lu par l'hôte, seuls `rev-list` et `maintenance run --auto` tournent côté hôte et **aucun processus n'est lancé dans la copie**. C'est la seule voie qui respecte « l'hôte n'exécute rien de la copie » à la lettre.
  3. **L'hôte ne lance rien dans la copie et ne l'ouvre dans aucun outil** : ni Claude Code (les hooks de `.claude/settings.json` sont exécutés à l'ouverture), ni VS Code (`.vscode/tasks.json`), ni direnv (`.envrc`) ; **`npm ci --ignore-scripts`** (déduit : `npm ci` exécute les scripts de cycle de vie ; `ci.yml` l'appelle sans `--ignore-scripts`, `bench-sandbox.yml` avec). Contenu hostile extrait sur l'hôte lors de la contre-expertise : un `.gitattributes` `* filter=evil` est ignoré (driver non défini), un sous-module `url = ../sub` est refusé (`protocol.file.allow` non défini, git 2.54) ; un `filter=lfs` avec `git-lfs` en configuration globale exécuterait `git-lfs smudge` sur l'hôte : déduit, non prouvé (pas de configuration lfs sur le poste).
  4. **Le nommage et `denyWrite` restent une défense en profondeur, pas la fermeture.** Le README srt (« Linux search depth ») dit que `ripgrep` cherche à trois niveaux au plus, qu'un répertoire dangereux vide « can be filled », et la forme `{ "path": …, "literal": true }` exige de connaître le nom : aucune liste ne couvre un dépôt dont le nom n'existe pas au lancement.
  5. **T-34h et T-34i, run 41044838678.** T-34h (dépôt imbriqué supplémentaire `repo2`, présent au lancement, non nommé en `denyWrite`) : Linux **`fail`** (`{"hook":"OK","config":"EROFS"}`, `repo2/.git/hooks/pre-commit` persiste sur l'hôte), macOS `pass` (`EPERM` deux fois). T-34i (dépôt `repo3` créé après le démarrage) : Linux **`fail`** (`{"hook":"OK","config":"OK"}`, `repo3/.git/config` et `repo3/.git/hooks/pre-commit` persistent), macOS `pass`. Ils échouent **avec la règle de profil active** (les chemins protégés de la racine et de `repo` sont nommés) : ce ne sont pas des comportements « bruts » (DC-7). Hypothèse pour T-34h, **non prouvée** : `layout()` (`bench/src/tests/paths.ts`) crée `repo2/.git/hooks` **vide** et le balayage `ripgrep` voit des fichiers, pas des répertoires vides ; un dépôt cloné avec `--template=` vide a exactement cette forme. À prouver par une **variante T-34h avec `repo2/.git/hooks` non vide** [À PROUVER: banc]. T-34h et T-34i **restent `fail` sous Linux tant que le scénario de copie ci-dessus n'est pas prouvé** : [À PROUVER: Gherkin, hook, `core.fsmonitor`, `.gitattributes` `filter=lfs`, `.gitmodules` et pack malformé dans la copie, rien n'est exécuté ni importé sur l'hôte ; brique 1a.0].
- **Dossier temporaire par sandbox.** srt fixe `TMPDIR=/tmp/claude` dans la sandbox sans le créer ; `tsx` (Linux : `ENOENT` sur `mkdir /tmp/claude/tsx-1001`) et le binaire Claude Code (macOS : `EPERM` sur `mkdir /tmp/claude-501`, absent du runner et présent sur le poste, d'où un faux vert local) y font un `mkdir` non récursif. L'adaptateur crée donc **un dossier temporaire par sandbox**, le passe par `CLAUDE_CODE_TMPDIR` et l'ajoute à `allowWrite`. Le banc ne les nettoie pas ; l'adaptateur doit les retirer à l'arrêt (test à écrire en 1b.1).

Sous Linux : `allowWrite` et `denyWrite` n'acceptent que des chemins littéraux, et un `denyRead` ne masque que ce qui existe à l'emballage [V: README, « Path Syntax (Linux) »]. D'où T-02L, joué au banc 1b.0 : T-02e et T-02e2 en échec, T-02e4 en correctif (ci-dessus) ; rejoué par `gate-linux`, brique 1b.

| Profil | Réseau | Lecture | Écriture | Modèle |
|---|---|---|---|---|
| executor | aucun | `.`, dist de l'executor | `.` (session) | aucun |
| module-`<nom>` (data, workflow, plugin) | gateway `127.0.0.1:8080` par le proxy srt | `.`, dist du module, ressources du manifeste | `.` | aucun, sauf Structurer et Judge selon manifeste |
| scout | broker de la task | `.`, `./repo` | `.` sauf `./repo` | sonnet |
| builder | broker de la task | `.` | copie jetable `.` (clone `--no-hardlinks`, sortie par bundle, DC-2), `node_modules` fourni en lecture seule par l'hôte, jamais inscriptible ; `denyWrite` nommés des chemins protégés (T-02e4), défense en profondeur | sonnet |
| zetetic-reviewer | broker de la task | `.`, `./repo`, diff | `.` sauf `./repo` | opus |
| agent-worker | broker de la task | `.` | `.` | selon manifeste |
| repo-prepare | aucun | source déclarée par le profil client | `.` | aucun |
| web-scout (O-27) | allowlist du manifeste + `deniedResolvedAddresses` sur plages privées | `.` | `.`, sortie en quarantaine par tool MCP | aucun |
| db-migrator (O-28) | aucun ; Postgres jetable dans la sandbox | `.`, migrations du plugin | `.` | aucun |
| gate-tests (CI) | aucun vers l'extérieur ; Postgres de test et serveur interne de Stryker dans la sandbox (C-17) | merge, `node_modules` | merge, `reports/` | aucun |

La colonne « Réseau » nomme l'accès **interne** (gateway, broker) ; elle ne dit rien de l'`egress` du manifeste, qui ne désigne que la sortie externe (§10).

**Exigences d'hôte, établies par le banc 1b.0** :

| OS | Exigences | Remarque |
|---|---|---|
| Linux (`ubuntu-24.04`, bubblewrap 0.9.0) | `bubblewrap`, `socat`, `ripgrep`, et `kernel.apparmor_restrict_unprivileged_userns=0` | Ce sysctl est **global** : il lève, pour tous les processus de l'hôte, la restriction des espaces de noms utilisateur non privilégiés, donc il affaiblit une protection de l'hôte. À porter dans le STRIDE (§11.3), la brique D et la décision ouverte O-31. `claude-code-action` le pose lui-même [V: `action.yml`]. Alternative documentée : profil AppArmor dédié [V: README], non testée ici |
| macOS | `sandbox-exec` (`/usr/bin/sandbox-exec`) | Aucun paquet. `ripgrep` était absent du runner et les tests ont passé : il n'est pas exigé sur macOS |
| Les deux | Un dossier temporaire par sandbox (`CLAUDE_CODE_TMPDIR` et `allowWrite`) | Voir ci-dessus |

Appelant non root recommandé [V: README, « Running as root »].

## 10. Manifeste de module

```yaml
name: memory-recall
version: 1.2.0
domain: memory
owner: cortex
transport: stdio             # toujours ; http refusé par schéma (T-39b : impossible sous srt)
tools:
  - name: recall
    description: Rappel typé, filtré en SQL, rerank par Judge
    input_schema: ./schemas/recall.in.json
    output_schema: ./schemas/recall.out.json
    kind: workflow           # data | workflow | agent (D-4)
    annotations: { readOnlyHint: true, idempotentHint: true }
    response_format: [concise, detailed]
    max_result_tokens: 600
    latency_budget_ms: 200
    validator: schema        # schema | verify | spec-lint | citations | none
sandboxes:
  - profile: module-memory-recall   # module data|workflow : un processus srt permanent
    internal_access: [gateway]      # accès interne : 127.0.0.1:8080 par le proxy srt ; ce n'est pas un egress
    egress: none                    # sortie externe : aucune, appliquée par le profil
writes_tables: []
reads_domains: [memory]
calls_allowed: [judge]
model_min: none
```

```yaml
name: codebase-ask
version: 0.3.0
domain: code
owner: ai-architect-mcp-codebase
tools:
  - name: ask
    kind: agent
    annotations: { readOnlyHint: true }
    max_result_tokens: 1000
    validator: citations
sandboxes:
  - profile: scout            # agents/scout.md + sandboxes/profiles/scout.srt.json
    internal_access: [broker]   # le broker de CETTE task ; le worker parle à la gateway en stdio, sans réseau
    egress: none                # sortie externe : aucune
    model_min: sonnet
    budget_tokens: 40000
    timeout_ms: 120000
    limits: { memory_mb: 1024, pids: 128 }   # Linux, hors srt ; macOS : résidu §11.1
writes_tables: []
reads_domains: [code, memory]
calls_allowed: [code-index, memory-recall]
```

`annotations` : `readOnlyHint` autorise le parallélisme, `idempotentHint` une relance HTTP [V: mcp#mark-tools-that-are-safe-to-call-twice]. `response_format` et pagination suivent « Writing effective tools » (§16). Règles, chacune un scénario Gherkin : tout tool a une sandbox, aucun manifeste ne peut déclarer un processus natif ; tool `data`/`workflow` ⇒ un profil de module sans broker, permanent, ou un profil à la demande sans modèle (web-scout, db-migrator) ; tool `agent` ⇒ un worker par task ; `writes_tables` disjoints ; `calls_allowed` acyclique ; **`egress` ne désigne que la sortie externe** (`none` ou une allowlist de domaines) et égale les domaines externes de `network.allowedDomains` du profil ; **`internal_access`** désigne l'accès interne, énumération fermée `gateway` | `broker`, et égale les entrées de loopback du profil (gateway `127.0.0.1:8080`, port du broker de la task) ; une valeur hors énumération, ou un accès interne absent du manifeste mais présent dans le profil, est refusé ; `egress` ≠ `none` ⇒ quarantaine, **`internal_access` seul n'impose aucune quarantaine** (communication MCP interne, bornée par le jeton d'appel et le DAG) ; un tool `agent` déclaré `stable: true` est refusé (D-4). Le changement de `kind` de `memory-recall` de `data` à `workflow` relève de D-4 et C-5. Aucun fichier de schéma de manifeste n'existe encore dans le dépôt : le champ `internal_access` et son énumération sont fixés ici et entrent dans le schéma zod de `packages/contracts` avec le chargeur de manifeste (1b.4) [À PROUVER: scénario Gherkin, 1b.4].

## 11. Sécurité : modèle de confiance, STRIDE, invariants

### 11.1 Modèle de confiance, écrit

**srt n'est pas tenu pour équivalent à une VM ni à un conteneur renforcé.** La doc Anthropic classe sandbox-runtime « bon » à surcoût très faible, gVisor « excellent » et conseillé pour le multi-tenant et le contenu non fiable, VM « excellent » ; le noyau reste partagé [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment#isolation-technologies]. srt se présente lui-même comme « Beta Research Preview » [V: README].

**Portée autorisée : usage local ou utilisateurs fiables d'abord. Le déploiement multi-utilisateur est bloqué** tant que la suite d'évasion, d'accès aux secrets et d'isolation intersessions (§11.4) ne passe pas sur Linux **et** macOS. Lever ce blocage ne suffit pas à rendre srt adapté à du contenu hostile multi-tenant : ce serait une décision du propriétaire, avec une VM à évaluer selon le §4.11 (O-22). Anthropic conseille une VM dédiée pour un dépôt non fiable [V: https://code.claude.com/docs/en/sandbox-environments#choose-an-approach].

**Hypothèse de déploiement (DC-5).** En local : « poste du propriétaire, un seul uid ». Sur serveur : un uid dédié à la **plateforme** (pas un uid par task), sans autre logiciel sous cet uid. Le périmètre qu'un natif du même uid peut lire (T-43d) est l'hôte seulement ; ce que voit un processus à l'intérieur d'une sandbox est l'objet de T-43e, non joué.

Résidus assumés sous ce modèle :

| Résidu | Fait | Fermeture |
|---|---|---|
| macOS : un enfant `setsid` survit à la mise à mort du groupe, garde son profil Seatbelt et devient orphelin (PPID 1) | T-06b | Linux : espace PID de bubblewrap, **fait au banc 1b.0 : 0 survivant** (T-06b), à rejouer par `gate-linux`, brique 1b. macOS : survivant constaté (`après kill du groupe : 1`), aucune fermeture, poste de développement seulement |
| macOS : aucune limite mémoire ou PID par sandbox. `ulimit -u` compte par utilisateur, donc inapplicable par task, et le shell est lui-même refusé à 200 | T-09 | Linux : `systemd-run`, [À PROUVER: T-09L, `gate-linux`, brique 1b]. macOS : timeout, budgets |
| Poste : gateway, broker et data partagent un uid ; modules et workers sont sous srt | T-24 sous Linux (`/proc/<pid>/environ`). Sous macOS, T-24 avait vu que `ps eww` ne montre pas l'environnement, mais T-43d lit l'autorisation avec `ps -Eww -p <pid>` (`autorisation_lue=true`, run 41044838678) : ce n'est donc pas non plus une frontière sous macOS | Serveur : utilisateurs dédiés, T-26 |
| Exfiltration par un domaine autorisé | [V: README, « Security Limitations »] | Sandbox de modèle : seul le broker, `POST /v1/messages` ; le contenu reste un canal vers l'API |
| Amont qui refléterait l'en-tête `x-api-key` | E-05c | Frontière : le broker n'envoie la clé que dans le seul `x-api-key` vers l'hôte amont fixe (§11.2). Retrait dans les réponses : défense supplémentaire, contournable ; T-23d sur les deux OS ; [À PROUVER: T-23b, Gherkin, brique 1b ; T-04R] |
| Gateway compromise : compromission totale, elle signe les jetons et lance les sandboxes | §4.8 | Code court, enveloppes seules, enfant hostile T-40. Aucune fermeture sous ce modèle : usage local ou utilisateurs fiables |
| Autorisation de task lisible par un processus natif du même uid, dans l'environnement du processus srt (mécanisme T-24, constat T-43d) | Linux : `/proc/<pid>/environ` ; macOS : `ps -Eww -p <pid>` ; rejeu `200`, une requête amont ajoutée (les deux OS) | **Accepté (DC-5)** : valable pour une task, plafonnée par sa réservation, révoquée à la fin, jamais la clé (T-42d, T-43b). Lecture depuis l'intérieur d'une sandbox : [À PROUVER: T-43e, attendu refus sur les deux OS]. Serveur : un uid dédié à la plateforme |
| Clé réfléchie par un amont, réencodée en base64, hexadécimal ou répartie dans un flux SSE fragmenté, puis lue par le worker | T-42h-base64, T-42h-hex, T-42h-sse-split : `residual` sur les deux OS (la forme brute et la forme en deux morceaux sont retirées) | **Accepté jusqu'à T-04R (DC-6)** : le corps envoyé ne contient jamais la clé (T-42d) ; le vecteur est un amont qui reflète l'en-tête ; le broker ne relaie que `/v1/messages`, jamais `/v1/oauth/*` ; retrait en flux en 1b.2 |
| Un module sous srt détient le jeton de son appel en cours | §4.4 | Audience, capacités et échéance limités à cet appel |

### 11.2 Clé : T-04 devient bloquant, et il a échoué

| Test adversarial (T-04, macOS) | Résultat | Lecture |
|---|---|---|
| a. Environnement de l'enfant | `fake_value_<uuid>`, la clé n'apparaît dans aucune variable | Tient |
| b. Table des processus (`ps -axeww`, `ps eww <parent>`) | `EPERM` | Tient |
| c. Erreurs | Sans CA amont : `502`, pas de clé. 401 de l'amont : pas de clé | Tient |
| f. Hôte autorisé hors `injectHosts` | L'amont reçoit la sentinelle | Tient |
| g. Redirection vers un tel hôte | L'amont reçoit la sentinelle | Tient |
| i. `CONNECT` vers `evil` + `Host: bench` | Sentinelle | Tient |
| j. HTTP clair vers l'hôte d'injection | Sentinelle | Tient |
| **e. Requête modifiée : sentinelle dans le corps ou un autre en-tête** | **L'amont reçoit la vraie clé** | **Échec.** Substitution voulue par srt (`body-substitution.js`), sans option pour la restreindre aux en-têtes |
| **d. Amont qui reflète l'en-tête** | **L'enfant reçoit la vraie clé** | **Échec** |

Attaque complète qui découle de **e** : l'enfant écrit la sentinelle dans un message utilisateur, le proxy la remplace par la clé réelle, le modèle reçoit la clé et peut la recopier dans sa réponse, l'enfant la lit. L'étape « le modèle recopie » n'a pas été jouée (aucun appel réel), mais rien ne l'empêche. **`mask` est donc écarté pour tout hôte qui reflète du contenu, API de modèle comprise.**

Autres défauts relevés sur le document précédent : `injectHosts: ["api.anthropic.com:443"]` y était **invalide**, srt 0.0.81 refuse les ports et les IP dans `injectHosts` ; `mask` sans `tlsTerminate` est refusé [T-04, T-01]. La doc ne décrit `mask` que pour le sandbox intégré et les commandes Bash [V: sandboxing#protect-credentials], et ne mentionne pas la forme autonome.

**Alternative retenue : broker par task** [E-05, T-23], patron recommandé par Anthropic [V: secure-deployment#the-proxy-pattern] et déjà exigé par `CLAUDE.md` (« Secrets go through the secrets broker only ») :

- L'enfant n'a ni clé, ni sentinelle de cette clé : le vecteur **e** n'existe plus pour elle. L'amont a bien reçu la vraie clé, le corps n'en contenait aucune trace [T-23].
- **Un listener par task : le port route, il n'identifie pas.** Seul le profil srt de cette task autorise ce port, ce qui sépare les sandboxes entre elles (T-03 : direct refusé, port non listé refusé, port listé accepté). Mais n'importe quel processus natif peut joindre un listener en loopback. L'identité vient donc de l'autorisation de task, ci-dessous.
- `POST /v1/messages*` seulement ; `/v1/models` et `GET` : 403 ; amont direct et internet : refusés [T-23]. **Jamais `/v1/oauth/*`** (DC-6) : un point OAuth renvoie des jetons dans son corps par conception.
- L'Agent SDK fonctionne intégralement par ce chemin, outils et sortie structurée compris [E-05].
- **Garantie.** Le broker ne transmet **jamais ses propres informations d'authentification à l'amont, ni dans le corps ni dans un en-tête non autorisé**. Il construit lui-même la requête amont : la clé réelle est posée dans le seul `x-api-key`, tout en-tête d'authentification venu du client est écarté, le corps est transmis tel quel. Le corps ne peut pas la contenir : la sandbox n'a jamais eu la clé, et une autorisation de task trouvée ailleurs que dans `x-api-key` est refusée (`LEASE_OUT_OF_PLACE`, ci-dessous). C'est cette construction, côté requête, qui est la frontière. Corps sans clé : [T-23, deux OS]. Construction complète, en-têtes compris : T-42d au banc (7 requêtes amont, aucune ne porte l'autorisation, la clé est dans le seul `x-api-key`, les deux OS) ; [À PROUVER: T-23b, Gherkin, brique 1b].
- **Retrait dans les réponses : défense supplémentaire, pas frontière principale.** Le broker retire aussi la clé des réponses et l'en-tête `content-length`. Le banc a montré que sans ce retrait un amont réfléchissant renvoie la clé (`FUITE`, témoin T-23d-none), qu'un retrait qui garde `content-length` coupe la connexion (`UND_ERR_SOCKET`, pas de fuite) [E-05c], et que le retrait complet ne laisse rien passer sur les deux OS (T-23d-keep-length, T-23d-full). Mais une valeur peut être **transformée, encodée, fragmentée ou répartie dans un flux SSE** : une recherche de la chaîne ne l'arrête pas. Ce qui borne le cas résiduel d'un amont qui reflète l'en-tête, c'est un hôte amont fixe (`api.anthropic.com`, TLS, allowlist) et la frontière côté requête. Le retrait du banc travaille sur un corps bufferisé ; en flux, à faire en 1b.2. **T-42h (run 41044838678)** confirme la limite : face à un amont qui reflète l'en-tête, un retrait littéral bufferisé arrête la forme brute et la forme en deux morceaux, mais la clé réencodée en base64, en hexadécimal ou répartie dans un flux SSE fragmenté atteint le worker (`residual`, trois cas sur les deux OS). Accepté jusqu'à T-04R (DC-6). Comportement réel de `api.anthropic.com` sur requêtes invalides [À PROUVER: T-04R, banc avec clé, brique 1b].

Le broker lui-même reste à relire contre `https://code.claude.com/docs/en/agent-sdk/secure-deployment` à l'implémentation : `ANTHROPIC_BASE_URL` passe le trafic de modèle en clair jusqu'au proxy local, ce qui est le cas prévu [V: même page].

**Identité d'une requête : étude.**

| Option | Verdict | Raison |
|---|---|---|
| Port seul | **Refusé** | Un processus natif étranger joint le listener et consomme la clé sans la lire |
| Socket Unix avec identifiants du pair | **Écarté** | Sous Linux, `allowUnixSockets` est ignoré et seccomp bloque `socket(AF_UNIX)` [V: README srt, « Unix Socket Settings », « Unix Socket Restrictions (Linux) »] ; `allowAllUnixSockets` est interdit par schéma. Le trafic passe par le proxy srt, donc le pair serait ce proxy, pas la task. Sur un poste, l'uid ne distingue rien. `node:net` n'expose aucun identifiant de pair (`Socket.prototype`, Node 26.11.1) : il faudrait un addon natif |
| Jeton dans l'environnement ou un en-tête de l'enfant | **Refusé** | Lisible par le modèle via Bash ou le processus |
| Association port source et processus (`/proc/net/tcp`, `lsof`) | **Écarté** | Course entre connexion et lecture, propre à chaque OS, inutile entre processus de même uid |
| **Autorisation déposée hors sandbox par srt** | **Retenue** | L'enfant ne voit qu'une sentinelle, le proxy srt côté hôte pose la valeur à la sortie |

**Mécanisme retenu.** Le broker émet, pour chaque task, une autorisation aléatoire de 256 bits. La gateway la passe dans l'environnement du seul processus `srt`, avec `credentials.envVars: [{ name: "ANTHROPIC_API_KEY", mode: "mask", injectHosts: ["broker.localhost"] }]` et `network.tlsTerminate`. Le binaire envoie la sentinelle, le proxy la remplace, le broker compare en temps constant, puis remplace la valeur par la vraie clé. T-04 montre que cette substitution fonctionne et qu'elle s'applique aussi au corps. D'où trois règles au broker : une requête qui contient l'autorisation ailleurs que dans `x-api-key` est refusée (`LEASE_OUT_OF_PLACE`), l'autorisation est retirée de toute réponse, et le listener ferme avec la task. Si le modèle apprenait quand même cette valeur, il ne gagnerait rien : il n'a réseau que vers ce broker, avec ce budget. `tlsTerminate` est marqué expérimental [V: README srt] et sa dépendance est écrite au §4.11. **Mécanisme joué au banc** (run 41044838678, faux amont, macOS et Linux, tous `pass`) : T-42a le worker ne lit pas l'autorisation (il voit la sentinelle `fake_value_*`) ; T-42b un `POST /v1/messages` ordinaire passe (`200`, sentinelle remplacée par l'autorisation) ; T-42c une sentinelle placée dans le corps, un autre en-tête ou `Authorization` est substituée par srt (preuve de T-04 e) puis **refusée par le broker**, `LEASE_OUT_OF_PLACE`, quatre fois sur quatre ; T-42d sur 7 requêtes amont, aucune ne porte l'autorisation et la clé n'est que dans `x-api-key` ; T-42e une sentinelle envoyée à un autre hôte autorisé n'arrive que comme sentinelle ; T-42f sans `x-api-key` valide, `401` ; T-42g l'autorisation n'apparaît dans aucune réponse reçue par le worker. **Test du natif étranger** : T-43a, huit formes d'appel sans autorisation valide (sans en-tête, sentinelle, clé vide, autorisation de B, autorisation de B en `Authorization`, préfixes, la vraie clé amont), `401` à chaque fois et aucune requête amont ajoutée ; T-43b l'autorisation de la task A sur le listener de B donne `401 LEASE_INVALID`, sur A `200`, après fermeture `ECONNREFUSED` ; T-43-témoin (broker sans autorisation) : `200` et clé à l'amont, ce qui donne sa valeur au test. Le P0 « BROKER-FOREIGN » du §19.1 est donc **fermé au banc** pour un processus qui ne connaît pas l'autorisation. **Restent ouverts** : T-43d (un natif du même uid la lit, accepté, DC-5), T-42h (trois résidus, accepté jusqu'à T-04R, DC-6), T-04R avec une vraie clé, et `tlsTerminate`, que srt marque expérimental.

**Compte Claude du propriétaire pour l'outil de code isolé (DC-9).** L'outil de code personnel (brique 1a.0) s'authentifie avec le compte Claude du propriétaire. Documenté (page overview de l'Agent SDK, note lue le 2026-10-30 [V: https://code.claude.com/docs/en/agent-sdk/overview]) : Anthropic « does not allow third party developers to offer claude.ai login or rate limits » pour leurs produits, agents du SDK compris, sauf approbation préalable, et renvoie vers l'authentification par clé API. L'usage personnel du propriétaire sur son poste n'est pas une offre à des tiers, et le dépôt emploie déjà `CLAUDE_CODE_OAUTH_TOKEN` dans deux workflows (nom du secret seulement) ; la zone grise est tranchée par le propriétaire. **Clé API obligatoire dès que la plateforme sert quelqu'un d'autre.** Conséquences de conception :

- Le **broker détient le jeton OAuth et son rafraîchissement**. Si le binaire Claude Code lisait lui-même le jeton, il serait dans la sandbox (fichier ou environnement), lisible par Bash, et le rafraîchissement **réécrit** le fichier d'identifiants, ce qui est incompatible avec `mask`. Aucun identifiant dans la sandbox ; `CLAUDE_CONFIG_DIR` par task, `settingSources: []`.
- Mode **`Authorization: Bearer`** : le worker envoie la sentinelle en `Authorization`, le broker pose le vrai jeton. `bench/src/lib/lease-broker.ts:134` (`AUTH_HEADERS`) écarte aujourd'hui `authorization` et pose `x-api-key` : à étendre. L'emplacement licite de l'autorisation de task change dans ce mode (`Authorization` au lieu de `x-api-key`), donc la règle `LEASE_OUT_OF_PLACE` et T-42c sont à adapter, et **T-42 est à rejouer en Bearer** [À PROUVER: banc, brique 1a.0].
- **Aucun relais OAuth** : le rafraîchissement est fait par le broker lui-même, jamais depuis une sandbox ; `/v1/oauth/*`, `/v1/oauth/token` compris, est refusé.

### 11.3 STRIDE, mis à jour pour chaque changement de topologie

| Menace | Vecteur | Contrôle | Statut |
|---|---|---|---|
| **S** | Un processus local appelle un module | Local : pas de port, stdio avec un seul parent. Jeton d'appel `aud` vérifié par le module | T-21 ; T-25 en brique 2 |
| S | Une sandbox présente l'identité d'une autre | Identité = fermeture du handler ; au broker, autorisation de task posée hors sandbox | E-02, E-03, T-03 (deux OS) ; T-42 et T-43b (deux OS, run 41044838678) |
| S | Un processus natif étranger joint un listener du broker | Autorisation de task comparée à chaque requête, `401` sinon | T-43a et T-43b passent sur les deux OS ; le témoin (broker sans autorisation) obtient `200` et la clé à l'amont. **P0 fermé au banc** (faux amont) ; T-43d : un natif du même uid lit l'autorisation, constat accepté (DC-5) |
| S | Rejeu d'un jeton entre deux tâches | `task`, `jti`, `exp`, `aud` signés | T-21 |
| S | Le module usurpe la gateway | Clé publique seule côté module | T-21 |
| **T** | Le builder modifie hooks git, `.mcp.json`, `.claude/agents` | `denyWrite` nommés pour chaque chemin protégé (la protection automatique de srt ne couvre pas les chemins absents au lancement sous Linux) + copie jetable (clone `--no-hardlinks`, jamais un worktree, DC-2) | T-02e4, T-02e5, T-02e6 passent sur les deux OS ; **T-02e, T-02e2, T-34h, T-34i : échecs réels sous Linux** (§19.2) ; scénario de copie à prouver |
| **E** | Un hook git ou `.git/config` écrit par la sandbox persiste sur l'hôte et est exécuté ou lu **hors sandbox** (élévation via hook exécuté hors sandbox) | `denyWrite` nommés dans tout profil avec écriture (défense en profondeur) ; fermeture : l'hôte ne lance rien dans la copie, bundle puis `git fetch` avec `fetch.fsckObjects=true`, `npm ci --ignore-scripts`, copie jamais ouverte dans un outil hôte (DC-2) | T-02e4 ; scénario de copie [À PROUVER: brique 1a.0] ; T-34h et T-34i restent `fail` sous Linux jusque-là |
| T | Une sandbox réécrit son profil ou le binaire srt | Profil rendu hors `allowWrite` ; srt hors chemins inscriptibles | [À PROUVER: T-34, évasion, brique 1b] |
| T | Du contenu non fiable influence un lancement, ou un module lance sans isolation | Signature fermée, argv statique, adaptateurs sans lecture ; `child_process`, srt et docker interdits hors `packages/sandbox` (DC-1) | T-47, T-52 étendu aux briques 1a.0 et 1b |
| T | Une PR modifie la porte, un filtre ou une assertion | `pull_request_target`, code de la base ; mutation étendue | §13.8, T-22 ; sentinelles en 1a |
| T | Une PR hostile remplace les steps et produit un rapport vert sans assertion | **Non couvert par la porte**, écrit : diff visible, revue, O-23 | **T-44 : la PR passe**, I-8 |
| T | Le code de test de la PR altère la porte sur le runner | Tests sous srt `gate-tests`, la porte est le processus parent | §13.8 ; T-35 en 1a |
| **R** | Une exécution nie un appel | Registre append-only (`0003_runs_immutable.sql`) ; chaque appel journalisé avec `task` et `jti` | Brique 2 |
| R | Un verdict ou un coût ne peut être attribué | Verdict validé ou gradé, tokens par couche et par modèle au registre (§4.9) | Brique 2, §15.1 |
| R | Le coût d'une requête interrompue est contesté | Réservation `unknown` persistée, transitions append-only, réconciliation avec source et auteur | T-45 en 1b.0, puis 1b.3 |
| **I** | Lecture de `~/.ssh`, de `.env`, de l'état | `denyRead: ["~"]` ; état sous `~` ; Linux : `tmpfs` (`ENOENT`), macOS : `EPERM` ; assertion « rien de sensible visible, rien de persisté » | T-02, T-02b, T-02d2, T-41c ; deux OS |
| I | Fuite de la clé Anthropic | Broker, aucune clé en sandbox | T-04, T-23 ; T-04R |
| I | Clé lue par un autre processus natif | Plus aucun module natif ; restent gateway et data. Serveur : un uid dédié à la plateforme. Poste : un seul uid, résidu assumé (DC-5) | T-24, T-43d, T-26 ; T-43e à jouer |
| I | Module compromis : lecture de `~`, de la clé, de Postgres, ou sortie réseau | Sous srt : `denyRead`, socket refusée, réseau limité à la gateway | T-38, I-10 |
| I | Accès Postgres depuis une sandbox, module compris | Socket refusée, aucun TCP | E-09 ; T-38 |
| I | Exfiltration par l'API de modèle | Inhérente ; budget, journal par task | Accepté, §11.1 |
| **D** | Bombe fork, mémoire, disque, sandbox sans fin, module compris | Budgets, `capacity`, timeout, terminaison vérifiée ; `limits` par profil, `systemd-run` sur Linux | T-20, T-06 ; T-27, T-09L |
| D | Tuer `srt` seul laisse des processus (SIGKILL : 10 sur 11 sous Linux, 2 sur 3 sous macOS) ; un enfant `setsid` survit sous macOS | L'adaptateur tue le groupe (`detached`, `kill(-pgid)`, `pgrep -g`, `SIGKILL`) | T-06-g-TERM, T-06-g-KILL passent sur les deux OS ; T-06b : 0 survivant sous Linux, résidu documenté sous macOS |
| D | Enfant hostile qui inonde son tube ou meurt, executor, worker ou module | `maxBufferSize` ; `stdin.on('error')` dans l'adaptateur ; gateway vivante | E-03 ; T-40 pour worker et module |
| D | Réservation rejouée, perdue, ou libérée à tort ; règlement rejoué ; facture supérieure | Une transaction, ordre de verrous uniforme (`budgets` d'abord) : verrou de la task, création unique, transition d'état unique, montant et task pris de la ligne persistée (§4.5) ; `unknown` jamais libéré, `overdrawn` | T-45a à T-45h passent sur l'ancien texte de `settle` ; **interblocage `40P01` reproduit** entre `reserve(X)` rejoué et `settle(X)` sur ce texte (§4.5) ; ordre uniforme `budgets` puis `budget_reservations` (DC-3), **SQL amendé à rejouer**, T-45l ; T-46 en 1b.3 |
| D | Mort d'un worker | Enfants indépendants | E-06 |
| D | Mort d'un module ou du broker | Reconnexion bornée, erreur nommée | T-30 |
| **E** | Évasion Linux par user namespace imbriqué | Filtre seccomp srt ; `allowNestedUserNamespaces`, `enableWeakerNestedSandbox`, `allowAllUnixSockets` interdits par schéma | [V: README] ; suite §11.4 |
| E | Descripteur hérité ouvrant un service de l'hôte | **Obligation de l'hôte** : descripteurs 0 à 2 créés par l'adaptateur, jamais hérités, imposée dans l'adaptateur `SandboxRunner` (§4.8). srt ne l'impose pas sous Linux | T-07-fd3 passe sur les deux OS ; **T-07-fd0 : échec réel sous Linux** (socket d'écoute en fd 0 utilisé par la sandbox), `EPERM` sous macOS ; la garde du banc (FD-PIPES-a à f) passe sur les deux OS ; reprise dans l'adaptateur [À PROUVER: brique 1a.0, 1b.1] |
| E | Exécution du code d'une PR en `pull_request_target` | Aucun secret, `contents: read`, aucun cache, aucun artefact consommé par un job privilégié | §13.8 |
| E | Argument bien typé, sémantique hostile : autre task, `../`, volume | Capacités et ressources vérifiées au point d'effet ; validateur `citations` sous srt | §4.10 ; T-51 |
| E | Contenu hostile qui vise les parseurs de la gateway | Enveloppes seules, aucun `eval`, aucun fichier construit depuis un argument | §4.8 ; T-40 |
| E | `kernel.apparmor_restrict_unprivileged_userns=0` : réglage **global** qui affaiblit une protection de l'hôte, exigé par srt sous Linux (E-07, banc 1b.0) | Runners jetables : accepté. Serveur : profil AppArmor dédié à `bwrap` (O-17), sysctl global non recommandé (O-31). Brique D | **O-31 reportée à la brique D** (DC-11) ; profil dédié et test de Docker/Podman rootless sans sysctl [À PROUVER: brique D] |
| E | srt en préversion | Épinglage exact, notes de version lues avant montée | §12 |
| **E** | Sous l'adaptateur OCI, la gateway lance des conteneurs par la socket Docker : elle est **équivalente à root** sur l'hôte, une compromission de la gateway vaut root (sous srt, un uid) | Socket Docker montée dans aucun conteneur ; mode rootless visé, `--userns-remap` sinon ; adaptateur OCI choisi par configuration explicite, sur les seuls hôtes où srt n'est pas supporté (DC-1) | Écrit ; [À PROUVER: banc Docker T-41D, T-38D, T-06D, T-34D, T-43D ; test rootless, brique D] |
| **S**, E | Isolation absente ou dégradée sans que personne le voie : srt non supporté, bascule silencieuse | Choix de l'adaptateur par configuration explicite, jamais de bascule ; canari au démarrage fermé à l'échec, `ISOLATION_UNAVAILABLE` ; `enableWeakerNestedSandbox` refusé par schéma | [À PROUVER: Gherkin, brique 1a.0 puis 1b.1] |
| S | Sous Docker, `--env` place l'autorisation de task dans le conteneur, lisible par le modèle ; `mask` n'existe pas | Socket Unix par task, fichier monté dans ce seul conteneur ; `SO_PEERCRED` non retenu sans addon natif | [À PROUVER: T-43D] |
| T, E, I | Lecture de la copie par l'hôte : worktree (hook écrit depuis la copie, exécuté par l'hôte : prouvé), liens durs (corruption du magasin d'objets : déduit), `git fetch <chemin>` (lance `upload-pack` dans la copie, qui lit sa configuration et `alternates`), outils hôte (scripts npm, hooks Claude Code, tâches VS Code, direnv) | Clone `--no-hardlinks`, bundle, `fetch.fsckObjects=true`, `npm ci --ignore-scripts`, copie jamais ouverte (DC-2, §9.2) | `fable/git` ; [À PROUVER: scénario Gherkin, brique 1a.0] |
| I | Jeton OAuth du compte du propriétaire (outil de code) | Broker seul détenteur et seul rafraîchisseur ; aucun identifiant dans la sandbox ; `/v1/oauth/*` jamais relayé ; clé API obligatoire dès qu'un tiers est servi (DC-9, §11.2) | [À PROUVER: T-42 rejoué en Bearer] |
| I | Canal d'exfiltration par un domaine autorisé : `registry.npmjs.org` pour un builder qui installe des dépendances [V: README srt, « Security Limitations »] ; scripts d'installation | `node_modules` fourni en lecture seule par l'hôte de préférence (O-12), `--ignore-scripts` ; allowlist documentée (§15, 1a.0) | Arbitrage du propriétaire avant 1a.0 |
| **T**, I | Actions de CI non épinglées avec un secret OAuth dans le job (`claude.yml`, `claude-code-review.yml`) ; `main` non protégée (API : 404), 0 ruleset | Épinglage par SHA des quatre workflows, `persist-credentials: false`, protection de `main` avec la porte requise avant 1a.8 ; lecture de `docs/security.md` de `claude-code-action` avant 1a (DC-4, §13.8) | Contre-expertise ; run vert après épinglage [À PROUVER] |
| T | Un workspace importe `bench/` (banc de preuve, hors production) | Garde dependency-cruiser interdisant d'importer `bench/` depuis un workspace, écrite dans `CLAUDE.md` (DC-8) | [À PROUVER: fixture de garde, brique 1a.6] |

Changements de topologie couverts : suppression de `platformd` (retire la clé et la socket de contrôle du point de concentration, concentre l'autorité de lancement dans une fonction de la gateway, §4.8) ; broker (détenteur unique, autorisation de task) ; modules et worker entier sous srt (retire le traitement natif du contenu non fiable ; il reste les enveloppes à la gateway et les corps au broker) ; modules en stdio (retire l'exposition TCP locale, la gateway devient parente) ; `data` en MCP (même surface, protocole officiel) ; adaptateur OCI (la gateway devient équivalente à root par la socket Docker) ; copie du builder (clone `--no-hardlinks`, sortie par bundle) ; jeton OAuth détenu par le broker. Le serveur ne change pas cette topologie : un module distant reste refusé tant que T-39 n'a pas tourné.

### 11.4 Suite d'évasion, secrets et intersessions (DAST, bloquante pour le multi-utilisateur)

`features/sandbox/escape.feature`, `secrets.feature`, `intersession.feature`, `broker-foreign.feature`, Linux et macOS, contre de vrais processus `srt` et chaque profil, module compris : lire un faux `~/.ssh/id_test` ; écrire hors `.` ; écrire `.git/hooks/pre-commit`, `.mcp.json` ; joindre `example.com`, `127.0.0.1:<module>`, `169.254.169.254`, le socket Postgres ; hériter d'un descripteur ; `unshare -r` ; réécrire son profil ou srt ; lire le répertoire d'une autre task ; joindre le broker d'une autre task ; joindre le broker depuis un natif étranger sans autorisation (T-43) ; rejouer un jeton ; récupérer la clé par environnement, erreurs, redirection, requête modifiée. Suite rejouée à chaque montée de version de srt (T-54).

### 11.5 Tableau d'invariants

| # | Invariant | Preuve automatisée | Fait, macOS | Linux | Brique |
|---|---|---|---|---|---|
| I-1 | Isolation filesystem entre tâches | `intersession.feature` : task A lit et écrit le répertoire de B, refus | T-02c, T-02g, T-02h pour le mécanisme ; scénario exact T-28 | T-28 | 1b |
| I-2 | Aucune connexion sortante de l'executor | `escape.feature` : direct, proxy, socket Unix, loopback | T-03a et b, U | T-03L | 1b |
| I-3 | Clé non récupérable | `secrets.feature` : env, erreurs, redirection, requête modifiée, broker d'une autre task | T-04 (échec de `mask`), T-23 (broker), T-42a à T-42g | T-23L, T-42a à T-42g ; réel T-04R | 1b |
| I-4 | Appel hors `calls_allowed` refusé | `policy.feature` : module A appelle C sans droit, refus et journal | T-21 pour le jeton ; DAG T-25 | T-25 | 1b, 2 |
| I-5 | Budgets respectés en parallèle | `budget.feature` : 300 réservations concurrentes, plafond exact | T-20 sur l'ancien SQL ; T-45a à T-45h sur le texte d'avant DC-3 | T-45a à T-45h sur le texte d'avant DC-3 ; **à rejouer sur le `settle` amendé, avec T-45l** (indépendant de l'OS) | 1b.0, 1b.3 |
| I-6 | Timeout qui tue tous les descendants | `termination.feature` : arbre de 3 processus, plus aucun | T-06 ; **résidu `setsid` T-06b** | T-06L | 1b |
| I-7 | Mort d'un worker sans effet sur les autres sessions | `isolation.feature` : deux tasks, `SIGKILL` sur l'une | E-06 | E-06L | 1b |
| I-8 | **Une PR ordinaire ne supprime ni n'affaiblit la porte par accident ou négligence, et certaines manipulations sont refusées : filtre, skip, scénario retiré, assertion retirée, code de porte modifié. La porte ne protège pas contre un contributeur hostile** | PR sentinelles rouges et une saine verte, §15 ; **T-44 : une PR hostile passe, verte** | T-22, T-44 | `gate-linux` | 1a |
| I-9 | Le client ne voit ni résultat intermédiaire ni tool de module | `code-front.feature` : script qui lit un canari, canari absent de la réponse, `tools/list` client = méta-tools | T-48 | T-48 | 3 |
| I-10 | Un module, plugin compris, n'atteint ni `~`, ni la clé, ni Postgres, ni le réseau hors gateway | `escape.feature`, profil de module | E-01 pour le mécanisme ; T-38 **fait** | T-38 **fait** | 1b.0 |
| I-11 | Un natif étranger ne consomme pas le broker | `broker-foreign.feature` | T-43a, T-43b **faits** | T-43a, T-43b **faits** | 1b.0 (fait), 1b.2 |
| I-12 | Seule la gateway lance une sandbox, sans contenu dans l'argv | `spawn-authority.feature`, garde dependency-cruiser étendue à docker (DC-1) | T-47, T-52 | T-47 | 1a.0, 1b |

### 11.6 La gateway incontournable vient de l'exécution

| Propriété | Mécanisme | Test |
|---|---|---|
| Aucun agent ne contacte un module natif | Pas de port en local ; réseau de sandbox réduit au broker | T-03a, I-2 |
| Aucun descripteur hérité n'ouvre un service de l'hôte | Seuls fd 0-2 passent, créés par l'adaptateur et jamais hérités (§4.8) | T-07, FD-PIPES, `escape.feature` |
| Aucun appel interne ne contourne le DAG | Chaque module a la gateway pour seul parent et seule destination réseau ; aucun jeton `aud` valable pour un autre | T-21, T-25, T-38 |
| Pas d'accès direct à Postgres | Socket refusée à toute sandbox, module compris ; `pg` seulement dans `data` (dependency-cruiser) | E-09, T-38 |

### 11.7 La gateway elle-même sous srt ?

Non. Sous Linux l'enfant n'a pas l'espace réseau de l'hôte [V: README]. Sur macOS, un socket hérité sur fd 3 n'atteint pas l'enfant (`ENOTTY`, srt ne passe que 0-2 [V: `dist/cli.js`, `sandboxedStdio`]) et `listen` sur fd 0 est refusé (`EPERM`) [T-07]. `allowLocalBinding` ouvre tout le loopback sans proxy sur macOS [T-03f] ; il est ignoré sous Linux. Sous Linux, T-07-fd0 échoue (une sandbox sert depuis un socket d'écoute reçu en fd 0) et T-39b montre qu'un `listen` dans la sandbox est accepté mais injoignable de l'hôte (`ECONNREFUSED`) ; macOS le refuse (`EPERM`). Gateway native, donc, et l'adaptateur ne passe sur fd 0 à 2 que des descripteurs qu'il a créés (§4.8). Le mode permission de Node (`--permission`) refuse `child_process`, les écritures et les sockets Unix [T-37], mais la doc Node ne le présente pas comme une frontière contre du code malveillant : c'est un garde-fou sans ops, à poser sur la gateway sur serveur, pas une isolation. La gateway lance les sandboxes (§4.8), il faudra donc l'autoriser explicitement. Lecture de cette doc, compatibilité et mise en place [À PROUVER: T-37b, Gherkin, brique 1b].

## 12. Supply chain

- **Épinglage exact** : `@anthropic-ai/sandbox-runtime` `0.0.81` ; **`@cucumber/cucumber` `12.9.0`**, qui tire `@cucumber/gherkin` `38.0.0` et `@cucumber/messages` `32.3.1` [T-14, T-12] ; `@stryker-mutator/core` et `cucumber-runner` `10.1.1` ; `tsx` `4.23.15` ; `@anthropic-ai/claude-agent-sdk` `0.3.312` ; `@modelcontextprotocol/sdk` `1.32.2` ; `@anthropic-ai/claude-code` `2.1.312` pour `claude plugin validate` ; `.nvmrc` exact.
- **Montée de `@cucumber/cucumber` vers 13** : bloquée tant que le runner Stryker ne la prend pas en charge. Sous 13.0.0 et 13.3.0, le runner échoue (« Failed to import formatter file ») et **son propre fichier `stryker-formatter.cjs` est tronqué à 0 octet** dans `node_modules`, ce qui fait échouer les runs suivants pour une autre raison [T-14]. Le `peerDependency` `>=8.0.0` ne protège pas : le runner se développe contre 12.9.0. À signaler en amont.
- srt importe `zod/v3`, compatible avec `zod` 4.6.7 [V: README].
- **Lockfile** : `npm ci` refuse un lockfile désynchronisé, `EUSAGE` [T-15].
- **Scripts d'installation** : npm 11.20 signale `esbuild` (dépendance de `tsx`) sans l'exécuter tant que `npm install-scripts approve` n'a pas tourné ; à trancher en 1a.
- **SBOM** : `npm sbom --sbom-format cyclonedx --package-lock-only --workspaces` ; plus `dpkg-query -W bubblewrap socat ripgrep postgresql-17`, npm ne les couvrant pas.
- **Système** : voir §5.1 et T-16.
- **Portée de « aucun hash »** : O-3.
- **`npm audit`, exécuté le 2026-10-30** (racine, puis `bench/`). `@anthropic-ai/sandbox-runtime` 0.0.81 est une `devDependency` de la racine (`package.json` l.27) et une dépendance du banc ; il deviendra une dépendance d'exécution avec la brique 1a.0.
  - **Racine : 4 vulnérabilités (2 modérées, 2 élevées).** Modérées : `qs` (plage affectée 2.2.5 à 6.16.0), copie imbriquée `node_modules/typed-rest-client/node_modules/qs` 6.15.1, tirée par `typed-rest-client` 2.3.1 ← `@stryker-mutator/core` 10.1.1 (dépendance de développement), quatre avis (GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw) ; `npm audit` indique qu'un correctif existe (`npm audit fix`), non appliqué ici. Élevées : `zod` et `@anthropic-ai/sandbox-runtime`, voir ci-dessous.
  - **`zod` GHSA-mrhx-c7xc-m3w5** (« Zod can exhaust memory while validating oversized constrained collections », plage `<4.6.6`) : copie imbriquée `node_modules/@anthropic-ai/sandbox-runtime/node_modules/zod` 3.25.76 (srt importe `zod/v3`), `npm audit` : « No fix available ». Le même avis fait deux élevées dans `bench/`. Dans `dist/` de srt, `zod` est importé par `sandbox/sandbox-config.js` et `sandbox/decider-client.js`. **Cause racine et exploitabilité, y compris par le canal decider, non établies.** À traiter **avant que srt ne devienne une dépendance d'exécution** (brique 1a.0) : décision O-33, aucune option présélectionnée. Le `zod` 4.6.7 de la plateforme n'est pas concerné (plage `<4.6.6`).
- **Épinglage des actions de CI (DC-4).** `bench-sandbox.yml` est épinglé par SHA (`actions/checkout` v4.2.2 `11bd71901bbe5b1630ceea73d27597364c9af683`, `actions/setup-node` v4.4.0 `49933ea5288caeca8642d1e84afbd3f7d6820020`, `actions/upload-artifact` v4.6.2 `ea165f8d65b6e75b540449e92b4886f43607fa02`), avec `persist-credentials: false` et `npm ci --ignore-scripts`. Les trois autres ne le sont pas : `ci.yml` (`actions/checkout@v6`, `actions/setup-node@v7`, `cache: npm`, `npm ci` sans `--ignore-scripts`), `claude.yml` et `claude-code-review.yml` (`actions/checkout@v6`, `anthropics/claude-code-action@v1`, et le secret `CLAUDE_CODE_OAUTH_TOKEN`, cité par son nom seulement). SHA de commit résolus par l'API GitHub le 2026-10-30, tags mobiles à re-résoudre au moment d'épingler : `actions/checkout` v6 → `d23441a48e516b6c34aea4fa41551a30e30af803` ; `actions/setup-node` v7 → `949feb2413d6458794dcd2491c4babbbce0c15c1` ; `anthropics/claude-code-action` v1 → `6d5ae526d25ce88daa2200be073e1a373167f064`. Attention : la référence `v1` de `claude-code-action` pointe sur un **objet de tag annoté** (`2ac8fded…`), qu'il faut déréférencer jusqu'au commit ; seul le SHA de commit convient dans `uses:`.

## 13. Porte de tests CI

### 13.1 Ce qui fait foi

Trois familles, toutes vertes (D-6b) : e2e Gherkin (`features/**`, srt réel, Postgres réel) ; unitaires Gherkin (`<composant>/features/**`) ; mutation sur le code modifié (§13.6). Typecheck, format, garde d'architecture, validation de plugin, schémas : chacun devient un scénario. Aucun autre check obligatoire.

### 13.2 Outillage (O-14, décidée)

`@cucumber/cucumber` **12.9.0** pour l'unitaire et l'e2e, rapport Messages NDJSON unique, assertions `node:assert/strict`, chargeur `tsx`. Le mode strip-types de Node 26 refuse les propriétés de paramètres (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) et les imports `.js` vers `.ts`, et `--experimental-transform-types` n'existe plus en Node 26 [T-13]. Un step important `gateway/src/infrastructure/in-memory.ts` du dépôt s'exécute avec `tsx` [T-13].

### 13.3 Unité comptée

Unité = **pickle**. API confirmée sur `@cucumber/gherkin` 38 et 42 : `Parser`, `AstBuilder`, `GherkinClassicTokenMatcher`, `compile` ; un `Scenario`, une ligne d'`Examples`, un `Scenario` de `Rule` donnent chacun un pickle, le `Background` est recopié [T-12]. Un pickle est **vert** si et seulement si : un seul `TestCase` et un seul `TestCaseStarted`, `attempt = 0`, `willBeRetried = false` ; au moins un step ; chaque `TestStep`, hooks compris, `PASSED`.

`UNDEFINED`, `PENDING`, `SKIPPED`, `AMBIGUOUS`, `UNKNOWN`, `FAILED` = échec. La porte ne lit **jamais** `TestRunFinished.success` : un step `SKIPPED` donne `success: true` et cucumber sort 0, y compris en `--strict` [T-13c]. Un step `UNDEFINED` donne `success: false` [T-13].

### 13.4 Configuration figée

`cucumber.mjs` : `paths` = tous les `**/*.feature` hors `node_modules` et `dist` ; `import` = steps ; `format: [["message", "reports/cucumber.ndjson"]]` ; `retry: 0`, `strict: true`, `dryRun: false`, `failFast: false` ; **aucun** `tags` ni `name`. La porte utilise la copie de la base (O-1).

### 13.5 Attendu, ajoutés, supprimés

Arbre testé : commit de merge GitHub, `fetch-depth: 2`. Base : son premier parent (O-2).

1. `T` = `.feature` touchés : `git diff --name-status -M HEAD^1 HEAD -- '*.feature'`.
2. Pour chaque fichier, parser base et tête ; identité d'un pickle = (chemin, `Feature`, `Rule`, `Scenario`, ligne d'`Examples`, rang parmi les homonymes).
3. `ajoutés` = tête ∖ base ; `supprimés` = base ∖ tête.
4. `N_base` = pickles verts du dernier run vert de `main` pour `HEAD^1` (`gate-count.json`) ; à défaut, compte statique.
5. `attendu = N_base + |ajoutés| − |supprimés|`.
6. `statique` = pickles de tous les `.feature` de l'arbre testé, glob fixé dans le code de la porte.
7. `exécutés_verts` = pickles verts du NDJSON, dont l'ensemble doit égaler l'ensemble statique.
8. **Vert** ⇔ `exécutés_verts = attendu = statique`, aucun step non `PASSED`, cucumber-js sort 0, mutation verte.

| Cas limite | Traitement |
|---|---|
| Scénario renommé, fichier renommé | Supprimés et ajoutés, neutre |
| Ligne ajoutée à `Examples` | +1 |
| Liste calculée | Interdite ; `Examples` littéraux, ou un step qui itère plus un scénario qui vérifie la couverture |
| Step skipped | Échec |
| Tag `@wip`/`@skip` | Sans effet, aucun filtre |
| Configuration modifiée | Sans effet ; `exécutés_verts < statique` : échec |
| Flaky | `attempt > 0` : échec |
| Scénario sans step | Échec |
| Dépendant de l'OS | Chaque job exécute tout ; les steps gèrent les deux plateformes |
| Base de données absente | Échec ; `skipIf` disparaît (§13.9) |
| `main` a bougé sur le même `.feature` | `attendu ≠ statique` : échec « base déplacée » |

### 13.6 Mutation (D-6b, D-6c)

**Outil** : `@stryker-mutator/core` + `cucumber-runner` 10.1.1, `testRunnerNodeArgs: ["--import", "tsx"]`, `coverageAnalysis: perTest`, `ignoreStatic: false`. Fonctionne sur `@cucumber/cucumber` 12.9.0 et TypeScript, plages de lignes comprises : sur `n < this.max`, le scénario ne testant que `2 < 3` tue `false` et `n >= max`, laisse survivre `true` et `n <= max`, comme attendu [T-14].

**Périmètre.** (a) Lignes modifiées par le diff, sources de production. (b) **Extension, constat 7 de la revue** : dès qu'un `.feature` ou une step definition change, le code couvert par les pickles concernés entre dans le périmètre. Cause traitée : une PR pouvait retirer une assertion sans toucher de code de production. T-22 : assertion retirée, les 4 mutants survivent, **la porte est rouge alors que le scénario reste vert**.

Mécanisme : `mutate` sur les fichiers atteints, la porte juge les mutants dont `coveredBy` intersecte les pickles modifiés. Pickles d'une step definition modifiée : depuis `testStep.stepDefinitionIds` et `sourceReference` des Messages. Hook ou support modifié : tous les pickles. Identifiants de test de `coveredBy` [À PROUVER: T-14c, `tools/test-gate`, brique 1a].

**Coût mesuré, M-01** (code réel à `1746cc8`, runner vitest en attendant la migration, laptop, `npx stryker run`) :

| Périmètre | Mutants | Durée | ms/mutant | Killed | Survived | NoCoverage | Timeout | RuntimeError |
|---|---|---|---|---|---|---|---|---|
| `intent-service.ts` | 91 | 7 s | 75 | 62 | 20 | 9 | 0 | 0 |
| Tous les composants, hors `main.ts` | 1 115 | 51 s | 46 | 592 | 181 | 293 | 12 | 37 |

- **Temps de CI** : le pire cas, une PR qui touche un support global, vaut aujourd'hui environ une minute sur ce poste et croît linéairement. Temps réels sur runner GitHub et par mutant sous cucumber-js [À PROUVER: T-14d, `gate-linux`, brique 1a].
- **Coût réel de l'extension : la dette.** 474 mutants non tués aujourd'hui (Survived + NoCoverage) : `services/memory` 265, `gateway` 93, `data` 101, `packages/contracts` 15. Sans purge, la première PR qui touche un step serait rouge sur du code qu'elle n'a pas écrit. **La brique 1a les tue ou les marque équivalents avant d'activer l'extension.** Ce travail est compté dans 1a, c'est son poste principal après la migration.
- La règle reste 0 survivant, sans seuil par composant (§1.1).

**Statuts** :

| Statut | Traitement | Raison |
|---|---|---|
| `Killed`, `Timeout` | toléré | détecté |
| `Survived`, `NoCoverage`, `Pending` | **échec** | D-6c ; run incomplet |
| `CompileError`, `RuntimeError` | tolérés, listés | mutant invalide |
| `Ignored` | toléré **seulement** avec marquage valide | D-6c |

**Conséquence d'architecture.** Du code exécuté seulement dans un processus enfant finit **`Survived`** [T-14b], pas `NoCoverage` comme le prévoyait le document précédent, et échoue donc la porte de toute façon. Le motif ports + adaptateurs en mémoire devient obligatoire : `packages/sandbox` garde une partie pure (argv, analyse) testée en processus.

**Marquage des équivalents** : `// Stryker disable next-line <Mutateur>: équivalent: <justification>`. `all`, `disable` sans `next-line` et `restore` sont refusés ; la justification nomme l'invariant ; chaque `Ignored` suit un commentaire valide et chaque commentaire ignore au moins un mutant. La porte juge la forme, la revue juge l'équivalence (C-11).

### 13.7 Rapports

`reports/cucumber.ndjson`, `reports/mutation/mutation.json`, sortie `gate-count.json` = `{ "commit": "<sha>", "pickles_green": <entier> }`. Le SHA sert d'identifiant, jamais de comparaison d'empreintes (O-3).

### 13.8 Où elle s'exécute (O-1, décidée)

`gate.yml`, `pull_request_target`, depuis la branche par défaut, plus `push` vers `main`. Jobs requis `gate-linux` (`ubuntu-24.04`) et `gate-macos` ; mutation sur Linux. `permissions: contents: read`, aucun secret, aucun cache.

1. Checkout de la **base** dans `gate/` ; checkout du merge dans `work/`.
2. Installation : `apt-get` (dépôt PGDG, `bubblewrap`, `socat`, `ripgrep`) ou Homebrew ; sysctl AppArmor.
3. `npm ci` dans `gate/` ; srt installé **hors** de `work/`.
4. Stage 0 construit vN+1, qui se reconstruit (§14).
5. La porte, processus parent de confiance, lance cucumber-js et Stryker **sous srt `gate-tests`** dans `work/`, sans réseau extérieur, écriture limitée à `work/` et `reports/`. Stryker ouvre un serveur TCP interne : sous `gate-tests` à réseau nul sur macOS, `listen EPERM 0.0.0.0`, résolu par `allowLocalBinding` [T-44]. La mutation ne tourne que sur Linux : vérification avec le Postgres de test [À PROUVER: T-50, `gate-linux`, brique 1a].
6. La porte lit les rapports comme des données non fiables.

**Ce que le code de la PR ne peut pas faire** : modifier `gate.yml`, le code de la porte, `cucumber.mjs` ou `stryker.config.json` utilisés ; ajouter un filtre ; atteindre le réseau ou un secret ; écrire dans `gate/` [À PROUVER: T-35, sentinelle, brique 1a].

**Ce que le code de la PR peut faire, prouvé par T-44** : remplacer les step definitions par du code qui n'affirme rien et qui fait échouer tout mutant actif. cucumber-js sort 0, chaque pickle est `PASSED`, tous les mutants sont `Killed`, le rapport est authentique et la porte est **verte** sur un code bogué. Aucune forgerie de fichier n'est nécessaire. **La porte protège donc contre les suppressions accidentelles et certaines manipulations, pas contre un contributeur hostile.** La manipulation reste visible dans le diff, sans être impossible. Le modèle de confiance (§11.1) couvre ce cas : contributeurs fiables d'abord, et `CODEOWNERS` sur `features/steps/` et `gate.yml` décidé (O-23, propriétaire, 2026-10-30) : cela réduit le risque de T-44 sans le fermer. Pas de refonte de la CI : `pull_request` avec séparation en deux jobs n'apporterait rien, le workflow viendrait de la PR.

Dépôt : public, 0 ruleset [T-19] et **`main` non protégée** (`gh api …/branches/main/protection` : 404), vérifiés le 2026-10-30 : aujourd'hui la porte n'est requise nulle part. **Décidé (DC-4)** : protection de `main` avec la porte comme contrôle requis, posée **avant 1a.8** (1a.7). Les workflows Claude restent sur le runner auto-hébergé, non requis ; leur épinglage par SHA est au §12. `ci.yml` (`cache: npm`, `npm ci` sans `--ignore-scripts`) est remplacé par `gate.yml` en 1a, qui n'a aucun cache.

### 13.9 Migration des tests existants, chiffre corrigé

Le document précédent citait **95 appels** : c'est un compte statique de `it`/`test`. La réalité exécutée [T-17] : **119 cas dans 20 fichiers, 113 passés, 6 skipped**.

Les 6 skipped sont les six cas du contrat `DataStore` contre Postgres réel (`data/test/infrastructure/sql-store.test.ts`, `describe.skipIf(url === undefined)`). Sous la nouvelle porte, un `SKIPPED` échoue. **Traitement : aucune dérogation, Postgres fourni.** Prouvé sur Postgres 17.9, `listen_addresses=''`, `peer` sur socket Unix, pgvector présent : **119/119** [E-09]. En 1a : `skipIf` retiré, Postgres provisionné dans les deux jobs et par `npm run gate` en local. pgvector reste requis tant que `0002_memory.sql` n'est pas suivie de `0004`.

Échec consigné : Postgres refuse de démarrer sur macOS sans locale valide (`le postmaster est devenu multithreadé`), corrigé par `LC_ALL=en_US.UTF-8` ; à porter dans l'installation locale.

Règles : un `it` → un `Scenario` ; `it.each` littéral → `Scenario Outline` ; suite de contrat → `Scenario Outline` avec colonne `adaptateur` ; `it.each` calculé → un step qui itère plus un scénario de couverture. Table `decisions/migration-gherkin.md` (cas vitest → pickle, les 119). `N_base` initial = compte statique du commit d'activation.

## 14. Stage 0

**Garantie, nommée correctement : validation fonctionnelle par reconstruction. Ce n'est pas une reproductibilité.** La chaîne prouve que vN+1 sait se reconstruire et que le résultat passe la porte, pas que deux builds sont identiques (§1.1).

- **Artefact** : `@architect-os/stage0` sur GitHub Packages, semver exact ; `dist/` de `tools/build` et `tools/test-gate`, `npm-shrinkwrap.json`, `engines.node` exact. Immuabilité d'une version publiée [À PROUVER: T-18, dépôt d'essai, brique 1c].
- **Construction** : `stage0` construit l'arbre (`build-1`) ; l'outil de `build-1` reconstruit l'arbre (`build-2`) ; la porte s'exécute sur `build-2`. Aucune comparaison de `build-1` et `build-2`.
- **Promotion** : sur `push` vert de `main`, étapes YAML : `npm publish` de `build-2`, puis PR automatique de l'épinglage, soumise à la même porte. En cas d'échec, l'épinglage ne bouge pas.
- **Amorçage** : `stage0@0.1.0` = `npm ci && tsc -b`, documenté dans `decisions/`.

**Stage 0 simplifié : l'outil de code isolé (DC-10).** Le système simplifié de la brique 1a.0 (une sandbox `builder`, un broker, une copie, une commande, §15) **est le stage 0** : `@architect-os/stage0` en est la forme publiée, pas l'amorce. **Le premier stage 0 est construit hors sandbox**, dans le Claude Code non sandboxé du propriétaire ; sa frontière n'est donc prouvée que par le banc, rejoué à chaque montée de srt (T-54), et srt est installé hors de tout chemin inscriptible (README srt, « Where This Package Is Installed »). Ensuite le reste de 1a et 1b se construit **à l'intérieur** de cet outil : chaque brique porte au journal une ligne « construite dans l'outil » avec ses incidents, ce qui devient une preuve d'usage réel.
## 15. Briques

Les portes de sortie sont des scénarios Gherkin prouvant un **mécanisme** ; les métriques v3 sont relevées, non bloquantes (D-7, §15.1).

**Ordre d'exécution : 1a.0 (outil de code isolé, DC-10, construit hors sandbox) → 1a.1 (épinglage) → fin de 1b.0 (T-42, T-43, T-45 joués ; restent le `settle` amendé et T-45l, T-43e, T-34h-variante, la correction d'E-03-huge, §19.2) → 1a.2 à 1a.8 (migration complète) → 1b.1 et suite.** Le banc passe avant la migration complète pour qu'une conception à revoir ne coûte pas la migration ; l'outil de code passe avant tout, pour que le reste se construise à l'intérieur. Les critères de sortie des briques ne changent pas, hors ceux de 1a.0 ci-dessous.

### Brique 1a.0 : outil de code isolé, stage 0 simplifié (DC-10)

Tirée de 1b.1 : elle prend ce que 1b.1 contient et dont l'outil a besoin avant tout le reste. **Le premier stage 0 est construit hors sandbox**, dans le Claude Code non sandboxé du propriétaire (§14). Dès qu'il tourne, le reste de 1a et 1b se construit dans l'outil.

**Prérequis, avant la première ligne de code** :

1. Décision O-33 sur le `zod` imbriqué de srt (GHSA-mrhx-c7xc-m3w5, §12) : srt devient une dépendance d'exécution.
2. Lecture de `docs/security.md` de `claude-code-action`, à cause du secret `CLAUDE_CODE_OAUTH_TOKEN` (DC-4). **Non lue à ce jour.**
3. Arbitrage O-32 de l'allowlist réseau (ci-dessous).

**Exigences** :

- **Version précédente épinglée** de Claude Code dans l'outil : la version en cours de modification n'est jamais celle qui travaille.
- **Sortie hors sandbox décidée uniquement par le propriétaire, et journalisée.**
- **Allowlist réseau documentée** : Anthropic par le broker seul ; registre npm à arbitrer (O-32), `node_modules` fourni en lecture seule par l'hôte de préférence, sinon `registry.npmjs.org` est un canal d'exfiltration assumé (README srt, « Security Limitations »).
- **Aucun jeton de push dans la sandbox** : push par bundle, fait par le propriétaire ou un agent hôte, sur des branches de travail.

**Failles du §4 de la contre-expertise, reprises** :

| Faille | Traitement dans la brique |
|---|---|
| 1. Identifiants dans le builder : un jeton OAuth lu par le binaire serait lisible par Bash, et son rafraîchissement réécrit le fichier (incompatible avec `mask`) | Broker détenteur du jeton et du rafraîchissement, mode Bearer, `lease-broker.ts:134` étendu, T-42 rejoué en Bearer (§11.2) |
| 2. Relais OAuth | `/v1/oauth/*` jamais relayé |
| 3. Allowlist : `registry.npmjs.org` comme canal d'exfiltration, scripts d'installation | `node_modules` en lecture seule, `--ignore-scripts`, allowlist documentée (O-32) |
| 4. Push git : une clé ou un jeton dans la sandbox est un pouvoir d'écriture exfiltrable | Sortie par bundle, push par le propriétaire après lecture |
| 5. Amorçage : le premier stage 0 est construit dans un Claude Code non sandboxé | Dit en §14 ; frontière prouvée par le banc, T-54 ; srt hors de tout chemin inscriptible ; `CLAUDE_CONFIG_DIR` par task, `settingSources: []`, autoupdate du binaire refusé par `denyWrite` |
| 6. Mono-utilisateur local : T-43d accepté | §11.1 nomme « poste du propriétaire, un seul uid » (DC-5) ; T-43e |

| Étape | Contenu | Fichiers |
|---|---|---|
| 1a.0.1 | `packages/sandbox` : port `SandboxRunner` à signature fermée (§4.8) ; adaptateur srt ; profil validé par schéma strict (dont les `denyWrite` nommés de tout profil avec écriture, T-02e4) ; descripteurs 0 à 2 créés par l'adaptateur (garde de FD-PIPES reprise) ; dossier temporaire par sandbox créé et retiré ; `detached` + `kill(-pgid)` + contrôle ; `stdin.on('error')` ; `maxBufferSize` ; canari au démarrage fermé à l'échec (`ISOLATION_UNAVAILABLE`) ; choix de l'adaptateur par configuration explicite. Adaptateur OCI/Docker : ici seulement si le poste du propriétaire n'est pas supporté par srt (le poste est macOS : srt), sinon en 1b.1 ; garde dependency-cruiser étendue (T-52) | `packages/sandbox/`, `.dependency-cruiser.cjs` |
| 1a.0.2 | Profil `builder` : copie DC-2 (clone `--no-hardlinks`, sortie par bundle), `denyWrite` nommés, `node_modules` fourni en lecture seule, réseau = broker de la task seul, `CLAUDE_CONFIG_DIR` par task, `settingSources: []` | `sandboxes/profiles/builder.srt.json` |
| 1a.0.3 | Broker minimal en mode `Authorization: Bearer` (DC-9) : jeton OAuth et rafraîchissement, `POST /v1/messages` seul, jamais `/v1/oauth/*` ; budget par `maxBudgetUsd` et `maxTurns` (les budgets du §4.5 viennent en 1b.3) ; T-42 rejoué en Bearer | `modules/broker/` |
| 1a.0.4 | Une seule commande qui lance la version précédente épinglée de Claude Code dans le profil `builder` | `package.json` (script), `tools/` |
| 1a.0.5 | Sortie : bundle produit dans la sandbox ; `git fetch <bundle>` côté hôte avec `fetch.fsckObjects=true`, par le propriétaire ou un agent hôte ; aucune exécution dans la copie ; push par le propriétaire sur une branche de travail ; chaque sortie journalisée | `tools/`, `decisions/` |
| 1a.0.6 | Preuves : T-34h-variante (`hooks` non vide), scénario de copie hostile (hook, `core.fsmonitor`, `filter=lfs`, `.gitmodules`, pack malformé), T-43e, canari, T-07-fd0 repris dans l'adaptateur | `features/sandbox/` ou `bench/` |
| 1a.0.7 | Journal : entrée « premier stage 0 construit hors sandbox » ; ensuite une ligne « construite dans l'outil » par brique | `decisions/` |

**Porte de sortie** : l'outil lance la version précédente épinglée de Claude Code dans une sandbox `builder`, sur un clone `--no-hardlinks`, avec le compte du propriétaire par le broker et sans identifiant dans la sandbox ; une modification de la copie sort par bundle et est récupérée avec `fsck` ; T-42 en Bearer, T-43e, le scénario de copie et le canari sont verts sur macOS (poste) et, là où le banc tourne, sur Linux. **Test externe** : le propriétaire fait réaliser 1a.1 par l'outil et relit le bundle. **Piliers** : R : journal d'usage réel, tests rejoués / S : STRIDE §11.3 relu pour la copie, le jeton OAuth et l'adaptateur / O : aucun secret dans la sandbox, aucun jeton de push, sortie décidée par le propriétaire.

### Brique 1a : Gherkin + porte

| Étape | Contenu | Fichiers |
|---|---|---|
| 1a.1 | Épingler la chaîne : cucumber 12.9.0, gherkin 38.0.0, messages 32.3.1, Stryker 10.1.1, `tsx`, srt 0.0.81 ; `.nvmrc` exact ; scénario `name.feature` et `platform.json` ; **épingler par SHA `ci.yml`, `claude.yml` et `claude-code-review.yml` (`bench-sandbox.yml` est fait), `--ignore-scripts` dans `ci.yml`** (DC-4, §12) | `package.json`, lockfile, `.github/workflows/` |
| 1a.2 | Migrer les 119 cas ; retirer `skipIf` ; Postgres local + CI | `features/`, `<composant>/features/`, `decisions/migration-gherkin.md` |
| 1a.3 | `tools/test-gate` : compteur de pickles, lecture NDJSON (§13.3), rapport Stryker, périmètre de mutation (§13.6), marquage | `tools/test-gate/` |
| 1a.4 | `gate.yml` en `pull_request_target`, tests sous srt `gate-tests`, PGDG | `.github/workflows/gate.yml`, `sandboxes/profiles/gate-tests.srt.json` |
| 1a.5 | Purger la dette de mutation : 474 mutants tués ou marqués | scénarios, commentaires |
| 1a.6 | Amender `CLAUDE.md` (O-2, C-2, C-12) ; **y écrire que `bench/` est un banc de preuve, hors production, importé par rien, avec une garde dependency-cruiser interdisant d'importer `bench/` depuis un workspace** (DC-8, fixture de garde) ; retirer vitest et `vitest.config.ts`, `scripts/gate.sh` du `.gitignore` | `CLAUDE.md`, `.gitignore`, `.dependency-cruiser.cjs` |
| 1a.7 | `CODEOWNERS` sur `features/steps/` et `gate.yml` (O-23, décidée par le propriétaire le 2026-10-30) : réduit le risque de T-44 par la revue, sans le fermer. Posé **avant** l'activation de la porte ; **protection de `main` avec la porte requise, posée avant 1a.8** (aujourd'hui aucune protection et 0 ruleset, DC-4) | `.github/CODEOWNERS`, protection de branche |
| 1a.8 | Activer la porte, `N_base` initial ; `npm run gate` en une commande | |

**Porte de sortie** : 0 `*.test.ts` ; vitest retiré ; `exécutés_verts = attendu = statique` sur `main` ; les 119 cas présents dans la table ; 0 mutant non tué hors équivalents marqués sur tout le dépôt ; `main` protégée avec la porte requise.
**Test externe (I-8)** : PR sentinelles, **rouges** : step non défini ; step `pending` ; filtre `tags` ajouté ; `.feature` exclu par la config ; scénario sans step ; mutant survivant sur ligne modifiée ; assertion retirée d'un step (T-22) ; `Stryker disable all` ; `gate.yml` ou code de porte modifié sans effet (T-35) ; écriture dans `gate/` depuis un step (T-35). Et une PR saine **verte**. La PR hostile de T-44 reste **verte** : elle documente la limite et ne compte pas comme un échec de la brique.
**Piliers** : R : T-12, T-13, T-14c, T-14d, T-17, T-32 consignés / S : SAST = porte, O-1 appliquée / O : `contents: read`, sans secret, tests sous srt.

### Brique 1b : srt, broker, topologie

| Étape | Contenu | Fichiers |
|---|---|---|
| 1b.0 | **Banc Linux et macOS d'abord, avant la migration complète 1a** : job `bench-sandbox` (non requis) sur `ubuntu-24.04` avec sysctl et sur macOS, code dans `bench/`, repris en `features/sandbox/` à 1b.7. **Joué (run 41038015293, §19.1)** : T-38, T-39, T-41, T-02L, T-03L, T-06L, T-07L, E-01L, E-02L, E-03L, E-04L et E-05L (par T-41), E-06L (I-7), T-23L. **Joué ensuite (run 41044838678, §19.2)** : T-42, T-43, T-45, FD-PIPES, T-02e5, T-02e6, T-34a à T-34i, T-35-pre. **Reste de 1b.0** : rejouer T-45 sur le `settle` amendé et ajouter T-45l (DC-3), T-43e, T-34h-variante (`hooks` non vide), corriger E-03-huge (`hostile.mjs:5`), adapter T-42 au mode Bearer (DC-9), banc Docker T-41D, T-38D, T-06D, T-34D, T-43D (DC-1), T-04R. **T-41 est passé : O-30 sans objet, repli non déclenché.** Les échecs Linux conduisent à la révision de conception de ce document : règle de profil `denyWrite` (T-02e, T-02e2, T-02e4), obligation d'hôte sur les descripteurs 0 à 2 (T-07-fd0) et copie du builder (T-34h, T-34i), à porter en 1a.0 puis 1b.1. T-42 a passé sur les deux OS avec un faux amont ; s'il échouait sur un OS ciblé, blocage soumis au propriétaire (§4.11). Aucun repli binaire seul n'est prévu | `bench/`, `features/sandbox/` |
| 1b.1 | `packages/sandbox`, **ce que 1a.0 n'a pas livré** (DC-10) : profils restants (executor, module, scout, zetetic-reviewer, agent-worker, repo-prepare, web-scout, db-migrator, gate-tests) validés par le schéma strict ; adaptateur OCI/Docker du même port, Docker d'abord, Podman ensuite par les mêmes flags (DC-1), sans montage de la socket Docker, s'il n'a pas été livré en 1a.0 ; partie pure en processus ; T-40, T-47, T-52 | `packages/sandbox/`, `sandboxes/profiles/`, `.dependency-cruiser.cjs` |
| 1b.2 | `modules/broker` : listener et autorisation par task, `POST /v1/messages*`, construction de la requête amont (clé dans le seul `x-api-key`), retrait de la clé en réponse comme défense supplémentaire, **en flux** (le broker du banc est bufferisé), réservation et réconciliation, relevé `usage` ; T-23b | `modules/broker/` |
| 1b.3 | `data` en MCP généré depuis `DATA_OPS` ; `budget.*` à états, `capacity.*` ; vérifications au point d'effet ; **le SQL passe en source unique `data/sql/*.sql`, lue par le banc et les Gherkin, jamais depuis ce document** (DC-3) ; T-33, T-20 rejoué sur le `settle` amendé, T-27, T-45 et T-45l repris en Gherkin (joués d'abord au banc, 1b.0), T-46, T-51 | `data/`, `data/sql/`, migration `0005` |
| 1b.4 | Gateway : lit `topology/modules.mcp.json`, lance chaque module sous srt, serveur MCP par sandbox, reconnexion bornée, émet les jetons ; modules vérifient ; T-29, T-30 | `gateway/`, `topology/`, `packages/contracts` |
| 1b.5 | Memory : module sous srt ; worker entier sous srt, `query()` + handlers minces ; `agents/*.md` chargés par `agents` ; suppression de `internal-http.ts` ; `docker-runner.ts` n'est plus supprimé : il devient la lignée de l'adaptateur OCI de `packages/sandbox` (DC-1) ; réduction de `worker/main.ts`, `run-worker.ts`, `internal-tools.ts` | `services/memory/`, `agents/` |
| 1b.6 | Suppression de `compose.yaml` (il monte la socket Docker) et de `.dockerignore` ; `Dockerfile` et image worker repris par l'adaptateur OCI (DC-1) ; `proxy/` → `deploy/edge/` ; docs à jour ; Postgres natif documenté | racine, `docs/` |
| 1b.7 | Suite d'évasion et invariants I-1 à I-7, I-10 à I-12 ; banc rejoué à chaque montée de srt, T-54 ; banc de l'adaptateur OCI sur `ubuntu-24.04` : T-41D, T-38D, T-06D, T-34D, T-43D (DC-1) | `features/sandbox/` |

**Porte de sortie** : Linux et macOS verts sur : `recall` e2e à travers un vrai `srt` avec faux amont local ; §11.4 ; I-1 à I-7, I-10 à I-12 ; schéma strict qui refuse `strictAllowlistt`, `allowAllUnixSockets`, `enableWeakerNestedSandbox`, un module natif hors `broker` et `data`, un module `type: http` ; un hôte où srt n'est pas supporté refuse de démarrer (`ISOLATION_UNAVAILABLE`), sans repli silencieux.
**Test externe** : T-04R avec une vraie clé, sur requêtes invalides, décision du propriétaire avant lancement ; `features/sandbox/escape.feature` sur les deux OS.
**Piliers** : R : T-xx et E-xx rejoués, `npm run bench:sandbox` en une commande / S : DAST = suite d'évasion, STRIDE §11.3 relu / O : aucun secret en sandbox de modèle, broker seul détenteur, quatre exceptions natives.

### Suite

| # | Brique | Contenu | Porte de sortie | Test externe | Piliers (R / S / O) |
|---|---|---|---|---|---|
| 0 | Baseline | Reportée (D-7) | sans objet | sans objet | R : prévu à la date du propriétaire / S, O : sans objet, aucune donnée ni code |
| 1c | Marketplace + stage 0 + supply chain | Marketplace, plugins, `stage0@0.1.0`, SBOM, workflows Claude en OIDC, `--bare`, hook client de relevé M1 | `claude plugin validate . --strict` = 0 ; installation dans un `HOME` jetable ; validation par reconstruction puis porte verte ; zéro clé statique | Run `gate.yml` vert ; `gh secret list` sans clé | R : T-11b, T-18, M1 relevé / S : SBOM, épinglage / O : fédération |
| 2 | Catalogue + registre + recall | Mode catalogue pour clients sans exécution, registre par `data` avec verdict et tokens par couche, profil `ci-review`, `memory-recall` en `workflow`, annotations | Résultat au-delà de `max_result_tokens` = résumé + handle ; appel hors profil refusé et journalisé ; `recall` sans génération ; T-25 | `claude-review.yml` sur une PR réelle | R : T(contexte, orchestration directe) et M2 relevés (§15.1) / S : jetons d'appel, DAG / O : registre append-only |
| 3 | Front de code + executor | `search`/`describe`/`execute`, modules importables, pool d'executors ; O-21 mesurée ici, trois méta-tools d'ici là | Script limité à son profil ; réseau refusé ; mort de session = mort de l'executor ; I-9 (T-48) | `claude-review` sur les méta-tools | R : T-10 sur Linux ; R, M1, M2, définitions relevés, seuil de 1 500 non bloquant (§15.1) / S : évasion étendue / O : réseau nul |
| 4 | Scission Cortex | `memory-write` (O-29 : `remember` passe d'agent à workflow avec Structurer), `memory-consolidate`, un écrivain par table ; `db-migrator` (O-28, T-49) | Écriture hors `writes_tables` refusée au chargement | Revue sur `cortex` | R : BM25 une extension à la fois (O-11) / S : écrivain unique / O : IRB ici si données personnelles, sans objet sinon |
| 5 | Code + tasks | `code-index`, `verify`, `codebase-ask` ; scout, builder, zetetic-reviewer ; brief, feature list JSON pour les tâches longues (§16) | Citation invalide rejetée au module `verify` (T-51) ; builder confiné à sa copie | `claude-review` appelle `verify` | R : part validé/gradé relevée / S : évasion sur les trois profils / O : copie jetable |
| 6 | Spec | `spec-draft`, `spec-lint` | Spec sans critère rejetée | `issue-to-spec.yml` | R : sans objet, outillage de 1a / S : profil agent-worker / O : sans objet |
| 7 | Mission Control | Onglet sur le registre | Tokens par couche visibles | Task réelle de la brique 5 | R : sans objet, lecture du registre / S : authentifié par la gateway / O : lecture seule |
| 8 | Modèles + web-scout | Structurer, Judge, Embedder désactivé, web-scout (O-27), chacun sous srt | Quarantaine seule ; adresse privée refusée | M1/M2 relevés | R : une variable à la fois / S : `deniedResolvedAddresses` / O : Judge local si Jev non confirmé |
| D | Déploiement serveur | `deploy/`, utilisateurs dédiés, TLS, `systemd-run` ; **exigences d'hôte Linux : `bubblewrap`, `socat`, `ripgrep` et `kernel.apparmor_restrict_unprivileged_userns=0`, réglage global qui affaiblit l'hôte : profil AppArmor dédié à `bwrap` à la place (O-31, reportée ici par DC-11) ; test de Docker et Podman rootless sans sysctl, qui dit si la niche de l'adaptateur OCI existe** ; modules en stdio sur le même hôte ; modules distants : `type: http` impossible sous srt (T-39b), le pont natif HTTP vers stdio (T-39c) serait une exception native de plus, décision du propriétaire | T-26, T-31, T-09L, profil AppArmor dédié ; **multi-utilisateur seulement après §11.4** | Machine d'essai | R : T-26, T-31 / S : STRIDE relu / O : RBAC, Zero Trust |

### 15.1 Mesure : M1, M2, R, relevés et non bloquants

`R = 1 − T(contexte, code execution) / T(contexte, orchestration directe)`, tokens entrés dans la fenêtre du client pour une même tâche, même modèle, une seule variable. M2 reste le garde-fou : R en hausse avec M2 en hausse est signalé. D-7 reste entière : aucune de ces mesures ne bloque une porte.

| Brique | Relevé | Source |
|---|---|---|
| 1b.2 | Tokens de modèle par task et par modèle, couche task de M2 | `usage` au broker |
| 1c | M1 | Hook client du plugin d'entrée, `ctxguard` existant comme point de départ |
| 2 | Colonnes par couche et par modèle au registre ; **T(contexte, orchestration directe)** sur un jeu de tâches fixe | Mode catalogue |
| 3 | **T(contexte, code execution)** sur les mêmes tâches, **R**, M2, tokens de définitions | Méta-tools, journal d'expérimentation |
| 0, à la date du propriétaire | Baseline des vingt tâches, R rejoué | `baseline/` |

## 16. Conformité aux pratiques Anthropic

Pages lues ; seuls les écarts et les points qui contraignent la conception sont listés.

| Source | Ce qu'elle demande | Conception | Écart et traitement |
|---|---|---|---|
| [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Le plus simple qui marche ; workflow pour le bien défini, agent pour l'ouvert ; réduire les couches ; tester en sandbox | D-4 ; `recall` sans LLM ; `platformd` et JSON lines supprimés | **Écart justifié** : l'article conseille de partir de l'API directe, on part de l'Agent SDK, par directive du propriétaire (suivre l'amont) et parce que le SDK fournit boucle, outils et sortie structurée [E-04] |
| [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | Serveurs présentés comme API de code, divulgation progressive, filtrage dans l'environnement ; **sandbox, limites de ressources, supervision** obligatoires, coût à peser | Méta-tools, executor réseau nul, parcours §4.9, I-9 | **Corrigé** : limites sur Linux ; **écart macOS justifié** : T-09, §11.1. **Proposé, non décidé** : `search` à niveau de détail (O-21), mesuré en brique 3. État persistant et skills de l'executor : reportés après la brique 3, à mesurer |
| [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | Peu d'outils, pas d'enveloppe d'API, espaces de noms, signal fort, `response_format`, pagination, erreurs actionnables, annotations, évaluation sur tâches réelles | `recall`/`remember`, trois méta-tools | **Corrigé** : `annotations` et `response_format` au manifeste (§10) ; erreurs `Result.error` à rendre actionnables en 2. **Écart** : tools de `data` en MCP sont des vues d'opérations, mais réservés aux modules, jamais exposés au modèle. **Écart justifié** : évaluation reportée avec la baseline (D-7), risque : choix d'outils non mesurés |
| [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Contexte fini, récupération à la demande, compaction, notes, sous-agents résumant | `memory.recall` ≤ 600, handle, `max_result_tokens` | Conforme. **Corrigé** : `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CONFIG_DIR` par task |
| [Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Progrès incrémental, fichier de progression, liste de fonctionnalités en JSON, interdiction de retirer des tests, e2e avant de marquer réussi | Porte `attendu`, Gherkin e2e | Conforme côté CI : le retrait de test est visible dans le diff. **Corrigé** : brief du builder (brique 5) avec feature list JSON et une fonctionnalité à la fois. `init.sh` remplacé par `npm run gate` (TypeScript), écart volontaire |
| [Best practices Claude Code](https://code.claude.com/docs/en/best-practices) | `CLAUDE.md` court, contrôle pass/fail, hooks pour l'absolu, revue contre spec, `--bare` en script | `CLAUDE.md` 107 lignes ; porte = contrôle | **Corrigé** : `--bare` en CI (1c). Écart justifié : la règle absolue vit dans la porte, pas dans un hook client |
| [Plugins](https://code.claude.com/docs/en/plugins-reference) | Layout, `settings.json` limité, `userConfig`, validation | §8 | **Corrigé** : `description`, `author`, `alwaysLoad` ; profils hors plugin [E-08] |
| [Agent SDK, déploiement](https://code.claude.com/docs/en/agent-sdk/secure-deployment), [hosting](https://code.claude.com/docs/en/agent-sdk/hosting) | Proxy d'injection, isolation par technologie, application Agent SDK **dans** la frontière, ressources par agent, pas de timeout de session | Broker, §11.1, worker entier sous srt ; timeout tenu par `SandboxRunner`, `maxTurns` | **Conforme** depuis D-8. **Corrigé** : la conception précédente (`mask` pour la clé) s'en écartait |
| [Agent SDK, overview](https://code.claude.com/docs/en/agent-sdk/overview) | Note : sauf approbation préalable, Anthropic n'autorise pas des tiers à offrir la connexion claude.ai ni ses limites de débit dans leurs produits, agents du SDK compris ; utiliser l'authentification par clé API | Compte du propriétaire pour l'outil de code personnel seulement (DC-9) ; clé API dès que la plateforme sert quelqu'un d'autre | **Zone grise** tranchée par le propriétaire ; relue le 2026-10-30 |
| [Agent SDK, coûts](https://code.claude.com/docs/en/agent-sdk/cost-tracking) | `total_cost_usd` estimation | §4.5 | **Corrigé** |
| [Sandboxing](https://code.claude.com/docs/en/sandboxing) | Sandbox intégré : Bash seulement ; processus entier : srt, conteneur, VM | Processus entier sous srt | Conforme |
| [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments) | Runtime pour le processus entier, MCP et hooks compris ; VM dédiée pour un dépôt non fiable ; session cloud hébergée ; passer les réglages explicitement | Modules et workers sous srt, `--settings` obligatoire, O-22, §4.11 | Conforme. Sur Linux, les refus se calculent au lancement et ne couvrent pas ce que la session crée ensuite : à inclure dans T-02L |
| [GitHub Actions](https://code.claude.com/docs/en/github-actions) | `claude_args`, plugins, OIDC, droits d'écriture requis | §8, §13 | Conforme. `pull_request_target` et injection de prompt : aucune mention dans cette page, renvoi à `docs/security.md` de l'action, à lire avant 1a (DC-4), à cause du secret `CLAUDE_CODE_OAUTH_TOKEN` ; **non lu à ce jour** |

Pages signalées et non lues à ce stade, à lire en brique 1b : `agent-sdk/typescript`, `agent-sdk/tool-search`, `plugins/security`.

## 17. Décisions ouvertes (chacune avec recommandation)

| # | Question | Recommandation |
|---|---|---|
| O-4 | Hébergement de stage 0 | GitHub Packages ; repli `npm pack` en asset de release |
| O-5 | CLI `srt` ou bibliothèque `SandboxManager` | CLI par processus : isolation par task par construction ; la bibliothèque garde une configuration par processus [V: README, « attribution, not a boundary »] |
| O-6 | `data` sous srt | Non : `pg` exige le socket Postgres, `allowUnixSockets` est ignoré sous Linux et `allowAllUnixSockets` est interdit. E-09 ne vaut que sur macOS. Exception du §4.7 |
| O-7 | Terminateur TLS serveur | Caddy, un fichier, ACME automatique ; `node:https` seul exigerait de gérer les certificats |
| O-9 | Approbations humaines | Protection de branche, pas CI (D-6) |
| O-10 | `plugins/` vs `modules/` | Séparés : `plugins/` est copié chez chaque client |
| O-11 | Extension BM25 | Brique 4, une à la fois, consigné |
| O-12 | Réseau du builder | Aucun, `node_modules` en lecture ; dépendance nouvelle par PR humaine |
| O-13 | macOS requis dans la porte | Oui |
| O-15 | Source de `N_base` | `gate-count.json`, repli statique |
| O-16 | Écritures du registre | Par opération typée de `data` |
| O-17 | AppArmor Ubuntu 24.04 | Runners : sysctl. Serveurs : profil dédié à `bwrap` |
| O-19 | Clé runtime | Fichier 0600 lu par le broker ; coffre du système ou fédération hors GitHub à étudier |

**Décisions du propriétaire, closes et ouvertes** (« Décidée » = close ; les autres lignes attendent) :

| # | Question | Recommandation |
|---|---|---|
| O-27 | web-scout | **Décidée (propriétaire, 2026-10-30)** : `kind: workflow` sous srt, sans modèle (v3 : conteneur avec agent). Change le profil et la règle de manifeste du §10 |
| O-28 | db-migrator | **Décidée (propriétaire, 2026-10-30)** : `kind: workflow` sous srt, sans modèle, base jetable dans la sandbox, brique 4 (v3 : « agent de migration »). `agent` seulement si la génération de migrations est voulue |
| O-29 | remember / memory-write | **Décidée (propriétaire, 2026-10-30)** : `kind: agent` jusqu'à la brique 4, puis `workflow` avec Structurer, comme en v3 |
| O-30 | Si T-41 échoue sur un OS ciblé | **Sans objet** : T-41 passe sur Linux et macOS, avec un faux amont et une seule couche srt (§19.1). Le repli n'est pas déclenché. Limite : aucun appel réel à Anthropic, T-04R reste à jouer en 1b. Si T-41 échouait un jour (montée de srt, T-54) : blocage soumis au propriétaire, §4.11, aucune option présélectionnée |
| O-21 | Fusionner `describe` dans `search(detail: name\|summary\|schema)`, comme le propose l'article | **Proposition, non décidée.** Trois méta-tools d'ici là. Mesurée en brique 3, une variable à la fois, avec résultat borné par `max_result_tokens`. Pas nécessaire au modèle Code Execution |
| O-22 | Multi-utilisateur : srt seul, ou VM | **Bloqué aujourd'hui.** Après §11.4 : srt pour utilisateurs fiables ; pour contenu hostile, Kata Containers à évaluer selon le §4.11. gVisor, conseillé par Anthropic, échoue au seul critère de pérennité « un seul éditeur » à ce jour ; le test est rejoué au déclenchement |
| O-23 | `CODEOWNERS` sur `features/steps/` et `gate.yml` contre une PR hostile (T-44) | **Décidée (propriétaire, 2026-10-30)** : **oui**, `CODEOWNERS` sur `features/steps/` et `gate.yml`, tâche de la brique 1a. Résidu §13.8 : cela **réduit le risque de T-44 par la revue, sans le fermer** |
| O-24 | Lancer T-04R avec une vraie clé | **Décidée (propriétaire, 2026-10-30)** : **oui**, T-04R avec une vraie clé, en brique 1b, sur un compte d'essai, requêtes invalides seulement |
| O-25 | Autoriser le sysctl AppArmor dans la VM Docker locale pour rejouer le banc Linux sur ce poste | **Non nécessaire** : le banc CI a prouvé Linux (§19.1), `gate-linux` le rejoue |
| O-31 | Le réglage **global** `kernel.apparmor_restrict_unprivileged_userns=0`, exigé par srt sous Linux, est-il acceptable sur un serveur ? | **Reportée à la brique D (DC-11), avec un test de Docker/Podman rootless sans sysctl.** Recommandation : **non** sur un serveur multi-utilisateur. Runners jetables et poste de développement : accepté. Serveur : profil AppArmor dédié autorisant les espaces de noms utilisateur à `bwrap` seul, étendant O-17 [déduit du README, non testé : à prouver en brique D]. À défaut de ce profil, pas de déploiement Linux. Le sysctl global n'est admissible que sur un hôte dédié à la plateforme, aux utilisateurs de confiance, par décision écrite du propriétaire |
| O-26 | Dette de mutation de 474 mutants traitée dans 1a | **Décidée (propriétaire, 2026-10-30)** : **oui**, traitée en brique 1a (1a.5), condition de l'extension |
| DC-1 à DC-11 | Onze décisions du 2026-10-30 après la contre-expertise | **Décidées (propriétaire, 2026-10-30)**, §1.5 |
| O-32 | Allowlist réseau de l'outil de code isolé : accès au registre npm | **Ouverte.** Recommandation : `node_modules` fourni en lecture seule par l'hôte, aucun accès au registre depuis la sandbox ; une dépendance nouvelle entre par PR humaine (O-12). À défaut, `registry.npmjs.org` seul, avec `--ignore-scripts`, en assumant le canal d'exfiltration |
| O-33 | `zod` imbriqué de srt (GHSA-mrhx-c7xc-m3w5) avant que srt ne devienne une dépendance d'exécution | **Ouverte, prérequis de 1a.0.** Aucun correctif publié selon `npm audit`. Établir d'abord la cause et l'exploitabilité (fichiers `sandbox-config.js`, `decider-client.js`), puis décider : accepter avec l'argument écrit, remplacer par une version corrigée si elle paraît, ou forker (§4.11, option a). Aucune option présélectionnée |

## 18. Contradictions relevées

| # | Entre | Résolution |
|---|---|---|
| C-1 | `CLAUDE.md` « Never put an API key … in a worker » vs v3 « clés API injectées par task » | Broker par task : **plus de contradiction** |
| C-2 | `CLAUDE.md` « Never compare a branch to `main` » vs D-6 | O-2, décidée |
| C-3 | v3 « SQL depuis les modules » vs `CLAUDE.md` « `pg` only in `data/src/infrastructure` » | `data` seul importeur, propriété dans `operations.json` |
| C-4 | v3 et D-5 « pgvector désactivé » vs `0002_memory.sql` | Migration `0004` |
| C-5 | v3 `memory-recall` sans LLM vs `recall` actuel | D-4, brique 2 |
| C-6 | `CLAUDE.md` « Agent SDK only in `services/*/worker` » vs topologie | Principe conservé : le SDK reste dans un worker sous srt, règle étendue à `modules/*/worker` |
| C-7 | `CLAUDE.md` gateway « Nothing else » vs D-3 | Mettre `CLAUDE.md` à jour ; résumé + handle déterministe, tout résumé par modèle dans un module |
| C-8 | v3 « identique laptop et serveur » vs srt | Porte sur les deux OS |
| C-9 | v3 `agent-approval-check` requis vs D-6 | O-9 |
| C-10 | `CLAUDE.md` « versions exactes » vs `.nvmrc` = `26` | `.nvmrc` exact |
| C-11 | D-6 (tests seuls) vs D-6c (équivalents en revue) | La porte juge la forme, la revue l'équivalence, non bloquante sauf protection de branche |
| C-12 | `CLAUDE.md` « Adding a brick » (vitest) vs D-6a | Réécrit en 1a |
| C-13 | v3 executor « aucune clé » et « modèle dimensionné » | Executor sans modèle |
| C-14 | v3 « workflow depuis la branche par défaut » | O-1, décidée |
| C-15 | D-1 « superviseur » vs directive du propriétaire de rester au plus près des briques | D-9 |
| C-16 | Document précédent : `injectHosts` avec port, `@cucumber/cucumber` 13.3.0, « 95 appels », `NoCoverage` en sous-processus | Corrigés, T-04, T-14, T-17, T-14b |
| C-17 | `gate-tests` « Postgres par socket nommée » vs `allowUnixSockets` ignoré sous Linux ; réseau nul vs serveur TCP de Stryker | Postgres de test et Stryker dans la sandbox, loopback privé sous Linux, socket nommée sur macOS ; [À PROUVER: T-50, `gate-linux`, brique 1a] |
| C-18 | `584ac03` : `query()` et handlers natifs vs D-1 et D-4 « toujours sous srt » | Résolue par D-8, worker entier sous srt |
| C-19 | `584ac03` : modules v3 en conteneur devenus natifs sans ligne au §3 | Résolue par D-8, §3 et §4.7 |
| C-20 | Web-scout sans modèle, sous srt, vs règle « `workflow` ⇒ `sandboxes: []` » | Règle du §10 réécrite, O-27 |
| C-21 | D-11 et §4.11 « srt comme unique adaptateur, aucun second adaptateur n'est codé », T-52, 1b.5 et 1b.6 (suppression de `docker-runner.ts`, `compose.yaml`, `Dockerfile`) vs la portée Docker | DC-1 : un port, deux adaptateurs ; `docker-runner.ts` devient la lignée OCI |
| C-22 | `compose.yaml` l.51 monte la socket Docker dans un conteneur vs DC-1 « le socket Docker n'est monté dans aucun conteneur » | `compose.yaml` non repris ; l'adaptateur OCI lance docker depuis la gateway native |
| C-23 | §4.8 point 5 « tubes » vs `stdio: 'pipe'` = sockets `AF_UNIX` (T-35-pre-fds : `1:socket, 2:socket`, deux OS) ; `assertStdioPipes` accepte `'pipe'` mais refuserait le même descripteur en numérique | « Descripteurs créés par l'adaptateur, jamais hérités » (DC-7) |
| C-24 | §11.1 « `ps eww` sur macOS 27 ne montre pas l'environnement » (T-24) vs T-43d : `ps -Eww -p <pid>` lit l'autorisation sous macOS | Ligne corrigée : pas une frontière non plus sous macOS ; T-43e |
| C-25 | §4.5 « l'absence d'interblocage entre `reserve` et `settle` » (appuyée par T-45g, T-45j, T-45k : 0 × `40P01`) vs `fable/pg` : `40P01` sur `reserve(X)` rejoué × `settle(X)` ; commentaire de banc de T-45j « aucune instruction de `reserve` ne demande une ligne existante », faux pour un rejeu | DC-3 : ordre uniforme, T-45l |
| C-26 | §4.5 « Non prouvé : ce SQL n'a jamais tourné » vs T-45a à T-45h qui passent au run 41044838678 sur le texte d'alors | Statut précisé : prouvé sur l'ancien `settle`, non prouvé sur le `settle` amendé |
| C-27 | §9.2 `./repo` « copie jetable » sans mécanisme vs un worktree partage `hooks`, `config` et `objects` avec l'hôte (prouvé) | DC-2 : clone `--no-hardlinks`, bundle |
| C-28 | §11.2 « `node:net` n'expose aucun identifiant de pair » vs rapport « socket Unix par task, `SO_PEERCRED` côté broker » sous Docker | Identité = fichier socket propre à la task ; `SO_PEERCRED` non retenu sans addon ; T-43D |
| C-29 | `lease-broker.ts:134` (`AUTH_HEADERS`) écarte `authorization`, et `LEASE_OUT_OF_PLACE` ne tolère l'autorisation que dans `x-api-key`, vs mode Bearer (DC-9) | À étendre ; T-42c adapté ; T-42 rejoué en Bearer |
| C-30 | §13.8 « aucun cache » (`gate.yml`) vs `ci.yml` `cache: npm` ; `bench-sandbox.yml` épingle `checkout` v4.2.2 et `setup-node` v4.4.0 alors que `ci.yml` utilise v6 et v7 | `ci.yml` remplacé par `gate.yml` ; SHA à re-résoudre au moment d'épingler (§12) |
| C-31 | §19.1 constat BROKER-FOREIGN (P0 ouvert) vs run 41044838678 où T-43 le remplace | Fermé au banc (§11.2) ; T-43d reste un constat |
| C-32 | Rapport de contre-expertise : numéros de ligne du README srt (l.1214, l.1269, l.1277…) vs le README du paquet installé (0.0.81), où ces passages sont à d'autres lignes | Citations par section du README, pas par ligne |

### 18.1 Revue adversariale externe : vérification

| # | Constat | Vérification | Intégration |
|---|---|---|---|
| 1 | Frontière srt, multi-utilisateur bloqué | **Exact.** Le document précédent listait les limites mais n'écrivait aucun modèle de confiance | §11.1, §11.4 |
| 2 | T-04 bloquant, adversarial, alternative | **Exact, et T-04 échoue** | §11.2, I-3 |
| 3 | `platformd` concentre les risques | **Exact**, clé + relais + socket | Supprimé, §4.6, §4.8, D-9 |
| 4 | Jetons liés et vérifiés au module | **Partiellement couvert** : en-tête exigé par module, sans audience, capacités ni rejeu | §4.4, T-21 |
| 5 | Budgets atomiques | **Exact** : « budgets » sans mécanisme | §4.5, T-20, I-5 |
| 6 | Gateway incontournable par l'exécution | **Partiellement couvert** : réseau de sandbox oui, descripteurs et DAG non testés | §11.6 |
| 7 | Porte hors contrôle, mutation étendue | **O-1 déjà recommandée ; l'extension est nouvelle** | §13.6, T-22, M-01 |
| 8 | Stage 0 mal nommé | **Exact** : « point fixe » suggérait plus | §14 |
| — | Comparaison de digests ; seuil de mutation par composant | **Refusés par le propriétaire** | §1.1 |

## 19. État des preuves

| ID | Sujet | État | Reste à prouver |
|---|---|---|---|
| T-01 | Clés de config dans 0.0.81 | **Fait** | Linux sans objet (schéma commun) |
| T-02 | `denyRead`, `allowRead`, chemins protégés | **Fait macOS ; Linux : deux échecs réels** (T-02e, T-02e2 ; T-02b, d, d2, e3, e4, e5, e6, f, g, h, i passent ; T-02e5 et T-02e6 rejouent T-02e et T-02e2 avec des `denyWrite` nommés) | Règle de profil `denyWrite` nommés dans l'adaptateur, 1a.0 puis 1b.1 ; `gate-linux` |
| T-03 | Loopback hôte | **Fait macOS (résidu T-03f : `allowLocalBinding` atteint le loopback) et Linux** (T-03a à e, T-03U, I-2 passent ; T-03f : refusé, l'option est ignorée) | `gate-linux` |
| T-04 | Masquage adversarial | **Fait macOS : échec, `mask` écarté** | T-04R avec clé, 1b |
| T-05 | 1 000 allers-retours | **Remplacé** par E-01, E-02 | E-01L, E-02L, 1b.0 |
| T-06 | Mort de l'arbre | **Fait macOS et Linux.** Groupe tué : 0 descendant (TERM, KILL, les deux OS). `srt` seul tué : SIGKILL laisse 10 sur 11 (Linux) et 2 sur 3 (macOS), SIGTERM 0 et 1. T-06b : 0 survivant sous Linux, **résidu `setsid` sous macOS** | `gate-linux` |
| T-07 | Descripteur hérité | **Fait macOS : refusé. Linux : fd 3 refusé, fd 0 ÉCHEC réel** (T-07-fd0) ; la garde de l'hôte du banc (FD-PIPES-a à f) passe sur les deux OS | Reprise dans l'adaptateur `SandboxRunner` : 1a.0 puis 1b.1 |
| T-08 | `data` sous srt | **Sans objet** (O-6) ; U confirme le refus par défaut | |
| T-09 | Limites | **Fait macOS : `ulimit` inapplicable** | T-09L, `systemd-run`, 1b |
| T-10 | Latence srt | **Fait macOS : 211 ms** | Linux en brique 3 ; un module reste lancé, ce coût ne s'applique qu'au démarrage |
| T-11 | `${user_config}` et `--strict` | **Fait** | T-11b `alwaysLoad`, 1c |
| T-12 | Compilateur de pickles | **Fait** (38 et 42) | |
| T-13 | Chargement TypeScript | **Fait** | |
| T-14 | Stryker + cucumber + tsx | **Fait, 12.9.0 seulement** | T-14c, T-14d, 1a |
| T-15 | `npm ci` lockfile | **Fait** | |
| T-16 | Paquets `ubuntu-24.04` | **Fait : `postgresql-17` absent** | T-32 PGDG, 1a |
| T-17 | Cas exécutés | **Fait : 119** | |
| T-18 | Immuabilité GitHub Packages | À prouver | T-18, dépôt d'essai, 1c |
| T-19 | Rulesets | **Fait : public, 0** | |
| T-20 | Budgets parallèles | **Fait sur l'ancien SQL** ; T-45d le rejoue sur le SQL d'avant DC-3 (100 acceptées, puis 30, deux OS) | À rejouer sur le `settle` amendé (T-45) |
| T-21 | Jeton d'appel | **Fait** | T-25, 2 |
| T-22 | Assertion retirée | **Fait** | Sentinelle, 1a |
| T-23 | Broker adversarial | **Fait macOS et Linux** (T-23, T-23-ordinaire, T-23d-none/keep-length/full) ; le broker du banc est bufferisé | T-23b, 1b.2, en flux ; T-04R |
| T-24 | Environnement même uid | **Fait sous Linux** ; sous macOS `ps eww` ne montrait rien, mais T-43d lit l'autorisation avec `ps -Eww` | T-43e, T-26, D |
| T-25 à T-37 | Voir §4, §5, §11, §13 | À prouver | Brique nommée à chaque mention |
| T-38 | Module sous srt : stdio, rappel de la gateway par le proxy, lecture et réseau limités, latence | **Fait, macOS et Linux** (T-38, T-38-close) | |
| T-39 | Pont http vers un module sous srt | **Fait, macOS et Linux** : T-39a stdio par la gateway native ; T-39b `listen` : macOS `EPERM`, Linux accepté mais l'hôte reçoit `ECONNREFUSED` ; T-39c pont natif HTTP vers stdio | `type: http` reste refusé par schéma ; le pont natif serait une exception de plus (brique D) |
| T-40 | Worker et module hostiles face à la gateway | À prouver | Gherkin, 1b.1 |
| T-41 | Worker entier sous srt : `query()`, handlers minces, binaire, broker | **Fait, macOS et Linux** (T-41a à d) avec un faux amont et une seule couche srt ; **O-30 sans objet** | Aucun appel réel à Anthropic : T-04R en 1b. T-41 n'exerce pas T-42 (profil `allowedDomains` vers le port du broker du banc) |
| T-42 | Autorisation de task par `mask`, `tlsTerminate`, `broker.localhost` | **Fait, macOS et Linux** : T-42a à T-42g pass ; T-42h : trois `residual` (base64, hex, SSE fragmenté), plain et two-chunks pass ; accepté jusqu'à T-04R (DC-6) | T-42 en mode Bearer (DC-9) ; T-04R ; flux, 1b.2 |
| T-43 | Processus natif étranger qui joint le broker | **Fait, macOS et Linux** : T-43a (huit formes, `401`), T-43b (rejeu entre tasks, `401`), T-43-témoin (`200` et clé à l'amont) pass ; **T-43d : constat**, un natif du même uid lit l'autorisation (accepté, DC-5) | T-43e (depuis une sandbox), T-43D (Docker) |
| T-44 | PR hostile : steps sans assertion, mutants tués | **Fait macOS, sans srt et sous srt : la PR passe** | Sentinelle documentaire, 1a |
| T-45 | Réservation à états, reprise, doubles réservations et doubles règlements concurrents (SQL du §4.5) | **Fait sur le texte d'avant DC-3** : T-45a à T-45h pass, témoins de l'ancien SQL en échec comme prévu (deux OS) ; **interblocage `40P01` reproduit hors banc** (`fable/pg`), non vu par T-45g, T-45j, T-45k | Rejouer sur le `settle` amendé ; **T-45l** (témoin) ; Gherkin 1b.3 |
| T-46 | Facture supérieure | À prouver | Gherkin, 1b.3 |
| T-47, T-52 | Autorité de lancement ; garde dependency-cruiser avec fixture | À prouver | Gherkin, 1b.1 |
| T-48 | Canari, `tools/list` client, I-9 | À prouver | Gherkin, 3 |
| T-49, T-50 | Postgres jetable sous srt : db-migrator ; `gate-tests` avec Stryker | À prouver | Gherkin, 4 ; `gate-linux`, 1a.4 |
| T-51 | Sémantique des arguments au point d'effet | À prouver | Gherkin, 1b.3 et 5 |
| T-54 | Banc rejoué à chaque montée de srt | À prouver | `npm run bench:sandbox`, 1b.7 |
| T-34 | Alias et chemins protégés, a à i | a à g pass sur les deux OS ; **h et i : `fail` sous Linux, `pass` sous macOS** (§9.2, §19.2) | Variante h avec `hooks` non vide ; scénario de copie (DC-2) |
| T-35-pre | Code hostile sous le profil `gate-tests` reconstruit | `T-35-pre` pass sur les deux OS ; `T-35-pre-fds` constat (`1:socket, 2:socket`) | T-35 en 1a.4 |
| FD-PIPES | Garde de l'hôte sur les descripteurs 0 à 2 | a à f pass sur les deux OS | Reprise dans l'adaptateur, 1a.0, 1b.1 |
| T-43e | Lecture de l'environnement du processus srt depuis l'intérieur d'une sandbox (`/proc`, `ps -E`) | **À ajouter**, non joué ; attendu : refus sur les deux OS | Banc, 1a.0 |
| T-45l | Témoin : `reserve(X)` rejoué × `settle(X)` | **À ajouter** ; attendu : l'ancien SQL donne `40P01`, le SQL amendé valide les deux | Banc puis Gherkin 1b.3 |
| T-34h-variante | T-34h avec `repo2/.git/hooks` non vide | **À ajouter** | Banc, 1a.0 |
| T-41D, T-38D, T-06D, T-34D, T-43D | Équivalents sous l'adaptateur OCI | **À prouver** | Banc Docker sur `ubuntu-24.04`, 1b.7 |
| E-01 à E-09 | Voir §20. E-04 et E-05 ont tourné avec `query()` hors sandbox, variante refusée par D-8 | **Fait macOS ; Linux : E-01, E-02, E-03, E-06 (I-7), E-04/E-05 (via T-41) passent au banc.** E-03-huge : `fail` sous macOS au run 41044838678, **défaut du banc** (§19.2), `pass` sous Linux | Corriger le banc ; `gate-linux` |

### 19.1 Banc 1b.0 : run `https://github.com/cdeust/architect-os/actions/runs/41038015293`

Historique du premier run étendu ; l'état à jour est au §19.2 (BROKER-FOREIGN y est remplacé par T-43, le P0 y est fermé au banc). Commit `b6fc924`, srt 0.0.81, Node v26.11.1, Agent SDK 0.3.312. Conclusion du run : `failure` (job Linux rouge ; le job macOS ne l'est pas). Les valeurs ci-dessous sont lues dans les deux rapports JSON des artefacts (`bench-sandbox-linux.json`, `bench-sandbox-macos.json`), non recopiées d'un résumé.

| OS | Tests | pass | fail | residual | finding |
|---|---|---|---|---|---|
| macOS (`macos-latest`, arm64, noyau 25.6.0) | 53 | 48 | 0 | 2 : T-03f, T-06b | 3 : T-06-s-TERM, T-06-s-KILL, BROKER-FOREIGN |
| Linux (`ubuntu-24.04`, x64, noyau 7.0.0-1017-azure, bubblewrap 0.9.0, ripgrep 14.1.0, sysctl AppArmor = 0) | 53 | 47 | 3 : T-02e, T-02e2, T-07-fd0 | 0 | 3 : les mêmes |

Lecture, par sujet :

- **T-41 (worker entier sous srt)** : T-41a à T-41d passent sur les deux OS, avec faux amont et **une seule couche srt** (argv : `node`, `tsx`, `t41-worker.ts` ; le binaire Claude Code est un enfant simple, aucune sandbox imbriquée). `query()` aboutit (`success:fin`, 2 requêtes amont, 2 au broker), la vraie clé n'existe ni dans l'environnement, ni dans les sorties, ni dans les fichiers (T-41b), `~/.ssh` et `~` ne sont pas lisibles (T-41c). **O-30 est sans objet, le repli n'est pas déclenché.** Limite : aucun appel réel à Anthropic, T-04R reste à jouer en 1b ; et le profil de T-41 autorise `127.0.0.1:<port>` du broker du banc, il n'exerce pas l'autorisation de task de T-42.
- **T-38, T-39** prouvés sur les deux OS. **T-39b** : Linux accepte `listen` dans la sandbox (`{"listening":true}`) mais la connexion de l'hôte reçoit `ECONNREFUSED` ; macOS refuse `listen` (`EPERM`).
- **T-02e et T-02e2 : échecs Linux réels.** Les chemins protégés absents au lancement ne sont pas protégés : `.git/hooks/pre-commit` (T-02e), `repo/.git/hooks/pre-commit` et `repo/.git/config` (T-02e2) ont **persisté sur l'hôte**, donc un hook peut persister et être exécuté hors sandbox. T-02e3 passe ; **T-02e4 (`denyWrite` explicite) passe sur les deux OS**. Règle de profil : §9.2.
- **T-07-fd0 : échec Linux réel.** Un socket d'écoute passé en fd 0 sert un client depuis la sandbox (`servi-depuis-sandbox`). Obligation de l'hôte : fd 0 à 2 uniquement des tubes, imposée dans l'adaptateur `SandboxRunner` (§4.8). **Contre-mesure non testée**, test à écrire en 1b.1.
- **BROKER-FOREIGN** : un processus natif étranger, même uid, hors sandbox, obtient `200` sur `POST` et le broker pose la vraie clé (`GET` : `403`). Confirmé sur Linux et macOS. **P0 ouvert jusqu'à T-42** ; T-43 le teste ensuite.
- **`denyRead ["~"]`** : `tmpfs` sous Linux (`ENOENT` sur `~/.ssh`, liste de `~` = `work`), `EPERM` sous macOS ; assertions : rien de sensible visible, rien de persisté.
- **Tuer `srt` seul laisse des processus** : SIGKILL, 10 sur 11 (Linux) et 2 sur 3 (macOS) ; SIGTERM, 0 (Linux) et 1 (macOS). Tuer le groupe n'en laisse aucun (T-06-g). **T-06b** : Linux 0 survivant ; macOS 1, survivant `setsid`, **résidu documenté**.
- **Exigences d'hôte** : Linux, `bubblewrap`, `socat`, `ripgrep` et `kernel.apparmor_restrict_unprivileged_userns=0` (§9.2, O-31) ; macOS, `sandbox-exec` (`ripgrep` absent, non exigé). Sur les deux OS, `TMPDIR=/tmp/claude` n'est pas créé par srt : un dossier temporaire par sandbox (`CLAUDE_CODE_TMPDIR`, `allowWrite`).

**Limites du banc, à ne pas perdre** :

1. Le broker du banc est **bufferisé** (il lit la réponse entière avant de la retirer) ; en 1b.2 il se fait en flux, SSE compris.
2. `npm audit` du banc : examiné le 2026-10-30 (§12) : deux avis élevés, le `zod` imbriqué de srt.
3. Les répertoires temporaires du banc ne sont pas nettoyés ; l'adaptateur de 1b.1 devra le faire.
4. Le banc se rejoue à chaque montée de version de srt (T-54).
5. T-41 ne prouve pas T-42 (voir plus haut) ; aucun appel réel à Anthropic.

### 19.2 Banc 1b.0 étendu : run `https://github.com/cdeust/architect-os/actions/runs/41044838678`

Commit `70a146f161dc13a932dcdb8b55de849548210ce2`, srt 0.0.81, Agent SDK 0.3.312, Node v26.11.1, Postgres 17.11 (Homebrew sous macOS, PGDG sous Linux), conclusion du run : `failure`. Valeurs lues dans les deux rapports JSON (`bench-sandbox-macos.json`, `bench-sandbox-linux.json`, champ `summary` et liste `results`), non recopiées d'un résumé. Résultat **brut, par OS**.

| OS | Tests | pass | fail | residual | finding |
|---|---|---|---|---|---|
| macOS (`macos-latest`, arm64, noyau 25.6.0, `sandbox-exec`, `ripgrep` absent) | 106 | 94 | 1 | 5 | 6 |
| Linux (`ubuntu-24.04`, x64, noyau 7.0.0-1017-azure, bubblewrap 0.9.0, ripgrep 14.1.0, sysctl AppArmor = 0) | 106 | 92 | 5 | 3 | 6 |

Tout ce qui n'est pas `pass`, par OS :

| OS | fail | residual | finding |
|---|---|---|---|
| macOS | E-03-huge | T-03f, T-06b, T-42h-base64, T-42h-hex, T-42h-sse-split | T-06-s-TERM, T-06-s-KILL, T-35-pre-fds, T-43d, T-45i, T-45k-ancien |
| Linux | T-02e, T-02e2, T-07-fd0, T-34h, T-34i | T-42h-base64, T-42h-hex, T-42h-sse-split | T-06-s-TERM, T-06-s-KILL, T-35-pre-fds, T-43d, T-45i, T-45k-ancien |

**Statut du banc (DC-7).** Le banc sort non nul au premier `fail` (`bench/src/run.ts`), et définit quatre statuts : `pass`, `fail` (propriété violée), `residual` (échec documenté et attendu), `finding` (constat de revue) (`bench/src/lib/common.ts`). La notion de comportement « brut » n'existe qu'en commentaire. Règle adoptée : le résultat **brut attendu est propre à chaque OS** (macOS passe T-02e, Linux le fait échouer) ; **tout changement par rapport au run précédent est signalé, dans les deux sens** ; T-34h et T-34i **restent rouges** parce qu'ils échouent avec la règle de profil active (§9.2), ils ne sont pas « bruts ». Par rapport au run 41038015293 (§19.1), les mêmes échecs, résidus et constats subsistent (T-02e, T-02e2, T-07-fd0 ; T-03f, T-06b ; T-06-s-TERM, T-06-s-KILL), BROKER-FOREIGN est remplacé par T-43, et les ajouts sont T-42, T-43, T-45, FD-PIPES, T-02e5, T-02e6, T-34a à T-34i, T-35-pre, soit 53 tests de plus.

**Par sujet.**

- **E-03-huge (macOS `fail`, `exit=0 erreurs=0` ; Linux `pass`, `erreurs=1`, `ReadBuffer` dépassé) : défaut du banc, pas de srt ni de l'hôte.** Cause : `bench/src/sandboxed/hostile.mjs:5` appelle `process.exit` 1 200 ms après un `write` de 11 Mio ; Node documente que les écritures sur tubes et sockets sont asynchrones sur POSIX et que `process.exit()` abandonne les écritures en attente. `inverted.ts` attend l'erreur côté hôte, qui ne survient que si plus de 10 Mio arrivent. La contre-expertise l'a reproduit sans srt par contre-pression (0 octet reçu) ; sous srt sur le poste, 11 Mio sont reçus (le relais de srt absorbe), donc le runner macOS est seulement plus lent. Correction à faire dans le banc, par le callback de `write` ou une assertion conditionnée aux octets reçus ; non faite ici.
- **T-34h, T-34i (Linux `fail`, macOS `pass`)** : §9.2, copie du builder (DC-2).
- **T-42, T-43** : §11.2. **T-43d** (finding, deux OS) : lecture de l'autorisation par `/proc/<pid>/environ` (Linux) et `ps -Eww -p <pid>` (macOS), rejeu `200`, une requête amont ajoutée ; accepté (DC-5).
- **T-45** : §4.5. T-45i (finding) lit l'ordre des verrous dans le SQL lui-même : `reserve` = `budgets` FOR UPDATE, `budget_reservations` INSERT, `budgets` UPDATE ; `settle` d'alors = `budget_reservations` UPDATE, puis `budgets` UPDATE ; `settle` corrigé = `budgets` FOR UPDATE en tête. Il confirme l'ordre non uniforme que T-45j et T-45k, passés avec 0 × `40P01`, ne déclenchaient pas.
- **T-35-pre-fds** (finding, deux OS) : `1:socket, 2:socket` vus par le code hostile, pour un lancement par le helper FD-PIPES ; voir C-23. **FD-PIPES-a à f** : pass sur les deux OS.
- **T-02e5, T-02e6** : pass sur les deux OS (macOS : `EPERM` partout ; Linux : `ENOENT`, `EROFS`, `EACCES`, rien ne persiste).

**Limites, à ne pas perdre.** Faux amont seulement, aucun appel réel à Anthropic (T-04R). Aucun banc Docker. L'absence de Docker sur `macos-latest` est **déduite, non vérifiée**. Le SQL de T-45 est encore extrait de ce document par le banc. Le SQL amendé de `settle` n'a pas encore passé T-45. T-43e, T-45l, T-34h-variante restent à ajouter ; E-03-huge reste à corriger.

## 20. Journal daté des expériences, 30 octobre 2026

Banc : répertoire jetable, `package.json` à versions exactes. Répertoire de travail : `/private/tmp/claude-501/-Volumes-Anthropic-anthropic-partnership/6bb87a64-cf19-42c8-b0ad-acc6739370b6/scratchpad/bench/`. Variable unique par expérience. Les scripts E-02 et le broker sont donnés en §4.3 et §11.2 ; le banc 1b.0 vit dans `bench/` (branche fusionnée depuis `feat/bench-sandbox`, journal `bench/JOURNAL.md`) et sera repris dans `features/sandbox/` en 1b.7.

**Baseline.** `npm run check` à `1746cc8` : `Tests 113 passed | 6 skipped (119)`, `Test Files 20 passed`, `no dependency violations (79 modules, 194 dependencies)`. **T-17** : `npx vitest run --reporter=json` : `total 119, passed 113, pending 6` ; les 6 = `SqlDataStore (real database)`. Effet de bord constaté : ce reporter écrit `.vitest/json/output.json` dans le dépôt, retiré ensuite ; aucun fichier conservé.

**E-01, MCP standard.** `node --import tsx e01/client.ts` : `StdioClientTransport({ command: 'srt', args: ['--settings', …, '--', 'node', '--import', 'tsx', 'e01/server.ts'] })`.
```
initialize_ms 461 ; tools [echo, probe] ; probe {"readHome":"EPERM","net":"ENOTFOUND"}
roundtrips 1000 ok, total_ms 41 ; payload 8388608 octets ok=true ms=143
```
Témoin sans srt : `initialize_ms 252`, `probe {"readHome":"LU","net":"200"}`, `total_ms 59`.

**E-02, rôles inversés.** `node --import tsx e02/host.ts`.
```
sans srt : seen=1000 allsame=true sum=499500 ms=38 denied=true
sous srt : seen=1000 allsame=true sum=499500 ms=45 denied=true
concurrentes : A seen=200, B seen=200, allsame=true
```
**Échec consigné** : `Error: write EPIPE`, non géré, à la fin du run : sans `child.stdin.on('error')`, l'hôte tombe. D'où l'obligation du §4.3.

**E-03, enfant hostile** sous srt. `garbage` : 2 erreurs de transport ; `huge` (11 Mio) : `ReadBuffer exceeded maximum size of 10485760 bytes` ; `die` : exit 9 ; `forged` (`_meta.task: AUTRE`) : handler de la bonne task, valeur ignorée. Ligne finale : `hôte vivant`.

**T-01.** `strictAllowlistt` : `clé inconnue tolérée`, exit 0. Fichier absent : `Refusing to run with the built-in defaults`, exit 1. Type invalide : même refus, message `network.allowedDomains: Expected array`. Toutes les clés présentes dans `dist/sandbox/sandbox-config.js`.

**T-02.** Profil `denyRead:["~"], allowRead:["."], allowWrite:["."]`.
```
a node ok v26.11.1, exit 0
b ~/.ssh stat dir, read EPERM ; ~/.zshrc EPERM ; ~/Library read EPERM
c HOME factice : cat id_test Operation not permitted
d écriture dans . ok ; écriture .. Operation not permitted, fichier absent
e .git/hooks/pre-commit, .mcp.json, .claude/agents/a.md : refus
f dist sous ~ sans allowRead : Cannot find module ; g avec allowRead ~/inst : ok
h denyRead ./sub sous allowRead . : refus ; i denyRead ../x relatif : refus
```
**Échec de méthode** : une première version créait un répertoire dans le vrai home puis le retirait ; le contrôle de sécurité a bloqué la commande avant exécution, rien n'a été créé. Refait avec `HOME` factice, sans suppression.

**T-03.** Faux serveur sur `127.0.0.1:<port>`.
```
a réseau nul, direct : REFUS EPERM
b réseau nul, NO_PROXY vidé + NODE_USE_ENV_PROXY=1 : Connection blocked by network allowlist
c allowlist, direct : REFUS EPERM ; d allowlist, NODE_USE_ENV_PROXY sans vider NO_PROXY : REFUS EPERM
e allowlist, NO_PROXY vidé + NODE_USE_ENV_PROXY=1 : OK hote-atteint /e
f allowLocalBinding, direct : OK, sans proxy
```
Conforme au README : une IP littérale listée échappe au contrôle d'adresses résolues. **U, socket Unix** : `REFUS EPERM`.

**T-06.** `node t06/run.mjs`, arbre `sh`, 2 `sleep`, `node`.
```
SIGTERM à srt seul     : sortie code 0, restants=1
SIGKILL à srt seul     : sortie SIGKILL, restants=2
SIGTERM au groupe      : sortie code 0, restants=0
SIGKILL au groupe      : sortie SIGKILL, restants=0
```
**Échec consigné** : la première version sans borne de temps est restée bloquée 120 s, puis mon `pkill -f` a tué le shell du banc lui-même, le motif figurant dans sa ligne de commande. Script borné, marqueur corrigé. **T-06b** : enfant `spawn(detached)` sous sandbox : `après kill du groupe, procs setsid restants 1`, PPID 1. Codes de sortie : `exit 7 → 7` ; `SIGTERM enfant → 0` ; `SIGKILL enfant → 1`.

**T-07.** Fd 3 : `enfant listen fd3 erreur ENOTTY`, réponse vide. Fd 0 : `enfant erreur EPERM`, réponse vide.

**T-09.** `ulimit -u 200` autour de srt : `sh: fork: Resource temporarily unavailable`, statut 128, compte par utilisateur. `ulimit -v` : `unlimited`.

**T-10.** `node e02/latency.mjs`, N=20 : `node seul médiane=117ms srt+node médiane=329ms surcoût=211ms`.

**T-11.** Premier essai : `Validation failed (--strict treats warnings as errors)`, `description` et `author` manquants. Corrigé : `Validation passed`, exit 0.

**T-12.** `pickles 4` ; Background recopié ; `outline 1`, `outline 2`, `in rule`. Identique sur gherkin 42.0.1 et 38.0.0.

**T-13.** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only mode` ; import `.js` : `ERR_MODULE_NOT_FOUND` ; `--experimental-transform-types` : `bad option` ; `--import tsx` : `1`. Cucumber avec `tsx` sur `gateway/src/infrastructure/in-memory.ts` : `{pickles:2, testCases:2, statuts:{PASSED:3, UNDEFINED:1}, success:false}`. **T-13c** : `cucumber exit=0 ; statut SKIPPED ; success true`.

**T-14.** **Échec, 13.3.0 et 13.0.0** : `Failed to import formatter file`, puis aux runs suivants `Cannot set properties of undefined (setting 'instrumenterContext')`. J'ai d'abord pris ce second message pour la cause et testé sans `tsx`, puis constaté `stryker-formatter.cjs` à **0 octet** dans `node_modules` : le fichier publié fait 6 790 octets, restauré depuis `npm pack`, retronqué au run suivant. Variante `testRunner: command` : `ERR_MODULE_NOT_FOUND` dans le bac de Stryker, abandonnée. **Succès, 12.9.0** (version de développement du runner) :
```
src/calc.ts L4 ConditionalExpression "true"  Survived coveredBy=1
src/calc.ts L4 ConditionalExpression "false" Killed   coveredBy=1
src/calc.ts L4 EqualityOperator "n <= this.max" Survived coveredBy=1
src/calc.ts L4 EqualityOperator "n >= this.max" Killed   coveredBy=1
```
**T-14b** : code exécuté seulement par `execFileSync` : 2 mutants `Survived`. **T-22** : assertion retirée du step, `1 scenario (1 passed)`, et les 4 mutants `Survived`. **M-01** : voir §13.6.

**T-15.** `npm error code EUSAGE`, `lock file's yaml@2.9.1 does not satisfy yaml@2.9.0`.

**T-16.** `docker run ubuntu:24.04`, `apt-cache policy` : `bubblewrap 0.9.0`, `socat 1.8.0.0`, `ripgrep 14.1.0`, `postgresql-16 16.15`, `postgresql-17: absent`, `postgresql-16-pgvector 0.6.0`.

**T-19.** `gh api repos/cdeust/architect-os` : public ; `/rulesets` : 0.

**T-04.** Faux amont TLS local, `BENCH_API_KEY` factice. **Échec de configuration d'abord** : `injectHosts` refuse `127.0.0.1:<port>`, `localhost:<port>` et `api.anthropic.com:443` (`Invalid domain pattern`) ; accepte `api.anthropic.com` et l'absence d'`injectHosts`. `mask` sans `tlsTerminate` : `Credential masking requires network.tlsTerminate`. Avec `bench.localhost` :
```
enfant voit: fake_value_e622f5e2-… ; mock: x-api-key recu=sk-faux-valeur-reelle-123 status 200
sans CA amont : Bad Gateway 502 ; curl : substitution identique
```
Adversarial, reçu par l'amont :
```
/reflect   host=bench x-api-key=RÉELLE    -> enfant reçoit : FUITE
/err       host=bench x-api-key=RÉELLE    -> enfant : pas de clé (401)
/body?q=<S> host=bench x-other=RÉELLE body=RÉELLE ; query inchangée
/direct    host=evil  x-api-key=sentinelle
/apres-redir host=evil x-api-key=sentinelle
/hostswap  host=evil  x-api-key=sentinelle
/plain     host=bench (HTTP clair) x-api-key=sentinelle
ps -axeww, ps eww parent : EPERM
```

**E-04, Agent SDK sous srt, faux amont.** `node --import tsx e04/host.ts`, `spawnClaudeCodeProcess` + `mask`. Banc mené avec `query()` hors sandbox, variante refusée depuis par D-8 ; il reste la preuve que le SDK, le binaire et le faux amont fonctionnent sous srt.
```
{"spawned":["claude"],"handlerDansHote":true,"result":{"subtype":"success","structured":{"summary":"fait"},"turns":3},
 "tools":["Read","StructuredOutput","mcp__platform__memory_search"],"mcp":[{"name":"platform","status":"connected"}]}
mock : key=sk-ant-faux-pour-banc, hostResult=true
```
**E-04b / E-08, profils.** `plugins` + `agent:'bench-profiles:scout'` : `model claude-haiku-5-5`, `tools [Read, Grep, mcp__…]`, **mais `marker=false, sysLen=225`**. `agents:{prog}` + `agent:'prog'` : `marker=true, sysLen=314`. `systemPrompt` : `marker=true, sysLen=316`.

**E-05, broker par task.** `node --import tsx e04/host5.ts` : `{"name":"seul","out":"success:fin","brokerRequests":2,"ms":1216}` ; avec profil : `success:fin`, `ms 957` ; l'amont reçoit la vraie clé, l'enfant `ANTHROPIC_API_KEY=aucune-cle-ici`. **E-06** : deux tasks, `SIGKILL` sur le groupe de l'une à 400 ms : `victime EXCEPTION: Claude Code process terminated by signal SIGKILL` ; `survivante success:fin`, `brokerRequests 2`.

**T-23 / E-05c, broker adversarial.**
```
a env contient la clé: non ; ANTHROPIC_API_KEY=aucune
e corps/en-tête avec fake_value_x : 200, bodyHasReal=false
hors /v1/messages : 403 ; GET : 403 ; amont direct : 403 allowlist ; internet : fetch failed
d amont réfléchissant, retrait sans enlever content-length : UND_ERR_SOCKET, pas de fuite
d amont réfléchissant, sans retrait : FUITE reflet=sk-faux-valeur-reelle-123
```

**T-20.** Postgres réel : `300 réservations de 10, plafond 1000 : acceptées 100 refusées 200` ; `réconciliation : reserved 0, spent 700` ; `100 de plus : acceptées 30`.

**T-21.** `valide ok | rejeu rejoué ; autre module audience | hors capacité capacité | expiré expiré ; task falsifiée signature ; émission 0.103 ms, vérification 0.202 ms, N=5000`.

**T-24.** Linux (conteneur), même uid : `/proc/pid/environ` contient la valeur ; autre uid : `Permission denied`. macOS 27, `ps eww`, même uid : la valeur n'apparaît pas. **Corrigé par T-43d (run 41044838678)** : sous macOS, `ps -Eww -p <pid>` lit l'autorisation dans l'environnement du processus srt ; la formulation « `ps eww` ne montre pas l'environnement » ne vaut pas frontière.

**T-37.** `node --permission --allow-fs-read='*'` : `child_process`, écriture, connexion Unix : `ERR_ACCESS_DENIED` ; `process.env` reste lisible.

**E-09, Postgres.** `initdb -A peer`, `listen_addresses=''`, socket `0700`, port 55439. **Échec d'abord** : `le postmaster est devenu multithreadé lors du démarrage`, corrigé par `LC_ALL=en_US.UTF-8`. `psql -h 127.0.0.1` : `Connection refused`. `TEST_DATABASE_URL=… npx vitest run` : `Test Files 20 passed (20), Tests 119 passed (119)`. Depuis srt, réseau nul : `REFUS EPERM`. Avec `allowUnixSockets` sur le chemin exact : `CONNECTÉ`. **Erreur de méthode corrigée** : un premier essai désignait `.s.PGSQL.5432` alors que le socket était `.55439`, son `EPERM` ne prouvait rien.

**E-07, Linux : échec, consigné.** `docker run --privileged node:26-bookworm-slim`, kernel 6.8.0-64, bubblewrap 0.8.0, `srt` 0.0.81.
```
non-root : bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
root     : apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted …)
           bwrap: Can't create file at /work/.gitconfig: Permission denied
--security-opt apparmor=unconfined : même échec
enableWeakerNestedSandbox : même échec
/proc/sys/kernel/apparmor_restrict_unprivileged_userns = 1
```
Cause documentée par le README pour Ubuntu 24.04. **Je n'ai pas modifié ce sysctl** de la VM : c'est un réglage de sécurité de l'hôte, et le banc de référence existe ailleurs. Seul passage utile : E-02 sans srt. **Aucune preuve Linux de srt n'existe donc à ce stade** ; elles sont portées par 1b.0 sur `ubuntu-24.04`, avec le sysctl que `claude-code-action` pose lui-même. Si l'une d'elles échoue, la conception est revue avant 1b.1. **Levé le 30 octobre 2026** : le banc a tourné sur `ubuntu-24.04` (journal du banc 1b.0, ci-dessous) ; trois échecs Linux ont conduit à la révision de ce document.

**T-44, PR hostile contre la porte (revue externe, P0).** Répertoire jetable, `@cucumber/cucumber` 12.9.0, Stryker 10.1.1, `tsx`. Code de la PR : `allow()` bogué, `return n < this.max || true`. Deux scénarios, dont un qui attend un refus. Trois versions des steps, une variable à la fois ; `gatecheck.mjs` applique §13.3 et §13.6 aux rapports. `./run.sh <variante>` :
```
honest   : cucumber FAILED « true !== false » ; Stryker s'arrête au run initial, aucun rapport : ROUGE
noassert : cucumber exit=0 ; {"pickles":2,"verts":2,"mutants":{"Survived":8},"porte":"ROUGE"}
hostile  : cucumber exit=0 ; {"pickles":2,"verts":2,"mutants":{"Killed":8},"porte":"VERTE"}
```
Version hostile : le step appelle le code pour la couverture, n'affirme rien, et lève une erreur si `globalThis.__stryker__.activeMutant` est défini. **La PR passe.** Aucun fichier de rapport n'est forgé. **Sous srt, réseau nul, macOS** : cucumber passe, Stryker échoue, `listen EPERM 0.0.0.0`. **Échec consigné** : ma conclusion attendue était une porte verte, le premier run a échoué pour une autre raison, `ERR_MODULE_NOT_FOUND` sur `src/calc.js` faute de `--import tsx` pour cucumber-js. Avec `allowLocalBinding` : même résultat `VERTE`, 8 `Killed`. Sous Linux : non joué ici, T-50.

**Test de pérennité, 30 octobre 2026** (§4.11). `gh api repos/<dépôt>`, `gh api repos/<dépôt>/releases/latest`, `gh api "repos/<dépôt>/commits?since=<90 jours>&per_page=100"` groupé par domaine d'auteur ; `gh api "repos/torvalds/linux/commits?path=security/landlock&since=<12 mois>"` ; `man sandbox-exec` ; pages citées au §4.11. Podman : `docs/source/markdown/podman-machine.1.md`, fournisseurs macOS `libkrun` et `applehv`. Taille de srt : `find dist -name '*.js' | xargs cat | wc -l` = 23 160. `node:net` : aucune méthode d'identifiants de pair sur `Socket.prototype`, seul `_getpeername`.

**Banc 1b.0, CI, 30 octobre 2026** (`bench/`, `.github/workflows/bench-sandbox.yml`, déclenché par `feat/bench-sandbox` et `workflow_dispatch`). Trois runs, échecs conservés (détail : `bench/JOURNAL.md`).

- **Run 41037109539 (`9c161f5`).** macOS : T-41a, T-41b, T-41d, I-7 en échec, `EPERM: operation not permitted, mkdir '/tmp/claude-501'` : le binaire Claude Code crée son dossier temporaire par `mkdir` non récursif ; il existait sur le poste, pas sur le runner, **le run local était un faux vert**. Linux : srt fonctionne (bwrap 0.9.0, sysctl à 0) ; T-38, T-39, E-02, T-41 en échec, `ENOENT mkdir /tmp/claude/tsx-1001` : srt fixe `TMPDIR=/tmp/claude` sans le créer. Correction, une variable : un dossier temporaire par monde, `CLAUDE_CODE_TMPDIR` et `allowWrite`. **Erreur du banc** : T-03f avait son attendu inversé sur Linux (`expectReached` passé à l'envers). **Hypothèse fausse** : `denyRead ["~"]` sous Linux ne donne pas `EPERM` mais un `tmpfs` ; la propriété testée devient « rien de sensible visible, rien de persisté ».
- **Run 41037711860 (`c2af66d`).** macOS : 47 pass, 0 fail, 2 residual, 3 finding. Linux : 44 pass, 5 fail : T-02e, T-02e2 (hook et `.git/config` écrits par la sandbox persistent sur l'hôte quand le chemin n'existait pas au lancement ; README srt : seuls les chemins présents sont protégés), T-07-fd0, et deux défauts d'assertion du banc (`list_home` sous Linux, tmpfs vide : T-38, T-41c), corrigés.
- **Run 41038015293 (`b6fc924`).** Conclusion `failure`. macOS : 53 tests, 48 pass, 0 fail, 2 residual (T-03f, T-06b), 3 finding (T-06-s-TERM, T-06-s-KILL, BROKER-FOREIGN). Linux : 53 tests, 47 pass, 3 fail (T-02e, T-02e2, T-07-fd0), 3 finding (les mêmes). T-02e4 (`denyWrite` explicite) passe sur les deux OS. Sorties clés :
```
T-02e   Linux  retour sandbox={"git-hooks":"OK","mcp-json":"EACCES","claude-agents":"ENOENT"} persistes_sur_l_hote=[".git/hooks/pre-commit"]
T-02e2  Linux  retour sandbox={"git-hooks":"OK","git-config":"OK"} persistes_sur_l_hote=["repo/.git/hooks/pre-commit","repo/.git/config"]
T-02e4  Linux  {"t0":"ENOENT","t1":"EROFS","t2":"EACCES","t3":"ENOENT","t4":"EROFS","t5":"EACCES"} persistes=[] ; macOS : six EPERM, persistes=[]
T-07-fd0 Linux reponse recue par le client="servi-depuis-sandbox\n" ; macOS : reponse="" erreur EPERM
T-39b   Linux  listen dans la sandbox={"listening":true,"port":33351} ; connexion de l'hote=ECONNREFUSED ; macOS : {"listening":false,"error":"EPERM"}
T-06-s-KILL  Linux procs_avant=11 procs_restants=10 ; macOS procs_avant=3 procs_restants=2
T-06b   Linux  avant=11 apres_kill_groupe=0 ; macOS avant=3 apres_kill_groupe=1
T-38 / T-41c Linux  list_home=LISTE:work ssh_read=ENOENT ; macOS list_home=EPERM ssh_read=EPERM
```
Reste hors banc : répertoires temporaires non nettoyés, rejeu à chaque montée de srt (T-54). (`npm audit` : examiné plus bas.)

**Banc 1b.0 étendu, CI, 30 octobre 2026** : run 41044838678, commit `70a146f`, `failure`. Résultats au §19.2 : macOS 106 tests, 94 pass, 1 fail (E-03-huge, défaut du banc), 5 residual, 6 finding ; Linux 106 tests, 92 pass, 5 fail (T-02e, T-02e2, T-07-fd0, T-34h, T-34i), 3 residual, 6 finding. Extraits :
```
T-34h  Linux  retour sandbox={"hook":"OK","config":"EROFS"}  persistes=["cree:repo2/.git/hooks/pre-commit"] ; macOS : {"hook":"EPERM","config":"EPERM"}
T-34i  Linux  retour sandbox={"hook":"OK","config":"OK"}  persistes=["cree:repo3/.git/config","cree:repo3/.git/hooks/pre-commit"] ; macOS : EPERM, EPERM
T-43d  Linux  lecture_par=/proc/<pid>/environ autorisation_lue=true rejeu_status=200 requetes_amont_ajoutees=1 ; macOS : ps -Eww -p <pid>, mêmes valeurs
T-45a-témoin  macOS 5/6 manches sur-retenues (20,20,10,30,30,410) ; Linux 6/6 (20,60,40,30,60,60)
T-45b-témoin  spent=350 reserved=-490 (deux OS) ; T-45c-témoin  reserved=-969 (deux OS)
T-45k-document, T-45k-corrigé  40P01=0 (deux OS) ; T-45j-document, T-45j-corrigé  interblocage=0 (deux OS)
```

**Contre-expertise adversariale, 30 octobre 2026** (rapport hors dépôt ; expériences dans `scratchpad/fable/{git,pg,e03,lat}` ; chiffres repris du rapport, non rejoués par cette révision sauf mention). Postgres 17 local, git 2.54, Docker local par Colima (Engine 28.3.3, VM Ubuntu 24.04.2, noyau 6.8, contexte `colima-ci-autonome`), `kernel.apparmor_restrict_unprivileged_userns = 1` dans la VM, aucun sysctl modifié, aucune clé, aucun appel à l'API Anthropic.
- `fable/git` : worktree, hook écrit depuis la copie et exécuté par un `git commit` de l'hôte (`HOOK-EXECUTE`) ; `git fetch ../hostile` lance `git-upload-pack` dans la copie (`GIT_TRACE`), `index-pack --strict` visible avec `fetch.fsckObjects=true` ; bundle créé dans la copie, lu par l'hôte : aucun processus lancé dans la copie ; `.gitattributes` `filter=evil` ignoré, sous-module `../sub` refusé.
- `fable/pg/deadlock.mjs` : SQL du §4.5 d'alors, A = `reserve(t, X)` rejoué, B = `settle(X)` : B `40P01`, `reserved 10 / spent 0`, X `observed`, `pg.log` 1 interblocage ; ordre uniforme : `reserved 0 / spent 7`, X `settled`.
- `fable/e03` : `hostile.mjs` sans srt, lecteur qui attend 1,5 s, 0 octet reçu ; sous srt sur le poste, 11 Mio reçus.
- `fable/lat` : `docker run --rm node:26-bookworm-slim node -e 1` 87 ms médiane (85 ms durci), `srt + node` 316 ms, `node` seul 107 ms.
- `spawn` Node avec `stdio: 'pipe'` : `0:socket 1:socket 2:socket`.
- API GitHub : `main` non protégée (404), 0 ruleset ; SHA de tags `actions/checkout` v6 et `actions/setup-node` v7.

**Cette révision, 30 octobre 2026** (relevés refaits ici). `npm audit` racine : 4 vulnérabilités, 2 modérées (`qs` imbriqué sous `typed-rest-client`, `typed-rest-client`) et 2 élevées (`zod` imbriqué sous srt, srt) ; `bench/` : 2 élevées. `npm ls zod` dans `bench/` : `zod@3.25.76` sous `@anthropic-ai/sandbox-runtime@0.0.81`, `zod@4.6.7` ailleurs. `grep` de `dist/` de srt : `zod` importé par `sandbox/sandbox-config.js` et `sandbox/decider-client.js`. API GitHub : le tag `v1` de `anthropics/claude-code-action` est un objet de tag annoté (`2ac8fded…`) qui pointe sur le commit `6d5ae526…` ; `checkout` v6 et `setup-node` v7 pointent directement sur des commits. Page overview de l'Agent SDK relue (note sur la connexion claude.ai). Valeurs du run 41044838678 lues dans les JSON. Aucun secret lu, aucun fichier de secret ouvert.
