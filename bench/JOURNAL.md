# Journal du banc 1b.0 (append-only)

Chaque entree : une variable, le constat, la cause racine, la suite. Les echecs restent.

## 2026-10-30, run 41037109539 (commit 9c161f5)
- macOS CI : T-41a, T-41b, T-41d, I-7 en echec. `EPERM: operation not permitted, mkdir '/tmp/claude-501'`. Cause : le binaire Claude Code cree son repertoire temporaire par `mkdir` non recursif ; sur le poste il existait deja (artefact de session), pas sur le runner. Le run local etait donc un faux vert.
- Linux CI : srt fonctionne (bwrap 0.9.0, sysctl a 0). T-38, T-39, E-02 sous srt, T-41 : `ENOENT mkdir /tmp/claude/tsx-1001`. Cause : srt fixe `TMPDIR=/tmp/claude` dans la sandbox sans le creer ; tsx y fait un `mkdir` non recursif. Correction : un tmp par monde, transmis par `CLAUDE_CODE_TMPDIR` et ajoute a `allowWrite`.
- Erreur du banc : T-03f avait son attendu inverse sur Linux (parametre `expectReached` passe a l'envers). Corrige.
- Hypothese du banc fausse sur Linux : `denyRead:["~"]` y masque `~` par un tmpfs (ENOENT, liste vide, ecriture ephemere) au lieu d'un EPERM. La propriete testee devient : rien de sensible visible, rien de persiste sur le disque de l'hote (T-02d2, T-02e*), pas un code d'erreur precis.

## 2026-10-30, run 41037711860 (commit c2af66d)
- macOS CI : 47 pass, 0 fail, 2 residual (T-03f, T-06b), 3 constats.
- Linux CI : 44 pass, 5 fail.
  - T-02e, T-02e2 : un hook git et `.git/config` ECRITS PAR LA SANDBOX PERSISTENT sur l'hote quand le chemin n'existait pas au lancement (README srt : seuls les chemins presents sont proteges, recherche limitee en profondeur). T-02e3 (depot a la racine du cwd, cree par l'hote) tient. Suite : T-02e4, `denyWrite` explicite.
  - T-07-fd0 : sous Linux, un socket d'ecoute passe en fd 0 est utilisable par la sandbox (`servi-depuis-sandbox` recu). macOS : EPERM. fd 3 tient. Echec conserve : l'invariant de conception (fd 0-2 sont des tubes) devient une obligation de l'hote.
  - T-38, T-41c : `list_home` reussit sous Linux (tmpfs vide). Defaut d'assertion du banc, corrige (contenu sensible absent).
