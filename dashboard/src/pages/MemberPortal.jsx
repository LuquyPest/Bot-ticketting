import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, LogOut, Inbox, Loader2, Star, Users, Ticket, Send, Search, HelpCircle, Plus, Languages, Mail, BookOpen, Paperclip, X, FileText } from 'lucide-react';
import api from '../api';
import MessageContent from '../components/MessageContent';
import { readableText } from '../utils/color';
import { useInstanceInfo } from '../hooks/useInstanceInfo';
import { privacyHref } from './Privacy';

import { STR, MEMBER_LANG, MEMBER_LANGS, memberLocale, setMemberLang } from '../i18n/member';

// Member web space: a member signs in with Discord or with a link received by e-mail, then follows,
// answers and opens their own tickets (no staff data).
// In the six languages of the bot (i18n/member.js); the API answers in the same language.
api.defaults.headers.common['X-Member-Lang'] = MEMBER_LANG;

const fmt = d => (d ? new Date(d).toLocaleString(memberLocale, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function statusOf(t) {
  if (t.merged_into) return { label: STR.status.merged, cls: 'bg-overlay/6 text-ink-2 border-overlay/10' };
  if (t.status === 'closed') return { label: STR.status.closed, cls: 'bg-overlay/6 text-ink-2 border-overlay/10' };
  if (t.resolved_at) return { label: STR.resolvedStatus, cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' };
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
  const info = useInstanceInfo();
  return (
    <div data-no-translate lang={MEMBER_LANG} className="min-h-screen bg-base">
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
      <footer className="max-w-3xl mx-auto px-4 pb-8 flex flex-wrap items-center justify-center gap-4">
        <a href={privacyHref(info)} className="text-xs text-ink-3 underline hover:text-ink-1">{STR.privacy}</a>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-3">
          <Languages size={12} aria-hidden="true" />
          <select value={MEMBER_LANG} onChange={e => setMemberLang(e.target.value)} aria-label={STR.language}
            className="bg-transparent text-xs text-ink-2 border border-overlay/8 rounded-md px-1.5 py-0.5">
            {MEMBER_LANGS.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
          </select>
        </label>
      </footer>
    </div>
  );
}

// Sign-in: Discord and/or a link sent by e-mail, whichever the instance offers
function LoginCard({ error }) {
  const [options, setOptions] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [mailError, setMailError] = useState('');
  useEffect(() => { api.get('/member/login-options').then(r => setOptions(r.data)).catch(() => setOptions({ discord: true, email: false })); }, []);
  const sendLink = async e => {
    e.preventDefault();
    setBusy(true); setMailError('');
    try { await api.post('/member/auth/email', { email: email.trim() }); setSent(true); } catch (err) { setMailError(err.response?.data?.error || STR.error2); }
    setBusy(false);
  };
  return (
    <div className="max-w-sm mx-auto mt-16 text-center space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink-1">{STR.title}</h1>
        <p className="text-sm text-ink-3 mt-1">{STR.subtitle}</p>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{STR.error[error] || STR.error.oauth_failed}</p>}
      {!options ? <Loader2 className="animate-spin text-ink-4 mx-auto" /> : <>
        {options.discord && <>
          <a href="/api/member/auth/discord"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold text-sm transition-colors">
            {STR.login}
          </a>
          <p className="text-xs text-ink-4">{STR.loginHint}</p>
        </>}
        {options.discord && options.email && (
          <p className="flex items-center gap-3 text-xs text-ink-4"><span className="h-px flex-1 bg-overlay/8" />{STR.or}<span className="h-px flex-1 bg-overlay/8" /></p>
        )}
        {options.email && (sent ? <p className="text-sm text-emerald-400" role="status">{STR.linkSent}</p> : (
          <form onSubmit={sendLink} className="space-y-2 text-left">
            <label className="block">
              <span className="text-sm text-ink-2 font-medium block mb-1">{STR.emailLabel}</span>
              <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} className={INPUT} />
            </label>
            {mailError && <p className="text-sm text-red-400" role="alert">{mailError}</p>}
            <button type="submit" disabled={busy || !email.trim()}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} {STR.loginEmail}
            </button>
            <p className="text-xs text-ink-4 text-center">{STR.emailHint}</p>
          </form>
        ))}
        {!options.discord && !options.email && <p className="text-sm text-ink-3">{STR.noLogin}</p>}
      </>}
    </div>
  );
}

// Landing of the link received by e-mail: the token is in the fragment (#…), used once
function EmailLinkLanding() {
  const [error, setError] = useState('');
  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    api.post('/member/auth/email/verify', { token })
      .then(() => { window.location.href = '/espace'; })
      .catch(err => setError(err.response?.data?.error || STR.error2));
  }, []);
  return (
    <div className="max-w-sm mx-auto mt-16 text-center space-y-4">
      {error ? <>
        <p className="text-sm text-red-400" role="alert">{error}</p>
        <Link to="/espace" className="inline-block text-sm text-primary-light underline">{STR.newLink}</Link>
      </> : <p className="text-sm text-ink-3 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {STR.signingIn}</p>}
    </div>
  );
}

function TicketList({ me }) {
  const [groups, setGroups] = useState(null);
  useEffect(() => { api.get('/member/tickets').then(r => setGroups(r.data)).catch(() => setGroups([])); }, []);
  if (!groups) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  if (!groups.length) return (
    <div className="text-center py-16 space-y-2">
      <Inbox size={28} className="mx-auto text-ink-4" />
      <p className="text-sm text-ink-2">{STR.none}</p>
      <p className="text-xs text-ink-4">{me?.email ? STR.noneHintWeb : STR.noneHint}</p>
      <Link to="/espace/nouveau" className="inline-flex items-center gap-1.5 mt-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold"><Plus size={14} /> {STR.tabs.new}</Link>
    </div>
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-1">{STR.title}</h1>
        <p className="text-sm text-ink-3 mt-0.5">{STR.subtitle}</p>
      </div>
      {groups.map(({ guild, tickets, orgTickets = [] }) => (
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
          {/* The tickets of their organisation (v5.3), read only */}
          {orgTickets.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="text-xs font-semibold text-ink-3">{STR.orgTitle}</h3>
              <ul className="space-y-2">
                {orgTickets.map(t => (
                  <li key={t.id}>
                    <Link to={`/espace/${guild.id}/${t.id}`} className="block bg-surface-card border border-overlay/6 rounded-2xl p-4 hover:border-overlay/12 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink-1 truncate"><span className="font-mono text-ink-4 mr-1.5">#{t.id}</span>{t.subject || '—'}</p>
                          <p className="text-[11px] text-ink-4 mt-1">{STR.orgBy.replace('{name}', t.requester || '—')} · {STR.opened} {fmt(t.created_at)}</p>
                        </div>
                        <StatusBadge ticket={t} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// Files picked before sending (v5.0): a button, the chosen names, each removable
function FilePicker({ files, setFiles, rules }) {
  if (!rules?.enabled) return null;
  const max = rules.maxFiles || 5;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1 cursor-pointer">
        <Paperclip size={12} aria-hidden="true" /> {STR.attach}
        <input type="file" multiple className="sr-only" onChange={e => { setFiles(f => [...f, ...Array.from(e.target.files || [])].slice(0, max)); e.target.value = ''; }} />
      </label>
      {files.map((f, i) => (
        <span key={`${f.name}${i}`} className="inline-flex items-center gap-1 text-[11px] text-ink-2 bg-overlay/5 rounded-md px-2 py-1">
          {f.name}
          <button type="button" aria-label={`${STR.attach} : ${f.name} ✕`} onClick={() => setFiles(x => x.filter((_, j) => j !== i))} className="text-ink-4 hover:text-red-400"><X size={11} /></button>
        </span>
      ))}
      <span className="text-[11px] text-ink-4">{STR.fileHint.replace('{max}', max).replace('{mb}', rules.maxMb)}</span>
    </div>
  );
}
const sendFiles = (guildId, ticketId, content, files) => {
  const fd = new FormData();
  fd.append('content', content);
  for (const f of files) fd.append('files', f);
  return api.post(`/member/tickets/${guildId}/${ticketId}/messages`, fd);
};

// The solution proposed by the staff (v5.1): « it is solved » closes, « not yet » says what is wrong
function ResolutionBanner({ guildId, ticketId, solution, onDone }) {
  const [refusing, setRefusing] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async accept => {
    setBusy(true); setError('');
    try { await api.post(`/member/tickets/${guildId}/${ticketId}/resolution`, accept ? { accept: true } : { accept: false, comment: comment.trim() }); await onDone(); }
    catch (err) { setError(err.response?.data?.error || STR.error2); }
    setBusy(false);
  };
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3" role="region" aria-label={STR.solTitle}>
      <p className="text-sm font-semibold text-emerald-300">✅ {STR.solTitle}</p>
      {solution && <p className="text-sm text-ink-1 whitespace-pre-wrap"><MessageContent text={solution} /></p>}
      <p className="text-xs text-ink-3">{STR.resolvedHint}</p>
      {refusing && (
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={1000} aria-label={STR.resolvedRefusePh} placeholder={STR.resolvedRefusePh}
          className="w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 placeholder-ink-4 focus:outline-hidden focus:border-primary/50" />
      )}
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {!refusing ? (
          <>
            <button onClick={() => send(true)} disabled={busy} className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">{STR.solAccept}</button>
            <button onClick={() => setRefusing(true)} disabled={busy} className="px-4 py-2 rounded-lg border border-overlay/10 text-sm text-ink-2 hover:text-ink-1">{STR.resolvedRefuse}</button>
          </>
        ) : (
          <button onClick={() => send(false)} disabled={busy} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">{STR.resolvedSend}</button>
        )}
      </div>
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
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');
  const send = async () => {
    setSending(true); setReplyError('');
    try {
      if (files.length) await sendFiles(guildId, ticketId, reply.trim(), files);
      else await api.post(`/member/tickets/${guildId}/${ticketId}/messages`, { content: reply.trim() });
      setReply(''); setFiles([]);
      await load();
    } catch (err) { setReplyError(err.response?.data?.error || STR.error2); }
    setSending(false);
  };
  if (error) return <p className="text-sm text-ink-3 py-10 text-center">{STR.notFound} <Link to="/espace" className="underline">{STR.back}</Link></p>;
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  const { guild, ticket: t, messages } = data;
  const readOnly = data.access === 'org'; // a ticket of their organisation (v5.3): read only
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
            {t.confidential && <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-red-400">🔒 {STR.confidentialBadge}</p>}
            <p className="text-[11px] text-ink-4 mt-1">{STR.opened} {fmt(t.created_at)}{t.closed_at ? ` · ${STR.closed} ${fmt(t.closed_at)}` : ''}{readOnly && t.requester ? ` · ${STR.orgBy.replace('{name}', t.requester)}` : ''}</p>
          </div>
          <StatusBadge ticket={t} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {t.rating && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-2" aria-label={`${STR.rating} : ${t.rating}/5`}>
              {STR.rating} {[1, 2, 3, 4, 5].map(i => <Star key={i} size={12} className={i <= t.rating ? 'text-amber-400 fill-amber-400' : 'text-ink-4'} />)}
            </span>
          )}
          {!readOnly && <a href={`/api/member/tickets/${guildId}/${ticketId}/transcript?lang=${MEMBER_LANG}`}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1 hover:border-overlay/15">
            <Download size={12} /> {STR.transcript}
          </a>}
        </div>
        {readOnly && <p className="text-xs text-ink-3" role="note">{STR.orgReadOnly}</p>}
      </div>

      {!readOnly && t.status === 'open' && t.resolved_at && <ResolutionBanner guildId={guildId} ticketId={ticketId} solution={t.resolution} onDone={load} />}
      {data.files?.length > 0 && (
        <div className="bg-surface-card border border-overlay/6 rounded-2xl p-3">
          <p className="text-xs font-semibold text-ink-2 mb-2">{STR.files}</p>
          <ul className="flex flex-wrap gap-2">
            {data.files.map(f => (
              <li key={f.id}><a href={`/api/member/tickets/${guildId}/${ticketId}/files/${f.id}`} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1">
                <FileText size={12} aria-hidden="true" /> {f.filename}
              </a></li>
            ))}
          </ul>
        </div>
      )}
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
      {readOnly ? null : t.status === 'open' && !t.merged_into ? (
        <div className="bg-surface-card border border-overlay/6 rounded-2xl p-3 space-y-2">
          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} maxLength={2000} aria-label={STR.replyPh} placeholder={STR.replyPh}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && (reply.trim() || files.length)) send(); }}
            className="w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 placeholder-ink-4 focus:outline-hidden focus:border-primary/50 resize-y" />
          <FilePicker files={files} setFiles={setFiles} rules={data.upload} />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-ink-4">{me?.email ? STR.replyWeb : STR.reply}</p>
            {replyError && <p className="text-xs text-red-400" role="alert">{replyError}</p>}
            <button onClick={send} disabled={(!reply.trim() && !files.length) || sending} style={accent(guild)}
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
              {e.category && <span className="ml-auto text-[11px] font-normal text-ink-3">{e.category}</span>}
            </summary>
            <p className="text-sm text-ink-2 mt-2 whitespace-pre-wrap"><MessageContent text={e.answer} /></p>
          </details>
        </li>
      ))}
    </ul>
  );
}

function HelpPage({ me }) {
  const { guilds, guildId, setGuildId } = useGuilds();
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!guildId) return;
    setEntries(null);
    api.get(`/member/guilds/${guildId}/faq`).then(r => setEntries(r.data)).catch(() => setEntries([]));
  }, [guildId]);
  if (!guilds) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  if (!guilds.length) return <p className="text-sm text-ink-3 py-10 text-center">{me?.email ? STR.noGuildWeb : STR.noGuild}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink-1">{STR.faqTitle}</h1>
      <GuildPicker guilds={guilds} guildId={guildId} setGuildId={setGuildId} />
      <GuildBanner guild={guilds.find(g => g.id === guildId)} />
      {guilds.find(g => g.id === guildId)?.kb && (
        <Link to={`/aide/${guildId}`} className="inline-flex items-center gap-1.5 text-sm text-primary-light underline"><BookOpen size={14} aria-hidden="true" /> {STR.kbLink}</Link>
      )}
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

function NewTicket({ me }) {
  const navigate = useNavigate();
  const { guilds, guildId, setGuildId } = useGuilds();
  const [subjects, setSubjects] = useState(null);
  const [subject, setSubject] = useState('');
  const [form, setForm] = useState({ fields: [], questions: [] });
  const [fields, setFields] = useState({});
  const [answers, setAnswers] = useState([]);
  const [content, setContent] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [newFiles, setNewFiles] = useState([]);
  const [uploadRules, setUploadRules] = useState(null);
  const [faq, setFaq] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!guildId) return;
    setSubjects(null); setSubject('');
    api.get(`/member/guilds/${guildId}/form`).then(r => { setSubjects(r.data.subjects); setUploadRules(r.data.upload || null); }).catch(() => setSubjects([]));
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
      const { data } = await api.post(`/member/guilds/${guildId}/tickets`, { subject, fields, answers, content: content.trim(), confidential });
      // The files follow the opening, as a second message
      if (newFiles.length) await sendFiles(data.guildId, data.ticketId, '', newFiles).catch(() => null);
      navigate(`/espace/${data.guildId}/${data.ticketId}`);
    } catch (err) { setError(err.response?.data?.error || STR.error2); }
    setBusy(false);
  };

  if (!guilds) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>;
  if (!guilds.length) return <p className="text-sm text-ink-3 py-10 text-center">{me?.email ? STR.noGuildWeb : STR.noGuild}</p>;
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
      <FilePicker files={newFiles} setFiles={setNewFiles} rules={uploadRules} />
      <label className="flex items-start gap-2 text-sm text-ink-2 rounded-xl border border-overlay/8 p-3">
        <input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)} className="mt-1" />
        <span>🔒 {STR.confidential}</span>
      </label>
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

  if (page === 'connexion') return <Shell me={null} onLogout={logout}><EmailLinkLanding /></Shell>;
  if (me === undefined) return <div data-no-translate className="min-h-screen bg-base flex items-center justify-center"><Loader2 className="animate-spin text-ink-4" /></div>;
  return (
    <Shell me={me} onLogout={logout}>
      {!me ? <LoginCard error={params.get('error')} />
        : page === 'nouveau' ? <NewTicket me={me} />
        : page === 'aide' ? <HelpPage me={me} />
        : guildId && ticketId ? <TicketView guildId={guildId} ticketId={ticketId} me={me} />
        : <TicketList me={me} />}
    </Shell>
  );
}
