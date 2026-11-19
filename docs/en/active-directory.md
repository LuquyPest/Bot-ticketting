# Connecting your Active Directory

This guide lets the staff sign in with their Windows account, and loads the contacts and organisations from the directory. It works for Active Directory, and for OpenLDAP with the values filled in by the **OpenLDAP** button. The detail of each setting is in [Instance section → LDAP / Active Directory directory](./instance#ldap-active-directory-directory).

## 1. On the Active Directory side

1. Create a read-only **service account** (for example `datick` in a *Services* OU), with a long password that does not expire.
2. Create a **group** for the people allowed in the dashboard (for example `Datick Support`) and put the technicians in it.
3. Check that **LDAPS** answers (port 636). If the certificate comes from your internal authority (AD CS), export the **root authority certificate** as Base-64 (PEM).

## 2. On the Datick side

**Instance → Sign-in → LDAP / Active Directory directory**, **Active Directory** button (which fills in the `sAMAccountName` attribute and the filter that leaves out disabled accounts):

| Setting | Example |
|---|---|
| Server address | `ldaps://dc1.company.local:636` |
| Service account | `CN=datick,OU=Services,DC=company,DC=local` and its password |
| Search base | `OU=Users,DC=company,DC=local` |
| Allowed group | `CN=Datick Support,OU=Groups,DC=company,DC=local` |
| Authority certificate | the PEM exported in step 1, if the authority is internal |

**Test** checks the service account and counts the people found; then turn it on and **Save**. The sign-in page offers « Continue with *Directory* ».

## 3. Accounts

Two ways:

- **Invitations** (default): invite each technician by address; at their first directory sign-in, their Windows account is linked to their Datick account.
- **Accounts created at sign-in**: tick the option and pick the spaces; a member of the allowed group gets their account at their first sign-in, with the support role. A founder then adjusts their grades.

## 4. Contacts

**Contacts sync**: frequency **every day**, and the spaces that receive the contacts. Each employee of the directory becomes a contact attached to their organisation (`company` attribute); changes of name or department are taken at each sync. The tickets they send by e-mail attach to them on their own.
