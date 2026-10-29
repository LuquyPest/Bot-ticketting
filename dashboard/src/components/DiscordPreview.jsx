import React from 'react';

// How a message will look on Discord: **bold**, *italic*, __underline__, ~~strike~~, ||spoiler||,
// `code`, ```blocks```, > quotes, # titles, -# small text, lists and [masked](https://links).
// Built as React elements (never raw HTML), so whatever is typed stays inert.
const INLINE = /(`[^`\n]+`)|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\|\|([\s\S]+?)\|\||\*([^*\n]+?)\*|_([^_\n]+?)_|(https?:\/\/[^\s<>"]+)/;

function inline(text, key = 'i') {
  const out = [];
  let rest = text, n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index) out.push(rest.slice(0, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="px-1 rounded-sm bg-overlay/10 font-mono text-[0.85em]">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<a key={k} href={m[3]} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{inline(m[2], k)}</a>);
    else if (m[4]) out.push(<strong key={k}>{inline(m[4], k)}</strong>);
    else if (m[5]) out.push(<u key={k}>{inline(m[5], k)}</u>);
    else if (m[6]) out.push(<s key={k}>{inline(m[6], k)}</s>);
    else if (m[7]) out.push(<span key={k} className="rounded-sm bg-ink-1/80 text-transparent hover:bg-overlay/10 hover:text-inherit transition-colors" title="Spoiler">{inline(m[7], k)}</span>);
    else if (m[8] || m[9]) out.push(<em key={k}>{inline(m[8] || m[9], k)}</em>);
    else out.push(<a key={k} href={m[10]} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all">{m[10]}</a>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export default function DiscordPreview({ text }) {
  const blocks = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      blocks.push(<pre key={i} className="my-1 p-2 rounded-md bg-overlay/10 font-mono text-xs whitespace-pre-wrap">{code.join('\n')}</pre>);
      continue;
    }
    const list = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items = [];
      for (; i < lines.length; i++) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m || /\d/.test(m[1]) !== ordered) { i--; break; }
        items.push(<li key={i}>{inline(m[2], `l${i}`)}</li>);
      }
      blocks.push(ordered ? <ol key={`o${i}`} className="list-decimal pl-5">{items}</ol> : <ul key={`u${i}`} className="list-disc pl-5">{items}</ul>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = ['text-xl', 'text-lg', 'text-base'][h[1].length - 1];
      blocks.push(<p key={i} className={`${size} font-bold`}>{inline(h[2], `h${i}`)}</p>);
      continue;
    }
    if (line.startsWith('-# ')) { blocks.push(<p key={i} className="text-[11px] text-ink-4">{inline(line.slice(3), `s${i}`)}</p>); continue; }
    if (line.startsWith('>>> ')) {
      blocks.push(<blockquote key={i} className="border-l-4 border-overlay/20 pl-2.5">{lines.slice(i).map((l, j) => <p key={j}>{inline(j ? l : l.slice(4), `q${i}-${j}`)}</p>)}</blockquote>);
      break;
    }
    if (line.startsWith('> ')) { blocks.push(<blockquote key={i} className="border-l-4 border-overlay/20 pl-2.5">{inline(line.slice(2), `q${i}`)}</blockquote>); continue; }
    blocks.push(<p key={i} className="min-h-[1.25em]">{inline(line, `p${i}`)}</p>);
  }
  return <div translate="no" className="text-sm text-ink-1 leading-relaxed wrap-break-word">{blocks}</div>;
}
