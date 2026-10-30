# packages/sandbox

Ce paquet contient le port `SandboxRunner`, l'adaptateur srt (`@anthropic-ai/sandbox-runtime` 0.0.81), le proxy d'authentification de l'hôte et l'outil de code isolé de la brique 1a.0 ([`docs/design/platform-v3-srt.md`](../../docs/design/platform-v3-srt.md), §6 et §8). Les preuves sont dans [`docs/design/journal.md`](../../docs/design/journal.md), §14 et §15.

Les scénarios Gherkin du paquet sont dans `features/` (étapes dans `features/steps`) : proxy d'authentification, profil, `code.json`, worktree, contrat `SandboxRunner` sur l'adaptateur en mémoire. Ceux qui lancent de vraies sandboxes srt sont dans `features/sandbox/` à la racine du dépôt, sous macOS comme sous Linux ; ils échouent, sans jamais être sautés, quand srt ne peut pas tourner. Le faux srt sans isolation est `fixtures/no-isolation-srt.mjs`.

## La commande

Depuis un worktree du dépôt, `<repo>/.claude/worktrees/<w>` :

```bash
npm --prefix <checkout du lanceur> run code -- <arguments de claude>
```

À chaque lancement, l'outil fait ceci, dans l'ordre (`code.json`, `profiles/builder.json`) :

1. Il lit l'identifiant Claude de l'hôte dans le trousseau, comme Claude Code sur l'hôte, et le garde en mémoire dans le proxy d'authentification (`src/auth-proxy.ts`). Le proxy est natif, sur `127.0.0.1:<port aléatoire>`.
2. Il crée un dossier temporaire propre à la sandbox, qui contient :
   - le profil srt résolu (en lecture seule) ;
   - `tmp` (`CLAUDE_CODE_TMPDIR`) ;
   - `config` (`CLAUDE_CONFIG_DIR`), avec `settings.json` (`sandbox.enabled: false`, en lecture seule pour la sandbox) et `.claude.json` (onboarding fait, dossier approuvé).
3. Il lance le canari, puis `srt --settings <profil> -- env -u NO_PROXY -u no_proxy claude --plugin-dir <lanceur>/plugins/builder-guard <arguments>`. La sandbox reçoit seulement `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` et `CLAUDE_CODE_OAUTH_TOKEN=<jeton de session aléatoire>`.
4. À la fin, il révoque le jeton de session, ferme le proxy et retire le dossier temporaire.

Aucun secret ne franchit la frontière. Le proxy ne relaie que `POST /v1/messages` et `POST /v1/messages/count_tokens` vers `api.anthropic.com`, en remplaçant l'`Authorization`. Il répond 403 à toute autre route ou méthode, et 401 sans le jeton de session. Il écrit une ligne d'`usage` par réponse (modèle, tokens, horodatage, route, type d'erreur, jamais le contenu) dans `~/.local/state/architect-os/usage.jsonl`.

Le proxy ne renouvelle pas l'identifiant OAuth. Le jeton de rafraîchissement change à chaque usage : le renouveler ici déconnecterait l'hôte. Quand l'identifiant expire, le proxy relit le trousseau ; s'il a expiré, il répond 503, et il suffit de lancer une session `claude` sur l'hôte.

Le checkout du lanceur (son code, son `node_modules` avec srt, le plugin) doit être hors du worktree visé, sinon une session pourrait réécrire srt ou le lanceur pour le lancement suivant. Lancé depuis le worktree qui l'héberge, l'outil refuse de démarrer (`ISOLATION_UNAVAILABLE`). Après fusion, le checkout principal `<repo>` sert de lanceur.

Avec un terminal, la TUI démarre sur les descripteurs du terminal, acceptés seulement si 0, 1 et 2 sont des terminaux. Sans terminal (`-p` dans un script), les flux sont des tubes créés par l'adaptateur.

Le dossier de configuration est recréé à chaque lancement : aucun historique de session ne passe d'un lancement à l'autre (pas de `--resume`).

## Autorisé, refusé

| Domaine          | Profil `builder`                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Écriture         | Le worktree ; `<repo>/.git/worktrees/<w>`, `.git/objects`, `.git/refs`, `.git/logs` ; `~/.cache` ; le dossier de configuration et le `tmp` de la sandbox                                                                                                                                                     |
| Écriture refusée | `<repo>/.git/hooks`, `<repo>/.git/config` ; `worktrees/<w>/commondir`, `gitdir` et `config.worktree` ; `refs/heads/main` ; `<worktree>/.claude/settings.json` et `settings.local.json` ; `settings.json` du dossier de configuration ; tout le reste, dont `~/.claude`, `~/.claude.json` et le profil résolu |
| Lecture refusée  | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.npmrc`, `~/.netrc` ; `~/.claude` ; `~/.claude.json` ; `~/Library/Keychains` (le trousseau devient introuvable depuis la sandbox)                                                                                                                         |
| Réseau           | Le port du proxy d'authentification et `registry.npmjs.org`. Tout le reste reçoit `403` du proxy srt, `api.anthropic.com`, claude.ai et GitHub compris : `git fetch` et `git push` se font depuis l'hôte                                                                                                     |
| Terminal         | `allowPty` (macOS) : sans lui, la TUI ne peut pas passer le terminal en mode brut ; `TIOCSTI` reste refusé                                                                                                                                                                                                   |
| Hooks            | Plugin `builder-guard`, chargé par `--plugin-dir` depuis le lanceur, avec `onFailure: block`. Il refuse `git push` vers `main`, les push forcés, `security find-*`, les fichiers de secrets, et les écritures dans `.git/hooks` et `.git/config`. C'est une couche de réduction, pas une frontière           |

Refus sans repli : srt absent, canari qui lit son fichier secret ou joint le port de l'hôte, chemin de confiance inscriptible, répertoire hors d'un worktree lié, identifiant de l'hôte illisible (`ISOLATION_UNAVAILABLE`, `NOT_A_WORKTREE`).

L'adaptateur Docker n'est pas écrit : le poste supporte srt, et le port est prêt pour lui (§6, au premier hôte qui en a besoin).

## Risques acceptés (document, §4.2)

| #   | Risque                                                                                                                                                                                                                                                                                                                                                                  | Pourquoi on vit avec                                                                        | Ce qui le borne                                                                                                            | On le rouvre si         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R-1 | Outil 1a.0 : le trousseau est lisible depuis la sandbox, donc le jeton Claude et possiblement GitHub ; exfiltration et push possibles par les domaines autorisés (README srt, « Security Limitations »)                                                                                                                                                                 | Outil personnel, poste du propriétaire, simplicité d'usage réel                             | Révocation ; réseau limité à trois fournisseurs ; `denyRead` ciblés ; hooks `PreToolUse` ; ruleset sur `main` comme limite | Tout usage par un tiers |
| R-2 | Tout ce que l'hôte lance dans le worktree exécute du code écrit par la sandbox : `git`, scripts npm, `.claude/settings.json`, `.envrc`. Sous Linux, un hook écrit dans un dépôt imbriqué non nommé persiste [T-34h, T-34i, T-02e, T-02e2]. Les dossiers de session de `~/.claude` restent inscriptibles et partagés avec les sessions hôte hors sandbox (à prouver, §8) | Même risque qu'aujourd'hui avec tout code d'agent ; la lecture du diff précède le lancement | `denyWrite` du dépôt principal ; revue                                                                                     | Un incident réel        |

Ces deux risques sont copiés tels quels du document. Depuis le schéma du journal (§15), ils sont réduits :

- **R-1** : le trousseau est introuvable depuis la sandbox, aucun identifiant n'y entre, et le réseau se limite au proxy et à npm. Il reste deux voies. Une sortie de données par le contenu envoyé au modèle ou par les URL de npm. Et un jeton de session, valable seulement pendant la session et seulement vers `/v1/messages`.
- **R-2** : les dossiers de session ne sont plus partagés avec l'hôte. Le reste de R-2 (code lancé par l'hôte dans le worktree, refs locales autres que `main`) demeure.
