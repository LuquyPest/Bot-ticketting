import React, { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../App';

const KEY = 'lastActivity';
const PING_MS = 60000;
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
const readLast = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };

// Sign-out after inactivity (server setting « Déconnexion après inactivité »). Activity is shared
// by every tab of the browser (localStorage), so an idle tab never signs out the one in use.
// The server is told at most once a minute (POST /api/profile/activity) and also checks it.
export default function IdleWatcher() {
  const { user, logout } = useAuth();
  const minutes = Number(user?.idleTimeoutMinutes) || 0;
  const [warning, setWarning] = useState(false);
  const lastPing = useRef(0);
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    if (!minutes) return undefined;
    const mark = () => {
      const now = Date.now();
      try { localStorage.setItem(KEY, String(now)); } catch { /* storage unavailable */ }
      setWarning(false);
      if (now - lastPing.current > PING_MS) { lastPing.current = now; api.post('/profile/activity').catch(() => {}); }
    };
    mark();
    EVENTS.forEach(e => window.addEventListener(e, mark, { passive: true, capture: true }));
    const timer = setInterval(async () => {
      const idle = Date.now() - Math.max(readLast(), lastPing.current);
      if (idle >= minutes * 60000) {
        clearInterval(timer);
        try { await logoutRef.current?.(); } catch { /* already signed out by the server */ }
        window.location.href = '/login?expired=idle';
      } else {
        setWarning(idle >= minutes * 60000 - 60000);
      }
    }, 5000);
    return () => { clearInterval(timer); EVENTS.forEach(e => window.removeEventListener(e, mark, { capture: true })); };
  }, [minutes]);

  if (!warning) return null;
  return (
    <div role="alertdialog" aria-live="assertive" aria-labelledby="idle-title"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-amber-500/30 bg-surface-elevated p-4 shadow-2xl">
      <p id="idle-title" className="text-sm font-semibold text-ink-1">Tu vas être déconnecté dans moins d'une minute</p>
      <p className="mt-1 text-xs text-ink-3">Aucune activité depuis {minutes} min sur ce serveur (réglage de sécurité des fondateurs).</p>
      {/* Clicking (or pressing a key) is itself the activity that keeps the session */}
      <button onClick={() => setWarning(false)} className="mt-3 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold">Rester connecté</button>
    </div>
  );
}
