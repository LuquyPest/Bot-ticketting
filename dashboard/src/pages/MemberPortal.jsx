import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, LogOut, Inbox, Loader2, Star, Users, Ticket, Send, Search, HelpCircle, Plus } from 'lucide-react';
import api from '../api';
import MessageContent from '../components/MessageContent';
import { readableText } from '../utils/color';

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
    reply: 'Tu peux aussi répondre en message privé au bot sur Discord.',
    deleted: 'Message supprimé', edited: 'modifié',
    tabs: { tickets: 'Mes tickets', new: 'Ouvrir un ticket', help: 'Aide' },
    replyPh: 'Écris ta réponse…', send: 'Envoyer', sent: 'Message envoyé', closedTicket: 'Ce ticket est fermé.',
    server: 'Serveur', subject: 'Sujet', subjectPh: 'Sujet de ta demande', message: 'Ta demande', messagePh: 'Explique ton problème le plus précisément possible.',
    optional: 'facultatif', form: 'Quelques questions', open: 'Ouvrir le ticket', noGuild: 'Aucun serveur disponible : tu dois être membre d\'un serveur qui utilise ce bot.',
    faqTitle: 'Questions fréquentes', faqSearch: 'Chercher dans l\'aide…', faqNone: 'Aucune réponse ne correspond.', faqEmpty: 'Ce serveur n\'a pas encore de page d\'aide.',
    stillStuck: 'Toujours bloqué ?', maybe: 'Ces réponses peuvent t\'aider :', error2: 'Erreur, réessaie.',
  },
  en: {
    title: 'My tickets', subtitle: 'Find your support requests, their status and your conversations.',
    login: 'Sign in with Discord', loginHint: 'Only your Discord identity is requested. You only see your own tickets.',
    logout: 'Sign out', none: 'No tickets yet.', noneHint: 'To open a ticket, send a direct message to the bot on Discord.',
    back: 'My tickets', transcript: 'Download the conversation', noMessages: 'No messages', you: 'You', member: 'Member',
    participant: 'Participant', rating: 'Your rating', opened: 'Opened', closed: 'Closed', notFound: 'Ticket not found.',
    error: { invalid_state: 'The sign-in expired, please try again.', oauth_failed: 'Discord sign-in failed, please try again.', no_code: 'Sign-in cancelled.' },
    status: { closed: 'Closed', merged: 'Merged with another ticket', waiting: 'Waiting for your answer', in_progress: 'Being handled', assigned: 'Taken in charge', received: 'Received, waiting to be taken in charge' },
    reply: 'You can also answer by messaging the bot privately on Discord.',
    deleted: 'Message deleted', edited: 'edited',
    tabs: { tickets: 'My tickets', new: 'Open a ticket', help: 'Help' },
    replyPh: 'Write your answer…', send: 'Send', sent: 'Message sent', closedTicket: 'This ticket is closed.',
    server: 'Server', subject: 'Subject', subjectPh: 'Subject of your request', message: 'Your request', messagePh: 'Describe your problem as precisely as possible.',
    optional: 'optional', form: 'A few questions', open: 'Open the ticket', noGuild: 'No server available: you must be a member of a server that uses this bot.',
    faqTitle: 'Frequently asked questions', faqSearch: 'Search the help…', faqNone: 'No answer matches.', faqEmpty: 'This server has no help page yet.',
    stillStuck: 'Still stuck?', maybe: 'These answers may help:', error2: 'Error, please try again.',
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

function GuildIcon({ guild, size = 'w-7 h-7' }) {
  const src = guild.logo || guild.icon;
  return src
    ? <img src={src} alt="" className={`${size} rounded-lg object-cover`} />
    : <span className={`${size} rounded-lg bg-primary/20 text-primary-light text-xs font-bold flex items-center justify-center`}>{guild.name?.[0] || '?'}</span>;
}

// Server colours: accent of the buttons and of the banner on that server's pages
const accent = guild => (guild?.color ? { background: guild.color, color: readableText(guild.color) } : undefined);

function GuildBanner({ guild }) {
  if (!guild) return null;
  return (
    <div className="rounded-2xl border border-overlay/6 bg-surface-card overflow-hidden">
      <div className="h-1.5" style={{ background: guild.color || 'var(--color-primary)' }} />
      <div className="flex items-center gap-3 p-4">
        <GuildIcon guild={guild} size="w-10 h-10" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-1">{guild.name}</p>
          {guild.welcome && <p className="text-xs text-ink-2 mt-0.5 whitespace-pre-wrap">{guild.welcome}</p>}
        </div>
      </div>
    </div>
  );
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
      {me && (
        <nav className="max-w-3xl mx-auto px-4 pt-4 flex gap-1" aria-label={STR.title}>
          {[['/espace', STR.tabs.tickets, Inbox], ['/espace/nouveau', STR.tabs.new, Plus], ['/espace/aide', STR.tabs.help, HelpCircle]].map(([to, label, Icon]) => {
            const active = to === '/espace' ? !/^\/espace\/(nouveau|aide)/.test(window.location.pathname) : window.location.pathname.startsWith(to);
            return (
              <Link key={to} to={to} aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${active ? 'bg-primary/15 text-primary-light' : 'text-ink-3 hover:text-ink-1'}`}>
                <Icon size={13} /> {label}
              </Link>
            );
          })}
        </nav>
      )}
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
      <Link to="/espace/nouveau" className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold"><Plus size={14} /> {STR.tabs.new}</Link>
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
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-1 border-l-4 pl-2" style={{ borderColor: guild.color || 'transparent' }}><GuildIcon guild={guild} />{guild.name}</h2>
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
  const load = () => api.get(`/member/tickets/${guildId}/${ticketId}`).then(r => setData(r.data)).catch(() => setError(true));
  useEffect(() => {
    load();
    // New staff answers show up without reloading
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    return () => clearInterval(timer);
  }, [guildId, ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');
  const send = async () => {
    setSending(true); setReplyError('');
    try {
      await api.post(`/member/tickets/${guildId}/${ticketId}/messages`, { content: reply.trim() });
      setReply('');
      await load();
    } catch (err) { setReplyError(err.response?.data?.error || STR.error2); }
    setSending(false);
  };
  if (error) return <p className="text-sm text-ink-3 py-10 text-center">{STR.notFound} <Link to="/espace" className="underline">{STR.back}</Link></p>;
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  const { guild, ticket: t, messages } = data;
  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/espace')} className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1">
        <ArrowLeft size={13} /> {STR.back}
      </button>
      <GuildBanner guild={guild} />
      <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
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
              <p className="text-sm whitespace-pre-wrap wrap-break-word mt-0.5">
                {m.deleted ? <em className="opacity-80">{STR.deleted}</em> : <MessageContent text={m.content} light={m.kind !== 'staff'} />}
              </p>
              <p className={`text-[10px] mt-1 ${m.kind === 'staff' ? 'text-ink-4' : 'text-white'}`}>{fmt(m.created_at)}{m.edited && !m.deleted ? ` · ${STR.edited}` : ''}</p>
            </div>
          </li>
        ))}
      </ol>
      {t.status === 'open' && !t.merged_into ? (
        <div className="bg-surface-card border border-overlay/6 rounded-2xl p-3 space-y-2">
          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} maxLength={2000} aria-label={STR.replyPh} placeholder={STR.replyPh}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && reply.trim()) send(); }}
            className="w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 placeholder-ink-4 focus:outline-hidden focus:border-primary/50 resize-y" />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-ink-4">{STR.reply}</p>
            {replyError && <p className="text-xs text-red-400" role="alert">{replyError}</p>}
            <button onClick={send} disabled={!reply.trim() || sending} style={accent(guild)}
              className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {STR.send}
            </button>
          </div>
        </div>
      ) : <p className="text-xs text-ink-4 text-center">{STR.closedTicket}</p>}
    </div>
  );
}

const normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

// Server picker shared by the help page and the opening form (?guild= keeps the choice)
function useGuilds() {
  const [params, setParams] = useSearchParams();
  const [guilds, setGuilds] = useState(null);
  useEffect(() => { api.get('/member/guilds').then(r => setGuilds(r.data)).catch(() => setGuilds([])); }, []);
  const guildId = params.get('guild') || guilds?.[0]?.id || '';
  const setGuildId = id => setParams(p => { const n = new URLSearchParams(p); n.set('guild', id); return n; }, { replace: true });
  return { guilds, guildId, setGuildId };
}

function GuildPicker({ guilds, guildId, setGuildId }) {
  if (!guilds || guilds.length < 2) return null;
  return (
    <label className="block">
      <span className="text-sm text-ink-2 font-medium block mb-1">{STR.server}</span>
      <select value={guildId} onChange={e => setGuildId(e.target.value)} className={INPUT}>
        {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </label>
  );
}

const INPUT = 'w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 placeholder-ink-4 focus:outline-hidden focus:border-primary/50';

function FaqList({ entries, query }) {
  const words = normTxt(query).split(/\s+/).filter(w => w.length > 1);
  const shown = words.length ? entries.filter(e => words.every(w => normTxt(`${e.question} ${e.answer}`).includes(w))) : entries;
  if (!shown.length) return <p className="text-sm text-ink-4">{STR.faqNone}</p>;
  return (
    <ul className="space-y-2">
      {shown.map(e => (
        <li key={e.id}>
          <details className="bg-surface-card border border-overlay/6 rounded-xl px-4 py-3 group">
            <summary className="cursor-pointer text-sm font-medium text-ink-1 list-none flex items-center gap-2">
              <HelpCircle size={14} className="text-primary-light shrink-0" />{e.question}
            </summary>
            <p className="text-sm text-ink-2 mt-2 whitespace-pre-wrap"><MessageContent text={e.answer} /></p>
          </details>
        </li>
      ))}
    </ul>
  );
}

function HelpPage() {
  const { guilds, guildId, setGuildId } = useGuilds();
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!guildId) return;
    setEntries(null);
    api.get(`/member/guilds/${guildId}/faq`).then(r => setEntries(r.data)).catch(() => setEntries([]));
  }, [guildId]);
  if (!guilds) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  if (!guilds.length) return <p className="text-sm text-ink-3 py-10 text-center">{STR.noGuild}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink-1">{STR.faqTitle}</h1>
      <GuildPicker guilds={guilds} guildId={guildId} setGuildId={setGuildId} />
      <GuildBanner guild={guilds.find(g => g.id === guildId)} />
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={STR.faqSearch} placeholder={STR.faqSearch} className={`${INPUT} pl-9`} />
      </div>
      {!entries ? <Loader2 className="animate-spin text-ink-4 mx-auto" /> : entries.length ? <FaqList entries={entries} query={query} /> : <p className="text-sm text-ink-4">{STR.faqEmpty}</p>}
      <p className="text-sm text-ink-3 text-center pt-2">
        {STR.stillStuck} <Link to={`/espace/nouveau?guild=${guildId}`} className="text-primary-light underline">{STR.tabs.new}</Link>
      </p>
    </div>
  );
}

function NewTicket() {
  const navigate = useNavigate();
  const { guilds, guildId, setGuildId } = useGuilds();
  const [subjects, setSubjects] = useState(null);
  const [subject, setSubject] = useState('');
  const [form, setForm] = useState({ fields: [], questions: [] });
  const [fields, setFields] = useState({});
  const [answers, setAnswers] = useState([]);
  const [content, setContent] = useState('');
  const [faq, setFaq] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!guildId) return;
    setSubjects(null); setSubject('');
    api.get(`/member/guilds/${guildId}/form`).then(r => setSubjects(r.data.subjects)).catch(() => setSubjects([]));
    api.get(`/member/guilds/${guildId}/faq`).then(r => setFaq(r.data)).catch(() => setFaq([]));
  }, [guildId]);
  useEffect(() => {
    if (!guildId || subjects === null || (subjects.length && !subject)) { setForm({ fields: [], questions: [] }); return; }
    api.get(`/member/guilds/${guildId}/form`, { params: { subject } }).then(r => { setForm(r.data); setFields({}); setAnswers([]); }).catch(() => {});
  }, [guildId, subject, subjects]);

  // FAQ entries sharing distinctive words with the request: maybe no ticket is needed
  const words = normTxt(`${subject} ${content}`).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4);
  const suggestions = words.length ? faq.filter(e => words.filter(w => normTxt(`${e.question} ${e.answer}`).includes(w)).length >= Math.min(2, words.length)).slice(0, 3) : [];

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/member/guilds/${guildId}/tickets`, { subject, fields, answers, content: content.trim() });
      navigate(`/espace/${data.guildId}/${data.ticketId}`);
    } catch (err) { setError(err.response?.data?.error || STR.error2); }
    setBusy(false);
  };

  if (!guilds) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  if (!guilds.length) return <p className="text-sm text-ink-3 py-10 text-center">{STR.noGuild}</p>;
  const ready = content.trim() && (!subjects?.length || subject) && form.questions.every((_, i) => answers[i]?.trim()) && form.fields.every(f => !f.required || String(fields[f.id] || '').trim());

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink-1">{STR.tabs.new}</h1>
      <GuildPicker guilds={guilds} guildId={guildId} setGuildId={setGuildId} />
      <GuildBanner guild={guilds.find(g => g.id === guildId)} />
      {subjects === null ? <Loader2 className="animate-spin text-ink-4" /> : (
        <label className="block">
          <span className="text-sm text-ink-2 font-medium block mb-1">{STR.subject}</span>
          {subjects.length ? (
            <select value={subject} onChange={e => setSubject(e.target.value)} className={INPUT}>
              <option value="">—</option>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={100} placeholder={STR.subjectPh} className={INPUT} />}
        </label>
      )}
      {form.fields.map(f => (
        <label key={f.id} className="block">
          <span className="text-sm text-ink-2 font-medium block mb-1">{f.label}{!f.required && <span className="text-ink-4 font-normal"> ({STR.optional})</span>}</span>
          <input type={f.type === 'number' ? 'number' : 'text'} value={fields[f.id] || ''} onChange={e => setFields(v => ({ ...v, [f.id]: e.target.value }))} maxLength={200} className={INPUT} />
        </label>
      ))}
      <label className="block">
        <span className="text-sm text-ink-2 font-medium block mb-1">{STR.message}</span>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={5} maxLength={2000} placeholder={STR.messagePh} className={INPUT} />
      </label>
      {suggestions.length > 0 && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-2">
          <p className="text-xs font-semibold text-primary-light">{STR.maybe}</p>
          <FaqList entries={suggestions} query="" />
        </div>
      )}
      {form.questions.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink-2 mb-1">{STR.form}</legend>
          {form.questions.map((q, i) => (
            <label key={i} className="block">
              <span className="text-sm text-ink-2 block mb-1">{q}</span>
              <input value={answers[i] || ''} onChange={e => setAnswers(a => { const n = [...a]; n[i] = e.target.value; return n; })} maxLength={500} className={INPUT} />
            </label>
          ))}
        </fieldset>
      )}
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      <button onClick={submit} disabled={!ready || busy} style={accent(guilds.find(g => g.id === guildId))}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {STR.open}
      </button>
    </div>
  );
}

export default function MemberPortal({ page }) {
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
        : page === 'nouveau' ? <NewTicket />
        : page === 'aide' ? <HelpPage />
        : guildId && ticketId ? <TicketView guildId={guildId} ticketId={ticketId} me={me} />
        : <TicketList />}
    </Shell>
  );
}
