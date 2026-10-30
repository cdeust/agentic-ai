# Plateforme v3 sous sandbox-runtime (srt) : document de conception

Statut : proposition, révision du 30 octobre 2026. Aucun code applicatif n'est modifié par ce document ; l'implémentation commence à la brique 1a (§15).

Nom : `ai-architect.tools` reste la marque. `architect-os` est un **nom provisoire**, le choix définitif est suspendu par le propriétaire ; son isolation est décrite au §7.2 pour qu'un renommage reste mécanique.
Base : `feat/marketplace-srt` à `1746cc8`. Cible : la vision « ai-architect.tools, architecture plateforme v3 » (29 octobre 2026), ci-après **v3** (`docs/design/platform-v3.html`, inchangé), amendée par les décisions du §1.

Conventions de preuve, appliquées à chaque affirmation technique :

- **[V: source]** : lu en source primaire (documentation officielle, `.d.ts` ou README de la version épinglée, fichier du dépôt).
- **[E-xx] / [T-xx]** : expérience exécutée en isolation, consignée au §20 avec commande et sortie, échecs compris.
- **[À PROUVER: T-xx, banc, brique]** : pas encore de preuve. Le test, le banc et la brique sont nommés ; rien de ce qui est ainsi marqué n'est livré avant que le test ait tourné.

Tout s'est exécuté sur macOS 27 (`arm64`, Node 26.11.1, srt 0.0.81, MCP SDK 1.32.2, Agent SDK 0.3.312, Claude Code 2.1.312). **Aucun appel réel à l'API Anthropic n'a eu lieu** : le binaire Claude Code a parlé à un faux amont TLS local, et le profil srt ne laissait passer que lui. Linux n'est pas prouvé ici, voir E-07 au §20.

---

## 0. Ce que cette révision change

| Avant (`1746cc8`) | Maintenant | Preuve |
|---|---|---|
| Protocole JSON lines maison entre `platformd` et les sandboxes | **Supprimé.** MCP stdio avec le SDK officiel pour l'executor ; canal stdio de l'Agent SDK pour les agents | E-01, E-02, E-04 |
| `platformd`, démon superviseur avec socket de contrôle et clé Anthropic | **Supprimé.** Une bibliothèque de lancement de sandbox et une table de modules au format `.mcp.json` | E-02, E-04, E-05, E-06 |
| Clé masquée par srt (`mask` + `tlsTerminate`), repli broker | **Inversé.** Broker par task, seul détenteur de la clé ; le masquage est écarté | T-04 (échec adversarial), E-05, T-23 |
| Worker Node dans la sandbox, stdin/stdout JSON, outils relayés en HTTP | **Remplacé.** `query()` reste hors sandbox, seul le binaire Claude Code tourne sous srt ; handlers des outils dans le processus hôte | E-04 |
| Profils de task propriétaires | Fichiers `agents/<nom>.md` au format Claude Code + profil srt JSON statique | E-04b, E-08 |
| Gabarits `{{runtime}}`, `{{repo}}` | **Supprimés.** Chemins relatifs à la task, `~` natif | T-02c à T-02i |
| `@cucumber/cucumber` 13.3.0 | **12.9.0**, 13.x casse le runner Stryker | T-14 |
| « Validation » d'un budget ou d'un jeton à l'entrée de la gateway | Réservation atomique en base ; jeton d'appel vérifié par le module | T-20, T-21 |

## 1. Décisions du propriétaire appliquées

| # | Décision | Où elle s'applique ici |
|---|---|---|
| D-1 | Tout ce qui était conteneur Docker devient un processus sandboxé par `@anthropic-ai/sandbox-runtime` 0.0.81. **Amendement proposé (O-20)** : « superviseur de processus srt » devient une bibliothèque sans démon, puisque le SDK couvre le reste | §4, §9 |
| D-2 | Marketplace à la racine (`.claude-plugin/marketplace.json`, plugins sous `plugins/<nom>/`) | §7, §8 |
| D-3 | Gateway séparée (auth, profils, DAG, budgets, jetons, `max_result_tokens`, registre, méta-tools). Couches en processus séparés | §4, §11 |
| D-4 | Par tool : `kind: workflow` dès que le comportement est stable ; `kind: agent` sinon, toujours sous srt | §10 |
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

### 1.1 Deux constats de la revue externe refusés par le propriétaire

| Refus | Raison | Risque résiduel |
|---|---|---|
| Aucune comparaison de digests entre build-1 et build-2 | D-6 : seule la porte de tests fait foi. La garantie de stage 0 est nommée pour ce qu'elle est (§14) | Une différence entre les deux builds qu'aucun scénario n'observe reste invisible, et la reproductibilité binaire n'est pas établie |
| Mutation à 0 survivant sans seuil différent par composant | D-6c : une règle unique, sans négociation par composant | Coût concentré sur les fichiers souvent modifiés et sur le code mal couvert, borné par le périmètre de diff. Mesuré : M-01, §13.6. Un équivalent mal justifié peut passer la forme, et seule la revue le juge (C-11) |

## 2. Trois piliers

| Pilier | Statut |
|---|---|
| I. Recherche reproductible | **Fait** : sources Anthropic lues (§16), bancs exécutés avec échecs consignés (§20). **Prévu brique 1a** : `npm run gate` rejoue la porte en une commande. **Prévu brique 1b** : les expériences du §20 deviennent `features/sandbox/*.feature`, rejouées sur Linux et macOS, une commande. **Prévu brique 0, reportée par D-7** : baseline M1/M2 |
| II. SSDLC | **Fait** : STRIDE mis à jour pour chaque changement de topologie (§11.3), supply chain (§12). **Prévu brique 1a** : SAST = porte Gherkin + mutation. **Prévu brique 1b** : DAST = suite d'évasion contre de vrais processus srt (§11.4) |
| III. Opérationnel | **Fait** en conception : moindre privilège par profil (§9), aucun secret dans une sandbox (§4.2), modèle de confiance écrit (§11.1). **Prévu brique 1b** : invariants du §11.5 prouvés sur les deux OS. **Sans objet** pour l'IRB tant qu'aucune donnée humaine ou stratégique n'est traitée ; réévalué en brique 4 si memory reçoit des données personnelles |

## 3. Écarts vs v3

| Élément v3 | Version srt | Raison |
|---|---|---|
| `compose.yaml` « identique laptop et serveur » | `topology/modules.mcp.json` au format `.mcp.json` ; mêmes processus, sémantiques OS différentes (Seatbelt, bubblewrap) | D-1. Le format est celui de Claude Code, un seul champ `type` distingue stdio local et http distant [V: https://code.claude.com/docs/en/mcp] |
| [1] Reverse proxy | Hors plateforme, serveur seulement, un `Caddyfile` descriptif ; aucun code n'en dépend | §5.1 |
| [2] Gateway en conteneur | Processus natif ; ne peut pas tourner sous srt | T-07 : fd ≥ 3 non transmis, `listen` sur fd 0 refusé |
| [3] Executor, pool chaud | `srt -- node executor.js`, réseau nul, client MCP sur ses stdin/stdout | E-02 ; T-10 : surcoût de lancement 211 ms |
| Conteneurs de task | Agent SDK dans le module, binaire Claude Code sous srt, profil `agents/<nom>.md` + `<nom>.srt.json` | E-04 |
| Orchestrateur, « clés API injectées par task » | **Aucune clé dans une task.** Broker hors sandbox, un port par task | T-04, E-05, T-23 ; [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment#the-proxy-pattern] |
| « Jeton par task, révoqué à l'annulation » | Jeton d'appel Ed25519 vérifié par le module cible ; la sandbox n'en détient aucun | T-21, §4.4 |
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
 ---------------- hôte, processus NATIFS (hors srt) -----------------------------------
 [gateway]   écoute 127.0.0.1:8080 ; seul point de politique
             auth, profils, DAG calls_allowed, budgets, registre, max_result_tokens
             détient : clé privée Ed25519 des jetons d'appel, table des clients
             ne contient ni pg, ni Agent SDK, ni clé Anthropic
      | MCP. Local : stdio (la gateway lance le module, aucun port ouvert).
      |      Distant : http (changement d'un champ de topology/modules.mcp.json).
      |      Chaque appel porte un jeton d'appel, vérifié par le module dans tous les cas.
      v
 [modules kind: data | workflow]   TypeScript sans modèle (memory-recall, code-index, …)
 [data]      seul importeur de pg ; opérations typées exposées en tools MCP ; budgets et capacité
             -> socket Unix Postgres, authentification peer, aucun mot de passe
 [postgres 17]  listen_addresses='' ; pg_hba : local peer
 [broker]    seul détenteur de la clé Anthropic ; un listener 127.0.0.1:<éphémère> par task ;
             POST /v1/messages seulement ; réserve puis réconcilie le budget de modèle
 [modules kind: agent]  query() dans CE processus ; handlers des outils ici, hors sandbox ;
             aucune clé, aucun accès pg ; rappelle la gateway avec un jeton d'appel
 [executor-host]  un McpServer par session, posé sur les tubes de l'enfant srt
 ---------------------------------------------------------------------------------------
      | stdio uniquement (fd 0-2) ; srt ne transmet aucun autre descripteur [T-07]
      v
 ---------------- processus SOUS srt -------------------------------------------------
 srt --settings executor.srt.json -- node executor.js        (1 par session)
    réseau : AUCUN ; client MCP sur stdin/stdout ; aucun secret ; le port n'existe pas
 srt --settings scout.srt.json -- env -u NO_PROXY -u no_proxy claude …    (1 par task)
    réseau : 127.0.0.1:<port broker de CETTE task> seul ; aucune clé, aucune sentinelle
    lecture : "." ; ./repo jetable en lecture seule ; ~ refusé ; écriture : "."
 srt --settings builder.srt.json …           écriture : copie de travail jetable "."
 srt --settings zetetic-reviewer.srt.json …  lecture de ./repo et du diff ; écriture "."
 srt --settings web-scout.srt.json …         allowlist du manifeste, plages privées refusées
 --------------------------------------------------------------------------------------
 Proxys srt : un couple HTTP/SOCKS par processus srt, côté hôte
```

### 4.2 Qui détient quel secret

| Secret | Détenteur | Jamais présent dans |
|---|---|---|
| Clé Anthropic (runtime) | `broker` seul, lue depuis un fichier 0600 sous `~/.architect-os/` | modules, gateway, sandboxes (ni clé, ni sentinelle) |
| Clé privée Ed25519 des jetons d'appel, table des clients | gateway | modules (clé publique seule), sandboxes |
| Jeton d'appel | gateway et module cible, le temps d'un appel | sandboxes |
| Identifiants Postgres | aucun : `peer` sur socket Unix [E-09] | partout |
| Clé TLS du serveur | déploiement (§5.1) | plateforme |
| CI : `GATEWAY_CI_TOKEN` | secret GitHub du workflow Claude | porte de tests |
| CI : accès Anthropic | fédération OIDC, `id-token: write` [V: https://code.claude.com/docs/en/github-actions#set-up-for-an-organization] | dépôt |

Une sandbox n'a donc **aucun secret à voler**. Le risque résiduel est l'usage du broker pendant la task : une sandbox compromise peut consommer son propre budget, pas celui d'une autre, et pas lire la clé.

### 4.3 Deux formes de canal, aucun protocole maison

**Executor, code mode (E-02).** L'enfant est **client** MCP sur ses propres stdin/stdout, l'hôte est **serveur** sur les tubes de l'enfant. Aucune ligne de protocole à écrire, parce que `StdioServerTransport` est un `Transport` symétrique et accepte deux flux quelconques [V: `@modelcontextprotocol/sdk` 1.32.2, `dist/esm/server/stdio.d.ts`].

```ts
// hôte : un serveur par sandbox ; l'identité de la task est la fermeture du handler
const child = spawn(srtBin, ['--settings', profile, '--', 'node', 'executor.js'],
                    { stdio: ['pipe', 'pipe', 'inherit'], detached: true });
child.stdin.on('error', onChildGone);           // sans lui, EPIPE tue l'hôte [E-02]
const server = new McpServer({ name: 'host', version });
registerToolsOfProfile(server, taskId);
await server.connect(new StdioServerTransport(child.stdout, child.stdin, { maxBufferSize }));

// sandbox : aucun code de protocole
const client = new Client({ name: 'task', version });
await client.connect(new StdioServerTransport());
```

Les trois messages JSON lines disparaissent : `start` devient le tool `task_input`, `call` devient `tools/call`, `output` devient `task_complete`. Résultats : 1 000 allers-retours en 45 ms sous srt contre 38 ms sans, charge de 8 Mio passée, deux tasks concurrentes sans mélange, `tools/list` limité au profil, tool hors profil refusé. Un `_meta.task` forgé par l'enfant est ignoré, l'hôte ne lit que la fermeture [E-03]. Un enfant hostile qui écrit du faux JSON ou une ligne de 11 Mio produit une erreur de transport, l'hôte reste vivant [E-03]. Le sens standard (hôte client, enfant serveur) marche aussi [E-01], mais il ne permet pas à l'enfant d'appeler des tools : MCP ne prévoit de requêtes serveur vers client que pour l'échantillonnage, l'élicitation et les racines. D'où le sens inversé.

**Agents (E-04).** L'Agent SDK lance déjà le binaire Claude Code en sous-processus et lui parle sur stdio. `spawnClaudeCodeProcess` [V: `sdk.d.ts` 0.3.312] permet d'envelopper ce seul binaire. `query()` et les handlers de `createSdkMcpServer` restent dans le module, hors sandbox.

```ts
query({ prompt, options: {
  agent: 'scout', agents: loadAgents('agents/'),   // §9.1
  mcpServers: { platform: createSdkMcpServer({ name: 'platform', tools }) },
  tools: […], allowedTools: […], permissionMode: 'dontAsk', settingSources: [], strictMcpConfig: true,
  persistSession: false, maxTurns, maxBudgetUsd,
  env: { PATH, HOME, ANTHROPIC_BASE_URL: `http://127.0.0.1:${leasePort}`, ANTHROPIC_API_KEY: 'aucune',
         CLAUDE_CONFIG_DIR: '.cfg', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
  spawnClaudeCodeProcess: (o) => spawnUnderSrt(profile, ['env', '-u', 'NO_PROXY', '-u', 'no_proxy', o.command, ...o.args], o),
}});
```

Le code actuel (`worker/main.ts`, `run-worker.ts`, `internal-tools.ts`, `internal-http.ts`) disparaît. `sdk-agent.ts` ne garde que la construction des options ; ses handlers appellent directement `InternalToolService`.

Pourquoi `spawnClaudeCodeProcess` et non l'option `sandbox` du SDK : le sandbox intégré ne couvre que Bash et ses enfants, les tools intégrés, MCP et les hooks restent dehors [V: https://code.claude.com/docs/en/sandboxing#what-runs-outside-the-sandbox]. Pour isoler tout le processus, la doc renvoie à sandbox-runtime, un conteneur ou une VM [V: https://code.claude.com/docs/en/security#working-with-sensitive-code]. `spawnClaudeCodeProcess` n'est mentionné que dans `sdk.d.ts`, aucune page de doc ne le décrit : l'option sera surveillée à chaque montée de version, et le scénario E-04 la rejoue.

### 4.4 Jetons d'appel

Chaque appel relayé par la gateway porte un jeton Ed25519 signé pour cet appel : `{ aud, task, cap, exp, budget, jti }`, soit module cible, tâche, tools permis, expiration courte, réservation budgétaire, identifiant unique. Le module vérifie signature, audience, capacité, expiration et unicité du `jti` avec la **clé publique seule** [T-21 : autre module, hors capacité, expiré, rejeu et task falsifiée refusés ; 0,10 ms à l'émission, 0,20 ms à la vérification]. Le jeton voyage dans `_meta` du `tools/call`, identique sur stdio et http. Un module qui rappelle la plateforme présente son jeton à la gateway, qui contrôle `calls_allowed` et en émet un nouveau. Le test de bout en bout est [À PROUVER: T-25, Gherkin, brique 2].

### 4.5 Budgets

Réservation atomique avant exécution, réconciliation au résultat. Deux opérations typées de `data`, en fichiers `.sql` (`CLAUDE.md` : SQL seulement dans `data/`) :

```sql
-- budget.reserve : renvoie une ligne si et seulement si la réservation tient sous le plafond
UPDATE platform.budgets SET reserved = reserved + $2
 WHERE task = $1 AND reserved + spent + $2 <= cap RETURNING 1;
-- budget.settle
UPDATE platform.budgets SET reserved = reserved - $2, spent = spent + $3 WHERE task = $1;
```

Avec `CHECK (reserved + spent <= cap)` en dernier rempart. T-20, Postgres réel : 300 réservations parallèles de 10 sur un plafond de 1 000 donnent exactement 100 acceptées ; après réconciliation à un coût réel de 7, 30 nouvelles passent, jamais au-delà. Le broker réserve avant de transmettre et réconcilie à partir de `usage` ; `maxBudgetUsd` et `maxTurns` restent en second rempart. `total_cost_usd` est une estimation côté client, l'autorité étant l'API Usage and Cost ou la Console [V: https://code.claude.com/docs/en/agent-sdk/cost-tracking] : la facturation ne s'appuie jamais dessus.

### 4.6 Ce que `platformd` détenait, et où cela va

| Fonction | Devient | Preuve |
|---|---|---|
| Clé Anthropic | `broker`, seul détenteur ; `platformd` n'existe plus | E-05, T-23 |
| Relais des appels | Aucun relais : serveur MCP par sandbox, handlers dans le module | E-02, E-04 |
| Lancement de srt | Bibliothèque `packages/sandbox` (argv, groupe de processus, terminaison vérifiée) | T-06 |
| Socket de contrôle | Supprimée | sans objet, plus rien à contrôler |
| `topology/processes.yaml` | `topology/modules.mcp.json`, format Claude Code | [V: mcp.md] ; lecture par la gateway [À PROUVER: T-29, Gherkin, brique 1b] |
| Quotas par tâche | Budgets §4.5 | T-20 |
| Concurrence globale | Même mécanisme : `capacity.acquire` avec expiration, `capacity.release` | Mécanisme T-20 ; [À PROUVER: T-27, Gherkin, brique 1b] |
| Terminaison | `detached: true`, `kill(-pgid)`, contrôle `pgrep -g`, puis `SIGKILL` ; erreur nommée `WORKER_TIMEOUT` | T-06, résidu macOS T-06b |
| Redémarrage | Tableau ci-dessous | [À PROUVER: T-30, Gherkin, brique 1b] |
| Isolement des pannes | Un enfant par task : la mort de l'un ne touche pas les autres | E-06 |

| Processus | Politique de redémarrage explicite |
|---|---|
| Sandbox (task, executor) | **Jamais** : la task échoue avec un code nommé, le client décide |
| Module stdio | Reconnexion par la gateway, 3 essais avec délai croissant, puis `SERVICE_UNAVAILABLE` (code existant dans `mcp-service-client.ts`) |
| Broker | Comme un module. Sa mort fait échouer les tasks en cours avec une erreur nommée, sans effet sur les modules sans modèle |
| Gateway, Postgres | Poste : aucun, le développeur relance. Serveur : `Restart=on-failure` dans l'unité (§5.1) |

## 5. Audit élément par élément

### 5.1 Ce qui n'est ni TypeScript, ni npm, ni fichier descriptif, ni brique Anthropic

| Élément | Verdict | Par quoi / raison | Preuve |
|---|---|---|---|
| `fixpoint.sh` (v3) | **Retiré** | `tools/build` en TypeScript, étapes YAML | §14 ; absent du dépôt |
| `stage0/promote.sh` (v3, `platform-build.yml`) | **Retiré** | Promotion = étapes YAML, `npm publish` puis PR d'épinglage. Absent du dépôt à `1746cc8` | `platform-v3.html` ligne 607 ; §14 |
| `.gitignore` cite `scripts/gate.sh` | **Retiré** en 1a | Remplacé par `npm run gate` | `.gitignore` |
| Caddy, edge | **Retiré de la plateforme**, gardé en dépôt comme `deploy/edge/Caddyfile` | Aucun code n'en dépend, le poste n'en a pas. Aucune brique Anthropic ne fait TLS public ni ACME. Sur serveur, tout terminateur convient | Choix du terminateur : O-7. Serveur [À PROUVER: T-31, banc serveur, brique de déploiement] |
| Unités système | **Gardées sur serveur seulement**, fichiers descriptifs `deploy/systemd/*.service` | Aucun script. Poste : `npm start` | [À PROUVER: T-26, banc serveur, brique de déploiement] |
| Utilisateurs OS (`agentic-gw`, `agentic-sup`, `agentic-data`) | **`agentic-sup` retiré** (`platformd` n'existe plus). **`agentic-gw` → `architect-os-gateway`**, **`agentic-data` → `architect-os-data`**, **`architect-os-broker` ajouté**, serveur seulement. Poste mono-utilisateur | Preuve de la nécessité : sous Linux, un processus du même uid lit `/proc/<pid>/environ` d'un autre, un autre uid reçoit `Permission denied`. Sans utilisateurs dédiés, une gateway compromise lit la clé du broker | T-24 |
| Socket Unix Postgres | **Gardée** ; `/run/agentic/pg` → `/run/architect-os/pg` | Auth `peer`, aucun mot de passe, donc aucun secret. Le pilote `pg` s'y connecte. Depuis une sandbox : `EPERM` ; ouverte seulement si `allowUnixSockets` nomme le chemin exact | E-09, U |
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
| `platformd` | **Supprimé** | Agent SDK + MCP SDK + `packages/sandbox` | §4.6 |
| Worker `main.ts`, entrée/sortie JSON | **Supprimé** | `query()` + `spawnClaudeCodeProcess` + `outputFormat` | E-04 |
| Outils internes HTTP (`internal-http.ts`, `HttpInternalTools`) | **Supprimés** | `createSdkMcpServer`, handlers dans le module | E-04 |
| API HTTP de `data` (`/v1/ops/<op>`, `HttpDataClient`) | **Remplacée** | `McpServer` généré par une boucle sur `DATA_OPS`, comme `createGatewayServer` | Patron existant ; [À PROUVER: T-33, Gherkin, brique 1b] |
| Masquage de clé srt | **Écarté** | Broker, patron recommandé par Anthropic | T-04, T-23 ; [V: secure-deployment#the-proxy-pattern] |
| Jetons de task signés maison | **Gardés, durcis** | Forme `AuthInfo` du SDK côté http, `expectedResource` pour l'audience ; signature `node:crypto` | [V: `dist/esm/server/auth/types.d.ts`, `bearerAuth.d.ts`] ; T-21 |
| Registre (`platform.executions`) | **Gardé** | Aucune brique ne couvre un registre transverse. `SessionStore` persiste des sessions, pas des exécutions de modules. OTel reste optionnel | [V: https://code.claude.com/docs/en/agent-sdk/hosting#observability] |
| Profils de task | **Remplacés** | `agents/<nom>.md` au format Claude Code + `<nom>.srt.json`. `settings.json` de plugin ne porte que `agent` et `subagentStatusLine`, donc pas de politique par ce biais | E-04b, E-08 ; [V: plugins-reference#settings] |
| Profils clients de la gateway | **Gardés**, fichier descriptif | Aucune brique ne filtre un catalogue par client | §10 |
| `search` / `describe` | **Gardés pour Codex et la CI, fusion proposée** | Claude Code diffère déjà les schémas par Tool Search ; le serveur d'entrée se déclare `alwaysLoad`. Voir O-21 | [V: mcp#configure-tool-search, mcp#exempt-a-server-from-deferral] |
| `execute` | **Gardé** | Aucune brique client ne filtre les résultats intermédiaires hors du contexte | [V: https://www.anthropic.com/engineering/code-execution-with-mcp] |
| Catalogue de repli | **Gardé, sans code neuf** | C'est la boucle `registerTool` déjà présente dans `gateway/src/presentation/mcp-server.ts` ; Claude Code y applique Tool Search | Fichier du dépôt ; [V: mcp.md] |
| `max_result_tokens`, résumé + handle | **Gardé** | Claude Code alerte à 10 000 tokens et plafonne à 25 000 : largement au-dessus des 1 000 visés par v3 | [V: mcp#mcp-output-limits-and-warnings] |
| Tasks (extension MCP) | **Reporté** | Le SDK marque `experimental.tasks` « may change without notice » | [V: `dist/esm/client/index.d.ts`] |

## 6. Correspondance avec le squelette actuel

| Actuel (`1746cc8`) | Devient | Statut |
|---|---|---|
| `compose.yaml`, `Dockerfile`, `.dockerignore`, `services/memory/worker/Dockerfile`, `test/infra/compose.test.ts` | `topology/modules.mcp.json`, `sandboxes/profiles/*`, `features/infra/`, `features/sandbox/` | **supprimés** (1b) |
| `proxy/Caddyfile` | `deploy/edge/Caddyfile` | **déplacé** (1b) |
| `.env.example` | `topology/env.example`, sans mot de passe ni `BROKER_URL` | **réduit** (1b) |
| `docker-runner.ts` (`DockerContainerRunner`, préfixe `agentic-worker-`) | `packages/sandbox` | **supprimé** (1b) |
| `in-process-runner.ts` | adaptateur en mémoire, indispensable à la mutation (§13.6) | **gardé** |
| Port `ContainerRunner` | `SandboxRunner` | **renommé** |
| `worker/main.ts`, `run-worker.ts`, `internal-tools.ts`, `src/presentation/internal-http.ts`, `prompts/recall.md` | §4.3 ; `prompts/remember.md` devient `agents/` | **supprimés** (1b, `recall` en brique 2) |
| `worker/sdk-agent.ts` | options de `query()` | **réduit** |
| `gateway/` | + `profiles`, `tokens`, `policy`, `registry`, `codefront`, lecture de `modules.mcp.json` | **étendu** |
| `data/src/presentation/http-api.ts`, `services/memory/src/infrastructure/data-client.ts` | Serveur MCP généré, client MCP | **remplacés** (1b) |
| `data/` | + `budget.*`, `capacity.*`, `owner` dans `operations.json` | **étendu** |
| `0002_memory.sql` (pgvector actif) | Migration `0004` (D-5) ; pgvector requis jusque-là par les 6 tests §13.9 | **nouveau** |
| `packages/contracts` | + schémas stricts des profils srt et du manifeste | **étendu** |
| `.dependency-cruiser.cjs` | `@anthropic-ai/sandbox-runtime` seulement dans `packages/sandbox` ; Agent SDK dans `modules/*` et `services/*` | **modifié** |
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
│   └── sandbox/                           # lancement srt, terminaison, seul importeur de srt
├── gateway/
├── modules/
│   ├── broker/  executor-host/  manifest-registry/  db-migrator/  web-scout/
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

- `alwaysLoad` empêche que le méta-tool `search` soit lui-même différé [V: mcp#exempt-a-server-from-deferral]. Présence de la clé dans ce schéma [À PROUVER: T-11b, Gherkin, brique 1c].
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

Champs reconnus et clés inconnues ignorées [V: sub-agents#frontmatter-reference]. **Chargement** : le module lit ces fichiers (frontmatter + corps, 15 lignes avec `yaml`, déjà dépendance du dépôt) et les passe par `agents` + `agent`. Le chargement par `plugins` + `agent` a appliqué `model` et `tools` mais **le corps du prompt n'a pas atteint le modèle** sur Claude Code 2.1.312 ; `agents` et `systemPrompt` fonctionnent [E-08]. Les agents de plugin ignorent de toute façon `hooks`, `mcpServers` et `permissionMode` [V: sub-agents#choose-the-subagent-scope]. La politique (`permissionMode: 'dontAsk'`, `settingSources: []`, `strictMcpConfig`) reste dans le code : c'est un plancher de sécurité, pas un comportement (`CLAUDE.md`, « Descriptive files before code »).

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
- Tâche = répertoire jetable sous `~/.architect-os/tasks/<id>/`, `cwd` de la sandbox. Le home étant refusé, l'état de la plateforme et les autres tasks le sont aussi. `./repo` est une copie jetable, donc aucun chemin variable, aucun gabarit.
- Le runner ajoute au profil validé la seule valeur dynamique, `127.0.0.1:<port>` du broker, et écrit le résultat **hors** de `allowWrite`.
- srt doit être installé hors de tout chemin inscriptible : une copie dans un `node_modules` inscriptible serait réécrite puis exécutée sans sandbox [V: README srt, « Where This Package Is Installed »]. Scénario d'évasion dédié.
- Écritures refusées même dans `.` : `.git/hooks`, `.mcp.json`, `.claude/agents` [T-02e].

Sous Linux : `allowWrite` et `denyWrite` n'acceptent que des chemins littéraux, et un `denyRead` ne masque que ce qui existe à l'emballage [V: README, « Path Syntax (Linux) »]. D'où [À PROUVER: T-02L, `gate-linux`, brique 1b].

| Profil | Réseau | Lecture | Écriture | Modèle |
|---|---|---|---|---|
| executor | aucun | `.`, dist de l'executor | `.` (session) | aucun |
| scout | broker de la task | `.`, `./repo` | `.` sauf `./repo` | sonnet |
| builder | broker de la task | `.` | copie jetable `.`, sans `node_modules` inscriptible | sonnet |
| zetetic-reviewer | broker de la task | `.`, `./repo`, diff | `.` sauf `./repo` | opus |
| agent-worker | broker de la task | `.` | `.` | selon manifeste |
| web-scout | allowlist du manifeste + `deniedResolvedAddresses` sur plages privées | `.` | `.`, sortie en quarantaine par tool MCP | aucun |
| gate-tests (CI) | aucun, sauf Postgres par socket nommée | merge, `node_modules` | merge, `reports/` | aucun |

Dépendances hôte Linux : `bubblewrap`, `socat`, `ripgrep`. Ubuntu 24.04 : `kernel.apparmor_restrict_unprivileged_userns=0` ou profil AppArmor dédié [V: README] ; `claude-code-action` pose ce sysctl lui-même [V: `action.yml`]. Appelant non root recommandé [V: README, « Running as root »].

## 10. Manifeste de module

```yaml
name: memory-recall
version: 1.2.0
domain: memory
owner: cortex
transport: stdio             # stdio | http ; reporté dans topology/modules.mcp.json
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
sandboxes: []
writes_tables: []
reads_domains: [memory]
calls_allowed: [judge]
egress: none
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

`annotations` : `readOnlyHint` autorise le parallélisme, `idempotentHint` une relance HTTP [V: mcp#mark-tools-that-are-safe-to-call-twice]. `response_format` et pagination suivent « Writing effective tools » (§16). Règles, chacune un scénario Gherkin : tool `data`/`workflow` ⇒ `sandboxes: []` ; tool `agent` ⇒ au moins une sandbox ; `writes_tables` disjoints ; `calls_allowed` acyclique ; `egress` ≠ `none` ⇒ quarantaine ; un tool `agent` déclaré `stable: true` est refusé (D-4).

## 11. Sécurité : modèle de confiance, STRIDE, invariants

### 11.1 Modèle de confiance, écrit

**srt n'est pas tenu pour équivalent à une VM ni à un conteneur renforcé.** La doc Anthropic classe sandbox-runtime « bon » à surcoût très faible, gVisor « excellent » et conseillé pour le multi-tenant et le contenu non fiable, VM « excellent » ; le noyau reste partagé [V: https://code.claude.com/docs/en/agent-sdk/secure-deployment#isolation-technologies]. srt se présente lui-même comme « Beta Research Preview » [V: README].

**Portée autorisée : usage local ou utilisateurs fiables d'abord. Le déploiement multi-utilisateur est bloqué** tant que la suite d'évasion, d'accès aux secrets et d'isolation intersessions (§11.4) ne passe pas sur Linux **et** macOS. Lever ce blocage ne suffit pas à rendre srt adapté à du contenu hostile multi-tenant : ce serait une décision du propriétaire, avec gVisor ou VM à évaluer (O-22).

Résidus assumés sous ce modèle :

| Résidu | Fait | Fermeture |
|---|---|---|
| macOS : un enfant `setsid` survit à la mise à mort du groupe, garde son profil Seatbelt et devient orphelin (PPID 1) | T-06b | Linux : espace PID de bubblewrap, [À PROUVER: T-06L, `gate-linux`, brique 1b]. macOS : aucune, poste de développement seulement |
| macOS : aucune limite mémoire ou PID par sandbox. `ulimit -u` compte par utilisateur, donc inapplicable par task, et le shell est lui-même refusé à 200 | T-09 | Linux : `systemd-run`, [À PROUVER: T-09L, `gate-linux`, brique 1b]. macOS : timeout, budgets |
| Poste : tous les processus natifs partagent un uid | T-24 sous Linux ; `ps eww` sur macOS 27 ne montre pas l'environnement mais ne vaut pas frontière | Serveur : utilisateurs dédiés, T-26 |
| Exfiltration par un domaine autorisé | [V: README, « Security Limitations »] | Sandbox de modèle : seul le broker, `POST /v1/messages` ; le contenu reste un canal vers l'API |
| Amont qui refléterait l'en-tête `x-api-key` | E-05c | Le broker retire la clé des réponses, §11.2 ; [À PROUVER: T-23b, Gherkin, brique 1b] |

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

- L'enfant n'a ni clé, ni sentinelle : le vecteur **e** n'existe plus. L'amont a bien reçu la vraie clé, le corps n'en contenait aucune trace [T-23].
- **Un listener `127.0.0.1:<éphémère>` par task : le port est l'identité.** Seul le profil srt de cette task autorise ce port (T-03 : direct refusé, port non listé refusé, `127.0.0.1:<port>` listé accepté). Aucun jeton dans la sandbox.
- `POST /v1/messages*` seulement ; `/v1/models` et `GET` : 403 ; amont direct et internet : refusés [T-23].
- L'Agent SDK fonctionne intégralement par ce chemin, outils et sortie structurée compris [E-05].
- Réflexion : le broker retire la clé des réponses et l'en-tête `content-length`. Le banc a montré que sans ce retrait un amont réfléchissant renvoie la clé (`FUITE`), et qu'un retrait qui garde `content-length` coupe la connexion (`UND_ERR_SOCKET`, pas de fuite) [E-05c]. Implémentation correcte [À PROUVER: T-23b, Gherkin, brique 1b]. Comportement réel de `api.anthropic.com` sur requêtes invalides [À PROUVER: T-04R, banc avec clé, brique 1b].

Le broker lui-même reste à relire contre `https://code.claude.com/docs/en/agent-sdk/secure-deployment` à l'implémentation : `ANTHROPIC_BASE_URL` passe le trafic de modèle en clair jusqu'au proxy local, ce qui est le cas prévu [V: même page].

### 11.3 STRIDE, mis à jour pour chaque changement de topologie

| Menace | Vecteur | Contrôle | Statut |
|---|---|---|---|
| **S** | Un processus local appelle un module | Local : pas de port (stdio). Distant : jeton d'appel `aud` vérifié par le module | T-21 ; T-25 en brique 2 |
| S | Une sandbox présente l'identité d'une autre | Identité = fermeture du handler, ou port du broker ; jamais le message | E-02, E-03, T-03 |
| S | Rejeu d'un jeton entre deux tâches | `task`, `jti`, `exp`, `aud` signés | T-21 |
| S | Le module usurpe la gateway | Clé publique seule côté module | T-21 |
| **T** | Le builder modifie hooks git, `.mcp.json`, `.claude/agents` | Refus obligatoires srt + copie jetable | T-02e ; Linux T-02L |
| T | Une sandbox réécrit son profil ou le binaire srt | Profil rendu hors `allowWrite` ; srt hors chemins inscriptibles | [À PROUVER: T-34, évasion, brique 1b] |
| T | Une PR modifie la porte, un filtre ou une assertion | `pull_request_target`, code de la base ; mutation étendue | §13.8, T-22 ; sentinelles en 1a |
| T | Le code de test de la PR altère la porte sur le runner | Tests sous srt `gate-tests`, la porte est le processus parent | §13.8 ; T-35 en 1a |
| **R** | Une exécution nie un appel | Registre append-only (`0003_runs_immutable.sql`) ; chaque appel journalisé avec `task` et `jti` | Brique 2 |
| **I** | Lecture de `~/.ssh`, de `.env`, de l'état | `denyRead: ["~"]` ; état sous `~` | T-02 ; T-02L |
| I | Fuite de la clé Anthropic | Broker, aucune clé en sandbox | T-04, T-23 ; T-04R |
| I | Clé lue par un autre processus natif | Serveur : utilisateurs dédiés. Poste : résidu assumé | T-24, T-26 |
| I | Accès Postgres depuis une sandbox | Socket refusée, aucun TCP | E-09 |
| I | Exfiltration par l'API de modèle | Inhérente ; budget, journal par task | Accepté, §11.1 |
| **D** | Bombe fork, mémoire, disque, sandbox sans fin | Budgets, `capacity`, timeout, terminaison vérifiée ; `systemd-run` sur Linux | T-20, T-06 ; T-27, T-09L |
| D | Enfant hostile qui inonde son tube ou meurt | `maxBufferSize` ; `child.stdin.on('error')` ; hôte vivant | E-03 |
| D | Mort d'un worker | Enfants indépendants | E-06 |
| D | Mort d'un module ou du broker | Reconnexion bornée, erreur nommée | T-30 |
| **E** | Évasion Linux par user namespace imbriqué | Filtre seccomp srt ; `allowNestedUserNamespaces`, `enableWeakerNestedSandbox`, `allowAllUnixSockets` interdits par schéma | [V: README] ; suite §11.4 |
| E | Descripteur hérité ouvrant un service de l'hôte | Seuls fd 0-2 passent et ce sont des tubes | T-07 ; Linux T-07L |
| E | Exécution du code d'une PR en `pull_request_target` | Aucun secret, `contents: read`, aucun cache, aucun artefact consommé par un job privilégié | §13.8 |
| E | Sysctl AppArmor qui affaiblit l'hôte | Runners jetables : sysctl. Serveur : profil dédié à `bwrap` (O-17) | |
| E | srt en préversion | Épinglage exact, notes de version lues avant montée | §12 |

Changements de topologie couverts : suppression de `platformd` (retire la clé et la socket de contrôle du point de concentration) ; broker (nouveau détenteur unique, surface minimale) ; module `kind: agent` hors sandbox (ses handlers ne font plus confiance qu'à un schéma zod ; nouveau vecteur : injection par le modèle dans les arguments, traitée par validation et `calls_allowed`) ; modules en stdio (retire l'exposition TCP locale, mais la gateway devient parente : sur serveur les modules passent en http sous utilisateurs dédiés) ; `data` en MCP (même surface, protocole officiel).

### 11.4 Suite d'évasion, secrets et intersessions (DAST, bloquante pour le multi-utilisateur)

`features/sandbox/escape.feature`, `secrets.feature`, `intersession.feature`, Linux et macOS, contre de vrais processus `srt` et chaque profil : lire un faux `~/.ssh/id_test` ; écrire hors `.` ; écrire `.git/hooks/pre-commit`, `.mcp.json` ; joindre `example.com`, `127.0.0.1:<module>`, `169.254.169.254`, le socket Postgres ; hériter d'un descripteur ; `unshare -r` ; réécrire son profil ou srt ; lire le répertoire d'une autre task ; joindre le broker d'une autre task ; rejouer un jeton ; récupérer la clé par environnement, erreurs, redirection, requête modifiée.

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
| I-8 | PR incapable de neutraliser la porte | PR sentinelles rouges et une saine verte, §15 | T-22 pour l'assertion | `gate-linux` | 1a |

### 11.6 La gateway incontournable vient de l'exécution

| Propriété | Mécanisme | Test |
|---|---|---|
| Aucun agent ne contacte un module natif | Pas de port en local ; réseau de sandbox réduit au broker | T-03a, I-2 |
| Aucun descripteur hérité n'ouvre un service de l'hôte | Seuls fd 0-2 passent, et ce sont des tubes | T-07, `escape.feature` |
| Aucun appel interne ne contourne le DAG | Un module n'a aucun canal vers un autre : ni stdin d'autrui, ni jeton `aud` valable | T-21, T-25 |
| Pas d'accès direct à Postgres | Socket refusée, `pg` seulement dans `data` (dependency-cruiser) | E-09 |

### 11.7 La gateway elle-même sous srt ?

Non. Sous Linux l'enfant n'a pas l'espace réseau de l'hôte [V: README]. Sur macOS, un socket hérité sur fd 3 n'atteint pas l'enfant (`ENOTTY`, srt ne passe que 0-2 [V: `dist/cli.js`, `sandboxedStdio`]) et `listen` sur fd 0 est refusé (`EPERM`) [T-07]. `allowLocalBinding` ouvre tout le loopback sans proxy [T-03f]. Gateway native, donc. Le mode permission de Node (`--permission`) refuse `child_process`, les écritures et les sockets Unix [T-37], mais la doc Node ne le présente pas comme une frontière contre du code malveillant : c'est un garde-fou sans ops, à poser sur la gateway sur serveur, pas une isolation. Lecture de cette doc et mise en place [À PROUVER: T-37b, Gherkin, brique 1b].

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
5. La porte, processus parent de confiance, lance cucumber-js et Stryker **sous srt `gate-tests`** dans `work/`, réseau nul, écriture limitée à `work/` et `reports/`.
6. La porte lit les rapports comme des données non fiables.

**Ce que le code de la PR ne peut pas faire** : modifier `gate.yml`, le code de la porte, `cucumber.mjs` ou `stryker.config.json` utilisés ; ajouter un filtre ; atteindre le réseau ou un secret ; écrire dans `gate/` [À PROUVER: T-35, sentinelle, brique 1a]. **Risque résiduel, assumé et écrit** : le code de test tourne dans le processus qui écrit le NDJSON, donc une PR délibérément hostile peut forger son rapport. La porte traite l'erreur et l'affaiblissement, et rend la manipulation visible dans le diff, sans la rendre impossible. Le modèle de confiance (§11.1) couvre ce cas : contributeurs fiables d'abord, et `CODEOWNERS` sur `features/steps/` possible (O-23). Pour la même raison, `pull_request` avec séparation en deux jobs n'apporterait rien : le workflow viendrait de la PR.

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

Les portes de sortie sont des scénarios Gherkin prouvant un **mécanisme** ; les métriques v3 sont relevées, non bloquantes (D-7).

### Brique 1a : Gherkin + porte (à implémenter en premier)

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
**Test externe (I-8)** : PR sentinelles, **rouges** : step non défini ; step `pending` ; filtre `tags` ajouté ; `.feature` exclu par la config ; scénario sans step ; mutant survivant sur ligne modifiée ; assertion retirée d'un step (T-22) ; `Stryker disable all` ; `gate.yml` ou code de porte modifié sans effet (T-35) ; écriture dans `gate/` depuis un step (T-35). Et une PR saine **verte**.
**Piliers** : R : T-12, T-13, T-14c, T-14d, T-17, T-32 consignés / S : SAST = porte, O-1 appliquée / O : `contents: read`, sans secret, tests sous srt.

### Brique 1b : srt, broker, topologie

| Étape | Contenu | Fichiers |
|---|---|---|
| 1b.0 | **Banc Linux d'abord** : `gate-linux` lance `features/sandbox/` avant tout le reste, sur `ubuntu-24.04` avec sysctl. Rejoue T-02L, T-03L, T-06L, T-07L, E-01L, E-02L, E-04L, E-05L, E-06L, T-23L. Si l'une échoue, la conception est revue avant 1b.1 | `features/sandbox/` |
| 1b.1 | `packages/sandbox` : argv, profil validé par schéma strict, `detached` + `kill(-pgid)` + contrôle, `child.stdin.on('error')`, `maxBufferSize` ; partie pure en processus | `packages/sandbox/`, `sandboxes/profiles/` |
| 1b.2 | `modules/broker` : listener par task, `POST /v1/messages*`, retrait de la clé en réponse, réservation et réconciliation ; T-23b | `modules/broker/` |
| 1b.3 | `data` en MCP généré depuis `DATA_OPS` ; `budget.*`, `capacity.*` ; T-33, T-20, T-27 | `data/`, `data/sql/`, migration `0005` |
| 1b.4 | Gateway : lit `topology/modules.mcp.json`, lance en stdio, reconnexion bornée, émet les jetons ; modules vérifient ; T-29, T-30 | `gateway/`, `topology/`, `packages/contracts` |
| 1b.5 | Memory : `query()` + `spawnClaudeCodeProcess` ; `agents/*.md` chargés par `agents` ; suppression de `worker/main.ts`, `run-worker.ts`, `internal-tools.ts`, `internal-http.ts`, `docker-runner.ts` | `services/memory/`, `agents/` |
| 1b.6 | Suppression de `compose.yaml`, `Dockerfile`, `.dockerignore`, image worker ; `proxy/` → `deploy/edge/` ; docs à jour ; Postgres natif documenté | racine, `docs/` |
| 1b.7 | Suite d'évasion et invariants I-1 à I-7 | `features/sandbox/` |

**Porte de sortie** : Linux et macOS verts sur : `recall` e2e à travers un vrai `srt` avec faux amont local ; §11.4 ; I-1 à I-7 ; schéma strict qui refuse `strictAllowlistt`, `allowAllUnixSockets`, `enableWeakerNestedSandbox`.
**Test externe** : T-04R avec une vraie clé, sur requêtes invalides, décision du propriétaire avant lancement ; `features/sandbox/escape.feature` sur les deux OS.
**Piliers** : R : T-xx et E-xx rejoués, `npm run bench:sandbox` en une commande / S : DAST = suite d'évasion, STRIDE §11.3 relu / O : aucun secret en sandbox, broker seul détenteur.

### Suite

| # | Brique | Contenu | Porte de sortie | Test externe | Piliers (R / S / O) |
|---|---|---|---|---|---|
| 0 | Baseline | Reportée (D-7) | sans objet | sans objet | R : prévu à la date du propriétaire / S, O : sans objet, aucune donnée ni code |
| 1c | Marketplace + stage 0 + supply chain | Marketplace, plugins, `stage0@0.1.0`, SBOM, workflows Claude en OIDC, `--bare` | `claude plugin validate . --strict` = 0 ; installation dans un `HOME` jetable ; validation par reconstruction puis porte verte ; zéro clé statique | Run `gate.yml` vert ; `gh secret list` sans clé | R : T-11b, T-18 / S : SBOM, épinglage / O : fédération |
| 2 | Catalogue + registre + recall | Mode catalogue, registre par `data`, profil `ci-review`, `memory-recall` en `workflow`, annotations | Résultat au-delà de `max_result_tokens` = résumé + handle ; appel hors profil refusé et journalisé ; `recall` sans modèle ; T-25 | `claude-review.yml` sur une PR réelle | R : mesures journalisées / S : jetons d'appel, DAG / O : registre append-only |
| 3 | Front de code + executor | `search`/`describe`/`execute`, modules importables, pool d'executors | Script limité à son profil ; réseau refusé ; mort de session = mort de l'executor | `claude-review` sur les méta-tools | R : T-10 relevé sur Linux / S : évasion étendue / O : réseau nul |
| 4 | Scission Cortex | `memory-write`, `memory-consolidate`, un écrivain par table | Écriture hors `writes_tables` refusée au chargement | Revue sur `cortex` | R : BM25 une extension à la fois (O-11) / S : écrivain unique / O : IRB ici si données personnelles, sans objet sinon |
| 5 | Code + tasks | `code-index`, `verify`, `codebase-ask` ; scout, builder, zetetic-reviewer ; brief, feature list JSON pour les tâches longues (§16) | Citation invalide rejetée ; builder confiné à sa copie | `claude-review` appelle `verify` | R : part validé/gradé relevée / S : évasion sur les trois profils / O : copie jetable |
| 6 | Spec | `spec-draft`, `spec-lint` | Spec sans critère rejetée | `issue-to-spec.yml` | R : sans objet, outillage de 1a / S : profil agent-worker / O : sans objet |
| 7 | Mission Control | Onglet sur le registre | Tokens par couche visibles | Task réelle de la brique 5 | R : sans objet, lecture du registre / S : authentifié par la gateway / O : lecture seule |
| 8 | Modèles + web-scout | Structurer, Judge, web-scout | Quarantaine seule ; adresse privée refusée | M1/M2 relevés | R : une variable à la fois / S : `deniedResolvedAddresses` / O : Judge local si Jev non confirmé |
| D | Déploiement serveur | `deploy/`, utilisateurs dédiés, TLS, `systemd-run` | T-26, T-31, T-09L ; **multi-utilisateur seulement après §11.4** | Machine d'essai | R : T-26, T-31 / S : STRIDE relu / O : RBAC, Zero Trust |

## 16. Conformité aux pratiques Anthropic

Pages lues ; seuls les écarts et les points qui contraignent la conception sont listés.

| Source | Ce qu'elle demande | Conception | Écart et traitement |
|---|---|---|---|
| [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Le plus simple qui marche ; workflow pour le bien défini, agent pour l'ouvert ; réduire les couches ; tester en sandbox | D-4 ; `recall` sans LLM ; `platformd` et JSON lines supprimés | **Écart justifié** : l'article conseille de partir de l'API directe, on part de l'Agent SDK, par directive du propriétaire (suivre l'amont) et parce que le SDK fournit boucle, outils et sortie structurée [E-04] |
| [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | Serveurs présentés comme API de code, divulgation progressive, filtrage dans l'environnement ; **sandbox, limites de ressources, supervision** obligatoires, coût à peser | Méta-tools, executor réseau nul | **Corrigé** : limites sur Linux ; **écart macOS justifié** : T-09, §11.1. **Corrigé** : `describe` fusionnable, O-21. État persistant et skills de l'executor : reportés après la brique 3, à mesurer |
| [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents) | Peu d'outils, pas d'enveloppe d'API, espaces de noms, signal fort, `response_format`, pagination, erreurs actionnables, annotations, évaluation sur tâches réelles | `recall`/`remember`, trois méta-tools | **Corrigé** : `annotations` et `response_format` au manifeste (§10) ; erreurs `Result.error` à rendre actionnables en 2. **Écart** : tools de `data` en MCP sont des vues d'opérations, mais réservés aux modules, jamais exposés au modèle. **Écart justifié** : évaluation reportée avec la baseline (D-7), risque : choix d'outils non mesurés |
| [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Contexte fini, récupération à la demande, compaction, notes, sous-agents résumant | `memory.recall` ≤ 600, handle, `max_result_tokens` | Conforme. **Corrigé** : `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CONFIG_DIR` par task |
| [Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Progrès incrémental, fichier de progression, liste de fonctionnalités en JSON, interdiction de retirer des tests, e2e avant de marquer réussi | Porte `attendu`, Gherkin e2e | Conforme côté CI : le retrait de test est visible dans le diff. **Corrigé** : brief du builder (brique 5) avec feature list JSON et une fonctionnalité à la fois. `init.sh` remplacé par `npm run gate` (TypeScript), écart volontaire |
| [Best practices Claude Code](https://code.claude.com/docs/en/best-practices) | `CLAUDE.md` court, contrôle pass/fail, hooks pour l'absolu, revue contre spec, `--bare` en script | `CLAUDE.md` 107 lignes ; porte = contrôle | **Corrigé** : `--bare` en CI (1c). Écart justifié : la règle absolue vit dans la porte, pas dans un hook client |
| [Plugins](https://code.claude.com/docs/en/plugins-reference) | Layout, `settings.json` limité, `userConfig`, validation | §8 | **Corrigé** : `description`, `author`, `alwaysLoad` ; profils hors plugin [E-08] |
| [Agent SDK, déploiement](https://code.claude.com/docs/en/agent-sdk/secure-deployment), [hosting](https://code.claude.com/docs/en/agent-sdk/hosting) | Proxy d'injection, isolation par technologie, ressources par agent, pas de timeout de session | Broker, §11.1 ; timeout tenu par `packages/sandbox`, `maxTurns` | **Corrigé** : la conception précédente (`mask`) s'en écartait. Écart justifié : `spawnClaudeCodeProcess` non documenté en page, déclaré en `.d.ts`, prouvé [E-04], surveillé |
| [Agent SDK, coûts](https://code.claude.com/docs/en/agent-sdk/cost-tracking) | `total_cost_usd` estimation | §4.5 | **Corrigé** |
| [Sandboxing](https://code.claude.com/docs/en/sandboxing) | Sandbox intégré : Bash seulement ; processus entier : srt, conteneur, VM | Processus entier sous srt | Conforme |
| [GitHub Actions](https://code.claude.com/docs/en/github-actions) | `claude_args`, plugins, OIDC, droits d'écriture requis | §8, §13 | Conforme. `pull_request_target` et injection de prompt : aucune mention dans cette page, renvoi à `docs/security.md` de l'action, à lire en 1a |

Pages signalées et non lues à ce stade, à lire en brique 1b : `sandbox-environments`, `agent-sdk/typescript`, `agent-sdk/tool-search`, `plugins/security`.

## 17. Décisions ouvertes (chacune avec recommandation)

| # | Question | Recommandation |
|---|---|---|
| O-4 | Hébergement de stage 0 | GitHub Packages ; repli `npm pack` en asset de release |
| O-5 | CLI `srt` ou bibliothèque `SandboxManager` | CLI par processus : isolation par task par construction ; la bibliothèque garde une configuration par processus [V: README, « attribution, not a boundary »] |
| O-6 | `data` sous srt | Non : exigerait d'ouvrir le socket Postgres |
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
| O-20 | Remplacer le superviseur de D-1 par une bibliothèque, `platformd` disparaît | **Oui.** Alternative : `platformd` réduit au lancement, sans clé, seulement s'il faut un redémarrage portable macOS/Linux sans systemd |
| O-18bis | Broker dédié, seul détenteur de la clé, à la place du masquage srt | **Oui.** Alternative : broker dans le module `kind: agent`, un processus de moins, mais la clé cohabite avec les handlers |
| O-21 | Fusionner `describe` dans `search(detail: name\|summary\|schema)`, comme le propose l'article | **Oui**, deux méta-tools au lieu de trois. Touche la formulation de D-3 |
| O-22 | Multi-utilisateur : srt seul, ou gVisor/VM | **Bloqué aujourd'hui.** Après §11.4 : srt pour utilisateurs fiables, gVisor ou VM pour contenu hostile, conformément à la doc |
| O-23 | `CODEOWNERS` sur `features/steps/` et `gate.yml` contre la forgerie de rapport | **Oui**, résidu §13.8 |
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
| C-6 | `CLAUDE.md` « Agent SDK only in `services/*/worker` » vs topologie | Règle dependency-cruiser étendue aux modules `kind: agent` |
| C-7 | `CLAUDE.md` gateway « Nothing else » vs D-3 | Mettre `CLAUDE.md` à jour ; résumé + handle déterministe, tout résumé par modèle dans un module |
| C-8 | v3 « identique laptop et serveur » vs srt | Porte sur les deux OS |
| C-9 | v3 `agent-approval-check` requis vs D-6 | O-9 |
| C-10 | `CLAUDE.md` « versions exactes » vs `.nvmrc` = `26` | `.nvmrc` exact |
| C-11 | D-6 (tests seuls) vs D-6c (équivalents en revue) | La porte juge la forme, la revue l'équivalence, non bloquante sauf protection de branche |
| C-12 | `CLAUDE.md` « Adding a brick » (vitest) vs D-6a | Réécrit en 1a |
| C-13 | v3 executor « aucune clé » et « modèle dimensionné » | Executor sans modèle |
| C-14 | v3 « workflow depuis la branche par défaut » | O-1, décidée |
| C-15 | D-1 « superviseur » vs directive du propriétaire de rester au plus près des briques | O-20 |
| C-16 | Document précédent : `injectHosts` avec port, `@cucumber/cucumber` 13.3.0, « 95 appels », `NoCoverage` en sous-processus | Corrigés, T-04, T-14, T-17, T-14b |

### 18.1 Revue adversariale externe : vérification

| # | Constat | Vérification | Intégration |
|---|---|---|---|
| 1 | Frontière srt, multi-utilisateur bloqué | **Exact.** Le document précédent listait les limites mais n'écrivait aucun modèle de confiance | §11.1, §11.4 |
| 2 | T-04 bloquant, adversarial, alternative | **Exact, et T-04 échoue** | §11.2, I-3 |
| 3 | `platformd` concentre les risques | **Exact**, clé + relais + socket | Supprimé, §4.6, O-20 |
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
| T-10 | Latence srt | **Fait macOS : 211 ms** | Linux en brique 3 |
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
| E-01 à E-09 | Voir §20 | **Fait macOS** | E-xxL, `gate-linux`, 1b.0 |

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

**E-04, Agent SDK sous srt, faux amont.** `node --import tsx e04/host.ts`, `spawnClaudeCodeProcess` + `mask`.
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
