import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// « ? »: the keyboard shortcuts (v5.4), in a dialog closed by Escape
const NAV = [['g puis d / q / t / b', 'Dashboard, Ma file, Tickets, Boîte d\'équipe'], ['g puis p / k / c / a / s', 'Planning, Base, Contacts, Analytiques, Paramètres']];
export const SHORTCUTS = {
  global: [...NAV, ['⌘K / Ctrl+K', 'Palette de commandes'], ['?', 'Cette aide']],
  inbox: [['h / l', 'Colonne précédente, suivante'], ['j / k', 'Ticket suivant, précédent'], ['Entrée', 'Afficher le ticket à droite'], ['a', 'Me l\'attribuer'], ['o', 'Ouvrir la fiche entière'], ['Échap', 'Fermer l\'aperçu'], ...NAV, ['?', 'Cette aide']],
  list: [['j / ↓', 'Ticket suivant'], ['k / ↑', 'Ticket précédent'], ['Entrée', 'Ouvrir le ticket'], ['Échap', 'Désélectionner'], ...NAV, ['?', 'Cette aide']],
  ticket: [['r', 'Répondre'], ['n', 'Note interne'], ['a', 'Me l\'attribuer'], ['s', 'Changer le statut'], ['.', 'Ticket ouvert suivant'], [',', 'Ticket ouvert précédent'], ['Ctrl+Entrée', 'Envoyer'],
    ['Ctrl+B / I / K / E', 'Gras, italique, lien, code'], ['Échap', 'Revenir à la liste'], ['?', 'Cette aide']],
};
export default function ShortcutsHelp({ which, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-surface-elevated border border-overlay/10 rounded-2xl p-5 space-y-3 focus:outline-hidden">
        <div className="flex items-center"><h2 id="shortcuts-title" className="text-sm font-semibold text-ink-1 flex-1">Raccourcis clavier</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1 text-ink-3 hover:text-ink-1"><X size={14} /></button></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          {SHORTCUTS[which].map(([k, l]) => <React.Fragment key={k}><dt><kbd className="px-1.5 py-0.5 rounded bg-overlay/8 text-ink-1 font-mono">{k}</kbd></dt><dd className="text-ink-2">{l}</dd></React.Fragment>)}
        </dl>
      </div>
    </div>
  );
}
