import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, LogOut, Inbox, Loader2, Star, Users, Ticket } from 'lucide-react';
import api from '../api';
import MessageContent from '../components/MessageContent';

// Member web space: a member signs in with Discord and reads their own tickets (no staff data).
// French by default, English when the browser asks for it.
const LANG = (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
const STR = {
  fr: {
    title: 'Mes tickets', subtitle: 'Retrouve tes demandes au support, leur statut et vos échanges.',
    login: 'Se connecter avec Discord', loginHint: 'Seule ton identité Discord est demandée. Tu ne vois que tes propres tickets.',
    logout: 'Se déconnecter', none: 'Aucun ticket pour l\'instant.', noneHint: 'Pour ouvrir un ticket, envoie un message privé au bot sur Discord.',
    back: 'Mes tickets', transcript: 'Télécharger l\'échange', noMessages: 'Aucun message', you: 'Toi', member: 'Membre',
    participant: 'Participant', rating: 'Ta note', opened: 'Ouvert le', closed: 'Fermé le', notFound: 'Ticket introuvable.',
    error: { invalid_state: 'La connexion a expiré, réessaie.', oauth_failed: 'La connexion Discord a échoué, réessaie.', no_code: 'Connexion annulée.' },
    status: { closed: 'Fermé', merged: 'Regroupé avec un autre ticket', waiting: 'En attente de ta réponse', in_progress: 'En cours de traitement', assigned: 'Pris en charge', received: 'Reçu, en attente de prise en charge' },
    reply: 'Pour répondre, écris au bot en message privé sur Discord.',
  },
  en: {
    title: 'My tickets', subtitle: 'Find your support requests, their status and your conversations.',
    login: 'Sign in with Discord', loginHint: 'Only your Discord identity is requested. You only see your own tickets.',
    logout: 'Sign out', none: 'No tickets yet.', noneHint: 'To open a ticket, send a direct message to the bot on Discord.',
    back: 'My tickets', transcript: 'Download the conversation', noMessages: 'No messages', you: 'You', member: 'Member',
    participant: 'Participant', rating: 'Your rating', opened: 'Opened', closed: 'Closed', notFound: 'Ticket not found.',
    error: { invalid_state: 'The sign-in expired, please try again.', oauth_failed: 'Discord sign-in failed, please try again.', no_code: 'Sign-in cancelled.' },
    status: { closed: 'Closed', merged: 'Merged with another ticket', waiting: 'Waiting for your answer', in_progress: 'Being handled', assigned: 'Taken in charge', received: 'Received, waiting to be taken in charge' },
    reply: 'To answer, message the bot privately on Discord.',
  },
}[LANG];

const fmt = d => (d ? new Date(d).toLocaleString(LANG === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function statusOf(t) {
  if (t.merged_into) return { label: STR.status.merged, cls: 'bg-overlay/6 text-ink-2 border-overlay/10' };
  if (t.status === 'closed') return { label: STR.status.closed, cls: 'bg-overlay/6 text-ink-2 border-overlay/10' };
  if (t.stage === 'waiting') return { label: STR.status.waiting, cls: 'bg-amber-500/10 text-amber-400 border-amber-500/25' };
  if (t.stage === 'in_progress') return { label: STR.status.in_progress, cls: 'bg-sky-500/10 text-sky-400 border-sky-500/25' };
  if (t.assigned) return { label: STR.status.assigned, cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' };
  return { label: STR.status.received, cls: 'bg-primary/10 text-primary-light border-primary/25' };
}

function StatusBadge({ ticket }) {
  const s = statusOf(ticket);
  return <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
}

function GuildIcon({ guild }) {
  return guild.icon
    ? <img src={guild.icon} alt="" className="w-7 h-7 rounded-lg object-cover" />
    : <span className="w-7 h-7 rounded-lg bg-primary/20 text-primary-light text-xs font-bold flex items-center justify-center">{guild.name?.[0] || '?'}</span>;
}

function Shell({ me, onLogout, children }) {
  return (
    <div className="min-h-screen bg-base">
      <header className="border-b border-overlay/6 bg-surface/60">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Ticket size={18} className="text-primary-light" />
          <Link to="/espace" className="text-sm font-bold text-ink-1">{STR.title}</Link>
          {me && !me.viaDashboard && (
            <div className="ml-auto flex items-center gap-2.5">
              {me.avatar && <img src={`https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.webp?size=32`} alt="" className="w-6 h-6 rounded-full" />}
              <span className="text-xs text-ink-2 hidden sm:inline">{me.username}</span>
              <button onClick={onLogout} aria-label={STR.logout} title={STR.logout}
                className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/6"><LogOut size={14} /></button>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

function LoginCard({ error }) {
  return (
    <div className="max-w-sm mx-auto mt-16 text-center space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink-1">{STR.title}</h1>
        <p className="text-sm text-ink-3 mt-1">{STR.subtitle}</p>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{STR.error[error] || STR.error.oauth_failed}</p>}
      <a href="/api/member/auth/discord"
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold text-sm transition-colors">
        {STR.login}
      </a>
      <p className="text-xs text-ink-4">{STR.loginHint}</p>
    </div>
  );
}

function TicketList() {
  const [groups, setGroups] = useState(null);
  useEffect(() => { api.get('/member/tickets').then(r => setGroups(r.data)).catch(() => setGroups([])); }, []);
  if (!groups) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  if (!groups.length) return (
    <div className="text-center py-16 space-y-2">
      <Inbox size={28} className="mx-auto text-ink-4" />
      <p className="text-sm text-ink-2">{STR.none}</p>
      <p className="text-xs text-ink-4">{STR.noneHint}</p>
    </div>
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-1">{STR.title}</h1>
        <p className="text-sm text-ink-3 mt-0.5">{STR.subtitle}</p>
      </div>
      {groups.map(({ guild, tickets }) => (
        <section key={guild.id} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-1"><GuildIcon guild={guild} />{guild.name}</h2>
          <ul className="space-y-2">
            {tickets.map(t => (
              <li key={t.id}>
                <Link to={`/espace/${guild.id}/${t.id}`}
                  className="block bg-surface-card border border-overlay/6 rounded-2xl p-4 hover:border-overlay/12 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-1 truncate">
                        <span className="font-mono text-ink-4 mr-1.5">#{t.id}</span>{t.subject || '—'}
                      </p>
                      <p className="text-[11px] text-ink-4 mt-1">
                        {STR.opened} {fmt(t.created_at)}{t.closed_at ? ` · ${STR.closed} ${fmt(t.closed_at)}` : ''}
                        {t.participant && <span className="ml-1.5 inline-flex items-center gap-1"><Users size={10} />{STR.participant}</span>}
                      </p>
                    </div>
                    <StatusBadge ticket={t} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TicketView({ guildId, ticketId, me }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.get(`/member/tickets/${guildId}/${ticketId}`).then(r => setData(r.data)).catch(() => setError(true));
  }, [guildId, ticketId]);
  if (error) return <p className="text-sm text-ink-3 py-10 text-center">{STR.notFound} <Link to="/espace" className="underline">{STR.back}</Link></p>;
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  const { guild, ticket: t, messages } = data;
  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/espace')} className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1">
        <ArrowLeft size={13} /> {STR.back}
      </button>
      <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xs text-ink-3"><GuildIcon guild={guild} />{guild.name}</p>
            <h1 className="text-lg font-bold text-ink-1 mt-2"><span className="font-mono text-ink-4 mr-1.5">#{t.id}</span>{t.subject || '—'}</h1>
            <p className="text-[11px] text-ink-4 mt-1">{STR.opened} {fmt(t.created_at)}{t.closed_at ? ` · ${STR.closed} ${fmt(t.closed_at)}` : ''}</p>
          </div>
          <StatusBadge ticket={t} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {t.rating && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-2" aria-label={`${STR.rating} : ${t.rating}/5`}>
              {STR.rating} {[1, 2, 3, 4, 5].map(i => <Star key={i} size={12} className={i <= t.rating ? 'text-amber-400 fill-amber-400' : 'text-ink-4'} />)}
            </span>
          )}
          <a href={`/api/member/tickets/${guildId}/${ticketId}/transcript`}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1 hover:border-overlay/15">
            <Download size={12} /> {STR.transcript}
          </a>
        </div>
      </div>

      <ol className="space-y-3" aria-label="Messages">
        {!messages.length && <li className="text-center text-xs text-ink-4 py-6">{STR.noMessages}</li>}
        {messages.map(m => m.kind === 'event' ? (
          <li key={m.id} className="flex items-center gap-3">
            <span className="h-px flex-1 bg-overlay/8" />
            <span className="text-[11px] text-ink-3 text-center">{m.content} · {fmt(m.created_at)}</span>
            <span className="h-px flex-1 bg-overlay/8" />
          </li>
        ) : (
          <li key={m.id} className={`flex ${m.kind === 'staff' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.kind === 'staff' ? 'bg-surface-card border border-overlay/8 text-ink-1' : 'bg-primary text-white'}`}>
              <p className={`text-[11px] font-semibold ${m.kind === 'staff' ? 'text-primary-light' : 'text-white'}`}>
                {m.kind === 'me' ? STR.you : m.author || STR.member}
              </p>
              <p className="text-sm whitespace-pre-wrap wrap-break-word mt-0.5"><MessageContent text={m.content} light={m.kind !== 'staff'} /></p>
              <p className={`text-[10px] mt-1 ${m.kind === 'staff' ? 'text-ink-4' : 'text-white'}`}>{fmt(m.created_at)}</p>
            </div>
          </li>
        ))}
      </ol>
      {t.status === 'open' && <p className="text-xs text-ink-4 text-center">{STR.reply}</p>}
    </div>
  );
}

export default function MemberPortal() {
  const { guildId, ticketId } = useParams();
  const [params] = useSearchParams();
  const [me, setMe] = useState(undefined);
  useEffect(() => {
    document.title = STR.title;
    api.get('/member/me').then(r => setMe(r.data)).catch(() => setMe(null));
  }, []);
  const logout = async () => { await api.post('/member/logout').catch(() => {}); window.location.href = '/espace'; };

  if (me === undefined) return <div className="min-h-screen bg-base flex items-center justify-center"><Loader2 className="animate-spin text-ink-4" /></div>;
  return (
    <Shell me={me} onLogout={logout}>
      {!me ? <LoginCard error={params.get('error')} />
        : guildId && ticketId ? <TicketView guildId={guildId} ticketId={ticketId} me={me} />
        : <TicketList />}
    </Shell>
  );
}
