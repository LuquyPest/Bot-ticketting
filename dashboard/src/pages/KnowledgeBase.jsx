import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, FileText, Loader2, Search, LifeBuoy } from 'lucide-react';
import api from '../api';
import MessageContent from '../components/MessageContent';
import { STR, MEMBER_LANG, memberLocale } from '../i18n/member';

// /aide/:guildId[/:articleId] — the public knowledge base of a space (web/routes/kb.js), read
// without signing in. Only the articles marked « public » by the staff are listed.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const INPUT = 'w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 placeholder-ink-4 focus:outline-hidden focus:border-primary/50';

function Header({ space }) {
  return (
    <header className="border-b border-overlay/6 bg-surface/60">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
        {space?.logo ? <img src={space.logo} alt="" className="w-6 h-6 rounded-md object-cover" /> : <BookOpen size={18} className="text-primary-light" />}
        {space ? <Link to={`/aide/${space.id}`} className="text-sm font-bold text-ink-1">{space.name} · {STR.kbTitle}</Link>
          : <span className="text-sm font-bold text-ink-1">{STR.kbTitle}</span>}
      </div>
    </header>
  );
}

function Contact({ space }) {
  return (
    <p className="text-sm text-ink-3 text-center pt-4">
      <Link to={`/espace/nouveau?guild=${encodeURIComponent(space.id)}`} className="inline-flex items-center gap-1.5 text-primary-light underline">
        <LifeBuoy size={14} aria-hidden="true" /> {STR.kbContact}
      </Link>
    </p>
  );
}

function ArticleList({ space, articles }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(w => w.length > 1);
    const shown = words.length ? articles.filter(a => words.every(w => norm(`${a.question} ${a.answer} ${a.category}`).includes(w))) : articles;
    const map = new Map();
    for (const a of shown) {
      const k = a.category || '';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(a);
    }
    return [...map.entries()];
  }, [articles, query]);
  // Nothing found: told to the staff once the reader stops typing (what is missing, v5.6)
  const told = useRef('');
  useEffect(() => {
    if (groups.length || query.trim().length < 3) return undefined;
    const t = setTimeout(() => { if (told.current !== query) { told.current = query; api.post(`/kb/${encodeURIComponent(space.id)}/searches`, { q: query }).catch(() => {}); } }, 1500);
    return () => clearTimeout(t);
  }, [groups.length, query, space.id]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink-1">{STR.kbTitle}</h1>
        <p className="text-xs text-ink-3 mt-1">{STR.kbCount.replace('{n}', articles.length)}</p>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={STR.faqSearch} placeholder={STR.faqSearch} className={`${INPUT} pl-9`} />
      </div>
      {!articles.length ? <p className="text-sm text-ink-4">{STR.faqEmpty}</p>
        : !groups.length ? <p className="text-sm text-ink-4">{STR.faqNone}</p>
        : groups.map(([category, list]) => (
          <section key={category} className="space-y-2">
            {(groups.length > 1 || category) && <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{category || STR.kbGeneral}</h2>}
            <ul className="space-y-2">
              {list.map(a => (
                <li key={a.id}>
                  <Link to={`/aide/${space.id}/${a.id}`} className="flex items-center gap-2 bg-surface-card border border-overlay/6 rounded-xl px-4 py-3 text-sm font-medium text-ink-1 hover:border-overlay/12 hover:bg-surface-hover">
                    <FileText size={14} className="text-primary-light shrink-0" aria-hidden="true" />{a.question}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      <Contact space={space} />
    </div>
  );
}

// « Did it help? » (v5.6), once per article
function Feedback({ space, article }) {
  const [state, setState] = useState(null); // null, 'no', 'sent'
  const [comment, setComment] = useState('');
  const send = async (helpful, text = '') => { await api.post(`/kb/${encodeURIComponent(space.id)}/articles/${article.id}/feedback`, { helpful, comment: text }).catch(() => {}); setState('sent'); };
  if (state === 'sent') return <p className="text-xs text-emerald-300" role="status">{STR.kbThanks}</p>;
  return (
    <div className="rounded-xl border border-overlay/8 p-3 space-y-2">
      <p className="text-sm text-ink-2">{STR.kbHelpful}</p>
      {state === 'no' ? (
        <div className="space-y-2">
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} maxLength={1000} placeholder={STR.kbWhatMissing} aria-label={STR.kbWhatMissing} className={INPUT} />
          <button type="button" onClick={() => send(false, comment)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white">{STR.kbSend}</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => send(true)} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-1 hover:border-overlay/15">{STR.kbYes}</button>
          <button type="button" onClick={() => setState('no')} className="px-3 py-1.5 rounded-lg text-xs border border-overlay/8 text-ink-1 hover:border-overlay/15">{STR.kbNo}</button>
        </div>
      )}
    </div>
  );
}

const LANG_NAMES = { fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch', it: 'Italiano', pt: 'Português' };
function Article({ space, article }) {
  return (
    <article className="space-y-4">
      <Link to={`/aide/${space.id}`} className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1"><ArrowLeft size={13} /> {STR.kbBack}</Link>
      {article.category && <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{article.category}</p>}
      <h1 className="text-xl font-bold text-ink-1">{article.question}</h1>
      <div className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed"><MessageContent text={article.answer} /></div>
      <p className="text-xs text-ink-4">{STR.kbUpdated} {new Date(article.updated_at || article.created_at).toLocaleDateString(memberLocale, { dateStyle: 'long' })}</p>
      {article.translations?.length > 0 && (
        <p className="text-xs text-ink-3">{STR.kbOtherLangs} {article.translations.map((t, i) => <React.Fragment key={t.id}>{i ? ' · ' : ''}<Link to={`/aide/${space.id}/${t.id}`} className="text-primary-light underline" lang={t.lang}>{LANG_NAMES[t.lang] || STR.kbOriginal}</Link></React.Fragment>)}</p>
      )}
      <Feedback key={article.id} space={space} article={article} />
      <Contact space={space} />
    </article>
  );
}

export default function KnowledgeBase() {
  const { guildId, articleId } = useParams();
  const [data, setData] = useState(undefined); // undefined: loading, null: not found
  useEffect(() => {
    setData(undefined);
    const url = articleId ? `/kb/${encodeURIComponent(guildId)}/articles/${encodeURIComponent(articleId)}` : `/kb/${encodeURIComponent(guildId)}`;
    // In the reader's language when the staff translated it (v5.6)
    api.get(url, { params: { lang: MEMBER_LANG } }).then(r => setData(r.data)).catch(() => setData(null));
  }, [guildId, articleId]);
  useEffect(() => {
    if (data?.space) document.title = `${data.article ? `${data.article.question} · ` : ''}${data.space.name} · ${STR.kbTitle}`;
  }, [data]);

  return (
    <div data-no-translate lang={MEMBER_LANG} className="min-h-screen bg-base">
      <Header space={data?.space} />
      <main className="max-w-3xl mx-auto px-4 py-6">
        {data === undefined ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-4" /></div>
          : data === null ? <p className="text-sm text-ink-3 py-16 text-center">{articleId ? STR.kbArticleNotFound : STR.kbNotFound}</p>
          : data.article ? <Article space={data.space} article={data.article} />
          : <ArticleList space={data.space} articles={data.articles} />}
      </main>
    </div>
  );
}
