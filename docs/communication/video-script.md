# ai-architect.tools : script et storyboard de la vidéo, en trois actes

Vidéo d'environ 5 minutes, en français, pour le build in public. Public externe : l'acte 1 et le début de l'acte 2 s'adressent à quelqu'un qui découvre l'IA ; la fin de l'acte 2 et l'acte 3 à quelqu'un qui lit du code.

- **Sources.** Document : `docs/design/platform-v3-srt.md` au commit `b097071` (sigle `md L<n>`, ligne n), sauf l'outil 1a.0 (acte 3), cité par sa section « §8, 1a.0 » et par le journal §14 et §15 de cette branche (`f14da63`), `platform-v3-srt.html`, `docs/design/journal.md` (sigle `jr L<n>`). **Témoignage** : faits qui viennent de la session de travail du fondateur, pas du document. Ils sont marqués « témoignage, source : le fondateur » partout où ils sont dits ou affichés (sigle `TM`). Le document ne les contient pas ; aucun n'est présenté comme vérifié par lui.
- **Marque et nom provisoire.** La marque est `ai-architect.tools`. `architect-os` est le nom provisoire du dépôt et du code (md L3). Il est dit et affiché **une seule fois**, à l'ouverture de l'acte 1.
- **Structure.** Acte 1, pourquoi on migre ; acte 2, le switch et ce qu'il rapporte ; acte 3, démonstration de l'outil de code isolé, qui clôt la vidéo avec l'invitation.
- **Durée.** Voir le tableau récapitulatif.

## 0. Trois piliers pour ce livrable

| Pilier       | Fait                                                                                                                                                               | Prévu, à une étape nommée                                                                                                                  | Sans objet                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Recherche    | Chaque chiffre du document a sa ligne en annexe A et a été contrôlé contre `git show b097071` ; les faits du fondateur sont isolés en annexe B, marqués témoignage | Relecture du fondateur avant l'enregistrement de la voix (section 6, point 1) ; reprise des chiffres si le banc est rejoué (T-54, md L247) |                                                    |
| SSDLC        | Aucun secret, identifiant, adresse e-mail ni chemin personnel dans ce fichier                                                                                      | Contrôle du journal de session et revue image par image de la prise terminal (section 4.6)                                                 |                                                    |
| Opérationnel | Prise sur un compte macOS dédié, avec leurres (section 4.2)                                                                                                        |                                                                                                                                            | IRB : aucune donnée humaine dans la vidéo (md L23) |

## 1. Règles d'écriture et d'honnêteté

1. Phrases courtes, ton direct, pas de superlatif, pas de triade rhétorique. Une énumération de noms littéraux (`search`, `describe`, `execute`) est affichée, pas déclamée.
2. **Aucun gain de tokens n'est annoncé.** M1 et M2 ne sont pas mesurés : la baseline de 20 tâches n'est pas faite (md L17, L312). Les valeurs 1 500, 600 et 1 000 sont des cibles et ne sont ni dites ni affichées comme résultats.
3. **Trois statuts, affichés à l'écran par une pastille** : « témoignage » (acte 1), « prouvé » (banc), « conçu, à prouver » (documenté mais pas encore joué). Dans l'acte 2, ce qui est « gagné par construction » est documenté ; seule l'isolation sous srt est prouvée par le banc. La mesure du coût et les bornes sont conçues, preuves prévues en 1b (md L68, L70).
4. **La TUI de la brique 1a.0 est « prouvée en pty ; premier lancement réel au propriétaire »** (md §8, 1a.0 ; jr §15, h). Seule la version B (`claude -p`, appel réel par le proxy) est prouvée : elle se tourne. La version A (TUI) seulement après le premier lancement réel, consigné au journal.
5. Les échecs se montrent tels qu'au journal (jr L17-18), sans arrondi.
6. Le banc n'a fait aucun appel réel à l'API : il utilise un faux amont (jr L7). La voix dit « faux serveur d'API ».
7. Les témoignages sont dits à la première personne et ne sont jamais présentés comme des chiffres du document. Aucun écran de quota, de compte ou de liste réelle de plugins n'est montré : cartes graphiques sans identité.
8. Le lien d'invitation et le canal ne sont pas dans les sources : `[À CONFIRMER]`.

## 2. Tableau récapitulatif

| Acte | Contenu                                            | Durée cible | Mots de voix | Voix, 155 mots/min     |
| ---- | -------------------------------------------------- | ----------- | ------------ | ---------------------- |
| 1    | Pourquoi on migre (couverture, témoignage)         | 1:10        | 145          | 0:56                   |
| 2    | Le switch et ce qu'il rapporte                     | 2:00        | 243          | 1:34                   |
| 3    | Démonstration de l'outil de code isolé, invitation | 1:55        | 157          | 1:01                   |
|      | **Total**                                          | **5:05**    | **545**      | **3:31 de voix seule** |

L'acte 3 est volontairement moins parlé : une partie de sa durée est l'image réelle du terminal (frappe, refus, commit) sous une voix rare.

---

## 3. Actes

### Acte 1 : Pourquoi on migre (1:10)

**Voix off**

> Voici ai-architect.tools. Le code s'appelle encore architect-os : c'est un nom provisoire. Je construis en public, et je commence par dire pourquoi j'ai changé de base.
>
> Témoignage. Ma première version, la v1, c'étaient des plugins : Cortex, zetetic, des hooks, des mods. Elle me coûtait plus qu'elle ne rendait. Le 30 octobre 2026, j'ai dépensé 60 % de mon quota du jour pour valider quelques pull requests. Une mémoire que j'avais demandé de supprimer revenait en boucle dans la CI autonome, la vérification automatique du code. Et une porte de CI exigeait qu'une preuve corresponde à un hash d'arbre git, une empreinte. Après le moindre rebase ou merge, c'était impossible. Toute la CI était bloquée.
>
> Le même jour, j'ai retiré la v1 de ma machine : 13 plugins, 9 marketplaces, environ 35 processus. Et j'ai supprimé la porte par hash de main, dans deux dépôts.

**À l'écran**

- 0:00-0:10, carte titre `ai-architect.tools`, « 30 octobre 2026 » (md L3), incrustation « dépôt et code : nom provisoire » pendant la deuxième phrase seulement.
- 0:10-1:10, fond sombre, texte seul, bandeau permanent en haut : **« Témoignage, source : le fondateur »**. Un fait par carte, synchronisé avec la voix : « v1 : plugins Cortex, zetetic, hooks, mods » ; « coûtait plus qu'elle ne rendait » ; « 30 octobre 2026 : 60 % du quota du jour, quelques PR » ; « une mémoire supprimée, réinjectée en boucle dans la CI autonome » ; « porte de CI : preuve = hash d'arbre git, impossible après rebase ou merge, CI entière bloquée » ; puis compteurs animés « 13 plugins », « 9 marketplaces », « ~35 processus » qui retombent à zéro ; enfin « porte par hash supprimée de main, 2 dépôts ».

**Note de réalisation**

Les faits de cet acte viennent de la session de travail, pas du document (annexe B). Le document corrobore seulement le principe actuel : « aucun hash, aucun digest » (md L251) et le retrait de `fixpoint.sh` (md L80). Ne rien montrer d'un compte, d'un quota réel, d'une liste de plugins réelle ou d'un terminal de la machine de la v1 : uniquement des cartes graphiques. Le fondateur dit « je » lui-même si possible ; sinon voix off sur une prise de parole écrite par lui. `architect-os` ne réapparaît plus après cette phrase.

---

### Acte 2 : Le switch et ce qu'il rapporte (2:00)

**Voix off**

> Qu'apporte la nouvelle base ? D'abord ce qui est gagné par construction. C'est documenté, et l'écran dit ce qui est prouvé et ce qui reste à prouver.
>
> L'idée : le modèle exprime une intention, du code l'exécute. Le client ne voit que trois outils : search, describe, execute. Quatre éléments tournent sur la machine ; tout le reste tourne sous une sandbox, srt. Plus aucun hash dans la CI : seul le résultat des tests fait foi, et la mutation ne laisse aucun survivant sur les lignes changées. Le coût est mesuré à chaque réponse, plutôt que prédit. Des bornes coupent une boucle. L'isolation sous srt, elle, est prouvée par un banc sur Linux et macOS : 106 tests. Sur macOS, 94 passent et 1 échoue. Sur Linux, 92 passent et 5 échouent, face à un faux serveur d'API. Les échecs sont conservés.
>
> Un tiers, Michael Rollins, décrit dans un reel du 28 octobre un cas voisin : douze allers-retours et environ 190 000 tokens, contre un aller-retour et environ 17 000. Ce sont ses chiffres, je ne les ai pas vérifiés.
>
> La conception est passée de 1 627 lignes à 366. On reste en TypeScript, avec npm et des fichiers descriptifs, au plus près d'Anthropic. Et treize risques sont nommés, plutôt que des mécanismes pour tous les couvrir.
>
> Ensuite, ce qui reste à mesurer : le gain de tokens. La baseline de 20 tâches n'est pas faite. Je ne promets aucun chiffre.

**À l'écran**

- 0:00-0:10, titre « Gagné par construction » (colonne gauche) et « Reste à mesurer » (colonne droite, vide). Deux pastilles de légende : « prouvé (banc) », « conçu, à prouver ».
- 0:10-0:30, idée : schéma avant/après (tout passe par le contexte / script entre le modèle et les outils), trois cartes `search`, `describe`, `execute` (md L15). Pastille « conçu ».
- 0:30-0:45, topologie condensée : figure 1 du HTML révélée en deux temps, quatre natifs (gateway, broker, data, Postgres 17) puis le cadre « sous srt » (md L31, L50). Pastille « conçu » sauf l'isolation.
- 0:45-1:00, porte de CI condensée : « aucun hash » barré, « tests » validé, formule `exécutés = base + ajoutés − supprimés` (md L253), « 0 survivant » (md L261). Pastille « conçu, à prouver » (1a).
- 1:00-1:10, coût et bornes : champs d'un enregistrement d'usage sans valeur (md L68), jauges « délai », « nombre d'appels » qui coupent (md L70). Pastille « conçu, à prouver » (1b).
- 1:10-1:30, banc : lignes du run 41044838678, macOS 106 tests / 94 pass / 1 fail ; Linux 106 / 92 / 5 (jr L17-18) ; échecs nommés (jr L24-25) ; bandeau « aucun appel réel à l'API au banc » (jr L7). Pastille « prouvé ».
- 1:30-1:38, « 1 627 lignes » (conception d'origine, commit `0dd97c5`) qui se réduit à « 366 lignes » (md, `b097071`) ; puis « TypeScript, npm, fichiers descriptifs » ; puis « 13 risques nommés ».
- 1:38-1:50, corroboration externe, carte avec pastille « externe, chiffres de l'auteur, non vérifiés » : « Michael Rollins (@rollins.io), reel du 28 octobre 2026, légende : 12 allers-retours et environ 190 k tokens contre 1 aller-retour et environ 17 k ». Aucune capture du reel ; ces chiffres ne sont pas ceux du projet.
- 1:50-2:00, colonne de droite : « gain de tokens M1, M2 » avec la pastille « baseline de 20 tâches : non faite ». Aucune valeur.

**Note de réalisation**

L'idée, la topologie et la porte de CI sont condensées ici, pas en séquences séparées. Sources de chaque affirmation : annexe A. Ne pas dire « le coût est maîtrisé » ni « les boucles sont impossibles » : c'est conçu, preuve prévue en 1b (md L70). Ne pas afficher les cibles de tokens (1 500, 600, 1 000) : ce sont des cibles, pas des résultats. « Au plus près d'Anthropic » renvoie au choix de l'Agent SDK par directive de suivre l'amont (jr L215) ; ne pas le généraliser.

---

### Acte 3 : Démonstration de l'outil de code isolé (1:55)

C'est la brique 1a.0 (md §8, 1a.0 ; jr §14 et §15). Tout le reste de la plateforme se construit dedans. L'acte clôt la vidéo avec l'invitation.

**Voix off, version A (TUI, après son premier lancement réel)**

> Voici l'outil de code isolé, la première brique. Une commande, depuis un worktree : elle lance un proxy sur ma machine, puis Claude Code, avec son interface complète, dans une sandbox.
>
> Aucun secret n'entre dans la sandbox. Je lui demande l'environnement : il ne contient qu'un jeton de session. Je lui demande de lire le trousseau : refusé. De joindre l'API directement : refusé. Ces refus viennent de la sandbox, pas du modèle. Puis je lui demande un commit : il passe, parce que le profil laisse écrire ce dont git a besoin.
>
> Un risque reste, écrit : le jeton de session est lisible pendant la session. Il ne donne que des appels au modèle, par le proxy, et il est révoqué à la fin.
>
> Je construis ai-architect.tools en public, et le journal garde les échecs. La date de la baseline et le nom définitif restent ouverts. Pour relire le design ou contester un risque accepté, rejoignez-moi.

**Voix off, version B (seule prouvée : `claude -p`, appel réel par le proxy)**

> Voici l'outil de code isolé, la première brique. Une commande, depuis un worktree : elle lance un proxy sur ma machine, puis Claude Code dans une sandbox. Aujourd'hui, la démonstration est en mode non interactif, avec un appel réel par le proxy. L'interface complète n'a pas encore eu son premier lancement réel.
>
> Aucun secret n'entre dans la sandbox. Je lui demande l'environnement : il ne contient qu'un jeton de session. Je lui demande de lire le trousseau : refusé. De joindre l'API directement : refusé. Puis je lui demande un commit : il passe.
>
> Un risque reste, écrit : le jeton de session est lisible pendant la session. Il ne donne que des appels au modèle, par le proxy, et il est révoqué à la fin.
>
> Je construis ai-architect.tools en public, et le journal garde les échecs. La date de la baseline et le nom définitif restent ouverts. Pour relire le design ou contester un risque accepté, rejoignez-moi.

**À l'écran**

- 0:00-0:08, figure 3 du HTML (section « 3. Outil de code, brique 1a.0 ») : colonnes « Écriture autorisée », « Écriture refusée », « Lecture refusée » (trousseau barré), proxy de l'hôte et « Allowlist réseau » (md §8, 1a.0), en fondu vers le terminal.
- 0:08-1:30, **terminal réel** (section 4) : commande, démarrage, trois refus, commit.
- 1:30-1:40, plan fixe de la commande avec le bandeau « R-1 : le jeton de session est lisible pendant la session ; appels au modèle seulement, révoqué à la fin » (md §4.2, R-1).
- 1:40-1:55, carte de fin : `ai-architect.tools`, **`[À CONFIRMER : lien du dépôt / canal d'échange]`**, ouvertes : « date de la baseline », « nom définitif » (md L366) ; mention « dépôt public » seulement si confirmée au tournage (jr L72).

**Note de réalisation**

Sources : md §8, 1a.0 ; jr §15 (b, e, h). Pastille : « TUI prouvée en pty ; premier lancement réel au propriétaire ». Les trois démonstrations (`env`, trousseau, API directe) et le commit sont prouvés au journal §15 ; la prise les refait en réel. Version A seulement après le premier lancement réel de la TUI, consigné au journal (effet du 429 au démarrage). En version B, on ne montre que ce qui est exécuté en `-p` dans la prise. Détail de la prise : section 4.

---

## 4. Acte 3 : la version terminal réelle

### 4.1 But et état de preuve

Montrer la commande `npm --prefix <lanceur> run code`, lancée dans un worktree, puis trois démonstrations réelles et un commit qui passe : `env` dans la sandbox ne montre qu'un jeton de session ; `security find-generic-password` est refusé ; `api.anthropic.com` direct est refusé ; le commit passe. État de la source : appel réel par le proxy en `-p`, 8 tours, refus et commit prouvés (jr §15, b, e ; jr §14), TUI prouvée en pty seulement.

| Version | Quand                                                | Ce que l'on montre                                                                                          |
| ------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **A**   | Premier lancement réel de la TUI consigné au journal | TUI complète, trois démonstrations réelles, un commit réel                                                  |
| **B**   | État actuel, seule prouvée                           | `claude -p`, appel réel par le proxy ; les trois démonstrations et le commit exécutés en `-p` dans la prise |

### 4.2 Prérequis de tournage

1. **Compte macOS dédié** à l'enregistrement, avec un répertoire personnel propre. La connexion à Claude se fait **hors caméra**, avant l'enregistrement : le proxy lit l'identifiant dans le trousseau de ce compte (md §8, 1a.0).
2. **Dépôt de démonstration jetable**, pas le dépôt réel, avec un worktree dans `<repo>/.claude/worktrees/demo`. Nom du dépôt neutre ; `architect-os` ne doit pas apparaître.
3. **Leurre** : un service de trousseau inexistant, `demo-leurre`, que la commande demande ; jamais un nom d'élément réel. Pas de fichier `~/.ssh` dans ce compte.
4. **Lanceur et profil** : le checkout du lanceur est hors du worktree visé (sinon `ISOLATION_UNAVAILABLE`) ; le profil est `packages/sandbox/profiles/builder.json`, non modifié. Il ne s'affiche pas : seule la figure 3 le résume.
5. Refus réseau : `api.anthropic.com` joint directement (`curl`), attendu 403 du proxy srt. Aucun autre domaine nécessaire.
6. Terminal : police 20 points ou plus, 1280×720, invite courte (par exemple `demo %1~ %#`), aucune autre fenêtre, notifications système désactivées.
7. Journal de session texte enregistré en parallèle (`script` ou équivalent) pour le contrôle 4.6.

### 4.3 Déroulé minuté (1:22 de terminal, 0:08 à 1:30 de l'acte)

| Temps (dans l'acte) | Image                                                       | Action                                                                                            | Voix                                                                                                                                       |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:08-0:18           | Terminal, invite dans le worktree `demo`                    | Frappe de `npm --prefix <lanceur> run code` (accélérée 2×), Entrée. Incrustation « une commande » | « Une commande : elle lance un proxy, puis Claude Code dans une sandbox. »                                                                 |
| 0:18-0:30           | A : la TUI s'ouvre. B : `-p` avec une question simple       | Laisser le démarrage réel                                                                         | A : « Claude Code tourne dans une sandbox, dans son worktree. » B : « …en mode non interactif… »                                           |
| 0:30-0:45           | Panneau de la figure 3 en incrustation, ce qui est autorisé |                                                                                                   | « Il peut écrire dans ce dossier et joindre… »                                                                                             |
| 0:45-0:58           | Démonstration 1                                             | Demander `env                                                                                     | sed 's/=.*/=<masqué>/'`: seuls les noms`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR` apparaissent, valeurs masquées | « Il ne contient qu'un jeton de session. » |
| 0:58-1:08           | Démonstration 2                                             | Demander `security find-generic-password -s demo-leurre`. Laisser le message de refus réel        | « Le trousseau : refusé. »                                                                                                                 |
| 1:08-1:18           | Démonstration 3                                             | Demander `curl https://api.anthropic.com`. Erreur réelle (403)                                    | « L'API en direct : refusé. »                                                                                                              |
| 1:18-1:30           | Commit                                                      | Demander de créer un fichier et de le committer ; afficher `git log -1 --oneline`                 | « Puis je lui demande un commit : il passe. »                                                                                              |

Ne pas inventer le texte des erreurs : la prise réelle fait foi. Si une erreur contient un chemin personnel, flouter. Si un refus n'est pas obtenu, ne pas le monter : repasser en version B pour ce refus.

### 4.4 Ce qui doit être visible

- La commande `npm --prefix <lanceur> run code` en entier, tapée et lancée.
- L'invite courte avec le dossier du worktree (nom neutre).
- Un démarrage réel, sans coupe cachée.
- Chaque démonstration avec sa sortie réelle, puis le commit réel avec son identifiant court.
- Le bandeau « R-1 : le jeton de session est lisible pendant la session ; appels au modèle seulement, révoqué à la fin » (2 s minimum) : on montre la limite.

### 4.5 Ce qui ne doit jamais être visible

Aucun identifiant, sous aucune forme.

- Adresse e-mail, nom, organisation ou plan du compte Claude. Le bandeau de démarrage de la TUI **peut** les afficher : regarder la première image ; flouter ou recadrer si présent. Ne jamais ouvrir un écran de statut, de connexion ou de configuration du compte.
- Clé API, jeton (Claude, GitHub, npm), contenu des fichiers de configuration du compte, du trousseau, des identifiants npm, réseau, GitHub, cloud ou GPG.
- Aucun fichier du dossier SSH n'est utilisé dans cette prise. Ne jamais lister ce dossier avec un vrai compte.
- Le résultat brut de `env` ou `printenv` : seule la sortie filtrée, valeurs masquées, de la démonstration 1. Jamais la valeur du jeton de session, même révoqué à la fin. Le résultat de commandes de lecture du trousseau : seul le message de refus du leurre. L'état d'authentification GitHub : jamais.
- Un chemin contenant le nom d'utilisateur réel : utiliser le compte dédié et un nom court.
- Le nom du dépôt réel ou `architect-os`, dans un chemin, une invite ou un titre de fenêtre.
- Toute fenêtre de mot de passe ou d'autorisation système. Si elle apparaît, couper et rejouer ; ne jamais saisir de mot de passe à l'écran.
- Notifications, aperçus de messagerie, onglets de navigateur, historique du shell (flèche haut), autres fenêtres.
- Un écran de quota ou de consommation du compte (acte 1) : le chiffre de 60 % est dit et affiché en carte graphique seulement.
- Une TUI présentée comme prouvée en version B, ou avant son premier lancement réel.

### 4.6 Contrôle avant publication

1. Sur le journal de session texte, rechercher avec `grep -E` les formes génériques suivantes, sans valeurs réelles : préfixes de clés et de jetons connus, adresses e-mail, chemins du répertoire utilisateur. Résultat attendu : vide, ou limité au compte dédié (à flouter).
2. Revue image par image de l'export de l'acte 3, à 2 images par seconde, sur une planche contact : bandeau de démarrage, titre de fenêtre, premières lignes de la TUI, chaque message d'erreur.
3. Vérifier que le bandeau « R-1 » est lisible 2 secondes.
4. Une seconde personne regarde l'acte 3 sans le son et signale tout texte de compte.

---

## 5. Plans à tourner ou à générer

| ID   | Acte | Type                | Contenu                                                                                                                   | Source                | Durée | Statut                         |
| ---- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----- | ------------------------------ |
| P-01 | 1    | Généré              | Carte titre `ai-architect.tools`, « 30 octobre 2026 », incrustation « nom provisoire » (une seule fois)                   | md L3                 | 0:10  | à produire                     |
| P-02 | 1    | Généré              | Bandeau « Témoignage, source : le fondateur » + cartes texte, un fait par carte                                           | annexe B              | 0:50  | à produire                     |
| P-03 | 1    | Généré              | Compteurs 13 plugins, 9 marketplaces, ~35 processus qui retombent à zéro                                                  | annexe B              | 0:08  | à produire                     |
| P-04 | 2    | Généré              | Deux colonnes « Gagné par construction » / « Reste à mesurer », pastilles de statut                                       | ce fichier            | 0:10  | à produire                     |
| P-05 | 2    | Généré              | Schéma avant/après et trois cartes `search`, `describe`, `execute`                                                        | md L15                | 0:20  | à produire                     |
| P-06 | 2    | Capture + animation | Figure 1 du HTML en deux temps                                                                                            | html, section 1       | 0:15  | existant à animer              |
| P-07 | 2    | Généré              | Porte de CI condensée : aucun hash, tests, formule, 0 survivant                                                           | md L253, L261         | 0:15  | à produire                     |
| P-08 | 2    | Généré              | Champs d'usage sans valeur, jauges de bornes                                                                              | md L68, L70           | 0:10  | à produire                     |
| P-09 | 2    | Texte               | Tableau du banc (run 41044838678), échecs nommés, « faux amont »                                                          | jr L7, L17-18, L24-25 | 0:20  | à produire                     |
| P-10 | 2    | Généré              | « 1 627 » → « 366 lignes » ; « 13 risques nommés »                                                                        | annexe A              | 0:08  | à produire                     |
| P-11 | 2    | Généré              | Colonne « gain de tokens », « baseline de 20 tâches : non faite »                                                         | md L312               | 0:07  | à produire                     |
| P-12 | 3    | Capture + fondu     | Figure 3 du HTML                                                                                                          | html, section 3       | 0:08  | existant à animer              |
| P-13 | 3    | **Terminal réel**   | Prise B (`-p`) ; A (TUI) après son premier lancement réel : commande, démarrage, trois démonstrations, commit (section 4) | md §8, 1a.0 ; jr §15  | 1:22  | à tourner, B seule prouvée     |
| P-14 | 3    | Généré              | Bandeau « R-1 : le jeton de session est lisible pendant la session, appels au modèle seulement »                          | md §4.2, R-1          | 0:10  | à produire                     |
| P-15 | 3    | Généré              | Carte de fin avec `[À CONFIRMER : lien / canal]`, ouvertes : baseline, nom définitif                                      | md L366               | 0:15  | à produire, après confirmation |
| P-16 | tout | Voix                | Enregistrement de la voix off                                                                                             | ce fichier            | 3:22  | à enregistrer après relecture  |
| P-17 | tout | Sous-titres         | Sous-titres français incrustés                                                                                            | ce fichier            |       | à produire                     |

Charte : orange pour « sous srt », noir pour « natif », comme dans les figures du HTML ; pastilles de statut (témoignage, prouvé, conçu à prouver) identiques sur tout le film ; aucun logo tiers.

## 6. Points à confirmer avant tournage

1. Relecture du fondateur de chaque fait de l'annexe B et de chaque chiffre de l'annexe A.
2. Version de l'acte 3 : B seule est prouvée ; A après le premier lancement réel de la TUI par le propriétaire.
3. Lien et canal d'invitation.
4. « Dépôt public » : à reconfirmer à la date de tournage (jr L72).
5. Date de la baseline et nom définitif : restent ouverts (md L366).

---

## Annexe A. Chiffres du document et lignes sources

Convention : `md` = `docs/design/platform-v3-srt.md` (commit `b097071`), `jr` = `docs/design/journal.md`.

| ID  | Chiffre ou fait                                                                                               | Acte         | Source                                                                                  | Extrait                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C01 | 3 méta-tools                                                                                                  | 2            | md L15                                                                                  | « Le client voit trois méta-tools »                                        |
| C02 | 4 natifs                                                                                                      | 2            | md L31 ; md L50                                                                         | « quatre exceptions prouvées » ; « Pourquoi quatre natifs »                |
| C03 | Postgres 17                                                                                                   | 2            | md L37                                                                                  | « postgres 17 »                                                            |
| C04 | noyau partagé, préversion                                                                                     | 2 (option)   | md L108                                                                                 | « noyau partagé, préversion annoncée »                                     |
| C05 | aucun hash, aucun digest ; tests seuls font foi                                                               | 2            | md L251                                                                                 | « aucun hash, aucun digest »                                               |
| C06 | formule du compte                                                                                             | 2            | md L253                                                                                 | « `exécutés = base + ajoutés − supprimés` »                                |
| C07 | 0 survivant sur les lignes modifiées                                                                          | 2            | md L261                                                                                 | « 0 survivant sur les lignes modifiées du diff »                           |
| C08 | coût mesuré par réponse, aucun plafond financier (conçu)                                                      | 2            | md L68, L359                                                                            | « Aucun plafond financier »                                                |
| C09 | bornes qui coupent une boucle (conçu)                                                                         | 2            | md L70, L360                                                                            | « aucune boucle ne tourne indéfiniment »                                   |
| C10 | 106 tests, run 41044838678                                                                                    | 2            | md L21 ; jr L17-18                                                                      | « 106 tests »                                                              |
| C11 | macOS : 94 pass, 1 fail                                                                                       | 2            | jr L17                                                                                  | `\| 41044838678 \| \`70a146f\` \| macOS \| 106 \| 94 \| 1 \| 5 \| 6 \|`    |
| C12 | Linux : 92 pass, 5 fail                                                                                       | 2            | jr L18                                                                                  | `\| 41044838678 \| \`70a146f\` \| Linux \| 106 \| 92 \| 5 \| 3 \| 6 \|`    |
| C13 | échecs nommés macOS, Linux                                                                                    | 2            | jr L24-25                                                                               | `E-03-huge` ; `T-02e, T-02e2, T-07-fd0, T-34h, T-34i`                      |
| C14 | aucun appel réel à l'API au banc                                                                              | 2            | jr L7                                                                                   | « Aucun appel réel à l'API Anthropic au banc : faux amont local »          |
| C15 | conception de 1 627 lignes                                                                                    | 2            | `git show 0dd97c5:docs/design/platform-v3-srt.md` (1 627 lignes) ; md L3 cite `0dd97c5` | « l'ancien texte complet reste dans git à `0dd97c5` »                      |
| C16 | conception de 366 lignes                                                                                      | 2            | md (366 lignes) ; jr L308                                                               | « le document reste à 366 lignes »                                         |
| C17 | 13 risques acceptés (R-1 à R-13)                                                                              | 2            | md L144 (R-1), L156 (R-13)                                                              | `\| R-1 \|` … `\| R-13 \|`                                                 |
| C18 | baseline de 20 tâches, non faite                                                                              | 2            | md L17, L312                                                                            | « 20 tâches, M1, M2 » ; baseline attend la date du propriétaire            |
| C19 | TypeScript, npm, fichiers descriptifs                                                                         | 2            | md L72, L160, L220                                                                      | Marketplace/`.mcp.json`/`agents/*.md` ; `npm ci` ; « Fichier descriptif »  |
| C20 | suivre l'amont (Agent SDK)                                                                                    | 2            | jr L215                                                                                 | « par directive de suivre l'amont »                                        |
| C21 | commande de la brique de base                                                                                 | 3            | md §8, 1a.0 ; jr §15                                                                    | « `npm --prefix <lanceur> run code -- <arguments de claude>` »             |
| C22 | TUI prouvée en pty ; premier lancement réel au propriétaire ; `-p` par le proxy : 8 tours                     | 3            | jr §15 (e, h)                                                                           | « Premier lancement réel de la TUI non fait » ; `success`, 8 tours         |
| C23 | aucun secret dans la sandbox : trousseau, `~/.claude`, `~/.claude.json` en `denyRead` ; réseau : proxy et npm | 3            | md §8, 1a.0 ; jr §15 (b)                                                                | lignes `denyRead`, Réseau ; trousseau introuvable                          |
| C24 | démonstrations : `env` (jeton de session seul), trousseau refusé, API directe 403, commit réussi              | 3            | jr §15 (b, e), jr §14                                                                   | « seulement le jeton de session… » ; `CONNECT tunnel failed, response 403` |
| C25 | R-1 : jeton de session lisible, appels au modèle seulement, révoqué à la fin                                  | 3            | md §4.2, R-1                                                                            | « ne donne que des appels au modèle via le proxy »                         |
| C26 | leurre : service de trousseau inexistant, `api.anthropic.com` direct                                          | 3 (tournage) | jr §15 (e)                                                                              | « refusé par srt »                                                         |
| C27 | ouvertes : baseline, nom définitif                                                                            | 3            | md L366                                                                                 | « Ouvertes : la date de la baseline (D-7) et le nom définitif »            |
| C28 | journal en ajout seulement                                                                                    | 3 (option)   | jr L3                                                                                   | « Ajout seulement »                                                        |
| C29 | dépôt public (à reconfirmer)                                                                                  | 3            | jr L72                                                                                  | « Public, 0 ruleset, `main` non protégée »                                 |
| C30 | date 30 octobre 2026                                                                                          | 1            | md L3                                                                                   | « Conception, 30 octobre 2026 »                                            |
| C31 | commit de référence                                                                                           | en-tête      | `git log -1`                                                                            | `b097071`                                                                  |

### Contrôle des chiffres

C21 à C26 (acte 3) citent la branche (md §8 et §4.2, jr §14 et §15, `f14da63`), non `b097071` ; les autres lignes `md L` visent `b097071`. 53 extraits vérifiés à la ligne exacte contre `git show b097071` (script Python : extrait attendu présent à la ligne citée), 0 écart ; 1 627 lignes obtenues par `git show 0dd97c5:docs/design/platform-v3-srt.md | wc -l`, 366 par `git show b097071:docs/design/platform-v3-srt.md | wc -l`.

## Annexe B. Témoignages (source : le fondateur)

Ces faits viennent de la session de travail du fondateur. Ils ne sont **pas** dans le document ; ils sont dits à la première personne et marqués « témoignage » à l'écran. Aucun n'est vérifiable dans `b097071`.

| ID  | Fait                                                                                                                                             | Acte | Source                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------- |
| TM1 | La v1 (plugins ai-architect.tools : Cortex, zetetic, hooks, mods) coûtait plus qu'elle ne rendait                                                | 1    | témoignage, source : le fondateur |
| TM2 | Le 30 octobre 2026, 60 % du quota du jour dépensé pour valider quelques PR                                                                       | 1    | témoignage, source : le fondateur |
| TM3 | Une mémoire dont la suppression avait été demandée était réinjectée en boucle dans la CI autonome                                                | 1    | témoignage, source : le fondateur |
| TM4 | Une porte de CI exigeait qu'une preuve corresponde à un hash d'arbre git ; condition impossible après tout rebase ou merge ; toute la CI bloquée | 1    | témoignage, source : le fondateur |
| TM5 | Le même jour, la v1 retirée de la machine : 13 plugins, 9 marketplaces, environ 35 processus                                                     | 1    | témoignage, source : le fondateur |
| TM6 | Le même jour, la porte par hash supprimée de `main` dans deux dépôts                                                                             | 1    | témoignage, source : le fondateur |

Corroboration externe, acte 2 : reel de Michael Rollins (@rollins.io), 28 octobre 2026, légende : 12 allers-retours et environ 190 k tokens contre 1 aller-retour et environ 17 k. Chiffres de l'auteur, non vérifiés, attribués à lui ; ils ne sont pas ceux du projet et ne remplacent pas la baseline.

Corroboration partielle par le document, sans reprendre les faits : l'absence de hash dans la porte actuelle (md L251) et le retrait de `fixpoint.sh` (md L80, jr L244).
