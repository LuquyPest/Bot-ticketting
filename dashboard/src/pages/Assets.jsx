import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Server, Loader2, Plus, Trash2, Settings2, X } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import { uiLocale } from '../i18n';

// Parc (v7, utils/assets.js): the elements of the space (computers, servers, software, licences,
// services…), their types and fields, their relations and history
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
export const ASSET_STATUS = { in_use: 'En service', in_stock: 'En stock', maintenance: 'En maintenance', retired: 'Retiré' };
export const ASSET_RELATIONS = { depends_on: ['Dépend de', 'Nécessaire à'], installed_on: ['Installé sur', 'Héberge'], part_of: ['Fait partie de', 'Comprend'] };
const FIELD_TYPES = { text: 'Texte', number: 'Nombre', date: 'Date', choice: 'Choix' };

function TypesEditor({ types, onChange }) {
  const [editing, setEditing] = useState(null);
  const save = async t => {
    try {
      const body = { name: t.name, icon: t.icon, fields: t.fields.map(f => ({ ...f, options: f.type === 'choice' ? String(f.optionsText ?? (f.options || []).join(', ')) : undefined })) };
      const r = t.id ? await api.put(`/assets/types/${t.id}`, body) : await api.post('/assets/types', body);
      onChange(r.data.types); setEditing(null); toast.success('Type enregistré');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const del = async t => { if (!window.confirm(`Supprimer le type « ${t.name} » ?`)) return; try { onChange((await api.delete(`/assets/types/${t.id}`)).data.types); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const e = editing;
  const setE = (k, v) => setEditing(x => ({ ...x, [k]: v }));
  const setF = (i, k, v) => setEditing(x => ({ ...x, fields: x.fields.map((f, j) => (j === i ? { ...f, [k]: v } : f)) }));
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {types.map(t => (
          <li key={t.id} className="inline-flex items-center gap-1 rounded-lg border border-overlay/8 px-2 py-1 text-xs">
            <button type="button" onClick={() => setEditing({ ...t, fields: t.fields.map(f => ({ ...f, optionsText: (f.options || []).join(', ') })) })} className="text-ink-1 hover:underline">{`${t.icon ? `${t.icon} ` : ''}${t.name}`}</button>
            <span className="text-ink-4">{`· ${t.count}`}</span>
            <button type="button" onClick={() => del(t)} aria-label={`Supprimer le type « ${t.name} »`} className="text-ink-4 hover:text-red-400"><Trash2 size={11} /></button>
          </li>
        ))}
        <li><button type="button" onClick={() => setEditing({ name: '', icon: '', fields: [] })} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-ink-3 hover:text-ink-1"><Plus size={11} /> Nouveau type</button></li>
      </ul>
      {e && (
        <div className="rounded-xl border border-overlay/8 p-3 space-y-2">
          <div className="flex gap-2">
            <input value={e.icon || ''} onChange={x => setE('icon', x.target.value)} maxLength={8} placeholder="💻" aria-label="Icône du type" className={`${INPUT} w-14!`} />
            <input value={e.name} onChange={x => setE('name', x.target.value)} maxLength={60} placeholder="Ordinateur portable" aria-label="Nom du type" className={INPUT} />
          </div>
          {e.fields.map((f, i) => (
            <div key={i} className="flex flex-wrap gap-1.5">
              <input value={f.label} onChange={x => setF(i, 'label', x.target.value)} maxLength={60} placeholder="Processeur" aria-label="Nom du champ" className={`${INPUT} w-40!`} />
              <select value={f.type} onChange={x => setF(i, 'type', x.target.value)} aria-label="Type du champ" className={`${INPUT} w-28!`}>{Object.entries(FIELD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {f.type === 'choice' && <input value={f.optionsText || ''} onChange={x => setF(i, 'optionsText', x.target.value)} placeholder="Windows, macOS, Linux" aria-label="Choix, séparés par des virgules" className={`${INPUT} flex-1`} />}
              <button type="button" onClick={() => setEditing(x => ({ ...x, fields: x.fields.filter((_, j) => j !== i) }))} aria-label="Retirer le champ" className="p-1 text-ink-4 hover:text-red-400"><X size={12} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setEditing(x => ({ ...x, fields: [...x.fields, { label: '', type: 'text' }] }))} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter un champ</button>
          <div className="flex gap-2">
            <button type="button" onClick={() => save(e)} disabled={!e.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Enregistrer le type</button>
            <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 border border-overlay/8">Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetForm({ asset, types, ctx, onSaved, onDeleted }) {
  const [a, setA] = useState(() => ({ typeId: asset?.typeId || types[0]?.id || '', name: asset?.name || '', status: asset?.status || 'in_use', serial: asset?.serial || '', location: asset?.location || '',
    ownerContactId: asset?.ownerContactId || '', ownerOrgId: asset?.ownerOrgId || '', fields: asset?.fields || {}, notes: asset?.notes || '' }));
  const set = (k, v) => setA(x => ({ ...x, [k]: v }));
  const type = types.find(t => t.id === Number(a.typeId));
  const save = async () => {
    try {
      const body = { ...a, typeId: Number(a.typeId), ownerContactId: a.ownerContactId || null, ownerOrgId: a.ownerOrgId || null };
      const r = asset ? await api.put(`/assets/${asset.id}`, body) : await api.post('/assets', body);
      toast.success('Élément enregistré'); onSaved(r.data);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={a.name} onChange={e => set('name', e.target.value)} maxLength={150} placeholder="PC-COMPTA-07" aria-label="Nom de l'élément" className={`${INPUT} text-sm font-semibold`} />
        <select value={a.typeId} onChange={e => set('typeId', e.target.value)} aria-label="Type de l'élément" className={INPUT}>{types.map(t => <option key={t.id} value={t.id}>{`${t.icon ? `${t.icon} ` : ''}${t.name}`}</option>)}</select>
        <select value={a.status} onChange={e => set('status', e.target.value)} aria-label="Statut de l'élément" className={INPUT}>{Object.entries(ASSET_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input value={a.serial} onChange={e => set('serial', e.target.value)} maxLength={100} placeholder="N° de série" aria-label="Numéro de série" className={INPUT} />
        <input value={a.location} onChange={e => set('location', e.target.value)} maxLength={200} placeholder="Lieu (bâtiment, bureau…)" aria-label="Lieu" className={INPUT} />
        <select value={a.ownerOrgId || ''} onChange={e => set('ownerOrgId', e.target.value ? Number(e.target.value) : '')} aria-label="Organisation propriétaire" className={INPUT}>
          <option value="">Organisation : aucune</option>{ctx.orgs.map(o => <option key={o.id} value={o.id}>{`Organisation : ${o.name}`}</option>)}
        </select>
        <input value={a.ownerContactId || ''} onChange={e => set('ownerContactId', e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="N° de fiche contact du propriétaire" aria-label="Fiche contact du propriétaire" className={INPUT} />
      </div>
      {type?.fields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {type.fields.map(f => (
            <label key={f.key} className="text-[11px] text-ink-3">{f.label}
              {f.type === 'choice'
                ? <select value={a.fields[f.key] ?? ''} onChange={e => set('fields', { ...a.fields, [f.key]: e.target.value })} className={`${INPUT} mt-0.5`}><option value="">—</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
                : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={a.fields[f.key] ?? ''} onChange={e => set('fields', { ...a.fields, [f.key]: e.target.value })} className={`${INPUT} mt-0.5`} />}
            </label>
          ))}
        </div>
      )}
      <textarea value={a.notes} onChange={e => set('notes', e.target.value)} rows={2} maxLength={5000} placeholder="Notes" aria-label="Notes de l'élément" className={INPUT} />
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={!a.name.trim() || !a.typeId} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">{asset ? 'Enregistrer' : 'Créer l\'élément'}</button>
        {asset && <button type="button" onClick={onDeleted} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1"><Trash2 size={12} /> Supprimer</button>}
      </div>
    </div>
  );
}

function Detail({ id, types, ctx, onChanged }) {
  const navigate = useNavigate();
  const [a, setA] = useState(null);
  const [rel, setRel] = useState({ to: '', kind: 'depends_on' });
  useEffect(() => { api.get(`/assets/${id}`).then(r => setA(r.data)).catch(() => setA(false)); }, [id]);
  if (a === null) return <Loader2 size={16} className="animate-spin text-ink-4" />;
  if (!a) return <p className="text-sm text-ink-4">Élément introuvable.</p>;
  const relate = async () => { try { setA((await api.post(`/assets/${id}/relations`, { to: Number(rel.to), kind: rel.kind })).data); setRel(r => ({ ...r, to: '' })); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const unrelate = async r => { const [from, to] = r.direction === 'out' ? [id, r.id] : [r.id, id]; try { await api.delete(`/assets/${from}/relations/${to}/${r.kind}`); setA((await api.get(`/assets/${id}`)).data); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const del = async () => { if (!window.confirm(`Supprimer « ${a.name} » ?`)) return; try { await api.delete(`/assets/${id}`); onChanged(); navigate('/parc'); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  return (
    <div className="space-y-4">
      <AssetForm key={a.updatedAt} asset={a} types={types} ctx={ctx} onSaved={d => { setA(d); onChanged(); }} onDeleted={del} />
      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold text-ink-3">Relations</p>
        {a.relations.length === 0 && <p className="text-xs text-ink-4">Aucune relation.</p>}
        <ul className="space-y-1">
          {a.relations.map(r => (
            <li key={`${r.direction}-${r.id}-${r.kind}`} className="flex items-center gap-1.5 text-xs">
              <span className="text-ink-4 w-28 shrink-0">{ASSET_RELATIONS[r.kind]?.[r.direction === 'out' ? 0 : 1]}</span>
              <Link to={`/parc/${r.id}`} className="text-ink-1 hover:underline truncate">{r.name}</Link>
              <span className="text-ink-4">{`· ${r.typeName}`}</span>
              <button type="button" onClick={() => unrelate(r)} aria-label={`Retirer la relation avec « ${r.name} »`} className="ml-auto text-ink-4 hover:text-red-400"><X size={11} /></button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          <select value={rel.kind} onChange={e => setRel(r => ({ ...r, kind: e.target.value }))} aria-label="Relation" className={`${INPUT} w-36!`}>{Object.entries(ASSET_RELATIONS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <input value={rel.to} onChange={e => setRel(r => ({ ...r, to: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" placeholder="N° de l'élément" aria-label="Numéro de l'élément à relier" className={`${INPUT} w-32!`} />
          <button type="button" disabled={!rel.to} onClick={relate} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50">Relier</button>
        </div>
      </section>
      {a.linked && (a.linked.tickets.length + a.linked.problems.length + a.linked.changes.length) > 0 && (
        <section className="space-y-1">
          <p className="text-[11px] font-semibold text-ink-3">Lié à</p>
          <ul className="space-y-0.5 text-xs">
            {a.linked.tickets.map(t => <li key={`t${t.id}`}><Link to={`/tickets/${t.id}`} className="text-ink-1 hover:underline">{`Ticket #${t.id} ${t.subject || ''}`}</Link> <span className="text-ink-4">{t.status === 'open' ? '· ouvert' : '· fermé'}</span></li>)}
            {a.linked.problems.map(p => <li key={`p${p.id}`}><Link to={`/problemes/${p.id}`} className="text-ink-1 hover:underline">{`Problème #${p.id} ${p.title}`}</Link></li>)}
            {a.linked.changes.map(c => <li key={`c${c.id}`}><Link to={`/changements/${c.id}`} className="text-ink-1 hover:underline">{`Changement #${c.id} ${c.title}`}</Link></li>)}
          </ul>
        </section>
      )}
      <section className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">Historique</p>
        <div className="max-h-48 overflow-y-auto" tabIndex={0} role="region" aria-label="Historique de l'élément">
          <ul className="space-y-0.5 text-[11px] text-ink-3">
            {a.history.map((h, i) => <li key={i}>{`${new Date(h.at).toLocaleString(uiLocale())} · ${h.by} · ${Object.entries(h.changes).map(([k, v]) => `${k} : ${v}`).join(', ')}`}</li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}

export default function Assets() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(null);
  const [types, setTypes] = useState([]);
  const [list, setList] = useState(null);
  const [filters, setFilters] = useState({ q: '', type: '', status: '' });
  const [ctx, setCtx] = useState({ orgs: [] });
  const [adding, setAdding] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  const [csv, setCsv] = useState('');
  const load = (f = filters) => api.get('/assets', { params: { q: f.q || undefined, type: f.type || undefined, status: f.status || undefined } }).then(r => setList(r.data)).catch(() => setList({ total: 0, assets: [] }));
  const loadTypes = () => api.get('/assets/types').then(r => setTypes(r.data.types || [])).catch(() => {});
  useEffect(() => {
    api.get('/assets/settings').then(r => { setEnabled(r.data.enabled); if (r.data.enabled) { load(); loadTypes(); } }).catch(() => setEnabled(false));
    api.get('/organizations').then(r => setCtx({ orgs: Array.isArray(r.data) ? r.data : [] })).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (enabled === null) return <div className="p-6"><Loader2 size={16} className="animate-spin text-ink-4" /></div>;
  const toggle = async on => { await api.put('/assets/settings', { enabled: on }); setEnabled(on); if (on) { load(); loadTypes(); } };
  if (!enabled) return (
    <div className="p-6 space-y-3 max-w-2xl">
      <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Server size={20} className="text-primary-light" /> Parc</h1>
      <p className="text-sm text-ink-3">Le parc recense les éléments de l'espace — ordinateurs, serveurs, logiciels, licences, services — avec leurs champs, leur propriétaire, leur lieu et leurs relations, et les relie aux tickets, problèmes et changements. Coupé tant que l'espace ne l'active pas.</p>
      {user?.role === 'fondateur' ? <button type="button" onClick={() => toggle(true)} className="px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-white">Activer le parc</button>
        : <p className="text-xs text-ink-4">Un fondateur peut l'activer.</p>}
    </div>
  );
  const setFilter = (k, v) => { const f = { ...filters, [k]: v }; setFilters(f); load(f); };
  const importCsv = async () => {
    try {
      const { data } = await api.post('/assets/import', { csv });
      setCsv(''); load(); loadTypes();
      toast.success(`${data.created} créé(s), ${data.updated} mis à jour`);
      if (data.errors.length) toast.error(data.errors.slice(0, 10).join('\n'), { duration: 8000 });
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  return (
    <div className="p-4 sm:p-6 grid gap-4 lg:grid-cols-[24rem_1fr]">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Server size={20} className="text-primary-light" /> Parc</h1>
          <button type="button" onClick={() => setShowTypes(s => !s)} aria-expanded={showTypes} className="ml-auto text-xs text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Settings2 size={12} /> Types</button>
        </div>
        {showTypes && <TypesEditor types={types} onChange={setTypes} />}
        <input value={filters.q} onChange={e => setFilter('q', e.target.value)} placeholder="Nom, n° de série, lieu…" aria-label="Rechercher un élément" className={INPUT} />
        <div className="grid grid-cols-2 gap-1.5">
          <select value={filters.type} onChange={e => setFilter('type', e.target.value)} aria-label="Filtrer par type" className={INPUT}><option value="">Tous les types</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select value={filters.status} onChange={e => setFilter('status', e.target.value)} aria-label="Filtrer par statut" className={INPUT}><option value="">Tous les statuts</option>{Object.entries(ASSET_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        {types.length > 0 && <button type="button" onClick={() => { setAdding(true); navigate('/parc'); }} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouvel élément</button>}
        {!types.length && <p className="text-xs text-ink-4">Crée d'abord un type d'élément (Types).</p>}
        {!list ? <Loader2 size={16} className="animate-spin text-ink-4" /> : (
          <>
            <p className="text-[11px] text-ink-4">{`${list.total} élément(s)`}</p>
            <ul className="space-y-1.5">
              {list.assets.map(a => (
                <li key={a.id}><Link to={`/parc/${a.id}`} onClick={() => setAdding(false)} className={`block rounded-xl border px-3 py-2 ${String(a.id) === id ? 'border-primary/40 bg-primary/5' : 'border-overlay/6 bg-surface-card hover:border-overlay/12'}`}>
                  <p className="text-sm text-ink-1 truncate">{`${a.typeIcon ? `${a.typeIcon} ` : ''}${a.name}`} <span className="text-ink-4 text-[11px] font-mono">{`#${a.id}`}</span></p>
                  <p className="text-[11px] text-ink-4">{[a.typeName, ASSET_STATUS[a.status], a.ownerOrgName, a.location].filter(Boolean).join(' · ')}</p>
                </Link></li>
              ))}
            </ul>
          </>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-3 hover:text-ink-1">Importer ou exporter (CSV)</summary>
          <div className="mt-2 space-y-1.5">
            <a href="/api/assets/export.csv" className="inline-block text-primary-light hover:underline">Exporter le parc (CSV)</a>
            <p className="text-ink-4">Colonnes : type ; nom ; statut ; numero_de_serie ; lieu ; organisation ; contact (adresse) ; les champs du type par leur nom ; notes. Un élément de même numéro de série (sinon de même type et nom) est mis à jour.</p>
            <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={4} placeholder={'type;nom;numero_de_serie;lieu\nPortable;PC-COMPTA-07;SN-123;Bât. A'} aria-label="Éléments à importer (CSV)" className={INPUT} />
            <button type="button" disabled={!csv.trim()} onClick={importCsv} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Importer</button>
          </div>
        </details>
        {user?.role === 'fondateur' && <button type="button" onClick={() => toggle(false)} className="text-[11px] text-ink-4 hover:text-ink-2 underline">Couper le parc</button>}
      </div>
      <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">
        {adding && !id ? <AssetForm types={types} ctx={ctx} onSaved={d => { setAdding(false); load(); loadTypes(); navigate(`/parc/${d.id}`); }} />
          : id ? <Detail key={id} id={id} types={types} ctx={ctx} onChanged={() => { load(); loadTypes(); }} /> : <p className="text-sm text-ink-4">Choisis un élément.</p>}
      </div>
    </div>
  );
}
