# Plateforme v3 sous sandbox-runtime (srt) : document de conception

Statut : proposition, révision du 30 octobre 2026, amendée par la décision D-8 du propriétaire et par la deuxième revue externe (§1.2). Aucun code applicatif n'est modifié par ce document ; l'implémentation commence par l'épinglage 1a.1 puis le banc 1b.0 (§15).

Nom : `ai-architect.tools` reste la marque. `architect-os` est un **nom provisoire**, le choix définitif est suspendu par le propriétaire ; son isolation est décrite au §7.2 pour qu'un renommage reste mécanique.
Base : `feat/marketplace-srt` à `1746cc8`, amendée depuis `584ac03`. Cible : la vision « ai-architect.tools, architecture plateforme v3 » (29 octobre 2026), ci-après **v3** (`docs/design/platform-v3.html`, inchangé), amendée par les décisions du §1.

Conventions de preuve, appliquées à chaque affirmation technique :

- **[V: source]** : lu en source primaire (documentation officielle, `.d.ts` ou README de la version épinglée, fichier du dépôt).
- **[E-xx] / [T-xx]** : expérience exécutée en isolation, consignée au §20 avec commande et sortie, échecs compris.
- **[À PROUVER: T-xx, banc, brique]** : pas encore de preuve. Le test, le banc et la brique sont nommés ; rien de ce qui est ainsi marqué n'est livré avant que le test ait tourné.

Tout s'est exécuté sur macOS 27 (`arm64`, Node 26.11.1, srt 0.0.81, MCP SDK 1.32.2, Agent SDK 0.3.312, Claude Code 2.1.312). **Aucun appel réel à l'API Anthropic n'a eu lieu** : le binaire Claude Code a parlé à un faux amont TLS local, et le profil srt ne laissait passer que lui. Linux n'est pas prouvé ici, voir E-07 au §20.

---

## 0. Ce que cette révision change

| Avant (`1746cc8`) | Maintenant | Preuve |
|---|---|---|
| Protocole JSON lines maison entre `platformd` et les sandboxes | **Supprimé.** MCP stdio avec le SDK officiel pour l'executor, le worker et les modules ; le SDK garde son canal vers le binaire, dans la sandbox | E-01, E-02, E-04 |
| `platformd`, démon superviseur avec socket de contrôle et clé Anthropic | **Supprimé** (D-9). Une bibliothèque de lancement, port `SandboxRunner`, appelée par la seule gateway (§4.8), et une table de modules au format `.mcp.json` | E-02, E-05, E-06 ; [À PROUVER: T-47, Gherkin, brique 1b] |
| Clé masquée par srt (`mask` + `tlsTerminate`), repli broker | **Inversé** (D-10). Broker par task, seul détenteur de la clé Anthropic. Le masquage est écarté pour cette clé ; une autorisation de task, de faible valeur, remplace le port comme identité (§11.2) | T-04 (échec adversarial), E-05, T-23 ; [À PROUVER: T-42, T-43, banc, 1b.0] |
| Worker Node dans la sandbox, stdin/stdout JSON, outils relayés en HTTP | **Worker entier sous srt** (D-8) : `query()`, handlers minces et binaire Claude Code dans la même sandbox. stdin/stdout portent MCP vers la gateway, sur le patron de l'executor. Plus de JSON maison ni de HTTP interne | E-02 pour le transport ; E-04, E-05 pour le SDK et le binaire ; [À PROUVER: T-41, banc, 1b.0] |
| Modules `kind: data\|workflow` natifs | **Sous srt, en stdio, plugins compris** (D-8) | E-01 pour le transport ; [À PROUVER: T-38, banc, 1b.0] |
| Profils de task propriétaires | Fichiers `agents/<nom>.md` au format Claude Code + profil srt JSON statique | E-04b, E-08 |
| Gabarits `{{runtime}}`, `{{repo}}` | **Supprimés.** Chemins relatifs à la task, `~` natif | T-02c à T-02i |
| `@cucumber/cucumber` 13.3.0 | **12.9.0**, 13.x casse le runner Stryker | T-14 |
| « Validation » d'un budget ou d'un jeton à l'entrée de la gateway | Réservation atomique en base ; jeton d'appel vérifié par le module | T-20, T-21 |

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
| D-11 | Repli srt : un seul port d'exécution, srt comme unique adaptateur, critères de déclenchement écrits, candidats évalués sans décision | §4.11 |

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

## 2. Trois piliers

| Pilier | Statut |
|---|---|
| I. Recherche reproductible | **Fait** : sources Anthropic lues (§16), bancs exécutés avec échecs consignés (§20), expérience adversariale T-44, test de pérennité daté (§4.11). **Prévu brique 1a.1 puis 1b.0** : les expériences du §20 deviennent `features/sandbox/*.feature`, rejouées sur Linux et macOS, une commande, avant la migration complète. **Prévu brique 1a** : `npm run gate` rejoue la porte en une commande. **Prévu briques 2 et 3** : M1, M2 et R relevés, non bloquants (§15.1). **Prévu brique 0, reportée par D-7** : baseline des vingt tâches |
| II. SSDLC | **Fait** : STRIDE mis à jour pour chaque changement de topologie (§11.3), supply chain (§12). **Prévu brique 1a** : SAST = porte Gherkin + mutation, limite écrite (I-8). **Prévu briques 1b.0 et 1b.7** : DAST = suite d'évasion contre de vrais processus srt (§11.4), test du natif étranger (T-43), rejouée à chaque montée de version de srt |
| III. Opérationnel | **Fait** en conception : moindre privilège par profil (§9), aucune exécution hors du conteneur hors quatre exceptions prouvées (§4.7), aucun secret dans une sandbox de modèle (§4.2), modèle de confiance écrit (§11.1). **Prévu brique 1b** : invariants du §11.5 prouvés sur les deux OS. **Sans objet** pour l'IRB tant qu'aucune donnée humaine ou stratégique n'est traitée ; réévalué en brique 4 si memory reçoit des données personnelles |

## 3. Écarts vs v3

| Élément v3 | Version srt | Raison |
|---|---|---|
| `compose.yaml` « identique laptop et serveur » | `topology/modules.mcp.json` au format `.mcp.json` : chaque module y est `type: stdio`, `command: srt` ; seuls `broker` et `data` sont déclarés natifs, le schéma refuse tout autre. Mêmes processus, sémantiques OS différentes (Seatbelt, bubblewrap) | D-1, D-8. Format de Claude Code [V: https://code.claude.com/docs/en/mcp]. Un module `type: http` est refusé par schéma tant que T-39 n'a pas tourné |
| [1] Reverse proxy | Hors plateforme, serveur seulement, un `Caddyfile` descriptif ; aucun code n'en dépend | §5.1 |
| [2] Gateway en conteneur | Processus natif ; ne peut pas tourner sous srt | T-07 : fd ≥ 3 non transmis, `listen` sur fd 0 refusé |
| [3] Executor, pool chaud | `srt -- node executor.js`, réseau nul, client MCP sur ses stdin/stdout ; le serveur en face est la gateway | E-02 ; T-10 : surcoût de lancement 211 ms |
| Conteneurs de task | Worker entier sous srt : `srt -- node worker.js`, avec `query()`, handlers minces et binaire Claude Code ; profil `agents/<nom>.md` + `<nom>.srt.json` | D-8 ; E-04, E-05 ; [À PROUVER: T-41, banc, 1b.0] |
| [4] Modules en conteneur (légende v3 §2 : « les autres conteneurs sont des workflows déterministes ») | Un processus srt par module, en stdio, plugins compris. Le `containers: []` de v3 §6 visait le conteneur de task, pas le module | D-8 ; E-01 ; [À PROUVER: T-38, banc, 1b.0] |
| [5] Structurer, Judge, Embedder en conteneur | Modules workflow sous srt, placés au §4.7, décidés en brique 8 | D-8 |
| Orchestrateur, « clés API injectées par task » | **Aucune clé dans une task.** Broker hors sandbox, un listener et une autorisation par task | T-04, E-05, T-23 ; [À PROUVER: T-42, banc, 1b.0] ; [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment#the-proxy-pattern] |
| « Jeton par task, révoqué à l'annulation » | Jeton d'appel Ed25519 vérifié par le module cible. L'executor et le worker n'en détiennent aucun ; un module sous srt détient seulement celui de son appel en cours | T-21, §4.4 |
| `--memory`, `--pids-limit` | Linux : `systemd-run --scope` autour de `srt`, sans script. macOS : aucune limite par sandbox, résidu assumé | T-09, §11.1 |
| Postgres en conteneur | Natif, `listen_addresses=''`, `peer` sur socket Unix | E-09 : 119/119 sur ce montage |
| Plugins + dépôt `marketplace` séparé | Marketplace à la racine, plugins clients sous `plugins/`, modules serveur sous `modules/` | D-2, O-10 |
| Manifeste `containers:` | `sandboxes:` (profil, écritures, modèle, budget) | D-1 |
| `stage0/Dockerfile`, `fixpoint.sh` « digests comparés » | Paquet npm `@architect-os/stage0` épinglé, aucun shell | D-6, §14 |
| `platform-build.yml` dans le conteneur stage 0 | `gate.yml` : porte Gherkin + mutation, Linux **et** macOS | D-6, §13 |
| `agent-approval-check`, `spec-lint` requis | Seule la porte est requise ; `spec-lint` devient un scénario | D-6, C-9 |
| Runner auto-hébergé pour tout | Workflows Claude seulement ; la porte tourne sur runners hébergés | §13.8 |

## 4. Topologie

### 4.1 Figure

```
              client (Claude Code / Codex / claude-code-action)
                        |  MCP http ; 127.0.0.1 sur un poste, TLS par le déploiement sur un serveur
                        v
 ---------------- hôte : quatre exceptions NATIVES, chacune prouvée (§4.7) -------------
 [gateway]   écoute 127.0.0.1:8080 ; seul point de politique ; seul parent des sandboxes
             auth, profils, DAG calls_allowed, budgets, registre, max_result_tokens
             SandboxRunner : seule autorité de lancement, entrées fermées (§4.8)
             un serveur MCP par sandbox, posé sur les tubes de l'enfant
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
    serveur MCP sur stdin/stdout ; réseau : gateway par le proxy srt, rien d'autre
 srt --settings scout.srt.json -- env -u NO_PROXY -u no_proxy node worker.js (1 par task)
    query(), handlers minces, binaire Claude Code enfant ; client MCP sur stdin/stdout
    réseau : broker de CETTE task seul ; aucune clé ; lecture : "." ; ./repo en lecture seule
 srt --settings builder.srt.json …           écriture : copie de travail jetable "."
 srt --settings zetetic-reviewer.srt.json …  lecture de ./repo et du diff ; écriture "."
 srt --settings web-scout.srt.json -- node web-scout.js   recommandation à confirmer (O-27)
    allowlist du manifeste, plages privées refusées, sans modèle
 srt --settings db-migrator.srt.json -- …                 recommandation à confirmer (O-28)
    Postgres jetable dans la sandbox, sans modèle, aucun accès à la base réelle
 --------------------------------------------------------------------------------------
 Proxys srt : un couple HTTP/SOCKS par processus srt, côté hôte
```

### 4.2 Qui détient quel secret

| Secret | Détenteur | Jamais présent dans |
|---|---|---|
| Clé Anthropic (runtime) | `broker` seul, lue depuis un fichier 0600 sous `~/.architect-os/` | gateway, data, sandboxes (ni clé, ni sentinelle de cette clé) |
| Autorisation de task (§11.2) | broker, gateway le temps du lancement, proxy srt de la task côté hôte | sandbox : le modèle ne voit qu'une sentinelle |
| Clé privée Ed25519 des jetons d'appel, table des clients | gateway | modules (clé publique seule), sandboxes |
| Jeton d'appel | gateway et module cible sous srt, le temps d'un appel | executor, worker agent |
| Identifiants Postgres | aucun : `peer` sur socket Unix [E-09] | partout |
| Clé TLS du serveur | déploiement (§5.1) | plateforme |
| CI : `GATEWAY_CI_TOKEN` | secret GitHub du workflow Claude | porte de tests |
| CI : accès Anthropic | fédération OIDC, `id-token: write` [V: https://code.claude.com/docs/en/github-actions#set-up-for-an-organization] | dépôt |

Une sandbox de modèle n'a donc **aucun secret à voler**. Un module sous srt ne détient que le jeton de son appel en cours, limité à cette audience, ces capacités et cette échéance. Le risque résiduel est l'usage du broker pendant la task : une sandbox compromise peut consommer son propre budget, pas celui d'une autre, et pas lire la clé.

### 4.3 Un seul patron de canal, aucun protocole maison

**Executor, code mode (E-02).** L'enfant est **client** MCP sur ses propres stdin/stdout, la gateway est **serveur** sur les tubes de l'enfant. Aucune ligne de protocole à écrire, parce que `StdioServerTransport` est un `Transport` symétrique et accepte deux flux quelconques [V: `@modelcontextprotocol/sdk` 1.32.2, `dist/esm/server/stdio.d.ts`].

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

Les trois messages JSON lines disparaissent : `start` devient le tool `task_input`, `call` devient `tools/call`, `output` devient `task_complete`. Ces tools vivent sur les tubes de l'enfant, jamais dans le catalogue du client. Résultats : 1 000 allers-retours en 45 ms sous srt contre 38 ms sans, charge de 8 Mio passée, deux tasks concurrentes sans mélange, `tools/list` limité au profil, tool hors profil refusé. Un `_meta.task` forgé par l'enfant est ignoré, la gateway ne lit que la fermeture [E-03]. Un enfant hostile qui écrit du faux JSON ou une ligne de 11 Mio produit une erreur de transport, l'hôte reste vivant [E-03]. Le sens standard (hôte client, enfant serveur) marche aussi [E-01] et sert aux modules, qui exposent des tools ; il ne permet pas à l'enfant d'appeler des tools : MCP ne prévoit de requêtes serveur vers client que pour l'échantillonnage, l'élicitation et les racines. D'où le sens inversé pour l'executor et le worker, et le rappel de la gateway par le proxy srt pour un module (T-38).

**Agents, même patron.** Le worker entier est l'enfant : `query()`, ses handlers et le binaire Claude Code que le SDK lance tournent dans la sandbox. Il est client MCP de la gateway sur ses stdin/stdout, le SDK garde ses propres tubes vers le binaire. Chaque handler de `createSdkMcpServer` ne fait que relayer vers la gateway. E-04 et E-05 prouvent le SDK, le binaire et le broker sous srt, E-02 prouve le transport ; leur réunion dans une seule sandbox n'a jamais tourné : [À PROUVER: T-41, banc, 1b.0].

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

Chaque requête vers le modèle, et chaque appel budgété, passe par une **réservation identifiée, idempotente et persistée avant le premier octet transmis**. Si `data` est injoignable, le broker refuse : pas de réservation, pas d'envoi. Opérations typées de `data`, en fichiers `.sql` (`CLAUDE.md` : SQL seulement dans `data/`), identifiant `reservation_id` choisi par l'appelant :

| État | Sens | Effet sur le disponible | Transitions |
|---|---|---|---|
| `reserved` | Persistée, envoi possible | Montant retenu | `observed`, `unknown`, `settled` (`not_sent` seulement) |
| `observed` | `usage` lu dans la réponse complète | Montant observé retenu | `settled`, `settled_admin` |
| `unknown` | Interruption : broker mort, flux coupé, réponse sans `usage` | **Montant réservé retenu, jamais libéré** | `settled`, `settled_admin` |
| `settled` | Réconciliation définitive, source `usage`, `invoice` ou `not_sent` | Coût final | Terminal |
| `settled_admin` | Réconciliation administrative, avec auteur et motif | Coût décidé | Terminal |

- **Idempotence** : rejouer `budget.reserve` avec le même `reservation_id` renvoie la ligne existante, ne réserve rien de plus.
- **`not_sent`** : seul le broker peut l'écrire, et seulement s'il prouve qu'aucun octet n'a quitté le processus. Tout autre doute donne `unknown`.
- **Reprise** : au démarrage du broker, chaque `reserved` encore ouverte passe `unknown`.
- **Autorité** : une `unknown` se règle sur l'API Usage and Cost ou la Console, sinon par décision administrative. Aucune tâche de fond ne l'efface pour libérer le budget.
- **Facture supérieure à la réservation** : `spent` enregistre le montant réel, même au-delà du plafond. La tâche passe `overdrawn`, toute nouvelle réservation est refusée, et `BUDGET_OVERRUN` entre au registre. Le dépassement n'est ni absorbé ni tronqué : il attend une décision administrative.

```sql
-- budget.reserve : ne retient le montant qu'une fois, une ligne si et seulement si la réservation existe
WITH held AS (
  UPDATE platform.budgets SET reserved = reserved + $3
   WHERE task = $1 AND NOT overdrawn AND reserved + spent + $3 <= cap
     AND NOT EXISTS (SELECT 1 FROM platform.budget_reservations WHERE id = $2)
   RETURNING 1)
INSERT INTO platform.budget_reservations (id, task, amount, state)
SELECT $2, $1, $3, 'reserved' FROM held ON CONFLICT (id) DO NOTHING;
SELECT state FROM platform.budget_reservations WHERE id = $2;
-- budget.settle : amount retiré de reserved, coût réel ajouté à spent, overdrawn si spent dépasse cap
UPDATE platform.budgets SET reserved = reserved - $2, spent = spent + $3, overdrawn = spent + $3 > cap WHERE task = $1;
```

La transition d'état est contrainte en migration (`data/migrations`), chaque changement écrit une ligne append-only, et l'ancien `CHECK (reserved + spent <= cap)` disparaît : il rendrait une facture réelle impossible à enregistrer. Le plafond est tenu à la réservation. T-20, Postgres réel, garde sa valeur pour l'atomicité : 300 réservations parallèles de 10 sur un plafond de 1 000 donnent exactement 100 acceptées ; après réconciliation à un coût réel de 7, 30 nouvelles passent. États, idempotence et reprise : [À PROUVER: T-45, Gherkin, brique 1b]. Facture supérieure : [À PROUVER: T-46, Gherkin, brique 1b]. Le broker réserve avant de transmettre et réconcilie à partir de `usage` ; `maxBudgetUsd` et `maxTurns` restent en second rempart. `total_cost_usd` est une estimation côté client, l'autorité étant l'API Usage and Cost ou la Console [V: https://code.claude.com/docs/en/agent-sdk/cost-tracking] : la facturation ne s'appuie jamais dessus.

### 4.6 Ce que `platformd` détenait, et où cela va

| Fonction | Devient | Preuve |
|---|---|---|
| Clé Anthropic | `broker`, seul détenteur ; `platformd` n'existe plus | E-05, T-23 |
| Relais des appels | La gateway : serveur MCP de chaque enfant, client MCP de chaque module, politique dans le même processus. Un relais unique, celui du point de politique | E-02, E-01 ; [À PROUVER: T-38, banc, 1b.0] |
| Lancement de srt | Port `SandboxRunner`, adaptateur srt dans `packages/sandbox`, appelé par la seule gateway (§4.8) | T-06 ; [À PROUVER: T-47, Gherkin, brique 1b] |
| Socket de contrôle | Supprimée | sans objet, plus rien à contrôler |
| `topology/processes.yaml` | `topology/modules.mcp.json`, format Claude Code | [V: mcp.md] ; lecture par la gateway [À PROUVER: T-29, Gherkin, brique 1b] |
| Quotas par tâche | Budgets §4.5 | T-20 |
| Concurrence globale | Même mécanisme que les budgets : `capacity.acquire` avec expiration, `capacity.release` | Mécanisme T-20 ; [À PROUVER: T-27, Gherkin, brique 1b] |
| Terminaison | `detached: true`, `kill(-pgid)`, contrôle `pgrep -g`, puis `SIGKILL` ; erreur nommée `WORKER_TIMEOUT` | T-06, résidu macOS T-06b |
| Redémarrage | Tableau ci-dessous | [À PROUVER: T-30, Gherkin, brique 1b] |
| Isolement des pannes | Un enfant par task : la mort de l'un ne touche pas les autres | E-06 |

| Processus | Politique de redémarrage explicite |
|---|---|
| Sandbox (task, executor) | **Jamais** : la task échoue avec un code nommé, le client décide. Toute réservation ouverte passe `unknown` |
| Module stdio, sous srt | Reconnexion par la gateway, 3 essais avec délai croissant, puis `SERVICE_UNAVAILABLE` (code existant dans `mcp-service-client.ts`) |
| Broker | Comme un module. Sa mort fait échouer les tasks en cours avec une erreur nommée, sans effet sur les modules sans modèle. Ses réservations ouvertes passent `unknown` à la reprise |
| Gateway, Postgres | Poste : aucun, le développeur relance. Serveur : `Restart=on-failure` dans l'unité (§5.1). La mort de la gateway ferme les tubes : modules et workers lisent EOF et s'arrêtent. C'est le coût du parent unique ; résidu macOS T-06b |

### 4.7 Où s'exécute chaque traitement (normatif)

Toute ligne absente de ce tableau n'a pas le droit de s'exécuter. Un écart est un bug de conception.

| Traitement | Lieu | v3 | Code exécuté ou contenu non fiable | Preuve |
|---|---|---|---|---|
| Code soumis à `execute` | **srt**, réseau nul | Conteneur | Exécute le code écrit par le modèle | E-02, I-2 |
| Boucle `query()` et handlers minces | **srt**, dans le worker | Conteneur | Sortie de modèle, arguments d'outil | [À PROUVER: T-41, banc, 1b.0] |
| Binaire Claude Code | **srt**, enfant du worker | Conteneur | Tools, dépôt, diff | E-04 ; T-41 |
| Tasks scout, builder, zetetic-reviewer | **srt**, un worker par task | Conteneur | Dépôt, code du builder, diff de PR | T-41 |
| Modules data et workflow, plugins compris : memory-recall, memory-write, memory-consolidate, code-index, verify, spec-lint, manifest-registry | **srt**, un processus par module | Conteneur | Dépôt (tree-sitter), mémoire, sorties de code, code de plugin | E-01 ; [À PROUVER: T-38, banc, 1b.0] |
| Agents de module : codebase-ask, spec-draft, remember jusqu'à la brique 4 | **srt**, worker par task | Conteneur | Comme les tasks | T-41 |
| Structurer, Judge, Embedder | **srt**, modules workflow ; Judge distant : allowlist du manifeste | Conteneur | Contenu à structurer ou reclasser | Brique 8 ; Embedder désactivé par défaut |
| web-scout (O-27) | **srt**, sans modèle | Conteneur | Web hostile, sortie en quarantaine | Brique 8 |
| db-migrator (O-28) | **srt**, sans modèle, Postgres jetable dans la sandbox | Conteneur | SQL de plugin | [À PROUVER: T-49, Gherkin, brique 4] |
| Copie jetable `./repo` | **srt**, profil `repo-prepare` | Conteneur | Dépôt cloné | T-38 |
| **gateway, exception** | **Natif** | Conteneur | Enveloppes MCP, résultats comptés et bornés, jamais interprétés (§4.8) | T-07 : `listen` refusé ; T-03f : `allowLocalBinding` ouvre tout le loopback ; §11.7 |
| **broker, exception** | **Natif** | Absent | Corps de requête et de réponse, retrait de la clé, lecture de `usage` | Même refus d'écoute T-07 ; détenteur de la clé, E-05, T-23 |
| **data, exception** | **Natif** | Absent | Paramètres typés, SQL fixe | Socket Unix Postgres : sous Linux `allowUnixSockets` est ignoré [V: README srt, « Unix Socket Settings »], et `allowAllUnixSockets` est interdit par schéma (§11.3). `pg` ne passe pas par le proxy. E-09 ne vaut que sur macOS |
| **Postgres 17, exception** | **Natif** | Conteneur | Requêtes de `data` | D-5, mêmes raisons que `data` |

### 4.8 Qui détient l'autorité de lancer une sandbox

`platformd` n'est pas remplacé par un autre démon. L'autorité tient dans **une fonction** du port `SandboxRunner`, adaptateur `packages/sandbox/src/infrastructure/srt-runner.ts`, appelée par la seule gateway, seule exception native qui lance. Les modules et les workers sont sous srt : ils ne peuvent lancer que des enfants dans leur propre sandbox.

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
2. **Par l'argv.** `command` et `args` viennent du profil statique, `cwd` = `~/.architect-os/tasks/<TaskId>/`, l'environnement est une liste fermée. Aucun shell, aucune interpolation.
3. **Par l'absence de lecture.** L'adaptateur renvoie des flux qu'il ne lit pas. Il ne contient ni parseur JSON ni import du SDK MCP. Il observe seulement le code de sortie et l'arbre de processus (`detached`, `kill(-pgid)`, contrôle `pgrep -g`, puis `SIGKILL`).
4. **Par la garde d'architecture.** `child_process` et `@anthropic-ai/sandbox-runtime` ne s'importent que dans cet adaptateur, le port ne s'importe que dans `gateway/src/infrastructure`, le scénario échoue sinon.

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

### 4.11 Repli srt

**Port.** Un seul port d'exécution, `SandboxRunner`, héritier de `ContainerRunner`, avec **srt comme unique adaptateur d'isolation**. Rien hors de l'adaptateur ne dépend de srt : le reste du code ne connaît qu'un nom de profil et deux flux MCP stdio, et seul l'adaptateur lit `sandboxes/profiles/*`. L'adaptateur en mémoire des tests n'isole rien et reste hors du chemin de production. **Aucun second adaptateur n'est codé.** Garde : règle dependency-cruiser avec fixture, qui échoue si `@anthropic-ai/sandbox-runtime` est importé hors de l'adaptateur [À PROUVER: T-52, Gherkin, brique 1b]. Seule fuite connue : l'autorisation de task du broker repose sur `mask` (§11.2), à reprendre par tout autre adaptateur.

**Déclenchement.** Le repli s'ouvre si l'un de ces faits est établi, et le propriétaire décide :

1. T-41 échoue pour une raison structurelle sur un OS ciblé.
2. Un test d'évasion réussit (fichiers, réseau, secrets, autre session), et srt ne peut pas le corriger.
3. Une montée de version de srt casse une propriété prouvée, ce que détecte le banc rejoué à chaque montée de version [À PROUVER: T-54, `npm run bench:sandbox`, brique 1b].

**Critères de pérennité.** Aucune alternative de niche. Un candidat doit passer les cinq : licence open source ; gouvernance par une fondation ou plusieurs organisations ; activité récente ; adoption réelle ; pas de dépendance à un seul éditeur. Mesure du **30 octobre 2026**, rejouée **au déclenchement** parce que ces informations vieillissent : `gh api repos/<dépôt>`, `/releases/latest`, et domaines des auteurs sur les 100 derniers commits de 90 jours au plus. Tout ce tableau est **à évaluer au déclenchement, sans décision**.

| Candidat | Licence | Gouvernance | Dernière version, auteurs | Part des commits | Adoption | Verdict |
|---|---|---|---|---|---|---|
| Podman [V: github.com/containers/podman, cncf.io/projects/podman] | Apache-2.0 | CNCF, niveau Sandbox, depuis le 21 janvier 2025 | v6.1.4, 12 oct. 2026 ; 29 | redhat.com 43, autres organisations et individus 57 | 33 152 étoiles ; indicateur faible, à compléter au déclenchement | **Retenu.** Linux : rootless, sans démon. macOS : `podman machine`, VM libkrun ou applehv |
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
| Échec propre à Linux | Podman rootless |
| Contenu hostile ou multi-utilisateur (O-22) | Kata Containers |
| Échec sur macOS | `podman machine` |
| srt abandonné ou divergent | Fork de srt, ou adaptateur fin ci-dessous |
| Le propriétaire ne veut plus gérer l'isolation | Sandbox hébergé par Anthropic : [sessions cloud](https://code.claude.com/docs/en/sandbox-environments#cloud-sessions) ou [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview). **Non open source**, dépendance à un seul éditeur assumée, hors critères. Managed Agents est en bêta et non éligible à la rétention zéro |

**Deux options open source, évaluées sans décision.**

| Option | Pour | Coût réel |
|---|---|---|
| **(a) Forker et maintenir srt** (Apache-2.0) | Mêmes profils, mêmes tests, aucun changement hors de l'adaptateur. Immédiat si Anthropic abandonne ou diverge | 23 160 lignes de JS publié, binaires seccomp x64 et arm64, proxy et terminaison TLS expérimentale. Au rythme observé de 14 versions en 90 jours, environ une version par semaine à trier, avec les changements de Seatbelt, bubblewrap et du noyau à suivre seuls |
| **(b) Adaptateur fin écrit par nous**, avec assistance IA, sur Seatbelt, bubblewrap, Landlock, seccomp | Surface réduite à notre besoin : aucun réseau, un port, une allowlist [déduit]. Primitives Linux pérennes | Code critique pour la sécurité, à bus factor faible. L'IA accélère l'écriture, pas la preuve : une évasion ne se voit pas à la relecture. `sandbox-exec` est marqué DEPRECATED (`man sandbox-exec`, macOS 27), donc la voie macOS est fragile. Filtre par domaine et autorisation du broker à réécrire. Taille non estimée à ce stade |

**Preuve indispensable, quel que soit le code.** Aucune option n'est adoptée sans la suite d'évasion du §11.4, T-41, T-42 et T-43 verts sur chaque OS ciblé, rejoués à chaque montée de version.

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
| Dockerfiles, `compose.yaml` | **Retirés** en 1b (D-1) | | §6 |

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
| `compose.yaml`, `Dockerfile`, `.dockerignore`, `services/memory/worker/Dockerfile`, `test/infra/compose.test.ts` | `topology/modules.mcp.json`, `sandboxes/profiles/*`, `features/infra/`, `features/sandbox/` | **supprimés** (1b) |
| `proxy/Caddyfile` | `deploy/edge/Caddyfile` | **déplacé** (1b) |
| `.env.example` | `topology/env.example`, sans mot de passe ni `BROKER_URL` | **réduit** (1b) |
| `docker-runner.ts` (`DockerContainerRunner`, préfixe `agentic-worker-`) | `packages/sandbox/src/infrastructure/srt-runner.ts`, adaptateur du port `SandboxRunner` | **remplacé** (1b) |
| `in-process-runner.ts` | adaptateur en mémoire, indispensable à la mutation (§13.6) | **gardé** |
| Port `ContainerRunner` | `SandboxRunner` | **renommé** |
| `worker/main.ts`, `run-worker.ts`, `internal-tools.ts`, `src/presentation/internal-http.ts`, `prompts/recall.md` | §4.3 : `worker/main.ts` et `run-worker.ts` réduits, `internal-tools.ts` devient client MCP, `internal-http.ts` supprimé. `prompts/remember.md` devient `agents/` (O-29) ; `prompts/recall.md` supprimé en brique 2 | **réduits, supprimés** (1b) |
| `worker/sdk-agent.ts` | options de `query()`, dans le worker sous srt | **réduit** |
| `gateway/` | + `profiles`, `tokens`, `policy`, `registry`, `codefront` (serveur MCP par sandbox), appel de `SandboxRunner`, lecture de `modules.mcp.json` | **étendu** |
| `data/src/presentation/http-api.ts`, `services/memory/src/infrastructure/data-client.ts` | Serveur MCP généré, client MCP | **remplacés** (1b) |
| `data/` | + `budget.*`, `capacity.*`, `owner` dans `operations.json` | **étendu** |
| `0002_memory.sql` (pgvector actif) | Migration `0004` (D-5) ; pgvector requis jusque-là par les 6 tests §13.9 | **nouveau** |
| `packages/contracts` | + schémas stricts des profils srt et du manifeste | **étendu** |
| `.dependency-cruiser.cjs` | `@anthropic-ai/sandbox-runtime` et `child_process` seulement dans l'adaptateur de `packages/sandbox` ; port importé seulement par `gateway/src/infrastructure` ; Agent SDK seulement dans `services/*/worker` et `modules/*/worker` | **modifié** |
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
│   └── sandbox/                           # port SandboxRunner, adaptateur srt, seul importeur de srt
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
  "filesystem": { "denyRead": ["~"], "allowRead": ["."], "allowWrite": ["."], "denyWrite": ["./repo"] }
}
```

Faits établis :

- **Clés inconnues tolérées** : `strictAllowlistt` passe sans erreur, donc un schéma zod strict du dépôt, en scénario Gherkin, est obligatoire. Fichier absent ou type invalide : srt refuse de démarrer [T-01].
- `denyRead: ["~"]` masque le home, Node démarre, `allowRead` rouvre `.` et `~/inst`, un `denyRead` plus spécifique reste refusé, un chemin relatif `../x` est accepté [T-02].
- Tâche = répertoire jetable sous `~/.architect-os/tasks/<id>/`, `cwd` de la sandbox. Le home étant refusé, l'état de la plateforme et les autres tasks le sont aussi. `./repo` est une copie jetable, faite elle-même sous srt (profil `repo-prepare`) depuis une source déclarée par le profil client, donc aucun chemin variable, aucun gabarit.
- L'adaptateur ajoute au profil validé la seule valeur dynamique, le port du broker, et écrit le résultat **hors** de `allowWrite`. Il passe toujours `--settings` : sans lui, le runtime démarre sur ses réglages par défaut [V: https://code.claude.com/docs/en/sandbox-environments#what-the-runtime-blocks-on-its-own].
- srt doit être installé hors de tout chemin inscriptible : une copie dans un `node_modules` inscriptible serait réécrite puis exécutée sans sandbox [V: README srt, « Where This Package Is Installed »]. Scénario d'évasion dédié.
- Écritures refusées même dans `.` : `.git/hooks`, `.mcp.json`, `.claude/agents` [T-02e].

Sous Linux : `allowWrite` et `denyWrite` n'acceptent que des chemins littéraux, et un `denyRead` ne masque que ce qui existe à l'emballage [V: README, « Path Syntax (Linux) »]. D'où [À PROUVER: T-02L, `gate-linux`, brique 1b].

| Profil | Réseau | Lecture | Écriture | Modèle |
|---|---|---|---|---|
| executor | aucun | `.`, dist de l'executor | `.` (session) | aucun |
| module-`<nom>` (data, workflow, plugin) | gateway `127.0.0.1:8080` par le proxy srt | `.`, dist du module, ressources du manifeste | `.` | aucun, sauf Structurer et Judge selon manifeste |
| scout | broker de la task | `.`, `./repo` | `.` sauf `./repo` | sonnet |
| builder | broker de la task | `.` | copie jetable `.`, sans `node_modules` inscriptible | sonnet |
| zetetic-reviewer | broker de la task | `.`, `./repo`, diff | `.` sauf `./repo` | opus |
| agent-worker | broker de la task | `.` | `.` | selon manifeste |
| repo-prepare | aucun | source déclarée par le profil client | `.` | aucun |
| web-scout (O-27) | allowlist du manifeste + `deniedResolvedAddresses` sur plages privées | `.` | `.`, sortie en quarantaine par tool MCP | aucun |
| db-migrator (O-28) | aucun ; Postgres jetable dans la sandbox | `.`, migrations du plugin | `.` | aucun |
| gate-tests (CI) | aucun vers l'extérieur ; Postgres de test et serveur interne de Stryker dans la sandbox (C-17) | merge, `node_modules` | merge, `reports/` | aucun |

Dépendances hôte Linux : `bubblewrap`, `socat`, `ripgrep`. Ubuntu 24.04 : `kernel.apparmor_restrict_unprivileged_userns=0` ou profil AppArmor dédié [V: README] ; `claude-code-action` pose ce sysctl lui-même [V: `action.yml`]. Appelant non root recommandé [V: README, « Running as root »].

## 10. Manifeste de module

```yaml
name: memory-recall
version: 1.2.0
domain: memory
owner: cortex
transport: stdio             # toujours ; http refusé par schéma tant que T-39 n'a pas tourné
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
    egress: [gateway]
writes_tables: []
reads_domains: [memory]
calls_allowed: [judge]
egress: none                 # rien au-delà de la gateway, appliqué par le profil
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
    egress: [broker]
    model_min: sonnet
    budget_tokens: 40000
    timeout_ms: 120000
    limits: { memory_mb: 1024, pids: 128 }   # Linux, hors srt ; macOS : résidu §11.1
writes_tables: []
reads_domains: [code, memory]
calls_allowed: [code-index, memory-recall]
```

`annotations` : `readOnlyHint` autorise le parallélisme, `idempotentHint` une relance HTTP [V: mcp#mark-tools-that-are-safe-to-call-twice]. `response_format` et pagination suivent « Writing effective tools » (§16). Règles, chacune un scénario Gherkin : tout tool a une sandbox, aucun manifeste ne peut déclarer un processus natif ; tool `data`/`workflow` ⇒ un profil de module sans broker, permanent, ou un profil à la demande sans modèle (web-scout, db-migrator) ; tool `agent` ⇒ un worker par task ; `writes_tables` disjoints ; `calls_allowed` acyclique ; `egress` du manifeste égal au réseau du profil ; `egress` ≠ `none` ⇒ quarantaine ; un tool `agent` déclaré `stable: true` est refusé (D-4). Le changement de `kind` de `memory-recall` de `data` à `workflow` relève de D-4 et C-5.

## 11. Sécurité : modèle de confiance, STRIDE, invariants

### 11.1 Modèle de confiance, écrit

**srt n'est pas tenu pour équivalent à une VM ni à un conteneur renforcé.** La doc Anthropic classe sandbox-runtime « bon » à surcoût très faible, gVisor « excellent » et conseillé pour le multi-tenant et le contenu non fiable, VM « excellent » ; le noyau reste partagé [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment#isolation-technologies]. srt se présente lui-même comme « Beta Research Preview » [V: README].

**Portée autorisée : usage local ou utilisateurs fiables d'abord. Le déploiement multi-utilisateur est bloqué** tant que la suite d'évasion, d'accès aux secrets et d'isolation intersessions (§11.4) ne passe pas sur Linux **et** macOS. Lever ce blocage ne suffit pas à rendre srt adapté à du contenu hostile multi-tenant : ce serait une décision du propriétaire, avec une VM à évaluer selon le §4.11 (O-22). Anthropic conseille une VM dédiée pour un dépôt non fiable [V: https://code.claude.com/docs/en/sandbox-environments#choose-an-approach].

Résidus assumés sous ce modèle :

| Résidu | Fait | Fermeture |
|---|---|---|
| macOS : un enfant `setsid` survit à la mise à mort du groupe, garde son profil Seatbelt et devient orphelin (PPID 1) | T-06b | Linux : espace PID de bubblewrap, [À PROUVER: T-06L, `gate-linux`, brique 1b]. macOS : aucune, poste de développement seulement |
| macOS : aucune limite mémoire ou PID par sandbox. `ulimit -u` compte par utilisateur, donc inapplicable par task, et le shell est lui-même refusé à 200 | T-09 | Linux : `systemd-run`, [À PROUVER: T-09L, `gate-linux`, brique 1b]. macOS : timeout, budgets |
| Poste : gateway, broker et data partagent un uid ; modules et workers sont sous srt | T-24 sous Linux ; `ps eww` sur macOS 27 ne montre pas l'environnement mais ne vaut pas frontière | Serveur : utilisateurs dédiés, T-26 |
| Exfiltration par un domaine autorisé | [V: README, « Security Limitations »] | Sandbox de modèle : seul le broker, `POST /v1/messages` ; le contenu reste un canal vers l'API |
| Amont qui refléterait l'en-tête `x-api-key` | E-05c | Le broker retire la clé des réponses, §11.2 ; [À PROUVER: T-23b, Gherkin, brique 1b] |
| Gateway compromise : compromission totale, elle signe les jetons et lance les sandboxes | §4.8 | Code court, enveloppes seules, enfant hostile T-40. Aucune fermeture sous ce modèle : usage local ou utilisateurs fiables |
| Autorisation de task lisible par un processus natif du même uid, dans l'environnement du processus srt (mécanisme T-24) | Sous Linux, poste | Valable pour une task, plafonnée par sa réservation, révoquée à la fin. Serveur : utilisateurs dédiés |
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
- `POST /v1/messages*` seulement ; `/v1/models` et `GET` : 403 ; amont direct et internet : refusés [T-23].
- L'Agent SDK fonctionne intégralement par ce chemin, outils et sortie structurée compris [E-05].
- Réflexion : le broker retire la clé des réponses et l'en-tête `content-length`. Le banc a montré que sans ce retrait un amont réfléchissant renvoie la clé (`FUITE`), et qu'un retrait qui garde `content-length` coupe la connexion (`UND_ERR_SOCKET`, pas de fuite) [E-05c]. Implémentation correcte [À PROUVER: T-23b, Gherkin, brique 1b]. Comportement réel de `api.anthropic.com` sur requêtes invalides [À PROUVER: T-04R, banc avec clé, brique 1b].

Le broker lui-même reste à relire contre `https://code.claude.com/docs/en/agent-sdk/secure-deployment` à l'implémentation : `ANTHROPIC_BASE_URL` passe le trafic de modèle en clair jusqu'au proxy local, ce qui est le cas prévu [V: même page].

**Identité d'une requête : étude.**

| Option | Verdict | Raison |
|---|---|---|
| Port seul | **Refusé** | Un processus natif étranger joint le listener et consomme la clé sans la lire |
| Socket Unix avec identifiants du pair | **Écarté** | Sous Linux, `allowUnixSockets` est ignoré et seccomp bloque `socket(AF_UNIX)` [V: README srt, « Unix Socket Settings », « Unix Socket Restrictions (Linux) »] ; `allowAllUnixSockets` est interdit par schéma. Le trafic passe par le proxy srt, donc le pair serait ce proxy, pas la task. Sur un poste, l'uid ne distingue rien. `node:net` n'expose aucun identifiant de pair (`Socket.prototype`, Node 26.11.1) : il faudrait un addon natif |
| Jeton dans l'environnement ou un en-tête de l'enfant | **Refusé** | Lisible par le modèle via Bash ou le processus |
| Association port source et processus (`/proc/net/tcp`, `lsof`) | **Écarté** | Course entre connexion et lecture, propre à chaque OS, inutile entre processus de même uid |
| **Autorisation déposée hors sandbox par srt** | **Retenue** | L'enfant ne voit qu'une sentinelle, le proxy srt côté hôte pose la valeur à la sortie |

**Mécanisme retenu.** Le broker émet, pour chaque task, une autorisation aléatoire de 256 bits. La gateway la passe dans l'environnement du seul processus `srt`, avec `credentials.envVars: [{ name: "ANTHROPIC_API_KEY", mode: "mask", injectHosts: ["broker.localhost"] }]` et `network.tlsTerminate`. Le binaire envoie la sentinelle, le proxy la remplace, le broker compare en temps constant, puis remplace la valeur par la vraie clé. T-04 montre que cette substitution fonctionne et qu'elle s'applique aussi au corps. D'où trois règles au broker : une requête qui contient l'autorisation ailleurs que dans `x-api-key` est refusée (`LEASE_OUT_OF_PLACE`), l'autorisation est retirée de toute réponse, et le listener ferme avec la task. Si le modèle apprenait quand même cette valeur, il ne gagnerait rien : il n'a réseau que vers ce broker, avec ce budget. `tlsTerminate` est marqué expérimental [V: README srt] et sa dépendance est écrite au §4.11. Mécanisme : [À PROUVER: T-42, banc, 1b.0]. **Test du natif étranger** : un processus hors sandbox, port connu, sans autorisation, avec une sentinelle, puis avec l'autorisation d'une autre task, reçoit `401` à chaque fois et rien n'est réservé [À PROUVER: T-43, banc, 1b.0]. Si T-42 échoue sur un OS ciblé, ce P0 reste ouvert et le point est soumis au propriétaire.

### 11.3 STRIDE, mis à jour pour chaque changement de topologie

| Menace | Vecteur | Contrôle | Statut |
|---|---|---|---|
| **S** | Un processus local appelle un module | Local : pas de port, stdio avec un seul parent. Jeton d'appel `aud` vérifié par le module | T-21 ; T-25 en brique 2 |
| S | Une sandbox présente l'identité d'une autre | Identité = fermeture du handler ; au broker, autorisation de task posée hors sandbox | E-02, E-03, T-03 ; T-42 |
| S | Un processus natif étranger joint un listener du broker | Autorisation de task comparée à chaque requête, `401` sinon | T-42, T-43 en 1b.0 |
| S | Rejeu d'un jeton entre deux tâches | `task`, `jti`, `exp`, `aud` signés | T-21 |
| S | Le module usurpe la gateway | Clé publique seule côté module | T-21 |
| **T** | Le builder modifie hooks git, `.mcp.json`, `.claude/agents` | Refus obligatoires srt + copie jetable | T-02e ; Linux T-02L |
| T | Une sandbox réécrit son profil ou le binaire srt | Profil rendu hors `allowWrite` ; srt hors chemins inscriptibles | [À PROUVER: T-34, évasion, brique 1b] |
| T | Du contenu non fiable influence un lancement, ou un module lance sans srt | Signature fermée, argv statique, adaptateur sans lecture ; `child_process` et srt interdits hors adaptateur | T-47, T-52 en brique 1b |
| T | Une PR modifie la porte, un filtre ou une assertion | `pull_request_target`, code de la base ; mutation étendue | §13.8, T-22 ; sentinelles en 1a |
| T | Une PR hostile remplace les steps et produit un rapport vert sans assertion | **Non couvert par la porte**, écrit : diff visible, revue, O-23 | **T-44 : la PR passe**, I-8 |
| T | Le code de test de la PR altère la porte sur le runner | Tests sous srt `gate-tests`, la porte est le processus parent | §13.8 ; T-35 en 1a |
| **R** | Une exécution nie un appel | Registre append-only (`0003_runs_immutable.sql`) ; chaque appel journalisé avec `task` et `jti` | Brique 2 |
| R | Un verdict ou un coût ne peut être attribué | Verdict validé ou gradé, tokens par couche et par modèle au registre (§4.9) | Brique 2, §15.1 |
| R | Le coût d'une requête interrompue est contesté | Réservation `unknown` persistée, transitions append-only, réconciliation avec source et auteur | T-45 en brique 1b |
| **I** | Lecture de `~/.ssh`, de `.env`, de l'état | `denyRead: ["~"]` ; état sous `~` | T-02 ; T-02L |
| I | Fuite de la clé Anthropic | Broker, aucune clé en sandbox | T-04, T-23 ; T-04R |
| I | Clé lue par un autre processus natif | Plus aucun module natif ; restent gateway et data. Serveur : utilisateurs dédiés. Poste : résidu assumé | T-24, T-26 |
| I | Module compromis : lecture de `~`, de la clé, de Postgres, ou sortie réseau | Sous srt : `denyRead`, socket refusée, réseau limité à la gateway | T-38, I-10 |
| I | Accès Postgres depuis une sandbox, module compris | Socket refusée, aucun TCP | E-09 ; T-38 |
| I | Exfiltration par l'API de modèle | Inhérente ; budget, journal par task | Accepté, §11.1 |
| **D** | Bombe fork, mémoire, disque, sandbox sans fin, module compris | Budgets, `capacity`, timeout, terminaison vérifiée ; `limits` par profil, `systemd-run` sur Linux | T-20, T-06 ; T-27, T-09L |
| D | Enfant hostile qui inonde son tube ou meurt, executor, worker ou module | `maxBufferSize` ; `stdin.on('error')` dans l'adaptateur ; gateway vivante | E-03 ; T-40 pour worker et module |
| D | Réservation rejouée, perdue, ou libérée à tort ; facture supérieure | Identifiant idempotent, `unknown` jamais libéré, `overdrawn` | T-45, T-46 en brique 1b |
| D | Mort d'un worker | Enfants indépendants | E-06 |
| D | Mort d'un module ou du broker | Reconnexion bornée, erreur nommée | T-30 |
| **E** | Évasion Linux par user namespace imbriqué | Filtre seccomp srt ; `allowNestedUserNamespaces`, `enableWeakerNestedSandbox`, `allowAllUnixSockets` interdits par schéma | [V: README] ; suite §11.4 |
| E | Descripteur hérité ouvrant un service de l'hôte | Seuls fd 0-2 passent et ce sont des tubes | T-07 ; Linux T-07L |
| E | Exécution du code d'une PR en `pull_request_target` | Aucun secret, `contents: read`, aucun cache, aucun artefact consommé par un job privilégié | §13.8 |
| E | Argument bien typé, sémantique hostile : autre task, `../`, volume | Capacités et ressources vérifiées au point d'effet ; validateur `citations` sous srt | §4.10 ; T-51 |
| E | Contenu hostile qui vise les parseurs de la gateway | Enveloppes seules, aucun `eval`, aucun fichier construit depuis un argument | §4.8 ; T-40 |
| E | Sysctl AppArmor qui affaiblit l'hôte | Runners jetables : sysctl. Serveur : profil dédié à `bwrap` (O-17) | |
| E | srt en préversion | Épinglage exact, notes de version lues avant montée | §12 |

Changements de topologie couverts : suppression de `platformd` (retire la clé et la socket de contrôle du point de concentration, concentre l'autorité de lancement dans une fonction de la gateway, §4.8) ; broker (détenteur unique, autorisation de task) ; modules et worker entier sous srt (retire le traitement natif du contenu non fiable ; il reste les enveloppes à la gateway et les corps au broker) ; modules en stdio (retire l'exposition TCP locale, la gateway devient parente) ; `data` en MCP (même surface, protocole officiel). Le serveur ne change pas cette topologie : un module distant reste refusé tant que T-39 n'a pas tourné.

### 11.4 Suite d'évasion, secrets et intersessions (DAST, bloquante pour le multi-utilisateur)

`features/sandbox/escape.feature`, `secrets.feature`, `intersession.feature`, `broker-foreign.feature`, Linux et macOS, contre de vrais processus `srt` et chaque profil, module compris : lire un faux `~/.ssh/id_test` ; écrire hors `.` ; écrire `.git/hooks/pre-commit`, `.mcp.json` ; joindre `example.com`, `127.0.0.1:<module>`, `169.254.169.254`, le socket Postgres ; hériter d'un descripteur ; `unshare -r` ; réécrire son profil ou srt ; lire le répertoire d'une autre task ; joindre le broker d'une autre task ; joindre le broker depuis un natif étranger sans autorisation (T-43) ; rejouer un jeton ; récupérer la clé par environnement, erreurs, redirection, requête modifiée. Suite rejouée à chaque montée de version de srt (T-54).

### 11.5 Tableau d'invariants

| # | Invariant | Preuve automatisée | Fait, macOS | Linux | Brique |
|---|---|---|---|---|---|
| I-1 | Isolation filesystem entre tâches | `intersession.feature` : task A lit et écrit le répertoire de B, refus | T-02c, T-02g, T-02h pour le mécanisme ; scénario exact T-28 | T-28 | 1b |
| I-2 | Aucune connexion sortante de l'executor | `escape.feature` : direct, proxy, socket Unix, loopback | T-03a et b, U | T-03L | 1b |
| I-3 | Clé non récupérable | `secrets.feature` : env, erreurs, redirection, requête modifiée, broker d'une autre task | T-04 (échec de `mask`), T-23 (broker) | T-23L ; réel T-04R | 1b |
| I-4 | Appel hors `calls_allowed` refusé | `policy.feature` : module A appelle C sans droit, refus et journal | T-21 pour le jeton ; DAG T-25 | T-25 | 1b, 2 |
| I-5 | Budgets respectés en parallèle | `budget.feature` : 300 réservations concurrentes, plafond exact | T-20 | T-20 (SQL, indépendant de l'OS, rejoué) | 1b |
| I-6 | Timeout qui tue tous les descendants | `termination.feature` : arbre de 3 processus, plus aucun | T-06 ; **résidu `setsid` T-06b** | T-06L | 1b |
| I-7 | Mort d'un worker sans effet sur les autres sessions | `isolation.feature` : deux tasks, `SIGKILL` sur l'une | E-06 | E-06L | 1b |
| I-8 | **Une PR ordinaire ne supprime ni n'affaiblit la porte par accident ou négligence, et certaines manipulations sont refusées : filtre, skip, scénario retiré, assertion retirée, code de porte modifié. La porte ne protège pas contre un contributeur hostile** | PR sentinelles rouges et une saine verte, §15 ; **T-44 : une PR hostile passe, verte** | T-22, T-44 | `gate-linux` | 1a |
| I-9 | Le client ne voit ni résultat intermédiaire ni tool de module | `code-front.feature` : script qui lit un canari, canari absent de la réponse, `tools/list` client = méta-tools | T-48 | T-48 | 3 |
| I-10 | Un module, plugin compris, n'atteint ni `~`, ni la clé, ni Postgres, ni le réseau hors gateway | `escape.feature`, profil de module | E-01 pour le mécanisme ; T-38 | T-38 | 1b.0 |
| I-11 | Un natif étranger ne consomme pas le broker | `broker-foreign.feature` | T-43 | T-43 | 1b.0 |
| I-12 | Seule la gateway lance une sandbox, sans contenu dans l'argv | `spawn-authority.feature`, garde dependency-cruiser | T-47, T-52 | T-47 | 1b |

### 11.6 La gateway incontournable vient de l'exécution

| Propriété | Mécanisme | Test |
|---|---|---|
| Aucun agent ne contacte un module natif | Pas de port en local ; réseau de sandbox réduit au broker | T-03a, I-2 |
| Aucun descripteur hérité n'ouvre un service de l'hôte | Seuls fd 0-2 passent, et ce sont des tubes | T-07, `escape.feature` |
| Aucun appel interne ne contourne le DAG | Chaque module a la gateway pour seul parent et seule destination réseau ; aucun jeton `aud` valable pour un autre | T-21, T-25, T-38 |
| Pas d'accès direct à Postgres | Socket refusée à toute sandbox, module compris ; `pg` seulement dans `data` (dependency-cruiser) | E-09, T-38 |

### 11.7 La gateway elle-même sous srt ?

Non. Sous Linux l'enfant n'a pas l'espace réseau de l'hôte [V: README]. Sur macOS, un socket hérité sur fd 3 n'atteint pas l'enfant (`ENOTTY`, srt ne passe que 0-2 [V: `dist/cli.js`, `sandboxedStdio`]) et `listen` sur fd 0 est refusé (`EPERM`) [T-07]. `allowLocalBinding` ouvre tout le loopback sans proxy [T-03f]. Gateway native, donc. Le mode permission de Node (`--permission`) refuse `child_process`, les écritures et les sockets Unix [T-37], mais la doc Node ne le présente pas comme une frontière contre du code malveillant : c'est un garde-fou sans ops, à poser sur la gateway sur serveur, pas une isolation. La gateway lance les sandboxes (§4.8), il faudra donc l'autoriser explicitement. Lecture de cette doc, compatibilité et mise en place [À PROUVER: T-37b, Gherkin, brique 1b].

## 12. Supply chain

- **Épinglage exact** : `@anthropic-ai/sandbox-runtime` `0.0.81` ; **`@cucumber/cucumber` `12.9.0`**, qui tire `@cucumber/gherkin` `38.0.0` et `@cucumber/messages` `32.3.1` [T-14, T-12] ; `@stryker-mutator/core` et `cucumber-runner` `10.1.1` ; `tsx` `4.23.15` ; `@anthropic-ai/claude-agent-sdk` `0.3.312` ; `@modelcontextprotocol/sdk` `1.32.2` ; `@anthropic-ai/claude-code` `2.1.312` pour `claude plugin validate` ; `.nvmrc` exact.
- **Montée de `@cucumber/cucumber` vers 13** : bloquée tant que le runner Stryker ne la prend pas en charge. Sous 13.0.0 et 13.3.0, le runner échoue (« Failed to import formatter file ») et **son propre fichier `stryker-formatter.cjs` est tronqué à 0 octet** dans `node_modules`, ce qui fait échouer les runs suivants pour une autre raison [T-14]. Le `peerDependency` `>=8.0.0` ne protège pas : le runner se développe contre 12.9.0. À signaler en amont.
- srt importe `zod/v3`, compatible avec `zod` 4.6.7 [V: README].
- **Lockfile** : `npm ci` refuse un lockfile désynchronisé, `EUSAGE` [T-15].
- **Scripts d'installation** : npm 11.20 signale `esbuild` (dépendance de `tsx`) sans l'exécuter tant que `npm install-scripts approve` n'a pas tourné ; à trancher en 1a.
- **SBOM** : `npm sbom --sbom-format cyclonedx --package-lock-only --workspaces` ; plus `dpkg-query -W bubblewrap socat ripgrep postgresql-17`, npm ne les couvrant pas.
- **Système** : voir §5.1 et T-16.
- **Portée de « aucun hash »** : O-3.

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

**Ce que le code de la PR peut faire, prouvé par T-44** : remplacer les step definitions par du code qui n'affirme rien et qui fait échouer tout mutant actif. cucumber-js sort 0, chaque pickle est `PASSED`, tous les mutants sont `Killed`, le rapport est authentique et la porte est **verte** sur un code bogué. Aucune forgerie de fichier n'est nécessaire. **La porte protège donc contre les suppressions accidentelles et certaines manipulations, pas contre un contributeur hostile.** La manipulation reste visible dans le diff, sans être impossible. Le modèle de confiance (§11.1) couvre ce cas : contributeurs fiables d'abord, et `CODEOWNERS` sur `features/steps/` possible (O-23). Pas de refonte de la CI : `pull_request` avec séparation en deux jobs n'apporterait rien, le workflow viendrait de la PR.

Dépôt : public, 0 ruleset à ce jour [T-19]. Les workflows Claude restent sur le runner auto-hébergé, non requis.

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

## 15. Briques

Les portes de sortie sont des scénarios Gherkin prouvant un **mécanisme** ; les métriques v3 sont relevées, non bloquantes (D-7, §15.1).

**Ordre d'exécution : 1a.1 (épinglage) → 1b.0 (banc Linux et macOS) → 1a.2 à 1a.7 (migration complète) → 1b.1 et suite.** Le banc passe avant la migration complète pour qu'une conception à revoir ne coûte pas la migration. Les critères de sortie des briques ne changent pas.

### Brique 1a : Gherkin + porte

| Étape | Contenu | Fichiers |
|---|---|---|
| 1a.1 | Épingler la chaîne : cucumber 12.9.0, gherkin 38.0.0, messages 32.3.1, Stryker 10.1.1, `tsx`, srt 0.0.81 ; `.nvmrc` exact ; scénario `name.feature` et `platform.json` | `package.json`, lockfile |
| 1a.2 | Migrer les 119 cas ; retirer `skipIf` ; Postgres local + CI | `features/`, `<composant>/features/`, `decisions/migration-gherkin.md` |
| 1a.3 | `tools/test-gate` : compteur de pickles, lecture NDJSON (§13.3), rapport Stryker, périmètre de mutation (§13.6), marquage | `tools/test-gate/` |
| 1a.4 | `gate.yml` en `pull_request_target`, tests sous srt `gate-tests`, PGDG | `.github/workflows/gate.yml`, `sandboxes/profiles/gate-tests.srt.json` |
| 1a.5 | Purger la dette de mutation : 474 mutants tués ou marqués | scénarios, commentaires |
| 1a.6 | Amender `CLAUDE.md` (O-2, C-2, C-12) ; retirer vitest et `vitest.config.ts`, `scripts/gate.sh` du `.gitignore` | `CLAUDE.md`, `.gitignore` |
| 1a.7 | Activer la porte, `N_base` initial ; `npm run gate` en une commande | |

**Porte de sortie** : 0 `*.test.ts` ; vitest retiré ; `exécutés_verts = attendu = statique` sur `main` ; les 119 cas présents dans la table ; 0 mutant non tué hors équivalents marqués sur tout le dépôt.
**Test externe (I-8)** : PR sentinelles, **rouges** : step non défini ; step `pending` ; filtre `tags` ajouté ; `.feature` exclu par la config ; scénario sans step ; mutant survivant sur ligne modifiée ; assertion retirée d'un step (T-22) ; `Stryker disable all` ; `gate.yml` ou code de porte modifié sans effet (T-35) ; écriture dans `gate/` depuis un step (T-35). Et une PR saine **verte**. La PR hostile de T-44 reste **verte** : elle documente la limite et ne compte pas comme un échec de la brique.
**Piliers** : R : T-12, T-13, T-14c, T-14d, T-17, T-32 consignés / S : SAST = porte, O-1 appliquée / O : `contents: read`, sans secret, tests sous srt.

### Brique 1b : srt, broker, topologie

| Étape | Contenu | Fichiers |
|---|---|---|
| 1b.0 | **Banc Linux et macOS d'abord, avant la migration complète 1a** : un job dédié, non requis, lance `features/sandbox/` sur `ubuntu-24.04` avec sysctl et sur macOS. T-38 module sous srt, T-39 pont http, T-41 worker entier, T-42 autorisation de task, T-43 natif étranger, et T-02L, T-03L, T-06L, T-07L, E-01L, E-02L, E-04L, E-05L, E-06L, T-23L. **Si T-41 échoue : blocage soumis au propriétaire, avec les critères du §4.11. Aucun repli binaire seul n'est prévu.** Si une autre échoue, la conception est revue avant 1b.1 | `features/sandbox/` |
| 1b.1 | `packages/sandbox` : port `SandboxRunner`, adaptateur srt, signature fermée, profil validé par schéma strict, `detached` + `kill(-pgid)` + contrôle, `stdin.on('error')`, `maxBufferSize` ; partie pure en processus ; T-40, T-47, T-52 | `packages/sandbox/`, `sandboxes/profiles/`, `.dependency-cruiser.cjs` |
| 1b.2 | `modules/broker` : listener et autorisation par task, `POST /v1/messages*`, retrait de la clé en réponse, réservation et réconciliation, relevé `usage` ; T-23b | `modules/broker/` |
| 1b.3 | `data` en MCP généré depuis `DATA_OPS` ; `budget.*` à états, `capacity.*` ; vérifications au point d'effet ; T-33, T-20, T-27, T-45, T-46, T-51 | `data/`, `data/sql/`, migration `0005` |
| 1b.4 | Gateway : lit `topology/modules.mcp.json`, lance chaque module sous srt, serveur MCP par sandbox, reconnexion bornée, émet les jetons ; modules vérifient ; T-29, T-30 | `gateway/`, `topology/`, `packages/contracts` |
| 1b.5 | Memory : module sous srt ; worker entier sous srt, `query()` + handlers minces ; `agents/*.md` chargés par `agents` ; suppression de `internal-http.ts`, `docker-runner.ts` ; réduction de `worker/main.ts`, `run-worker.ts`, `internal-tools.ts` | `services/memory/`, `agents/` |
| 1b.6 | Suppression de `compose.yaml`, `Dockerfile`, `.dockerignore`, image worker ; `proxy/` → `deploy/edge/` ; docs à jour ; Postgres natif documenté | racine, `docs/` |
| 1b.7 | Suite d'évasion et invariants I-1 à I-7, I-10 à I-12 ; banc rejoué à chaque montée de srt, T-54 | `features/sandbox/` |

**Porte de sortie** : Linux et macOS verts sur : `recall` e2e à travers un vrai `srt` avec faux amont local ; §11.4 ; I-1 à I-7, I-10 à I-12 ; schéma strict qui refuse `strictAllowlistt`, `allowAllUnixSockets`, `enableWeakerNestedSandbox`, un module natif hors `broker` et `data`, un module `type: http`.
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
| D | Déploiement serveur | `deploy/`, utilisateurs dédiés, TLS, `systemd-run` ; modules en stdio sur le même hôte, distants seulement si T-39 passe | T-26, T-31, T-09L ; **multi-utilisateur seulement après §11.4** | Machine d'essai | R : T-26, T-31 / S : STRIDE relu / O : RBAC, Zero Trust |

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
| [Agent SDK, coûts](https://code.claude.com/docs/en/agent-sdk/cost-tracking) | `total_cost_usd` estimation | §4.5 | **Corrigé** |
| [Sandboxing](https://code.claude.com/docs/en/sandboxing) | Sandbox intégré : Bash seulement ; processus entier : srt, conteneur, VM | Processus entier sous srt | Conforme |
| [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments) | Runtime pour le processus entier, MCP et hooks compris ; VM dédiée pour un dépôt non fiable ; session cloud hébergée ; passer les réglages explicitement | Modules et workers sous srt, `--settings` obligatoire, O-22, §4.11 | Conforme. Sur Linux, les refus se calculent au lancement et ne couvrent pas ce que la session crée ensuite : à inclure dans T-02L |
| [GitHub Actions](https://code.claude.com/docs/en/github-actions) | `claude_args`, plugins, OIDC, droits d'écriture requis | §8, §13 | Conforme. `pull_request_target` et injection de prompt : aucune mention dans cette page, renvoi à `docs/security.md` de l'action, à lire en 1a |

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

**Décisions qui exigent vraiment le propriétaire** :

| # | Question | Recommandation |
|---|---|---|
| O-27 | web-scout | **Recommandation à confirmer par le propriétaire** : `kind: workflow` sous srt, sans modèle (v3 : conteneur avec agent). Change le profil et la règle de manifeste du §10 |
| O-28 | db-migrator | **Recommandation à confirmer par le propriétaire** : `kind: workflow` sous srt, sans modèle, base jetable dans la sandbox, brique 4 (v3 : « agent de migration »). `agent` seulement si la génération de migrations est voulue |
| O-29 | remember / memory-write | **Recommandation à confirmer par le propriétaire** : `kind: agent` jusqu'à la brique 4, puis `workflow` avec Structurer, comme en v3 |
| O-30 | Si T-41 échoue sur un OS ciblé | Blocage soumis au propriétaire, §4.11. Aucune option de repli n'est présélectionnée |
| O-21 | Fusionner `describe` dans `search(detail: name\|summary\|schema)`, comme le propose l'article | **Proposition, non décidée.** Trois méta-tools d'ici là. Mesurée en brique 3, une variable à la fois, avec résultat borné par `max_result_tokens`. Pas nécessaire au modèle Code Execution |
| O-22 | Multi-utilisateur : srt seul, ou VM | **Bloqué aujourd'hui.** Après §11.4 : srt pour utilisateurs fiables ; pour contenu hostile, Kata Containers à évaluer selon le §4.11. gVisor, conseillé par Anthropic, échoue au seul critère de pérennité « un seul éditeur » à ce jour ; le test est rejoué au déclenchement |
| O-23 | `CODEOWNERS` sur `features/steps/` et `gate.yml` contre une PR hostile (T-44) | **Oui**, résidu §13.8 ; réduit le risque par la revue, sans fermer le contournement |
| O-24 | Lancer T-04R avec une vraie clé | **Oui en 1b**, sur un compte d'essai, requêtes invalides seulement |
| O-25 | Autoriser le sysctl AppArmor dans la VM Docker locale pour rejouer le banc Linux sur ce poste | **Non nécessaire** : `gate-linux` le prouve en 1b.0 |
| O-26 | Dette de mutation de 474 mutants traitée dans 1a | **Oui**, condition de l'extension |

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
| T-02 | `denyRead`, `allowRead`, chemins protégés | **Fait macOS** | T-02L, `gate-linux`, 1b.0 |
| T-03 | Loopback hôte | **Fait macOS** | T-03L, `gate-linux`, 1b.0 |
| T-04 | Masquage adversarial | **Fait macOS : échec, `mask` écarté** | T-04R avec clé, 1b |
| T-05 | 1 000 allers-retours | **Remplacé** par E-01, E-02 | E-01L, E-02L, 1b.0 |
| T-06 | Mort de l'arbre | **Fait macOS, résidu `setsid`** | T-06L, 1b.0 |
| T-07 | Descripteur hérité | **Fait macOS : refusé** | T-07L, 1b.0 |
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
| T-20 | Budgets parallèles | **Fait** | |
| T-21 | Jeton d'appel | **Fait** | T-25, 2 |
| T-22 | Assertion retirée | **Fait** | Sentinelle, 1a |
| T-23 | Broker adversarial | **Fait macOS** | T-23b, T-23L, 1b |
| T-24 | Environnement même uid | **Fait** | T-26, D |
| T-25 à T-37 | Voir §4, §5, §11, §13 | À prouver | Brique nommée à chaque mention |
| T-38 | Module sous srt : stdio, rappel de la gateway par le proxy, lecture et réseau limités, latence | À prouver | Banc Linux et macOS, 1b.0 |
| T-39 | Pont http vers un module sous srt, code de la gateway sur l'hôte distant | À prouver | Banc, 1b.0 ; d'ici là `type: http` refusé |
| T-40 | Worker et module hostiles face à la gateway | À prouver | Gherkin, 1b.1 |
| T-41 | Worker entier sous srt : `query()`, handlers minces, binaire, broker | À prouver ; échec = blocage, O-30 | Banc Linux et macOS, 1b.0 |
| T-42 | Autorisation de task par `mask`, `tlsTerminate`, `broker.localhost` | À prouver | Banc, 1b.0 |
| T-43 | Processus natif étranger qui joint le broker | À prouver | Banc, 1b.0 |
| T-44 | PR hostile : steps sans assertion, mutants tués | **Fait macOS, sans srt et sous srt : la PR passe** | Sentinelle documentaire, 1a |
| T-45, T-46 | Réservation à états, reprise, facture supérieure | À prouver | Gherkin, 1b.3 |
| T-47, T-52 | Autorité de lancement ; garde dependency-cruiser avec fixture | À prouver | Gherkin, 1b.1 |
| T-48 | Canari, `tools/list` client, I-9 | À prouver | Gherkin, 3 |
| T-49, T-50 | Postgres jetable sous srt : db-migrator ; `gate-tests` avec Stryker | À prouver | Gherkin, 4 ; `gate-linux`, 1a.4 |
| T-51 | Sémantique des arguments au point d'effet | À prouver | Gherkin, 1b.3 et 5 |
| T-54 | Banc rejoué à chaque montée de srt | À prouver | `npm run bench:sandbox`, 1b.7 |
| E-01 à E-09 | Voir §20. E-04 et E-05 ont tourné avec `query()` hors sandbox, variante refusée par D-8 | **Fait macOS** | E-xxL, `gate-linux`, 1b.0 ; T-41 pour le worker entier |

## 20. Journal daté des expériences, 30 octobre 2026

Banc : répertoire jetable, `package.json` à versions exactes. Répertoire de travail : `/private/tmp/claude-501/-Volumes-Anthropic-anthropic-partnership/6bb87a64-cf19-42c8-b0ad-acc6739370b6/scratchpad/bench/`. Variable unique par expérience. Les scripts E-02 et le broker sont donnés en §4.3 et §11.2 ; le reste sera repris dans `features/sandbox/` en 1b.0.

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

**T-24.** Linux (conteneur), même uid : `/proc/pid/environ` contient la valeur ; autre uid : `Permission denied`. macOS 27, `ps eww`, même uid : la valeur n'apparaît pas.

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
Cause documentée par le README pour Ubuntu 24.04. **Je n'ai pas modifié ce sysctl** de la VM : c'est un réglage de sécurité de l'hôte, et le banc de référence existe ailleurs. Seul passage utile : E-02 sans srt. **Aucune preuve Linux de srt n'existe donc à ce stade** ; elles sont portées par 1b.0 sur `ubuntu-24.04`, avec le sysctl que `claude-code-action` pose lui-même. Si l'une d'elles échoue, la conception est revue avant 1b.1.

**T-44, PR hostile contre la porte (revue externe, P0).** Répertoire jetable, `@cucumber/cucumber` 12.9.0, Stryker 10.1.1, `tsx`. Code de la PR : `allow()` bogué, `return n < this.max || true`. Deux scénarios, dont un qui attend un refus. Trois versions des steps, une variable à la fois ; `gatecheck.mjs` applique §13.3 et §13.6 aux rapports. `./run.sh <variante>` :
```
honest   : cucumber FAILED « true !== false » ; Stryker s'arrête au run initial, aucun rapport : ROUGE
noassert : cucumber exit=0 ; {"pickles":2,"verts":2,"mutants":{"Survived":8},"porte":"ROUGE"}
hostile  : cucumber exit=0 ; {"pickles":2,"verts":2,"mutants":{"Killed":8},"porte":"VERTE"}
```
Version hostile : le step appelle le code pour la couverture, n'affirme rien, et lève une erreur si `globalThis.__stryker__.activeMutant` est défini. **La PR passe.** Aucun fichier de rapport n'est forgé. **Sous srt, réseau nul, macOS** : cucumber passe, Stryker échoue, `listen EPERM 0.0.0.0`. **Échec consigné** : ma conclusion attendue était une porte verte, le premier run a échoué pour une autre raison, `ERR_MODULE_NOT_FOUND` sur `src/calc.js` faute de `--import tsx` pour cucumber-js. Avec `allowLocalBinding` : même résultat `VERTE`, 8 `Killed`. Sous Linux : non joué ici, T-50.

**Test de pérennité, 30 octobre 2026** (§4.11). `gh api repos/<dépôt>`, `gh api repos/<dépôt>/releases/latest`, `gh api "repos/<dépôt>/commits?since=<90 jours>&per_page=100"` groupé par domaine d'auteur ; `gh api "repos/torvalds/linux/commits?path=security/landlock&since=<12 mois>"` ; `man sandbox-exec` ; pages citées au §4.11. Podman : `docs/source/markdown/podman-machine.1.md`, fournisseurs macOS `libkrun` et `applehv`. Taille de srt : `find dist -name '*.js' | xargs cat | wc -l` = 23 160. `node:net` : aucune méthode d'identifiants de pair sur `Socket.prototype`, seul `_getpeername`.
