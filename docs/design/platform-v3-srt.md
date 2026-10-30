# Plateforme v3 sous sandbox-runtime (srt)

Conception, 30 octobre 2026, réécrite depuis `0dd97c5`. Elle amende la vision v3 (`docs/design/platform-v3.html`, inchangée) et se lit d'une traite. L'historique est dans [`journal.md`](journal.md) : résultats du banc, décisions, échecs, sort de chaque mécanisme retiré. Le journal d'expériences reste [`bench/JOURNAL.md`](../../bench/JOURNAL.md), et l'ancien texte complet reste dans git à `0dd97c5`. Figures : [`platform-v3-srt.html`](platform-v3-srt.html).

Position du propriétaire, qui règle ce document :

> « La logique repose sur la confiance, et concrètement aucune des failles de sécurité n'est totalement correctible, il faut savoir vivre avec, amenuiser les risques de manière pragmatique. L'over engineer n'a pas sa place. La meilleure des architectures est une architecture propre et simple. »

Règle de lecture : un mécanisme n'est ici que si son retrait laisse un risque réel, nommé. Tout autre risque est accepté par écrit (§4.2).

Preuves : `[T-xx]` ou `[E-xx]` désigne une expérience jouée, dont le résultat est au journal. `[à prouver : scénario, brique]` désigne ce qui n'a pas encore tourné ; rien de ce qui est ainsi marqué n'est livré avant son scénario. `architect-os` est un nom provisoire.

## 1. Objectif

Réduire le contexte et les tokens consommés par tâche (objectif unique de v3), avec un seul chemin d'exécution pour le produit, le développement et la CI. Le client voit trois méta-tools ; il écrit du code ; l'exécuteur appelle les modules, filtre, et ne rend qu'un résultat borné. Le produit reste la v3. Seule sa réalisation change : un conteneur v3 devient un processus srt.

Mesures v3 : M1, tokens de contexte client par tâche, en baisse ; M2, tokens totaux par couche et par modèle, jamais en hausse quand M1 baisse ; définitions ≤ 1 500, recall ≤ 600, résultat de tool ≤ 1 000 tokens ; R = 1 − T(code execution) / T(orchestration directe), mesuré sur les mêmes tâches en brique 3. Aucune ne bloque une porte tant que le propriétaire n'a pas fixé la date de la baseline (D-7, brique 0).

| Pilier | Fait | Prévu | Sans objet |
|---|---|---|---|
| Recherche | Banc Linux et macOS, 106 tests, échecs conservés, run 41044838678, une commande : `cd bench && npm run bench:sandbox` | TUI de 1a.0 ; banc rejoué à chaque montée de srt (T-54) ; M1, M2, R aux briques 1c à 3 ; baseline à la brique 0 | |
| SSDLC | STRIDE court et risques acceptés (§4) ; dépendances épinglées, lockfile (§4.3) | SBOM en 1c ; SAST = porte de tests, brique 1a ; DAST = `escape.feature`, brique 1b | |
| Opérationnel | Moindre privilège par profil (§5) ; aucun secret lu pour écrire ce document | Clé API seule dans le broker, brique 1b ; un uid dédié sur serveur, brique D | IRB : aucune donnée humaine ; à revoir en brique 4 si la mémoire en reçoit |

## 2. Topologie

```
 client (Claude Code, Codex, claude-code-action)
    |  MCP http, 127.0.0.1 ; TLS par le déploiement sur serveur
    v
 natifs, quatre exceptions prouvées
    gateway      seul point de décision, seul parent des sandboxes
                 auth, profils, calls_allowed, budgets, registre, max_result_tokens
    broker       seul détenteur de la clé API ; POST /v1/messages seul
    data         seul importeur de pg ; opérations typées en tools MCP
    postgres 17  listen_addresses='' ; peer sur socket Unix, aucun mot de passe
    |  MCP stdio, créé par l'adaptateur
    v
 sous srt, un processus par conteneur v3
    executor     1 par session ; réseau nul, aucun jeton
    module       1 par module data, workflow ou plugin ; réseau : gateway
    worker       1 par task ; query(), handlers minces, binaire Claude Code ; réseau : broker
    web-scout    allowlist du manifeste ; db-migrator : réseau nul
```

**Pourquoi quatre natifs.** Un processus sous srt ne sert pas de listener joignable par l'hôte : macOS `EPERM`, Linux `ECONNREFUSED` [T-39b, T-07]. D'où gateway et broker. Sous Linux, `allowUnixSockets` est ignoré (README srt), donc `data` et Postgres, joints par socket Unix, restent natifs ; ce montage est prouvé [E-09]. Tout le reste tourne sous srt, plugins compris : le code et le contenu non fiables n'ont pas de chemin natif.

**Un seul transport.** Tous les liens internes sont MCP stdio avec le SDK officiel, aucun protocole maison. Un module est serveur MCP, la gateway est son client [E-01, T-38]. L'executor et le worker sont clients MCP sur leurs propres stdin/stdout, la gateway est serveur sur les flux de l'enfant, parce qu'ils appellent des tools et que MCP ne permet pas l'inverse [E-02 : 1 000 allers-retours en 45 ms sous srt, 38 ms sans]. Leur identité est la fermeture du handler : un `_meta.task` forgé est ignoré, un enfant hostile n'abat pas l'hôte [E-03]. `query()` et le binaire vivent dans la même sandbox [T-41, deux OS, faux amont]. `type: http` vers un module est refusé par schéma.

**Un module rappelle la plateforme** par le proxy srt vers `127.0.0.1:8080` [T-38], avec un jeton opaque généré à son lancement. Pour la gateway, c'est un client comme un autre, dont le profil est son `calls_allowed`. Aucune signature : un module n'est joignable que par son parent, sur stdio.

**Qui détient quoi.**

| Secret | Détenteur | Risque résiduel |
|---|---|---|
| Clé API Anthropic | broker, fichier 0600 | Lisible par un natif du même uid (R-3) |
| Jeton de task, jeton de module | la sandbox concernée, broker ou gateway | Sans valeur hors de cette task et du loopback (R-4) |
| Identifiants Postgres | aucun, `peer` | |
| Compte Claude du propriétaire | outil de code 1a.0 seulement | R-1 ; jamais la plateforme : clé API obligatoire dès qu'elle sert quelqu'un d'autre |
| CI : fédération OIDC, `GATEWAY_CI_TOKEN` | secrets des workflows Claude | Aucun dans la porte de tests |

**Broker.** Le worker reçoit `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` et un jeton de task aléatoire comme `ANTHROPIC_API_KEY` : il n'a jamais la vraie clé [E-05, T-23, T-41]. Un seul listener, port fixe dans le profil. Le broker résout la task par le jeton (`401` sinon), réserve le budget, puis construit la requête amont : seul `POST /v1/messages*` passe, vers le seul `api.anthropic.com`, avec la clé dans le seul `x-api-key` et le corps inchangé. Les autres chemins répondent `403`. Le jeton ne protège pas d'un natif déterminé (R-3) ; il évite qu'un processus local quelconque dépense la clé en joignant le port, et il attribue le coût à une task. [à prouver : `broker.feature`, 1b ; appel réel avec une clé d'essai, requêtes invalides comprises (T-04R, décidé), 1b]

**Budgets.** Deux instructions atomiques, sans état par réservation :

```sql
-- budget.reserve : une ligne rendue = accepté, zéro = refus (plafond, task inconnue)
UPDATE platform.budgets SET reserved = reserved + $2 WHERE task = $1 AND reserved + spent + $2 <= cap RETURNING task;
-- budget.settle : à la fin de la réponse, coût tiré de `usage`
UPDATE platform.budgets SET reserved = reserved - $2, spent = spent + $3 WHERE task = $1;
```

La mise à jour conditionnelle tient le plafond exact en parallèle [T-20 : 300 réservations de 10 sur un plafond de 1 000, 100 acceptées]. Une requête interrompue ne règle jamais : son montant reste retenu, du côté prudent. Une facture supérieure s'enregistre, et la réservation suivante est refusée d'elle-même. Le broker ne rejoue pas : un seul `settle` par réservation. Si `data` est injoignable, le broker refuse. `maxBudgetUsd` et `maxTurns` restent le second rempart côté SDK. La facturation fait autorité, jamais `total_cost_usd`. La concurrence est un compteur en mémoire de la gateway. [à prouver : `budget.feature`, 1b.3]

**Organisation du dépôt.** Marketplace à la racine : `.claude-plugin/marketplace.json`, `plugins/`. Plateforme : `gateway/`, `data/`, `modules/`, `services/`, `packages/{contracts,sandbox}`. Descriptif : `topology/modules.mcp.json` (format `.mcp.json`), `agents/*.md`, `sandboxes/base.srt.json`, `modules/*/manifest.yaml`. Le nom provisoire vit dans `platform.json`, et `features/descriptive/name.feature` échoue si le littéral sort de la liste dérivée.

**Écarts avec v3.**

| v3 | Ici | Raison |
|---|---|---|
| Conteneurs, `compose.yaml` | Un processus srt par conteneur ; `topology/modules.mcp.json` | Décision du propriétaire ; Docker seulement là où srt n'est pas supporté (§6) |
| Pool chaud d'executors | Un executor lancé par session | Surcoût de 211 ms au lancement [T-10] : pas de pool à maintenir |
| `stage0/`, image promue, `fixpoint.sh` | Outil 1a.0 et porte exécutée depuis l'arbre testé | §7 et décision ouverte 3 |
| `--memory`, `--pids-limit` | `systemd-run` sur serveur ; aucune limite par sandbox sur macOS | [T-09] ; R-7 |

## 3. Parcours d'un appel `execute`

| # | De → vers | Quoi |
|---|---|---|
| 1 | Client → gateway | `execute(script)`, un des trois méta-tools (`search`, `describe`, `execute`) |
| 2 | Gateway | Auth, profil client, compteur de concurrence |
| 3 | Gateway | `SandboxRunner.start({ profile, task })` ; aucun script en argv |
| 4 | Executor → gateway | `initialize`, `tools/list` limité au profil, `task_input` qui rend le script |
| 5 | Executor → gateway | `tools/call memory.recall` ; identité = fermeture du handler |
| 6 | Gateway → module | Profil et `calls_allowed` contrôlés, puis `tools/call` sur stdio ; le module exécute sous srt |
| 7 | Module → gateway → executor | Résultat typé, jamais au client ; `max_result_tokens` du module |
| 8 | Executor | Le script filtre et agrège ; 5 à 8 se répètent |
| 9 | Executor → gateway | `task_complete` ; le groupe de processus est arrêté |
| 10 | Gateway → verify | Si du code est produit : `tools/call verify`, sous srt |
| 11 | Gateway → registre | Verdict validé ou gradé, tokens par couche et par modèle, en append-only par `data` |
| 12 | Gateway → client | ≤ `max_result_tokens`, sinon résumé déterministe + handle |

Les étapes 4 à 10 ne traversent jamais le contexte du client. [à prouver : `code-front.feature` avec un canari, `tools/list` client = méta-tools, brique 3]

`kind: agent` s'atteint par un `tools/call` à l'étape 6, pour le non stabilisable seulement : un worker sous srt par task, `query()`, handlers minces qui relaient vers la gateway. Budget au broker. Options fixes dans le code, plancher de sécurité : `permissionMode: 'dontAsk'`, `settingSources: []`, `strictMcpConfig`, `persistSession: false`, `CLAUDE_CONFIG_DIR` par task. L'option `sandbox` du SDK ne suffit pas : elle ne couvre que Bash, alors que srt enveloppe le processus entier, MCP et hooks compris.

Les arguments restent non fiables : Zod protège la structure, pas la sémantique. Trois règles au point d'effet : `task` vient de la gateway, jamais d'un argument ; un chemin passe par `realpath` sous le dépôt de la task, taille bornée, dans le module ; `data` n'expose que des opérations typées, avec limite de lignes. [à prouver : `arguments.feature`, briques 1b et 5]

## 4. Modèle de confiance et risques acceptés

**Portée.** Le poste du propriétaire, un seul uid ; puis des utilisateurs fiables. srt n'est ni une VM ni un conteneur renforcé : noyau partagé, préversion annoncée. Du contenu hostile multi-tenant est hors portée ; le jour où le besoin existe, c'est une décision du propriétaire (VM à évaluer, candidats au journal), pas une évolution de ce document. Moindre privilège : un profil par sorte de processus (§5), sur serveur un seul uid dédié à la plateforme (une gateway compromise a déjà tout, R-8), aucun identifiant Postgres, aucune lecture de secret par un agent de conception ou de CI.

**Ce que la conception garantit :**

| Propriété | Mécanisme | Preuve |
|---|---|---|
| Une sandbox de plateforme ne lit ni `~`, ni `.ssh`, ni l'état d'une autre task | `denyRead: ["~"]`, `cwd` jetable | [T-02, T-41c, deux OS] ; rien de sensible visible, sans viser un code d'erreur : macOS `EPERM`, Linux `tmpfs` |
| L'executor n'a aucun réseau, un module que la gateway, un worker que le broker | Allowlist du profil | [T-03, T-38, T-41] |
| Aucune clé API dans une sandbox | Broker | [E-05, T-23, T-41b] |
| Aucune sandbox n'atteint Postgres | Socket refusée, pas de TCP | [E-09, T-38] |
| Mort d'une task sans effet sur les autres ; le groupe tué ne laisse aucun descendant | Un enfant par task, `kill(-pgid)` | [E-06, T-06] ; R-7 |
| Le client ne voit ni résultat intermédiaire ni tool de module | §3 | [à prouver : `code-front.feature`, 3] |
| Écrire un hook ou `.git/config` nommés est refusé | `denyWrite` nommés | [T-02e4, deux OS] |

**Hooks de protection : une couche de réduction, à côté de srt, pas une frontière.** Pour l'outil 1a.0, des hooks Claude Code `PreToolUse`, simples et descriptifs, refusent les erreurs et les injections ordinaires avant que srt n'ait à répondre. Un Bash obfusqué ou un script lancé par `npm test` leur échappe : ils réduisent le risque, ils ne le ferment pas. Ils vivent dans `~/.claude/settings.json` ou un plugin de la marketplace, jamais dans un fichier que la sandbox peut écrire. Les hooks d'un `.claude/settings.json` de worktree ne comptent pas comme protection. Les workers de plateforme n'en dépendent pas (`settingSources: []`).

### 4.1 STRIDE

| Menace | Vecteur réel | Réponse | Sinon |
|---|---|---|---|
| **S** | Processus local qui joint le broker ou la gateway | Jeton opaque, `401` | R-3 |
| **T** | Une sandbox réécrit un hook, `.git/config`, son profil ou srt | `denyWrite` nommés ; profil et srt hors chemins inscriptibles ; hooks `PreToolUse` en 1a.0 | R-2 |
| **T** | Une PR affaiblit la porte | Visible au diff, revue, ruleset sur `main` | R-6 |
| **R** | Coût ou verdict non attribuable | Registre append-only (`0003_runs_immutable.sql`) | |
| **I** | Exfiltration par un domaine autorisé | Sandbox de plateforme : seul le broker. Outil 1a.0 : accepté | R-1, R-5 |
| **I** | Lecture de la clé | Broker, fichier 0600 ; uid dédié sur serveur | R-3 |
| **D** | Boucle, inondation, sandbox sans fin | Budgets, `maxTurns`, timeout, `maxBufferSize`, plafond d'octets, gateway qui survit [E-03] | R-7 |
| **E** | Évasion par espace de noms imbriqué | `allowNestedUserNamespaces`, `enableWeakerNestedSandbox`, `allowAllUnixSockets` refusés par schéma ; `escape.feature` | R-5 |
| **E** | Contenu non fiable qui atteint le lancement ou la gateway | Signature fermée, argv statique (§6) ; gateway limitée aux enveloppes, sans `eval` | R-8 |

### 4.2 Risques acceptés, écrits

| # | Risque | Pourquoi on vit avec | Ce qui le borne | On le rouvre si |
|---|---|---|---|---|
| R-1 | Outil 1a.0 : le trousseau est lisible depuis la sandbox, donc le jeton Claude et possiblement GitHub ; exfiltration et push possibles par les domaines autorisés (README srt, « Security Limitations ») | Outil personnel, poste du propriétaire, simplicité d'usage réel | Révocation ; réseau limité à trois fournisseurs ; `denyRead` ciblés ; hooks `PreToolUse` ; ruleset sur `main` comme limite | Tout usage par un tiers |
| R-2 | Tout ce que l'hôte lance dans le worktree exécute du code écrit par la sandbox : `git`, scripts npm, `.claude/settings.json`, `.envrc`. Sous Linux, un hook écrit dans un dépôt imbriqué non nommé persiste [T-34h, T-34i, T-02e, T-02e2]. Les dossiers de session de `~/.claude` restent inscriptibles et partagés avec les sessions hôte hors sandbox (à prouver, §8) | Même risque qu'aujourd'hui avec tout code d'agent ; la lecture du diff précède le lancement | `denyWrite` du dépôt principal ; revue | Un incident réel |
| R-3 | Un natif du même uid lit la clé ou un jeton [T-24, T-43d] | Il lirait déjà tout le reste du poste | Un uid dédié à la plateforme sur serveur | Serveur partagé |
| R-4 | Le modèle lit le jeton de sa task | Il n'atteint que le broker de sa task, plafonné par son budget, et ne vaut rien ailleurs | Budget, fin de task | |
| R-5 | Évasion de srt, faille du noyau, exfiltration du contenu par l'API de modèle (inhérente) | Aucune correction totale possible ; utilisateurs fiables | Banc rejoué à chaque montée de srt, `escape.feature`, version exacte | Un test d'évasion réussit (§6) |
| R-6 | Une PR hostile passe la porte verte : steps sans assertion, mutants tués [T-44] ; une assertion retirée ne se voit qu'au diff [T-22] ; une PR peut modifier la porte elle-même | Contributeurs fiables, tout passe par la revue | Diff, ruleset sur `main` | Un contributeur non fiable |
| R-7 | macOS : un enfant `setsid` survit à la mise à mort du groupe, et aucune limite mémoire ou PID par sandbox [T-06b, T-09] | Poste de développement | Timeout, budgets, `systemd-run` sur serveur [à prouver : brique D] | Serveur macOS |
| R-8 | Gateway compromise = plateforme compromise. Sous Docker, équivaut à root par la socket | Point de décision unique voulu | Code court, enveloppes seules ; socket Docker dans aucun conteneur | |
| R-9 | Dépassement de budget : montant retenu après interruption, jusqu'à intervention manuelle ; coût réel supérieur d'au plus une requête ; un `settle` rejoué débiterait deux fois | Le broker ne rejoue pas ; erreur du côté prudent | Plafond, registre, facture | Écart constaté sur facture |
| R-10 | Un module compromis ment sur la `task` au rappel ; un rejeu de son jeton reste possible pendant sa vie | Attribution seulement ; le profil reste celui du module | `calls_allowed`, fin de processus | |
| R-11 | Amont qui refléterait un en-tête d'authentification [T-04, T-42h] : aucun retrait en réponse | Hôte amont fixe ; un retrait se contourne par encodage | TLS vers `api.anthropic.com`, `T-04R` | T-04R observe un reflet |
| R-12 | `zod` imbriqué de srt, GHSA-mrhx-c7xc-m3w5, sans correctif ni override utile | Non exploitable depuis la sandbox : seul `safeParse` observé, sur la configuration de démarrage, écrite par nous | Fichier hors de portée de la sandbox | Usage de `srt proxy` ; relu à chaque montée |
| R-13 | Linux : `kernel.apparmor_restrict_unprivileged_userns=0`, réglage global exigé par bwrap sur Ubuntu 24.04 [E-07] | Runners jetables | Profil AppArmor dédié sur serveur [à prouver : brique D] | Déploiement Linux |

### 4.3 Chaîne d'approvisionnement

Versions exactes et lockfile, `npm ci --ignore-scripts` en CI [T-15] ; `.nvmrc` exact. `@cucumber/cucumber` reste à `12.9.0` : 13.x casse le runner Stryker [T-14]. srt `0.0.81` à relire et rejouer au banc à chaque montée. SBOM à la brique 1c : `npm sbom --sbom-format cyclonedx --package-lock-only --workspaces`, plus la version des paquets système. Actions de CI épinglées par SHA, `persist-credentials: false`. Sur les hôtes Linux : `bubblewrap`, `socat`, `ripgrep`. Postgres 17 : dépôt PGDG, absent d'`ubuntu-24.04` [T-16]. Aucun hash ni digest ne valide une sortie de build ; le SHA de commit et l'intégrité npm ne sont que des identifiants.

## 5. Profils

**Un gabarit, pas dix fichiers.** `sandboxes/base.srt.json` porte ce qui ne varie pas. La seule variable est le réseau, dérivé du manifeste ou de la sorte de processus. L'adaptateur fusionne, valide avec un schéma zod strict, écrit le résultat hors de `allowWrite` et le passe par `--settings`.

```json
{
  "network": { "allowedDomains": [], "deniedDomains": [] },
  "filesystem": {
    "denyRead": ["~"], "allowRead": ["."], "allowWrite": ["."],
    "denyWrite": [".git/hooks", ".git/config", ".mcp.json", ".claude"]
  }
}
```

| Sorte | Réseau | Lecture en plus | Modèle |
|---|---|---|---|
| executor | aucun | dist de l'executor | aucun |
| module (`data`, `workflow`) | gateway | dist et ressources du module | selon manifeste |
| agent : scout, builder, zetetic-reviewer, autres | broker | `agents/<nom>.md` choisit tools et modèle | selon profil |
| `egress` déclaré : web-scout | allowlist du manifeste, plages privées refusées | | aucun ; sortie en quarantaine |
| db-migrator | aucun ; Postgres jetable dans la sandbox | migrations du plugin | aucun |

**Ce que le banc impose, chaque point nommant un échec réel :**

- Schéma strict : srt tolère une clé mal écrite, `strictAllowlistt` passe sans erreur [T-01]. Le schéma refuse aussi les options d'affaiblissement (§4.1).
- `denyWrite` nommés : sous Linux, srt ne protège que ce qui existe au lancement [T-02e, T-02e2] ; nommés, ils tiennent [T-02e4, T-02e5, T-02e6].
- Un dossier temporaire par sandbox, `CLAUDE_CODE_TMPDIR` et `allowWrite`, retiré à l'arrêt : srt fixe `TMPDIR` sans le créer, le binaire et `tsx` échouent, et le poste donnait un faux vert (runs 41037109539 et 41037711860).
- `NO_PROXY` retiré de l'environnement du worker, sinon le loopback contourne le proxy et se fait refuser [T-03, T-41].
- srt installé hors de tout chemin inscriptible (README srt, « Where This Package Is Installed »).

**Profils de task.** `agents/<nom>.md`, format Claude Code, chargés par `query({ agents })` : par `plugins`, le corps du prompt n'atteint pas le modèle [E-08]. Un agent qui modifie du code travaille dans un worktree, comme en 1a.0 (R-2) ; un agent en lecture n'a que `allowRead` sur le dépôt.

**Manifeste de module.** La seule chose que lit la gateway ; il génère le module importable et le catalogue. Un manifeste invalide n'est pas routé.

```yaml
name: memory-recall
version: 1.2.0
domain: memory
owner: cortex
tools:
  - name: recall
    description: Rappel typé, filtré en SQL, rerank par Judge
    input_schema: ./schemas/recall.in.json   # output_schema idem
    kind: workflow           # data | workflow si le comportement est stable ; agent sinon
    max_result_tokens: 600
    validator: schema        # schema | verify | spec-lint | citations | none
    annotations: { readOnlyHint: true }
agent: null                  # kind: agent : { profile: scout, model_min: sonnet, budget_tokens: 40000, timeout_ms: 120000 }
egress: none                 # none ou domaines ; autre que none = écriture en quarantaine
writes_tables: []            # disjoints entre manifestes : un écrivain par table
reads_domains: [memory]
calls_allowed: [judge]       # vérifié par la gateway à chaque appel ; cycle refusé au chargement
```

Le réseau interne découle de `kind` : `data` et `workflow` joignent la gateway, `agent` le broker. Un tool `agent` marqué stable est refusé. Chaque règle tient dans une ligne du schéma de `packages/contracts` et un exemple de `manifest.feature`. [à prouver : 1b]

**Profils clients.** Fichier descriptif : modules visibles, modèle et effort, budgets, `mode: execute | catalog`. Le mode `catalog` sert les clients sans exécution, avec la boucle `registerTool` déjà présente dans `gateway/src/presentation/mcp-server.ts`.

## 6. Port `SandboxRunner`

```ts
interface SandboxRunner {
  start(req: { profile: ProfileName; task: TaskId }): Promise<Sandbox>;
}
// Sandbox : { stdin, stdout, stop() }, deux flux opaques et un arrêt
```

Un seul port, dans `packages/sandbox`, appelé par la seule gateway. C'est le lieu de lancement, et il n'a que cinq règles :

- La signature n'accepte aucun contenu : script et prompt arrivent ensuite par `task_input`.
- `spawn` sans shell, argv statique, environnement en liste fermée.
- `stdio` est la constante `['pipe', 'pipe', 'pipe']`, sans paramètre : un socket d'écoute passé en fd 0 servirait sous Linux [T-07-fd0], et aucun appelant ne peut en passer.
- `detached` et `kill(-pgid)`, jamais `kill` sur `srt` seul, qui laisse des descendants (10 sur 11 sous Linux) [T-06].
- `stdin.on('error')`, `maxBufferSize` et plafond d'octets sur toute sortie lue : l'hôte tombait sans [E-02, E-03].

Garde : `child_process` et `@anthropic-ai/sandbox-runtime` ne s'importent que dans `packages/sandbox`, règle dependency-cruiser et fixture. [à prouver : 1b]

**Adaptateurs.** srt par défaut. Docker seulement là où srt n'est pas supporté, par un champ de configuration explicite, jamais par détection ni bascule. `services/memory/src/infrastructure/docker-runner.ts` existe, avec ses options durcies : il passe derrière le port, sans s'étendre. Sa socket n'est montée dans aucun conteneur. Sa preuve d'équivalence (joindre le broker sans réseau, arrêt par `docker rm -f`) s'écrit au premier hôte réel qui en a besoin, et Podman ensuite par les mêmes options.

**srt non supporté** : ni macOS avec `sandbox-exec`, ni Linux x64/arm64 avec `bwrap`, `socat`, `ripgrep` et des espaces de noms utilisateur ; `kernel.apparmor_restrict_unprivileged_userns=1` sans profil AppArmor ; conteneur sans espaces de noms utilisateur [E-07] ; root sans `CAP_SETFCAP`.

**Canari, léger.** Au démarrage, une sandbox doit échouer à lire un fichier hors `allowRead` et à joindre une adresse hors allowlist. Tout autre résultat : `ISOLATION_UNAVAILABLE`, refus de démarrer, aucun repli. [à prouver : `canary.feature`, 1b]

**Montée de srt.** Le banc se rejoue à chaque montée de version et le rapport se compare au précédent, dans les deux sens, par OS (T-54). Un test d'évasion réussi que srt ne corrige pas, ou un abandon de srt, rouvre le choix : options et test de pérennité au journal.

## 7. Porte de CI

Seul le résultat des tests fait foi : aucun hash, aucun digest.

**Trois familles** : e2e Gherkin (`features/**`, srt et Postgres réels), unitaires Gherkin (`<composant>/features/**`), mutation Stryker. Typecheck, format, garde d'architecture et validation du plugin sont des scénarios. Outils : `@cucumber/cucumber` 12.9.0, `@stryker-mutator/*` 10.1.1, `tsx` [T-13, T-14].

**Le compte.** `exécutés = base + ajoutés − supprimés`.

1. L'unité est le pickle : un `Scenario`, une ligne d'`Examples`, un `Scenario` de `Rule` [T-12].
2. `base` = pickles des `.feature` du premier parent du commit de merge ; `ajoutés` et `supprimés` = différence d'ensembles avec la tête, dérivée du diff, jamais déclarée. L'identité d'un pickle : chemin, `Feature`, `Rule`, `Scenario`, ligne d'`Examples`.
3. La porte est verte si et seulement si tous les pickles attendus sont exécutés, verts, une seule tentative, chaque step `PASSED`. Elle lit le rapport Messages, jamais `TestRunFinished.success` : un step `SKIPPED` y donne `success: true` et un code de sortie 0 [T-13c]. `cucumber.mjs` n'a ni `tags` ni `name`, `retry: 0` ; une table `Examples` calculée est interdite.

Base comptée statiquement, la somme égale le compte statique de la tête : la protection réelle est `exécutés = statique`, qui attrape filtres, skips et steps absents, et le résumé `+a −s` rend toute suppression visible à la revue. Rien n'est lu d'un run précédent.

**Mutation.** 0 survivant sur les lignes modifiées du diff, sources de production. `Survived`, `NoCoverage`, `Pending` échouent ; `Killed`, `Timeout` passent. Un équivalent se marque `// Stryker disable next-line <Mutateur>: équivalent: <invariant>` : la porte juge la forme, la revue l'équivalence. Du code exécuté seulement dans un processus enfant survit [T-14b] : d'où les ports avec adaptateur en mémoire, déjà la règle du dépôt. Coût mesuré : 46 à 75 ms par mutant [M-01].

**Où.** `gate.yml`, `pull_request` et `push` sur `main`, runners hébergés, `contents: read`, aucun secret, aucun cache, `fetch-depth: 2`. `gate-linux` lance tout ; `gate-macos` lance `features/sandbox/` seulement, parce que srt y diffère réellement [T-02e, T-07-fd0, T-39b] et que le reste n'en dépend pas. Un ruleset protège `main`, les deux jobs requis. `CLAUDE.md` s'amende en 1a pour permettre le diff des `.feature` contre le premier parent. Une commande locale : `npm run gate`.

Le code de la porte vit dans l'arbre testé (`tools/test-gate`) : un commit qui le casse échoue à sa propre porte, et il n'y a rien à promouvoir. Il se teste avec des rapports fixtures : step non défini, step `pending`, filtre, scénario sans step, pickle absent, mutant survivant, `Stryker disable all`. Toute manipulation délibérée relève de R-6.

## 8. Briques

Une brique s'arrête sur sa preuve. Ordre d'exécution : 1a.0, puis 1a, 1b, 1c, 2 à 8, D. Le banc 1b.0 a tourné : il ne reste qu'à le rejouer à chaque montée de srt.

### 1a.0 Outil de code isolé, stage 0 simplifié

Un fichier `builder.json` par worktree, hors de tout chemin inscriptible, une commande : `srt --settings builder.json claude`, dans le worktree habituel `<repo>/.claude/worktrees/<w>`. C'est tout. Le reste de la plateforme se construit dedans.

| Élément | Choix, sous réserve de la décision 1 |
|---|---|
| `allowWrite` | Le worktree ; `<repo>/.git/worktrees/<w>`, `.git/objects`, `.git/refs`, `.git/logs` ; `~/.cache` et les dossiers de session de `~/.claude` |
| `denyWrite` | `<repo>/.git/hooks`, `<repo>/.git/config`, `worktrees/<w>/commondir`, `gitdir`, `config.worktree`, `refs/heads/main` ; `<worktree>/.claude/settings.json` et `settings.local.json` |
| `denyRead` | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.npmrc`, `~/.netrc` |
| Réseau | Anthropic, npm, GitHub |
| Authentification | Le compte Claude du propriétaire ; `CLAUDE_CONFIG_DIR` non défini ; srt installé hors du worktree |
| Hooks `PreToolUse`, jeu minimal à confirmer | Refuser `git push` vers `main` et les push forcés ; l'accès au trousseau et aux identifiants (`security find-*`, fichiers de secrets) ; les écritures dans `.git/hooks` et `.git/config` |
| Résidus | R-1, R-2 ; les objets écrits par la sandbox sont lus par le `git` de l'hôte ; `main` est tenue par un ruleset |

**Faisabilité, vérifiée sur le poste macOS** : la commande fonctionne en `-p` avec le compte Claude, un appel réel minimal. Le profil initial, limité à `.git/hooks` et `.git/config`, casse `git commit` et permet une évasion prouvée par réécriture de `.git/worktrees/<w>/commondir` : d'où les lignes ci-dessus. **À prouver : la TUI au premier lancement.**

**Pourquoi les réglages du worktree sont refusés.** `~/.claude/settings.json` et les scripts ou plugins de hooks restent hors de `allowWrite` (profil relu) : srt y refuse l'écriture par défaut. Mais srt ne protège pas `.claude/settings.json`, seulement `.claude/commands` et `.claude/agents`. Or un fichier de projet a priorité sur l'utilisateur et se recharge en cours de session (doc Claude Code, settings et hooks) : un `disableAllHooks: true` écrit dans le worktree couperait les hooks de `~/.claude/settings.json`. Ce cas se déduit de la doc et reste à prouver. D'où les deux `denyWrite` ; ne pas ajouter `~/.claude.json` ni `~/.claude/settings.json` à `allowWrite` pour faire passer la TUI.

**Sortie** : la TUI répond dans la sandbox ; un commit réussit dans le worktree ; l'écriture de `.git/hooks/x`, `.git/config`, `worktrees/<w>/commondir`, `~/.claude/settings.json` et `<worktree>/.claude/settings.json` est refusée, y compris en renommant `.claude` ; chaque hook du jeu minimal refuse son cas nominal ; une session hôte hors sandbox n'exécute rien écrit par la sandbox dans `~/.claude/shell-snapshots` ou `session-env`, sinon ces dossiers sortent de `allowWrite` ; `~/.ssh` est illisible ; `npm ci` passe ; un domaine hors liste est refusé. Essai consigné au journal. **Test externe** : la brique 1a démarre dans l'outil.

### 1a Gherkin et porte

Épingler la chaîne et les quatre workflows par SHA. Migrer les 119 cas vitest vers Gherkin, `skipIf` retiré, Postgres fourni [E-09 : 119/119]. Écrire `tools/test-gate` et `gate.yml`. Correction minimale des workflows Claude, dont la revue n'a jamais produit de revue et qu'un externe ne peut pas lancer : épinglage par SHA, garde sur l'acteur, ruleset sur `main`. Retirer vitest. Amender `CLAUDE.md`, dont la mention que `bench/` est hors production.

**Sortie** : 0 `*.test.ts` ; `exécutés = base + ajoutés − supprimés` sur `main` ; rapports fixtures refusés (§7) ; 0 survivant sur le diff d'une PR réelle. **Test externe** : une PR saine verte ; une PR qui ajoute un filtre `tags` à `cucumber.mjs`, rouge.

### 1b srt, broker, topologie

| Étape | Contenu | Sortie |
|---|---|---|
| 1b.1 | `packages/sandbox` : port, adaptateur srt, gabarit, schéma, canari ; `docker-runner.ts` derrière le port, avec un plafond d'octets sur stdout (`docker-runner.ts:93-99`, sans borne : 2 Mo donnent 545 Mo de tas) | `canary.feature`, `spawn.feature` (enfant hostile, sortie au-delà du plafond refusée, groupe tué), garde et fixture |
| 1b.2 | `modules/broker` en flux, clé API, jeton de task | `broker.feature` : sans jeton `401`, hors chemin `403` ; aucune clé en sandbox ; appel réel (T-04R) |
| 1b.3 | `data` en MCP généré depuis `DATA_OPS` ; SQL dans `data/sql/*.sql`, budgets | `budget.feature` : 300 réservations parallèles, plafond exact ; facture supérieure ; `data` absent = refus |
| 1b.4 | Gateway : lit `modules.mcp.json`, lance les modules, serveur MCP par sandbox, 3 reconnexions puis `SERVICE_UNAVAILABLE` ; sandbox jamais relancée | `gateway.feature` : hors `calls_allowed` refusé et journalisé ; module tué puis reconnecté |
| 1b.5 | Memory : module et worker sous srt, `agents/*.md` ; retrait de `internal-http.ts` ; `.max()` sur `WorkerOutputSchema.evidence` (`tools.ts:82`, sans borne) | `recall` e2e à travers un vrai `srt`, faux amont ; `evidence` trop grande rejetée |
| 1b.6 | Retrait de `compose.yaml` ; `proxy/` vers `deploy/edge/` ; docs à jour | `npm run gate` vert |

**Sortie** : Linux et macOS verts sur `features/sandbox/escape.feature`, un seul `Scenario Outline` lancé contre de vrais processus pour chaque sorte de profil : lire un faux `~/.ssh/id_test`, écrire hors `.`, écrire `.git/hooks/pre-commit`, joindre `example.com`, `169.254.169.254`, le socket Postgres, lire le répertoire d'une autre task, `unshare -r`.

### Suite

| # | Brique | Contenu | Sortie |
|---|---|---|---|
| 0 | Baseline | 20 tâches, M1, M2 ; à la date du propriétaire | Chiffres écrits dans `baseline/results/` |
| 1c | Marketplace | Marketplace et plugins, `alwaysLoad`, SBOM, workflows Claude en OIDC, hook M1 | `claude plugin validate . --strict` = 0 [T-11] ; installation dans un `HOME` jetable ; aucune clé statique |
| 2 | Catalogue, registre, recall | Mode `catalog`, registre, profil `ci-review`, `memory-recall` en `workflow` | Résultat au-delà de `max_result_tokens` = résumé + handle ; appel hors profil refusé ; T(orchestration directe) relevé |
| 3 | Front de code | `search`, `describe`, `execute` (fusion des deux premiers mesurée ici), modules importables, executor par session | `code-front.feature` ; réseau refusé ; R et définitions relevés |
| 4 | Scission Cortex | `memory-write`, `memory-consolidate`, un écrivain par table, db-migrator ; extension BM25, une à la fois | Écriture hors `writes_tables` refusée au chargement |
| 5 | Code et tasks | `code-index`, `verify`, `codebase-ask` ; scout, builder, zetetic-reviewer | Citation invalide rejetée par `verify` ; builder confiné à son worktree ; `claude-review` réel |
| 6 | Spec | `spec-draft`, `spec-lint`, `issue-to-spec.yml` | Spec sans critère rejetée |
| 7 | Mission Control | Onglet sur le registre | Tokens par couche visibles sur une task réelle |
| 8 | Modèles, web-scout | Structurer, Judge, Embedder désactivé, web-scout | Quarantaine seule ; adresse privée refusée ; accepté si M1 baisse sans hausse de M2 |
| D | Serveur | `deploy/`, un uid dédié, TLS par Caddy, `systemd-run`, profil AppArmor | Limites mémoire et PID prouvées ; profil AppArmor prouvé sans sysctl global (R-13) |

## 9. Décisions ouvertes

| # | Question | Recommandation |
|---|---|---|
| 1 | Profil 1a.0 du §8, plus large que celui demandé, risques R-1, R-2 tels qu'écrits, jeu minimal de hooks et son emplacement | Accepter : le profil demandé casse `git commit` et laisse une évasion prouvée. Hooks dans un plugin de la marketplace : `~/.claude/settings.json` s'appliquerait aussi à toutes les sessions hors de l'outil. Réponse du propriétaire attendue |
| 2 | Revenir sur O-1 (`pull_request_target`), O-23 (`CODEOWNERS`), O-26 (purge des 474 mutants, condition de la mutation étendue) | Confirmer : §7 applique les trois retraits. v3 elle-même demande `pull_request` et un run sur `pull_request_target` exécute le code d'une PR avec plus de droits. `CODEOWNERS` revient au second mainteneur |
| 3 | Retirer la reconstruction de stage 0 de v3 (`fixpoint.sh`, image ou paquet promu) | Confirmer : la plateforme n'est pas un compilateur, `npm ci` sur lockfile et `tsc -b` sont reproductibles par la porte, et le problème d'amorçage disparaît sans image à promouvoir |
| 4 | Passe de code sur le banc : le SQL de l'annexe vers `bench/sql/`, retrait de T-42, T-43, T-45 du banc, correction d'E-03-huge | Oui, une PR courte ; le banc rejoué à chaque montée de srt n'a pas à payer des mécanismes retirés |
| 5 | Date de la baseline (D-7) et nom définitif | Au propriétaire |

## Annexe : entrée du banc, pas la conception

`bench/src/tests/t45.ts` extrait son SQL de ce fichier, entre les deux titres ci-dessous, et le push sur cette branche déclenche le banc : ce bloc reste inchangé jusqu'à la décision 4. La conception des budgets est au §2 ; états et réservations identifiées sont retirés, résultats au journal.

### 4.5 Budgets

```sql
-- budget.reserve($1 task, $2 reservation_id, $3 amount)
BEGIN;
SELECT cap FROM platform.budgets WHERE task = $1 FOR UPDATE;
WITH ins AS (
  INSERT INTO platform.budget_reservations (id, task, amount, state)
  SELECT $2, b.task, $3, 'reserved'
    FROM platform.budgets b
   WHERE b.task = $1 AND NOT b.overdrawn AND b.reserved + b.spent + $3 <= b.cap
  ON CONFLICT (id) DO NOTHING
  RETURNING task, amount)
UPDATE platform.budgets b SET reserved = b.reserved + ins.amount FROM ins WHERE b.task = ins.task;
SELECT id, task, amount, state FROM platform.budget_reservations WHERE id = $2;
COMMIT;

-- budget.settle($1 reservation_id, $2 source, $3 coût réel, $4 auteur, $5 motif)
BEGIN;
SELECT b.task FROM platform.budgets b WHERE b.task = (SELECT task FROM platform.budget_reservations WHERE id = $1) FOR UPDATE;
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
```

### 4.6 Fin de l'entrée du banc
