# Sécurité

Le projet a fait l'objet de plusieurs audits, dont un audit OWASP Top 10, tous corrigés. Une faille ? Signale-la en privé : [Signaler une faille](./signaler-une-faille).

## Comptes et sessions

| | |
|---|---|
| **Connexion** | Discord OAuth2 uniquement, avec vérification de l'état (anti-CSRF du retour OAuth) |
| **Sessions** | Cookie `Secure`, `HttpOnly`, `SameSite=Lax`, stockées dans Redis, régénérées à chaque changement de droits, révocables depuis le profil |
| **2FA** | TOTP avec codes de secours, code jamais accepté deux fois, imposable par serveur |
| **Nouvel appareil** | MP au titulaire du compte : appareil, adresse IP, date |
| **Inactivité** | Déconnexion automatique réglable, vérifiée aussi côté serveur |
| **Limites** | 20 tentatives de connexion par 15 minutes et par adresse, 200 requêtes par minute sur l'API, anti-flood des MP |

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
| **SSRF** | Webhooks : résolution DNS et blocage des adresses privées et internes |
| **Adresse IP** | `X-Forwarded-For` n'est cru que venant du reverse proxy lui-même |
| **Pièces jointes** | Relais limité aux liens Discord et aux utilisateurs connectés |

## Données et infrastructure

| | |
|---|---|
| **Chiffrement** | Secrets 2FA et transcripts en AES-256-GCM, sauvegardes chiffrées (AES-256 + HMAC) |
| **Secrets** | Dans le `.env` (privé), jamais en ligne de commande ni dans le dépôt |
| **Docker** | Bot en utilisateur non root, `no-new-privileges`, aucune capacité Linux ; MariaDB et Redis sur le réseau interne seulement, Redis protégé par mot de passe ; compte `botuser` limité aux bases du bot |
| **Dépendances** | `npm audit` à chaque push, mises à jour Dependabot testées avant fusion, actions GitHub épinglées par empreinte |

## Rotation de la clé de chiffrement

Pour changer `ENCRYPTION_KEY` sans rien rendre illisible :

1. Génère une clé : `docker compose exec bot node scripts/rotate-encryption-key.js --generate`
2. Mets la nouvelle clé dans `ENCRYPTION_KEY` et l'ancienne dans `dashboard.previousEncryptionKeys` d'un [`config.json`](./configuration#reglages-rares-config-json), puis redémarre le bot.
3. Rechiffre tout : `docker compose exec bot node scripts/rotate-encryption-key.js` (rapport par table, relançable sans risque).
4. Retire l'ancienne clé et redémarre.
