import React, { createContext, useContext, useCallback, useReducer } from 'react';
import toast from 'react-hot-toast';
import { useSSE } from '../hooks/useSSE';

const NotifCtx = createContext({
  notifications: [], unreadCount: 0,
  remove: () => {}, markAllRead: () => {}, clearAll: () => {},
});

export const useNotifications = () => useContext(NotifCtx);

function reducer(state, action) {
  switch (action.type) {
    case 'add':          return [action.notif, ...state].slice(0, 30);
    case 'remove':       return state.filter(n => n.id !== action.id);
    case 'mark_all_read': return state.map(n => ({ ...n, read: true }));
    case 'clear':        return [];
    default:             return state;
  }
}

let _uid = 1;

function NotifListener({ add }) {
  useSSE({
    new_ticket: (data) => add({
      type: 'new_ticket',
      title: 'Nouveau ticket',
      body: data.subject
        ? `${data.ownerTag} — ${data.subject}`
        : (data.ownerTag || 'Nouveau ticket'),
      href: data.id ? `/tickets/${data.id}` : null,
    }),
    reminder: (data) => {
      const body = `Ticket #${data.ticketId}${data.subject ? ` — ${data.subject}` : ''}${data.note ? ` · ${data.note}` : ''}`;
      add({ type: 'reminder', title: '⏰ Rappel', body, href: `/tickets/${data.ticketId}` });
      toast(`Rappel : ${body}`, { icon: '⏰', duration: 10000 });
    },
    low_rating: (data) => {
      const body = `Note ${data.rating}/5 de ${data.ownerTag} sur le ticket #${data.ticketId} — à recontacter`;
      add({ type: 'low_rating', title: 'Note basse', body, href: `/tickets/${data.ticketId}` });
      toast(body, { icon: '⚠️', duration: 8000 });
    },
    mention: (data) => {
      const body = `${data.by} t'a mentionné dans le ticket #${data.ticketId} : ${data.excerpt}`;
      add({ type: 'mention', title: 'Mention', body, href: `/tickets/${data.ticketId}` });
      toast(body.slice(0, 140), { icon: '💬', duration: 6000 });
    },
    // Sent only to the staff member someone else assigned
    assigned: (data) => {
      const body = `${data.by} t'a attribué le ticket #${data.ticketId}${data.subject ? ` — ${data.subject}` : ''}`;
      add({ type: 'assigned', title: 'Ticket attribué', body, href: `/tickets/${data.ticketId}` });
      toast(body, { icon: '📌', duration: 6000 });
    },
  });
  return null;
}

export function NotificationProvider({ children }) {
  const [notifications, dispatch] = useReducer(reducer, []);
  const unreadCount = notifications.filter(n => !n.read).length;

  const add = useCallback((notif) => {
    dispatch({ type: 'add', notif: { id: _uid++, timestamp: Date.now(), read: false, ...notif } });
  }, []);

  const remove      = useCallback((id) => dispatch({ type: 'remove', id }), []);
  const markAllRead = useCallback(() => dispatch({ type: 'mark_all_read' }), []);
  const clearAll    = useCallback(() => dispatch({ type: 'clear' }), []);

  return (
    <NotifCtx.Provider value={{ notifications, unreadCount, remove, markAllRead, clearAll }}>
      <NotifListener add={add} />
      {children}
    </NotifCtx.Provider>
  );
}
