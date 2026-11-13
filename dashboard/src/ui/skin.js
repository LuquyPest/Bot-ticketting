// Interface skin of the dashboard: « pro » (default: neutral palette, square corners, no glass,
// gradient, glow or entrance animation — see index.css) or « classic ». Applied through
// html[data-ui] before the first paint from localStorage, then aligned on the account preference.
// Key renamed when Pro became the default: the old « uiSkin » held « classic » for everyone, chosen
// or not; an explicit choice is kept on the account and comes back through adoptAccountSkin.
const KEY = 'uiSkinV2';
export const SKINS = ['pro', 'classic'];
export const SKIN_LABELS = { pro: 'Pro', classic: 'Classique' };

export function readSkin() {
  try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'pro'; } catch { return 'pro'; }
}

export function applySkin(skin) {
  const next = SKINS.includes(skin) ? skin : 'pro';
  if (next === 'pro') document.documentElement.dataset.ui = 'pro';
  else delete document.documentElement.dataset.ui;
  try { localStorage.setItem(KEY, next); localStorage.removeItem('uiSkin'); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent('skin:change', { detail: next }));
}

// Skin saved on the account (chosen on another browser): wins over the local one
export function adoptAccountSkin(skin) {
  if (SKINS.includes(skin) && skin !== readSkin()) applySkin(skin);
}
