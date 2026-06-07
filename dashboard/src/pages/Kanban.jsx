import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Kanban as KanbanIcon, RefreshCw } from 'lucide-react';
import api from '../api';
import { useSSE } from '../hooks/useSSE';

const COLUMNS = [
  { key: 'unclaimed', label: 'Non claim',  color: 'amber',   query: { status: 'open' },             filter: t => t.status === 'open' && !t.claimed_by },
  { key: 'claimed',   label: 'En cours',   color: 'indigo',  query: { status: 'open' },             filter: t => t.status === 'open' && t.claimed_by },
  { key: 'closed',    label: 'Fermés',     color: 'emerald', query: { status: 'closed' },           filter: t => t.status === 'closed' }
];

const PRIO_COLOR = { low: 'bg-emerald-500/20 text-emerald-400', normal: 'bg-slate-700 text-slate-400', urgent: 'bg-red-500/20 text-red-400' };
const PRIO_LABEL = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

function TicketCard({ ticket, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-slate-800 hover:bg-slate-750 border border-slate-700/60 rounded-xl p-3 space-y-2 transition-colors hover:border-slate-600/60 group"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-slate-600 font-mono">#{ticket.id}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIO_COLOR[ticket.priority] || PRIO_COLOR.normal}`}>
          {PRIO_LABEL[ticket.priority] || ticket.priority}
        </span>
      </div>
      <p className="text-sm font-medium text-slate-200 group-hover:text-white leading-snug">
        {ticket.owner_tag}
      </p>
      {ticket.subject && (
        <p className="text-xs text-slate-500 truncate">{ticket.subject}</p>
      )}
      {ticket.claimed_by && (
        <p className="text-[10px] text-slate-600">claim par {ticket.claimed_by}</p>
      )}
    </button>
  );
}

export default function Kanban() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [open, closed] = await Promise.all([
        api.get('/tickets', { params: { status: 'open', page: 1 } }),
        api.get('/tickets', { params: { status: 'closed', page: 1 } })
      ]);
      setTickets([...open.data.tickets, ...closed.data.tickets]);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useSSE({
    ticket: (d) => setTickets(prev => prev.map(t => t.id === d.id ? { ...t, ...d } : t)),
    new_ticket: load
  });

  return (
    <div className="p-6 space-y-5 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <KanbanIcon size={20} className="text-indigo-400" />
          <div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">Kanban</h1>
            <p className="text-sm text-slate-500">Vue par colonnes des tickets</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {COLUMNS.map(col => {
          const items = tickets.filter(col.filter);
          const headerColors = {
            amber:   'border-amber-500/40 bg-amber-500/5',
            indigo:  'border-indigo-500/40 bg-indigo-500/5',
            emerald: 'border-emerald-500/40 bg-emerald-500/5'
          };
          const dotColors = {
            amber:   'bg-amber-400',
            indigo:  'bg-indigo-400',
            emerald: 'bg-emerald-400'
          };
          return (
            <div key={col.key} className="flex flex-col bg-slate-900 border border-slate-800/60 rounded-xl overflow-hidden">
              <div className={`flex items-center justify-between px-4 py-3 border-b ${headerColors[col.color]}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${dotColors[col.color]}`} />
                  <h3 className="text-sm font-semibold text-slate-200">{col.label}</h3>
                </div>
                <span className="text-xs font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{items.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading ? (
                  <div className="text-center py-8 text-slate-600 text-sm">Chargement...</div>
                ) : items.length === 0 ? (
                  <div className="text-center py-8 text-slate-700 text-sm">Aucun ticket</div>
                ) : items.map(t => (
                  <TicketCard key={t.id} ticket={t} onClick={() => navigate(`/tickets/${t.id}`)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
