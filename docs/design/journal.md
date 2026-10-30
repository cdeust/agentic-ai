# Journal de conception, plateforme v3 sous srt

Historique de [`platform-v3-srt.md`](platform-v3-srt.md) : ce qui a été prouvé, décidé, raté, et pourquoi un mécanisme a disparu. Ajout seulement : on ajoute une entrée datée, on ne réécrit pas. Détail par run et par variable : [`bench/JOURNAL.md`](../../bench/JOURNAL.md). Texte complet d'avant la simplification, commandes et sorties brutes comprises : `git show 0dd97c5:docs/design/platform-v3-srt.md`.

Les commentaires de `bench/` et `bench-sandbox.yml` citent les sections de `0dd97c5` : §4.5 budgets, §9.2 profils, §11.2 broker, §15 briques. Elles se lisent dans ce commit.

Environnement des expériences locales : macOS 27 arm64, Node 26.11.1, srt 0.0.81, MCP SDK 1.32.2, Agent SDK 0.3.312, Claude Code 2.1.312. Aucun appel réel à l'API Anthropic au banc : faux amont local. Le seul appel réel est celui de la vérification de 1a.0, avec le compte du propriétaire.

## 1. Résultats du banc

Commande : `cd bench && npm run bench:sandbox`. CI : `.github/workflows/bench-sandbox.yml`.

| Run | Commit | OS | Tests | pass | fail | residual | finding |
|---|---|---|---|---|---|---|---|
| 41038015293 | `b6fc924` | macOS | 53 | 48 | 0 | 2 | 3 |
| 41038015293 | `b6fc924` | Linux | 53 | 47 | 3 | 0 | 3 |
| 41044838678 | `70a146f` | macOS | 106 | 94 | 1 | 5 | 6 |
| 41044838678 | `70a146f` | Linux | 106 | 92 | 5 | 3 | 6 |

Tout ce qui n'est pas `pass` au run 41044838678 :

| OS | fail | residual | finding |
|---|---|---|---|
| macOS | E-03-huge | T-03f, T-06b, T-42h-base64, T-42h-hex, T-42h-sse-split | T-06-s-TERM, T-06-s-KILL, T-35-pre-fds, T-43d, T-45i, T-45k-ancien |
| Linux | T-02e, T-02e2, T-07-fd0, T-34h, T-34i | T-42h-base64, T-42h-hex, T-42h-sse-split | les mêmes six |

Linux : `ubuntu-24.04`, x64, bubblewrap 0.9.0, ripgrep 14.1.0, sysctl AppArmor à 0. macOS : `macos-latest`, arm64, `sandbox-exec`, sans ripgrep. Postgres 17.11 pour T-45.

| Test | Résultat, une ligne |
|---|---|
| T-41 | Worker entier sous srt (`query()`, handlers, binaire), une couche, faux amont : passe sur les deux OS. Aucune clé dans l'environnement, les sorties ni les fichiers |
| T-38 | Module sous srt, stdio, rappel de la gateway par le proxy, lecture et réseau limités : passe sur les deux OS |
| T-39 | `listen` sous srt : macOS `EPERM` ; Linux accepté, mais l'hôte reçoit `ECONNREFUSED` |
| T-02e, T-02e2 | Linux : un hook et `.git/config` absents au lancement, écrits par la sandbox, persistent sur l'hôte |
| T-02e4, e5, e6 | `denyWrite` nommés : plus rien ne persiste, deux OS |
| T-34h, T-34i | Linux : hook écrit dans un dépôt imbriqué non nommé ou créé après le lancement : persiste. macOS : `EPERM` |
| T-07-fd0 | Linux : un socket d'écoute passé en fd 0 sert depuis la sandbox. macOS `EPERM` ; fd 3 refusé partout |
| T-06 | Groupe tué : 0 descendant. `srt` seul tué par SIGKILL : 10 sur 11 restent (Linux), 2 sur 3 (macOS). T-06b : un enfant `setsid` survit sous macOS |
| T-23 | Broker : corps sans clé à l'amont, hors `/v1/messages` et `GET` : 403, amont direct refusé, deux OS |
| T-42a à g | Autorisation par `mask` et `tlsTerminate` : passe, deux OS. Mécanisme retiré le 30 octobre, résultat conservé pour un éventuel besoin multi-utilisateur |
| T-42h | Clé réfléchie par un amont, réencodée (base64, hex, SSE fragmenté) : atteint le worker. Un retrait en réponse se contourne |
| T-43a, b | Natif étranger sans autorisation : 401, huit formes. Témoin sans autorisation : 200 et clé à l'amont |
| T-43d | Un natif du même uid lit l'autorisation (`/proc/<pid>/environ`, `ps -Eww`) et la rejoue : 200 |
| T-45 | SQL à états, Postgres réel : passe sur le `settle` d'avant DC-3. Témoins de l'ancien SQL : sur-rétention (5 manches sur 6 macOS, 6 sur 6 Linux), `spent 350, reserved -490`, `reserved -969`. Mécanisme retiré, voir §7 |
| T-45-sync | Attend 1 instruction de `settle` ; le texte de `0dd97c5` en a 2 : rouge à `0dd97c5`, avant cette passe |

**Limites du banc.** Broker bufferisé. Répertoires temporaires non nettoyés. Aucun banc Docker. E-03-huge sous macOS est un défaut du banc : `hostile.mjs:5` appelle `process.exit` après un `write` asynchrone de 11 Mio. Le statut attendu est propre à chaque OS ; un changement se signale dans les deux sens.

## 2. Expériences locales, 30 octobre 2026

| ID | Question | Résultat |
|---|---|---|
| E-01 | MCP stdio standard sous srt | 1 000 allers-retours en 41 ms ; 8 Mio passés ; `readHome` `EPERM` |
| E-02 | Rôles inversés, enfant client | 45 ms sous srt, 38 ms sans ; deux tasks sans mélange ; tool hors profil refusé |
| E-03 | Enfant hostile | Faux JSON, ligne de 11 Mio, mort, `_meta.task` forgé : hôte vivant, valeur ignorée |
| E-04, E-05 | Agent SDK et binaire par un broker | `success`, outils et sortie structurée ; l'enfant n'a pas la clé |
| E-06 | Une task tuée | L'autre finit, `success` |
| E-07 | srt dans un conteneur Linux, `--privileged` | Échec : `apparmor_restrict_unprivileged_userns=1`. Sysctl non modifié, porté par le banc CI |
| E-08 | Profils par `plugins` | `model` et `tools` appliqués, corps du prompt non transmis ; `agents` et `systemPrompt` marchent |
| E-09 | Postgres `peer`, socket Unix | 119/119 ; depuis srt `EPERM`, `allowUnixSockets` n'ouvre que sur macOS |
| T-01 | Clés de config | `strictAllowlistt` tolérée, exit 0 ; fichier absent : refus |
| T-02 | `denyRead`, chemins | Voir §1 ; `tmpfs` sous Linux, `EPERM` sous macOS |
| T-03 | Loopback | Direct refusé, port non listé refusé, port listé accepté ; `allowLocalBinding` ouvre tout sous macOS, ignoré sous Linux |
| T-04 | `mask` adversarial | **Échec** : sentinelle dans le corps ou un autre en-tête remplacée par la vraie clé ; amont réfléchissant : fuite. `mask` écarté pour la clé |
| T-09 | Limites | `ulimit` par utilisateur, inapplicable par task sous macOS |
| T-10 | Latence | Surcoût médian 211 ms au lancement |
| T-11 | `claude plugin validate --strict` | Passe avec `description` et `author` |
| T-12, T-13 | Pickles, chargement | Parser confirmé ; `tsx` nécessaire ; un step `SKIPPED` donne `success: true`, exit 0 |
| T-14 | Stryker + cucumber | 12.9.0 seul ; 13.x tronque `stryker-formatter.cjs` à 0 octet. Code en processus enfant : `Survived` |
| T-15, T-16 | `npm ci`, paquets | Lockfile désynchronisé refusé ; `postgresql-17` absent d'`ubuntu-24.04` |
| T-17 | Tests existants | 119 cas, 113 passés, 6 skipped (Postgres) |
| T-19 | Dépôt | Public, 0 ruleset, `main` non protégée |
| T-20 | UPDATE conditionnel | 300 réservations de 10, plafond 1 000 : 100 acceptées ; après règlement à 7, 30 de plus |
| T-21 | Jeton Ed25519 | Rejeu, audience, capacité, expiration refusés. Mécanisme retiré |
| T-22 | Assertion retirée | Scénario vert, 4 mutants survivent |
| T-24 | Environnement même uid | Lisible sous Linux ; autre uid refusé ; voir T-43d pour macOS |
| T-37 | `node --permission` | Refuse `child_process` et les écritures ; pas une frontière selon la doc Node. Retiré |
| T-44 | PR hostile | Steps sans assertion, mutants forcés à `Killed` : **porte verte**, sans forgerie |
| M-01 | Coût de mutation | 1 115 mutants en 51 s ; 474 non tués sur tout le dépôt |

## 3. Échecs de méthode, à ne pas refaire

- E-02 : `write EPIPE` non géré faisait tomber l'hôte ; d'où `stdin.on('error')`.
- T-02 : une première version créait un dossier dans le vrai home, bloquée avant exécution ; refaite avec un `HOME` factice.
- T-06 : sans borne de temps, 120 s bloquées, puis un `pkill -f` a tué le shell du banc, le motif figurant dans sa ligne de commande.
- T-14 : le second message d'erreur pris pour la cause ; la cause était un fichier tronqué à 0 octet dans `node_modules`.
- T-44 : un premier échec pour une autre raison (`tsx` absent) a failli être lu comme un résultat.
- E-09 : un `EPERM` obtenu sur le mauvais nom de socket ne prouvait rien.
- Run 41037109539 : le poste donnait un **faux vert**, `/tmp/claude-501` y existait déjà.
- T-03f : attendu inversé sous Linux. T-41d : la sous-chaîne `srt` trouvée dans le chemin `marketplace-srt`. T-45k et T-45j : ne jouaient pas `reserve(X)` rejoué × `settle(X)`, d'où un « aucun 40P01 » réfuté par la contre-expertise.

## 4. Décisions

| # | Décision | Statut au 30 octobre 2026 |
|---|---|---|
| D-1 | Un conteneur devient un processus srt | Gardée |
| D-2 | Marketplace à la racine | Gardée |
| D-3 | Gateway séparée | Gardée ; jetons signés retirés |
| D-4 | `workflow` si stable, sinon `agent` | Gardée |
| D-5 | Postgres 17 natif | Gardée |
| D-6, a, b, c | Porte = tests, Gherkin, mutation 0 survivant, aucun hash | Gardées |
| D-7 | Baseline reportée, seuils non bloquants | Gardée |
| D-8 | Aucune exécution hors srt, quatre exceptions | Gardée |
| D-9 | `platformd` retiré | Gardée |
| D-10 | Broker seul détenteur de la clé | Gardée |
| D-11 | Un port | Gardée, amendée par DC-1 |
| DC-1 | srt d'abord, Docker là où srt n'est pas supporté, configuration explicite | Gardée ; preuve Docker au premier hôte réel |
| DC-2 | Clone `--no-hardlinks`, bundle, `git fetch`, copie non ouverte, dépôt de réception | **Retirée par le propriétaire** |
| DC-3 | `settle` verrouille `budgets` d'abord | Sans objet : états retirés |
| DC-4 | Workflows épinglés, `main` protégée | Gardée, inscrite en 1a |
| DC-5 | Poste un seul uid, uid dédié sur serveur | Gardée, R-3 |
| DC-6 | `/v1/oauth/*` jamais relayé | Gardée de fait : seul `POST /v1/messages*` passe |
| DC-7 | Résultat attendu par OS, changement signalé | Gardée |
| DC-8 | `bench/` hors production | Gardée dans `CLAUDE.md` ; garde dependency-cruiser retirée |
| DC-9 | Broker OAuth et mode Bearer | **Retirée par le propriétaire.** Clé API obligatoire dès qu'un tiers est servi |
| DC-10 | Outil de code = stage 0 simplifié | Gardée, réduite à `srt --settings builder.json claude` |
| DC-11 | O-31 reportée à D | Gardée, R-13 |
| O-1 | `pull_request_target` | Retrait proposé, à confirmer |
| O-2 | Diff des `.feature` contre le premier parent | Gardée, amendement `CLAUDE.md` en 1a |
| O-3 | « Aucun hash » vise les sorties de build | Gardée |
| O-23 | `CODEOWNERS` | Retrait proposé, à confirmer |
| O-24 | T-04R avec une vraie clé | Gardée, 1b.2 |
| O-26 | Purge des 474 mutants | Retrait proposé, à confirmer |
| O-27, O-28, O-29 | web-scout, db-migrator, `remember` | Gardées |
| O-32 | `node_modules` en lecture seule | **Retirée par le propriétaire** |
| O-33 | `zod` imbriqué de srt | Close : R-12 |
| O-5, O-6, O-13, O-14, O-16, O-19 | CLI srt, `data` natif, macOS en porte, cucumber partout, registre par `data`, clé en fichier 0600 | Closes, reprises dans le document |
| O-4, O-15, O-25, O-30 | Hébergement stage 0, source de `N_base`, sysctl local, repli de T-41 | Sans objet |
| O-7, O-9, O-10, O-11, O-12, O-17, O-21, O-22, O-31 | TLS Caddy, approbations, `plugins/` et `modules/`, BM25, réseau du builder, AppArmor, fusion `describe`, multi-utilisateur, sysctl | Reprises dans les briques ou le modèle de confiance |

## 5. Revues

**Première revue externe.** Frontière srt et multi-utilisateur : intégré. T-04 adversarial : joué, échec. `platformd` concentre les risques : supprimé. Jetons et budgets : mécanismes ajoutés, retirés depuis. Digests entre builds et seuils de mutation par composant : refusés par le propriétaire.

**Deuxième revue externe.** Port du broker non identifiant : accepté. PR à rapport vert sans assertion : jouée, T-44, elle passe. « Agent SDK hors sandbox » : rejeté, D-8.

**Troisième revue externe.** SQL de réservation non atomique : exact, réécrit, retiré depuis. `egress` et accès interne confondus : `internal_access` ajouté, retiré depuis, dérivé de `kind`. Garantie par retrait de la clé : reformulée ; le retrait est retiré. Broker sous srt : refusé, T-07, T-39b.

**Contre-expertise du 30 octobre.** Copie en worktree : hook écrit depuis la copie, exécuté par un `git commit` de l'hôte. Le propriétaire a retiré la réponse DC-2 : risque accepté, R-2, avec `denyWrite`. `git fetch <chemin>` lance `upload-pack` dans la copie. Interblocage `reserve(X)` rejoué × `settle(X)` reproduit. `main` non protégée, 0 ruleset. E-03-huge : défaut du banc. Latence : `docker run` 87 ms, `srt + node` 316 ms, `node` 107 ms. Niche de Docker : hôte Linux à démon rootful et sysctl non modifiable.

**Contradictions C-1 à C-32.** Closes. Celles qui vivent encore dans le document : clé dans une task (C-1) résolue par le broker ; `CLAUDE.md` à amender en 1a pour le diff (C-2), vitest (C-12) et le gateway (C-7) ; `.nvmrc` exact (C-10) ; la porte juge la forme, la revue l'équivalence (C-11) ; `stdio: 'pipe'` donne des sockets `AF_UNIX`, donc « descripteurs créés par l'adaptateur » (C-23). Le détail : `0dd97c5`, §18.

## 6. Test de pérennité, 30 octobre 2026

À rejouer au déclenchement (`gh api repos/<dépôt>`, releases, domaines des auteurs sur 90 jours). Critères : licence open source, gouvernance plurielle, activité, adoption, pas d'éditeur unique.

| Candidat | Verdict | Motif |
|---|---|---|
| Docker, Podman | Retenus pour le port | Podman : CNCF Sandbox, rootless, `podman machine` sur macOS |
| Kata Containers | Retenu si contenu hostile | OpenInfra, VM légères, virtualisation matérielle requise |
| bubblewrap, Landlock | Primitives | Pas de filtre réseau par domaine |
| gVisor, Firecracker, `apple/container` | Écartés | Un seul éditeur. gVisor reste conseillé par Anthropic pour le multi-tenant |
| srt | Échouerait au critère éditeur | Anthropic à 96 % des commits, 14 versions en 90 jours ; d'où le port |

Si srt est abandonné : (a) fork, 23 160 lignes de JS, binaires seccomp, environ une version par semaine à trier ; (b) adaptateur fin sur Seatbelt et bubblewrap, code critique, `sandbox-exec` déprécié. Une évasion ne se voit pas à la relecture : le banc et `escape.feature` restent la preuve dans tous les cas.

## 7. Passe de simplification, 30 octobre 2026

Position du propriétaire : voir l'en-tête du document. Base `0dd97c5`. Méthode : pour chaque mécanisme, risque réel sur le poste puis pour des utilisateurs fiables, coût, valeur.

| Mécanisme | Décision | Risque résiduel accepté |
|---|---|---|
| Gateway, méta-tools, résultat borné, manifeste, `kind`, MCP stdio, un conteneur = un processus srt, quatre natifs, broker, Postgres 17, marketplace racine, nom isolé, compte de la porte | Gardés, intangibles | R-5, R-8 |
| Jetons Ed25519 par appel | Retiré. Stdio avec un seul parent ; rappel par jeton opaque de module | R-10 |
| États de budget, `unknown`, `overdrawn`, `reservation_id`, `budget_transitions` | Retirés. Deux UPDATE, T-20. Interruption = montant retenu | R-9 |
| `capacity.*` | Simplifié : compteur en mémoire de la gateway | Compteur perdu au redémarrage, sandboxes mortes avec lui |
| Autorité de lancement, cinq points | Simplifié : signature fermée, `stdio` constante, une règle d'architecture | R-8 |
| Autorisation de task : `mask`, `tlsTerminate`, `broker.localhost`, `LEASE_OUT_OF_PLACE`, un listener par task | Retirée : un listener, un jeton opaque en clair | R-3, R-4 |
| Retrait de la clé en réponse | Retiré, contournable (T-42h) | R-11 |
| Profils srt multiples | Simplifié : un gabarit et une variable réseau | Moins de finesse par profil |
| `repo-prepare`, `gate-tests` | Retirés | R-2, R-6 |
| Hooks Claude Code `PreToolUse` (1a.0) | Ajoutés à la demande du propriétaire, couche de réduction, jeu minimal à confirmer | Bash obfusqué, code lancé par un script |
| `calls_allowed` | Simplifié : liste à chaque appel, cycle refusé au chargement, sans `parent` | Profondeur non suivie, bornée par timeout |
| Profils de task | Gardés, format Claude Code | |
| Registre | Gardé, table append-only existante | |
| Catalogue de repli | Gardé, boucle existante | |
| `internal_access` | Retiré, dérivé de `kind` | |
| Trois utilisateurs OS sur serveur | Simplifié : un uid | R-3, R-8 |
| `CODEOWNERS` | Retiré, à confirmer | R-6 |
| Mutation étendue et purge des 474 | Retirées, à confirmer ; 0 survivant sur le diff reste | R-6 (T-22) |
| PR sentinelles | Remplacées par des rapports fixtures | R-6 |
| `pull_request_target`, double checkout, T-35, T-50 | Retirés, à confirmer : `pull_request`, comme v3 | R-6 |
| `gate-count.json`, `N_base`, « base déplacée » | Retirés : base comptée au premier parent | La somme devient une identité, la protection est `exécutés = statique` |
| CI multi-OS | Simplifié : tout sur Linux, `features/sandbox/` sur macOS | Un défaut hors sandbox propre à macOS passe la porte |
| Stage 0 : paquet publié, build-1, build-2, promotion, T-18 | Retiré, à confirmer | Pas de garantie de reconstruction au-delà de la porte |
| Pool chaud | Retiré | 211 ms par session |
| `--permission`, tableaux d'audit, §16, §18, O-xx closes | Retirés du document ou journalisés | |
| Briques 2 à 8 | Gardées, le produit reste, une ligne et une preuve | |

Sort des tests :

| Devenir | Tests |
|---|---|
| Vrais scénarios à écrire | `canary`, `spawn` (T-40, T-47, T-52), `broker` (T-23b, T-04R), `budget` (T-20), `gateway` (T-25, T-29, T-30), `arguments` (T-51), `code-front` (T-48), `escape` (T-28, T-03L), `manifest`, `name`, T-49 |
| Serveur, brique D | T-26, T-31, T-09L, profil AppArmor |
| Recherche close, ici seulement | T-01 à T-24, E-01 à E-09, T-37 à T-44, M-01 |
| Retirés avec leur mécanisme | T-14c, T-14d, T-18, T-21, T-27, T-32, T-35, T-35-pre, T-37b, T-42 Bearer, T-43e, T-45, T-45l, T-46, T-50, T-34h-variante |
| Attendent le premier hôte réel | T-41D, T-38D, T-06D, T-34D, T-43D |

**Contrainte relevée.** `bench/src/tests/t45.ts:22-28` lit son SQL dans `platform-v3-srt.md`, entre `### 4.5 Budgets` et `### 4.6`, et un push sur cette branche lance le banc. Le code du banc étant hors de cette passe, le bloc reste en annexe, extraction contrôlée identique à `0dd97c5`. (Annexe retirée le 30 octobre, §12.)

## 8. Vérifications sur le poste, 30 octobre 2026

Faites par un agent en parallèle, reçues du coordinateur, non rejouées ici.

- **Builder.** `srt --settings builder.json claude` fonctionne sur macOS en `-p` avec le compte Claude, un appel réel minimal. Le profil demandé casse `git commit` et permet une évasion prouvée en réécrivant `.git/worktrees/<w>/commondir` ; profil retenu au §8 du document, sous réserve de décision du propriétaire. Le trousseau est lisible depuis la sandbox. TUI à valider au premier lancement.
- **`zod` sous srt.** Non exploitable depuis la sandbox, seul `safeParse` observé, sur la configuration de démarrage ; un override ne corrige rien. Le vrai risque est dans notre code : `WorkerOutputSchema.evidence` sans borne (`tools.ts:82`) et stdout sans plafond (`docker-runner.ts:93-99`), 2 Mo donnant 545 Mo de tas. Inscrit en 1b.1 et 1b.5.
- **Workflows.** Un externe ne lance pas Claude ; la revue n'a jamais produit de revue. Correction minimale inscrite en 1a.
- **Hooks de protection, précision du propriétaire.** « Les hooks de protection sont là pour protéger aussi. » Lu, sans expérience : le profil retenu n'a dans `allowWrite` ni `~/.claude/settings.json`, ni `settings.local.json`, ni `plugins`, ni `hooks` de `~/.claude`. `DANGEROUS_DIRECTORIES` de srt (`sandbox-utils.js`) ne couvre que `.claude/commands` et `.claude/agents`, pas `.claude/settings.json`. Doc Claude Code : le projet a priorité sur l'utilisateur, les hooks se rechargent par surveillance des fichiers, `disableAllHooks` suit cette priorité. **Déduit, à prouver :** un `disableAllHooks: true` écrit dans le worktree couperait les hooks utilisateur ; d'où deux `denyWrite`. **Déduit, à prouver :** `shell-snapshots` et `session-env`, inscriptibles et partagés, pourraient faire exécuter du code par une session hôte hors sandbox.

## 9. Sources Anthropic lues

[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), [Writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents), [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Best practices](https://code.claude.com/docs/en/best-practices), [Plugins](https://code.claude.com/docs/en/plugins-reference), [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment), [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting), [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) (connexion claude.ai non offerte à des tiers, d'où la clé API), [Cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [Sandboxing](https://code.claude.com/docs/en/sandboxing), [Sandbox environments](https://code.claude.com/docs/en/sandbox-environments), [GitHub Actions](https://code.claude.com/docs/en/github-actions), README de srt 0.0.81.

Écart assumé : ces articles conseillent de partir du plus simple ; la plateforme part de l'Agent SDK, par directive de suivre l'amont. Évaluation des tools reportée avec la baseline.

## 10. Audit et décisions du propriétaire, 30 octobre 2026

**Audit en lecture seule de la passe du §7.** La séparation des processus est conservée, mais la gateway a été amputée (DAG d'appels avec profondeur et délai, `trace` et `parent` au registre, `writes_tables` à l'opération) et `manifest-registry` effacé, ses fonctions données à la gateway. Aucun composant de la figure 1 de v3 n'avait de décision écrite du propriétaire pour cela. D'où un intangible : chaque composant de cette figure est un processus séparé, aucune passe ne fusionne ni ne retire un composant sans décision écrite du propriétaire (document, §9, A).

**Correctif validé par le propriétaire, inscrit au document.**

| Point | Avant | Après |
|---|---|---|
| `manifest-registry` | Absent, la gateway lisait les manifestes | Module sous srt, réseau nul ; la gateway ne lit que sa sortie validée. Structurer, Judge, Embedder nommés modules workflow sous srt |
| Rappel d'un module | Jeton opaque de module, `task` déclarée par le module (R-10) | Identifiant d'appel opaque, sans cryptographie, par `tools/call`, relié à {task, parent, profondeur, échéance}, invalidé au retour. R-10 fermé |
| DAG | Profondeur non suivie, bornée par timeout | Profondeur maximale et échéance portées par l'identifiant ; un appel sans modèle est borné par échéance, profondeur, `max_result_tokens`, plafond d'octets |
| Registre | Verdict et tokens | `trace`, `parent`, verdict, tokens par couche |
| `writes_tables` | Au chargement seulement | Aussi à chaque opération, par la gateway, d'après le module appelant |
| Serveur | Un uid pour toute la plateforme | Un uid propre au broker ; gateway et `data` peuvent partager un uid ; R-8 dit ce qu'une gateway compromise lit ou non |
| Concurrence | Compteur en mémoire, non qualifié | Écart au « stateless » de v3 accepté : il ne compte que des enfants qui meurent avec la gateway ; dans `data`, une écriture par appel et une fuite à chaque arrêt brutal. Mort des enfants avec la gateway à prouver (`spawn.feature`) |
| Profils | « La seule variable est le réseau » | Réseau et lectures en plus ; cwd jetable par session, par task, par processus de module |
| Budget | Gateway et broker cités tous deux comme décideurs | La gateway fixe le plafond, le broker exécute. **Remplacé le 30 octobre** : aucun plafond (§12) |

**Décisions du propriétaire.** Remplacent les statuts « à confirmer » du §4, qui restent tels qu'écrits à leur date.

| # | Décision | Statut |
|---|---|---|
| 1 | Profil builder de 1a.0, avec R-1, R-2 et les `denyWrite` sur `.claude/settings.json` et `settings.local.json` du worktree | Adoptée |
| 2 | Jeu minimal de hooks `PreToolUse`, dans un plugin de la marketplace, jamais dans `~/.claude/settings.json`. Tests à la sortie de 1a.0 : chargement, application à la TUI sous srt, impossibilité de couper depuis le worktree, `main` et config git commune intouchables ; sinon risque accepté écrit | Adoptée ; les deux risques du §8 (hook de worktree, dossiers de session partagés) restent à prouver à la même sortie |
| 3 | O-33 `zod` sans override, profil hors chemin inscriptible ; `.max()` sur `evidence`, plafond d'octets sur stdout | Adoptée |
| 4 | Workflows épinglés par SHA, garde sur l'acteur, ruleset sur `main` avec contournement du propriétaire, en 1a | Adoptée |
| 5 | O-1, O-23, O-26 | Retirées ; détection d'assertions affaiblies refusée, reste dans R-6 |
| 6 | Stage 0 publié et `fixpoint.sh` | Retirés ; aucune affirmation de reproductibilité |
| 7 | Base de la porte lue dans le dernier run vert de `main` | Adoptée ; remplace « base comptée au premier parent » du §7 ; `exécutés = statique` conservé |
| 8 | Budgets : table de réservations, `settle` par `DELETE … RETURNING` | Adoptée, à prouver (T-45 rejoué : concurrence, rejeu, interblocage `reserve` × `settle`). **Remplacée le 30 octobre** par les décisions 11 et 12 (§12) |
| 9 | Nettoyage du banc | Tâche inscrite ; ces résultats restent ici |
| 10 | Marque `ai-architect.tools` | Rétablie au titre ; `architect-os` provisoire |

**Règle d'arrêt des revues**, inscrite en tête des décisions ouvertes : consensus quand une revue ne trouve plus ni défaut de correction fonctionnelle ni contradiction avec les décisions du propriétaire ; un risque nommé et accepté ne bloque pas ; un mécanisme supplémentaire proposé n'est pas un défaut.

**Choix de rédaction à relire.** La base de la porte exige que le run vert de `main` porte le SHA du premier parent du commit de merge, faute de quoi l'identité échoue à tort ; la porte est alors rouge et se relance. R-10 garde un résidu nommé : un module compromis qui sert deux appels à la fois peut présenter l'un pour l'autre. L'Orchestrateur de conteneurs de v3 n'est pas un processus séparé : il est le port `SandboxRunner` de la gateway, couvert par D-9 et D-10. L'annexe de `platform-v3-srt.md` reste octet pour octet l'entrée de T-45 jusqu'à la tâche 9.

## 11. Relecture de consensus, e8389ec, 30 octobre 2026

Expériences X-1 à X-7 (`budget-sql.out`), `atomicity.out` et `ddl-check.out`, Postgres 17.9 jetable, SQL extrait du document, rejouables en une commande (`node budget-sql.mjs`). Chaque correction cite la ligne corrigée de `e8389ec`.

| Défaut | Ligne corrigée | Correction | Preuve |
|---|---|---|---|
| D1 (sans objet depuis le 30 octobre, §12) | md 71 « id déjà vu = 23505 » | Contrat sur 0 ligne : `id` présent dans `budget_reservations` = rejeu, absent = refus ; `UNIQUE` sur `id` et colonnes au DDL du §2 | X-1 : rejeu de 60 sur plafond 100 retenu à 60 = 0 ligne sans erreur ; `ddl-check.out` : 0 ligne puis 23505 |
| D2 | md 61, 66, R-8, html 33, 52 | Émetteur du jeton = gateway ; ordre en une règle, association sur le stdin du broker, flèches gateway → broker et broker → data | rapport, D2 |
| D3 | md 174, 190, 199, 203 | Variables = réseau, lectures et écritures en plus ; sortie persistante de `manifest-registry` hors du cwd jetable | rapport, D3 |
| D4 | html 156, 163, aria-label 33 | Étape 7 module → gateway → executor ; « étapes 4 à 10 » ; rappel module → gateway dessiné | rapport, D4 |
| D5 | md 33 | `tasks` MCP et `task.wait` retirés : ouverts dans la v3 (§9, brique 2), non repris ici | rapport, D5 |
| D6 | md 266 | Repli écrit : base = compte statique du premier parent, signalé au rapport, sans porte rouge | rapport, D6 |
| D7 | md 143, 324, 353 | `trace`, `parent` : migration à écrire, brique 2 ; 0003 n'interdit que l'UPDATE d'un run terminé | `data/migrations/0003_runs_immutable.sql` |
| D8 (sans objet depuis le 30 octobre, §12) | §2, 1b.3 | `CHECK` non négatif sur `cap`, `reserved`, `spent`, `amount` ; coût de `settle` négatif refusé par `data` ; scénario en 1b.3 | `atomicity.out` C : `spent` −500, 1 400 acceptés sur 1 000 ; `ddl-check.out` : `CHECK` refuse un coût qui rend `spent` négatif |
| D9 | md 22, 139, 353 | « R-10 fermé » remplacé par usurpation hors des appels actifs refusée, confusion entre appels concurrents acceptée | R-10 |

Objection « CTE non atomique » (revue externe 1), réfutée par expérience : `atomicity.out`, 23505 annule toute l'instruction en autocommit, en transaction explicite et avec SAVEPOINT.

Confirmé sans défaut : X-2 (`settle` rejoué, 50 concurrents ×6 : 1 ligne), X-3 (300×10 sur 1 000 : 100, puis 30), X-4 (facture 150 sur plafond 100 : réservation suivante refusée), X-5 cas I (40P01 sur `reserve` rejoué, rien d'écrit ; cas II non observé), X-7 (1 780 opérations ×6 : 0 interblocage, invariant tenu).

Hors correction, notés : montant par requête non fixé ; X-6, `reserve(X)` rejoué après `settle(X)` recrée la ligne ; précédence `timeout` / `timeout_ms` d'un tool `agent`. Annexe du banc : inchangée, `t45.ts` lit son SQL entre les titres 4.5 et 4.6 et ne lit rien du §2, donc aucun effet sur `t45.ts`.

## 12. Décisions du propriétaire et relecture de 0ef74e6, 30 octobre 2026

Remplacent le §10 décision 8 et la ligne « Budget » du correctif du §10, qui restent tels qu'écrits à leur date ; D1 et D8 du §11 deviennent sans objet.

| # | Décision | Statut |
|---|---|---|
| 11 | Aucun plafond financier. Le coût est mesuré pour la traçabilité et la prévision, rien d'autre : aucune réservation, aucune coupure de task, aucun refus pour raison financière | Adoptée |
| 12 | Bornes opérationnelles : une task peut toujours être interrompue, aucune boucle ne tourne indéfiniment. Délai maximal et nombre maximal d'appels par task (profil client), `maxTurns` pour un agent ; borne atteinte ou annulation par le propriétaire = identifiants et jeton invalidés, groupe srt de la task tué | Adoptée |

**Inscription au document.** Retirés : bloc « Budgets » du §2 (DDL `budgets` et `budget_reservations`, `budget.reserve`, `budget.settle`, contrat sur 0 ligne), `budget_tokens`, `maxBudgetUsd`, `budget.feature`, l'ancien R-9, et « budgets » dans STRIDE D, R-4, R-7, R-8, B, C.8 et 1b.3. R-9 devient l'acceptation écrite de l'absence de plafond. Écrits : mesure du coût par réponse au broker (`usage` avec cache lu et écrit, modèle, task, parent, horodatage), persistée en append-only par `data`, à prouver en 1b.2 et 1b.3 ; bornes opérationnelles, à prouver en 1b.4 ; `max_turns` remplace `budget_tokens` au manifeste ; précédence des `timeout` : le plus court gagne ; « Budget le long du DAG » renommé « Bornes le long du DAG ».

**Transport broker → `data` (C.3).** Le broker est serveur MCP pour la gateway sur son stdio : {jeton, task} lui arrive par un `tools/call` (C.1, md 52 et 66, html 31, 33, 135), le retrait du jeton par un second. Il remonte chaque enregistrement par une notification MCP standard (`notifications/message`, logger `usage`) ; la gateway l'écrit par `data`. Aucun lien broker → `data` : la flèche est retirée de la figure 1. `data` injoignable : la gateway retire les jetons, le broker répond `401`. Hors règle : le dossier persistant de `manifest-registry` est nommé en figure 1 ; la sortie de la brique D nomme le broker lancé sous son uid, stdio conservé (C.2), à prouver.

**Annexe du banc retirée**, ce qui remplace la « Contrainte relevée » du §7. `bench/src/tests/t45.ts` lit le document à l'exécution seulement (`readFileSync`) : les titres absents donnent un SQL vide, et T-45 sort en échec au banc à chaque push sur cette branche jusqu'à la tâche 9, qui le retire comme sans objet. `npm run check` ne lit ni `bench/` ni `docs/design` (inclusions de vitest, références de `tsconfig.json`, `.prettierignore`). Le SQL de l'annexe reste lisible à `0ef74e6`. Sort des tests du §7 : `budget` (T-20) sans objet ; T-20 reste une recherche close.

**Relevé historique de la relecture de `0ef74e6`.** SQL extrait de `0ef74e6`, Postgres 17.9 jetable, 13/13 PASS, une commande (`node budget-sql-v2.mjs`, dossier de relecture hors dépôt). Le mécanisme testé étant retiré, ce relevé ne prouve rien de la conception.

| X | Résultat |
|---|---|
| X-1 | Rejeu de 60 sur plafond 100 retenu à 60 : 0 ligne sans erreur, `id` présent, donc rejeu ; rejeu de 5 : 23505, budget inchangé |
| X-2 | `settle` rejoué, 50 concurrents ×6 : 1 ligne |
| X-3 | 300 réservations de 10 sur 1 000 : 100, puis 30 après règlement |
| X-4 | Facture 150 sur plafond 100 : réservation suivante refusée |
| X-5 | Interblocage `reserve` rejoué × `settle` : cas I (`reserve` victime de 40P01) à `e8389ec`, cas II (`settle` victime de 40P01, `reserve` rejoué 23505) ici ; rien d'écrit dans les deux |
| X-6 | `reserve(X)` rejoué après `settle(X)` recrée la ligne (§11) |
| X-7 | 1 780 opérations ×6 : aucun interblocage, invariant tenu |
| X-8 | `settle(−500)` sur `spent` 0 et `reserve(−10)` : 23514 ; `settle(−50)` sur `spent` 100 passe le DDL (`spent` 50) : seul le refus de `data` à sa frontière fermait |
| X-9 | 50 rejeux concurrents sur plafond atteint : 0 ligne ×50, aucune erreur |
| X-10 | `reserve(B, X, 30)` après `reserve(A, X, 60)`, plafond de B refusant : 0 ligne, `id` présent, « rejeu, succès » sans rien réserver pour B |

## 13. Clôture de la relecture de consensus, 62e5131, 30 octobre 2026

- Clôture de la relecture de 62e5131 (`rapport-62e5131.md`, dossier de relecture hors dépôt) : le document reste à 366 lignes (borne 372), sans code, test ni workflow.
- Défauts bloquants 1 et 2 : M1 et la couche client viennent du hook M1 de la brique 1c, `usage` couvre le broker, M2 agrège les deux ; la gateway passe {jeton, task, parent} au broker (md 66, html 33 et 135).
- Contrats 3 à 5, décidés par le propriétaire : réponse interrompue sans enregistrement (la facture fait foi), indisponibilité de `data` détectée à l'échec du `tools/call` puis jetons réémis, fin par borne ou annulation sans `verify` ni verdict et portée au registre ; hors règle : `timeout_ms`, T-42h et T-43d conservés, `maxTurns` en scénario, tool d'annulation.
