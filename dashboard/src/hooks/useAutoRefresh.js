import { useEffect, useRef } from 'react';

export function useAutoRefresh(fn, intervalMs = 30000) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const id = setInterval(() => fnRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
