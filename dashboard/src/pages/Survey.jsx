import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Star } from 'lucide-react';
import api from '../api';
import { STR, MEMBER_LANG } from '../i18n/member';

// /enquete#<space>.<token>: the satisfaction survey of a closed ticket (utils/surveys.js). The
// token stays in the fragment: never sent in a URL to the server.
function Stars({ value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} / 5`} onClick={() => onChange(n)} className="p-1">
          <Star size={26} className={n <= (value || 0) ? 'text-amber-400 fill-amber-400' : 'text-ink-4'} />
        </button>
      ))}
    </div>
  );
}

export default function Survey() {
  const token = window.location.hash.slice(1);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!token) { setError(STR.solGone); return; }
    api.post('/survey/link', { token }).then(r => setInfo(r.data)).catch(() => setError(STR.solGone));
  }, [token]);
  const send = async () => {
    setBusy(true);
    try { await api.post('/survey/answer', { token, rating, comment, answers }); setDone(true); window.history.replaceState(null, '', '/enquete'); }
    catch (err) { setError(err.response?.status === 410 ? STR.solGone : (err.response?.data?.error || STR.error2)); }
    setBusy(false);
  };
  const INPUT = 'w-full bg-surface border border-overlay/8 rounded-xl px-3 py-2 text-sm text-ink-1 focus:outline-hidden focus:border-primary/50';
  return (
    <div data-no-translate lang={MEMBER_LANG} className="min-h-screen bg-base flex items-center justify-center p-4">
      <main className="w-full max-w-lg bg-surface-card border border-overlay/8 rounded-2xl p-6 space-y-4">
        {error ? <p className="text-sm text-ink-2 text-center" role="alert">{error}</p>
          : !info ? <div className="flex justify-center py-6"><Loader2 className="animate-spin text-ink-4" /></div>
          : done ? <p className="text-sm text-ink-1 text-center inline-flex items-center gap-2 w-full justify-center"><CheckCircle2 size={16} className="text-emerald-400" aria-hidden="true" />{STR.surveyThanks}</p>
          : (
            <>
              <p className="text-xs text-ink-3">{info.space} · #{info.ticketId}{info.subject ? ` · ${info.subject}` : ''}</p>
              <h1 className="text-lg font-bold text-ink-1">{STR.surveyTitle}</h1>
              <Stars value={rating} onChange={setRating} label={STR.surveyRating} />
              {info.questions.map(q => (
                <div key={q.id} className="space-y-1">
                  <p className="text-sm text-ink-2">{q.label}</p>
                  {q.type === 'rating' ? <Stars value={answers[q.id]} onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} label={q.label} />
                    : q.type === 'yesno' ? (
                      <div className="flex gap-2" role="radiogroup" aria-label={q.label}>
                        {[['yes', STR.kbYes], ['no', STR.kbNo]].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={answers[q.id] === v} onClick={() => setAnswers(a => ({ ...a, [q.id]: v }))}
                          className={`px-3 py-1.5 rounded-lg text-xs border ${answers[q.id] === v ? 'border-primary/50 bg-primary/10 text-ink-1' : 'border-overlay/8 text-ink-2'}`}>{l}</button>)}
                      </div>
                    ) : q.type === 'nps' || q.type === 'ces' ? (
                      <div>
                        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={q.label}>
                          {(q.type === 'nps' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5, 6, 7]).map(n => <button key={n} type="button" role="radio" aria-checked={answers[q.id] === n} onClick={() => setAnswers(a => ({ ...a, [q.id]: n }))}
                            className={`w-9 h-9 rounded-lg text-sm border tabular-nums ${answers[q.id] === n ? 'border-primary/50 bg-primary/15 text-ink-1' : 'border-overlay/8 text-ink-2 hover:text-ink-1'}`}>{n}</button>)}
                        </div>
                        <p className="flex justify-between text-[11px] text-ink-4 mt-1"><span>{q.type === 'nps' ? STR.npsLow : STR.cesLow}</span><span>{q.type === 'nps' ? STR.npsHigh : STR.cesHigh}</span></p>
                      </div>
                    ) : <textarea value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} rows={2} maxLength={500} aria-label={q.label} className={INPUT} />}
                </div>
              ))}
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={1000} placeholder={STR.surveyComment} aria-label={STR.surveyComment} className={INPUT} />
              <button onClick={send} disabled={busy || !rating} className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {busy && <Loader2 size={14} className="animate-spin" />} {STR.kbSend}
              </button>
            </>
          )}
      </main>
    </div>
  );
}
