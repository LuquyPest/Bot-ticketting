# Member space

Members sign in on **`/espace`** of your domain — with Discord, or **without a Discord account** through a link received by e-mail — and find all their tickets, open and closed, on each of your servers — including those where they were added as participants. The space comes in **six languages** — English, French, Spanish, German, Italian, Portuguese: the browser's language (English for any other), changeable at the bottom of the page. Error messages and the downloaded conversation follow the same language.

- **Follow**: a status written for them (« waiting for your answer », « being handled »…), the conversation with the staff, the rating they gave, a download of the exchange.
- **Reply** from the web, exactly as by DM (same limits, same channel on the staff side).
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

## What is shown, and what never is

Only what the member received or sent by DM. **Never** internal notes, messages typed by the staff in the Discord channel, or the name behind an anonymous reply.

Signing in with Discord only asks for the identity (scope `identify`); signing in by e-mail only keeps a fingerprint of the link, never the link itself. Neither gives access to the dashboard. Each request checks that the member owns or takes part in the ticket, and is still a member of the server (or, signed in by e-mail, that the space is open to everyone).

## In the server's colours

**Settings → Features → Member web space**: turn it on or off for this server (on by default), and choose its logo, its accent colour (text switches to black or white depending on contrast) and its welcome message.
