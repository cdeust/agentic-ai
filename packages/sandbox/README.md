# packages/sandbox

Port `SandboxRunner` et adaptateur srt (`@anthropic-ai/sandbox-runtime` 0.0.81), et l'outil de code isolé de la brique 1a.0 ([`docs/design/platform-v3-srt.md`](../../docs/design/platform-v3-srt.md), §6 et §8). Preuves : [`docs/design/journal.md`](../../docs/design/journal.md), §14.

## La commande

Depuis un worktree du dépôt, `<repo>/.claude/worktrees/<w>` :

```bash
npm --prefix <checkout du lanceur> run code -- <arguments de claude>
```

Elle résout le profil `profiles/builder.json` pour ce worktree, l'écrit dans un dossier temporaire hors de tout chemin inscriptible, lance le canari, puis `srt --settings <profil> -- claude --plugin-dir <lanceur>/plugins/builder-guard <arguments>` (`code.json`). Le binaire `claude` est celui installé, résolu dans `PATH`. Le compte Claude du propriétaire sert tel quel ; `CLAUDE_CONFIG_DIR` et toute variable `ANTHROPIC_*` ne passent pas.

Le checkout du lanceur (son code, son `node_modules` avec srt, le plugin) doit être hors du worktree visé : une session pourrait sinon réécrire srt ou le lanceur pour le lancement suivant. `npm run code` lancé depuis le worktree qui héberge le lanceur est refusé (`ISOLATION_UNAVAILABLE`). Après fusion, le checkout principal `<repo>` sert de lanceur.

Avec un terminal, la TUI démarre sur les descripteurs du terminal, acceptés seulement si 0, 1 et 2 sont des terminaux ; sans terminal (`-p` dans un script), les flux sont des tubes créés par l'adaptateur.

## Autorisé, refusé

|                  | Profil `builder`                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Écriture         | Le worktree ; `<repo>/.git/worktrees/<w>`, `.git/objects`, `.git/refs`, `.git/logs` ; `~/.cache` ; les dossiers de session de `~/.claude` (`projects`, `todos`, `session-env`, `shell-snapshots`, `file-history`, `debug`, `statsig`, `cache`, `tasks`, `plans`) ; le dossier temporaire de la sandbox (`CLAUDE_CODE_TMPDIR`) |
| Écriture refusée | `<repo>/.git/hooks`, `<repo>/.git/config`, `worktrees/<w>/commondir`, `gitdir`, `config.worktree`, `refs/heads/main` ; `<worktree>/.claude/settings.json` et `settings.local.json` ; tout le reste, dont `~/.claude/settings.json`, `~/.claude.json`, `~/.claude/plugins` et le profil résolu                                 |
| Lecture refusée  | `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.npmrc`, `~/.netrc`                                                                                                                                                                                                                                                        |
| Réseau           | Anthropic, claude.ai, npm, GitHub (`allowedDomains` du gabarit) ; tout autre domaine reçoit `403` du proxy srt                                                                                                                                                                                                                |
| Terminal         | `allowPty` (macOS) : sans lui, la TUI ne peut pas passer le terminal en mode brut ; `TIOCSTI` reste refusé                                                                                                                                                                                                                    |
| Hooks            | Plugin `builder-guard` (`plugins/builder-guard`) : refuse `git push` vers `main`, les push forcés, `security find-*`, les fichiers de secrets, les écritures dans `.git/hooks` et `.git/config`. Une couche de réduction, pas une frontière. **Ne s'exécute pas encore sous le profil** : voir le journal, §14, X-HOOK        |

Refus sans repli : srt absent, canari qui lit son fichier secret ou joint le port de l'hôte, chemin de confiance inscriptible, répertoire hors d'un worktree lié (`ISOLATION_UNAVAILABLE`, `NOT_A_WORKTREE`). L'adaptateur Docker n'est pas écrit : le poste supporte srt ; le port est prêt pour lui (§6, au premier hôte qui en a besoin).

## Risques acceptés (document, §4.2)

| #   | Risque                                                                                                                                                                                                                                                                                                                                                                  | Pourquoi on vit avec                                                                        | Ce qui le borne                                                                                                            | On le rouvre si         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R-1 | Outil 1a.0 : le trousseau est lisible depuis la sandbox, donc le jeton Claude et possiblement GitHub ; exfiltration et push possibles par les domaines autorisés (README srt, « Security Limitations »)                                                                                                                                                                 | Outil personnel, poste du propriétaire, simplicité d'usage réel                             | Révocation ; réseau limité à trois fournisseurs ; `denyRead` ciblés ; hooks `PreToolUse` ; ruleset sur `main` comme limite | Tout usage par un tiers |
| R-2 | Tout ce que l'hôte lance dans le worktree exécute du code écrit par la sandbox : `git`, scripts npm, `.claude/settings.json`, `.envrc`. Sous Linux, un hook écrit dans un dépôt imbriqué non nommé persiste [T-34h, T-34i, T-02e, T-02e2]. Les dossiers de session de `~/.claude` restent inscriptibles et partagés avec les sessions hôte hors sandbox (à prouver, §8) | Même risque qu'aujourd'hui avec tout code d'agent ; la lecture du diff précède le lancement | `denyWrite` du dépôt principal ; revue                                                                                     | Un incident réel        |
