import React, { useEffect, useRef, useState } from 'react';
import { Puzzle } from 'lucide-react';
import api from '../api';

// Fiche ticket → panneaux des extensions (v7, utils/extensions.js). Each panel is an iframe sandboxed
// without « allow-same-origin »: it gets the ticket's context by postMessage, and may only ask
// { type: 'datick:resize', height } or { type: 'datick:insertReply', text } — checked here.
function Panel({ ext, ticket, onInsert, panelCard }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(ext.panel.height);
  const origin = ext.panel.origin;
  useEffect(() => {
    const onMsg = e => {
      if (e.source !== ref.current?.contentWindow || e.origin !== origin || !e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'datick:resize') setHeight(Math.min(800, Math.max(80, Number(e.data.height) || ext.panel.height)));
      if (e.data.type === 'datick:insertReply' && typeof e.data.text === 'string') onInsert?.(e.data.text.slice(0, 4000));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [origin, ext.panel.height, onInsert]);
  const send = () => ref.current?.contentWindow?.postMessage({ type: 'datick:context', ticket: { id: ticket.id, subject: ticket.subject || null, status: ticket.status, priority: ticket.priority, stage: ticket.stage, requester: ticket.visibility_grade_id === -1 ? null : ticket.owner_tag } }, origin);
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1.5 inline-flex items-center gap-1.5"><Puzzle size={12} aria-hidden="true" /><span translate="no">{ext.name}</span></p>
      <iframe ref={ref} title={`Extension ${ext.name}`} src={ext.panel.url} onLoad={send} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
        className="w-full rounded-lg border border-overlay/8 bg-white" style={{ height }} />
    </div>
  );
}

export default function ExtensionPanels({ ticket, panelCard, onInsert }) {
  const [list, setList] = useState([]);
  useEffect(() => { api.get('/extensions').then(r => setList((r.data?.extensions || []).filter(e => e.active && e.panel?.url))).catch(() => setList([])); }, []);
  return list.map(e => <Panel key={e.id} ext={e} ticket={ticket} onInsert={onInsert} panelCard={panelCard} />);
}
