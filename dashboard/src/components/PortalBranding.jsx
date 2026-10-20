import React, { useRef } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { contrastRatio, readableText } from '../utils/color';

// Image → square PNG data URL of at most 256 px (stored in the configuration, no external host)
function resizeToDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = URL.createObjectURL(file);
  });
}

// Member space appearance for this server: logo, accent colour, welcome text
export default function PortalBranding({ cfg, set }) {
  const fileRef = useRef(null);
  const color = cfg.portalColor || '#6c5ce7';
  const text = readableText(color);
  const ratio = contrastRatio(color, text);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast.error('Image PNG, JPEG, WebP ou GIF attendue');
    try {
      const url = await resizeToDataUrl(file);
      if (url.length > 200000) return toast.error('Image trop lourde même réduite, choisis-en une plus simple');
      set('portalLogo', url);
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-overlay/6 bg-overlay/2 p-3">
      <p className="text-xs font-semibold text-ink-2">Apparence de l'espace membre</p>
      <div className="flex flex-wrap items-center gap-3">
        {cfg.portalLogo
          ? <img src={cfg.portalLogo} alt="Logo actuel" className="w-12 h-12 rounded-xl object-cover border border-overlay/8" />
          : <span className="w-12 h-12 rounded-xl border border-dashed border-overlay/15 text-[10px] text-ink-4 flex items-center justify-center text-center leading-tight">icône<br />Discord</span>}
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-overlay/8 text-xs text-ink-2 hover:text-ink-1">
          <Upload size={12} /> {cfg.portalLogo ? 'Changer le logo' : 'Importer un logo'}
        </button>
        {cfg.portalLogo && (
          <button type="button" onClick={() => set('portalLogo', null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-ink-3 hover:text-red-400">
            <Trash2 size={12} /> Retirer
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onFile} className="hidden" aria-label="Logo de l'espace membre" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-3" htmlFor="portal-color">Couleur</label>
        <input id="portal-color" type="color" value={color} onChange={e => set('portalColor', e.target.value)} className="w-9 h-8 rounded-lg border border-overlay/8 bg-transparent cursor-pointer p-0.5" />
        <input value={cfg.portalColor || ''} onChange={e => set('portalColor', e.target.value || null)} placeholder="#6c5ce7" maxLength={7} aria-label="Couleur (hexadécimal)"
          className="w-24 bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1.5 text-xs font-mono" />
        <span className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: color, color: text }}>Aperçu du bouton</span>
        {ratio < 4.5 && <span className="text-[11px] text-amber-400">Contraste faible ({ratio.toFixed(1)}:1) : texte difficile à lire</span>}
      </div>
      <label className="block">
        <span className="text-xs text-ink-3">Message d'accueil (affiché en haut des pages de ce serveur)</span>
        <textarea value={cfg.portalWelcome || ''} onChange={e => set('portalWelcome', e.target.value || null)} maxLength={500} rows={2}
          placeholder="Bienvenue sur le support de Sunset ! Réponse sous 24 h en semaine."
          className="mt-1 w-full bg-surface border border-overlay/8 text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm" />
      </label>
    </div>
  );
}
