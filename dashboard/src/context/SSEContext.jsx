import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

export const SSEContext = createContext(null);
export const useSSECtx = () => useContext(SSEContext);

const KNOWN_TYPES = [
  'ticket', 'new_ticket', 'note',
  'participant_add', 'participant_remove', 'connected',
];

export function SSEProvider({ children }) {
  const [status, setStatus] = useState('connecting');
  const busRef = useRef(new EventTarget());

  useEffect(() => {
    let es = null;
    let retryTimer = null;
    let alive = true;

    function connect() {
      if (!alive) return;
      setStatus('connecting');
      es = new EventSource('/api/events');

      es.onopen = () => setStatus('connected');
      es.onerror = () => {
        setStatus('error');
        es.close();
        if (alive) retryTimer = setTimeout(connect, 5000);
      };

      KNOWN_TYPES.forEach(type => {
        es.addEventListener(type, (e) => {
          try {
            const detail = JSON.parse(e.data);
            busRef.current.dispatchEvent(new CustomEvent(type, { detail }));
          } catch {}
        });
      });
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(retryTimer);
      if (es) es.close();
    };
  }, []);

  return (
    <SSEContext.Provider value={{ status, bus: busRef }}>
      {children}
    </SSEContext.Provider>
  );
}
