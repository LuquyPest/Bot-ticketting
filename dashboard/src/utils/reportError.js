// Dashboard crashes (React render errors, uncaught errors, unhandled rejections) are sent to the
// server and appear on the super-admin « Erreurs » page (context "navigateur"). Network errors
// are left out (the server already logs its own failures), as is noise from browser extensions.
const IGNORED = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|safari-extension:|Loading chunk \d+ failed|Failed to fetch dynamically imported module/i;
const MAX_PER_PAGE = 10;
const sentAt = new Map();
let count = 0;

export function reportError(error, extra = {}) {
  try {
    if (!error || error.isAxiosError || error.name === 'AbortError' || error.name === 'CanceledError') return;
    const message = String(error.message || error).slice(0, 500);
    if (!message || IGNORED.test(message) || IGNORED.test(error.stack || '')) return;
    const now = Date.now();
    if (count >= MAX_PER_PAGE || now - (sentAt.get(message) || 0) < 60000) return;
    sentAt.set(message, now);
    count++;
    fetch('/api/client-errors', {
      method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({
        message, stack: String(error.stack || '').slice(0, 4000), url: window.location.pathname,
        kind: extra.kind || 'error', component: extra.componentStack ? String(extra.componentStack).slice(0, 2000) : undefined,
        release: import.meta.env.VITE_RELEASE || undefined,
      }),
    }).catch(() => {});
  } catch { /* never let reporting break the page */ }
}

export function installErrorReporting() {
  window.addEventListener('error', e => reportError(e.error || new Error(e.message), { kind: 'error' }));
  window.addEventListener('unhandledrejection', e => reportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), { kind: 'promesse' }));
}
