# ai-architect.tools : plateforme v3 sous sandbox-runtime (srt)

`ai-architect.tools` est la marque ; `architect-os` reste le nom provisoire du dépôt et du code. Conception, 30 octobre 2026, réécrite depuis `0dd97c5`, amendée le même jour après audit (§9). Elle amende la vision v3 (`docs/design/platform-v3.html`, inchangée) et se lit d'une traite. L'historique est dans [`journal.md`](journal.md) : résultats du banc, décisions, échecs, sort de chaque mécanisme retiré. Le journal d'expériences reste [`bench/JOURNAL.md`](../../bench/JOURNAL.md), et l'ancien texte complet reste dans git à `0dd97c5`. Figures : [`platform-v3-srt.html`](platform-v3-srt.html).

Position du propriétaire, qui règle ce document :

> « La logique repose sur la confiance, et concrètement aucune des failles de sécurité n'est totalement correctible, il faut savoir vivre avec, amenuiser les risques de manière pragmatique. L'over engineer n'a pas sa place. La meilleure des architectures est une architecture propre et simple. »

Règle de lecture : un mécanisme n'est ici que si son retrait laisse un risque réel, nommé. Tout autre risque est accepté par écrit (§4.2).

Preuves : `[T-xx]` ou `[E-xx]` désigne une expérience jouée, dont le résultat est au journal. `[à prouver : scénario, brique]` désigne ce qui n'a pas encore tourné ; rien de ce qui est ainsi marqué n'est livré avant son scénario.

## 1. Objectif

Réduire le contexte et les tokens consommés par tâche (objectif unique de v3), avec un seul chemin d'exécution pour le produit, le développement et la CI. Le client voit trois méta-tools ; il écrit du code ; l'exécuteur appelle les modules, filtre, et ne rend qu'un résultat borné. Le produit reste la v3. Seule sa réalisation change : un conteneur v3 devient un processus srt.

Mesures v3 : M1, tokens de contexte client par tâche, en baisse ; M2, tokens totaux par couche et par modèle, jamais en hausse quand M1 baisse ; définitions ≤ 1 500, recall ≤ 600, résultat de tool ≤ 1 000 tokens ; R = 1 − T(code execution) / T(orchestration directe), mesuré sur les mêmes tâches en brique 3. Aucune ne bloque une porte tant que le propriétaire n'a pas fixé la date de la baseline (D-7, brique 0).

| Pilier | Fait | Prévu | Sans objet |
|---|---|---|---|
| Recherche | Banc Linux et macOS, 106 tests, échecs conservés, run 41044838678, une commande : `cd bench && npm run bench:sandbox` | TUI de 1a.0 ; banc rejoué à chaque montée de srt (T-54) ; M1, M2, R aux briques 1c à 3 ; baseline à la brique 0 | |
| SSDLC | STRIDE court et risques acceptés (§4), usurpation d'une task hors des appels actifs refusée, confusion entre appels concurrents d'un même module acceptée (R-10) ; dépendances épinglées, lockfile (§4.3) | SBOM en 1c ; SAST = porte de tests, brique 1a ; DAST = `escape.feature`, brique 1b | |
| Opérationnel | Moindre privilège par profil (§5) ; aucun secret lu pour écrire ce document | Clé API seule dans le broker, brique 1b ; sur serveur un uid propre au broker, brique D | IRB : aucune donnée humaine ; à revoir en brique 4 si la mémoire en reçoit |

## 2. Topologie

```
 client (Claude Code, Codex, claude-code-action)
    |  MCP http, 127.0.0.1 ; TLS par le déploiement sur serveur
    v
 natifs, quatre exceptions prouvées
    gateway      seul point de décision, seul parent des sandboxes ; auth, profils,
                 calls_allowed, writes_tables, identifiants d'appel, budgets (décision),
                 registre, max_result_tokens
    broker       seul détenteur de la clé API ; exécute réserve et règlement ; POST /v1/messages seul
    data         seul importeur de pg ; opérations typées en tools MCP
    postgres 17  listen_addresses='' ; peer sur socket Unix, aucun mot de passe
    |  MCP stdio, créé par l'adaptateur
    v
 sous srt, un processus par conteneur v3
    executor     1 par session ; réseau nul, aucun jeton
    module       1 par module data, workflow ou plugin ; réseau : gateway
                 memory-*, code-index, verify, spec-lint ; Structurer, Judge, Embedder (workflow, brique 8)
    manifest-registry  lit les manifestes, écrit modules importables et catalogue ; réseau nul
    worker       1 par task ; query(), handlers minces, binaire Claude Code ; réseau : broker
                 codebase-ask, spec-draft, scout, builder, zetetic-reviewer
    web-scout    allowlist du manifeste ; db-migrator : réseau nul
```

**Pourquoi quatre natifs.** Un processus sous srt ne sert pas de listener joignable par l'hôte : macOS `EPERM`, Linux `ECONNREFUSED` [T-39b, T-07]. D'où gateway et broker. Sous Linux, `allowUnixSockets` est ignoré (README srt), donc `data` et Postgres, joints par socket Unix, restent natifs ; ce montage est prouvé [E-09]. Tout le reste tourne sous srt, plugins compris : le code et le contenu non fiables n'ont pas de chemin natif. Le reverse proxy de v3, Caddy, reste natif devant la gateway (`deploy/edge/`, brique D) et n'exécute aucun contenu non fiable. Correspondance avec la figure 1 de v3 : §9, A.

**Un seul transport.** Tous les liens internes sont MCP stdio avec le SDK officiel, aucun protocole maison. Un module est serveur MCP, la gateway est son client [E-01, T-38]. L'executor et le worker sont clients MCP sur leurs propres stdin/stdout, la gateway est serveur sur les flux de l'enfant, parce qu'ils appellent des tools et que MCP ne permet pas l'inverse [E-02 : 1 000 allers-retours en 45 ms sous srt, 38 ms sans]. Leur identité est la fermeture du handler : un `_meta.task` forgé est ignoré, un enfant hostile n'abat pas l'hôte [E-03]. `query()` et le binaire vivent dans la même sandbox [T-41, deux OS, faux amont]. `type: http` vers un module est refusé par schéma.

**Identifiant d'appel.** À chaque `tools/call` vers un module, la gateway crée un identifiant opaque aléatoire, sans cryptographie, le passe dans `_meta` et le relie en mémoire à {task, parent, profondeur, échéance} ; elle l'invalide au retour. Le module le présente à son rappel, par le proxy srt vers `127.0.0.1:8080` [T-38] ; inconnu ou invalidé : `401`. La gateway en tire la task, le parent et l'identité du module appelant, dont le profil est son `calls_allowed` : `task` ne vient jamais d'un argument. Un module n'est joignable que par son parent, sur stdio. **Budget le long du DAG** : l'identifiant porte la profondeur (parent + 1, refus au-delà du maximum du profil client) et l'échéance (min de celle du parent et du `timeout` du module) ; à l'échéance, la gateway annule l'appel et invalide l'identifiant. Les tokens ne se dépensent qu'au broker, par task. Un appel sans modèle est donc borné par son échéance, sa profondeur, `max_result_tokens` et le plafond d'octets, pas par des tokens. [à prouver : `gateway.feature`, 1b.4]

**Qui détient quoi.**

| Secret | Détenteur | Risque résiduel |
|---|---|---|
| Clé API Anthropic | broker, fichier 0600 | Lisible par un natif du même uid (R-3) |
| Jeton de task (gateway), identifiant d'appel (gateway) | worker de la task ; module, le temps de l'appel | Sans valeur hors de cette task, de cet appel et du loopback (R-4) |
| Identifiants Postgres | aucun, `peer` | |
| Compte Claude du propriétaire | outil de code 1a.0 seulement | R-1 ; jamais la plateforme : clé API obligatoire dès qu'elle sert quelqu'un d'autre |
| CI : fédération OIDC, `GATEWAY_CI_TOKEN` | secrets des workflows Claude | Aucun dans la porte de tests |

**Broker.** Le worker reçoit `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` et un jeton de task aléatoire comme `ANTHROPIC_API_KEY` : il n'a jamais la vraie clé [E-05, T-23, T-41]. Un seul listener, port fixe dans le profil. Ordre, une règle : la gateway crée la ligne `budgets` avec le plafond, écrit {jeton, task} sur le stdin du broker (son enfant natif, lancé avant tout worker), puis lance le worker. Le broker résout le jeton vers une task connue (`401` sinon), ne reçoit jamais de plafond du worker, réserve sur le plafond de la ligne `budgets`, puis construit la requête amont : seul `POST /v1/messages*` passe, vers le seul `api.anthropic.com`, avec la clé dans le seul `x-api-key` et le corps inchangé. Les autres chemins répondent `403`. Le jeton ne protège pas d'un natif déterminé (R-3) ; il évite qu'un processus local quelconque dépense la clé en joignant le port, et il attribue le coût à une task. [à prouver : `broker.feature`, 1b ; appel réel avec une clé d'essai, requêtes invalides comprises (T-04R, décidé), 1b]

**Budgets : la gateway décide, le broker exécute.** La gateway crée la ligne `budgets` de la task avec son plafond (profil client, `agent.budget_tokens`) ; le broker réserve et règle par `data`, sans rien décider. Une table de réservations, un identifiant tiré au hasard par le broker à chaque requête, deux instructions :

```sql
CREATE TABLE platform.budgets (task text PRIMARY KEY, cap bigint NOT NULL CHECK (cap >= 0),
  reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0), spent bigint NOT NULL DEFAULT 0 CHECK (spent >= 0));
CREATE TABLE platform.budget_reservations (id text NOT NULL UNIQUE,
  task text NOT NULL REFERENCES platform.budgets(task), amount bigint NOT NULL CHECK (amount >= 0));
-- budget.reserve($1 task, $2 id, $3 montant) : une ligne = accepté ; zéro ligne = rejeu ou refus de plafond (voir le contrat) ; 23505 = id déjà vu, plafond accepté, rien d'écrit
WITH b AS (UPDATE platform.budgets SET reserved = reserved + $3
            WHERE task = $1 AND reserved + spent + $3 <= cap RETURNING task)
INSERT INTO platform.budget_reservations (id, task, amount) SELECT $2, task, $3 FROM b RETURNING id;
-- budget.settle($1 id, $2 coût tiré de `usage`) : une ligne = réglé ; rejoué, ne trouve rien et ne fait rien
WITH r AS (DELETE FROM platform.budget_reservations WHERE id = $1 RETURNING task, amount)
UPDATE platform.budgets b SET reserved = b.reserved - r.amount, spent = b.spent + $2
  FROM r WHERE b.task = r.task RETURNING b.task;
```

Contrat de `reserve` sur 0 ligne : le broker vérifie par `data` l'existence de l'`id` dans `budget_reservations` ; présent = rejeu idempotent (succès, rien de nouveau), absent = refus de plafond. Le `23505` n'arrive que si le plafond accepte un `id` déjà vu : le zéro ligne est sinon indiscernable d'un refus, le rejeu de 60 sur plafond 100 déjà retenu à 60 donne 0 ligne sans erreur [X-1, budget-sql.out]. Un coût négatif ouvrirait le plafond (`spent` à −500, réservation de 1 400 acceptée sur 1 000) : les `CHECK` le bornent, et `data` refuse à sa frontière un coût de `settle` négatif [atomicity.out, C].

Le test du plafond reste sur l'`UPDATE`, réévalué après le verrou : il tient le plafond exact en parallèle [T-20 : 300 réservations de 10 sur un plafond de 1 000, 100 acceptées]. Une requête interrompue garde sa réservation : montant retenu, du côté prudent, jusqu'à un `settle` manuel. La concurrence est un compteur en mémoire de la gateway, écart accepté au « stateless » de v3 : il ne compte que ses enfants vivants, qui meurent avec elle (fin de stdin) ; dans `data`, il coûterait une écriture par appel et fuirait à chaque arrêt brutal ; un enfant qui survivrait reste borné par son budget [à prouver : `spawn.feature`, 1b.1]. Une facture supérieure s'enregistre, et la réservation suivante est refusée d'elle-même. Si `data` est injoignable, le broker refuse. `maxBudgetUsd` et `maxTurns` restent le second rempart côté SDK. La facturation fait autorité, jamais `total_cost_usd`. Les deux instructions prennent les lignes dans l'ordre inverse : l'interblocage `reserve(X)` rejoué × `settle(X)` vu sur l'ancien SQL est à rejouer, il ne coûte au pire qu'une erreur `40P01` sans écriture. [à prouver : T-45 rejoué sur ce SQL, concurrence et rejeu ; `budget.feature`, 1b.3]
**Organisation du dépôt.** Marketplace à la racine : `.claude-plugin/marketplace.json`, `plugins/`. Plateforme : `gateway/`, `data/`, `modules/`, `services/`, `packages/{contracts,sandbox}`. Descriptif : `topology/modules.mcp.json` (format `.mcp.json`), `agents/*.md`, `sandboxes/base.srt.json`, `modules/*/manifest.yaml`. Le nom provisoire vit dans `platform.json`, et `features/descriptive/name.feature` échoue si le littéral sort de la liste dérivée.

**Écarts avec v3.**

| v3 | Ici | Raison |
|---|---|---|
| Conteneurs, `compose.yaml` | Un processus srt par conteneur ; `topology/modules.mcp.json` | Décision du propriétaire ; Docker seulement là où srt n'est pas supporté (§6) |
| Pool chaud d'executors | Un executor lancé par session | Surcoût de 211 ms au lancement [T-10] : pas de pool à maintenir |
| `stage0/`, image promue, `fixpoint.sh` | Outil 1a.0 et porte exécutée depuis l'arbre testé ; aucune affirmation de reproductibilité du build | Décision 6 (§9) |
| `--memory`, `--pids-limit` | `systemd-run` sur serveur ; aucune limite par sandbox sur macOS | [T-09] ; R-7 |

## 3. Parcours d'un appel `execute`

| # | De → vers | Quoi |
|---|---|---|
| 1 | Client → gateway | `execute(script)`, un des trois méta-tools (`search`, `describe`, `execute`) |
| 2 | Gateway | Auth, profil client, compteur de concurrence ; ouvre la task, sa `trace` et son `parent` (nul pour un appel client), son plafond |
| 3 | Gateway | `SandboxRunner.start({ profile, task })` ; aucun script en argv |
| 4 | Executor → gateway | `initialize`, `tools/list` limité au profil, `task_input` qui rend le script |
| 5 | Executor → gateway | `tools/call memory.recall` ; identité = fermeture du handler |
| 6 | Gateway → module | Profil, `calls_allowed`, profondeur contrôlés ; identifiant d'appel créé ; `tools/call` sur stdio ; le module exécute sous srt |
| 7 | Module → gateway → executor | Résultat typé, jamais au client ; `max_result_tokens` du module |
| 8 | Executor | Le script filtre et agrège ; 5 à 8 se répètent |
| 9 | Executor → gateway | `task_complete` ; le groupe de processus est arrêté |
| 10 | Gateway → verify | Si du code est produit : `tools/call verify`, sous srt |
| 11 | Gateway → registre | `trace`, `parent`, verdict validé ou gradé, tokens par couche et par modèle, en append-only par `data` |
| 12 | Gateway → client | ≤ `max_result_tokens`, sinon résumé déterministe + handle |

Les étapes 4 à 10 ne traversent jamais le contexte du client. [à prouver : `code-front.feature` avec un canari, `tools/list` client = méta-tools, brique 3]

`kind: agent` s'atteint par un `tools/call` à l'étape 6, pour le non stabilisable seulement : un worker sous srt par task, `query()`, handlers minces qui relaient vers la gateway. Plafond décidé par la gateway, appliqué au broker. Options fixes dans le code, plancher de sécurité : `permissionMode: 'dontAsk'`, `settingSources: []`, `strictMcpConfig`, `persistSession: false`, `CLAUDE_CONFIG_DIR` par task. L'option `sandbox` du SDK ne suffit pas : elle ne couvre que Bash, alors que srt enveloppe le processus entier, MCP et hooks compris.

Les arguments restent non fiables : Zod protège la structure, pas la sémantique. Quatre règles au point d'effet : `task` vient de la gateway, par l'identifiant d'appel, jamais d'un argument ; un chemin passe par `realpath` sous le dépôt de la task, taille bornée, dans le module ; `data` n'expose que des opérations typées, avec limite de lignes ; à chaque opération, la gateway refuse une table écrite hors du `writes_tables` du module appelant, identifié par l'identifiant d'appel, chaque opération déclarant ses tables dans `DATA_OPS`. [à prouver : `arguments.feature`, `gateway.feature`, briques 1b et 4]

## 4. Modèle de confiance et risques acceptés

**Portée.** Le poste du propriétaire, un seul uid ; puis des utilisateurs fiables. srt n'est ni une VM ni un conteneur renforcé : noyau partagé, préversion annoncée. Du contenu hostile multi-tenant est hors portée ; le jour où le besoin existe, c'est une décision du propriétaire (VM à évaluer, candidats au journal), pas une évolution de ce document. Moindre privilège : un profil par sorte de processus (§5) ; sur serveur, un uid propre au broker, seul détenteur de la clé, et un uid que gateway et `data` peuvent partager (R-8) ; aucun identifiant Postgres, aucune lecture de secret par un agent de conception ou de CI.

**Ce que la conception garantit :**

| Propriété | Mécanisme | Preuve |
|---|---|---|
| Une sandbox de plateforme ne lit ni `~`, ni `.ssh`, ni l'état d'une autre task | `denyRead: ["~"]`, `cwd` jetable (§5) | [T-02, T-41c, deux OS] ; rien de sensible visible, sans viser un code d'erreur : macOS `EPERM`, Linux `tmpfs` |
| L'executor n'a aucun réseau, un module que la gateway, un worker que le broker | Allowlist du profil | [T-03, T-38, T-41] |
| Aucune clé API dans une sandbox | Broker | [E-05, T-23, T-41b] |
| Aucune sandbox n'atteint Postgres | Socket refusée, pas de TCP | [E-09, T-38] |
| Mort d'une task sans effet sur les autres ; le groupe tué ne laisse aucun descendant | Un enfant par task, `kill(-pgid)` | [E-06, T-06] ; R-7 |
| Le client ne voit ni résultat intermédiaire ni tool de module | §3 | [à prouver : `code-front.feature`, 3] |
| Écrire un hook ou `.git/config` nommés est refusé | `denyWrite` nommés | [T-02e4, deux OS] |

**Hooks de protection : une couche de réduction, à côté de srt, pas une frontière.** Pour l'outil 1a.0, des hooks Claude Code `PreToolUse`, simples et descriptifs, refusent les erreurs et les injections ordinaires avant que srt n'ait à répondre. Un Bash obfusqué ou un script lancé par `npm test` leur échappe : ils réduisent le risque, ils ne le ferment pas. Ils sont livrés dans un plugin de la marketplace, jamais dans `~/.claude/settings.json`, qui s'appliquerait à toutes les sessions, ni dans un fichier que la sandbox peut écrire. Les hooks d'un `.claude/settings.json` de worktree ne comptent pas comme protection. Les workers de plateforme n'en dépendent pas (`settingSources: []`).

### 4.1 STRIDE

| Menace | Vecteur réel | Réponse | Sinon |
|---|---|---|---|
| **S** | Processus local qui joint le broker ou la gateway | Jeton de task, identifiant d'appel, `401` | R-3 |
| **S** | Module qui se dit d'une autre task au rappel | Identifiant d'appel créé par la gateway, invalidé au retour | R-10 : confusion entre appels concurrents acceptée |
| **T** | Une sandbox réécrit un hook, `.git/config`, son profil ou srt | `denyWrite` nommés ; profil et srt hors chemins inscriptibles ; hooks `PreToolUse` en 1a.0 | R-2 |
| **T** | Un module écrit la table d'un autre | `writes_tables` contrôlé à chaque opération par la gateway | R-8 |
| **T** | Une PR affaiblit la porte | Visible au diff, revue, ruleset sur `main` | R-6 |
| **R** | Coût ou verdict non attribuable | Registre append-only : `0003_runs_immutable.sql` n'interdit que l'UPDATE d'un run terminé ; `trace` et `parent` : migration à écrire, brique 2 | |
| **I** | Exfiltration par un domaine autorisé | Sandbox de plateforme : seul le broker. Outil 1a.0 : accepté | R-1, R-5 |
| **I** | Lecture de la clé | Broker, fichier 0600 ; sur serveur, uid propre au broker | R-3, R-8 |
| **D** | Boucle, inondation, sandbox sans fin | Budgets, profondeur et échéance par appel, `maxTurns`, `maxBufferSize`, plafond d'octets, gateway qui survit [E-03] | R-7 |
| **E** | Évasion par espace de noms imbriqué | `allowNestedUserNamespaces`, `enableWeakerNestedSandbox`, `allowAllUnixSockets` refusés par schéma ; `escape.feature` | R-5 |
| **E** | Contenu non fiable qui atteint le lancement ou la gateway | Signature fermée, argv statique (§6) ; gateway limitée aux enveloppes, sans `eval` | R-8 |

### 4.2 Risques acceptés, écrits

| # | Risque | Pourquoi on vit avec | Ce qui le borne | On le rouvre si |
|---|---|---|---|---|
| R-1 | Outil 1a.0 : le trousseau est lisible depuis la sandbox, donc le jeton Claude et possiblement GitHub ; exfiltration et push possibles par les domaines autorisés (README srt, « Security Limitations ») | Outil personnel, poste du propriétaire, simplicité d'usage réel | Révocation ; réseau limité à trois fournisseurs ; `denyRead` ciblés ; hooks `PreToolUse` ; ruleset sur `main` comme limite | Tout usage par un tiers |
| R-2 | Tout ce que l'hôte lance dans le worktree exécute du code écrit par la sandbox : `git`, scripts npm, `.claude/settings.json`, `.envrc`. Sous Linux, un hook écrit dans un dépôt imbriqué non nommé persiste [T-34h, T-34i, T-02e, T-02e2]. Les dossiers de session de `~/.claude` restent inscriptibles et partagés avec les sessions hôte hors sandbox (à prouver, §8) | Même risque qu'aujourd'hui avec tout code d'agent ; la lecture du diff précède le lancement | `denyWrite` du dépôt principal ; revue | Un incident réel |
| R-3 | Un natif du même uid lit la clé ou un jeton [T-24, T-43d] | Il lirait déjà tout le reste du poste | Sur serveur, un uid propre au broker | Serveur partagé |
| R-4 | Le modèle lit le jeton de sa task | Il n'atteint que le broker de sa task, plafonné par son budget, et ne vaut rien ailleurs | Budget, fin de task | |
| R-5 | Évasion de srt, faille du noyau, exfiltration du contenu par l'API de modèle (inhérente) | Aucune correction totale possible ; utilisateurs fiables | Banc rejoué à chaque montée de srt, `escape.feature`, version exacte | Un test d'évasion réussit (§6) |
| R-6 | Une PR hostile passe la porte verte : steps sans assertion, mutants tués [T-44] ; une assertion retirée ne se voit qu'au diff [T-22] ; une PR peut modifier la porte elle-même. Détection automatique des assertions affaiblies refusée par le propriétaire | Contributeurs fiables, tout passe par la revue | Diff, ruleset sur `main` | Un contributeur non fiable |
| R-7 | macOS : un enfant `setsid` survit à la mise à mort du groupe, et aucune limite mémoire ou PID par sandbox [T-06b, T-09] | Poste de développement | Timeout, budgets, `systemd-run` sur serveur [à prouver : brique D] | Serveur macOS |
| R-8 | Gateway compromise. **Peut** : tout lire et écrire de Postgres si elle partage l'uid de `data` (le rôle `peer` est celui de l'uid, la règle « pg dans `data` seul » n'est que du code), réécrire budgets et registre, dépenser par le broker avec les jetons de task qu'elle émet, lire les entrées et sorties de toute sandbox, lancer n'importe quel profil, envoyer tout cela hors de l'hôte (processus natif). **Ne peut pas** : lire la clé API, ni l'environnement ou la mémoire du broker (uid propre, fichier 0600) ; elle ne dépense donc la clé que par le broker, vers `api.anthropic.com`, et arrêter le broker suffit à l'arrêter, sans clé à changer. Sous Docker, équivaut à root par la socket | Point de décision unique voulu | Code court, enveloppes seules ; uid du broker ; facture ; socket Docker dans aucun conteneur | |
| R-9 | Dépassement de budget : une requête interrompue garde sa réservation, montant retenu jusqu'à un `settle` manuel ; coût réel supérieur d'au plus une requête. Un `settle` rejoué ne trouve plus la réservation et ne fait rien [à prouver : T-45 rejoué] | Erreur du côté prudent | Plafond, registre, facture | Écart constaté sur facture |
| R-10 | Usurpation hors des appels actifs refusée par l'identifiant d'appel (§2) : un module ne choisit plus sa task, et l'identifiant meurt au retour. Confusion acceptée : un module compromis qui sert deux appels à la fois peut présenter l'un pour l'autre, attribution entre ces deux tasks, dans son `calls_allowed` | | | |
| R-11 | Amont qui refléterait un en-tête d'authentification [T-04, T-42h] : aucun retrait en réponse | Hôte amont fixe ; un retrait se contourne par encodage | TLS vers `api.anthropic.com`, `T-04R` | T-04R observe un reflet |
| R-12 | `zod` imbriqué de srt, GHSA-mrhx-c7xc-m3w5, sans correctif ni override utile (O-33, acceptée sans override) | Non exploitable depuis la sandbox : seul `safeParse` observé, sur la configuration de démarrage, écrite par nous | Règle : profil hors de tout chemin inscriptible | Usage de `srt proxy` ; relu à chaque montée |
| R-13 | Linux : `kernel.apparmor_restrict_unprivileged_userns=0`, réglage global exigé par bwrap sur Ubuntu 24.04 [E-07] | Runners jetables | Profil AppArmor dédié sur serveur [à prouver : brique D] | Déploiement Linux |

### 4.3 Chaîne d'approvisionnement

Versions exactes et lockfile, `npm ci --ignore-scripts` en CI [T-15] ; `.nvmrc` exact. `@cucumber/cucumber` reste à `12.9.0` : 13.x casse le runner Stryker [T-14]. srt `0.0.81` à relire et rejouer au banc à chaque montée. SBOM à la brique 1c : `npm sbom --sbom-format cyclonedx --package-lock-only --workspaces`, plus la version des paquets système. Actions de CI épinglées par SHA, `persist-credentials: false`. Sur les hôtes Linux : `bubblewrap`, `socat`, `ripgrep`. Postgres 17 : dépôt PGDG, absent d'`ubuntu-24.04` [T-16]. Aucun hash ni digest ne valide une sortie de build ; le SHA de commit et l'intégrité npm ne sont que des identifiants.

## 5. Profils

**Un gabarit, pas dix fichiers.** `sandboxes/base.srt.json` porte ce qui ne varie pas. Les variables, dérivées du manifeste ou de la sorte de processus, sont le réseau, les lectures en plus et les écritures en plus : le dossier de sortie persistant de `manifest-registry`, nommé dans son profil, hors de son cwd jetable ; `CLAUDE_CODE_TMPDIR` ; le worktree d'un agent qui modifie du code. `.` est un cwd jetable, créé au lancement et retiré à l'arrêt : un par session pour l'executor, un par task pour le worker, un par processus de module ; un module sert plusieurs tasks dans le même cwd, d'où `realpath` sous le dépôt de la task (§3). L'adaptateur fusionne, valide avec un schéma zod strict, écrit le résultat hors de `allowWrite` et le passe par `--settings`.

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
| executor | aucun | dist de l'executor, modules importables générés | aucun |
| module (`data`, `workflow`), dont Structurer, Judge, Embedder | gateway | dist et ressources du module | selon manifeste ; modèle local pour les trois derniers [à prouver : brique 8] |
| manifest-registry | aucun | `modules/*/manifest.yaml` ; écriture : son dossier de sortie persistant nommé dans son profil, hors de son cwd jetable | aucun |
| agent : scout, builder, zetetic-reviewer, autres | broker | `agents/<nom>.md` choisit tools et modèle | selon profil |
| `egress` déclaré : web-scout | allowlist du manifeste, plages privées refusées | | aucun ; sortie en quarantaine |
| db-migrator | aucun ; Postgres jetable dans la sandbox | migrations du plugin | aucun |

**Ce que le banc impose, chaque point nommant un échec réel :**

- Schéma strict : srt tolère une clé mal écrite, `strictAllowlistt` passe sans erreur [T-01]. Le schéma refuse aussi les options d'affaiblissement (§4.1).
- `denyWrite` nommés : sous Linux, srt ne protège que ce qui existe au lancement [T-02e, T-02e2] ; nommés, ils tiennent [T-02e4, T-02e5, T-02e6].
- Un dossier temporaire par sandbox, `CLAUDE_CODE_TMPDIR` et `allowWrite` (écriture en plus), retiré à l'arrêt : srt fixe `TMPDIR` sans le créer, le binaire et `tsx` échouent, et le poste donnait un faux vert (runs 41037109539 et 41037711860).
- `NO_PROXY` retiré de l'environnement du worker, sinon le loopback contourne le proxy et se fait refuser [T-03, T-41].
- srt installé hors de tout chemin inscriptible (README srt, « Where This Package Is Installed »).

**Profils de task.** `agents/<nom>.md`, format Claude Code, chargés par `query({ agents })` : par `plugins`, le corps du prompt n'atteint pas le modèle [E-08]. Un agent qui modifie du code travaille dans un worktree, écriture en plus, comme en 1a.0 (R-2) ; un agent en lecture n'a que `allowRead` sur le dépôt.

**Manifeste de module.** Lu par `manifest-registry`, module sous srt, qui génère les modules importables (lus par l'executor) et le catalogue. La gateway ne lit que cette sortie, après validation par le schéma de `packages/contracts` ; un manifeste invalide n'est pas routé.

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
writes_tables: []            # disjoints au chargement ; contrôlés par la gateway à chaque opération
reads_domains: [memory]
calls_allowed: [judge]       # vérifié par la gateway à chaque appel ; cycle refusé au chargement
timeout_ms: 5000             # échéance de l'identifiant d'appel, bornée par celle du parent
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

Seul le résultat des tests fait foi : aucun hash, aucun digest. **Trois familles** : e2e Gherkin (`features/**`, srt et Postgres réels), unitaires Gherkin (`<composant>/features/**`), mutation Stryker. Typecheck, format, garde d'architecture et validation du plugin sont des scénarios. Outils : `@cucumber/cucumber` 12.9.0, `@stryker-mutator/*` 10.1.1, `tsx` [T-13, T-14].

**Le compte.** `exécutés = base + ajoutés − supprimés`.

1. L'unité est le pickle : un `Scenario`, une ligne d'`Examples`, un `Scenario` de `Rule` [T-12].
2. `base` = compte de pickles exécutés, publié en artefact par le dernier run vert de `main`, lu par l'API (`actions: read`). Repli écrit : si aucun run vert de `main` ne porte le SHA du premier parent du commit de merge, la base est le compte statique du premier parent et la porte le signale dans son rapport au lieu d'être rouge ; le premier run de `main` et l'artefact expiré tombent dans ce repli. `ajoutés` et `supprimés` = différence d'ensembles entre ce premier parent et la tête, dérivée du diff, jamais déclarée. L'identité d'un pickle : chemin, `Feature`, `Rule`, `Scenario`, ligne d'`Examples`.
3. La porte est verte si et seulement si tous les pickles attendus sont exécutés, verts, une seule tentative, chaque step `PASSED`. Elle lit le rapport Messages, jamais `TestRunFinished.success` : un step `SKIPPED` y donne `success: true` et un code de sortie 0 [T-13c]. `cucumber.mjs` n'a ni `tags` ni `name`, `retry: 0` ; une table `Examples` calculée est interdite.

Hors repli, la base venant d'une exécution réelle, `exécutés = base + ajoutés − supprimés` est un contrôle réel, et `exécutés = statique` reste : ensemble, ils attrapent filtres, skips, steps absents et un compte statique faussé par la PR ; le résumé `+a −s` rend toute suppression visible à la revue.

**Mutation.** 0 survivant sur les lignes modifiées du diff, sources de production. `Survived`, `NoCoverage`, `Pending` échouent ; `Killed`, `Timeout` passent. Un équivalent se marque `// Stryker disable next-line <Mutateur>: équivalent: <invariant>` : la porte juge la forme, la revue l'équivalence. Du code exécuté seulement dans un processus enfant survit [T-14b] : d'où les ports avec adaptateur en mémoire, déjà la règle du dépôt. Coût mesuré : 46 à 75 ms par mutant [M-01].

**Où.** `gate.yml`, `pull_request` (jamais `pull_request_target`) et `push` sur `main`, runners hébergés, `contents: read` et `actions: read`, aucun secret, aucun cache, `fetch-depth: 2`. `gate-linux` lance tout ; `gate-macos` lance `features/sandbox/` seulement, parce que srt y diffère réellement [T-02e, T-07-fd0, T-39b] et que le reste n'en dépend pas. Un ruleset protège `main`, les deux jobs requis, avec droit de contournement du propriétaire ; il ne protège pas les refs locales (§8, 1a.0). Ni `CODEOWNERS` ni purge des 474 mutants. `CLAUDE.md` s'amende en 1a pour permettre le diff des `.feature` contre le premier parent. Une commande locale : `npm run gate`.

Le code de la porte vit dans l'arbre testé (`tools/test-gate`) : un commit qui le casse échoue à sa propre porte, et il n'y a rien à promouvoir. Il se teste avec des rapports fixtures : step non défini, step `pending`, filtre, scénario sans step, pickle absent, base d'un autre SHA, mutant survivant, `Stryker disable all`. Toute manipulation délibérée relève de R-6.

## 8. Briques

Une brique s'arrête sur sa preuve. Ordre d'exécution : 1a.0, puis 1a, 1b, 1c, 2 à 8, D. Le banc 1b.0 a tourné : il reste à le rejouer à chaque montée de srt, après une tâche de nettoyage (décision 9) : SQL de l'annexe vers `bench/sql/`, tests sans objet retirés (T-42, T-43, ancien T-45), T-45 rejoué sur le SQL du §2, E-03-huge corrigé ; résultats historiques conservés au journal.

### 1a.0 Outil de code isolé, stage 0 simplifié

Un fichier `builder.json` par worktree, hors de tout chemin inscriptible, une commande : `srt --settings builder.json claude`, dans le worktree habituel `<repo>/.claude/worktrees/<w>`. C'est tout. Le reste de la plateforme se construit dedans.

| Élément | Choix adopté le 30 octobre (décision 1) |
|---|---|
| `allowWrite` | Le worktree ; `<repo>/.git/worktrees/<w>`, `.git/objects`, `.git/refs`, `.git/logs` ; `~/.cache` et les dossiers de session de `~/.claude` |
| `denyWrite` | `<repo>/.git/hooks`, `<repo>/.git/config`, `worktrees/<w>/commondir`, `gitdir`, `config.worktree`, `refs/heads/main` ; `<worktree>/.claude/settings.json` et `settings.local.json` |
| `denyRead` | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.npmrc`, `~/.netrc` |
| Réseau | Anthropic, npm, GitHub |
| Authentification | Le compte Claude du propriétaire ; `CLAUDE_CONFIG_DIR` non défini ; srt installé hors du worktree |
| Hooks `PreToolUse`, jeu minimal adopté (décision 2), dans un plugin de la marketplace | Refuser `git push` vers `main` et les push forcés ; l'accès au trousseau et aux identifiants (`security find-*`, fichiers de secrets) ; les écritures dans `.git/hooks` et `.git/config` |
| Résidus | R-1, R-2 ; les objets écrits par la sandbox sont lus par le `git` de l'hôte ; le ruleset tient `main` sur GitHub, pas la ref locale |

**Faisabilité, vérifiée sur le poste macOS** : la commande fonctionne en `-p` avec le compte Claude, un appel réel minimal. Le profil initial, limité à `.git/hooks` et `.git/config`, casse `git commit` et permet une évasion prouvée par réécriture de `.git/worktrees/<w>/commondir` : d'où les lignes ci-dessus. **À prouver : la TUI au premier lancement.** Réglages du worktree refusés : `~/.claude/settings.json` et les plugins restent hors de `allowWrite`. Mais srt ne protège que `.claude/commands` et `.claude/agents`, pas `.claude/settings.json` ; or un fichier de projet a priorité sur l'utilisateur et se recharge en cours de session (doc Claude Code) : un `disableAllHooks: true` ou un plugin désactivé dans le worktree couperait les hooks. D'où les deux `denyWrite` ; ne pas ajouter `~/.claude.json` ni `~/.claude/settings.json` à `allowWrite` pour faire passer la TUI.

**Sortie** : la TUI répond dans la sandbox ; un commit réussit dans le worktree ; l'écriture de `.git/hooks/x`, `.git/config`, `worktrees/<w>/commondir`, `~/.claude/settings.json` et `<worktree>/.claude/settings.json` est refusée, y compris en renommant `.claude` ; `~/.ssh` est illisible ; `npm ci` passe ; un domaine hors liste est refusé. Hooks : le plugin se charge ; il s'applique à la TUI sous srt ; aucune écriture depuis le worktree ne le coupe (`disableAllHooks`, plugin désactivé) ; chaque hook refuse son cas nominal. Git : la session ne peut ni déplacer `main` ni modifier la config git commune, directement ou par une commande git autorisée (`update-ref`, `branch -f`, `pack-refs`, `config`) ; sinon risque accepté écrit, le ruleset distant ne protégeant pas les refs locales. Restent à prouver à cette même sortie, du journal : le hook de worktree coupé par `.claude/settings.json`, et une session hôte hors sandbox qui exécuterait du code écrit par la sandbox dans `~/.claude/shell-snapshots` ou `session-env`, sinon ces dossiers sortent de `allowWrite`. Essai consigné au journal. **Test externe** : la brique 1a démarre dans l'outil.

### 1a Gherkin et porte

Épingler la chaîne et les quatre workflows par SHA. Migrer les 119 cas vitest vers Gherkin, `skipIf` retiré, Postgres fourni [E-09 : 119/119]. Écrire `tools/test-gate` et `gate.yml`. Correction minimale des workflows Claude, dont la revue n'a jamais produit de revue et qu'un externe ne peut pas lancer (décision 4) : épinglage par SHA, garde sur l'acteur, ruleset sur `main` avec droit de contournement du propriétaire. Retirer vitest. Amender `CLAUDE.md`, dont la mention que `bench/` est hors production.

**Sortie** : 0 `*.test.ts` ; `exécutés = base + ajoutés − supprimés` sur `main` ; rapports fixtures refusés (§7) ; 0 survivant sur le diff d'une PR réelle. **Test externe** : une PR saine verte ; une PR qui ajoute un filtre `tags` à `cucumber.mjs`, rouge.

### 1b srt, broker, topologie

| Étape | Contenu | Sortie |
|---|---|---|
| 1b.1 | `packages/sandbox` : port, adaptateur srt, gabarit, schéma, canari ; `docker-runner.ts` derrière le port, avec un plafond d'octets sur stdout (décision 3 ; `docker-runner.ts:93-99`, sans borne : 2 Mo donnent 545 Mo de tas) | `canary.feature`, `spawn.feature` (enfant hostile, sortie au-delà du plafond refusée, groupe tué), garde et fixture |
| 1b.2 | `modules/broker` en flux, clé API, jeton de task | `broker.feature` : sans jeton `401`, hors chemin `403` ; aucune clé en sandbox ; appel réel (T-04R) |
| 1b.3 | `data` en MCP généré depuis `DATA_OPS`, tables écrites déclarées par opération ; SQL dans `data/sql/*.sql`, budgets et réservations | `budget.feature` : 300 réservations parallèles, plafond exact ; rejeu de `reserve` sur plafond atteint = succès sans effet ; `settle` rejoué sans effet ; facture supérieure ; coût de `settle` négatif refusé, `spent` inchangé ; `data` absent = refus |
| 1b.4 | Gateway : lit la sortie validée de `manifest-registry` et `modules.mcp.json`, lance les modules, serveur MCP par sandbox, identifiants d'appel, 3 reconnexions puis `SERVICE_UNAVAILABLE` ; sandbox jamais relancée | `gateway.feature` : hors `calls_allowed`, au-delà de la profondeur, après l'échéance, identifiant invalidé, table hors `writes_tables` : refusé et journalisé ; module tué puis reconnecté ; `manifest.feature` : sortie invalide non routée |
| 1b.5 | Memory : module et worker sous srt, `agents/*.md` ; retrait de `internal-http.ts` ; `.max()` sur `WorkerOutputSchema.evidence` (décision 3 ; `tools.ts:82`, sans borne) | `recall` e2e à travers un vrai `srt`, faux amont ; `evidence` trop grande rejetée |
| 1b.6 | Retrait de `compose.yaml` ; `proxy/` vers `deploy/edge/` ; docs à jour | `npm run gate` vert |

**Sortie** : Linux et macOS verts sur `features/sandbox/escape.feature`, un seul `Scenario Outline` lancé contre de vrais processus pour chaque sorte de profil : lire un faux `~/.ssh/id_test`, écrire hors `.`, écrire `.git/hooks/pre-commit`, joindre `example.com`, `169.254.169.254`, le socket Postgres, lire le répertoire d'une autre task, `unshare -r`.

### Suite

| # | Brique | Contenu | Sortie |
|---|---|---|---|
| 0 | Baseline | 20 tâches, M1, M2 ; à la date du propriétaire | Chiffres écrits dans `baseline/results/` |
| 1c | Marketplace | Marketplace et plugins, `alwaysLoad`, SBOM, workflows Claude en OIDC, hook M1 | `claude plugin validate . --strict` = 0 [T-11] ; installation dans un `HOME` jetable ; aucune clé statique |
| 2 | Catalogue, registre, recall | Mode `catalog`, registre (colonnes `trace`, `parent`, migration), profil `ci-review`, `memory-recall` en `workflow` | Résultat au-delà de `max_result_tokens` = résumé + handle ; appel hors profil refusé ; T(orchestration directe) relevé |
| 3 | Front de code | `search`, `describe`, `execute` (fusion des deux premiers mesurée ici), modules importables, executor par session | `code-front.feature` ; réseau refusé ; R et définitions relevés |
| 4 | Scission Cortex | `memory-write`, `memory-consolidate`, un écrivain par table, db-migrator ; extension BM25, une à la fois | Écriture hors `writes_tables` refusée au chargement et à l'opération |
| 5 | Code et tasks | `code-index`, `verify`, `codebase-ask` ; scout, builder, zetetic-reviewer | Citation invalide rejetée par `verify` ; builder confiné à son worktree ; `claude-review` réel |
| 6 | Spec | `spec-draft`, `spec-lint`, `issue-to-spec.yml` | Spec sans critère rejetée |
| 7 | Mission Control | Onglet sur le registre | Tokens par couche visibles sur une task réelle |
| 8 | Modèles, web-scout | Structurer, Judge, Embedder désactivé, modules workflow sous srt ; web-scout | Quarantaine seule ; adresse privée refusée ; accepté si M1 baisse sans hausse de M2 |
| D | Serveur | `deploy/`, un uid propre au broker, un pour gateway et `data`, TLS par Caddy, `systemd-run`, profil AppArmor | Limites mémoire et PID prouvées ; profil AppArmor prouvé sans sysctl global (R-13) |

## 9. Décisions

### 9.1 Décisions acquises

**A. Intangible.** Chaque composant de la figure 1 de la v3 (platform-v3.html) est un processus séparé ; aucune passe ne fusionne ni ne retire un composant sans décision écrite du propriétaire.

| Composant de la figure 1 de v3 | Ici |
|---|---|
| Clients : Claude Code, Codex, claude-code-action, Mission Control | Processus clients ; Mission Control lit le registre (brique 7) |
| [0] Stage 0 builder | Outil 1a.0, `srt … claude` ; paquet publié et `fixpoint.sh` retirés (DC-10, décision 6) |
| [1] Reverse proxy | Caddy, natif, `deploy/edge/` (brique D) |
| [2] Gateway | Natif ; ses fonctions de la figure dans un seul processus, comme en v3 |
| [3] Executor de session | Sous srt, un par session ; pool chaud retiré (T-10) |
| Conteneurs de task : scout, builder, zetetic-reviewer | Worker sous srt, un par task |
| [4] memory-write, memory-recall, memory-consolidate, code-index, verify, codebase-ask, spec-draft, spec-lint | Modules sous srt, un processus chacun ; `kind: agent` par un worker |
| [4] web-scout, db-migrator, manifest-registry | Modules sous srt |
| [5] Structurer, Judge, Embedder | Modules workflow sous srt (brique 8) |
| [5] Orchestrateur de conteneurs | Port `SandboxRunner` de la gateway, clé au broker natif (D-9 : `platformd` retiré ; D-10) |
| [6] Postgres | Natif, joint par `data` seul, natif aussi (D-5, D-8, E-09) |

**B. Correctif de l'audit, validé par le propriétaire** : `manifest-registry` module sous srt (§2, §5) ; identifiant d'appel, R-10 : usurpation hors des appels actifs refusée, confusion entre appels concurrents acceptée (§2) ; `trace` et `parent` au registre, migration à écrire en brique 2 (§3) ; `writes_tables` à chaque opération (§3) ; uid propre au broker, R-8 explicite (§4) ; compteur de concurrence en mémoire, écart accepté (§2) ; budget décidé par la gateway, exécuté par le broker (§2).

**C. Décisions du propriétaire, 30 octobre 2026.**

| # | Décision | Où |
|---|---|---|
| 1 | Profil builder adopté avec R-1 et R-2, `denyWrite` sur `.claude/settings.json` et `settings.local.json` du worktree compris | §8, 1a.0 |
| 2 | Hooks `PreToolUse` : jeu minimal adopté, livré dans un plugin de la marketplace, jamais dans `~/.claude/settings.json` ; tests à la sortie de 1a.0 | §4, §8 |
| 3 | O-33 `zod` acceptée sans override, règle « profil hors chemin inscriptible » ; `.max()` sur `evidence` et plafond d'octets sur stdout | R-12 ; 1b.1, 1b.5 |
| 4 | Workflows : épinglage par SHA, garde sur l'acteur, ruleset sur `main` avec contournement du propriétaire, en 1a | §7, 1a |
| 5 | O-1, O-23, O-26 retirées : `pull_request`, pas de `CODEOWNERS`, pas de purge des 474 mutants. Détection d'assertions affaiblies refusée | §7, R-6 |
| 6 | Stage 0 publié et `fixpoint.sh` retirés ; aucune affirmation de reproductibilité | §2, écarts |
| 7 | Base de la porte lue dans le dernier run vert de `main` ; `exécutés = statique` conservé | §7 |
| 8 | Budgets : table de réservations, `settle` = `DELETE … RETURNING` puis budget dans la même instruction | §2, R-9 |
| 9 | Nettoyage du banc, tâche inscrite ; résultats historiques au journal | §8 |
| 10 | Marque `ai-architect.tools` au titre et à l'en-tête ; `architect-os` nom provisoire | En-tête |

### 9.2 Décisions ouvertes

**Règle d'arrêt des revues.** Le consensus est atteint quand une revue ne trouve plus ni défaut de correction fonctionnelle ni contradiction avec les décisions du propriétaire. Un risque nommé et accepté ne bloque pas. Une proposition de mécanisme supplémentaire ne compte pas comme défaut.

Ouvertes : la date de la baseline (D-7) et le nom définitif, au propriétaire.

## Annexe : entrée du banc, pas la conception

`bench/src/tests/t45.ts` extrait son SQL de ce fichier, entre les deux titres ci-dessous, et le push sur cette branche déclenche le banc : ce bloc reste inchangé jusqu'à la tâche de nettoyage du banc (décision 9). Ce n'est pas le SQL de la conception, qui est au §2.

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
