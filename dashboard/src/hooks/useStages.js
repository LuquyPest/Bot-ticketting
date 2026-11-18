import { useEffect, useState } from 'react';
import api from '../api';
import { useSSE } from './useSSE';

// Ticket statuses of the space (built-in Ouvert / En attente / En cours + custom ones, v4.2),
// fetched once and shared; refreshed when a founder changes them (SSE « stages »).
export const BUILTIN_STAGES = [
  { key: 'open', label: 'Ouvert', color: 'sky', kind: 'open', builtin: true },
  { key: 'waiting', label: 'En attente', color: 'amber', kind: 'waiting', builtin: true },
  { key: 'in_progress', label: 'En cours', color: 'emerald', kind: 'in_progress', builtin: true },
];
let cache = null;
let pending = null;
const listeners = new Set();

export function loadStages(force = false) {
  if (cache && !force) return Promise.resolve(cache);
  if (!pending || force) {
    pending = api.get('/stages').then(r => (Array.isArray(r.data) ? r.data : BUILTIN_STAGES)).catch(() => cache || BUILTIN_STAGES)
      .then(list => { cache = list; pending = null; listeners.forEach(fn => fn(list)); return list; });
  }
  return pending;
}
export function setStagesCache(list) { cache = list; listeners.forEach(fn => fn(list)); }

export function useStages() {
  const [stages, setStages] = useState(cache || BUILTIN_STAGES);
  useEffect(() => {
    listeners.add(setStages);
    loadStages();
    return () => listeners.delete(setStages);
  }, []);
  useSSE({ stages: () => loadStages(true) });
  return stages;
}

// Label of a stage key (a deleted custom status shows its key)
export const stageLabel = (stages, key) => stages.find(s => s.key === (key || 'open'))?.label || key;
export const stageColor = (stages, key) => stages.find(s => s.key === (key || 'open'))?.color || 'slate';

// Static class names (Tailwind only keeps classes written in full)
export const STAGE_CLS = {
  sky:     { text: 'text-sky-300',     badge: 'text-sky-300 bg-sky-500/10 border-sky-500/25',             header: 'border-sky-500/20 bg-sky-500/5',         dot: 'bg-sky-400' },
  amber:   { text: 'text-amber-300',   badge: 'text-amber-300 bg-amber-500/10 border-amber-500/25',       header: 'border-amber-500/20 bg-amber-500/5',     dot: 'bg-amber-400' },
  emerald: { text: 'text-emerald-300', badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25', header: 'border-emerald-500/20 bg-emerald-500/5', dot: 'bg-emerald-400' },
  violet:  { text: 'text-violet-300',  badge: 'text-violet-300 bg-violet-500/10 border-violet-500/25',    header: 'border-violet-500/20 bg-violet-500/5',   dot: 'bg-violet-400' },
  rose:    { text: 'text-rose-300',    badge: 'text-rose-300 bg-rose-500/10 border-rose-500/25',          header: 'border-rose-500/20 bg-rose-500/5',       dot: 'bg-rose-400' },
  orange:  { text: 'text-orange-300',  badge: 'text-orange-300 bg-orange-500/10 border-orange-500/25',    header: 'border-orange-500/20 bg-orange-500/5',   dot: 'bg-orange-400' },
  teal:    { text: 'text-teal-300',    badge: 'text-teal-300 bg-teal-500/10 border-teal-500/25',          header: 'border-teal-500/20 bg-teal-500/5',       dot: 'bg-teal-400' },
  indigo:  { text: 'text-indigo-300',  badge: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/25',    header: 'border-indigo-500/20 bg-indigo-500/5',   dot: 'bg-indigo-400' },
  slate:   { text: 'text-slate-300',   badge: 'text-slate-300 bg-slate-500/10 border-slate-500/25',       header: 'border-slate-500/20 bg-slate-500/5',     dot: 'bg-slate-400' },
};
export const STAGE_COLOR_NAMES = { sky: 'Bleu ciel', amber: 'Ambre', emerald: 'Vert', violet: 'Violet', rose: 'Rose', orange: 'Orange', teal: 'Sarcelle', indigo: 'Indigo', slate: 'Gris' };
