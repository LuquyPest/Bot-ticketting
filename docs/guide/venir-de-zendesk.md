# Venir de Zendesk ou Freshdesk

Ce guide reprend les tickets, contacts, organisations et articles d'un Zendesk ou d'un Freshdesk dans un espace Datick. L'outil d'origine n'est pas modifié.

## Ce qui est repris

| Zendesk / Freshdesk | Datick |
|---|---|
| Ticket et sa conversation | Ticket : messages publics dans l'historique, notes privées en notes internes |
| Demandeur | Contact, reconnu par son adresse e-mail |
| Organisation / entreprise | Organisation, avec ses domaines |
| Statut résolu / fermé | Ticket fermé ; les autres restent ouverts |
| Priorité | Basse, normale ou urgente |
| Article du centre d'aide | Article de la base de connaissances, **en brouillon** |
| Agents, groupes | À recréer : [invitations](./equipe#les-comptes) et [équipes](./equipe) |
| Déclencheurs, automatisations, SLA | À recréer : [règles](./automatismes) et [objectifs SLA](./mettre-en-place-un-sla) |

## 1. Exporter

- **Zendesk** : l'export JSON du compte (un objet par ligne) garde la conversation de chaque ticket (`comments`) ; un export CSV des vues garde les tickets sans leur conversation. Les utilisateurs et organisations s'exportent de la même façon.
- **Freshdesk** : exporte depuis la liste des **tickets**, des **contacts** et des **entreprises** (CSV). Les colonnes `Contact ID` et `Company ID` servent d'identifiants ; les statuts 4 (résolu) et 5 (fermé) donnent des tickets fermés.
- **Articles** : un export JSON ou CSV des articles du centre d'aide (titre, contenu, catégorie). Le HTML est retiré.

Découpe les fichiers de plus de 10 Mo ou de 5 000 lignes.

## 2. Importer

**Paramètres → Sauvegarde → Importer depuis un autre outil**, outil **Zendesk** ou **Freshdesk** :

1. **Organisations**, puis **Contacts**, puis **Tickets**, puis **Articles**.
2. **Essai à blanc** pour chaque fichier : le nombre de lignes et la première ligne telle que comprise. Puis **Importer**.
3. Relis et publie les articles.

Un export plus récent se réimporte sans doublon ; coche **Mettre à jour ce qui est déjà importé** pour reprendre les changements de statut, de priorité, de noms ou de textes.

## 3. Basculer

1. Redirige l'adresse de support vers la [boîte de Datick](./integrations#tickets-par-e-mail) (Gmail ou Microsoft 365 sans mot de passe, IMAP, ou réception par webhook).
2. Remplace le widget de l'ancien outil par le [widget de Datick](./espace-membre).
3. Les demandeurs retrouvent leurs anciens tickets dans l'[espace membre](./espace-membre), connectés par leur adresse e-mail.
