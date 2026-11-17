# Contribuer

Merci de t'intéresser au projet. Il est sous licence [AGPL-3.0](https://github.com/LuquyPest/Bot-ticketting/blob/main/LICENSE) : tu peux l'installer, le modifier et l'héberger pour d'autres, à condition de publier tes modifications sous la même licence.

## Où poser une question, où signaler

- **Question, idée, aide à l'installation** → [Discussions](https://github.com/LuquyPest/Bot-ticketting/discussions).
- **Bug** → [issue « Bug »](https://github.com/LuquyPest/Bot-ticketting/issues/new/choose), avec la version (page *Patchnotes* du dashboard ou tag de l'image), les étapes et les logs (`docker compose logs bot`), **sans token ni secret**.
- **Faille de sécurité** → jamais en public : voir [Signaler une faille](https://docs.bot.daryu.xyz/guide/signaler-une-faille).

## Lancer le projet en développement

```bash
npm ci && (cd dashboard && npm ci)
cp .env.example .env         # ou scripts/setup.sh ; un token de bot de test suffit
docker compose up -d db redis
DB_HOST=127.0.0.1 npm start   # bot + API sur http://localhost:3000
cd dashboard && npm run dev   # dashboard Vite avec rechargement, proxy vers l'API
```

## Avant d'ouvrir une pull request

Les grandes évolutions sont décrites dans [`conception/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/conception) avant d'être codées : la [v4](https://github.com/LuquyPest/Bot-ticketting/blob/main/conception/v4.md) (Discord devient un canal parmi d'autres) y fixe le découpage en pull requests. Une PR de la v4 suit ce découpage et cite son issue.

```bash
npm run test:integration                           # suite d'intégration (MariaDB + Redis jetables)
cd dashboard && npx vite build && node tests/smoke.mjs   # pages du dashboard, accessibilité (axe-core)
```

La CI rejoue les deux à chaque push, plus `npm audit`. Une PR est fusionnée quand elle passe la CI et qu'elle est relue.

Règles du dépôt :

- **Pas de donnée réelle** : aucun identifiant Discord réel, aucune adresse e-mail, aucun secret dans le code, les tests ni les captures.
- Messages de commit en **français**, style conventionnel (`feat:`, `fix:`, `docs:`, `chore:`…).
- Toute évolution du schéma d'une base de serveur est une **nouvelle migration** à la fin de `utils/tenantMigrations.js` ; on ne modifie jamais une version déjà publiée. Les tables globales évoluent dans `bootstrap.js` (`ADD COLUMN IF NOT EXISTS`).
- Les appels API qui modifient quelque chose exigent l'en-tête `X-Requested-With: XMLHttpRequest`.
- Une fonctionnalité visible s'accompagne d'une entrée dans `dashboard/src/data/patchnotes.js` (source des notes de release et de la page Versions du site), avec sa traduction anglaise (`titleEn` pour la version, `en` pour chaque ligne) et de sa page dans la documentation, en français (`docs/guide/`) et en anglais (`docs/en/`) — aperçu local : `cd docs && npm ci && npm run dev`.
- Textes de l'interface en français dans le code ; la traduction anglaise est dans `dashboard/src/i18n/en.js`. Les messages du bot aux membres existent en six langues : français et anglais dans `utils/i18n.js`, les autres dans `utils/locales/` — une nouvelle clé s'ajoute dans toutes (la suite d'intégration le vérifie). Même règle pour les commandes Discord (`utils/locales/commands.js`) et l'espace membre (`dashboard/src/i18n/member.js`). Corriger une traduction : [Aider à traduire](https://docs.bot.daryu.xyz/guide/traduire).

## Publier une version (mainteneurs)

`scripts/release.sh v2.25` : vérifie que les patchnotes connaissent la version, met `package.json` à jour, crée le tag et le pousse. L'action *Release* construit l'image (amd64 + arm64), la publie sur `ghcr.io/luquypest/bot-ticketting` et crée la release GitHub.
