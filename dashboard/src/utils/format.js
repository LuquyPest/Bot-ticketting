import { uiLocale } from '../i18n';

export function fmtDate(d, opts = { dateStyle: 'short', timeStyle: 'short' }) {
  if (!d) return '—';
  return new Date(d).toLocaleString(uiLocale(), opts);
}

export function fmtDuration(s) {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${(s / 3600).toFixed(1)}h`;
}
