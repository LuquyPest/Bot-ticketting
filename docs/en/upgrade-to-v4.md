# Upgrading to v4

v4 turns Datick into a complete ticket tool where **Discord becomes one channel among others**: you can use it without Discord at all, with Discord as today, or both in the same space.

## Nothing is mandatory

A v3 instance moves to v4 **without doing anything**: update as usual (**Update** button in Instance → Health, or [by hand](./updates)).

- Migrations run at startup; no data is copied or renamed.
- Discord sign-in, DMs, channels, commands, panels and `/setup` work as before.
- The image is still published under the old name (`ghcr.io/luquypest/bot-ticketting`) as well as `ghcr.io/luquypest/datick`: your `.env` does not have to change.
- API v1 and the webhooks do not change.

## The words change

| Before | In v4 |
|---|---|
| Server (where the tickets, the team and the settings live) | **Space** |
| My servers | **My spaces** |
| Instance → Servers | **Instance → Spaces** |
| Member profiles | **Contacts** |

« Discord server » is still used when it really is about Discord. A server already set up becomes a space **linked** to its Discord server: same ID, same data.

## What you can add, if you want

| What | Where |
|---|---|
| A password on your account, so you no longer depend on Discord | Profile → Sign-in |
| The instance e-mail (invitations, sign-in links, resets) | Instance → Health → E-mail of the instance |
| Invite colleagues by e-mail, with a role and a grade | Team → Management → Invitations |
| Create a space without Discord | Instance → Spaces → Create a space |
| Link a space to a Discord server, or unlink it | Instance → Spaces → Link to Discord / Unlink from Discord |
| Sign in with Google, Microsoft or an OpenID Connect provider (Keycloak, Authentik…) | Instance → Sign-in, then Profile → Sign-in → Link |
| Turn off the Discord sign-in (the bot stays) | Instance → Sign-in |
| One card per person, gathering their Discord account and e-mail address | Support → Contacts |
| Let people without Discord open tickets | Settings → Features → Member web space → « Open to everyone by e-mail » |
| Start an instance without Discord at all | `DISCORD_TOKEN` empty, first account through the install token ([installation](./installation)) |

## A space without Discord

In a space linked to no Discord server, the dashboard hides what cannot work: **Panels**, **Roles**, **Server health**, **Newsletter**, the **Channels** tab of the settings, the access roles, the bot's appearance and the ticket format on Discord. Tickets live in the dashboard; requesters come by e-mail (support mailbox) or through the [member space](./member-space) with a sign-in link.

Linking the space to a Discord server later brings everything back, without losing anything.

## After the update

1. Open **Instance → Health**: the version shown is v4 and the migrations ran (the bot log lists them at startup).
2. To stop depending on Discord to sign in: **Profile → Sign-in → password**, and set up the instance e-mail so you can reset it.
3. Plan the instance e-mail if you want to invite colleagues by e-mail or open the member space to people without Discord.
