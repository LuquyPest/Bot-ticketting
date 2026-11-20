# Member space

Members sign in on **`/espace`** of your domain — with Discord, or **without a Discord account** through a link received by e-mail — and find all their tickets, open and closed, on each of your servers — including those where they were added as participants. The space comes in **six languages** — English, French, Spanish, German, Italian, Portuguese: the browser's language (English for any other), changeable at the bottom of the page. Error messages and the downloaded conversation follow the same language.

- **Follow**: a status written for them (« waiting for your answer », « being handled »…), the conversation with the staff, the rating they gave, a download of the exchange.
- **Reply** from the web, exactly as by DM (same limits, same channel on the staff side).
- **Files**: when opening a ticket or answering, the member attaches up to 5 files, with the same rules as the [e-mail attachments](./integrations#tickets-by-e-mail) (size, total space, refused types, retention, copy in the Discord channel). The ticket's files can be downloaded again from its page. The member can also **record** from their browser a **screenshot**, a **video of their screen** (90 seconds at most) or a **voice message** (3 minutes at most): the recording joins the files and goes the same way; nothing leaves the browser before it is sent.
- **Open a ticket**: server, subject, the subject's fields and form, with FAQ entries that look like the request suggested while typing.
- **Help**: each server's FAQ, searchable, with a link to its [public knowledge base](#public-knowledge-base) if it is online.
- **Direct link**: a « View on the web » button under each DM tied to a ticket.

## Public knowledge base

The server's FAQ (menu **FAQ**) is made of **articles**: a question, an answer (up to 5,000 characters), keywords for the automatic FAQ in DM, an optional **category** (« Account », « Orders »…) and a **visibility**:

| Visible to | Where the article shows |
|---|---|
| **Signed-in members** (default) | The **Help** tab of the member space, suggestions while opening a ticket, automatic FAQ in DM |
| **Everyone** | Also: the public page **`/aide/<server>`**, readable **without signing in**, and the suggestions of the [web widget](./integrations#web-widget) |

The public page is **offline** until a **founder** puts it online (**FAQ → Public knowledge base**). Online, it lists the active « Everyone » articles, grouped by category and searchable, each with its own address to share; the **Help** tab of the member space links to it, and the answers offered in DM add a « Read the article » link. Each article counts its reads (one per visitor and hour).

FAQ entries from before v4.2 are kept as they were, for signed-in members: nothing becomes public unless someone picks it. An article turned off, or set back to « signed-in members », leaves the public page at once. The page shows neither keywords, nor author, nor counters; an unknown server or one whose page is offline gets the same « not found » answer. Articles and their visibility are part of the [configuration export](./integrations#backing-up-the-configuration).

## Without Discord: sign-in link by e-mail

As soon as the **instance e-mail** is set up (Instance → Santé), the sign-in page offers « Get a sign-in link »: the person types their address and receives a link **valid for 15 minutes, single use**. No password, no account to create.

- **Where they can open a ticket**: in the spaces **open to everyone by e-mail** (Settings → Features → Member web space → « Open to everyone by e-mail »). A space created without Discord is open from the start; a Discord server is not until a founder ticks it.
- **Staff answers** reach them through the instance e-mail, with a link to the conversation; they answer from the page (replies to the e-mail are not read).
- **Their tickets sent by e-mail** to the support mailbox from the same address show up too: the link proves they read that mailbox.
- On the staff side, they get a **contact card** with a « Web » identity and their address; it can be merged with their Discord account (see [Contacts](./tickets#contacts)).

Anti-abuse limits: 3 links per address per quarter of an hour (beyond that, the answer is the same but nothing is sent), attempts limited per IP address, 3 openings per minute and per person, the server's daily limit, 60 new tickets per hour and per space from e-mail sign-ins, and the blacklist (under any of their identities).

### A managed knowledge base

Each article has a **state** (draft or published: a draft is visible to the staff only), a **visibility** (everyone, signed-in members, an **organisation**, the **staff only**, a staff **team**), a **review** date and an **expiry** date (expired, it disappears for readers). The answer has the same **formatting bar** as ticket replies.

Each change of the text keeps the **previous version** (**Previous versions**, **Go back to this one**). An article can be the **translation** of another in one of the 6 languages: readers see the one in their language, and the others are offered. At the bottom of a public article, **Did this article help you?** (yes, or no with what is missing); the staff's FAQ page shows the **feedback**, the most useful articles, what is **to review**, and the public base's **searches without results** (what is missing). From a solved ticket, **Create an article from the solution** makes it a draft.

**Images**: once the article is saved, **Add an image** under the answer uploads an image (PNG, JPEG, GIF or WebP, 5 MB at most, 30 per article) and inserts it where the cursor is, as `![text](/api/kb/…/images/…)`. It follows the article's visibility: everyone for a published public article, signed-in members for a members-only article, otherwise the staff only. It is shown in e-mails and public pages; in Discord DMs it becomes a link. Images from elsewhere (`![…](https://…)`) are never shown, so nobody tracks the readers. Deleting the article deletes its images.

### The tree

**FAQ → Tree** sorts the knowledge base into **categories on three levels** (« Delivery › Parcel tracking »). With the **Settings** permission, you create, rename and delete a category (its articles and sub-categories go up one level), and set the order by **drag and drop**: a category or an article dropped onto a category goes inside, dropped onto an item is placed before it; the arrows and « Move to » do the same from the keyboard. The public page, the member space's Help tab and the suggestions follow that order. The category typed in an article's editor (an existing path, or a new name) joins the tree; the categories from before v8 become its root categories.

### Search engines

The pages of the public base (`/aide/<space>` and each article) are sent **ready-made by the server**: title, description, canonical address, languages (`hreflang`), structured data (FAQ, article) and the content itself. They read **without JavaScript** and search engines index them; the dashboard then takes over the page as before. The **sitemap** is at `/aide/<space>/sitemap.xml`. Only what is public and published shows there; a draft, a restricted article or an offline page answer « not found ».

## The service catalogue

**Settings → Catalogue** (founders and the **Settings** permission): what requesters can ask for, by category (« Hardware », « Access »…), each **service** with its icon and description. In the member space, **New ticket** starts with this catalogue; **Something else** keeps the free form of before.

| | |
|---|---|
| **Form** | Up to 20 fields: short or long text, number, list, checkbox, date; required or not. A field can **show only if** a field placed before has a value (« if *Hardware* = *Laptop*, ask for the model »): hidden, it is neither asked nor kept |
| **The ticket becomes** | A subject (else the service name), a type, a priority, a team: applied at the opening, before the staff sees it |

The answers arrive in the ticket's first message, under the service name. The server checks each answer (required field, list, date, number); a service removed from the catalogue no longer opens. The **opening forms** of before were carried over as services; they are still used on Discord.

## The tickets of one's organisation

An [organisation](./tickets#organisations) chooses who, among its contacts, sees **its tickets** in the member space: **nobody** (by default: everyone sees only their own), **its managers** (the contacts ticked « Client-side manager » on their card, by a founder or the **Settings** permission), or **all its members**. A parent organisation also shows the tickets of its sub-organisations.

These tickets show under **My organisation's tickets**, with the name of the person who opened them. They can be read, not written: no reply, no confirming a solution, no files nor transcript; only the person who opened the ticket replies. A **confidential** ticket, or one restricted to a grade, never shows there.

## What is shown, and what never is

Only what the member received or sent by DM. **Never** internal notes, messages typed by the staff in the Discord channel, or the name behind an anonymous reply.

Signing in with Discord only asks for the identity (scope `identify`); signing in by e-mail only keeps a fingerprint of the link, never the link itself. Neither gives access to the dashboard. Each request checks that the member owns or takes part in the ticket, and is still a member of the server (or, signed in by e-mail, that the space is open to everyone).

## In the server's colours

**Settings → Features → Member web space**: turn it on or off for this server (on by default), and choose its logo, its accent colour (text switches to black or white depending on contrast) and its welcome message.
