// Dashboard language (French source, English translation). The interface is written in French;
// in English, a French → English dictionary is applied to what is displayed — text nodes and the
// placeholder / title / aria-label / alt attributes — including what React renders later
// (MutationObserver). User content is never translated: messages, subjects, names and notes are
// rendered inside [translate="no"] (MessageContent, data cells), and the member space, guest and
// status pages carry data-no-translate. Missing entries simply stay in French.
const KEY = 'uiLang';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'INPUT']);

let lang = 'fr';
try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'fr'; } catch { /* storage unavailable */ }

export const getLang = () => lang;
export const uiLocale = () => (lang === 'en' ? 'en-GB' : 'fr-FR');

// Saves the choice and reloads the page (every text and date is rendered again in that language)
export async function setLang(next, { persist } = {}) {
  if (next !== 'fr' && next !== 'en') return;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  if (persist) await persist(next).catch(() => {});
  if (next !== lang) window.location.reload();
}

// Account preference read at sign-in (another browser, or after clearing the storage)
export function adoptAccountLang(accountLang) {
  if ((accountLang === 'fr' || accountLang === 'en') && accountLang !== lang) {
    try { localStorage.setItem(KEY, accountLang); } catch { /* storage unavailable */ }
    window.location.reload();
  }
}

let exact = null;
let patterns = [];
const norm = s => s.replace(/\s+/g, ' ').trim();

function compile(entries, templates) {
  exact = new Map(entries.map(([fr, en]) => [norm(fr), en]));
  // « {} ticket(s) trouvé(s) » → /^(.+?) ticket\(s\) trouvé\(s\)$/ ; English uses {1}, {2}…
  patterns = templates.map(([fr, en]) => {
    const src = norm(fr).split('{}').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
    return [new RegExp(`^${src}$`), en];
  });
}

function translateString(s) {
  const key = norm(s);
  if (!key || !/[A-Za-zÀ-ÿ]/.test(key)) return null;
  let en = exact.get(key);
  if (en === undefined) {
    for (const [re, tpl] of patterns) {
      const m = re.exec(key);
      if (m) { en = tpl.replace(/\{(\d)\}/g, (_, i) => translateString(m[Number(i)]) ?? m[Number(i)]); break; }
    }
  }
  if (en === undefined) return null;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  return lead + en + trail;
}

const done = new WeakMap(); // text node → the English text we wrote (to ignore our own mutations)

function excluded(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName) || e.getAttribute('translate') === 'no' || e.hasAttribute('data-no-translate') || e.isContentEditable) return true;
  }
  return false;
}

function translateTextNode(node) {
  if (done.get(node) === node.nodeValue) return;
  if (!node.parentElement || excluded(node.parentElement)) return;
  const en = translateString(node.nodeValue);
  if (en !== null && en !== node.nodeValue) { node.nodeValue = en; done.set(node, en); }
}

function translateAttrs(el) {
  if (excluded(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v || el.dataset[`i18n${a.replace('-', '')}`] === v) continue;
    const en = translateString(v);
    if (en !== null && en !== v) { el.setAttribute(a, en); el.dataset[`i18n${a.replace('-', '')}`] = en; }
  }
}

function translateTree(root) {
  if (root.nodeType === 3) return translateTextNode(root);
  if (root.nodeType !== 1 || excluded(root)) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) translateTextNode(n); else translateAttrs(n);
  }
}

// Starts translating the whole page (English only)
export async function startTranslation() {
  if (lang !== 'en') return;
  const { ENTRIES, TEMPLATES } = await import('./en.js');
  compile(ENTRIES, TEMPLATES);
  document.documentElement.lang = 'en';
  translateTree(document.body);
  const titleEn = translateString(document.title);
  if (titleEn) document.title = titleEn;
  new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'characterData') translateTextNode(m.target);
      else if (m.type === 'attributes') translateAttrs(m.target);
      else m.addedNodes.forEach(translateTree);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

export const _test = { translateString, compile };
