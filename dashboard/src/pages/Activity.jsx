import React, { useEffect, useState } from 'react';
import { MessageSquare, CheckCircle2, Clock, Star, Inbox, TrendingUp, Timer } from 'lucide-react';
import { fmtSeconds } from '../utils/duration';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../api';
import { fmtMinutes } from '../components/SlaBadge';
import { fmtDate } from '../utils/format';

const PERIODS = [7, 30, 90];
const BAR = '#6c5ce7';
const LINE = '#f59e0b';
const axis = { fontSize: 10, fill: 'var(--color-ink-3)' };
const weekLabel = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-surface-card border border-overlay/6 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-xs text-ink-3"><Icon size={13} className="text-primary-light" />{label}</div>
      <p className="text-2xl font-bold text-ink-1 mt-2 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-ink-4 mt-1">{sub}</p>}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="bg-surface-card border border-overlay/6 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-ink-2 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="bg-surface-elevated border border-overlay/10 rounded-lg px-3 py-2 text-xs shadow-card">
      <p className="text-ink-3">Semaine du {weekLabel(label)}</p>
      <p className="text-ink-1 font-semibold">{payload[0].value}{unit}</p>
    </div>
  );
}

// Personal figures of the signed-in staff member, next to the team's
export default function Activity() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api.get('/staff/me/activity', { params: { days } }).then(r => setData(r.data)).catch(() => setData(false)); }, [days]);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Mon activité</h1>
          <p className="text-sm text-ink-3 mt-0.5">Tes chiffres sur la période, comparés à ceux de l'équipe</p>
        </div>
        <div className="ml-auto flex rounded-lg bg-overlay/4 p-0.5" role="group" aria-label="Période">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setDays(p)} aria-pressed={days === p}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${days === p ? 'bg-surface-elevated text-ink-1 shadow-card' : 'text-ink-3 hover:text-ink-1'}`}>
              {p} jours
            </button>
          ))}
        </div>
      </div>

      {data === false && <p className="text-sm text-red-400">Impossible de charger ton activité.</p>}
      {!data && data !== false && <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-24 rounded-2xl bg-overlay/2.5 animate-pulse" />)}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Tile icon={MessageSquare} label="Réponses envoyées" value={data.replies} sub={`sur ${data.tickets} ticket(s)`} />
            <Tile icon={CheckCircle2} label="Tickets fermés" value={data.closed} sub={data.team.closedPerMember != null ? `équipe : ${data.team.closedPerMember} par personne` : null} />
            <Tile icon={Clock} label="1re réponse (médiane)" value={data.firstResponse.medianMinutes != null ? fmtMinutes(data.firstResponse.medianMinutes) : '—'}
              sub={data.firstResponse.teamMedianMinutes != null ? `équipe : ${fmtMinutes(data.firstResponse.teamMedianMinutes)} · ${data.firstResponse.count} ticket(s)` : `${data.firstResponse.count} ticket(s)`} />
            <Tile icon={Star} label="Note moyenne reçue" value={data.rating.average != null ? `${data.rating.average}/5` : '—'}
              sub={`${data.rating.count} note(s)${data.rating.teamAverage != null ? ` · équipe : ${data.rating.teamAverage}/5` : ''}`} />
            <Tile icon={Inbox} label="Tickets ouverts attribués" value={data.openAssigned} sub={`${data.notes} note(s) interne(s) sur la période`} />
            <Tile icon={Timer} label="Temps passé" value={fmtSeconds(data.timeSeconds || 0)} sub="chronos et temps ajoutés sur la période" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title="Réponses envoyées par semaine (12 semaines)">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.weekly} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <CartesianGrid stroke="var(--color-overlay)" strokeOpacity={0.06} vertical={false} />
                  <XAxis dataKey="week" tickFormatter={weekLabel} tick={axis} axisLine={false} tickLine={false} interval={1} />
                  <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip unit=" réponse(s)" />} cursor={{ fill: 'var(--color-overlay)', fillOpacity: 0.04 }} />
                  <Bar dataKey="replies" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Note moyenne reçue par semaine">
              {data.weekly.some(w => w.rating != null) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={data.weekly} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke="var(--color-overlay)" strokeOpacity={0.06} vertical={false} />
                    <XAxis dataKey="week" tickFormatter={weekLabel} tick={axis} axisLine={false} tickLine={false} interval={1} />
                    <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={axis} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip unit="/5" />} />
                    <Line dataKey="rating" stroke={LINE} strokeWidth={2} connectNulls dot={{ r: 4, fill: LINE, stroke: 'var(--color-surface-card)', strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-xs text-ink-4 h-[180px] flex items-center justify-center">Pas encore de note sur cette période</p>}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title={`Répartition de tes notes (${data.days} jours)`}>
              <ul className="space-y-2">
                {[...data.rating.distribution].reverse().map(d => {
                  const pct = data.rating.count ? Math.round((d.count / data.rating.count) * 100) : 0;
                  return (
                    <li key={d.rating} className="flex items-center gap-3 text-xs">
                      <span className="w-10 text-ink-2 tabular-nums">{d.rating} ★</span>
                      <span className="flex-1 h-2 rounded-full bg-overlay/6 overflow-hidden">
                        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: LINE }} />
                      </span>
                      <span className="w-14 text-right text-ink-3 tabular-nums">{d.count} · {pct} %</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title="Derniers commentaires des membres">
              {data.comments.length ? (
                <ul className="space-y-3">
                  {data.comments.map(c => (
                    <li key={c.ticket_id} className="text-xs">
                      <p className="text-ink-2"><span className="text-amber-400">{'★'.repeat(c.rating)}</span> · ticket #{c.ticket_id} · {fmtDate(c.rated_at, { dateStyle: 'short' })}</p>
                      <p className="text-ink-1 mt-0.5 italic">« {c.comment} »</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-ink-4 flex items-center gap-2"><TrendingUp size={12} /> Aucun commentaire pour l'instant</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
