import { useEffect, useRef } from 'react';
import { useSSECtx } from '../context/SSEContext';

export function useSSE(handlers) {
  const ctx = useSSECtx();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!ctx?.bus) return;
    const bus = ctx.bus.current;
    const listeners = {};

    for (const type of Object.keys(handlersRef.current)) {
      listeners[type] = (e) => {
        const handler = handlersRef.current[type];
        if (handler) handler(e.detail);
      };
      bus.addEventListener(type, listeners[type]);
    }

    return () => {
      for (const [type, fn] of Object.entries(listeners)) {
        bus.removeEventListener(type, fn);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
