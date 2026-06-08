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

const PRIO_COLOR = {
  low:    'bg-sky-500/10 text-sky-400 border border-sky-500/20',
  normal: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  urgent: 'bg-red-500/10 text-red-400 border border-red-500/20',
};
const PRIO_LABEL = { low: 'Faible', normal: 'Normal', urgent: 'Urgent' };

function TicketCard({ ticket, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-surface border border-white/[0.06] rounded-xl p-3 space-y-2
                 transition-all hover:border-white/[0.12] hover:bg-surface-hover
                 hover:shadow-card-hover group"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-ink-4 font-mono tabular-nums">#{ticket.id}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${PRIO_COLOR[ticket.priority] || PRIO_COLOR.normal}`}>
          {PRIO_LABEL[ticket.priority] || ticket.priority}
        </span>
      </div>
      <p className="text-sm font-semibold text-ink-2 group-hover:text-ink-1 leading-snug transition-colors">
        {ticket.owner_tag}
      </p>
      {ticket.subject && (
        <p className="text-xs text-ink-3 truncate">{ticket.subject}</p>
      )}
      {ticket.claimed_by && (
        <p className="text-[10px] text-ink-4">claim par {ticket.claimed_by}</p>
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

  const COL_STYLES = {
    amber:   { header: 'border-amber-500/20 bg-amber-500/5', dot: 'bg-amber-400' },
    indigo:  { header: 'border-primary/20 bg-primary/5',     dot: 'bg-primary-light' },
    emerald: { header: 'border-emerald-500/20 bg-emerald-500/5', dot: 'bg-emerald-400' },
  };

  return (
    <div className="p-6 space-y-5 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <KanbanIcon size={18} className="text-primary-light" />
          <div className="page-header">
            <h1>Kanban</h1>
            <p>Vue par colonnes des tickets</p>
          </div>
        </div>
        <button onClick={load}
          className="p-2 rounded-xl text-ink-3 hover:text-ink-1 hover:bg-white/[0.06]
                     border border-white/[0.06] transition-all">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {COLUMNS.map(col => {
          const items = tickets.filter(col.filter);
          const s = COL_STYLES[col.color];
          return (
            <div key={col.key}
              className="flex flex-col bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden shadow-card">
              <div className={`flex items-center justify-between px-4 py-3 border-b ${s.header}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <h3 className="text-sm font-semibold text-ink-1">{col.label}</h3>
                </div>
                <span className="text-xs font-bold text-ink-4 bg-white/[0.05] px-2 py-0.5 rounded-full tabular-nums">
                  {items.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading ? (
                  <div className="text-center py-8 text-ink-4 text-sm">Chargement...</div>
                ) : items.length === 0 ? (
                  <div className="text-center py-8 text-ink-4 text-sm">Aucun ticket</div>
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
