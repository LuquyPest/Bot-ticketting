import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserSearch, Download, UserX, Loader2, ShieldCheck } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const input = 'w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-xl px-3 py-2 text-sm focus:outline-hidden focus:border-primary/50';

// GDPR: what the server holds about a member, export, erasure (founders only).
export default function Members() {
  const [params, setParams] = useSearchParams();
  const [id, setId] = useState(params.get('id') || '');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const lookup = async (userId = id.trim()) => {
    if (!/^\d{17,20}$/.test(userId)) return toast.error('ID Discord invalide (17 à 20 chiffres)');
    setLoading(true); setSummary(null); setConfirm('');
    try { setSummary((await api.get(`/members/${userId}`)).data); setParams({ id: userId }); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setLoading(false);
  };
  useEffect(() => { if (params.get('id')) lookup(params.get('id')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const erase = async () => {
    setDeleting(true);
    try {
      const { data } = await api.delete(`/members/${summary.userId}`, { data: { confirm } });
      toast.success(`${data.ticketsDeleted} ticket(s) et ${data.messagesElsewhere} message(s) supprimés`);
      setSummary(null); setConfirm(''); setId(''); setParams({});
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setDeleting(false);
  };

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-ink-1">Données des membres</h1>
        <p className="text-sm text-ink-3">Demandes RGPD : consulter, exporter ou supprimer ce que ce serveur conserve sur un membre.</p>
      </div>

      <div className="flex gap-2">
        <input value={id} onChange={e => setId(e.target.value)} onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="ID Discord du membre" inputMode="numeric" className={`${input} font-mono`} />
        <button onClick={() => lookup()} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-light disabled:opacity-60 shrink-0">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <UserSearch size={14} />} Rechercher
        </button>
      </div>

      {summary && (
        <div className="space-y-4">
          <div className="bg-overlay/3 rounded-2xl border border-overlay/6 p-5">
            <p className="text-sm font-semibold text-ink-1">{summary.tag || 'Membre'} <span className="text-[11px] font-mono text-ink-4">{summary.userId}</span></p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              {[['Tickets', `${summary.tickets}${summary.openTickets ? ` (${summary.openTickets} ouvert·s)` : ''}`], ['Messages', summary.messages],
                ['Transcripts', summary.transcripts], ['Notes de satisfaction', summary.ratings], ['Participations', summary.participations],
                ['Entrées du journal', summary.journalEntries]].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] text-ink-4">{label}</dt>
                  <dd className="text-lg font-bold text-ink-1 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {summary.blacklisted && <p className="text-[11px] text-amber-300 mt-3">Ce membre est dans la blacklist du serveur.</p>}
            <div className="flex gap-2 mt-4">
              <a href={`/api/members/${summary.userId}/export`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-ink-1 border border-overlay/8 hover:bg-overlay/5">
                <Download size={13} /> Exporter (JSON)
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-5 space-y-3">
            <p className="text-sm font-semibold text-red-300 flex items-center gap-2"><UserX size={15} /> Supprimer les données de ce membre</p>
            <p className="text-xs text-ink-3">
              Supprime définitivement ses tickets (messages, transcripts, notes, tags, messages programmés), ses messages et sa participation dans les tickets d'autres personnes, et son entrée de blacklist. Les salons Discord de ses tickets ouverts sont supprimés. Le journal est conservé mais anonymisé. Les tickets des autres membres ne sont jamais supprimés.
            </p>
            <label className="block space-y-1">
              <span className="text-[11px] text-ink-3">Pour confirmer, saisis l'ID du membre</span>
              <input value={confirm} onChange={e => setConfirm(e.target.value)} className={`${input} font-mono`} />
            </label>
            <button onClick={erase} disabled={confirm !== summary.userId || deleting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40">
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />} Supprimer définitivement
            </button>
          </div>
          <p className="text-[11px] text-ink-4 flex items-center gap-1.5"><ShieldCheck size={12} /> Export et suppression sont enregistrés dans le journal (la suppression sans l'identifiant du membre).</p>
        </div>
      )}
    </div>
  );
}
