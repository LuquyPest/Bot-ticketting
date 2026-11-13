// Interface skin of the dashboard: « classic » (default) or « pro » (neutral palette, square
// corners, no glass, gradient, glow or entrance animation — see index.css). Applied through
// html[data-ui] before the first paint from localStorage, then aligned on the account preference.
const KEY = 'uiSkin';
export const SKINS = ['classic', 'pro'];
export const SKIN_LABELS = { classic: 'Classique', pro: 'Pro' };

export function readSkin() {
  try { return localStorage.getItem(KEY) === 'pro' ? 'pro' : 'classic'; } catch { return 'classic'; }
}

export function applySkin(skin) {
  const next = SKINS.includes(skin) ? skin : 'classic';
  if (next === 'pro') document.documentElement.dataset.ui = 'pro';
  else delete document.documentElement.dataset.ui;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent('skin:change', { detail: next }));
}

// Skin saved on the account (chosen on another browser): wins over the local one
export function adoptAccountSkin(skin) {
  if (SKINS.includes(skin) && skin !== readSkin()) applySkin(skin);
}
