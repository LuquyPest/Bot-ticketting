import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LayoutDashboard, Ticket, Users, ShieldBan,
  FileText, Settings, ScrollText, Shield, ClipboardList,
  Kanban, Tag, BarChart2, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../App';

const ALL_COMMANDS = [
  { id: 'dashboard',   label: 'Dashboard',   icon: LayoutDashboard, to: '/',            roles: ['support','fondateur'] },
  { id: 'tickets',     label: 'Tickets',     icon: Ticket,          to: '/tickets',     roles: ['support','fondateur'] },
  { id: 'kanban',      label: 'Kanban',      icon: Kanban,          to: '/kanban',      roles: ['support','fondateur'] },
  { id: 'staff',       label: 'Mes stats',   icon: BarChart2,       to: '/staff',       roles: ['support'] },
  { id: 'equipe',      label: 'Équipe',      icon: Users,           to: '/equipe',      roles: ['fondateur'] },
  { id: 'grades',      label: 'Grades',      icon: Shield,          to: '/grades',      roles: ['fondateur'] },
  { id: 'tags',        label: 'Tags',        icon: Tag,             to: '/tags',        roles: ['fondateur'] },
  { id: 'audit',       label: 'Audit',       icon: ClipboardList,   to: '/audit',       roles: ['fondateur'] },
  { id: 'blacklist',   label: 'Blacklist',   icon: ShieldBan,       to: '/blacklist',   roles: ['fondateur'] },
  { id: 'transcripts', label: 'Transcripts', icon: FileText,        to: '/transcripts', roles: ['fondateur'] },
  { id: 'patchnotes',  label: 'Patchnotes',  icon: ScrollText,      to: '/patchnotes',  roles: ['fondateur'] },
  { id: 'settings',    label: 'Paramètres',  icon: Settings,        to: '/settings',    roles: ['fondateur'] },
];

export default function CommandPalette({ open, onClose }) {
  const navigate   = useNavigate();
  const { user }   = useAuth();
  const [query, setQuery]     = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef   = useRef(null);
  const listRef    = useRef(null);

  const commands = ALL_COMMANDS.filter(c => {
    if (!c.roles.includes(user?.role) && user?.role !== 'fondateur') return false;
    if (!query.trim()) return true;
    return c.label.toLowerCase().includes(query.toLowerCase());
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  const execute = useCallback((cmd) => {
    navigate(cmd.to);
    onClose();
  }, [navigate, onClose]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected(s => Math.min(s + 1, commands.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(s => Math.max(s - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (commands[selected]) execute(commands[selected]);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, commands, selected, execute, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4
                 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-surface-card border border-white/[0.12] rounded-2xl
                   shadow-[0_32px_80px_rgba(0,0,0,0.8)] overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
          <Search size={15} className="text-ink-4 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher une page..."
            className="flex-1 bg-transparent text-ink-1 placeholder-ink-4 text-sm focus:outline-none"
          />
          <kbd className="flex items-center px-1.5 py-0.5 rounded-md bg-surface text-ink-4
                          text-[10px] font-mono border border-white/[0.08]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
          {commands.length === 0 ? (
            <p className="text-sm text-ink-4 text-center py-8">Aucun résultat</p>
          ) : commands.map((cmd, i) => {
            const Icon = cmd.icon;
            const active = i === selected;
            return (
              <button
                key={cmd.id}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                            ${active ? 'bg-primary/10 text-ink-1' : 'text-ink-2 hover:bg-white/[0.03]'}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0
                                 transition-colors ${active ? 'bg-primary/20' : 'bg-surface'}`}>
                  <Icon size={14} className={active ? 'text-primary-light' : 'text-ink-4'} />
                </div>
                <span className="text-sm font-medium flex-1">{cmd.label}</span>
                {active && <ArrowRight size={13} className="text-ink-4" />}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.04]
                        text-[10px] text-ink-4">
          <span>↑↓ naviguer</span>
          <span>↵ ouvrir</span>
          <span>ESC fermer</span>
        </div>
      </div>
    </div>
  );
}
