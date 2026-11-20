import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FileText, Folder, FolderPlus, GripVertical, Pencil, Trash2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Base de connaissances → Arborescence (v8, utils/kbTree.js): categories on three levels, the
// order of categories and articles set by drag and drop — drop on a category to put inside it, on
// an item to put before it. The arrows and « Déplacer vers » do the same from the keyboard.
const INPUT = 'bg-surface border border-overlay/8 text-ink-1 rounded-lg px-2 py-1 text-xs focus:outline-hidden focus:border-primary';

function flatten(nodes, depth = 0, out = []) {
  for (const n of nodes) { out.push({ ...n, depth }); flatten(n.children, depth + 1, out); }
  return out;
}

export default function KbTree({ canEdit, onOpenArticle, onChange }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});
  const [drag, setDrag] = useState(null); // { kind, id }
  const [over, setOver] = useState(null);
  const [name, setName] = useState('');
  const load = () => api.get('/faq/tree').then(r => setData({ categories: Array.isArray(r.data?.categories) ? r.data.categories : [], articles: Array.isArray(r.data?.articles) ? r.data.articles : [] })).catch(() => setData({ categories: [], articles: [] }));
  useEffect(() => { load(); }, []);
  if (!data) return null;
  const set = r => setData({ categories: r.data.categories || [], articles: r.data.articles || [] });
  const call = async p => { try { set(await p); onChange?.(); } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); } };
  const move = (kind, id, parentId, index) => call(api.post('/faq/move', { kind, id, parentId, index }));
  const all = flatten(data.categories);
  const articlesOf = cid => data.articles.filter(a => (a.categoryId || null) === cid);
  const siblingsOf = c => (c.parentId ? all.find(x => x.id === c.parentId)?.children || [] : data.categories);
  const add = parentId => { const n = parentId ? window.prompt('Nom de la sous-catégorie') : name; if (!n?.trim()) return; call(api.post('/faq/categories', { name: n, parentId })); if (!parentId) setName(''); };
  const rename = c => { const n = window.prompt('Nouveau nom', c.name); if (n?.trim() && n !== c.name) call(api.patch(`/faq/categories/${c.id}`, { name: n })); };
  const remove = c => { if (window.confirm(`Supprimer la catégorie « ${c.name} » ? Ses articles et sous-catégories remontent d'un niveau.`)) call(api.delete(`/faq/categories/${c.id}`)); };
  const dragProps = (kind, id) => canEdit ? { draggable: true, onDragStart: e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${kind}:${id}`); setDrag({ kind, id }); }, onDragEnd: () => { setDrag(null); setOver(null); } } : {};
  // Drop zone: inside a category (parentId), or before an item (parentId + index)
  const dropProps = (key, parentId, index = null) => canEdit ? {
    onDragOver: e => { if (drag) { e.preventDefault(); e.stopPropagation(); setOver(key); } },
    onDragLeave: () => setOver(o => (o === key ? null : o)),
    onDrop: e => { e.preventDefault(); e.stopPropagation(); if (drag) move(drag.kind, drag.id, parentId, index); setDrag(null); setOver(null); },
  } : {};
  const ring = key => (over === key ? 'ring-1 ring-primary/60 bg-primary/5' : '');
  const moveTo = (kind, id) => e => { const v = e.target.value; e.target.value = ''; if (v !== '') move(kind, id, v === 'root' ? null : Number(v), null); };

  const renderArticle = (a, index, parentId) => (
    <li key={`a${a.id}`} {...dragProps('article', a.id)} {...dropProps(`a${a.id}`, parentId, index)} className={`flex items-center gap-1.5 text-xs rounded-md px-1.5 py-1 ${ring(`a${a.id}`)}`}>
      {canEdit && <GripVertical size={12} className="text-ink-4 cursor-grab shrink-0" aria-hidden="true" />}
      <FileText size={12} className="text-ink-4 shrink-0" aria-hidden="true" />
      <button type="button" onClick={() => onOpenArticle?.(a.id)} className={`text-left truncate hover:underline ${a.status === 'draft' || !a.active ? 'text-ink-4' : 'text-ink-1'}`}>{a.question}</button>
      {a.status === 'draft' && <span className="text-[10px] text-ink-4">brouillon</span>}
      {canEdit && (
        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          <button type="button" disabled={index === 0} onClick={() => move('article', a.id, parentId, index - 1)} aria-label={`Monter « ${a.question} »`} className="p-0.5 text-ink-4 hover:text-ink-1 disabled:opacity-30"><ArrowUp size={11} /></button>
          <button type="button" disabled={index === articlesOf(parentId).length - 1} onClick={() => move('article', a.id, parentId, index + 1)} aria-label={`Descendre « ${a.question} »`} className="p-0.5 text-ink-4 hover:text-ink-1 disabled:opacity-30"><ArrowDown size={11} /></button>
          <select onChange={moveTo('article', a.id)} defaultValue="" aria-label={`Déplacer « ${a.question} » vers`} className="bg-transparent text-[10px] text-ink-4 w-5">
            <option value="" disabled>Déplacer vers…</option><option value="root">Sans catégorie</option>
            {all.map(c => <option key={c.id} value={c.id}>{`${'· '.repeat(c.depth)}${c.name}`}</option>)}
          </select>
        </span>
      )}
    </li>
  );
  const renderCategory = (c, index) => {
    const isOpen = open[c.id] !== false;
    const arts = articlesOf(c.id);
    const sibs = siblingsOf(c);
    return (
      <li key={`c${c.id}`}>
        <div {...dragProps('category', c.id)} {...dropProps(`c${c.id}`, c.id)} className={`flex items-center gap-1.5 text-xs rounded-md px-1.5 py-1 ${ring(`c${c.id}`)}`}>
          {canEdit && <GripVertical size={12} className="text-ink-4 cursor-grab shrink-0" aria-hidden="true" />}
          <button type="button" onClick={() => setOpen(o => ({ ...o, [c.id]: !isOpen }))} aria-expanded={isOpen} aria-label={`${isOpen ? 'Replier' : 'Déplier'} « ${c.name} »`} className="text-ink-4">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
          <Folder size={12} className="text-primary-light shrink-0" aria-hidden="true" />
          <span className="font-semibold text-ink-1 truncate">{c.name}</span>
          <span className="text-[10px] text-ink-4">{arts.length}</span>
          {canEdit && (
            <span className="ml-auto flex items-center gap-0.5 shrink-0">
              <button type="button" disabled={index === 0} onClick={() => move('category', c.id, c.parentId, index - 1)} aria-label={`Monter « ${c.name} »`} className="p-0.5 text-ink-4 hover:text-ink-1 disabled:opacity-30"><ArrowUp size={11} /></button>
              <button type="button" disabled={index === sibs.length - 1} onClick={() => move('category', c.id, c.parentId, index + 1)} aria-label={`Descendre « ${c.name} »`} className="p-0.5 text-ink-4 hover:text-ink-1 disabled:opacity-30"><ArrowDown size={11} /></button>
              {c.depth < 2 && <button type="button" onClick={() => add(c.id)} aria-label={`Sous-catégorie dans « ${c.name} »`} className="p-0.5 text-ink-4 hover:text-ink-1"><FolderPlus size={11} /></button>}
              <button type="button" onClick={() => rename(c)} aria-label={`Renommer « ${c.name} »`} className="p-0.5 text-ink-4 hover:text-ink-1"><Pencil size={11} /></button>
              <button type="button" onClick={() => remove(c)} aria-label={`Supprimer « ${c.name} »`} className="p-0.5 text-ink-4 hover:text-red-400"><Trash2 size={11} /></button>
            </span>
          )}
        </div>
        {isOpen && (
          <ul className="ml-5 border-l border-overlay/6 pl-2 space-y-0.5">
            {c.children.map((k, i) => renderCategory({ ...k, depth: c.depth + 1 }, i))}
            {arts.map((a, i) => renderArticle(a, i, c.id))}
          </ul>
        )}
      </li>
    );
  };
  const loose = articlesOf(null);
  return (
    <div className="space-y-2">
      <ul className="space-y-0.5" aria-label="Arborescence de la base">
        {data.categories.map((c, i) => renderCategory({ ...c, depth: 0 }, i))}
      </ul>
      <div {...dropProps('root', null)} className={`rounded-lg border border-dashed border-overlay/10 p-2 ${ring('root')}`}>
        <p className="text-[11px] text-ink-4 mb-1">Sans catégorie</p>
        <ul className="space-y-0.5">{loose.map((a, i) => renderArticle(a, i, null))}</ul>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add(null)} placeholder="Nouvelle catégorie" aria-label="Nouvelle catégorie" className={INPUT} />
          <button type="button" onClick={() => add(null)} disabled={!name.trim()} className="px-3 py-1 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-50">Ajouter</button>
        </div>
      )}
      {canEdit && <p className="text-[11px] text-ink-4">Glisse une catégorie ou un article : sur une catégorie pour l'y mettre, sur un élément pour le placer avant lui. Les flèches et « Déplacer vers » font de même au clavier. Trois niveaux au plus.</p>}
    </div>
  );
}
