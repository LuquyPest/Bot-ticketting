import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

// Organisations (v5.3, utils/organizations.js): contacts grouped by e-mail domain or by hand,
// with their own hours, SLA (Paramètres → Horaires → objectifs), team and account manager
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const EMPTY = { name: '', parentId: null, domains: [], teamId: null, managerId: null, calendarId: null, fields: {}, notes: '' };

function OrgForm({ initial, ctx, orgs, busy, onSave, onDelete }) {
  const [o, setO] = useState({ ...initial, domainsText: (initial.domains || []).join(', '), fieldRows: Object.entries(initial.fields || {}) });
  const set = (k, v) => setO(x => ({ ...x, [k]: v }));
  const [contacts, setContacts] = useState(null);
  const body = () => ({ name: o.name, parentId: o.parentId || null, domains: o.domainsText, teamId: o.teamId || null, managerId: o.managerId || null, calendarId: o.calendarId || null,
    fields: Object.fromEntries(o.fieldRows.filter(([k, v]) => k.trim() && String(v).trim())), notes: o.notes });
  const parents = orgs.filter(x => !x.parentId && x.id !== initial.id);
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2.5">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={o.name} onChange={e => set('name', e.target.value)} maxLength={100} placeholder="Acme" aria-label="Nom de l'organisation" className={INPUT} />
        <select value={o.parentId || ''} onChange={e => set('parentId', e.target.value ? Number(e.target.value) : null)} aria-label="Organisation parente" className={INPUT}>
          <option value="">Pas de parente</option>{parents.map(p => <option key={p.id} value={p.id}>{`Sous-organisation de ${p.name}`}</option>)}
        </select>
      </div>
      <label className="block text-[11px] font-semibold text-ink-3">Domaines d'adresse e-mail (rattachement automatique)
        <input value={o.domainsText} onChange={e => set('domainsText', e.target.value)} placeholder="acme.fr, acme.com" className={`${INPUT} mt-1 font-normal`} />
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <select value={o.teamId || ''} onChange={e => set('teamId', e.target.value ? Number(e.target.value) : null)} aria-label="Équipe de l'organisation" className={INPUT}>
          <option value="">Équipe : aucune</option>{ctx.teams.map(t => <option key={t.id} value={t.id}>{`Équipe : ${t.name}`}</option>)}
        </select>
        <select value={o.managerId || ''} onChange={e => set('managerId', e.target.value || null)} aria-label="Responsable de compte" className={INPUT}>
          <option value="">Responsable : aucun</option>{ctx.staff.map(s => <option key={s.user_id} value={s.user_id}>{`Responsable : ${s.username}`}</option>)}
        </select>
        <select value={o.calendarId || ''} onChange={e => set('calendarId', e.target.value ? Number(e.target.value) : null)} aria-label="Horaires de l'organisation" className={INPUT}>
          <option value="">Horaires : ceux de l'équipe ou de l'espace</option>{ctx.calendars.map(c => <option key={c.id} value={c.id}>{`Horaires : ${c.name}`}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-ink-3">Champs</p>
        {o.fieldRows.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <input value={k} onChange={e => set('fieldRows', o.fieldRows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="Contrat" aria-label="Nom du champ" className={`${INPUT} w-40!`} />
            <input value={v} onChange={e => set('fieldRows', o.fieldRows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} placeholder="Support Or, jusqu'au 31/12" aria-label="Valeur du champ" className={INPUT} />
            <button type="button" onClick={() => set('fieldRows', o.fieldRows.filter((_, j) => j !== i))} aria-label="Retirer le champ" className="p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
          </div>
        ))}
        {o.fieldRows.length < 20 && <button type="button" onClick={() => set('fieldRows', [...o.fieldRows, ['', '']])} className="text-[11px] text-ink-3 hover:text-ink-1 inline-flex items-center gap-1"><Plus size={11} /> Ajouter un champ</button>}
      </div>
      <textarea value={o.notes} onChange={e => set('notes', e.target.value)} rows={2} maxLength={5000} placeholder="Notes internes" aria-label="Notes" className={INPUT} />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onSave(body())} disabled={busy || !o.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />}{initial.id ? 'Enregistrer' : 'Créer l\'organisation'}
        </button>
        {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400 border border-overlay/8 inline-flex items-center gap-1.5"><Trash2 size={12} /> Supprimer</button>}
        {initial.id && <Link to={`/tickets?organization=${initial.id}`} className="text-xs text-primary-light hover:underline">{`${initial.openTickets} ticket(s) ouvert(s)`}</Link>}
        {initial.id && <button type="button" onClick={() => api.get(`/organizations/${initial.id}/contacts`).then(r => setContacts(r.data))} className="text-xs text-ink-3 hover:text-ink-1">{`${initial.contacts} contact(s)`}</button>}
      </div>
      {contacts && (
        <ul className="text-xs space-y-0.5 max-h-48 overflow-y-auto" tabIndex={0} role="region" aria-label="Contacts de l'organisation">
          {contacts.length === 0 && <li className="text-ink-4">Aucun contact.</li>}
          {contacts.map(c => <li key={c.id}><Link to={`/profils/${encodeURIComponent(c.identity)}`} className="text-ink-2 hover:underline" translate="no">{c.display_name}</Link>{c.org_manual ? <span className="text-ink-4"> · à la main</span> : null}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function Organizations() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState(null);
  const [ctx, setCtx] = useState({ teams: [], staff: [], calendars: [] });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [csv, setCsv] = useState('');
  const [key, setKey] = useState(0);
  const canManage = user?.role === 'fondateur' || user?.permissions?.includes('manage_settings');
  useEffect(() => {
    api.get('/organizations').then(r => setOrgs(r.data)).catch(() => setOrgs(false));
    Promise.all([api.get('/teams'), api.get('/tickets/staff'), api.get('/calendars')].map(p => p.catch(() => ({ data: null }))))
      .then(([t, s, c]) => setCtx({ teams: t.data || [], staff: s.data || [], calendars: c.data?.calendars || [] }));
  }, []);
  if (orgs === null) return <div className="p-6"><Loader2 size={16} className="animate-spin text-ink-4" /></div>;
  if (orgs === false) return <p className="p-6 text-sm text-ink-4">Indisponible.</p>;
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setOrgs(r.data.organizations); toast.success(ok); setAdding(false); setKey(k => k + 1); return r.data; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setBusy(false); }
  };
  const importCsv = async () => {
    const r = await run(() => api.post('/organizations/import', { csv }), 'Import terminé');
    if (r) { setCsv(''); if (r.errors.length) toast.error(r.errors.join('\n'), { duration: 8000 }); else toast.success(`${r.created} créée(s), ${r.updated} mise(s) à jour`); }
  };
  const sorted = [...orgs.filter(o => !o.parentId).flatMap(p => [p, ...orgs.filter(c => c.parentId === p.id)])];
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><Building2 size={20} className="text-primary-light" /> Organisations</h1>
        <p className="text-sm text-ink-3 mt-1">Les sociétés clientes, services ou sites de tes contacts. Un contact rejoint une organisation par le domaine de son adresse e-mail, ou à la main depuis sa fiche. Ses horaires passent avant ceux de l'équipe ; son SLA se règle dans Paramètres → Horaires (critère « organisation »).</p>
      </div>
      {!canManage && (
        <ul className="space-y-1">{sorted.map(o => <li key={o.id} className={`text-sm text-ink-2 ${o.parentId ? 'pl-4' : ''}`}><Link to={`/tickets?organization=${o.id}`} className="hover:underline">{o.name}</Link> <span className="text-xs text-ink-4">{`${o.openTickets} ticket(s) ouvert(s)`}</span></li>)}</ul>
      )}
      {canManage && sorted.map(o => (
        <div key={`${o.id}-${key}`} className={o.parentId ? 'pl-4 sm:pl-8' : ''}>
          <OrgForm initial={o} ctx={ctx} orgs={orgs} busy={busy}
            onSave={b => run(() => api.put(`/organizations/${o.id}`, b), 'Organisation enregistrée')}
            onDelete={() => window.confirm(`Supprimer l'organisation « ${o.name} » ? Ses contacts restent, sans organisation.`) && run(() => api.delete(`/organizations/${o.id}`), 'Organisation supprimée')} />
        </div>
      ))}
      {canManage && (adding
        ? <OrgForm key={`new-${key}`} initial={EMPTY} ctx={ctx} orgs={orgs} busy={busy} onSave={b => run(() => api.post('/organizations', b), 'Organisation créée')} onDelete={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="px-3 py-2 rounded-lg text-xs font-semibold border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={13} /> Nouvelle organisation</button>)}
      {canManage && (
        <section className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2">
          <h2 className="text-sm font-semibold text-ink-2 flex items-center gap-2"><Upload size={14} aria-hidden="true" /> Importer</h2>
          <p className="text-xs text-ink-3">Une organisation par ligne : <code className="px-1 rounded bg-overlay/6">nom;domaines</code> (domaines séparés par des virgules). Une organisation qui existe déjà garde ses réglages et gagne les domaines.</p>
          <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={4} placeholder={'nom;domaines\nAcme;acme.fr, acme.com\nGlobex;globex.fr'} aria-label="Organisations à importer" className={INPUT} />
          <button type="button" onClick={importCsv} disabled={busy || !csv.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Importer</button>
        </section>
      )}
    </div>
  );
}
