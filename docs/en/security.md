# Security

The project has been through several audits, including an OWASP Top 10 audit, all fixed. Found a flaw? Report it privately: [Report a vulnerability](./report-a-vulnerability).

## Accounts and sessions

| | |
|---|---|
| **Accounts** | One account per person, created at their first sign-in and can be disabled; **Profile → Sign-in** lists its sign-in methods |
| **Sign-in** | Discord OAuth2, with state verification (CSRF protection of the OAuth return); e-mail address and password (see below); Google, Microsoft or OpenID Connect ([ways to sign in](./instance#ways-to-sign-in)) |
| **LDAP / AD directory** | LDAPS or StartTLS only, server certificate checked (system or given authority); password checked by the directory (bind as the person), never kept; empty password refused (no anonymous bind); values escaped in filters (RFC 4515); same answer for an unknown login and a wrong password, 10 failures in 15 minutes lock the login; no account created at sign-in |
| **OpenID Connect** | *Authorization code* flow with `state`, `nonce` and PKCE (S256); ID token received straight from the provider, issuer, application, expiry and nonce checked; automatic link to an account only on an e-mail address **verified** by the provider; no account created at sign-in |
| **Passwords** | Hashed with scrypt (salt per account), at least 10 characters; 10 failures in 15 minutes lock the password sign-in of the account; same answer and same computing time whether the address exists or not; the account's 2FA applies |
| **Sessions** | `Secure`, `HttpOnly`, `SameSite=Lax` cookie, stored in Redis, regenerated on every change of rights, revocable from the profile |
| **2FA** | TOTP with backup codes, a code never accepted twice, enforceable per server |
| **New device** | DM to the account holder: device, IP address, date |
| **Inactivity** | Adjustable automatic sign-out, also checked on the server side |
| **Limits** | 20 sign-in attempts per 15 minutes and per address, 200 requests per minute on the API, DM anti-flood |

## Signing in without Discord

An account can also sign in with an **e-mail address and a password**, from **Profile → Sign-in**:

1. **E-mail address**: enter it, then open the confirmation link you receive (valid 24 hours, once).
2. **Password**: at least 10 characters. Changing it closes your other sessions; changing the address removes it.
3. On the sign-in page, **E-mail address** and **Password** under the Discord button. **Forgot your password?** sends a link valid 30 minutes; using it closes every session of the account.

These e-mails go out through the [e-mail of the instance](./instance#e-mail-of-the-instance), to be set up first. The password can only be removed, and a provider unlinked, if another way to sign in turned on on the instance remains. Google, Microsoft and OpenID Connect are linked from the same page (**Link**), if the owner turned them on.

## Access to data

| | |
|---|---|
| **Access control** | Grade permissions and visibility checked on the server side, everywhere: API, real time, push, Discord commands, channels |
| **Isolation** | One database per Discord server; nothing leaks from one server to another |
| **Confidential tickets** | Visible to the founders only; each view is written to the log |
| **Instance** | Reserved to the owner of the Discord application, checked on every request, never reachable from the demonstration |
| **Member space and guests** | Separate sessions, without any right on the dashboard, limited to their own tickets |
| **IP allowlist** | Per server (IPv4, IPv6, CIDR ranges) |
| **Log** | Every action of the dashboard, Discord, the API and the instance, with its author |

## Web application

| | |
|---|---|
| **Headers** | Strict Content-Security-Policy (no inline script), HSTS, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` |
| **CSRF** | Every change requires the `X-Requested-With` header |
| **SQL injection** | Parameterised queries everywhere, dynamic column names taken from allowlists |
| **SSRF** | Webhooks and the servers of tickets by e-mail: DNS resolution, blocking of private and internal addresses, pinned address; standard IMAP/SMTP ports only |
| **Tickets by e-mail** | An answer enters a ticket only with the token of the subject **and** from the address that opened it; automatic replies ignored; 10 e-mails per hour per sender, 60 new tickets per hour per server; IMAP/SMTP passwords encrypted |
| **Metrics** | `/metrics` absent until the owner turns it on, then protected by a token of which only the fingerprint is kept; no name or subject |
| **IP address** | `X-Forwarded-For` is only trusted coming from the reverse proxy itself |
| **Attachments** | Relay limited to Discord links and to signed-in users; those of the e-mails served only to the staff who can see the ticket, as downloads (`nosniff`, sandbox), under a random name, executable types refused |

## Data and infrastructure

| | |
|---|---|
| **Encryption** | 2FA secrets, mailbox passwords and transcripts in AES-256-GCM, encrypted backups (AES-256 + HMAC) |
| **Secrets** | In `.env` (private), never on a command line nor in the repository |
| **Docker** | Minimal image (Alpine and Node.js only, without npm or any JavaScript package manager), bot as a non-root user, `no-new-privileges`, no Linux capability; MariaDB and Redis on the internal network only, Redis password-protected; `botuser` account limited to the bot's databases. The optional update service is the only one with access to Docker, and runs nothing the bot sends it; the bot never reads the backup archives: a restore is done by the backup service, on a request whose format is checked |
| **Dependencies** | `npm audit` on every push, Dependabot updates tested by the CI (tests, build of the dashboard, the site and the image; minor ones merged automatically when everything is green), GitHub actions pinned by hash |

## Rotating the encryption key

To change `ENCRYPTION_KEY` without making anything unreadable:

1. Generate a key: `docker compose exec bot node scripts/rotate-encryption-key.js --generate`
2. Put the new key in `ENCRYPTION_KEY` and the old one in `dashboard.previousEncryptionKeys` of a [`config.json`](./configuration#rare-settings-config-json), then restart the bot.
3. Re-encrypt everything: `docker compose exec bot node scripts/rotate-encryption-key.js` (report per table, safe to run again).
4. Remove the old key and restart.
