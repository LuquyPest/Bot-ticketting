import React from 'react';
import { Bold, Italic, Code, Link2, List, ListOrdered, Quote } from 'lucide-react';

// Rich editing of replies and notes (v5.4): Markdown inserted around the selection — what
// Discord, the e-mails (utils/emailFormat.js) and the member space already render, escaped.
// Ctrl/Cmd+B bold, +I italic, +K link, +E code, from the text area (formatKeys).
const WRAP = { bold: ['**', '**'], italic: ['*', '*'], code: ['`', '`'] };
const LINE = { list: '- ', ordered: '1. ', quote: '> ' };

export function applyFormat(el, value, kind) {
  const start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? value.length;
  const sel = value.slice(start, end);
  let text, a, b;
  if (WRAP[kind]) {
    const [l, r] = WRAP[kind];
    const inner = sel || (kind === 'bold' ? 'gras' : kind === 'italic' ? 'italique' : 'code');
    text = `${value.slice(0, start)}${l}${inner}${r}${value.slice(end)}`;
    a = start + l.length; b = a + inner.length;
  } else if (kind === 'link') {
    const label = sel || 'texte';
    text = `${value.slice(0, start)}[${label}](https://)${value.slice(end)}`;
    a = start + label.length + 3; b = a + 8;
  } else {
    // Each line of the selection (or the current line) gets the prefix
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(from, end) || '';
    const lines = block.split('\n').map((l, i) => (kind === 'ordered' ? `${i + 1}. ${l}` : `${LINE[kind]}${l}`));
    text = `${value.slice(0, from)}${lines.join('\n')}${value.slice(end)}`;
    a = from; b = from + lines.join('\n').length;
  }
  return { text, a, b };
}

export function formatKeys(e, value, setValue) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const kind = { b: 'bold', i: 'italic', k: 'link', e: 'code' }[e.key.toLowerCase()];
  if (!kind) return false;
  e.preventDefault();
  const el = e.currentTarget;
  const { text, a, b } = applyFormat(el, value, kind);
  setValue(text);
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a, b); });
  return true;
}

const BUTTONS = [['bold', Bold, 'Gras (Ctrl+B)'], ['italic', Italic, 'Italique (Ctrl+I)'], ['code', Code, 'Code (Ctrl+E)'], ['link', Link2, 'Lien (Ctrl+K)'],
  ['list', List, 'Liste à puces'], ['ordered', ListOrdered, 'Liste numérotée'], ['quote', Quote, 'Citation']];

export default function FormatBar({ textareaRef, value, setValue, disabled = false }) {
  const apply = kind => {
    const el = textareaRef.current;
    const { text, a, b } = applyFormat(el, value, kind);
    setValue(text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a, b); });
  };
  return (
    <div role="toolbar" aria-label="Mise en forme" className="flex items-center gap-0.5 mb-1">
      {BUTTONS.map(([kind, Icon, label]) => (
        <button key={kind} type="button" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => apply(kind)} aria-label={label} title={label}
          className="p-1.5 rounded-md text-ink-3 hover:text-ink-1 hover:bg-overlay/6 disabled:opacity-40"><Icon size={13} /></button>
      ))}
    </div>
  );
}
