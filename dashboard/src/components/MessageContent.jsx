import React from 'react';
import { FileText } from 'lucide-react';

// Message text with clickable links; Discord attachments become image previews (or a file chip),
// loaded through /api/attachment so expired Discord links are re-signed on the fly.
const URL_RE = /(https?:\/\/[^\s<>"]+)/g;
const DISCORD_ATTACHMENT = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/(ephemeral-)?attachments\//;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

const proxied = url => `/api/attachment?u=${encodeURIComponent(url)}`;
const fileName = url => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { return 'fichier'; } };
const pathOf = url => { try { return new URL(url).pathname; } catch { return ''; } };

export function attachmentsOf(text) {
  return (String(text || '').match(URL_RE) || []).filter(u => DISCORD_ATTACHMENT.test(u));
}

export default function MessageContent({ text, linkClass = 'underline break-all', light = false }) {
  const content = String(text || '');
  const files = attachmentsOf(content);
  // Attachment links are shown as previews below the text, not as raw URLs
  // ("📎 photo.png : <url>" becomes "📎 photo.png"; a line holding only the link disappears)
  const body = files.length
    ? content.split('\n').flatMap(line => {
        const hadFile = files.some(f => line.includes(f));
        const rest = files.reduce((l, f) => l.replace(f, ''), line).replace(/\s*:\s*$/, '').trimEnd();
        return hadFile && !rest.trim() ? [] : [rest];
      }).join('\n').trim()
    : content;

  return (
    <>
      {body && (
        <span className="whitespace-pre-wrap wrap-break-word">
          {body.split(URL_RE).map((part, i) => (i % 2 === 1
            ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={linkClass}>{part}</a>
            : part))}
        </span>
      )}
      {files.length > 0 && (
        <span className={`flex flex-wrap gap-2 ${body ? 'mt-2' : ''}`}>
          {files.map(f => {
            const p = pathOf(f);
            if (IMAGE_EXT.test(p)) return (
              <a key={f} href={proxied(f)} target="_blank" rel="noopener noreferrer" className="block">
                <img src={proxied(f)} alt={fileName(f)} loading="lazy"
                  className="max-h-60 max-w-full sm:max-w-xs rounded-lg border border-overlay/10 object-contain bg-overlay/4" />
              </a>
            );
            if (VIDEO_EXT.test(p)) return (
              <video key={f} src={proxied(f)} controls preload="metadata" className="max-h-60 max-w-full sm:max-w-xs rounded-lg" />
            );
            return (
              <a key={f} href={proxied(f)} target="_blank" rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs
                            ${light ? 'border-white/30 text-white' : 'border-overlay/10 text-ink-2 hover:text-ink-1'}`}>
                <FileText size={12} /> {fileName(f)}
              </a>
            );
          })}
        </span>
      )}
    </>
  );
}
