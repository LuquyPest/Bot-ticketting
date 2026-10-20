import React from 'react';
import { Languages } from 'lucide-react';
import api from '../api';
import { getLang, setLang } from '../i18n';

const persist = lang => api.put('/profile/language', { lang });

// Switches the dashboard between French and English (saved on the account, then the page reloads)
export default function LanguageToggle({ variant = 'icon' }) {
  const lang = getLang();
  if (variant === 'select') return (
    <select value={lang} onChange={e => setLang(e.target.value, { persist })} aria-label="Langue du dashboard" translate="no"
      className="px-3 py-2 rounded-xl bg-overlay/4 border border-overlay/8 text-sm text-ink-1 outline-hidden focus:border-primary/50">
      <option value="fr">Français</option>
      <option value="en">English</option>
    </select>
  );
  const next = lang === 'en' ? 'fr' : 'en';
  return (
    <button onClick={() => setLang(next, { persist })} translate="no"
      title={lang === 'en' ? 'Français' : 'English'}
      className="inline-flex items-center gap-0.5 text-ink-4 hover:text-primary-light hover:bg-primary/10 p-1.5 rounded-lg transition-all duration-150 shrink-0">
      <Languages size={13} aria-hidden="true" /><span className="text-[9px] font-bold">{next.toUpperCase()}</span>
      <span className="sr-only">{lang === 'en' ? ' — passer le dashboard en français' : ' — switch the dashboard to English'}</span>
    </button>
  );
}
