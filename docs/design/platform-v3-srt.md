# Plateforme v3 sous sandbox-runtime (srt) : document de conception

Statut : proposition, 30 octobre 2026. Aucun code applicatif n'est modifié par ce document.

Nom : `ai-architect.tools` reste la marque ; `architect-os` est le nom de cette solution agentic (dépôt, scope npm `@architect-os/*`, marketplace).
Base : `main` = `fbf100a`. Cible : la vision « ai-architect.tools, architecture plateforme v3 » (29 octobre 2026), ci-après **v3**, amendée par les décisions du propriétaire (cdeust) listées en §1.

Conventions de preuve, appliquées à chaque affirmation technique :

- **[V: source]** : vérifié en source primaire, lecture seule (README npm de la version épinglée, documentation officielle, code source du dépôt amont, ou fichier du présent dépôt).
- **[NV: T-xx]** : non vérifié ; le test T-xx du §17 le prouvera ou l'infirmera. Rien de ce qui est marqué NV ne doit être implémenté avant que son test ait tourné.
- Versions relevées le 30 octobre 2026 par `npm view` (lecture seule). Aucun paquet n'a été installé ni exécuté pour ce document : `node_modules` est absent du worktree et aucun test n'a été lancé.

---

## 1. Décisions du propriétaire appliquées (non rediscutées)

| # | Décision | Où elle s'applique ici |
|---|---|---|
| D-1 | Tout ce qui était conteneur Docker devient un processus sandboxé par `@anthropic-ai/sandbox-runtime` 0.0.81 : executor de session (pool chaud), sandboxes de task (scout, builder, zetetic-reviewer), workers `kind: agent` ; l'orchestrateur de conteneurs devient un superviseur de processus srt. | §2, §3, §7, §9 |
| D-2 | `architect-os` est à la fois le dépôt `platform` et la marketplace Claude Code (`.claude-plugin/marketplace.json` à la racine, plugins sous `plugins/<nom>/`), qui contient le plugin déclarant le MCP d'entrée vers la gateway. | §5, §6 |
| D-3 | La gateway reste séparée (auth, profils, DAG, budgets, jetons de task, `max_result_tokens`, registre, méta-tools search/describe/execute). Les couches restent des processus séparés. | §3, §10 |
| D-4 | Par tool : `kind: workflow` dès que le comportement est stable ; `kind: agent` (Agent SDK) sinon, toujours sous srt. | §8 |
| D-5 | Postgres 17 conservé (BM25, `float[]`, pgvector installé mais désactivé), en processus natif. | §3, §4, §15 |
| D-6 | La porte de merge est uniquement le résultat des tests ; attendu = base + ajoutés − supprimés, dérivé du diff ; exécuté = attendu ; tout vert ; aucune comparaison de digest/hash ; le point fixe devient « vN+1 construite par stage 0, puis par elle-même, puis la même porte » ; stage 0 = artefact versionné épinglé. | §12, §13 |
| D-6a | Seuls des tests Gherkin (Feature / Scenario, Given / When / Then) prouvent qu'une CI passe ; preuve = chaque step vert ; vaut pour l'e2e de non-régression et pour l'unitaire. | §12 |
| D-6b | Trois familles font foi et doivent toutes être vertes : e2e Gherkin, unitaires Gherkin, mutation testing. | §12 |
| D-6c | Mutation testing vert = 0 mutant survivant sur le code modifié par la PR ; seuls les mutants équivalents explicitement marqués (commentaire Stryker de désactivation avec justification) sont tolérés. | §12.6 |
| D-7 | Brique 0 (baseline M1/M2) reportée ; métriques et seuils v3 définis mais non bloquants jusqu'à la mesure du propriétaire. | §14 |

## 2. Trois piliers (standard d'ingénierie du founder)

| Pilier | Statut dans ce document |
|---|---|
| I. Recherche reproductible | **Prévu**, brique 0 (reportée par D-7) pour la baseline ; **fait** ici pour l'état de l'art outillage (srt, plugins, Gherkin, Stryker) avec sources ; **prévu** brique 1a pour la reproductibilité « une commande » (`npm run gate` rejoue la porte localement). Journal d'expérimentation : chaque test T-xx du §17 est une expérience à une variable, consignée dans `decisions/`. |
| II. SSDLC | **Fait** ici : STRIDE (§10), supply chain (§11). **Prévu** brique 1a : SAST = porte Gherkin + mutation (D-6b) ; brique 1b : DAST = suite d'évasion srt exécutée contre les sandboxes réelles (§10.3). |
| III. Opérationnel (Zero Trust) | **Fait** ici : moindre privilège par profil srt (§7), secrets hors sandbox (§3.3). **Prévu** brique 1b (utilisateurs OS dédiés, sockets Unix en zone). **Sans objet** pour l'IRB : aucune donnée humaine ou stratégique n'est traitée par le squelette ; à réévaluer si memory reçoit des données personnelles (brique 4). |

## 3. Écarts vs v3

| Élément v3 | Version srt | Raison |
|---|---|---|
| `compose.yaml` « identique laptop et serveur » | `topology/processes.yaml` lu par le superviseur `platformd` ; mêmes processus sur laptop et serveur, mais **pas identiques à l'octet** : Seatbelt (macOS) et bubblewrap (Linux) n'ont pas les mêmes sémantiques (globs, loopback, sockets Unix) | D-1. [V: README srt 0.0.81, « Path Syntax (macOS) / (Linux) », tableau « Unix Socket Settings »] |
| [1] Reverse proxy (conteneur Caddy) | Edge natif hors srt, uniquement sur serveur (TLS) ; sur laptop la gateway écoute `127.0.0.1` | srt est un bac à sable de sortie : il ne fournit pas de point d'entrée réseau. Sous Linux le processus sandboxé n'a plus l'espace réseau de l'hôte. [V: README srt, « Linux: … The network namespace of the sandboxed process is removed entirely »] |
| [2] Gateway « un seul binaire » en conteneur | Processus natif durci (utilisateur OS dédié), **non** sandboxé par srt | Doit accepter des connexions entrantes ; voir §10.4 |
| [3] Executor de session, pool chaud, image | Processus `node` lancé par `srt --settings executor.json`, réseau **nul**, appels de modules relayés par stdio vers le superviseur | D-1 ; et le loopback de l'hôte n'est pas joignable sans proxy sous Linux [V: README srt ; source `sandbox-utils.ts`, `NO_PROXY=localhost,127.0.0.1,::1,…`] |
| Conteneurs de task (images scout/builder/zetetic-reviewer) | Profils srt `sandboxes/profiles/{scout,builder,zetetic-reviewer}.json`, un processus `srt` par task | D-1 |
| Orchestrateur de conteneurs « clés API injectées par task » | Superviseur `platformd` ; la clé Anthropic reste dans l'environnement du processus `srt` (hors bac à sable) et est **masquée** pour l'enfant : srt substitue la valeur réelle en sortie vers `api.anthropic.com` seulement | `credentials.envVars[].mode: "mask"` + `injectHosts` [V: README srt 0.0.81, option `credentials`] ; exige `network.tlsTerminate` (expérimental) [NV: T-04] |
| « Jeton par task, scope = allowlist, révoqué à l'annulation » | Jeton émis par la gateway (inchangé) **et**, pour le réseau, un fichier de settings srt par task (une invocation CLI par task) | `registerCommandNetworkLists` existe mais ne sépare pas deux commandes concurrentes d'un même processus : « this is attribution, not a boundary » [V: README srt]. `SandboxManager` garde une configuration par processus [V: source `sandbox-manager.ts`, variables de module] |
| Limites `--memory`, `--pids-limit` des conteneurs | Limites OS posées par le superviseur autour de `srt` (Linux : `systemd-run --scope` ou `prlimit` ; macOS : rlimits) | srt ne documente aucune limite CPU/mémoire/PID [V: liste complète des clés de configuration, `sandbox-config.ts`] ; mécanisme exact [NV: T-09] |
| `memory-recall` : data tool sans LLM | Inchangé ; le `recall` actuel (worker Agent SDK) devient `kind: workflow` | D-4 ; le dépôt actuel en fait un agent (`services/memory/worker/prompts/recall.md`) |
| Postgres 17 en conteneur, pgvector actif au départ ? (v3 : « installé mais désactivé ») | Postgres 17 natif, écoute **socket Unix seulement** (`listen_addresses = ''`), accessible au seul utilisateur OS de `data` | D-5. Le pilote `pg` ne passe ni par `HTTP_PROXY` ni par SOCKS : `data` ne peut pas être sous srt sans variante socket Unix [NV: T-08] |
| Plugins dans leurs dépôts + dépôt `marketplace` séparé | Marketplace à la racine d'`architect-os`, plugins clients sous `plugins/<nom>/`, modules serveur sous `modules/<nom>/` | D-2 ; séparation client/serveur : §15 O-10 |
| Manifeste `containers:` | `sandboxes:` (profil srt, lectures/écritures, egress, modèle, budget) | D-1 ; §8 |
| `stage0/Dockerfile`, image `ghcr.io/cdeust/stage0:current`, `fixpoint.sh` « digests comparés » | Paquet npm `@architect-os/stage0` version exacte, épinglé ; vN+1 construite par stage 0, puis par elle-même, puis la porte de tests | D-6 ; §13 |
| CI : `platform-build.yml` dans le conteneur stage 0 | `gate.yml` : porte Gherkin (e2e + unitaire) + mutation, sur Linux **et** macOS | D-6, D-6a, D-6b ; §12 |
| `agent-approval-check` en check obligatoire ; `spec-lint` check obligatoire | Plus de check obligatoire autre que la porte de tests ; `spec-lint` devient un scénario Gherkin de la porte | D-6 ; contradiction listée §16 |
| Runner auto-hébergé « n'a pas Docker exposé » | Runner auto-hébergé pour les workflows Claude uniquement ; la porte tourne sur runners GitHub hébergés | §12.8 |
| Baseline brique 0 bloquante, porte brique 3 sur M1 | Reportée ; aucun seuil v3 bloquant (D-7) ; les portes de briques sont des scénarios Gherkin de **mécanisme** | §14 |

## 4. Topologie srt

### 4.1 Figure

```
                         client (Claude Code / Codex / claude-code-action)
                                   |  HTTPS (serveur) ou HTTP 127.0.0.1 (laptop)
                                   v
  ---------------------- hôte, processus NATIFS (hors srt) -----------------------------
  [edge]     serveur seulement ; TLS ; /mcp -> gateway ; /app -> dashboard
             secrets : clé privée TLS
  [gateway]  utilisateur OS agentic-gw ; écoute 127.0.0.1:8080
             auth, profils, DAG, budgets, jetons de task, max_result_tokens, registre
             secrets : clé de signature des jetons de task, table des clients
             réseau sortant : 127.0.0.1 (modules, data, platformd) seulement
  [platformd] superviseur ; utilisateur agentic-sup ; socket Unix de contrôle 0600
             lance les processus natifs de topology/processes.yaml et les srt
             secrets : ANTHROPIC_API_KEY (ou jeton fédéré) dans SON environnement
  [modules]  un processus par module kind: data|workflow (memory-recall, code-index, …)
             écoute 127.0.0.1:<port> ; exige l'en-tête de jeton de task émis par la gateway
  [data]     seul importeur de `pg` ; utilisateur agentic-data
             -> /run/agentic/pg/.s.PGSQL.5432 (socket Unix, 0700 agentic-data)
  [postgres 17]  listen_addresses='' ; pg_hba : local peer agentic-data uniquement
  ----------------------------------------------------------------------------------
        | stdin/stdout (JSON lines), un tube par processus sandboxé
        v
  ---------------------- processus SOUS srt (lancés par platformd) -----------------
  srt --settings executor.json -- node executor.js        (pool chaud, 1 par session)
     réseau : AUCUN (allowedDomains: [], strictAllowlist: true)
     lecture : runtime Node + dist de l'executor + "." (répertoire de session) ; ~ refusé
     écriture : "." (répertoire de session) ; secrets : aucun
  srt --settings scout.json -- node task.js               (1 par task)
     réseau : api.anthropic.com:443 seul ; TLS terminé par le proxy srt
     lecture : repo en lecture seule + "." ; écriture : "." (scratch)
     secret : ANTHROPIC_API_KEY MASQUÉE (sentinelle dans l'enfant, vraie valeur dans srt)
  srt --settings builder.json -- node task.js
     réseau : api.anthropic.com:443 ; écriture : copie de travail de la task uniquement
  srt --settings zetetic-reviewer.json -- node task.js
     réseau : api.anthropic.com:443 ; lecture seule du repo + diff ; écriture : "."
  srt --settings agent-worker.json -- node worker.js      (modules kind: agent)
     réseau : api.anthropic.com:443 ; outils internes par stdio ; aucun accès data/postgres
  srt --settings web-scout.json -- node web-scout.js      (seul egress large)
     réseau : allowlist du manifeste ; écrit en quarantaine via stdio -> data
  ----------------------------------------------------------------------------------
  Proxys srt : un couple HTTP/SOCKS par processus `srt` (hors bac à sable, côté hôte)
```

### 4.2 Qui détient quel secret

| Secret | Détenteur | Jamais présent dans |
|---|---|---|
| Clé TLS du serveur | edge | gateway, sandboxes |
| Clé de signature des jetons de task, table des clients (remplace `GATEWAY_TOKENS`) | gateway | modules, sandboxes |
| Clé Anthropic (runtime) | `platformd` → environnement du processus `srt` → proxy srt | enfant sandboxé : il voit une sentinelle [V: README srt `mode: "mask"`] ; substitution réelle [NV: T-04] |
| Identifiants Postgres | aucun mot de passe : authentification `peer` sur socket Unix | gateway, modules, sandboxes |
| CI : jeton client gateway `GATEWAY_CI_TOKEN` | secret GitHub du workflow Claude (v3 §7.2, inchangé) | porte de tests |
| CI : accès Anthropic | fédération OIDC (`anthropic_federation_rule_id`, `anthropic_organization_id`, `anthropic_service_account_id`, `id-token: write`) [V: `claude-code-action` `action.yml` et `docs/setup.md`] | dépôt (identifiants non secrets) |

### 4.3 Protocole superviseur ↔ processus sandboxé

Le dépôt actuel passe déjà l'entrée du worker sur stdin et lit sa sortie sur stdout (`services/memory/worker/main.ts`, `run-worker.ts`). Le protocole devient bidirectionnel, en lignes JSON, validé par des schémas zod de `packages/contracts` :

```
superviseur -> sandbox : {"t":"start","run_id","tool","input","limits"}
sandbox -> superviseur : {"t":"call","id","target":"memory.search","args"}
superviseur -> sandbox : {"t":"result","id","ok":true,"value"} | {"t":"result","id","ok":false,"code","message"}
sandbox -> superviseur : {"t":"output", …WorkerOutput}            (dernier message)
stderr                 : journaux, jamais interprétés
```

- Chaque `call` est relayé par `platformd` à la gateway (endpoint interne, jeton de task) : la gateway reste le seul point de politique (DAG `calls_allowed`, budgets, `max_result_tokens`).
- Pourquoi stdio et pas HTTP vers `127.0.0.1:8083` (`HttpInternalTools` actuel) : sous Linux l'enfant a son propre espace réseau, son loopback n'est pas celui de l'hôte [V: README srt] ; de plus srt pose `NO_PROXY=localhost,127.0.0.1,::1,…` dans l'enfant [V: source `sandbox-utils.ts` sur `main` amont ; applicabilité par OS et en 0.0.81 à confirmer par T-03, le README décrivant un comportement différent sous Windows], donc un client qui respecte `NO_PROXY` vise le loopback **du bac à sable** sous Linux, vide. Passer par le proxy exigerait d'effacer `NO_PROXY`, de poser `NODE_USE_ENV_PROXY=1` (srt ne le pose que sous Windows [V: README srt]) et d'autoriser `127.0.0.1:<port>` [NV: T-03]. Stdio n'ouvre aucun réseau.
- Passage stdio sous `srt` CLI : l'enfant est lancé avec `stdio` hérité (fd 0–2) [V: source `cli.ts`, `sandboxedStdio`] ; donc les tubes de `platformd` atteignent l'enfant.
- Code de sortie : propagé, **sauf** SIGINT/SIGTERM de l'enfant → `srt` sort avec 0 [V: source `cli.ts`, `child.on('exit')`]. `platformd` tient donc lui-même le registre des timeouts qu'il a déclenchés ; mise à mort de l'arbre complet [NV: T-06].

## 5. Correspondance avec le squelette actuel

| Actuel (`fbf100a`) | Devient | Statut |
|---|---|---|
| `compose.yaml` | `topology/processes.yaml` (processus natifs, utilisateurs OS, sockets) + `sandboxes/profiles/*.json` (srt) | **supprimé**, remplacé |
| `Dockerfile` (racine) | Aucun : les processus natifs tournent depuis `dist/` construit par stage 0 (§13) | **supprimé** |
| `.dockerignore` | — | **supprimé** |
| `proxy/Caddyfile` | `topology/edge/Caddyfile`, Caddy natif sur serveur seulement (O-7) | **supprimé** comme conteneur ; configuration déplacée |
| `services/memory/worker/Dockerfile` (image memory-worker) | `sandboxes/profiles/agent-worker.json` + entrée `node services/memory/dist/worker/main.js` lancée par `srt` | **supprimé**, remplacé |
| `test/infra/compose.test.ts` | `features/infra/topology.feature` (zones = sockets/utilisateurs/ports ; schéma strict des profils srt) + `features/sandbox/escape.feature` (évasions réelles sous srt, Linux et macOS) | **supprimé**, remplacé |
| `.env.example` (`GATEWAY_TOKENS`, `POSTGRES_PASSWORD`, `BROKER_URL`) | `topology/env.example` sans mot de passe Postgres (auth `peer`), sans `BROKER_URL` (masquage srt) | **renommé**, réduit |
| `services/memory/src/infrastructure/docker-runner.ts` (`DockerContainerRunner`) | `SrtSandboxRunner` (même port, construit l'argv `srt --settings <profil> -- node …`, tubes JSON lines) | **supprimé**, remplacé |
| `services/memory/src/infrastructure/in-process-runner.ts` (`InProcessContainerRunner`) | conservé (adaptateur en mémoire du port), indispensable au mutation testing (§12.6) | **gardé** |
| port `ContainerRunner` (`services/memory/src/domain/ports.ts`) | `SandboxRunner` : `run(request, onCall)` ; le contrat ajoute les messages `call/result` | **renommé**, étendu |
| `services/memory/test/contracts/container-runner.ts` | `features/contracts/sandbox-runner.feature` (Scenario Outline sur les adaptateurs) | **migré** |
| `services/memory/worker/internal-tools.ts` (`HttpInternalTools`) | `StdioInternalTools` | **remplacé** |
| `services/memory/worker/sdk-agent.ts` | conservé ; `env` reçoit la sentinelle masquée | **gardé** |
| `services/memory/worker/prompts/recall.md` | supprimé quand `recall` passe `kind: workflow` (brique 2) | **supprimé** (brique 2) |
| `gateway/` | conservé ; ajouts v3 : `src/{profiles,codefront,policy,tasks,registry}` | **gardé**, étendu |
| `data/` | conservé ; `operations.json` gagne `owner` ; refus au chargement d'une opération qui écrit une table hors du `writes_tables` de son propriétaire | **gardé**, étendu |
| `data/migrations/0002_memory.sql` (pgvector actif, HNSW) | nouvelle migration `0004` : colonne `float4[]`, suppression de l'index HNSW et de l'extension (D-5) | **nouveau** (on n'édite jamais une migration appliquée) |
| `packages/contracts` | conservé ; + schémas du protocole stdio, du manifeste de module, des profils srt | **gardé**, étendu |
| `.dependency-cruiser.cjs` | règle `agent-sdk-only-in-worker` → « seulement sous `sandboxes/` et `services/*/worker` » ; nouvelle règle : `@anthropic-ai/sandbox-runtime` seulement dans `platformd/src/infrastructure` | **gardé**, modifié |
| `test/arch/guard.test.ts` | `features/arch/guard.feature` | **migré** |
| tous les `*.test.ts` vitest (95 appels `it`/`test` statiques dans 22 fichiers) | `.feature` + steps cucumber-js (§12.9) | **migrés** (brique 1a) |
| `vitest`, `vitest.config.ts` | retirés (O-14) ; `@cucumber/cucumber`, `@stryker-mutator/*`, `tsx` ajoutés | **supprimé** |
| `.github/workflows/ci.yml` (`npm run check`) | `.github/workflows/gate.yml` (§12.8) | **remplacé** |
| `.github/workflows/claude.yml`, `claude-code-review.yml` (exemples, jeton OAuth statique) | `claude-mention.yml`, `claude-review.yml` de v3 §7, fédération OIDC, `--mcp-config` gateway | **remplacés** |
| `.claude/agents/*`, `.claude/commands/review-pr.md`, `.claude/settings.json` | conservés (protégés en écriture par srt dans les sandboxes : `.claude/agents`, `.claude/commands` [V: source `sandbox-utils.ts`, `getDangerousDirectories`]) | **gardés** |
| — | `.claude-plugin/marketplace.json`, `plugins/agentic-gateway/`, `plugins/ai-architect-standards/` | **nouveau** |
| — | `platformd/` (superviseur), `sandboxes/` (executor, task runtime, profils), `modules/`, `stage0/`, `tools/{build,test-gate}/`, `features/`, `decisions/` | **nouveau** |
| `.nvmrc` = `26` | `.nvmrc` = version exacte (ex. `26.11.1`, celle relevée localement) | **modifié** : contradiction avec « versions exactes » (§16) |

## 6. Arborescence cible

```
architect-os/
├── .claude-plugin/marketplace.json        # D-2
├── plugins/
│   ├── agentic-gateway/                   # plugin d'entrée : MCP http -> gateway
│   │   └── .claude-plugin/plugin.json
│   └── ai-architect-standards/            # standards (skills/agents) utilisés en CI (v3 §7.2)
├── CLAUDE.md
├── topology/
│   ├── processes.yaml                     # processus natifs, utilisateurs OS, sockets, ports
│   ├── env.example
│   └── edge/Caddyfile                     # serveur seulement (O-7)
├── platformd/                             # superviseur srt (domain/application/infrastructure/presentation)
├── gateway/                               # + src/{auth,profiles,codefront,catalog,policy,tasks,registry}
├── sandboxes/
│   ├── profiles/                          # gabarits srt par profil (§7) + schéma strict
│   ├── executor/                          # runtime de l'executor (exécute le script, relaie les calls)
│   └── task/                              # runtime Agent SDK des tasks scout/builder/zetetic-reviewer
├── modules/
│   ├── manifest.schema.json               # §8
│   ├── manifest-registry/
│   ├── db-migrator/
│   └── web-scout/
├── services/memory/                       # worker existant, devient kind: agent puis split (brique 4)
├── data/                                  # seul importeur de pg ; sql/, migrations/
├── packages/contracts/
├── stage0/                                # package.json + lockfile épinglant @architect-os/stage0 (§13)
├── tools/
│   ├── build/                             # build de la plateforme (tsc -b, génération modules/catalogue/profils)
│   └── test-gate/                         # calcul attendu/exécuté, lecture NDJSON et rapport Stryker (§12)
├── features/                              # e2e Gherkin + steps
│   ├── e2e/  infra/  sandbox/  arch/  descriptive/  contracts/
│   └── steps/
├── <composant>/features/                  # unitaires Gherkin par composant (+ steps)
├── stryker.config.json
├── cucumber.mjs                           # configuration figée (§12.4)
├── baseline/{tasks,results}/              # brique 0, reportée
└── decisions/                             # journal d'expérimentation et décisions (format wiki)
```

## 7. Marketplace et plugin d'entrée

### 7.1 `.claude-plugin/marketplace.json`

Faits appliqués : fichier à `.claude-plugin/marketplace.json` ; `name`, `owner` (avec `owner.name`), `plugins` requis ; chaque entrée exige `name` et `source` ; une source relative commence par `./` et se résout depuis la racine de la marketplace ; noms en lettres, chiffres, `.`, `_`, `-` ; clés inconnues ignorées au chargement mais signalées par `claude plugin validate` [V: code.claude.com/docs/en/plugins/marketplace-reference.md]. `architect-os` ne figure pas parmi les noms réservés [V: même page, « Reserved names »].

```json
{
  "name": "architect-os",
  "description": "Plateforme architect-os : MCP d'entrée vers la gateway et standards ai-architect.tools",
  "owner": { "name": "Clément Deust" },
  "plugins": [
    {
      "name": "agentic-gateway",
      "source": "./plugins/agentic-gateway",
      "description": "Déclare le serveur MCP d'entrée (search, describe, execute) vers la gateway architect-os",
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

Pas de `version` dans les entrées : `plugin.json` la porte et l'emporte, un doublon provoque un avertissement [V: marketplace-reference, entrée `version`] qui ferait échouer `--strict`.

### 7.2 `plugins/agentic-gateway/.claude-plugin/plugin.json`

Faits appliqués : `name` seul champ requis ; noms commençant par `claude-`/`anthropic-` refusés ; `mcpServers` inline ; serveur distant `type: "http"`, `url`, `headers` [V: code.claude.com/docs/en/mcp.md] ; substitution de `${user_config.KEY}` dans la configuration MCP, y compris pour les valeurs `sensitive` (seul le contenu des skills/agents les remplace par un marqueur) ; `userConfig` strict (`type`, `title`, `description` requis ; `sensitive` stocké dans le coffre du système) [V: manifest-reference.md, « User configuration »] ; pas de répertoire `bin/` (empêche l'installation via claude.ai et Cowork) [V: manifest-reference.md, « Standard layout »].

```json
{
  "name": "agentic-gateway",
  "displayName": "architect-os gateway",
  "version": "0.1.0",
  "description": "MCP d'entrée vers la gateway architect-os : trois méta-tools search, describe, execute",
  "author": { "name": "Clément Deust" },
  "repository": "https://github.com/cdeust/architect-os",
  "license": "MIT",
  "mcpServers": {
    "gateway": {
      "type": "http",
      "url": "${user_config.gateway_url}",
      "headers": { "Authorization": "Bearer ${user_config.gateway_token}" }
    }
  },
  "userConfig": {
    "gateway_url": {
      "type": "string",
      "title": "URL de la gateway",
      "description": "Point MCP de la gateway, par exemple http://127.0.0.1:8080/mcp sur un poste",
      "default": "http://127.0.0.1:8080/mcp",
      "required": true
    },
    "gateway_token": {
      "type": "string",
      "title": "Jeton client",
      "description": "Jeton client émis par la gateway pour votre profil",
      "sensitive": true,
      "required": true
    }
  }
}
```

- Noms de tools vus par le client : `mcp__plugin_agentic-gateway_gateway__search|describe|execute` [V: mcp.md, forme `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`]. En CI, `--mcp-config` donne `mcp__gateway__*` (v3 §7.2) : les deux formes doivent figurer dans les profils de la gateway.
- `url` avec `${user_config.gateway_url}` passe la validation [NV: T-11] (le validateur vérifie qu'une référence vise une option déclarée [V: manifest-reference, « Validate the manifest »]).
- CI : `userConfig` suppose une invite humaine ; la CI garde `--mcp-config` (v3 §7.2), `plugin_marketplaces: https://github.com/cdeust/architect-os.git`, `plugins: ai-architect-standards@architect-os` [V: `action.yml`, entrées `plugins` et `plugin_marketplaces` « newline-separated … Git URLs »].
- Validation : `claude plugin validate . --strict` à la racine valide la marketplace **et** le `plugin.json` de chaque plugin à source relative [V: create-marketplace.md, « Problems that validation reports » ; cli-reference.md : `--strict` transforme les avertissements en erreurs, codes de sortie 0/1/2]. Elle est exécutée comme scénario Gherkin (§11), pas comme check séparé (D-6).

## 8. Settings srt par profil

Faits appliqués [V: `sandbox-config.ts` sur la branche `main` amont ; README de 0.0.81 pour les mêmes clés] : `network` et `filesystem` requis ; `network.allowedDomains`/`deniedDomains` requis, suffixe `:port` admis ; `strictAllowlist` ; `filesystem.denyRead`/`allowWrite`/`denyWrite` requis, `allowRead` optionnel et prioritaire sur `denyRead` sauf `denyRead` plus spécifique ; écriture refusée par défaut ; **lecture autorisée partout par défaut** ; `credentials.envVars[]` (`name`, `mode`, `injectHosts`) ; objets non stricts : **une clé mal orthographiée est ignorée silencieusement** (seul `credentials` est strict). D'où : chaque gabarit est validé par un schéma zod **strict** propre au dépôt, en scénario Gherkin. Écart entre `main` amont et l'étiquette 0.0.81 : [NV: T-01].

Les chemins relatifs se résolvent depuis le répertoire courant [V: README, « All platforms »] : `platformd` fixe le `cwd` sur le répertoire de la session ou de la task, donc `"."` = ce répertoire. Sous Linux, `allowWrite`/`denyWrite` n'acceptent que des chemins littéraux et `denyRead` ne masque que ce qui existe au moment de l'emballage [V: README, « Path Syntax (Linux) »]. srt ne fait pas d'interpolation de variables : `platformd` rend les gabarits (`{{runtime}}`, `{{repo}}`) en fichiers absolus par task, dans un répertoire non inscriptible par les sandboxes.

### 8.1 executor

```json
{
  "network": { "allowedDomains": [], "deniedDomains": [], "strictAllowlist": true },
  "filesystem": {
    "denyRead": ["~", "{{state}}", "{{pg_socket_dir}}"],
    "allowRead": [".", "{{runtime}}", "{{executor_dist}}"],
    "allowWrite": ["."],
    "denyWrite": []
  }
}
```

### 8.2 scout (lecture seule du dépôt)

```json
{
  "network": {
    "allowedDomains": ["api.anthropic.com:443"],
    "deniedDomains": [],
    "strictAllowlist": true,
    "tlsTerminate": {}
  },
  "filesystem": {
    "denyRead": ["~", "{{state}}", "{{pg_socket_dir}}"],
    "allowRead": [".", "{{runtime}}", "{{task_dist}}", "{{repo}}"],
    "allowWrite": ["."],
    "denyWrite": []
  },
  "credentials": {
    "envVars": [
      { "name": "ANTHROPIC_API_KEY", "mode": "mask", "injectHosts": ["api.anthropic.com:443"] }
    ]
  }
}
```

### 8.3 builder

Identique à scout, sauf `allowRead` sans `{{repo}}` et `"."` = copie de travail de la task (worktree jetable créé par `platformd`). Pas d'accès registre npm (O-12) : `node_modules` pré-installé en lecture. Les écritures dans `.git/hooks`, `.git/config`, `.mcp.json`, `.claude/agents`, `.claude/commands` restent refusées par srt même dans `"."` [V: README, « Mandatory deny paths » ; source `sandbox-utils.ts`].

### 8.4 zetetic-reviewer

Identique à scout ; `allowRead` ajoute le fichier de diff de la PR fourni par `platformd`.

### 8.5 agent-worker (modules `kind: agent`, dont le worker memory actuel)

Identique à scout, sans `{{repo}}` ; outils internes par stdio uniquement.

### 8.6 web-scout

`allowedDomains` = `egress` du manifeste ; `deniedResolvedAddresses: ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16","100.64.0.0/10","fc00::/7"]` (srt ne refuse pas les plages privées par défaut [V: README, « deniedResolvedAddresses »]) ; aucune clé ; sortie en quarantaine via stdio.

### 8.7 Dépendances hôte (Linux)

`bubblewrap`, `socat`, `ripgrep` [V: README srt, « Platform-Specific Dependencies »] ; Ubuntu 24.04+ : `kernel.apparmor_restrict_unprivileged_userns=0` ou profil AppArmor dédié [V: README] (`claude-code-action` pose lui-même ce sysctl et installe bubblewrap et socat [V: `action.yml`]). Appelant non root recommandé [V: README, « Running as root »].

## 9. Manifeste de module (v3 §6 adapté)

```yaml
name: memory-recall
version: 1.2.0
domain: memory
owner: cortex
transport: http              # MCP léger sur 127.0.0.1, jeton de task exigé
tools:
  - name: recall
    description: Rappel typé, filtré en SQL, rerank par Judge
    input_schema: ./schemas/recall.in.json
    output_schema: ./schemas/recall.out.json
    kind: workflow           # data | workflow | agent (D-4 : workflow dès que stable)
    max_result_tokens: 600
    latency_budget_ms: 200
    validator: schema        # schema | verify | spec-lint | citations | none
sandboxes: []                # aucun pour data/workflow
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
    max_result_tokens: 1000
    validator: citations
sandboxes:
  - profile: scout                  # sandboxes/profiles/scout.json
    read: [repo]                    # -> filesystem.allowRead
    write: [scratch]                # -> filesystem.allowWrite ("." de la task)
    egress: [api.anthropic.com:443] # -> network.allowedDomains ; jamais plus large que le profil
    credentials: [anthropic:mask]   # -> credentials.envVars
    model_min: sonnet
    budget_tokens: 40000
    timeout_ms: 120000
    limits: { memory_mb: 512, pids: 128 }   # appliqués par platformd hors srt (§3, T-09)
writes_tables: []
reads_domains: [code, memory]
calls_allowed: [code-index, memory-recall]
```

Règles appliquées par la gateway et `tools/build` (scénarios Gherkin chacune) : tool `data`/`workflow` ⇒ `sandboxes: []` ; tool `agent` ⇒ au moins une sandbox ; `writes_tables` disjoints entre manifestes ; `calls_allowed` acyclique ; `egress` d'une sandbox ⊆ `allowedDomains` du profil ; `egress` ≠ `none` ⇒ écriture en quarantaine ; un tool `kind: agent` dont le comportement est déclaré stable (`stable: true`) est refusé (D-4 l'oblige à devenir `workflow`).

## 10. STRIDE de la topologie srt

### 10.1 Ce que srt garantit et ne garantit pas

| Garantit [V: README srt 0.0.81] | Ne garantit pas [V: README srt, « Security limitations / Known limitations »] |
|---|---|
| Écriture refusée hors `allowWrite` ; chemins dangereux toujours protégés | La **lecture** : autorisée partout par défaut ; seul `denyRead` la restreint |
| Réseau refusé hors `allowedDomains`, contrôlé par le proxy de l'hôte, vérification des adresses résolues (loopback, link-local, métadonnées cloud, adresses de l'hôte) | L'inspection du trafic : un domaine autorisé (ex. `api.anthropic.com`) reste un canal d'exfiltration ; le domain fronting peut contourner le filtre |
| Linux : pas d'espace réseau partagé, sockets Unix bloquées par seccomp, pas de user namespace imbriqué | Linux : descripteurs de socket Unix hérités ; liens physiques préexistants vers un fichier hors zone ; motifs `denyRead` sur des chemins inexistants au moment de l'emballage |
| Sentinelle à la place d'une variable `mask` | Limites CPU, mémoire, PID, disque |
| Mise à jour des listes réseau à chaud (`--control-fd`) | Le point d'entrée réseau (ingress) |
| | Une copie de srt installée dans un répertoire inscriptible par la sandbox (réécriture puis exécution non sandboxée) |
| | macOS : `enableWeakerNetworkIsolation`, `allowAppleEvents` ouvrent des évasions |

### 10.2 Tableau STRIDE

| Menace | Vecteur dans la topologie | Contrôle | Statut |
|---|---|---|---|
| **S** usurpation | Un processus local appelle un module sur `127.0.0.1` sans passer par la gateway | Jeton de task signé par la gateway exigé par chaque module ; les sandboxes n'ont aucun accès loopback (réseau nul ou proxy à allowlist) | Prévu brique 2 |
| S | Une sandbox présente l'identifiant de commande d'une autre pour hériter de ses autorisations réseau | Une invocation `srt` par task (pas de `registerCommandNetworkLists` partagé) | Choix §3 [V: README, avertissement d'attribution] |
| S | Un message `call` forge l'identité d'une autre task | `platformd` associe le tube à la task ; l'identité ne vient jamais du message | Prévu brique 1b |
| **T** falsification | Le builder modifie hooks git, `.mcp.json`, `.claude/agents` | Refus obligatoires srt [V] + travail dans une copie jetable | Prévu brique 5 |
| T | Une sandbox réécrit son profil srt ou le binaire srt | Profils rendus et `node_modules` hors `allowWrite`, propriété de l'utilisateur `agentic-sup` | Prévu brique 1b, scénario d'évasion |
| T | Une PR modifie la porte de tests pour se rendre verte | Code de la porte lu depuis la base (§12.8, O-1) | Décision ouverte O-1 |
| **R** répudiation | Une exécution nie un appel | Registre append-only ; trigger d'immuabilité existant (`0003_runs_immutable.sql`) ; chaque `call` relayé est journalisé par la gateway avec le jeton de task | Prévu brique 2 |
| **I** fuite | Lecture de `~/.ssh`, `~/.aws`, `.env`, données Postgres | `denyRead` `~`, état de la plateforme, socket Postgres ; Postgres sans TCP, socket 0700 | Prévu brique 1b ; [NV: T-02] (sémantique de `"~"` en `denyRead` sur chaque OS) |
| I | Fuite de la clé Anthropic | Masquage srt ; la vraie valeur n'existe que dans le processus `srt` | [NV: T-04] ; repli : broker natif (O-18) |
| I | Exfiltration par `api.anthropic.com` | Inhérente ; budget de tokens, journal par task | Accepté, documenté |
| **D** déni de service | Bombe fork, mémoire, disque, sandbox qui ne termine pas | Limites OS par `platformd` (T-09) ; timeout et mise à mort de l'arbre (T-06) ; quota de répertoire de task | Prévu brique 1b |
| **E** élévation | Évasion du bac à sable Linux via user namespace imbriqué | Filtre seccomp srt (refus `unshare`/`clone` user/mount, `setns`, `mount`, `pivot_root`) [V: README] ; ne jamais activer `allowNestedUserNamespaces`, `enableWeakerNestedSandbox`, `allowAllUnixSockets` sur un profil d'agent | Scénario de profil |
| E | Le sysctl AppArmor exigé par Ubuntu 24.04 affaiblit l'hôte | Préférer un profil AppArmor dédié à `bwrap` plutôt que le sysctl global sur les serveurs | O-17 |
| E | srt est un « Beta Research Preview » [V: README] | Épinglage exact 0.0.81, revue des notes de version avant toute montée | §11 |

### 10.3 Suite d'évasion (DAST)

`features/sandbox/escape.feature`, exécutée sous Linux et macOS par la porte, contre de vrais processus `srt` avec chaque profil : lire un faux `~/.ssh/id_test` ; écrire hors `"."` ; écrire `.git/hooks/pre-commit` ; joindre `example.com` ; joindre `127.0.0.1:<port de data>` ; joindre `169.254.169.254` ; lire la valeur de `ANTHROPIC_API_KEY` (doit être la sentinelle) ; créer un socket Unix ; `unshare -r`. Chaque tentative doit échouer avec la violation attendue.

### 10.4 La gateway elle-même sous srt ?

- Linux : non. L'enfant srt perd l'espace réseau de l'hôte [V: README] ; un serveur qui y écoute est injoignable depuis l'hôte, sauf socket d'écoute hérité du parent (non documenté) [NV: T-07].
- macOS : seulement avec `allowLocalBinding: true`, qui autorise aussi la connexion à **tout** port local sans passer par le proxy [V: README et `sandbox-config.ts`] : la gateway pourrait alors joindre n'importe quel service local. Gain nul ou négatif.
- Recommandation : gateway native, utilisateur OS dédié, aucune lecture de `~`, aucun secret hors clé de signature ; réévaluer si T-07 prouve qu'un socket hérité fonctionne sur les deux OS.

## 11. Supply chain

- **Épinglage exact** (règle existante de `CLAUDE.md`) : `@anthropic-ai/sandbox-runtime` `0.0.81` (licence Apache-2.0, Node ≥ 22.12, ses dépendances directes en `^` sont figées par le lockfile) [V: `npm view`] ; `@cucumber/cucumber` `13.3.0` (épingle `@cucumber/gherkin` `42.0.1` et `@cucumber/messages` `34.2.1` exactement) [V: `npm view … dependencies`] ; `@cucumber/gherkin` `42.0.1` pour le compteur de la porte (même parseur que le runner) ; `@stryker-mutator/core`, `@stryker-mutator/cucumber-runner`, `@stryker-mutator/typescript-checker` `10.1.1` [V: `npm view`] ; `mutation-testing-report-schema` `3.8.4` (version tirée par `@stryker-mutator/core` 10.1.1 ; la dernière est 3.9.0) [V: `npm view`] ; `tsx` `4.23.15` [V: `npm view`] ; `@anthropic-ai/claude-code` `2.1.312` pour `claude plugin validate` en CI [V: `npm view`] ; Node `.nvmrc` exact.
- srt importe `zod/v3`, compatible avec `zod` 4.6.7 du dépôt [V: README, « zod 4 in the same dependency tree »].
- **Lockfile** : `package-lock.json` commité ; `npm ci` refuse un lockfile désynchronisé (comportement npm, non re-vérifié ici [NV: T-15]).
- **SBOM** : `npm sbom --sbom-format cyclonedx --package-lock-only --workspaces` (options présentes dans `npm sbom --help` de npm 11.20.0 [V: exécution locale de `--help`]) ; artefact de CI, plus un inventaire des paquets système (`dpkg-query -W bubblewrap socat ripgrep postgresql-17`) puisque npm ne les couvre pas.
- **Validation plugin** : scénario `features/descriptive/marketplace.feature` qui lance `claude plugin validate . --strict` et exige le code 0 (D-6 : seule la porte de tests fait foi, donc chaque contrôle devient un scénario).
- **Dépendances système** : versions apt de bubblewrap/socat/ripgrep/postgresql-17 épinglées dans le workflow [NV: T-16 pour les noms de paquets PGDG et la disponibilité de pgvector 17].
- **Portée de « aucun hash »** : voir O-3 (intégrité npm, SHA de commit, `sha256` d'archive).

## 12. Porte de tests CI (spécification)

### 12.1 Ce qui fait foi

Trois familles, toutes vertes sinon pas de merge (D-6b) :

1. **e2e de non-régression Gherkin** : `features/**/*.feature` (chemin d'appel complet, srt réel, Postgres réel).
2. **unitaires Gherkin** : `<composant>/features/**/*.feature`.
3. **mutation testing** : Stryker sur le code modifié par la PR (§12.6).

Typecheck, format, garde d'architecture, validation de plugin, schémas des fichiers descriptifs, lint de spec : chacun devient un scénario Gherkin d'une des deux premières familles. Il n'existe aucun autre check obligatoire.

### 12.2 Outillage Gherkin : comparaison et recommandation

| Critère | `@cucumber/cucumber` 13.3.0 partout | `@amiceli/vitest-cucumber` 8.0.0 (unitaire) + cucumber-js (e2e) | `quickpickle` 1.11.2 (unitaire) + cucumber-js (e2e) |
|---|---|---|---|
| Statut par step | Messages Cucumber : `UNKNOWN, PASSED, SKIPPED, PENDING, UNDEFINED, AMBIGUOUS, FAILED` [V: `cucumber/messages` `jsonschema/messages.md`] | Chaque step est un `test` vitest, le scénario un `describe` [V: README 8.0.0] ; un step oublié lève « was not called » ; pas de statut UNDEFINED/AMBIGUOUS distinct | Scénario exécuté comme test vitest [V: README] ; granularité par step non documentée dans le README ; non retenu |
| Unité comptée = pickle | Native (`TestCase.pickleId`) [V: messages.md] | À reconstruire depuis les noms vitest (fragile pour les Scenario Outline) | Idem |
| Parseur | `@cucumber/gherkin` 42.0.1, le même que le compteur de la porte | propre, via `ts-morph` 28.0.0 | `@cucumber/gherkin` `^32.1.0` : écart de parseur avec 42 |
| Poids de dépendances | officiel, MIT | ISC, un mainteneur, `ts-morph` | peer `pixelmatch`, deps `pngjs`, `lodash`, toutes en `^` |
| Mutation testing | `@stryker-mutator/cucumber-runner` 10.1.1, couverture `perTest` [V: npm + doc Stryker] | `@stryker-mutator/vitest-runner` 10.1.1 | idem vitest |
| Formats lus par la porte | **un** (NDJSON) | **deux** (NDJSON + rapport vitest) | deux |

**Recommandation : `@cucumber/cucumber` pour l'unitaire et l'e2e**, rapport Messages NDJSON unique. Coût : abandon de vitest (aucun `vi.fn`/mock n'est utilisé dans le dépôt [V: grep], les doubles sont déjà des adaptateurs en mémoire) ; assertions par `node:assert/strict`. Chargement TypeScript : le dépôt utilise des propriétés de paramètres (`constructor(private readonly …)`, ex. `gateway/src/infrastructure/in-memory.ts`), que le mode « strip types » natif de Node ne transforme pas [NV: T-13] ; d'où `tsx` comme chargeur (`--import tsx`), forme documentée par Stryker pour le runner Cucumber [V: doc `cucumber-runner`].

### 12.3 Unité comptée

- Unité = **pickle** : un par `Scenario`, un par ligne d'`Examples` d'un `Scenario Outline` ; les steps de `Background` sont recopiés dans chaque pickle (compilateur Gherkin) [NV: T-12 pour l'API exacte du compilateur de `@cucumber/gherkin` 42.0.1].
- Un pickle est **vert** si et seulement si :
  1. il a exactement un `TestCase` et un seul `TestCaseStarted`, avec `attempt = 0`, et son `TestCaseFinished.willBeRetried = false` [V: messages.md] ;
  2. il a au moins un step de pickle ;
  3. **chaque** `TestStep` de son `TestCase` (steps de pickle **et** hooks `Before/After`) a un `TestStepFinished` dont le statut est `PASSED`.
- `UNDEFINED`, `PENDING`, `SKIPPED`, `AMBIGUOUS`, `UNKNOWN`, `FAILED` = échec. La porte ne lit **jamais** `TestRunFinished.success`, car il compte `SKIPPED` comme succès [V: messages.md, « successful if all steps are either passed or skipped »] ; `strict` de cucumber-js ne couvre que `PENDING` [V: `docs/configuration.md`].

### 12.4 Configuration figée du runner

`cucumber.mjs` : `paths` = tous les `**/*.feature` hors `node_modules` et `dist` ; `import` = steps ; `format: [["message", "reports/cucumber.ndjson"]]` [V: `docs/formatters.md`] ; `retry: 0`, `strict: true`, `dryRun: false`, `failFast: false` ; **aucun** `tags` ni `name` [V: options de `docs/configuration.md`]. La porte relance cucumber-js avec **sa propre copie** de cette configuration (celle de la base, O-1) : une PR qui ajoute un filtre ne change pas ce qui s'exécute.

### 12.5 Attendu, ajoutés, supprimés

Arbre testé : le commit de merge que GitHub fabrique pour la PR (`refs/pull/<n>/merge`), extrait avec `fetch-depth: 2`. Base : son premier parent.

1. `T` = fichiers `.feature` touchés : `git diff --name-status -M HEAD^1 HEAD -- '*.feature'` (statuts A, D, M, R).
2. Pour chaque fichier de `T`, parser la version base et la version tête avec `@cucumber/gherkin` 42.0.1 ; identité d'un pickle = (chemin, nom du `Feature`, nom de la `Rule` éventuelle, nom du `Scenario`, valeurs de la ligne d'`Examples`, rang parmi les homonymes).
3. `ajoutés` = identités tête ∖ base ; `supprimés` = identités base ∖ tête (fichier par fichier, renommages inclus).
4. `N_base` = nombre de pickles verts enregistré par la porte du dernier run vert de `main` pour le commit `HEAD^1` (artefact `gate-count.json`, un entier, pas d'empreinte) ; à défaut (première activation), compte statique de `HEAD^1`.
5. `attendu = N_base + |ajoutés| − |supprimés|` (exemple de la décision : 6445 + 30 − 10 = 6465).
6. `statique` = nombre de pickles de tous les `.feature` de l'arbre testé, glob fixé dans le code de la porte (indépendant de la configuration de la PR).
7. `exécutés_verts` = pickles verts (§12.3) du NDJSON ; l'ensemble des pickles du NDJSON doit égaler l'ensemble statique.
8. **Vert** ⇔ `exécutés_verts = attendu = statique`, aucun step non `PASSED`, cucumber-js sort 0, et la famille mutation est verte. Le résumé du job affiche `N_base + ajoutés − supprimés = attendu` avec la liste des pickles ajoutés et supprimés.

Note de rigueur : avec un compteur statique indépendant de la configuration, `attendu = statique` vaut par construction tant que `main` n'a pas bougé sur les mêmes fichiers ; la vérification qui attrape les pertes silencieuses est `exécutés_verts = statique`. L'égalité avec `attendu` rend la provenance du delta explicite et dérivée du diff, comme exigé.

Cas limites :

| Cas | Traitement |
|---|---|
| Scénario renommé | +1 ajouté, −1 supprimé ; neutre sur le total |
| Fichier `.feature` renommé (R) | Tous ses pickles : supprimés sous l'ancien chemin, ajoutés sous le nouveau |
| Ligne ajoutée à `Examples` | +1 |
| Scénario paramétré par une liste calculée | Interdit : les `Examples` sont littéraux. Une itération sur des fichiers (ex. agents `.claude/agents/*.md`) se fait dans un step d'un seul scénario, ou en `Examples` littéraux plus un scénario qui vérifie que la liste couvre le répertoire |
| Step skipped (après un échec, ou par hook) | Échec |
| Tag `@wip`/`@skip` | Sans effet : aucun filtre n'est appliqué, le scénario s'exécute |
| Configuration modifiée pour exclure des fichiers | Sans effet sur la porte (configuration de la base) ; si l'exécution manque des pickles, `exécutés_verts < statique` : échec |
| Flaky | `retry: 0` ; tout `attempt > 0` : échec |
| Scénario sans step | Échec |
| Scénario dépendant de l'OS | Interdit de le filtrer : chaque job (Linux, macOS) exécute tous les pickles ; les steps gèrent les deux plateformes |
| Base de données absente localement | Échec (l'actuel `describe.skipIf(TEST_DATABASE_URL)` disparaît) ; la CI fournit Postgres 17 natif |
| `main` a modifié le même `.feature` depuis l'ouverture de la PR | `attendu ≠ statique` : échec explicite « base déplacée » ; l'auteur met sa branche à jour lui-même (la règle CLAUDE.md interdit `update-branch` outillé) |

### 12.6 Mutation testing (D-6b, D-6c)

**Outil** : `@stryker-mutator/core` 10.1.1 + `@stryker-mutator/cucumber-runner` 10.1.1 (peer `@cucumber/cucumber >=8.0.0`, ne supporte que ce runner Node ; couverture `perTest` prise en charge ; TypeScript via `"testRunnerNodeArgs": ["--import", "tsx"]`) [V: `npm view` ; stryker-mutator.io/docs/stryker-js/cucumber-runner] + `@stryker-mutator/typescript-checker` 10.1.1 (`checkers: ["typescript"]`, rejette les mutants mal typés) [V: doc `configuration`]. Si O-14 retenait vitest, `@stryker-mutator/vitest-runner` 10.1.1 (peer `vitest >=2.0.0`) existe [V: `npm view`].

**Périmètre « code modifié »** :

1. `git diff -U0 HEAD^1 HEAD` sur le commit de merge, restreint aux sources de production : `{gateway,data,platformd,services/*,modules/*,sandboxes/*,tools/*}/src/**/*.ts`, `services/*/worker/**/*.ts`, `packages/contracts/src/**/*.ts` ; exclus : `*.feature`, steps, `*.d.ts`, code généré par `tools/build`.
2. Chaque hunk `+a,b` (b > 0) donne une plage `fichier:a-(a+b-1)` ; un fichier ajouté donne le fichier entier ; une suppression pure ne donne aucun mutant (les scénarios doivent tout de même passer).
3. Ces plages forment `mutate`, au format de plage Stryker (`"src/app.js:1-11"`, pas de glob sur la même ligne) [V: doc `configuration`, « mutation range »].
4. Pas de mode `incremental` (il dépend d'un fichier d'état d'un run précédent, comportement interne non vérifié vis-à-vis de D-6 « aucun hash ») ; le périmètre par plages borne déjà le coût.

**Vert** (décision D-6c), lu dans le rapport JSON (`reporters: ["json"]`, `jsonReporter.fileName`) conforme à `mutation-testing-report-schema` 3.8.4, statuts `Killed, Survived, NoCoverage, CompileError, RuntimeError, Timeout, Ignored, Pending` [V: schéma, `mutation-testing-elements`] :

| Statut d'un mutant du périmètre | Traitement | Raison |
|---|---|---|
| `Killed` | toléré | détecté |
| `Survived` | **échec** | D-6c |
| `NoCoverage` | **échec** | un mutant qu'aucun scénario n'exécute survit nécessairement |
| `Timeout` | toléré (détecté au sens Stryker) | la boucle infinie produite par le mutant est observée ; `timeoutMS`/`timeoutFactor` par défaut 5000 / 1,5 [V] |
| `CompileError`, `RuntimeError` | tolérés | mutant invalide, pas un survivant ; listés dans le résumé |
| `Ignored` | toléré **seulement** si couvert par un marquage valide (ci-dessous) | D-6c |
| `Pending` | **échec** | run incomplet |

Paramètres : `ignoreStatic: false` (sinon les mutants statiques seraient ignorés sans justification) ; `thresholds` non utilisés pour décider (la porte lit les statuts ; `break` reste `null`) ; aucun `mutator.excludedMutations` ni `ignorers` (désactivations globales interdites, scénario de configuration).

Conséquence d'architecture : un mutant dans du code qui ne s'exécute que dans un **processus enfant** (sous srt) n'est pas couvert par l'analyse `perTest` en processus [NV: T-14] et finirait `NoCoverage`. Le motif existant (ports + adaptateurs en mémoire, `InProcessContainerRunner`) devient obligatoire : toute logique doit être exerçable en processus ; les adaptateurs qui lancent `srt` gardent une partie pure (construction de l'argv, analyse des messages) testée en processus.

**Marquage des mutants équivalents** : syntaxe Stryker `// Stryker [disable|restore] [next-line] mutatorList[: raison]`, raison optionnelle côté Stryker, mutants marqués rapportés `Ignored` [V: doc `disable-mutants`]. La porte durcit la règle ; un commentaire `Stryker disable` ajouté ou modifié par la PR est **valide** seulement si :

1. forme `// Stryker disable next-line <Mutateur>[,<Mutateur>]: équivalent: <justification>` ; `all`, `disable` sans `next-line`, et `restore` sont refusés ;
2. la justification fait au moins une phrase qui nomme l'invariant rendant le mutant indiscernable (ex. « équivalent: `limit` est borné à 50 par le schéma zod en amont, `<` et `<=` coïncident ») ;
3. chaque mutant `Ignored` du rapport est sur la ligne qui suit un commentaire valide, et chaque commentaire valide ignore au moins un mutant (sinon commentaire mort : échec) ;
4. le résumé du job liste chaque mutant ignoré avec mutateur, remplacement (`replacement`) et justification.

Validation en revue : la porte ne juge que la forme. L'équivalence elle-même est examinée par la revue `claude-review` (profil `zetetic-reviewer`), qui reçoit la liste du point 4 et doit, pour chaque entrée, soit démontrer qu'aucun scénario ne peut distinguer le mutant, soit demander un scénario qui le tue ; puis par un humain. Tension avec D-6 (porte = tests seulement) : cette revue n'est pas un check bloquant. Si le propriétaire veut qu'elle bloque, il faut une règle de protection de branche (revue requise), hors CI ; voir §16, C-11.

**Coût et bornes** : nombre de mutants ∝ lignes modifiées ; `coverageAnalysis: perTest` (défaut) n'exécute que les scénarios couvrant chaque mutant [V] ; `concurrency` = cœurs − 1 par défaut [V] ; `dryRunTimeoutMinutes` 5 par défaut [V] ; `timeout-minutes` du job GitHub ; au-delà, découpage du périmètre en matrice de jobs par fichier. Durées réelles [NV: T-14].

### 12.7 Rapports machine lus par la porte

- `reports/cucumber.ndjson` (Messages Cucumber, un par job et par OS).
- `reports/mutation/mutation.json` (schéma 3.8.4).
- Sortie : `gate-count.json` = `{ "commit": "<sha du commit testé>", "pickles_green": <entier> }`, publié en artefact sur `main`. Le SHA de commit sert d'identifiant de lookup, jamais de comparaison d'empreintes.

### 12.8 Où elle s'exécute

`.github/workflows/gate.yml`, sur `pull_request` et `push` vers `main` ; deux jobs **requis** : `gate-linux` (`ubuntu-24.04`) et `gate-macos` (srt diffère par OS) ; mutation sur Linux seulement (le code muté est le même). Étapes Linux : checkout du merge, `setup-node` sur `.nvmrc`, `apt-get install` bubblewrap socat ripgrep postgresql-17 (versions épinglées, T-16), sysctl AppArmor, `npm ci`, stage 0 construit vN+1, vN+1 se reconstruit (§13), `node tools/test-gate/dist/main.js` (Gherkin puis Stryker), publication des rapports. `permissions: contents: read`, aucun secret. Les workflows Claude (v3 §7) restent sur le runner auto-hébergé et ne sont pas des checks requis.

### 12.9 Migration des tests vitest existants

Inventaire statique [V: grep sur `fbf100a`] : **95** appels `it`/`test` dans **22** fichiers, dont 5 `it.each` (`test/descriptive/claude-files.test.ts` ×2 sur des listes calculées, `data/test/infrastructure/sql-store.test.ts`, `services/memory/test/application/intent-service.test.ts`, `services/memory/test/worker/run-worker.test.ts`, `gateway/test/presentation/mcp-server.test.ts` — 6 lignes au total), 1 `describe.skipIf(TEST_DATABASE_URL)`, 3 suites de contrat définies hors `*.test.ts` et invoquées par adaptateur (`data/test/contracts/data-store.ts`, `services/memory/test/contracts/container-runner.ts`, `gateway/test/contracts/ports.ts`). Le nombre de cas **exécutés** n'est pas mesuré (pas de `node_modules`) : il sera relevé par `npx vitest list --json` au commit de départ de la brique 1a [NV: T-17].

Règles : un `it` → un `Scenario` ; un `it.each` littéral → `Scenario Outline` ; une suite de contrat → `Scenario Outline` avec une colonne `adaptateur` ; un `it.each` calculé → un scénario dont un step itère, plus un scénario de couverture du répertoire ; `skipIf` → supprimé, Postgres fourni. Table de correspondance `decisions/migration-gherkin.md` (identifiant vitest → pickle). La porte n'est activée qu'à la fin de la migration (brique 1a), avec `N_base` = compte statique de ce commit.

## 13. Stage 0

- **Artefact** : paquet npm `@architect-os/stage0` publié sur GitHub Packages, version semver exacte ; contenu : `dist/` de `tools/build` et `tools/test-gate`, `npm-shrinkwrap.json`, champ `engines.node` exact. Épinglé dans `stage0/package.json` (version exacte) + `stage0/package-lock.json`. Immuabilité d'une version publiée sur GitHub Packages [NV: T-18].
- **Construction de vN+1** : (1) `stage0` (vN) construit l'arbre → `build-1` ; (2) l'outil de build de `build-1` reconstruit l'arbre → `build-2` ; (3) la porte de tests (§12) s'exécute sur `build-2`. Aucune comparaison de `build-1` et `build-2` : la preuve est la porte.
- **Promotion** : sur `push` vert de `main`, publication de `build-2` en `@architect-os/stage0@<N+1>` puis PR automatique qui met à jour l'épinglage ; cette PR passe la même porte. Si une étape échoue, l'épinglage ne bouge pas et vN reste capable de construire.
- **Amorçage** : `stage0@0.1.0` = première construction de la brique 1c par `npm ci && tsc -b` documentée dans `decisions/`.

## 14. Ordre des briques (réécrit pour srt)

Chaque brique : contenu, porte de sortie mesurable, test externe qui la prouve, trois piliers. Les métriques v3 (M1, M2, définitions ≤ 1 500 tokens, recall ≤ 600, résultat ≤ 1 000, p50 < 200 ms) sont **relevées et non bloquantes** (D-7) ; les portes sont des scénarios Gherkin qui prouvent un **mécanisme**.

| # | Brique | Contenu | Porte de sortie | Test externe | Piliers (R / S / O) |
|---|---|---|---|---|---|
| 0 | Baseline | Reportée (D-7) | — | — | R : prévu, à la date du propriétaire / S : sans objet / O : sans objet |
| 1a | Gherkin + porte | Migration des 95 appels (§12.9) ; `tools/test-gate` ; `cucumber.mjs` ; Stryker ; `gate.yml` | 0 fichier `*.test.ts` ; `vitest` retiré ; porte verte sur `main` avec `exécutés_verts = attendu = statique` ; tous les cas `vitest list` de départ présents dans la table de correspondance | 7 PR sentinelles, chacune doit être **rouge** : step non défini ; step `pending` ; filtre `tags` ajouté ; `.feature` supprimé hors diff (exclusion de config) ; scénario sans step ; mutant survivant sur ligne modifiée ; `Stryker disable all` ; et une PR saine **verte** | R : T-12, T-13, T-17 consignés / S : SAST = porte / O : `contents: read`, sans secret |
| 1b | srt | `platformd` ; `SrtSandboxRunner` ; protocole stdio ; worker memory sous srt ; suppression `compose.yaml`, `Dockerfile`, `.dockerignore`, `proxy/`, image worker, `test/infra/compose.test.ts` ; `topology/` ; Postgres natif socket Unix | Scénarios verts sur Linux et macOS : `recall` e2e à travers un vrai `srt` (agent scripté) ; suite d'évasion §10.3 ; schéma strict des profils | `features/sandbox/escape.feature` contre les deux OS ; T-02 à T-09 consignés | R : T-xx consignés / S : DAST = suite d'évasion / O : utilisateurs OS dédiés, clé masquée |
| 1c | Marketplace + stage 0 + supply chain | `.claude-plugin/marketplace.json`, `plugins/agentic-gateway`, `plugins/ai-architect-standards` ; `stage0@0.1.0` ; SBOM ; workflows Claude en fédération OIDC | Scénario `claude plugin validate . --strict` = 0 ; scénario d'installation dans un `HOME` jetable (`claude plugin marketplace add ./` puis `claude plugin install agentic-gateway@architect-os`) ; build vN+1 deux fois puis porte verte ; zéro clé statique dans les secrets du dépôt | Run `gate.yml` vert sur la PR de la brique ; `gh secret list` sans clé Anthropic | R : stage 0 reproductible / S : SBOM, épinglage / O : fédération |
| 2 | Gateway catalogue + registre + recall | Mode catalogue, registre via opérations typées de `data`, profil `ci-review`, `memory-recall` en `kind: workflow` | Scénarios : un résultat au-delà de `max_result_tokens` devient résumé + handle ; un appel hors profil est refusé et journalisé ; `recall` n'invoque aucun modèle | `claude-review.yml` branché sur la gateway sur une PR réelle ; mesures recall/p50 relevées (non bloquantes) | R : mesures journalisées / S : jetons de task / O : registre append-only |
| 3 | Front de code + executor | `search/describe/execute`, génération des modules, pool chaud d'executors srt (réseau nul) | Scénarios : un script `execute` n'atteint que les modules de son profil ; un script qui tente le réseau échoue avec une violation srt ; la mort d'une session tue son executor | `claude-review` passe aux trois méta-tools ; taille des définitions relevée (non bloquante) ; latence de démarrage srt mesurée (T-10) | R : T-10 consigné dans `decisions/` / S : suite d'évasion étendue au profil executor / O : réseau nul, executor détruit en fin de session |
| 4 | Scission Cortex | `memory-write`, `memory-consolidate`, un écrivain par table (`owner` dans `operations.json`) | Scénario : une opération qui écrit une table hors `writes_tables` de son propriétaire est refusée au chargement ; tables à plusieurs écrivains = 0 | Revue sur `cortex` via la gateway | R : choix BM25 (O-11) une extension à la fois, consigné / S : migrations dans le propriétaire, écrivain unique vérifié au chargement / O : IRB prévu ici si memory reçoit des données personnelles, sans objet sinon |
| 5 | Domaine Code + tasks | `code-index`, `verify`, `codebase-ask` ; profils scout/builder/zetetic-reviewer | Scénarios : citation `fichier:ligne` invalide rejetée ; le builder ne peut écrire hors de sa copie ni dans `.git/hooks` | `claude-review` appelle `verify` avant tout jugement | R : part validé/gradé relevée (non bloquante) / S : suite d'évasion étendue aux trois profils / O : clé masquée par task, copie de travail jetable |
| 6 | Domaine Spec | `spec-draft`, `spec-lint` (scénario de la porte sur `decisions/`) | Scénario : une spec sans critère d'acceptation par exigence est rejetée | `issue-to-spec.yml` sur une issue réelle | R : sans objet, aucune expérience nouvelle (outillage de la brique 1a) / S : `spec-draft` sans réseau autre qu'Anthropic, profil agent-worker / O : sans objet, aucune donnée nouvelle |
| 7 | Mission Control | Onglet Mission sur le registre | Scénario : tokens par couche visibles pour une task | Lecture d'une task réelle de la brique 5 | R : sans objet, lecture du registre / S : servi par l'edge (prévu 1b), hors sandbox, authentifié par la gateway / O : lecture seule du registre via une opération de `data` (prévu 2) |
| 8 | Services modèles + web-scout | Structurer, Judge, web-scout (profil §8.6) | Scénarios : web-scout n'écrit qu'en quarantaine ; adresse privée refusée | M1/M2 relevés (non bloquants) | R : chaque service ajouté une variable à la fois, M1/M2 consignés / S : profil web-scout + `deniedResolvedAddresses` / O : Judge local sur données sensibles tant que l'hébergement Jev n'est pas confirmé (v3 §9) |

## 15. Décisions ouvertes (chacune avec recommandation)

| # | Question | Recommandation |
|---|---|---|
| O-1 | Une PR peut modifier `gate.yml` et le code de la porte (sous `pull_request`, le workflow vient du commit de merge) | Exécuter la porte par `pull_request_target`, `contents: read`, sans secret ni cache, code de la porte et `cucumber.mjs` pris dans le checkout de la **base**, tests dans le checkout du merge ; alternative : règle « required workflow » d'un ruleset si le compte la propose [NV: T-19] |
| O-2 | `CLAUDE.md` interdit toute comparaison de branche à `main` ; D-6 exige un diff | Amender `CLAUDE.md` : autoriser le diff du commit de merge GitHub contre son premier parent (§12.5) ; alternative conforme à la lettre : API `pulls/<n>/files` (diff tel que GitHub le présente), au prix de l'échec « base déplacée » plus fréquent |
| O-3 | Portée de « aucune comparaison de hash » | La règle vise les sorties de build et la porte (fin du point fixe par digests). Hors portée : intégrité npm du lockfile (vérifiée par `npm ci`), SHA de commit utilisés comme identifiants, `sha` des sources de plugin, `sha256` d'archive. Si le propriétaire veut l'étendre, npm devient inutilisable en l'état |
| O-4 | Hébergement de stage 0 | Paquet npm sur GitHub Packages (§13) ; repli : tarball `npm pack` en asset de release |
| O-5 | Superviseur : `srt` CLI par processus ou bibliothèque `SandboxManager` | CLI par processus : isolation réseau par task garantie par construction ; la bibliothèque garde une configuration par processus et `customConfig` ne couvre pas tout `network` [V: source `sandbox-manager.ts`] |
| O-6 | `data` et Postgres hors srt | Natifs, utilisateur OS dédié, socket Unix 0700, `peer` ; variante `data` sous srt avec `allowAllUnixSockets` rejetée (désactive le filtrage seccomp des sockets) |
| O-7 | Edge TLS sur serveur | Caddy natif depuis le paquet de la distribution, version épinglée ; aucun edge sur laptop |
| O-8 | Limites ressources des sandboxes | Linux : `systemd-run --user --scope -p MemoryMax=… -p TasksMax=…` autour de `srt` ; macOS : rlimits posés par un wrapper ; à valider (T-09) |
| O-9 | `agent-approval-check` (2 approbations) et `spec-lint` étaient des checks requis en v3 | `spec-lint` → scénario Gherkin ; l'approbation humaine, si voulue, par la protection de branche (revue requise), pas par la CI (D-6) |
| O-10 | `plugins/` (clients) vs `modules/` (serveur) | Séparés : `plugins/` est copié dans le cache de chaque client [V: marketplace-reference, sources relatives] ; y mettre le code serveur l'exposerait et l'alourdirait |
| O-11 | Extension BM25 (« BM25 (extension) » sans nom en v3) | Évaluer les extensions BM25 disponibles pour Postgres 17 en brique 4, une à la fois, consigné ; aucune n'est vérifiée ici |
| O-12 | Réseau du builder (registre npm) | Aucun : `node_modules` pré-installé en lecture ; une dépendance nouvelle passe par une PR humaine |
| O-13 | macOS requis dans la porte | Oui (Seatbelt ≠ bubblewrap) |
| O-14 | Outillage Gherkin | `@cucumber/cucumber` partout, vitest retiré (§12.2) |
| O-15 | Source de `N_base` | Artefact `gate-count.json` du dernier run vert de `main`, repli statique |
| O-16 | Écritures du registre par la gateway (v3 : `platform.executions` écrite par la gateway) | Par une opération typée de `data`, jamais `pg` dans la gateway |
| O-17 | Ubuntu 24.04 : sysctl AppArmor global vs profil dédié | Runners CI : sysctl (jetables) ; serveurs : profil AppArmor pour `bwrap` |
| O-18 | Repli si le masquage de clé srt échoue (T-04) | Broker natif hors srt joint par `ANTHROPIC_BASE_URL` avec `127.0.0.1:<port>` en allowlist (T-03) |
| O-19 | Clé Anthropic du runtime (`platformd`) | Coffre du système ou fédération si l'API la propose hors GitHub Actions ; non vérifié |

## 16. Contradictions relevées

| # | Entre | Contradiction | Résolution proposée |
|---|---|---|---|
| C-1 | `CLAUDE.md` « Never put an API key … in a worker container » + `docs/infrastructure.md` (broker) vs v3 « clés API injectées par task » | Injecter une clé dans une task la place dans le worker | Masquage srt : la task voit une sentinelle, la clé reste dans `srt` (§4.2) [NV: T-04] |
| C-2 | `CLAUDE.md` « Never compare a branch to `main` » vs D-6 « dérivés du diff » | Dériver ajouts/suppressions impose une base | O-2 |
| C-3 | v3 « SQL depuis les modules seulement ; un écrivain par table » vs `CLAUDE.md` « `pg` only in `data/src/infrastructure` » | Deux modèles d'accès | `data` reste seul importeur ; propriété par module dans `operations.json` (brique 4) |
| C-4 | v3 « pgvector installé mais désactivé », D-5 vs `0002_memory.sql` (`CREATE EXTENSION vector`, `vector(384)`, HNSW) et `EMBEDDING_DIMENSION` dans les contrats | pgvector est actif aujourd'hui | Migration `0004` (§5) ; `memory.search-vector.sql` et `EMBEDDING_DIMENSION` à revoir |
| C-5 | v3 `memory-recall` « aucun LLM » vs `recall` actuel = agent SDK | — | D-4 : `kind: workflow` (brique 2) |
| C-6 | `CLAUDE.md` « Agent SDK only in `services/*/worker` » vs v3 executor et tasks sur Agent SDK | — | Règle dependency-cruiser étendue à `sandboxes/` |
| C-7 | `CLAUDE.md` gateway « auth, catalogue, routing, quota, audit. Nothing else » et « touches no data » vs v3 gateway (DAG, budgets, jetons, `max_result_tokens` avec résumé, registre) et D-3 | D-3 tranche pour v3 | Mettre `CLAUDE.md` à jour ; résumé + handle : troncature déterministe dans la gateway, tout résumé par modèle délégué à un module |
| C-8 | v3 « compose identique laptop et serveur » vs srt (sémantiques différentes par OS) | — | Porte exécutée sur les deux OS (O-13) |
| C-9 | v3 `agent-approval-check` et `spec-lint` requis vs D-6 | — | O-9 |
| C-10 | `CLAUDE.md` « versions exactes » vs `.nvmrc` = `26` | Version majeure seulement | `.nvmrc` exact |
| C-11 | D-6 (porte = tests seulement) vs D-6c (équivalents « validés en revue ») | Une revue n'est pas un test | La porte valide la forme ; l'équivalence est jugée en revue non bloquante, sauf protection de branche (§12.6) |
| C-12 | `CLAUDE.md` « every brick … passes `npm run check` » et « What the review must refuse » (vitest, `npm run arch`) vs D-6a (Gherkin seul fait foi) | — | Réécrire « Adding a brick » en termes de scénarios Gherkin et de mutation |
| C-13 | v3 executor « aucune clé API » et « modèle dimensionné par le profil » | Un executor qui appelle un modèle a besoin d'un accès API | Executor sans modèle (réseau nul) ; le modèle vit dans les modules `kind: agent` |
| C-14 | v3 §7.1 « workflow depuis la branche par défaut » pour tous les workflows | Vrai pour `pull_request_target`, pas pour `pull_request` | O-1 |

## 17. Vérifié / non vérifié

### 17.1 Vérifié en source primaire

| Fait | Source |
|---|---|
| srt 0.0.81 publié, Apache-2.0, Node ≥ 22.12, `bin srt`, dépendances en `^` | `npm view @anthropic-ai/sandbox-runtime@0.0.81` |
| Seatbelt (macOS), bubblewrap (Linux), proxys HTTP/SOCKS sur l'hôte, réseau refusé par défaut, écriture refusée par défaut, lecture autorisée par défaut | README 0.0.81 |
| Options `--settings`, `--debug`, `-c`, `--control-fd` ; `~/.srt-settings.json` par défaut ; fichier nommé absent = refus | source `src/cli.ts` ; README |
| stdio de l'enfant hérité ; SIGINT/SIGTERM → sortie 0 | source `src/cli.ts` |
| Clés `filesystem.{denyRead,allowRead,allowWrite,denyWrite}`, `network.{allowedDomains,deniedDomains,strictAllowlist,allowLocalBinding,deniedResolvedAddresses,tlsTerminate}`, `credentials.envVars[].{name,mode,injectHosts}` ; objets non stricts sauf `credentials` | source `src/sandbox/sandbox-config.ts` (branche `main`) ; README 0.0.81 pour les mêmes noms |
| `allowLocalBinding` ignoré sous Linux ; Linux : espace réseau propre | README |
| `NO_PROXY=localhost,127.0.0.1,::1,…` dans l'enfant ; `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` posés quand un CA MITM existe | source `src/sandbox/sandbox-utils.ts` |
| `NODE_USE_ENV_PROXY` posé seulement sous Windows | README |
| `NODE_USE_ENV_PROXY=1` / `--use-env-proxy` dans Node 26 | nodejs.org, CLI v26.13.0 |
| `initialize`, `wrapWithSandbox(command, binShell?, customConfig?, abortSignal?, options?)`, `registerCommandNetworkLists`, état de module | source `src/sandbox/sandbox-manager.ts` |
| Chemins à écriture toujours refusée | README ; `sandbox-utils.ts` |
| Schéma `marketplace.json`, sources relatives, noms réservés, messages de validation | code.claude.com/docs/en/plugins/marketplace-reference.md |
| Schéma `plugin.json`, `userConfig`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`), règles de chemins, `bin/` | manifest-reference.md |
| Étapes de création et de validation d'une marketplace | create-marketplace.md |
| `claude plugin validate <path> [--strict] [--json]`, codes 0/1/2 | cli-reference.md (plugins) |
| Serveur MCP `type: "http"`, `url`, `headers`, noms `mcp__plugin_<plugin>_<server>__<tool>` | mcp.md |
| Entrées `plugins`, `plugin_marketplaces`, fédération, `claude_args`, installation de bubblewrap/socat et sysctl AppArmor par l'action | `claude-code-action` `action.yml` |
| Fédération : `id-token: write`, une clé statique l'emporte | `claude-code-action` `docs/setup.md` |
| Versions : `@cucumber/cucumber` 13.3.0, `@cucumber/gherkin` 42.0.1, `@cucumber/messages` 34.2.1, `@amiceli/vitest-cucumber` 8.0.0 (peer `vitest ^5.0.0`), `quickpickle` 1.11.2, Stryker 10.1.1 (core, cucumber-runner, vitest-runner, typescript-checker), `mutation-testing-report-schema` 3.9.0 (3.8.4 tiré par Stryker), `tsx` 4.23.15, `vitest` 5.0.5, Agent SDK 0.3.312, Claude Code 2.1.312 | `npm view` |
| Formatter `message` (NDJSON), options `strict`, `retry`, `tags`, `name` de cucumber-js | `cucumber-js` `docs/formatters.md`, `docs/configuration.md` |
| `TestStepResultStatus`, `TestRunFinished.success` compte SKIPPED comme succès | `cucumber/messages` `jsonschema/messages.md` |
| `vitest list` statique depuis Vitest 5 | vitest.dev, CLI v5.0.5 |
| vitest-cucumber : scénario = `describe`, step = `test` | README 8.0.0 |
| Stryker : plages `mutate`, `thresholds`, `coverageAnalysis`, `timeoutMS`, `concurrency`, `ignoreStatic`, `jsonReporter`, `incremental` ; runner Cucumber `perTest`, TypeScript via `tsx` ; commentaires de désactivation (raison optionnelle) ; statuts du schéma | stryker-mutator.io (configuration, cucumber-runner, disable-mutants) ; `mutation-testing-report-schema.json` |
| Inventaire des tests actuels (95 / 22 / it.each / skipIf / contrats), absence de `vi.*` | grep sur le worktree à `fbf100a` |

### 17.2 Non vérifié, avec le test qui le prouvera

| ID | Affirmation | Test |
|---|---|---|
| T-01 | Les clés de configuration de `main` amont existent à l'identique dans 0.0.81 | Lire `node_modules/@anthropic-ai/sandbox-runtime/dist/**/*.d.ts` après `npm ci` ; charger chaque profil avec `srt --settings` et vérifier le refus d'un fichier invalide |
| T-02 | `denyRead: ["~"]` + `allowRead` du runtime masque bien le home sur macOS et Linux sans casser Node | Scénario d'évasion : lecture de `~/.ssh/id_test` refusée, `node -e 1` sous le profil réussit, sur les deux OS |
| T-03 | Un process srt joint `127.0.0.1:<port>` de l'hôte via le proxy avec `NO_PROXY=` vidé, `NODE_USE_ENV_PROXY=1` et `127.0.0.1:<port>` en allowlist | Serveur HTTP de test sur l'hôte ; `fetch` depuis la sandbox ; attendu : succès avec l'entrée, échec sans |
| T-04 | Masquage `ANTHROPIC_API_KEY` + `tlsTerminate` : l'enfant voit la sentinelle, Anthropic reçoit la vraie clé, l'Agent SDK (binaire Claude Code) passe par le proxy et fait confiance au CA MITM | `srt --settings scout.json -- node -e 'fetch("https://api.anthropic.com/v1/models")'` puis une requête Agent SDK minimale ; `printenv` dans la sandbox |
| T-05 | Le protocole JSON lines bidirectionnel traverse `srt` sans tampon bloquant | Scénario : 1 000 allers-retours `call/result` sous srt |
| T-06 | Tuer `srt` (timeout) tue tout l'arbre (bwrap, Node, sous-processus du SDK) | Scénario : sandbox qui lance un `sleep` enfant ; après kill, aucun processus restant (`pgrep`) |
| T-07 | Un socket d'écoute hérité (fd ≥ 3) reste utilisable dans la sandbox (gateway sous srt, sockets Unix hérités) | `net.Server` sur fd hérité sous srt, connexion depuis l'hôte, Linux et macOS |
| T-08 | `data` sous srt via socket Unix Postgres | Seulement si O-6 change |
| T-09 | Limites mémoire/PID appliquées autour de `srt` | Scénario bombe fork et allocation 1 Go sous la limite, Linux (`systemd-run`) et macOS |
| T-10 | Latence de démarrage d'un processus srt (pool chaud) | Mesure consignée en brique 3, non bloquante |
| T-11 | `${user_config.gateway_url}` dans `url` passe `claude plugin validate --strict` et se résout à l'installation | Scénario de la brique 1c |
| T-12 | API du compilateur de pickles de `@cucumber/gherkin` 42.0.1 et identité des pickles | Lire les `.d.ts` après `npm ci` ; scénario du compteur sur des `.feature` de référence (Outline, Background, Rule) |
| T-13 | Le mode strip-types de Node 26 refuse les propriétés de paramètres ; `tsx` charge les steps et les sources avec les imports `.js` du dépôt | Lancer cucumber-js avec et sans `--import tsx` sur un step important `gateway/src/infrastructure/in-memory.ts` |
| T-14 | Stryker + cucumber-runner + `tsx` : couverture `perTest` dans ce dépôt ; code exécuté seulement en sous-processus = `NoCoverage` ; durée par mutant | Run Stryker sur une plage d'`intent-service.ts`, puis sur `SrtSandboxRunner` |
| T-15 | `npm ci` échoue sur lockfile désynchronisé | Scénario : modifier une version dans `package.json` seul |
| T-16 | Paquets `postgresql-17`, pgvector 17, bubblewrap, socat, ripgrep disponibles et épinglables sur `ubuntu-24.04` | Job d'essai `apt-cache policy` |
| T-17 | Nombre de cas exécutés par vitest au commit de départ | `npx vitest list --json` après `npm ci` |
| T-18 | Une version publiée sur GitHub Packages npm est immuable | Tenter de republier la même version dans un dépôt d'essai |
| T-19 | Disponibilité des « required workflows » de ruleset pour ce compte | Paramètres du dépôt `cdeust/architect-os` |
