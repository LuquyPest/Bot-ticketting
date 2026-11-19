# Brancher son Active Directory

Ce guide permet au staff de se connecter avec son compte Windows, et charge les contacts et organisations depuis l'annuaire. Il vaut pour Active Directory, et pour OpenLDAP avec les valeurs proposées par le bouton **OpenLDAP**. Le détail de chaque réglage est dans [Section Instance → Annuaire LDAP / Active Directory](./instance#annuaire-ldap-active-directory).

## 1. Côté Active Directory

1. Crée un **compte de service** en lecture seule (par exemple `datick` dans une OU *Services*), avec un mot de passe long qui n'expire pas.
2. Crée un **groupe** pour les personnes qui ont droit au dashboard (par exemple `Support Datick`) et mets-y les techniciens.
3. Vérifie que **LDAPS** répond (port 636). Si le certificat vient de ton autorité interne (AD CS), exporte le **certificat de l'autorité racine** en Base-64 (PEM).

## 2. Côté Datick

**Instance → Connexion → Annuaire LDAP / Active Directory**, bouton **Active Directory** (qui remplit l'attribut `sAMAccountName` et le filtre qui écarte les comptes désactivés) :

| Réglage | Exemple |
|---|---|
| Adresse du serveur | `ldaps://dc1.entreprise.local:636` |
| Compte de service | `CN=datick,OU=Services,DC=entreprise,DC=local` et son mot de passe |
| Base de recherche | `OU=Utilisateurs,DC=entreprise,DC=local` |
| Groupe autorisé | `CN=Support Datick,OU=Groupes,DC=entreprise,DC=local` |
| Certificat de l'autorité | le PEM exporté à l'étape 1, si l'autorité est interne |

**Tester** vérifie le compte de service et compte les personnes trouvées ; puis active et **Enregistre**. La page de connexion propose « Continuer avec *Annuaire* ».

## 3. Les comptes

Deux façons de faire :

- **Invitations** (par défaut) : invite chaque technicien par son adresse ; à sa première connexion par l'annuaire, son compte Windows est relié à son compte Datick.
- **Comptes créés à la connexion** : coche l'option et choisis les espaces ; un membre du groupe autorisé reçoit son compte à sa première connexion, avec le rôle support. Un fondateur ajuste ensuite ses grades.

## 4. Les contacts

**Synchronisation des contacts** : fréquence **chaque jour**, et les espaces qui reçoivent les contacts. Chaque employé de l'annuaire devient un contact rattaché à son organisation (attribut `company`) ; ses changements de nom ou de service sont repris à chaque synchronisation. Les tickets qu'il envoie par e-mail s'y rattachent tout seuls.
