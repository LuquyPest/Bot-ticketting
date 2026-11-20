import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox as InboxIcon, Keyboard, Loader2, RefreshCw } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';
import TicketDetail from './TicketDetail';
import ShortcutsHelp from '../components/ShortcutsHelp';

// Boîte d'équipe (v8, conception/v8.md §3.4): the open tickets of one or more teams in columns —
// not taken, mine, waiting, late on the SLA — with the ticket on the right and keyboard moves:
// h / l change column, j / k move, Entrée shows, a takes it, o opens the full page, ? the help.
const COLUMNS = [
  ['unassigned', 'Non pris', t => !(t.assignees || []).length],
  ['mine', 'À moi', (t, me) => (t.assignees || []).some(a => String(a.user_id) === String(me))],
  ['waiting', 'En attente', t => t.stage === 'waiting'],
  ['late', 'En retard', t => (t.reasons || []).some(r => r.type === 'breached')],
];
const PRIORITY = { urgent: 'text-red-400', normal: 'text-ink-3', low: 'text-ink-4' };

export default function Inbox() {
  const { user } = useAuth();
  const isFounder = user?.role === 'fondateur';
  const [teams, setTeams] = useState([]);
  const [chosen, setChosen] = useState(() => { try { return JSON.parse(localStorage.getItem('inboxTeams') || '[]'); } catch { return []; } });
  const [tickets, setTickets] = useState(null);
  const [cursor, setCursor] = useState({ col: 0, row: 0 });
  const [openId, setOpenId] = useState(null);
  const [help, setHelp] = useState(false);
  useEffect(() => { api.get(isFounder ? '/teams' : '/teams/mine').then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {}); }, [isFounder]);
  const load = useCallback(() => {
    api.get('/tickets/queue', { params: { scope: 'team', ...(chosen.length ? { teams: chosen.join(',') } : {}) } })
      .then(r => setTickets(Array.isArray(r.data?.tickets) ? r.data.tickets : [])).catch(err => { setTickets([]); toast.error(err.response?.data?.error || 'Erreur'); });
  }, [chosen]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { localStorage.setItem('inboxTeams', JSON.stringify(chosen)); } catch { /* private mode */ } }, [chosen]);
  const cols = useMemo(() => COLUMNS.map(([key, label, test]) => ({ key, label, items: (tickets || []).filter(t => test(t, user?.id)) })), [tickets, user?.id]);
  const current = cols[cursor.col]?.items[cursor.row];
  const take = useCallback(async t => {
    if (!t) return;
    try { await api.post(`/tickets/${t.id}/assignees`, { user_id: user.id }); toast.success('Tu es assigné au ticket'); load(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }, [user?.id, load]);
  useEffect(() => {
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (openId && document.activeElement?.closest?.('[data-inbox-preview]')) return;
      const move = (dc, dr) => setCursor(c => {
        const col = Math.max(0, Math.min(cols.length - 1, c.col + dc));
        const n = cols[col].items.length;
        return { col, row: n ? Math.max(0, Math.min(n - 1, (dc ? Math.min(c.row, n - 1) : c.row + dr))) : 0 };
      });
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(0, 1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(0, -1); }
      else if (e.key === 'l' || e.key === 'ArrowRight') { e.preventDefault(); move(1, 0); }
      else if (e.key === 'h' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1, 0); }
      else if (e.key === 'Enter' && current) { e.preventDefault(); setOpenId(current.id); }
      else if (e.key === 'a' && current) { e.preventDefault(); take(current); }
      else if (e.key === 'o' && current) { e.preventDefault(); window.location.assign(`/tickets/${current.id}`); }
      else if (e.key === 'Escape') setOpenId(null);
      else if (e.key === '?') { e.preventDefault(); setHelp(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cols, current, openId, take]);
  const toggleTeam = id => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));
  return (
    <div className={openId ? 'flex items-start' : ''}>
      {help && <ShortcutsHelp which="inbox" onClose={() => setHelp(false)} />}
      <div className={`p-4 sm:p-6 space-y-4 min-w-0 ${openId ? 'w-[52%] shrink-0' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2 mr-auto"><InboxIcon size={20} className="text-primary-light" /> Boîte d'équipe</h1>
          <button type="button" onClick={() => setHelp(true)} className="px-2.5 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-3 inline-flex items-center gap-1"><Keyboard size={12} aria-hidden="true" />Raccourcis</button>
          <button type="button" onClick={load} aria-label="Actualiser" className="p-1.5 rounded-lg border border-overlay/8 text-ink-2"><RefreshCw size={14} /></button>
        </div>
        {teams.length > 0 && (
          <fieldset className="flex flex-wrap gap-1.5 text-xs" aria-label="Équipes">
            {teams.map(t => (
              <button key={t.id} type="button" onClick={() => toggleTeam(t.id)} aria-pressed={chosen.includes(t.id)}
                className={`px-2.5 py-1 rounded-full border ${chosen.includes(t.id) ? 'border-primary/50 bg-primary/10 text-primary-light' : 'border-overlay/8 text-ink-3'}`}>{t.name}</button>
            ))}
            {!chosen.length && <span className="text-ink-4 self-center">Mes équipes</span>}
          </fieldset>
        )}
        {!tickets ? <Loader2 size={16} className="animate-spin text-ink-4" /> : (
          <div className={`grid gap-3 grid-cols-1 ${openId ? 'xl:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
            {cols.map((c, ci) => (
              <section key={c.key} aria-label={c.label} className="bg-surface-card border border-overlay/6 rounded-2xl p-2 space-y-1.5 min-h-40">
                <h2 className="text-xs font-semibold text-ink-2 px-1 flex items-center gap-1.5">{c.label}<span className="text-ink-4 tabular-nums">{c.items.length}</span></h2>
                {c.items.length === 0 && <p className="text-[11px] text-ink-4 px-1">Rien ici.</p>}
                {c.items.slice(0, 100).map((t, ri) => {
                  const focused = cursor.col === ci && cursor.row === ri;
                  return (
                    <button key={t.id} type="button" onClick={() => { setCursor({ col: ci, row: ri }); setOpenId(t.id); }} aria-current={openId === t.id ? 'true' : undefined}
                      className={`block w-full text-left rounded-lg border px-2 py-1.5 text-xs ${focused ? 'border-primary/50 bg-primary/5' : 'border-overlay/6 hover:bg-overlay/4'} ${openId === t.id ? 'ring-1 ring-primary/40' : ''}`}>
                      <p className="text-ink-1 truncate">{`#${t.id} · ${t.subject || 'Sans sujet'}`}</p>
                      <p className="text-[11px] text-ink-4 truncate"><span translate="no">{t.owner_tag}</span>{(t.assignees || []).length ? ` · ${t.assignees.map(a => a.username).join(', ')}` : ''}<span className={`ml-1 ${PRIORITY[t.priority] || ''}`}>{t.priority === 'urgent' ? '· urgent' : ''}</span></p>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-4">Un ticket peut être dans plusieurs colonnes (à moi et en retard, par exemple). <kbd className="px-1 rounded bg-overlay/8">?</kbd> montre les raccourcis ; <Link to="/queue" className="underline">Ma file</Link> trie les tickets par urgence.</p>
      </div>
      {openId && (
        <section data-inbox-preview aria-label={`Ticket #${openId}`} className="flex-1 min-w-0 sticky top-0 h-screen overflow-y-auto border-l border-overlay/6">
          <TicketDetail key={openId} embeddedId={openId} onClose={() => setOpenId(null)} />
        </section>
      )}
    </div>
  );
}
