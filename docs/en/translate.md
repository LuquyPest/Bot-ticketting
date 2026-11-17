# Help translate

The bot talks to members in **six languages**: French, English, Spanish, German, Italian and Portuguese (Brazil). French and English are proofread; Spanish, German, Italian and Portuguese were written without review by a native speaker. **A sentence sounds wrong? Your fix is welcome**, even for a single word.

## What is translated, and where

| What | Languages | File |
|---|---|---|
| Direct messages from the bot to members | 6 | [`utils/i18n.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/utils/i18n.js) (French, English) and [`utils/locales/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/utils/locales) (`es.js`, `de.js`, `it.js`, `pt.js`) |
| Replies of the bot to the staff (commands, buttons, channels) | 6 | [`utils/locales/staff.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/utils/locales/staff.js) |
| Discord commands (descriptions, options, choices) | 6 | [`utils/locales/commands.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/utils/locales/commands.js) |
| Member space (`/espace`) | 6 | [`dashboard/src/i18n/member.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/dashboard/src/i18n/member.js) |
| Staff dashboard | French, English | [`dashboard/src/i18n/en.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/dashboard/src/i18n/en.js) |
| Release notes | French, English | [`dashboard/src/data/patchnotes.js`](https://github.com/LuquyPest/Bot-ticketting/blob/main/dashboard/src/data/patchnotes.js) (`titleEn`, `en`) |
| Documentation | French, English | [`docs/guide/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/docs/guide) and [`docs/en/`](https://github.com/LuquyPest/Bot-ticketting/tree/main/docs/en) |

## Suggest a fix

**Without installing anything**: open the file on GitHub, click the pencil (*Edit this file*), fix the text, then *Propose changes*: GitHub creates the pull request for you.

**Or simply**: open a [« Translation » issue](https://github.com/LuquyPest/Bot-ticketting/issues/new?template=translation.md) with the current text and your suggestion.

## The rules

- Keep the **variables** in braces as they are: `{id}`, `{guild}`, `{max}`… Their place in the sentence may change.
- Keep Discord **Markdown** (`**bold**`, line breaks `\n`) and the emojis.
- In `commands.js`, a description is **100 characters at most**, and an option name is **lowercase, without spaces**.
- Address the member informally where the language allows it, in a simple and warm tone.

The test suite checks that no key is missing and that the variables are the same in every language.

## A new language?

One more language for members means a `utils/locales/<code>.js` file (copy of `es.js`), a column in `commands.js` and a block in `member.js`. Suggest it in an issue first: we will check together what needs to change.
