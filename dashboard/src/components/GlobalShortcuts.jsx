import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ShortcutsHelp from './ShortcutsHelp';

// Keyboard shortcuts of the whole dashboard (v8): « g » then a letter goes to a page; « ? » shows
// the help (the ticket list, the ticket view and the team inbox show their own)
export const GO = { d: ['/', 'Dashboard'], q: ['/queue', 'Ma file'], t: ['/tickets', 'Tickets'], b: ['/boite', 'Boîte d\'équipe'], p: ['/planning', 'Planning'],
  k: ['/faq', 'Base de connaissances'], c: ['/profils', 'Contacts'], a: ['/analytics', 'Analytiques'], s: ['/settings', 'Paramètres'] };
const OWN_HELP = /^\/(tickets|boite)(\/|$)/;

export default function GlobalShortcuts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [help, setHelp] = useState(false);
  const pending = useRef(0);
  useEffect(() => {
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (pending.current && Date.now() - pending.current < 1500) {
        pending.current = 0;
        const to = GO[e.key]?.[0];
        if (to) { e.preventDefault(); navigate(to); }
        return;
      }
      if (e.key === 'g') { pending.current = Date.now(); return; }
      if (e.key === '?' && !OWN_HELP.test(pathname)) { e.preventDefault(); setHelp(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, pathname]);
  return help ? <ShortcutsHelp which="global" onClose={() => setHelp(false)} /> : null;
}
