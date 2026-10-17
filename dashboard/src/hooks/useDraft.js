import { useCallback, useState } from 'react';

// Unsent replies and notes, kept per user / server / ticket in this browser's localStorage.
// Storage can be missing (private window, blocked site data): everything degrades to plain state.
const PREFIX = 'draft:';
const MAX_AGE = 30 * 24 * 3600 * 1000;

function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return '';
    const { text, at } = JSON.parse(raw);
    if (Date.now() - at > MAX_AGE) { localStorage.removeItem(PREFIX + key); return ''; }
    return typeof text === 'string' ? text : '';
  } catch { return ''; }
}

function write(key, text) {
  try {
    if (text) localStorage.setItem(PREFIX + key, JSON.stringify({ text, at: Date.now() }));
    else localStorage.removeItem(PREFIX + key);
  } catch { /* storage unavailable */ }
}

// Drops expired drafts (called once per page load)
export function purgeOldDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) read(k.slice(PREFIX.length));
    }
  } catch { /* storage unavailable */ }
}

export function hasDraft(prefix) {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(PREFIX + prefix)) return true;
  } catch { /* storage unavailable */ }
  return false;
}

// [text, setText, restored]: restored is true while the text is a draft left on a previous visit
export default function useDraft(key) {
  const load = k => { const text = k ? read(k) : ''; return { key: k, text, restored: !!text }; };
  const [state, setState] = useState(() => load(key));
  // The key changed (other ticket): show that ticket's draft
  if (state.key !== key) setState(load(key));

  const setText = useCallback(v => {
    setState(s => {
      const text = typeof v === 'function' ? v(s.text) : v;
      if (s.key) write(s.key, text);
      return { ...s, text, restored: s.restored && !!text };
    });
  }, []);

  return [state.text, setText, state.restored];
}
