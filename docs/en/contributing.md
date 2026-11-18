# Contributing

Thanks for your interest in the project. It is under the [AGPL-3.0](https://github.com/LuquyPest/datick/blob/main/LICENSE) licence: you may install it, modify it and host it for others, provided you publish your changes under the same licence.

## Where to ask, where to report

- **Question, idea, help installing** → [Discussions](https://github.com/LuquyPest/datick/discussions) (English welcome).
- **Bug** → [« Bug » issue](https://github.com/LuquyPest/datick/issues/new/choose), with the version (*Patchnotes* page of the dashboard or image tag), the steps and the logs (`docker compose logs bot`), **without any token or secret**.
- **Security flaw** → never in public: see [Report a vulnerability](./report-a-vulnerability).

## Running the project in development

```bash
npm ci && (cd dashboard && npm ci)
cp .env.example .env         # or scripts/setup.sh; a test bot token is enough
docker compose up -d db redis
DB_HOST=127.0.0.1 npm start   # bot + API on http://localhost:3000
cd dashboard && npm run dev   # Vite dashboard with hot reload, proxied to the API
```

## Before opening a pull request

```bash
npm run test:integration                                 # integration suite (throwaway MariaDB + Redis)
cd dashboard && npx vite build && node tests/smoke.mjs   # dashboard pages, accessibility (axe-core)
```

The CI runs both on every push, plus `npm audit` and the builds of the documentation site and of the Docker image. A PR is merged once it passes the CI and has been reviewed.

Rules of the repository:

- **No real data**: no real Discord ID, no e-mail address, no secret in the code, the tests or the screenshots.
- Commit messages in **French**, conventional style (`feat:`, `fix:`, `docs:`, `chore:`…).
- Any change to the schema of a server database is a **new migration** at the end of `utils/tenantMigrations.js`; a version already published is never modified. Global tables change in `bootstrap.js` (`ADD COLUMN IF NOT EXISTS`).
- API calls that change something require the `X-Requested-With: XMLHttpRequest` header.
- A visible feature comes with an entry in `dashboard/src/data/patchnotes.js` (source of the release notes and of the site's Versions page) and its page in the documentation, in French (`docs/guide/`) and English (`docs/en/`) — local preview: `cd docs && npm ci && npm run dev`.
- Interface texts are in French in the code; the English translation is in `dashboard/src/i18n/en.js`. The bot's messages to members exist in six languages: French and English in `utils/i18n.js`, the others in `utils/locales/` — a new key goes into all of them (the integration suite checks it).

## Publishing a version (maintainers)

`scripts/release.sh v3.1.0`: checks that the release notes know the version, updates `package.json`, creates the tag and pushes it. The *Release* action builds the image on native amd64 and arm64 runners, publishes it on `ghcr.io/luquypest/datick` (and under the old name `ghcr.io/luquypest/bot-ticketting` for all of v4) and creates the GitHub release.
