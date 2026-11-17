# Aider à traduire

Le bot parle aux membres en **six langues** : français, anglais, espagnol, allemand, italien et portugais (Brésil). Le français et l'anglais sont relus ; l'espagnol, l'allemand, l'italien et le portugais ont été écrits sans relecture par quelqu'un dont c'est la langue. **Une phrase sonne faux ? Ta correction est la bienvenue**, même d'un seul mot.

## Ce qui est traduit, et où

| Quoi | Langues | Fichier |
|---|---|---|
| Messages privés du bot aux membres | 6 | [`utils/i18n.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/utils/i18n.js) (français, anglais) et [`utils/locales/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/utils/locales) (`es.js`, `de.js`, `it.js`, `pt.js`) |
| Réponses du bot au staff (commandes, boutons, salons) | 6 | [`utils/locales/staff.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/utils/locales/staff.js) |
| Commandes Discord (descriptions, options, choix) | 6 | [`utils/locales/commands.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/utils/locales/commands.js) |
| Espace membre (`/espace`) | 6 | [`dashboard/src/i18n/member.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/dashboard/src/i18n/member.js) |
| Dashboard du staff | français, anglais | [`dashboard/src/i18n/en.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/dashboard/src/i18n/en.js) |
| Notes de version | français, anglais | [`dashboard/src/data/patchnotes.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/dashboard/src/data/patchnotes.js) (`titleEn`, `en`) |
| Documentation | français, anglais | [`docs/guide/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/docs/guide) et [`docs/en/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/docs/en) |

## Proposer une correction

**Sans rien installer** : ouvre le fichier sur GitHub, clique le crayon (*Edit this file*), corrige le texte, puis *Propose changes* : GitHub crée la demande de fusion pour toi.

**Ou simplement** : ouvre une [issue « Traduction »](https://github.com/LuquyPest/Bot-ticketting/issues/new?template=translation.md) avec le texte actuel et ta proposition.

## Les règles

- Garde les **variables** entre accolades telles quelles : `{id}`, `{guild}`, `{max}`… Leur place dans la phrase peut changer.
- Garde le **Markdown** de Discord (`**gras**`, retours à la ligne `\n`) et les émojis.
- Dans `commands.js`, une description fait **100 caractères au plus**, et un nom d'option est **en minuscules, sans espace**.
- On tutoie le membre dans les langues qui le permettent, sur un ton simple et chaleureux.

La suite de tests vérifie qu'aucune clé ne manque et que les variables sont les mêmes dans chaque langue.

## Une nouvelle langue ?

Une langue de plus pour les membres, c'est un fichier `utils/locales/<code>.js` (copie de `es.js`), une colonne dans `commands.js` et un bloc dans `member.js`. Propose-la dans une issue d'abord : on vérifie ensemble ce qu'il faut toucher.
