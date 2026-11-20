import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, GraduationCap } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../App';

// Équipe → Compétences (v7, utils/skills.js): the skills of the space, who has which and speaks
// what, and the skills each subject asks for. Automatic assignment by a team reads them.
const INPUT = 'w-full bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-primary';
const LANG_LABELS = { fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch', it: 'Italiano', pt: 'Português' };
const card = 'bg-surface-card border border-overlay/6 rounded-2xl p-4 space-y-3';

function Toggle({ on, onClick, label, disabled }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={`px-2 py-0.5 rounded-md text-[11px] border transition-colors disabled:opacity-50 ${on ? 'bg-primary/15 border-primary/40 text-ink-1' : 'border-overlay/8 text-ink-3 hover:text-ink-1'}`}>{label}</button>
  );
}

export default function SkillsEditor() {
  const { user } = useAuth();
  const founder = user?.role === 'fondateur';
  const [data, setData] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [name, setName] = useState('');
  const load = () => api.get('/skills').then(r => setData(r.data)).catch(() => setData(false));
  useEffect(() => { load(); api.get('/teams/options').then(r => setSubjects(r.data?.subjects || [])).catch(() => {}); }, []);
  const act = async p => { try { setData((await p).data); return true; } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); return false; } };

  if (data === null) return <Loader2 className="animate-spin text-ink-4" />;
  if (!data) return <p className="text-sm text-ink-3">Compétences indisponibles.</p>;
  const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const saveStaff = (s, patch) => act(api.put(`/skills/staff/${s.userId}`, { skills: s.skills, languages: s.languages, ...patch }));
  const saveSubject = (subject, list) => act(api.put('/skills/subjects', { subjects: { ...data.subjects, [subject]: list } }));

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-ink-3">
        Une équipe qui attribue toute seule ne choisit que parmi les personnes qui ont <strong>toutes</strong> les compétences demandées par le ticket (par son sujet, une règle ou à la main), puis préfère celles qui parlent la langue du demandeur. Si personne ne convient, toute l'équipe reste possible.
      </p>

      <section className={card} aria-labelledby="sk-list">
        <h2 id="sk-list" className="text-sm font-semibold text-ink-1 inline-flex items-center gap-1.5"><GraduationCap size={14} aria-hidden="true" />Compétences de l'espace</h2>
        {data.skills.length === 0 && <p className="text-xs text-ink-4">Aucune compétence pour l'instant.</p>}
        <ul className="flex flex-wrap gap-1.5">
          {data.skills.map(s => (
            <li key={s.id} className="inline-flex items-center gap-1 rounded-lg border border-overlay/8 px-2 py-1 text-xs text-ink-1">
              {s.name} <span className="text-ink-4">{`· ${s.staff}`}</span>
              {founder && <button type="button" onClick={() => act(api.delete(`/skills/${s.id}`))} aria-label={`Supprimer la compétence « ${s.name} »`} className="text-ink-4 hover:text-red-400"><Trash2 size={11} /></button>}
            </li>
          ))}
        </ul>
        {founder && (
          <div className="flex gap-1.5 max-w-sm">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Nouvelle compétence (Réseau, Comptabilité…)" aria-label="Nouvelle compétence"
              onKeyDown={e => e.key === 'Enter' && name.trim() && act(api.post('/skills', { name })).then(ok => ok && setName(''))} className={INPUT} />
            <button type="button" disabled={!name.trim()} onClick={() => act(api.post('/skills', { name })).then(ok => ok && setName(''))} aria-label="Ajouter la compétence" className="px-2 rounded-lg bg-primary text-white disabled:opacity-50"><Plus size={12} /></button>
          </div>
        )}
      </section>

      <section className={card} aria-labelledby="sk-staff">
        <h2 id="sk-staff" className="text-sm font-semibold text-ink-1">Le staff : compétences et langues</h2>
        <p className="text-xs text-ink-4">Chacun règle ses propres langues ; les compétences sont réglées par les fondateurs.</p>
        <ul className="divide-y divide-overlay/6">
          {data.staff.map(s => {
            const self = String(s.userId) === String(user?.id);
            return (
              <li key={s.userId} className="py-2 space-y-1.5">
                <p className="text-xs font-medium text-ink-1">{s.username}</p>
                <div className="flex flex-wrap gap-1" role="group" aria-label={`Langues de ${s.username}`}>
                  {data.languages.map(l => <Toggle key={l} on={s.languages.includes(l)} disabled={!founder && !self} label={LANG_LABELS[l] || l} onClick={() => saveStaff(s, { languages: toggle(s.languages, l), ...(founder ? {} : { skills: undefined }) })} />)}
                </div>
                {data.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1" role="group" aria-label={`Compétences de ${s.username}`}>
                    {data.skills.map(k => <Toggle key={k.id} on={s.skills.includes(k.id)} disabled={!founder} label={k.name} onClick={() => saveStaff(s, { skills: toggle(s.skills, k.id) })} />)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {data.skills.length > 0 && subjects.length > 0 && (
        <section className={card} aria-labelledby="sk-subjects">
          <h2 id="sk-subjects" className="text-sm font-semibold text-ink-1">Compétences demandées par sujet</h2>
          <p className="text-xs text-ink-4">Une catégorie couvre ses sous-catégories.</p>
          <ul className="space-y-2">
            {subjects.map(subj => {
              const list = data.subjects[subj] || [];
              return (
                <li key={subj} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-2 w-48 shrink-0 truncate">{subj}</span>
                  <span className="flex flex-wrap gap-1" role="group" aria-label={`Compétences du sujet « ${subj} »`}>
                    {data.skills.map(k => <Toggle key={k.id} on={list.includes(k.id)} disabled={!founder} label={k.name} onClick={() => saveSubject(subj, toggle(list, k.id))} />)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
