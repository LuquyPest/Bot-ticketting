import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../App';

const TOUR_VERSION = 'v1';

// [selector of the element shown (null = centred card), title, text, roles allowed (null = all)]
const STEPS = [
  [null, 'Bienvenue dans l\'équipe', 'Cette courte visite te montre où trouver l\'essentiel. Tu peux la quitter à tout moment et la revoir depuis ton profil.'],
  ['[data-tour="nav-/queue"]', 'Ma file', 'Tes tickets du plus urgent au moins urgent, avec la raison (hors délai, membre qui attend…), et l\'onglet « Non attribués » pour en prendre un.'],
  ['[data-tour="nav-/tickets"]', 'Tickets', 'Tous les tickets avec des vues prêtes (Ouverts, Mes tickets, Suivis…) et une recherche qui comprend tag:, de:, étape:… Le bouton ?: de la recherche les explique.'],
  ['[data-tour="nav-/kanban"]', 'Kanban', 'Les tickets ouverts par étape : glisse une carte pour la faire avancer.'],
  ['[data-tour="nav-/activite"]', 'Mon activité', 'Tes chiffres sur 7, 30 ou 90 jours comparés à l\'équipe : réponses, fermetures, délai de première réponse, notes reçues.'],
  ['[data-tour="nav-/profils"]', 'Profils', 'L\'historique de chaque membre, ses étiquettes (VIP, à surveiller…) et les échanges du staff à son sujet.'],
  ['[data-tour="notifications"]', 'Notifications', 'Attributions, mentions (@toi ou @ton grade), rappels et tickets que tu suis arrivent ici en direct.'],
  ['[data-tour="availability"]', 'Ta disponibilité', 'Indique si tu es disponible, occupé ou absent : c\'est affiché quand quelqu\'un t\'attribue un ticket. Pour des congés, planifie une absence dans ton profil.'],
  ['[data-tour="palette"]', 'Palette de commandes', 'Ctrl+K (⌘K) pour aller à n\'importe quelle page ou ouvrir un ticket par son numéro.'],
  ['[data-tour="profile"]', 'Ton profil', 'Double authentification, notifications du navigateur, langue, vue fractionnée et absences.'],
  [null, 'C\'est parti !', 'Dans un ticket : R pour répondre, N pour une note interne, Échap pour revenir. Bon support !'],
];

// The element itself, or its first child when it has no box of its own (display: contents)
function targetOf(selector) {
  const el = selector && document.querySelector(selector);
  if (!el) return null;
  const box = el.getBoundingClientRect().width ? el : el.firstElementChild;
  const r = box?.getBoundingClientRect();
  // Hidden (sidebar closed on a phone) or off screen: shown as a centred card
  return r && r.width && r.right > 0 && r.left < window.innerWidth ? r : null;
}

// Short tour of the dashboard for new staff members: starts by itself once for an account less
// than 14 days old, and from Profile → « Revoir la visite guidée » (event 'tour:start').
export default function GuidedTour() {
  const { user } = useAuth();
  const [step, setStep] = useState(-1);
  const [rect, setRect] = useState(null);
  const nextRef = useRef(null);
  const staff = user?.role === 'support' || user?.role === 'fondateur';

  const steps = STEPS.filter(([sel]) => !sel || document.querySelector(sel) || sel.includes('notifications'));
  const finish = useCallback(() => {
    setStep(-1);
    api.put('/profile/prefs', { tourDone: TOUR_VERSION }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!staff || user?.demo) return undefined;
    let cancelled = false;
    api.get('/profile/prefs').then(r => {
      if (!cancelled && r.data.newAgent && r.data.tourDone !== TOUR_VERSION) setTimeout(() => setStep(0), 800);
    }).catch(() => {});
    const start = () => setStep(0);
    window.addEventListener('tour:start', start);
    return () => { cancelled = true; window.removeEventListener('tour:start', start); };
  }, [staff, user?.demo]);

  useLayoutEffect(() => {
    if (step < 0) return undefined;
    const place = () => setRect(targetOf(steps[step]?.[0]));
    place();
    window.addEventListener('resize', place);
    nextRef.current?.focus();
    return () => window.removeEventListener('resize', place);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step < 0) return undefined;
    const key = e => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') setStep(s => (s + 1 < steps.length ? s + 1 : s));
      else if (e.key === 'ArrowLeft') setStep(s => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step, steps.length, finish]);

  if (step < 0 || !steps[step]) return null;
  const [, title, text] = steps[step];
  const last = step === steps.length - 1;
  const pad = 6;
  // Card next to the highlighted element (right of it, or below when there is no room)
  const cardStyle = rect
    ? (rect.right + 340 < window.innerWidth
      ? { top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 220)), left: rect.right + 16 }
      : { top: Math.min(rect.bottom + 12, window.innerHeight - 220), left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)) })
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      {rect ? (
        <div aria-hidden="true" className="absolute rounded-xl ring-2 ring-primary-light transition-all duration-200 pointer-events-none"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' }} />
      ) : <div aria-hidden="true" className="absolute inset-0 bg-black/60" />}
      <div style={cardStyle} className="absolute w-80 max-w-[calc(100vw-24px)] rounded-2xl border border-overlay/10 bg-surface-elevated p-4 shadow-2xl">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-light">Visite guidée · {step + 1}/{steps.length}</p>
        <h2 id="tour-title" className="mt-1 text-sm font-semibold text-ink-1">{title}</h2>
        <p id="tour-text" className="mt-1.5 text-xs leading-relaxed text-ink-2">{text}</p>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={finish} className="text-xs text-ink-3 hover:text-ink-1">{last ? 'Fermer' : 'Passer la visite'}</button>
          <span className="flex-1" />
          {step > 0 && <button onClick={() => setStep(s => s - 1)} className="px-3 py-1.5 rounded-lg text-xs text-ink-2 border border-overlay/8 hover:text-ink-1">Précédent</button>}
          <button ref={nextRef} onClick={() => (last ? finish() : setStep(s => s + 1))} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">
            {last ? 'Terminer' : 'Suivant'}
          </button>
        </div>
      </div>
    </div>
  );
}
