# Espace membre

Les membres se connectent sur **`/espace`** de ton domaine — avec Discord, ou **sans compte Discord** par un lien reçu par e-mail — et retrouvent tous leurs tickets, ouverts et fermés, sur chacun de tes serveurs — y compris ceux où ils ont été ajoutés comme participants.

L'espace existe en **six langues** — français, anglais, espagnol, allemand, italien, portugais : celle du navigateur (anglais pour une autre langue), modifiable en bas de page. Les messages d'erreur et l'échange téléchargé suivent la même langue.

- **Suivre** : statut formulé pour eux (« en attente de ta réponse », « pris en charge »…), conversation avec le staff, note donnée, téléchargement de l'échange.
- **Répondre** depuis le web, exactement comme en MP (mêmes limites, même salon côté staff).
- **Ouvrir un ticket** : serveur, sujet, champs et formulaire du sujet, avec les entrées de FAQ qui ressemblent à la demande proposées pendant la saisie.
- **Aide** : la FAQ de chaque serveur, cherchable.
- **Lien direct** : bouton « Voir sur le web » sous chaque MP lié à un ticket.

## Sans Discord : connexion par lien e-mail

Dès que l'**e-mail de l'instance** est configuré (Instance → E-mail), la page de connexion propose « Recevoir un lien de connexion » : la personne saisit son adresse et reçoit un lien **valable 15 minutes, à usage unique**. Pas de mot de passe, pas de compte à créer.

- **Où elle peut ouvrir un ticket** : dans les espaces **ouverts à tous par e-mail** (Paramètres → Fonctionnalités → Espace membre web → « Ouvert à tous par e-mail »). Un espace créé sans Discord l'est d'office ; un serveur Discord ne l'est pas tant qu'un fondateur ne l'a pas coché.
- **Les réponses du staff** lui arrivent par l'e-mail de l'instance, avec un lien vers la conversation ; elle répond depuis la page (les réponses à l'e-mail ne sont pas lues).
- **Ses tickets envoyés par e-mail** à la boîte de support, depuis la même adresse, apparaissent aussi : le lien prouve qu'elle lit cette boîte.
- Côté staff, elle a une **fiche contact** avec une identité « Web » et son adresse ; on peut la fusionner avec son compte Discord (voir [Contacts](./tickets#les-contacts)).

Limites anti-abus : 3 liens par adresse par quart d'heure (au-delà, la réponse est la même mais rien n'est envoyé), les tentatives limitées par adresse IP, 3 ouvertures par minute et par personne, la limite quotidienne du serveur, 60 nouveaux tickets par heure et par espace depuis des connexions e-mail, et la liste noire (sous n'importe laquelle de ses identités).

## Ce qui est montré, et ce qui ne l'est jamais

Uniquement ce que le membre a reçu ou envoyé en MP. **Jamais** les notes internes, les messages tapés par le staff dans le salon Discord, ni le nom derrière une réponse anonyme.

La connexion Discord ne demande que l'identité (scope `identify`) ; la connexion par e-mail ne garde que l'empreinte du lien, jamais le lien lui-même. Aucune des deux ne donne accès au dashboard. Chaque requête vérifie que le membre est bien propriétaire ou participant du ticket, et toujours membre du serveur (ou, connecté par e-mail, que l'espace est ouvert à tous).

## Aux couleurs du serveur

**Paramètres → Fonctionnalités → Espace membre web** : l'activer ou le désactiver pour ce serveur (activé par défaut), et choisir son logo, sa couleur d'accent (le texte passe en noir ou en blanc selon le contraste) et son message d'accueil.
