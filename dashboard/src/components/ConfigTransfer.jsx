import React, { useRef, useState } from 'react';
import { Download, Upload, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';
import { confirmToast } from '../utils/confirmToast';

const SECTION_LABELS = {
  grades: 'grades', tags: 'tags', forms: 'formulaires', panels: 'panels', fields: 'champs',
  faq: 'entrées de FAQ', templates: 'modèles', subjectRules: 'règles', procedures: 'procédures', config: 'paramètres',
};

// Export / import of the server configuration (merge by name, nothing deleted)
export default function ConfigTransfer() {
  const fileRef = useRef(null);
  const [withIds, setWithIds] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast.error('Fichier JSON illisible'); }
    if (!await confirmToast(`Importer la configuration${data.guildName ? ` de « ${data.guildName} »` : ''} ? Les éléments de même nom seront mis à jour, rien ne sera supprimé.`)) return;
    setBusy(true);
    try {
      const { data: res } = await api.post('/config/import', { data, includeDiscordIds: withIds });
      const summary = Object.entries(res.report).map(([k, v]) => `${SECTION_LABELS[k] || k} : ${v.created ? `${v.created} créé(s)` : ''}${v.created && v.updated ? ', ' : ''}${v.updated ? `${v.updated} mis à jour` : ''}`).join(' · ');
      toast.success(`Import terminé — ${summary || 'rien à importer'}. Recharge la page pour voir les paramètres.`, { duration: 9000 });
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">
        Exporte la configuration (paramètres, grades, tags, formulaires, panels, champs, FAQ, modèles partagés, règles) pour la sauvegarder ou la copier sur un autre serveur.
        Les secrets ne sont jamais exportés. À l'import, les éléments sont fusionnés par nom ; les panels doivent ensuite être republiés.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a href="/api/config/export" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-ink-1 border border-overlay/8 hover:bg-overlay/5">
          <Download size={13} /> Exporter (JSON)
        </a>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-ink-1 border border-overlay/8 hover:bg-overlay/5 disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Importer…
        </button>
        <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <input type="checkbox" checked={withIds} onChange={e => setWithIds(e.target.checked)} />
          Reprendre aussi les salons et rôles Discord (même serveur uniquement)
        </label>
      </div>
    </div>
  );
}
