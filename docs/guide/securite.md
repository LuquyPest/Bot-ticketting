# Sécurité

Le projet a fait l'objet de plusieurs audits, dont un audit OWASP Top 10, tous corrigés. Une faille ? Signale-la en privé : [Signaler une faille](./signaler-une-faille).

## Comptes et sessions

| | |
|---|---|
| **Comptes** | Un compte par personne, créé à sa première connexion et désactivable ; **Profil → Connexion** liste ses moyens de connexion |
| **Connexion** | Discord OAuth2, avec vérification de l'état (anti-CSRF du retour OAuth) ; adresse e-mail et mot de passe (voir ci-dessous) ; Google, Microsoft ou OpenID Connect ([moyens de connexion](./instance#moyens-de-connexion)) |
| **Annuaire LDAP / AD** | LDAPS ou StartTLS seulement, certificat du serveur vérifié (autorité système ou fournie) ; mot de passe vérifié par l'annuaire (liaison sous l'identité de la personne), jamais gardé ; mot de passe vide refusé (pas de liaison anonyme) ; valeurs échappées dans les filtres (RFC 4515) ; même réponse pour un identifiant inconnu et un mauvais mot de passe, 10 échecs en 15 minutes bloquent l'identifiant ; aucun compte créé à la connexion |
| **OpenID Connect** | Flux *authorization code* avec `state`, `nonce` et PKCE (S256) ; jeton d'identité reçu directement du fournisseur, émetteur, application, expiration et nonce vérifiés ; liaison automatique à un compte seulement sur une adresse e-mail **vérifiée** par le fournisseur ; aucun compte créé à la connexion |
| **Mots de passe** | Hachés avec scrypt (sel par compte), 10 caractères au moins ; 10 échecs en 15 minutes bloquent la connexion par mot de passe du compte ; même réponse et même temps de calcul que l'adresse existe ou non ; 2FA du compte appliquée |
| **Sessions** | Cookie `Secure`, `HttpOnly`, `SameSite=Lax`, stockées dans Redis, régénérées à chaque changement de droits, révocables depuis le profil |
| **2FA** | TOTP avec codes de secours, code jamais accepté deux fois, imposable par serveur |
| **Nouvel appareil** | MP au titulaire du compte : appareil, adresse IP, date |
| **Inactivité** | Déconnexion automatique réglable, vérifiée aussi côté serveur |
| **Limites** | 20 tentatives de connexion par 15 minutes et par adresse, 200 requêtes par minute sur l'API, anti-flood des MP |

## Se connecter sans Discord

Un compte peut aussi se connecter avec une **adresse e-mail et un mot de passe**, depuis **Profil → Connexion** :

1. **Adresse e-mail** : saisis-la, puis ouvre le lien de confirmation reçu (valable 24 heures, une seule fois).
2. **Mot de passe** : 10 caractères au moins. Le changer ferme tes autres sessions ; changer d'adresse le retire.
3. Sur la page de connexion, **Adresse e-mail** et **Mot de passe** sous le bouton Discord. **Mot de passe oublié ?** envoie un lien valable 30 minutes ; l'utiliser ferme toutes les sessions du compte.

Ces e-mails partent par l'[e-mail de l'instance](./instance#e-mail-de-l-instance), à configurer d'abord. On ne peut retirer le mot de passe, ni délier un fournisseur, que s'il reste un autre moyen de connexion activé sur l'instance. Google, Microsoft et OpenID Connect se relient depuis la même page (**Relier**), si le propriétaire les a activés.

## Accès aux données

| | |
|---|---|
| **Contrôle d'accès** | Permissions de grade et visibilité vérifiées côté serveur, partout : API, temps réel, push, commandes Discord, salons |
| **Isolation** | Une base de données par serveur Discord ; rien ne déborde d'un serveur à l'autre |
| **Tickets confidentiels** | Visibles des seuls fondateurs ; chaque consultation est inscrite au journal |
| **Instance** | Réservée au propriétaire de l'application Discord, vérifié à chaque requête, jamais accessible depuis la démonstration |
| **Espace membre et invités** | Sessions séparées, sans aucun droit sur le dashboard, limitées à leurs propres tickets |
| **Allowlist IP** | Par serveur (IPv4, IPv6, plages CIDR) |
| **Journal** | Chaque action du dashboard, de Discord, de l'API et de l'instance, avec son auteur |

## Application web

| | |
|---|---|
| **En-têtes** | Content-Security-Policy stricte (aucun script en ligne), HSTS, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` |
| **CSRF** | Toute modification exige l'en-tête `X-Requested-With` |
| **Injection SQL** | Requêtes paramétrées partout, noms de colonnes dynamiques tirés de listes blanches |
| **SSRF** | Webhooks et serveurs des tickets par e-mail : résolution DNS, blocage des adresses privées et internes, adresse épinglée ; ports IMAP/SMTP standard uniquement |
| **Tickets par e-mail** | Une réponse n'entre dans un ticket qu'avec le jeton du sujet **et** depuis l'adresse qui l'a ouvert ; réponses automatiques ignorées ; 10 e-mails par heure et par expéditeur, 60 nouveaux tickets par heure et par serveur ; mots de passe IMAP/SMTP chiffrés |
| **Métriques** | `/metrics` absent tant que le propriétaire ne l'active pas, puis protégé par un jeton dont seule l'empreinte est gardée ; aucun nom ni sujet |
| **Adresse IP** | `X-Forwarded-For` n'est cru que venant du reverse proxy lui-même |
| **Pièces jointes** | Relais limité aux liens Discord et aux utilisateurs connectés ; celles des e-mails servies seulement au staff qui voit le ticket, en téléchargement (`nosniff`, sandbox), sous un nom aléatoire, types exécutables refusés |

## Données et infrastructure

| | |
|---|---|
| **Chiffrement** | Secrets 2FA, mots de passe des boîtes e-mail et transcripts en AES-256-GCM, sauvegardes chiffrées (AES-256 + HMAC) |
| **Secrets** | Dans le `.env` (privé), jamais en ligne de commande ni dans le dépôt |
| **Docker** | Image minimale (Alpine et Node.js seuls, sans npm ni gestionnaire de paquets JavaScript), bot en utilisateur non root, `no-new-privileges`, aucune capacité Linux ; MariaDB et Redis sur le réseau interne seulement, Redis protégé par mot de passe ; compte `botuser` limité aux bases du bot. Le service facultatif de mise à jour est le seul à accéder à Docker, et n'exécute rien de ce que le bot lui envoie ; le bot ne lit jamais les archives de sauvegarde : une restauration est faite par le service de sauvegarde, sur une demande au format vérifié |
| **Dépendances** | `npm audit` à chaque push, mises à jour Dependabot testées par la CI (tests, build du dashboard, du site et de l'image ; les mineures sont fusionnées seules quand tout est vert), actions GitHub épinglées par empreinte |

## Rotation de la clé de chiffrement

Pour changer `ENCRYPTION_KEY` sans rien rendre illisible :

1. Génère une clé : `docker compose exec bot node scripts/rotate-encryption-key.js --generate`
2. Mets la nouvelle clé dans `ENCRYPTION_KEY` et l'ancienne dans `dashboard.previousEncryptionKeys` d'un [`config.json`](./configuration#reglages-rares-config-json), puis redémarre le bot.
3. Rechiffre tout : `docker compose exec bot node scripts/rotate-encryption-key.js` (rapport par table, relançable sans risque).
4. Retire l'ancienne clé et redémarre.
