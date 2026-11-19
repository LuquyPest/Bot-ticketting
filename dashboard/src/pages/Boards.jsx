import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Loader2, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

// Tableaux de bord (v5.6, utils/dashboards.js): boards of widgets, personal or shared
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const KINDS = { count: 'Compteur', chart: 'Courbe créés / fermés', list: 'Liste de tickets', sla: 'Objectifs SLA tenus', satisfaction: 'Satisfaction' };
const METRICS = { open: 'Tickets ouverts', unassigned: 'Ouverts sans attribution', mine: 'Mes tickets ouverts', created: 'Tickets créés', closed: 'Tickets fermés', breached: 'Objectifs SLA dépassés', waiting: 'En attente du demandeur' };
const titleOf = w => w.title || (w.kind === 'count' ? METRICS[w.metric] : KINDS[w.kind]);

function WidgetView({ w, d }) {
  if (!d) return <Loader2 size={14} className="animate-spin text-ink-4" />;
  if (d.error) return <p className="text-xs text-red-300">{d.error}</p>;
  if (d.kind === 'count') return <p className="text-3xl font-bold text-ink-1 tabular-nums">{d.count}</p>;
  if (d.kind === 'chart') return (
    <div className="h-40"><ResponsiveContainer width="100%" height="100%">
      <BarChart data={d.days.map(x => ({ ...x, day: x.day.slice(5) }))}><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={24} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="created" name="Créés" fill="#8b5cf6" /><Bar dataKey="closed" name="Fermés" fill="#10b981" /></BarChart>
    </ResponsiveContainer></div>
  );
  if (d.kind === 'list') return d.tickets.length ? (
    <ul className="text-xs space-y-1">{d.tickets.map(t => <li key={t.id}><Link to={`/tickets/${t.id}`} className="text-ink-1 hover:underline">{`#${t.id} ${t.subject || ''}`}</Link>{t.priority === 'urgent' && <span className="text-red-300"> · urgent</span>}</li>)}</ul>
  ) : <p className="text-xs text-ink-4">Aucun ticket.</p>;
  if (d.kind === 'sla') return <p className="text-sm text-ink-2">{`Prise en charge : ${d.ttoPct ?? '—'} % · Résolution : ${d.ttrPct ?? '—'} %`}<span className="block text-[11px] text-ink-4">{`${d.tickets} ticket(s) avec un objectif`}</span></p>;
  return (
    <div className="text-xs text-ink-2 space-y-1">
      <p className="text-2xl font-bold text-ink-1 tabular-nums">{d.average ?? '—'}<span className="text-sm text-ink-4"> / 5</span></p>
      <p>{`${d.count} note(s) · ${d.goodPct ?? '—'} % de 4 ou 5`}</p>
      <div className="flex items-end gap-1 h-10" aria-label="Répartition des notes" role="img">{d.distribution.map((n, i) => <div key={i} title={`${i + 1} : ${n}`} className="flex-1 bg-amber-400/70 rounded-sm" style={{ height: `${Math.max(4, (n / Math.max(...d.distribution, 1)) * 100)}%` }} />)}</div>
    </div>
  );
}

function WidgetEditor({ w, ctx, onChange, onRemove }) {
  const setF = (k, v) => onChange({ ...w, filters: { ...w.filters, [k]: v || null } });
  return (
    <div className="flex flex-wrap gap-1.5 items-center bg-overlay/3 rounded-lg p-2" role="group" aria-label={`Widget ${titleOf(w)}`}>
      <select value={w.kind} onChange={e => onChange({ ...w, kind: e.target.value, metric: e.target.value === 'count' ? (w.metric || 'open') : undefined })} aria-label="Type de widget" className={INPUT}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {w.kind === 'count' && <select value={w.metric} onChange={e => onChange({ ...w, metric: e.target.value })} aria-label="Compteur" className={INPUT}>{Object.entries(METRICS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      <input value={w.title || ''} onChange={e => onChange({ ...w, title: e.target.value })} maxLength={60} placeholder="Titre (facultatif)" aria-label="Titre du widget" className={`${INPUT} w-36`} />
      <select value={w.filters?.team || ''} onChange={e => setF('team', e.target.value ? Number(e.target.value) : null)} aria-label="Équipe" className={INPUT}><option value="">Toutes équipes</option>{ctx.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select value={w.filters?.organization || ''} onChange={e => setF('organization', e.target.value ? Number(e.target.value) : null)} aria-label="Organisation" className={INPUT}><option value="">Toutes organisations</option>{ctx.orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      <select value={w.filters?.priority || ''} onChange={e => setF('priority', e.target.value)} aria-label="Priorité" className={INPUT}><option value="">Toutes priorités</option><option value="urgent">Urgente</option><option value="normal">Normale</option><option value="low">Basse</option></select>
      <select value={w.filters?.days || 30} onChange={e => setF('days', Number(e.target.value))} aria-label="Période" className={INPUT}>{[7, 14, 30, 90, 365].map(n => <option key={n} value={n}>{`${n} jours`}</option>)}</select>
      <button type="button" onClick={onRemove} aria-label="Retirer le widget" className="ml-auto p-1 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>
    </div>
  );
}

export default function Boards() {
  const { user } = useAuth();
  const [boards, setBoards] = useState(null);
  const [current, setCurrent] = useState(null);
  const [data, setData] = useState([]);
  const [edit, setEdit] = useState(null);
  const [ctx, setCtx] = useState({ teams: [], orgs: [], mine: [] });
  useEffect(() => {
    api.get('/dashboards').then(r => { const list = Array.isArray(r.data?.boards) ? r.data.boards : []; r.data = { boards: list }; setBoards(list); setCurrent(c => c ?? r.data.boards[0]?.id ?? null); }).catch(() => setBoards([]));
    Promise.all([api.get('/teams'), api.get('/organizations'), api.get('/teams/mine')].map(p => p.catch(() => ({ data: [] }))))
      .then(([t, o, m]) => setCtx({ teams: Array.isArray(t.data) ? t.data : [], orgs: Array.isArray(o.data) ? o.data : [], mine: Array.isArray(m.data) ? m.data : [] }));
  }, []);
  const board = boards?.find(b => b.id === current) || null;
  const load = useCallback(() => {
    if (!board?.widgets.length) { setData([]); return; }
    setData([]);
    api.post('/dashboards/data', { widgets: board.widgets }).then(r => setData(Array.isArray(r.data?.data) ? r.data.data : board.widgets.map(() => ({ error: 'Indisponible' })))).catch(() => setData(board.widgets.map(() => ({ error: 'Indisponible' }))));
  }, [board]);
  useEffect(() => { load(); }, [load]);
  if (!boards) return <div className="p-6"><Loader2 size={16} className="animate-spin text-ink-4" /></div>;
  const save = async () => {
    try {
      const body = { name: edit.name, sharing: edit.sharing, teamId: edit.teamId, widgets: edit.widgets };
      const r = edit.id ? await api.put(`/dashboards/${edit.id}`, body) : await api.post('/dashboards', body);
      setBoards(r.data.boards); setCurrent(edit.id || r.data.id); setEdit(null); toast.success('Tableau enregistré');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const remove = async () => {
    if (!window.confirm(`Supprimer le tableau « ${board.name} » ?`)) return;
    try { const r = await api.delete(`/dashboards/${board.id}`); setBoards(r.data.boards); setCurrent(r.data.boards[0]?.id ?? null); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };
  const blank = () => setEdit({ name: '', sharing: 'private', teamId: null, widgets: [{ kind: 'count', metric: 'open', filters: { days: 30 } }, { kind: 'chart', filters: { days: 30 } }] });
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2 mr-auto"><LayoutDashboard size={20} className="text-primary-light" /> Tableaux de bord</h1>
        {boards.length > 0 && <select value={current || ''} onChange={e => setCurrent(Number(e.target.value))} aria-label="Tableau" className={INPUT}>{boards.map(b => <option key={b.id} value={b.id}>{`${b.name}${b.mine ? '' : ` · de ${b.ownerName || '?'}`}`}</option>)}</select>}
        {board?.mine && <button type="button" onClick={() => setEdit({ ...board })} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Pencil size={12} /> Modifier</button>}
        {board?.mine && <button type="button" onClick={remove} aria-label="Supprimer le tableau" className="p-1.5 rounded-lg border border-overlay/8 text-ink-3 hover:text-red-400"><Trash2 size={12} /></button>}
        <button type="button" onClick={blank} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white inline-flex items-center gap-1.5"><Plus size={12} /> Nouveau tableau</button>
      </div>
      {edit && (
        <section className="bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} maxLength={60} placeholder="Suivi de l'équipe" aria-label="Nom du tableau" className={`${INPUT} flex-1 min-w-40`} />
            <select value={edit.sharing} onChange={e => setEdit({ ...edit, sharing: e.target.value })} aria-label="Partage" className={INPUT}>
              <option value="private">Pour moi</option><option value="team">Avec une équipe</option>{user?.role === 'fondateur' && <option value="space">Avec tout le staff</option>}
            </select>
            {edit.sharing === 'team' && <select value={edit.teamId || ''} onChange={e => setEdit({ ...edit, teamId: Number(e.target.value) || null })} aria-label="Équipe du partage" className={INPUT}><option value="">Choisir…</option>{(user?.role === 'fondateur' ? ctx.teams : ctx.mine).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
          </div>
          {edit.widgets.map((w, i) => <WidgetEditor key={i} w={w} ctx={ctx} onChange={v => setEdit({ ...edit, widgets: edit.widgets.map((x, j) => (j === i ? v : x)) })} onRemove={() => setEdit({ ...edit, widgets: edit.widgets.filter((_, j) => j !== i) })} />)}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEdit({ ...edit, widgets: [...edit.widgets, { kind: 'count', metric: 'open', filters: { days: 30 } }] })} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-2 hover:text-ink-1 inline-flex items-center gap-1.5"><Plus size={12} /> Ajouter un widget</button>
            <button type="button" onClick={save} disabled={!edit.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-1.5"><Check size={12} /> Enregistrer le tableau</button>
            <button type="button" onClick={() => setEdit(null)} className="px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-ink-1 inline-flex items-center gap-1.5"><X size={12} /> Annuler</button>
          </div>
        </section>
      )}
      {!board && !edit && <p className="text-sm text-ink-4">Aucun tableau. Crée le tien : des compteurs, une courbe, une liste, les SLA, la satisfaction, chacun avec ses filtres.</p>}
      {board && !edit && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {board.widgets.map((w, i) => (
            <section key={i} className={`bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-2 ${w.kind === 'chart' ? 'sm:col-span-2' : ''}`} aria-label={titleOf(w)}>
              <h2 className="text-xs font-semibold text-ink-3">{titleOf(w)}</h2>
              <WidgetView w={w} d={data[i]} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
