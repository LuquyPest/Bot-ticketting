import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, X, Send, Unlink, Loader2, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

const BASE = "w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors";

const BUTTON_STYLES = [
  { value: 'primary',   label: 'Bleu',    color: 'bg-[#5865f2] text-white' },
  { value: 'secondary', label: 'Gris',    color: 'bg-[#4e5058] text-white' },
  { value: 'success',   label: 'Vert',    color: 'bg-[#248046] text-white' },
  { value: 'danger',    label: 'Rouge',   color: 'bg-[#da373c] text-white' },
];

const EMPTY_BUTTON = () => ({ label: '', emoji: '', style: 'primary', subject: '', form_id: null });

// ─── Embed Preview ───────────────────────────────────────────────────────────

function EmbedPreview({ panel }) {
  const color = panel.color || '#6366f1';
  const styleMap = { primary: 'bg-[#5865f2]', secondary: 'bg-[#4e5058]', success: 'bg-[#248046]', danger: 'bg-[#da373c]' };
  return (
    <div className="rounded-xl overflow-hidden bg-[#2b2d31] shadow-xl max-w-md">
      <div className="flex">
        <div className="w-1 flex-shrink-0 rounded-l-xl" style={{ backgroundColor: color }} />
        <div className="p-4 flex-1 space-y-2">
          {panel.title && (
            <p className="font-semibold text-white text-sm leading-tight">{panel.title}</p>
          )}
          {panel.description && (
            <p className="text-[#dbdee1] text-xs leading-relaxed whitespace-pre-wrap">{panel.description}</p>
          )}
          {panel.image_url && (
            <img src={panel.image_url} alt="" className="rounded-lg max-w-full mt-2" onError={e => e.target.style.display = 'none'} />
          )}
          {panel.footer_text && (
            <p className="text-[#949ba4] text-[10px] pt-1 border-t border-white/10">{panel.footer_text}</p>
          )}
        </div>
      </div>
      {panel.buttons?.length > 0 && (
        <div className="px-4 pb-4 pt-1 flex flex-wrap gap-2">
          {panel.buttons.map((btn, i) => (
            <button key={i} className={`px-4 py-1.5 rounded text-sm font-medium ${styleMap[btn.style] || styleMap.primary} flex items-center gap-1.5`}>
              {btn.emoji && <span>{btn.emoji}</span>}
              {btn.label || 'Bouton'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Button Editor Row ────────────────────────────────────────────────────────

function ButtonRow({ btn, index, total, forms, onChange, onRemove, onMove }) {
  return (
    <div className="bg-surface border border-white/[0.06] rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-3 flex-1">Bouton {index + 1}</span>
        <button onClick={() => onMove(index, -1)} disabled={index === 0} className="p-1 text-ink-4 hover:text-ink-2 disabled:opacity-30">
          <ChevronUp size={13} />
        </button>
        <button onClick={() => onMove(index, 1)} disabled={index === total - 1} className="p-1 text-ink-4 hover:text-ink-2 disabled:opacity-30">
          <ChevronDown size={13} />
        </button>
        <button onClick={() => onRemove(index)} className="p-1 text-red-400/60 hover:text-red-400">
          <X size={13} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_80px_120px] gap-2">
        <input type="text" value={btn.label} maxLength={80}
          onChange={e => onChange(index, 'label', e.target.value)}
          placeholder="Label du bouton" className={BASE} />
        <input type="text" value={btn.emoji} maxLength={50}
          onChange={e => onChange(index, 'emoji', e.target.value)}
          placeholder="🎫" className={BASE + " text-center"} />
        <select value={btn.style} onChange={e => onChange(index, 'style', e.target.value)} className={BASE + " cursor-pointer"}>
          {BUTTON_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-ink-4 mb-1 block">Sujet de ticket (optionnel)</label>
          <input type="text" value={btn.subject} maxLength={100}
            onChange={e => onChange(index, 'subject', e.target.value)}
            placeholder="Ex: Bug, Achat…" className={BASE} />
        </div>
        <div>
          <label className="text-[10px] text-ink-4 mb-1 block">Formulaire (optionnel)</label>
          <select value={btn.form_id ?? ''} onChange={e => onChange(index, 'form_id', e.target.value ? parseInt(e.target.value) : null)}
            className={BASE + " cursor-pointer"}>
            <option value="">— Aucun —</option>
            {forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── Panel Editor ─────────────────────────────────────────────────────────────

function PanelEditor({ panel, forms, channels, onSave, onCancel }) {
  const [name,        setName]        = useState(panel?.name        || '');
  const [title,       setTitle]       = useState(panel?.title       || 'Support');
  const [description, setDescription] = useState(panel?.description || '');
  const [color,       setColor]       = useState(panel?.color       || '#6366f1');
  const [footerText,  setFooterText]  = useState(panel?.footer_text || '');
  const [imageUrl,    setImageUrl]    = useState(panel?.image_url   || '');
  const [buttons,     setButtons]     = useState(panel?.buttons?.map(b => ({ ...b })) || []);
  const [saving,      setSaving]      = useState(false);
  const [preview,     setPreview]     = useState(true);

  const previewData = { title, description, color, footer_text: footerText, image_url: imageUrl, buttons };

  const addButton = () => {
    if (buttons.length >= 25) { toast.error('Maximum 25 boutons'); return; }
    setButtons(b => [...b, EMPTY_BUTTON()]);
  };

  const removeButton = (i) => setButtons(b => b.filter((_, idx) => idx !== i));
  const changeButton = (i, key, val) => setButtons(b => b.map((btn, idx) => idx === i ? { ...btn, [key]: val } : btn));
  const moveButton   = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= buttons.length) return;
    setButtons(b => { const a = [...b]; [a[i], a[j]] = [a[j], a[i]]; return a; });
  };

  const save = async () => {
    if (!name.trim())  { toast.error('Nom requis');  return; }
    if (!title.trim()) { toast.error('Titre requis'); return; }
    if (buttons.some(b => !b.label.trim())) { toast.error('Tous les boutons doivent avoir un label'); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), title: title.trim(),
        description: description.trim() || null,
        color,
        footer_text: footerText.trim() || null,
        image_url:   imageUrl.trim()   || null,
        buttons,
      };
      let result;
      if (panel?.id) {
        result = await api.patch(`/panels/${panel.id}`, payload);
      } else {
        result = await api.post('/panels', payload);
      }
      toast.success(panel?.id ? 'Panel mis à jour !' : 'Panel créé !');
      onSave(result.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_auto] gap-6">
      {/* Form */}
      <div className="space-y-4 min-w-0">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-ink-3 block mb-1">Nom interne <span className="text-red-400">*</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={100}
              placeholder="Ex: Panel principal" className={BASE} />
          </div>
          <div>
            <label className="text-xs text-ink-3 block mb-1">Titre de l'embed <span className="text-red-400">*</span></label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={256}
              placeholder="Support" className={BASE} />
          </div>
        </div>

        <div>
          <label className="text-xs text-ink-3 block mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={2000}
            placeholder="Clique sur un bouton pour ouvrir un ticket…" className={BASE + " resize-none"} />
        </div>

        <div className="grid grid-cols-[auto_1fr_1fr] gap-3 items-end">
          <div>
            <label className="text-xs text-ink-3 block mb-1">Couleur</label>
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              className="w-10 h-9 rounded-lg border border-white/[0.08] bg-transparent cursor-pointer p-0.5" />
          </div>
          <div>
            <label className="text-xs text-ink-3 block mb-1">URL image</label>
            <input type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder="https://…" className={BASE} />
          </div>
          <div>
            <label className="text-xs text-ink-3 block mb-1">Footer</label>
            <input type="text" value={footerText} onChange={e => setFooterText(e.target.value)} maxLength={256}
              placeholder="Texte de pied" className={BASE} />
          </div>
        </div>

        {/* Buttons */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-3">Boutons ({buttons.length}/25)</span>
            <button onClick={addButton}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              <Plus size={12} /> Ajouter un bouton
            </button>
          </div>
          {buttons.length === 0 && (
            <p className="text-xs text-ink-4 text-center py-4 border border-dashed border-white/[0.08] rounded-xl">
              Aucun bouton — clique sur "Ajouter un bouton"
            </p>
          )}
          {buttons.map((btn, i) => (
            <ButtonRow key={i} btn={btn} index={i} total={buttons.length} forms={forms}
              onChange={changeButton} onRemove={removeButton} onMove={moveButton} />
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light text-white text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-surface transition-colors text-sm">
            Annuler
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="w-80 flex-shrink-0">
        <div className="sticky top-6">
          <div className="flex items-center gap-2 mb-3">
            <Eye size={13} className="text-ink-4" />
            <span className="text-xs font-semibold text-ink-3">Prévisualisation</span>
          </div>
          <EmbedPreview panel={previewData} />
        </div>
      </div>
    </div>
  );
}

// ─── Publish Modal ────────────────────────────────────────────────────────────

function PublishModal({ panel, channels, onPublish, onUnpublish, onClose }) {
  const [channelId, setChannelId] = useState(panel.channel_id || '');
  const [loading, setLoading]     = useState(false);

  const publish = async () => {
    if (!channelId) { toast.error('Sélectionne un salon'); return; }
    setLoading(true);
    try {
      await api.post(`/panels/${panel.id}/publish`, { channel_id: channelId });
      toast.success('Panel publié !');
      onPublish(channelId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la publication');
    } finally {
      setLoading(false);
    }
  };

  const unpublish = async () => {
    if (!confirm('Retirer le message Discord ?')) return;
    setLoading(true);
    try {
      await api.delete(`/panels/${panel.id}/publish`);
      toast.success('Message Discord supprimé');
      onUnpublish();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-card border border-white/[0.08] rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-1">Publier le panel</h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink-2"><X size={16} /></button>
        </div>

        <div>
          <label className="text-xs text-ink-3 block mb-1">Salon de destination</label>
          {channels.length > 0 ? (
            <select value={channelId} onChange={e => setChannelId(e.target.value)} className={BASE + " cursor-pointer"}>
              <option value="">— Choisir un salon —</option>
              {channels.map(ch => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
            </select>
          ) : (
            <input type="text" value={channelId} onChange={e => setChannelId(e.target.value)}
              placeholder="ID du salon Discord" className={BASE} />
          )}
        </div>

        {panel.message_id && (
          <p className="text-xs text-ink-4 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            Un message est déjà publié. Le republier le mettra à jour ou le redéplacera dans le nouveau salon.
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={publish} disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light text-white text-sm font-medium transition-colors disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Publier
          </button>
          {panel.message_id && (
            <button onClick={unpublish} disabled={loading}
              className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors disabled:opacity-50">
              <Unlink size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Panels() {
  const [panels,   setPanels]   = useState([]);
  const [forms,    setForms]    = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);
  const [publishing, setPublishing] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/panels'),
      api.get('/forms'),
      api.get('/discord/channels').catch(() => ({ data: [] })),
    ]).then(([p, f, ch]) => {
      setPanels(p.data);
      setForms(f.data);
      setChannels(ch.data);
    }).catch(() => toast.error('Erreur de chargement')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const deletePanel = async (p) => {
    if (!confirm(`Supprimer le panel "${p.name}" ? Le message Discord sera aussi supprimé.`)) return;
    try {
      await api.delete(`/panels/${p.id}`);
      toast.success('Panel supprimé');
      setPanels(prev => prev.filter(x => x.id !== p.id));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const handleSave = (saved) => {
    setPanels(prev => {
      const idx = prev.findIndex(p => p.id === saved.id);
      return idx >= 0 ? prev.map(p => p.id === saved.id ? saved : p) : [saved, ...prev];
    });
    setEditing(null);
  };

  const handlePublish = (channelId) => {
    setPanels(prev => prev.map(p => p.id === publishing.id ? { ...p, channel_id: channelId } : p));
    setPublishing(null);
  };

  const handleUnpublish = () => {
    setPanels(prev => prev.map(p => p.id === publishing.id ? { ...p, channel_id: null, message_id: null } : p));
    setPublishing(null);
  };

  const channelName = (id) => channels.find(c => c.id === id)?.name;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {publishing && (
        <PublishModal
          panel={publishing}
          channels={channels}
          onPublish={handlePublish}
          onUnpublish={handleUnpublish}
          onClose={() => setPublishing(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-1">Panels</h1>
          <p className="text-sm text-ink-3 mt-0.5">Embeds Discord avec boutons pour ouvrir des tickets</p>
        </div>
        {!editing && (
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light text-white text-sm font-medium transition-colors">
            <Plus size={15} /> Nouveau panel
          </button>
        )}
      </div>

      {editing && (
        <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-ink-2 mb-5">
            {editing === 'new' ? 'Nouveau panel' : `Modifier — ${editing.name}`}
          </h2>
          <PanelEditor
            panel={editing === 'new' ? null : editing}
            forms={forms}
            channels={channels}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-ink-4" size={22} /></div>
      ) : panels.length === 0 && !editing ? (
        <div className="text-center py-12 text-ink-4 text-sm">Aucun panel créé.</div>
      ) : (
        <div className="space-y-3">
          {panels.map(p => (
            <div key={p.id} className="bg-surface-card border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-start gap-4">
                {/* Color swatch */}
                <div className="w-2 h-14 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: p.color || '#6366f1' }} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink-1">{p.name}</span>
                    {p.channel_id && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                        Publié #{channelName(p.channel_id) || p.channel_id}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-3 mt-0.5">{p.title}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.buttons?.map((btn, i) => {
                      const styleMap = { primary: 'bg-[#5865f2]/20 text-[#8891f2]', secondary: 'bg-white/5 text-ink-3', success: 'bg-green-500/20 text-green-400', danger: 'bg-red-500/20 text-red-400' };
                      return (
                        <span key={i} className={`text-[10px] px-2 py-0.5 rounded font-medium ${styleMap[btn.style] || styleMap.primary}`}>
                          {btn.emoji && `${btn.emoji} `}{btn.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setPublishing(p)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 transition-colors font-medium">
                    <Send size={12} /> Publier
                  </button>
                  <button onClick={() => setEditing(p)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-ink-2 transition-colors">
                    Modifier
                  </button>
                  <button onClick={() => deletePanel(p)}
                    className="p-1.5 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
