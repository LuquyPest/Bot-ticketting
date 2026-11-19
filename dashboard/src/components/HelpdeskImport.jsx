import React, { useState } from 'react';
import { Loader2, Upload, FlaskConical } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Paramètres → Sauvegarde → Importer depuis un autre outil (v5.7, utils/helpdeskImport.js)
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const SOURCES = [['zendesk', 'Zendesk'], ['freshdesk', 'Freshdesk'], ['glpi', 'GLPI'], ['osticket', 'osTicket'], ['zammad', 'Zammad'], ['generic', 'Autre (CSV ou JSON)'], ['ldap', 'Annuaire LDAP / AD (contacts)']];
const KINDS = [['tickets', 'Tickets (et leurs conversations)'], ['contacts', 'Contacts'], ['organizations', 'Organisations'], ['articles', 'Articles de la base']];
const LABELS = { id: 'Identifiant', subject: 'Sujet', email: 'Demandeur', name: 'Nom', status: 'Statut', priority: 'Priorité', organization: 'Organisation', created: 'Créé le', question: 'Titre', category: 'Catégorie' };

export default function HelpdeskImport() {
  const [source, setSource] = useState('zendesk');
  const [kind, setKind] = useState('tickets');
  const [text, setText] = useState('');
  const [format, setFormat] = useState('csv');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const pickFile = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error('Fichier trop gros (10 Mo au plus : découpe l\'export)'); return; }
    setText(await f.text()); setFileName(f.name); setFormat(/\.(json|ndjson|jsonl)$/i.test(f.name) ? 'json' : 'csv'); setResult(null);
  };
  const run = async dryRun => {
    setBusy(true);
    try { const r = source === 'ldap' ? await api.post('/imports/directory', { dryRun }) : await api.post('/imports', { source, kind, format, text, dryRun }); setResult(r.data); if (!dryRun) toast.success(`${r.data.created} importé(s), ${r.data.skipped} déjà là`); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-ink-3">Exporte tes données depuis l'autre outil (CSV ou JSON), puis importe-les ici : tickets avec leur conversation quand l'export l'a, contacts, organisations, articles (en brouillon). Un export déjà importé n'est pas repris deux fois.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={source} onChange={e => { setSource(e.target.value); setResult(null); }} aria-label="Outil d'origine" className={INPUT}>{SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {source !== 'ldap' && <>
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Ce qu'on importe" className={INPUT}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1 cursor-pointer">
          <Upload size={12} aria-hidden="true" /> {fileName || 'Choisir le fichier'}
          <input type="file" accept=".csv,.json,.ndjson,.jsonl,.txt" onChange={pickFile} className="sr-only" />
        </label>
        <select value={format} onChange={e => setFormat(e.target.value)} aria-label="Format" className={INPUT}><option value="csv">CSV</option><option value="json">JSON</option></select>
        </>}
      </div>
      {source === 'ldap' && <p className="text-xs text-ink-3">Les personnes de l'annuaire réglé dans Instance → Connexion (propriétaire de l'instance) deviennent des contacts, rattachés à leur organisation.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => run(true)} disabled={busy || (source !== 'ldap' && !text)} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />} Essai à blanc
        </button>
        <button type="button" onClick={() => run(false)} disabled={busy || (source !== 'ldap' && !text) || !result?.dryRun} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Importer</button>
      </div>
      {result && (
        <div className="text-xs rounded-lg border border-overlay/8 p-2 space-y-1" role="status">
          <p className="text-ink-1">{`${result.rows} ligne(s) lue(s) · ${result.created} ${result.dryRun ? 'à importer' : 'importée(s)'} · ${result.skipped} déjà importée(s)`}</p>
          {Object.keys(result.preview || {}).length > 0 && <p className="text-ink-3">{`Première ligne comprise : ${Object.entries(result.preview).map(([k, v]) => `${LABELS[k] || k} = ${v}`).join(' · ')}`}</p>}
          {result.errors.map((e, i) => <p key={i} className="text-red-300">{e}</p>)}
        </div>
      )}
    </div>
  );
}
