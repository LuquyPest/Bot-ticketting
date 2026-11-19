import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitPullRequestArrow } from 'lucide-react';
import api from '../api';
import { CHANGE_STATUS } from '../pages/Changes';

// Fiche ticket → Changements (v5.5): the planned changes that deal with this ticket
export default function ChangesPanel({ ticketId, panelCard }) {
  const [list, setList] = useState(null);
  useEffect(() => { api.get(`/changes/ticket/${ticketId}`).then(r => setList(Array.isArray(r.data?.changes) ? r.data.changes : null)).catch(() => setList(null)); }, [ticketId]);
  if (!list?.length) return null;
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-2 inline-flex items-center gap-1.5"><GitPullRequestArrow size={12} aria-hidden="true" />Changements</p>
      {list.map(c => <p key={c.id} className="text-xs"><Link to={`/changements/${c.id}`} className="text-ink-1 hover:underline">{c.title}</Link> <span className="text-ink-4">{`· ${CHANGE_STATUS[c.status] || c.status}`}</span></p>)}
    </div>
  );
}
