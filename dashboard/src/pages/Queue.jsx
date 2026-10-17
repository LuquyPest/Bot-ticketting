import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListTodo, AlertTriangle, Hourglass, MessageCircleWarning, Flame, Loader2, UserPlus } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useSSE } from '../hooks/useSSE';
import { useAuth } from '../App';
import { fmtMinutes } from '../components/SlaBadge';

const STAGE_LABEL = { open: 'Ouvert', waiting: 'En attente', in_progress: 'En cours' };

// Why a ticket is high in the queue — icon + text, never color alone
function Reason({ r }) {
  const map = {
    breached:       { icon: AlertTriangle,         cls: 'text-red-400',    text: `Hors délai (+${fmtMinutes(r.minutes)})` },
    warning:        { icon: Hourglass,             cls: 'text-amber-300',  text: `Délai : ${fmtMinutes(r.minutes)} restant(s)` },
    member_waiting: { icon: MessageCircleWarning,  cls: 'text-sky-300',    text: `Le membre attend depuis ${fmtMinutes(r.minutes)}` },
    urgent:         { icon: Flame,                 cls: 'text-red-300',    text: 'Urgent' },
  }[r.type];
  if (!map) return null;
  const Icon = map.icon;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${map.cls}`}><Icon size={11} aria-hidden="true" />{map.text}</span>;
}

export default function Queue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [scope, setScope] = useState('mine');
  const [data, setData] = useState(null);
  const canClaim = user?.role === 'fondateur' || user?.permissions?.includes('claim_ticket');

  const load = useCallback(() => {
    api.get('/tickets/queue', { params: { scope } }).then(r => setData(r.data)).catch(err => toast.error(err.response?.data?.error || 'Erreur chargement'));
  }, [scope]);
  useEffect(() => { setData(null); load(); }, [load]);

  // Live: refresh (debounced) when tickets or messages change
  const timer = useRef(null);
  const refresh = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 800); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useSSE({ ticket: refresh, note: refresh, new_ticket: refresh, assigned: refresh });

  const claim = async (e, t) => {
    e.stopPropagation();
    try { await api.post(`/tickets/${t.id}/assignees`, { user_id: user.id }); toast.success(`Ticket #${t.id} pris en charge`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1 flex items-center gap-2"><ListTodo size={20} /> Ma file</h1>
        <p className="text-sm text-ink-3">Tes tickets du plus urgent au moins urgent : hors délai, proches de l'échéance, membre en attente de réponse, puis priorité.</p>
      </div>
      <div className="flex gap-1 p-1 rounded-xl bg-surface-card border border-overlay/6 w-fit" role="tablist">
        {[['mine', 'Mes tickets'], ['unassigned', 'Non attribués']].map(([v, label]) => (
          <button key={v} role="tab" aria-selected={scope === v} onClick={() => setScope(v)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium ${scope === v ? 'bg-primary/15 text-primary-light' : 'text-ink-4 hover:text-ink-2'}`}>
            {label}{data && scope === v ? ` (${data.tickets.length})` : ''}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-ink-3" /></div>
      ) : data.tickets.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-4">{scope === 'mine' ? 'Aucun ticket ne t\'est attribué. 🎉' : 'Aucun ticket non attribué.'}</p>
      ) : (
        <ol className="space-y-2">
          {data.tickets.map((t, i) => (
            <li key={t.id}>
              <button onClick={() => navigate(`/tickets/${t.id}`)}
                className="w-full text-left bg-surface-card border border-overlay/6 rounded-xl px-4 py-3 hover:border-overlay/12 hover:bg-surface-hover flex items-start gap-3">
                <span className="text-xs text-ink-4 tabular-nums w-5 pt-0.5">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-ink-4">#{t.id}</span>
                    <span className="text-sm font-semibold text-ink-1 truncate">{t.subject || 'Sans sujet'}</span>
                    <span className="text-[11px] text-ink-3">{t.owner_tag} · {STAGE_LABEL[t.stage] || 'Ouvert'}</span>
                  </span>
                  <span className="flex items-center gap-3 flex-wrap mt-1">
                    {t.reasons.length ? t.reasons.map(r => <Reason key={r.type} r={r} />) : <span className="text-[11px] text-ink-4">Rien d'urgent</span>}
                  </span>
                </span>
                {scope === 'unassigned' && canClaim && (
                  <span role="button" tabIndex={0} onClick={e => claim(e, t)} onKeyDown={e => e.key === 'Enter' && claim(e, t)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-primary-light bg-primary/10 border border-primary/20 hover:bg-primary/20 shrink-0">
                    <UserPlus size={11} /> Prendre
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
