import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, HelpCircle, FlaskConical, Loader2, Globe, Lock, ExternalLink, ImagePlus } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';
import { useAuth } from '../App';
import FormatBar from '../components/FormatBar';

const input = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';

// Versions kept on each change of the text (v5.6), with « go back to this one »
function Revisions({ entryId, onRestored }) {
  const [list, setList] = useState(null);
  useEffect(() => { api.get(`/faq/${entryId}/revisions`).then(r => setList(Array.isArray(r.data) ? r.data : [])).catch(() => setList([])); }, [entryId]);
  if (!list?.length) return null;
  return (
    <details className="text-xs text-ink-3">
      <summary className="cursor-pointer select-none">{`Versions précédentes (${list.length})`}</summary>
      <ul className="mt-2 space-y-1.5 max-h-40 overflow-y-auto" tabIndex={0} role="region" aria-label="Versions précédentes">
        {list.map(v => (
          <li key={v.id} className="flex items-start gap-2"><span className="flex-1 truncate" title={v.answer}>{`${new Date(v.created_at).toLocaleString()} · ${v.question}`}</span>
            <button type="button" onClick={async () => { try { await api.post(`/faq/${entryId}/revisions/${v.id}/restore`); toast.success('Version rétablie'); onRestored(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } }} className="text-primary-light underline shrink-0">Revenir à celle-ci</button></li>
        ))}
      </ul>
    </details>
  );
}

// An image in the answer (utils/kbImages.js, v6): sent, then inserted where the cursor is
function ArticleImage({ entryId, onAdded }) {
  const [busy, setBusy] = useState(false);
  if (!entryId) return <p className="text-[11px] text-ink-4 mt-1">Enregistre l'article une première fois pour y ajouter des images.</p>;
  const send = async e => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error('Image trop lourde (5 Mo au plus)'); return; }
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); const { data } = await api.post(`/faq/${entryId}/images`, fd); onAdded(data.markdown); toast.success('Image ajoutée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <label className="inline-flex items-center gap-1.5 mt-1 text-xs text-ink-3 hover:text-ink-1 cursor-pointer">
      <ImagePlus size={13} aria-hidden="true" /> {busy ? 'Envoi…' : 'Ajouter une image (PNG, JPEG, GIF, WebP, 5 Mo)'}
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={send} disabled={busy} className="sr-only" />
    </label>
  );
}

function EntryModal({ entry, categories, originals = [], onClose, onSave }) {
  const [form, setForm] = useState({ question: entry?.question || '', answer: entry?.answer || '', keywords: entry?.keywords || '', category: entry?.category || '', visibility: entry?.visibility || 'members',
    status: entry?.status || 'published', organization_id: entry?.organization_id || '', team_id: entry?.team_id || '', review_at: entry?.review_at ? String(entry.review_at).slice(0, 10) : '',
    expires_at: entry?.expires_at ? String(entry.expires_at).slice(0, 10) : '', lang: entry?.lang || '', translation_of: entry?.translation_of || '' });
  const answerRef = React.useRef(null);
  const [orgs, setOrgs] = useState([]);
  const [teams, setTeams] = useState([]);
  useEffect(() => {
    api.get('/organizations').then(r => setOrgs(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    api.get('/teams').then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.question.trim() || !form.answer.trim()) return toast.error('Question et réponse requises');
    setSaving(true);
    const body = { ...form, organization_id: form.organization_id || null, team_id: form.team_id || null, review_at: form.review_at || null, expires_at: form.expires_at || null, lang: form.lang || null, translation_of: form.translation_of || null };
    try { await onSave(body); onClose(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-surface-card border border-overlay/8 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-1">{entry ? 'Modifier l\'article' : 'Nouvel article'}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-2"><X size={16} /></button>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-3">Question</span>
          <input value={form.question} onChange={e => set('question', e.target.value)} maxLength={200} placeholder="Comment changer mon mot de passe ?" className={input} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-3">Réponse (envoyée en MP, affichée dans l'espace membre et la base publique)</span>
          <FormatBar textareaRef={answerRef} value={form.answer} setValue={v => set('answer', typeof v === 'function' ? v(form.answer) : v)} />
          <textarea ref={answerRef} value={form.answer} onChange={e => set('answer', e.target.value)} maxLength={5000} rows={7} className={`${input} resize-y`} />
          <ArticleImage entryId={entry?.id} onAdded={md => {
            const el = answerRef.current; const at = el ? el.selectionStart : form.answer.length;
            set('answer', `${form.answer.slice(0, at)}${at && form.answer[at - 1] !== '\n' ? '\n' : ''}${md}\n${form.answer.slice(at)}`);
          }} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-3">Catégorie</span>
            <input value={form.category} onChange={e => set('category', e.target.value)} maxLength={80} list="faq-categories" placeholder="Compte, Facturation…" className={input} />
            <datalist id="faq-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-3">Visible par</span>
            <select value={form.visibility} onChange={e => set('visibility', e.target.value)} className={input}>
              <option value="members">Les membres connectés</option>
              <option value="public">Tout le monde (base publique)</option>
              <option value="organization">Une organisation</option>
              <option value="staff">Le staff seulement</option>
              <option value="team">Une équipe du staff</option>
            </select>
          </label>
        </div>
        {form.visibility === 'organization' && (
          <select value={form.organization_id} onChange={e => set('organization_id', e.target.value)} aria-label="Organisation qui voit l'article" className={input}>
            <option value="">Choisir l'organisation…</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {form.visibility === 'team' && (
          <select value={form.team_id} onChange={e => set('team_id', e.target.value)} aria-label="Équipe qui voit l'article" className={input}>
            <option value="">Choisir l'équipe…</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block space-y-1.5"><span className="text-xs text-ink-3">État</span>
            <select value={form.status} onChange={e => set('status', e.target.value)} className={input}><option value="published">Publié</option><option value="draft">Brouillon</option></select></label>
          <label className="block space-y-1.5"><span className="text-xs text-ink-3">À relire le</span><input type="date" value={form.review_at} onChange={e => set('review_at', e.target.value)} className={input} /></label>
          <label className="block space-y-1.5"><span className="text-xs text-ink-3">Expire le</span><input type="date" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} className={input} /></label>
          <label className="block space-y-1.5"><span className="text-xs text-ink-3">Langue</span>
            <select value={form.lang} onChange={e => set('lang', e.target.value)} className={input}><option value="">—</option>{['fr', 'en', 'es', 'de', 'it', 'pt'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
        </div>
        {originals.length > 0 && (
          <label className="block space-y-1.5"><span className="text-xs text-ink-3">Traduction de</span>
            <select value={form.translation_of} onChange={e => set('translation_of', e.target.value)} className={input}>
              <option value="">— (article original)</option>{originals.filter(o => o.id !== entry?.id).map(o => <option key={o.id} value={o.id}>{o.question}</option>)}
            </select></label>
        )}
        {entry?.id && <Revisions entryId={entry.id} onRestored={onClose} />}
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-3">Mots-clés (séparés par des virgules)</span>
          <input value={form.keywords} onChange={e => set('keywords', e.target.value)} maxLength={500} placeholder="mot de passe, mdp, connexion" className={input} />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1 hover:bg-overlay/5">Annuler</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-60">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Faq() {
  const { user } = useAuth();
  const canManage = user?.role === 'fondateur' || user?.permissions?.includes('manage_settings');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // entry, or {} for a new one
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState(null);

  const load = useCallback(() => {
    api.get('/faq').then(r => setData(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    if (editing?.id) await api.patch(`/faq/${editing.id}`, form);
    else await api.post('/faq', form);
    toast.success('Article enregistré');
    load();
  };
  const toggleEntry = async (e) => {
    try { await api.patch(`/faq/${e.id}`, { active: !e.active }); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const remove = async (e) => {
    if (!await confirmToast(`Supprimer « ${e.question} » ?`)) return;
    try { await api.delete(`/faq/${e.id}`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const togglePublic = async () => {
    try { await api.put('/faq/public', { enabled: !data.kbPublic }); load(); toast.success(data.kbPublic ? 'Page publique désactivée' : 'Page publique activée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const toggleEnabled = async () => {
    try { await api.put('/faq/enabled', { enabled: !data.enabled }); load(); toast.success(data.enabled ? 'FAQ automatique désactivée' : 'FAQ automatique activée'); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const runPreview = async () => {
    if (!sample.trim()) return;
    try { setPreview((await api.post('/faq/preview', { message: sample })).data); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  if (!data) return <div className="flex justify-center py-24"><Loader2 size={20} className="animate-spin text-ink-3" /></div>;
  const shown = data.entries.reduce((n, e) => n + e.shown_count, 0);
  const solved = data.entries.reduce((n, e) => n + e.solved_count, 0);
  const categories = [...new Set(data.entries.map(e => e.category).filter(Boolean))].sort();
  const publicCount = data.entries.filter(e => e.active && e.visibility === 'public').length;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {editing && <EntryModal entry={editing.id ? editing : null} categories={categories} originals={data.entries.filter(e => !e.translation_of)} onClose={() => { setEditing(null); load(); }} onSave={save} />}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink-1">FAQ et base de connaissances</h1>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button onClick={toggleEnabled} role="switch" aria-checked={data.enabled}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border ${data.enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-overlay/4 text-ink-3 border-overlay/8'}`}>
              {data.enabled ? 'FAQ en MP activée' : 'FAQ en MP désactivée'}
            </button>
            <button onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-primary hover:bg-primary-light">
              <Plus size={13} /> Nouvel article
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[['Articles actifs', data.entries.filter(e => e.active).length], ['Réponses proposées', shown], ['Questions résolues sans ticket', `${solved}${shown ? ` (${Math.round((solved / shown) * 100)} %)` : ''}`]].map(([label, value]) => (
          <div key={label} className="bg-overlay/3 rounded-2xl border border-overlay/6 p-4">
            <p className="text-[11px] text-ink-4">{label}</p>
            <p className="text-2xl font-bold text-ink-1 tabular-nums mt-1">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-overlay/3 rounded-2xl border border-overlay/6 p-4 flex items-center gap-3 flex-wrap">
        <Globe size={16} className="text-primary-light shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-1">Base de connaissances publique</p>
          <p className="text-xs text-ink-3 mt-0.5">
            {data.kbPublic ? `En ligne, lisible sans connexion : ${publicCount} article(s) public(s).` : 'Hors ligne. Une fois activée, les articles « Tout le monde » sont lisibles sans connexion et suggérés dans le widget.'}
          </p>
        </div>
        {data.kbPublic && (
          <a href={data.kbUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-ink-2 border border-overlay/8 hover:bg-overlay/5">
            <ExternalLink size={13} /> Ouvrir la page
          </a>
        )}
        {user?.role === 'fondateur' && (
          <button onClick={togglePublic} role="switch" aria-checked={data.kbPublic} aria-label="Base de connaissances publique"
            className={`px-3 py-2 rounded-xl text-xs font-semibold border ${data.kbPublic ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-overlay/4 text-ink-3 border-overlay/8'}`}>
            {data.kbPublic ? 'En ligne' : 'Hors ligne'}
          </button>
        )}
      </div>

      <div className="bg-overlay/3 rounded-2xl border border-overlay/6 p-4 space-y-2">
        <p className="text-xs font-semibold text-ink-2 flex items-center gap-1.5"><FlaskConical size={13} /> Tester un message de membre</p>
        <div className="flex gap-2">
          <input value={sample} onChange={e => setSample(e.target.value)} onKeyDown={e => e.key === 'Enter' && runPreview()}
            placeholder="Message" className={input} />
          <button onClick={runPreview} className="px-3 py-2 rounded-xl text-xs text-ink-2 border border-overlay/8 hover:bg-overlay/5 shrink-0">Tester</button>
        </div>
        {preview && (preview.length === 0
          ? <p className="text-[11px] text-ink-4">Aucune entrée proposée</p>
          : <ul className="text-[11px] text-ink-2 space-y-0.5">{preview.map(p => <li key={p.id}>• {p.question} <span className="text-ink-4">(score {p.score})</span></li>)}</ul>)}
      </div>

      <div className="bg-overlay/3 rounded-2xl border border-overlay/6 overflow-hidden">
        {data.entries.length === 0 ? (
          <div className="py-14 text-center text-sm text-ink-4 flex flex-col items-center gap-2">
            <HelpCircle size={20} /> Aucun article pour l'instant
          </div>
        ) : (
          <ul className="divide-y divide-overlay/5">
            {data.entries.map(e => (
              <li key={e.id} className={`px-5 py-4 flex gap-4 ${e.active ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-1 flex items-center gap-2 flex-wrap">
                    {e.question}
                    {e.status === 'draft' && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md text-amber-300 border border-amber-500/30">Brouillon</span>}
                    {e.lang && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md text-ink-3 border border-overlay/10">{e.lang.toUpperCase()}</span>}
                    {['staff', 'team', 'organization'].includes(e.visibility) && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md text-ink-3 border border-overlay/10">{{ staff: 'Staff', team: 'Équipe', organization: 'Organisation' }[e.visibility]}</span>}
                    {(e.helpful_yes > 0 || e.helpful_no > 0) && <span className="text-[10px] text-ink-4">{`👍 ${e.helpful_yes} · 👎 ${e.helpful_no}`}</span>}
                    {e.visibility === 'public'
                      ? <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md text-sky-300 border border-sky-500/30"><Globe size={10} aria-hidden="true" /> Public</span>
                      : <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-overlay/5 text-ink-3 border border-overlay/8"><Lock size={10} aria-hidden="true" /> Membres</span>}
                    {e.category && <span className="text-[10px] text-ink-3">{e.category}</span>}
                  </p>
                  <p className="text-xs text-ink-3 mt-1 line-clamp-2 whitespace-pre-wrap">{e.answer}</p>
                  <p className="text-[10px] text-ink-4 mt-1.5">
                    {e.keywords ? `Mots-clés : ${e.keywords} · ` : ''}proposée {e.shown_count} fois · a résolu {e.solved_count} question(s){e.visibility === 'public' ? ` · lue ${e.view_count} fois` : ''}
                    {!e.active && ' · désactivée'}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-start gap-1 shrink-0">
                    <button onClick={() => toggleEntry(e)} className="px-2 py-1 rounded-lg text-[11px] text-ink-3 hover:text-ink-1 hover:bg-overlay/5">
                      {e.active ? 'Désactiver' : 'Activer'}
                    </button>
                    <button onClick={() => setEditing(e)} title="Modifier" className="p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5"><Pencil size={13} /></button>
                    <button onClick={() => remove(e)} title="Supprimer" className="p-1.5 rounded-lg text-ink-3 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={13} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Insights />
    </div>
  );
}

// What readers say and look for (v5.6): comments, most useful, searches without results, to review
function Insights() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/faq/insights').then(r => setD(r.data && Array.isArray(r.data.misses) ? r.data : null)).catch(() => setD(null)); }, []);
  if (!d) return null;
  const box = 'bg-overlay/3 rounded-2xl border border-overlay/6 p-4 space-y-1.5';
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section className={box}><h2 className="text-sm font-semibold text-ink-1">Recherches sans résultat</h2>
        {d.misses.length ? d.misses.map(m => <p key={m.query} className="text-xs text-ink-2 flex justify-between gap-2"><span className="truncate">{m.query}</span><span className="text-ink-4 tabular-nums">{m.misses}</span></p>)
          : <p className="text-xs text-ink-4">Rien pour l'instant.</p>}</section>
      <section className={box}><h2 className="text-sm font-semibold text-ink-1">Avis des lecteurs</h2>
        {d.feedback.length ? d.feedback.map(f => <p key={f.id} className="text-xs text-ink-2"><span aria-hidden="true">{f.helpful ? '👍' : '👎'}</span> <span className="text-ink-4">{f.question} :</span> {f.comment}</p>)
          : <p className="text-xs text-ink-4">Aucun commentaire.</p>}</section>
      {d.review.length > 0 && <section className={box}><h2 className="text-sm font-semibold text-ink-1">À relire ou bientôt expirés</h2>
        {d.review.map(a => <p key={a.id} className="text-xs text-ink-2">{a.question}</p>)}</section>}
    </div>
  );
}
