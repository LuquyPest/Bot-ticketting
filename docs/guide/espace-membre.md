# Espace membre

Les membres se connectent sur **`/espace`** de ton domaine — avec Discord, ou **sans compte Discord** par un lien reçu par e-mail — et retrouvent tous leurs tickets, ouverts et fermés, sur chacun de tes serveurs — y compris ceux où ils ont été ajoutés comme participants.

L'espace existe en **six langues** — français, anglais, espagnol, allemand, italien, portugais : celle du navigateur (anglais pour une autre langue), modifiable en bas de page. Les messages d'erreur et l'échange téléchargé suivent la même langue.

- **Suivre** : statut formulé pour eux (« en attente de ta réponse », « pris en charge »…), conversation avec le staff, note donnée, téléchargement de l'échange.
- **Répondre** depuis le web, exactement comme en MP (mêmes limites, même salon côté staff).
- **Fichiers** : en ouvrant un ticket ou en répondant, le membre joint jusqu'à 5 fichiers, avec les mêmes règles que les [pièces jointes des e-mails](./integrations#tickets-par-e-mail) (taille, espace total, types refusés, conservation, copie dans le salon Discord). Les fichiers du ticket se retéléchargent depuis sa page.
- **Ouvrir un ticket** : serveur, sujet, champs et formulaire du sujet, avec les entrées de FAQ qui ressemblent à la demande proposées pendant la saisie.
- **Aide** : la FAQ de chaque serveur, cherchable, avec un lien vers sa [base de connaissances publique](#base-de-connaissances-publique) si elle est en ligne.
- **Lien direct** : bouton « Voir sur le web » sous chaque MP lié à un ticket.

## Base de connaissances publique

La FAQ du serveur (menu **FAQ**) est faite d'**articles** : une question, une réponse (jusqu'à 5 000 caractères), des mots-clés pour la FAQ automatique en MP, une **catégorie** facultative (« Compte », « Commandes »…) et une **visibilité** :

| Visible par | Où l'article apparaît |
|---|---|
| **Les membres connectés** (par défaut) | Onglet **Aide** de l'espace membre, suggestions pendant l'ouverture d'un ticket, FAQ automatique en MP |
| **Tout le monde** | En plus : la page publique **`/aide/<serveur>`**, lisible **sans connexion**, et les suggestions du [widget web](./integrations#widget-web) |

La page publique est **hors ligne** tant qu'un **fondateur** ne la met pas en ligne (**FAQ → Base de connaissances publique**). En ligne, elle liste les articles « Tout le monde » actifs, rangés par catégorie et cherchables, chacun avec sa propre adresse à partager ; l'onglet **Aide** de l'espace membre y renvoie, et les réponses proposées en MP ajoutent un lien « Lire l'article ». Chaque article compte ses lectures (une par visiteur et par heure).

Les entrées de FAQ d'avant la v4.2 sont reprises telles quelles, réservées aux membres connectés : rien ne devient public sans qu'on le choisisse. Un article désactivé, ou repassé « membres connectés », disparaît aussitôt de la page publique. Celle-ci ne montre ni les mots-clés, ni l'auteur, ni les compteurs ; un serveur inconnu ou dont la page est hors ligne donne la même réponse « introuvable ». Les articles et leur visibilité font partie de l'[export de configuration](./integrations#sauvegarde-de-la-configuration).

## Sans Discord : connexion par lien e-mail

Dès que l'**e-mail de l'instance** est configuré (Instance → Santé), la page de connexion propose « Recevoir un lien de connexion » : la personne saisit son adresse et reçoit un lien **valable 15 minutes, à usage unique**. Pas de mot de passe, pas de compte à créer.

- **Où elle peut ouvrir un ticket** : dans les espaces **ouverts à tous par e-mail** (Paramètres → Fonctionnalités → Espace membre web → « Ouvert à tous par e-mail »). Un espace créé sans Discord l'est d'office ; un serveur Discord ne l'est pas tant qu'un fondateur ne l'a pas coché.
- **Les réponses du staff** lui arrivent par l'e-mail de l'instance, avec un lien vers la conversation ; elle répond depuis la page (les réponses à l'e-mail ne sont pas lues).
- **Ses tickets envoyés par e-mail** à la boîte de support, depuis la même adresse, apparaissent aussi : le lien prouve qu'elle lit cette boîte.
- Côté staff, elle a une **fiche contact** avec une identité « Web » et son adresse ; on peut la fusionner avec son compte Discord (voir [Contacts](./tickets#les-contacts)).

Limites anti-abus : 3 liens par adresse par quart d'heure (au-delà, la réponse est la même mais rien n'est envoyé), les tentatives limitées par adresse IP, 3 ouvertures par minute et par personne, la limite quotidienne du serveur, 60 nouveaux tickets par heure et par espace depuis des connexions e-mail, et la liste noire (sous n'importe laquelle de ses identités).

## Le catalogue de services

**Paramètres → Catalogue** (fondateurs et permission **Paramètres**) : ce que les demandeurs peuvent demander, rangé par catégorie (« Matériel », « Accès »…), chaque **service** avec son icône et sa description. Dans l'espace membre, **Nouveau ticket** commence par ce catalogue ; **Autre demande** garde le formulaire libre d'avant.

| | |
|---|---|
| **Formulaire** | Jusqu'à 20 champs : texte court ou long, nombre, liste, case à cocher, date ; obligatoires ou non. Un champ peut ne s'**afficher que si** un champ placé avant a une valeur (« si *Matériel* = *Portable*, demander le modèle ») : caché, il n'est ni demandé ni gardé |
| **Le ticket devient** | Un sujet (sinon le nom du service), un type, une priorité, une équipe : appliqués à l'ouverture, avant que le staff ne le voie |

Les réponses arrivent dans le premier message du ticket, sous le nom du service. Le serveur vérifie chaque réponse (champ obligatoire, liste, date, nombre) ; un service retiré du catalogue ne s'ouvre plus. Les **formulaires d'ouverture** d'avant ont été repris comme services ; ils restent utilisés sur Discord.

## Les tickets de son organisation

Une [organisation](./tickets#les-organisations) choisit qui, parmi ses contacts, voit **ses tickets** dans l'espace membre : **personne** (par défaut : chacun ne voit que les siens), **ses responsables** (les contacts cochés « Responsable côté client » sur leur fiche, par un fondateur ou la permission **Paramètres**), ou **tous ses membres**. Une organisation parente montre aussi les tickets de ses sous-organisations.

Ces tickets apparaissent sous **Tickets de mon organisation**, avec le nom de la personne qui les a ouverts. Ils se lisent sans s'écrire : pas de réponse, pas de confirmation de solution, pas de fichiers ni de transcript ; seule la personne qui a ouvert le ticket y répond. Un ticket **confidentiel** ou réservé à un grade n'y apparaît jamais.

## Ce qui est montré, et ce qui ne l'est jamais

Uniquement ce que le membre a reçu ou envoyé en MP. **Jamais** les notes internes, les messages tapés par le staff dans le salon Discord, ni le nom derrière une réponse anonyme.

La connexion Discord ne demande que l'identité (scope `identify`) ; la connexion par e-mail ne garde que l'empreinte du lien, jamais le lien lui-même. Aucune des deux ne donne accès au dashboard. Chaque requête vérifie que le membre est bien propriétaire ou participant du ticket, et toujours membre du serveur (ou, connecté par e-mail, que l'espace est ouvert à tous).

## Aux couleurs du serveur

**Paramètres → Fonctionnalités → Espace membre web** : l'activer ou le désactiver pour ce serveur (activé par défaut), et choisir son logo, sa couleur d'accent (le texte passe en noir ou en blanc selon le contraste) et son message d'accueil.
