import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Ticket } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';

const ICON_MAP = { new_ticket: Ticket };

function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60)    return 'à l\'instant';
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}

export default function NotificationBell() {
  const { notifications, unreadCount, remove, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle() {
    setOpen(o => {
      if (!o && unreadCount > 0) markAllRead();
      return !o;
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        title="Notifications"
        className="relative p-1.5 rounded-lg text-ink-4 hover:text-ink-1 hover:bg-white/[0.06]
                   transition-all flex-shrink-0"
      >
        <Bell size={13} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary
                           text-white text-[8px] font-bold flex items-center justify-center
                           shadow-[0_0_8px_rgba(124,110,243,0.6)] leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-surface-card border border-white/[0.1]
                        rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.7)] overflow-hidden animate-scale-in
                        z-50">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-semibold text-ink-2">Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-[10px] text-ink-4 hover:text-ink-2 transition-colors"
              >
                Effacer tout
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-xs text-ink-4 text-center py-6">Aucune notification</p>
            ) : notifications.map(n => {
              const Icon = ICON_MAP[n.type] || Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    if (n.href) { navigate(n.href); setOpen(false); }
                    remove(n.id);
                  }}
                  className="w-full flex items-start gap-3 px-3.5 py-2.5 hover:bg-white/[0.04]
                             text-left border-b border-white/[0.04] last:border-0 transition-colors group"
                >
                  <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center
                                  flex-shrink-0 mt-0.5">
                    <Icon size={13} className="text-primary-light" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-ink-1">{n.title}</p>
                    <p className="text-[11px] text-ink-3 truncate mt-0.5">{n.body}</p>
                    <p className="text-[10px] text-ink-4 mt-1">{timeAgo(n.timestamp)}</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); remove(n.id); }}
                    className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-ink-2
                               transition-all flex-shrink-0 mt-0.5"
                  >
                    <X size={11} />
                  </button>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
