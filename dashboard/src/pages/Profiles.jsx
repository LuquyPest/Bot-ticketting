import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, Users, ArrowLeft, Pin, PinOff, MessageSquare, Trash2, Pencil, Reply, Tag, Ban, Timer, Star, Ticket, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import Badge from '../components/Badge';
import Pagination from '../components/Pagination';
import { useAuth } from '../App';
import { fmtDate } from '../utils/format';
import { fmtSeconds } from '../utils/duration';
import { confirmToast } from '../utils/confirmToast';
import MessageContent from '../components/MessageContent';
import LabelChips from '../components/LabelChips';

const input = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';

// Directory of the members who opened tickets (or have notes)
function Directory() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  useEffect(() => { setPage(1); }, [q]);
  useEffect(() => {
    const t = setTimeout(() => api.get('/profiles', { params: { q: q || undefined, page } }).then(r => setData(r.data)).catch(() => setData({ members: [], pages: 0 })), 250);
    return () => clearTimeout(t);
  }, [q, page]);
  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Profils des membres</h1>
        <p className="text-sm text-ink-3 mt-0.5">Tout ce que l'équipe sait d'un membre, d'un ticket à l'autre : ses tickets, ses étiquettes et un fil de discussion entre membres du staff.</p>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un membre" placeholder="Pseudo ou ID Discord…" className={`${input} pl-9`} />
      </div>
      {!data ? <div className="h-24 rounded-2xl bg-overlay/2.5 animate-pulse" /> : !data.members.length ? (
        <p className="text-sm text-ink-4 py-10 text-center flex flex-col items-center gap-2"><Users size={18} /> Aucun membre trouvé</p>
      ) : (
        <ul className="bg-surface-card border border-overlay/6 rounded-2xl divide-y divide-overlay/5">
          {data.members.map(m => (
            <li key={m.member_id}>
              <Link to={`/profils/${m.member_id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-overlay/2">
                <span className="w-8 h-8 rounded-full bg-primary/20 text-primary-light text-xs font-bold flex items-center justify-center">{m.tag?.[0]?.toUpperCase() || '?'}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-ink-1">{m.tag}</span> <LabelChips labels={m.labels} />
                  <span className="block text-[11px] text-ink-4 font-mono">{m.member_id}</span>
                </span>
                <span className="text-[11px] text-ink-3 text-right">
                  {m.tickets} ticket(s){m.open ? ` · ${m.open} ouvert(s)` : ''}{m.notes ? ` · ${m.notes} note(s)` : ''}
                  <span className="block text-ink-4">{fmtDate(m.last_at, { dateStyle: 'short' })}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={page} pages={data.pages} onChange={setPage} />}
    </div>
  );
}

function PostForm({ onSubmit, placeholder, initial = '', submitLabel = 'Publier', onCancel }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit(text.trim());
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000} placeholder={placeholder} aria-label={placeholder} className={input} />
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-ink-3 hover:text-ink-1">Annuler</button>}
        <button type="submit" disabled={!text.trim() || busy} className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50">{submitLabel}</button>
      </div>
    </form>
  );
}

function Post({ post, me, isFounder, canWrite, onChange, reply }) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const mine = post.author_id === me;
  const act = async (fn) => { try { const r = await fn(); onChange(r.data.posts); return true; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; } };
  const remove = async () => {
    if (!await confirmToast(post.parent_id ? 'Supprimer cette réponse ?' : 'Supprimer ce message et ses réponses ?')) return;
    act(() => api.delete(`/profiles/posts/${post.id}`));
  };
  return (
    <article className={`${reply ? 'ml-8 border-l-2 border-overlay/8 pl-3' : `rounded-2xl border ${post.pinned ? 'border-amber-500/30 bg-amber-500/5' : 'border-overlay/6 bg-surface-card'} p-4`}`}>
      <header className="flex flex-wrap items-center gap-2 text-xs">
        {post.pinned && <Pin size={12} className="text-amber-400" aria-label="Épinglé" />}
        <span className="font-semibold text-ink-1">{post.author_tag}</span>
        <span className="text-ink-4">{fmtDate(post.created_at)}{post.edited_at ? ' · modifié' : ''}</span>
        <span className="ml-auto flex items-center gap-1">
          {canWrite && !reply && (
            <button onClick={() => act(() => api.patch(`/profiles/posts/${post.id}`, { pinned: !post.pinned }))} aria-label={post.pinned ? 'Désépingler' : 'Épingler'} title={post.pinned ? 'Désépingler' : 'Épingler (affiché dans chaque ticket du membre)'} className="p-1 text-ink-4 hover:text-ink-1">
              {post.pinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
          )}
          {(mine || isFounder) && <button onClick={() => setEditing(e => !e)} aria-label="Modifier" className="p-1 text-ink-4 hover:text-ink-1"><Pencil size={12} /></button>}
          {(mine || isFounder) && <button onClick={remove} aria-label="Supprimer" className="p-1 text-ink-4 hover:text-red-400"><Trash2 size={12} /></button>}
        </span>
      </header>
      {editing
        ? <div className="mt-2"><PostForm initial={post.content} submitLabel="Enregistrer" placeholder="Message" onCancel={() => setEditing(false)}
            onSubmit={async text => { const ok = await act(() => api.patch(`/profiles/posts/${post.id}`, { content: text })); if (ok) setEditing(false); return ok; }} /></div>
        : <p className="mt-1.5 text-sm text-ink-2 whitespace-pre-wrap wrap-break-word"><MessageContent text={post.content} /></p>}
      {!reply && (
        <div className="mt-3 space-y-3">
          {post.replies.map(r => <Post key={r.id} post={r} me={me} isFounder={isFounder} canWrite={canWrite} onChange={onChange} reply />)}
          {canWrite && (replying
            ? <div className="ml-8"><PostForm placeholder="Ta réponse" submitLabel="Répondre" onCancel={() => setReplying(false)}
                onSubmit={async text => { const ok = await act(() => api.post(`/profiles/${post.member_id}/posts`, { content: text, parentId: post.id })); if (ok) setReplying(false); return ok; }} /></div>
            : <button onClick={() => setReplying(true)} className="ml-8 inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink-1"><Reply size={11} /> Répondre{post.replies.length ? ` (${post.replies.length})` : ''}</button>)}
        </div>
      )}
    </article>
  );
}

function ProfileView({ memberId }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user?.role === 'fondateur' || user?.permissions?.includes('reply_ticket');
  const [p, setP] = useState(null);
  const [posts, setPosts] = useState(null);
  const [labelInput, setLabelInput] = useState('');
  useEffect(() => {
    api.get(`/profiles/${memberId}`).then(r => setP(r.data)).catch(() => setP(false));
    api.get(`/profiles/${memberId}/posts`).then(r => setPosts(r.data)).catch(() => setPosts([]));
  }, [memberId]);
  if (p === false) return <p className="p-6 text-sm text-red-400">Profil introuvable.</p>;
  if (!p) return <div className="p-6"><Loader2 className="animate-spin text-ink-4" /></div>;

  const saveLabels = async (labels) => {
    try { const r = await api.put(`/profiles/${memberId}/labels`, { labels }); setP(x => ({ ...x, labels: r.data.labels })); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const addLabel = (e) => { e.preventDefault(); if (labelInput.trim()) { saveLabels([...p.labels, labelInput.trim()]); setLabelInput(''); } };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <button onClick={() => navigate('/profils')} className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1"><ArrowLeft size={13} /> Profils</button>
      <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-4">
          {p.avatar ? <img src={p.avatar} alt="" className="w-14 h-14 rounded-full" /> : <span className="w-14 h-14 rounded-full bg-primary/20 text-primary-light text-lg font-bold flex items-center justify-center">{(p.tag || p.username || '?')[0].toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-ink-1">{p.tag || p.username || 'Membre'}</h1>
            <p className="text-xs text-ink-4 font-mono">{p.member_id}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {p.labels.map(l => (
                <span key={l} className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/25">
                  {l}{canWrite && <button onClick={() => saveLabels(p.labels.filter(x => x !== l))} aria-label={`Retirer l'étiquette ${l}`} className="hover:text-red-400">×</button>}
                </span>
              ))}
              {canWrite && p.labels.length < 10 && (
                <form onSubmit={addLabel} className="inline-flex items-center gap-1">
                  <Tag size={11} className="text-ink-4" />
                  <input value={labelInput} onChange={e => setLabelInput(e.target.value)} maxLength={30} placeholder="Ajouter une étiquette (VIP…)" aria-label="Nouvelle étiquette"
                    className="bg-transparent border-b border-overlay/10 text-xs text-ink-1 placeholder-ink-4 w-44 focus:outline-hidden focus:border-primary/50" />
                </form>
              )}
            </div>
          </div>
          {user?.role === 'fondateur' && <Link to={`/members?id=${p.member_id}`} className="text-[11px] text-ink-3 underline hover:text-ink-1">Données RGPD</Link>}
        </div>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div><dt className="text-ink-4 flex items-center gap-1"><Ticket size={11} /> Tickets</dt><dd className="text-ink-1 font-semibold text-base">{p.stats.tickets}{p.stats.open ? <span className="text-xs text-ink-3 font-normal"> · {p.stats.open} ouvert(s)</span> : ''}</dd></div>
          <div><dt className="text-ink-4 flex items-center gap-1"><Star size={11} /> Note moyenne donnée</dt><dd className="text-ink-1 font-semibold text-base">{p.stats.ratingAvg ?? '—'}{p.stats.ratings ? <span className="text-xs text-ink-3 font-normal"> · {p.stats.ratings}</span> : ''}</dd></div>
          <div><dt className="text-ink-4 flex items-center gap-1"><Timer size={11} /> Temps passé</dt><dd className="text-ink-1 font-semibold text-base">{fmtSeconds(p.stats.timeSeconds)}</dd></div>
          <div><dt className="text-ink-4">Premier / dernier ticket</dt><dd className="text-ink-2">{fmtDate(p.stats.first, { dateStyle: 'short' })} · {fmtDate(p.stats.last, { dateStyle: 'short' })}</dd></div>
        </dl>
        {p.blacklist && <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-red-400"><Ban size={12} /> Sur la liste noire{p.blacklist.reason ? ` : ${p.blacklist.reason}` : ''}</p>}
        {p.fields.length > 0 && (
          <p className="mt-3 text-xs text-ink-3">{p.fields.map(f => <span key={f.label} className="mr-3"><span className="text-ink-4">{f.label} :</span> <span className="text-ink-1">{f.value}</span></span>)}</p>
        )}
      </section>

      <div className="grid lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 space-y-3" aria-labelledby="thread-title">
          <h2 id="thread-title" className="text-sm font-semibold text-ink-2 flex items-center gap-1.5"><MessageSquare size={14} /> Discussion de l'équipe</h2>
          {canWrite && (
            <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">
              <PostForm placeholder="Nouveau message sur ce membre (déjà remboursé, à surveiller…)"
                onSubmit={async text => { try { const r = await api.post(`/profiles/${memberId}/posts`, { content: text }); setPosts(r.data.posts); return true; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; } }} />
            </div>
          )}
          {!posts ? <div className="h-16 rounded-2xl bg-overlay/2.5 animate-pulse" /> : !posts.length
            ? <p className="text-sm text-ink-4">Aucun message pour l'instant.</p>
            : posts.map(post => <Post key={post.id} post={post} me={user?.id} isFounder={user?.role === 'fondateur'} canWrite={canWrite} onChange={setPosts} />)}
        </section>
        <section className="space-y-2" aria-labelledby="tickets-title">
          <h2 id="tickets-title" className="text-sm font-semibold text-ink-2 flex items-center gap-1.5"><Ticket size={14} /> Tickets</h2>
          <ul className="space-y-1.5">
            {p.tickets.map(t => (
              <li key={t.id}>
                <Link to={`/tickets/${t.id}`} className="flex items-center gap-2 rounded-xl border border-overlay/6 bg-surface-card px-3 py-2 text-xs hover:border-overlay/12">
                  <span className="font-mono text-ink-4">#{t.id}</span>
                  <span className="flex-1 min-w-0 truncate text-ink-1">{t.subject || '—'}</span>
                  <Badge label={t.status} variant={t.status} />
                </Link>
              </li>
            ))}
            {!p.tickets.length && <li className="text-xs text-ink-4">Aucun ticket visible.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default function Profiles() {
  const { memberId } = useParams();
  return memberId ? <ProfileView memberId={memberId} /> : <Directory />;
}
