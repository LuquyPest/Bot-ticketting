import { useEffect, useRef } from 'react';

export function useSSE(handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const es = new EventSource('/api/events');

    const listeners = {};
    for (const type of Object.keys(handlers)) {
      listeners[type] = (e) => {
        const handler = handlersRef.current[type];
        if (!handler) return;
        try { handler(JSON.parse(e.data)); } catch {}
      };
      es.addEventListener(type, listeners[type]);
    }

    return () => {
      for (const [type, fn] of Object.entries(listeners)) {
        es.removeEventListener(type, fn);
      }
      es.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
