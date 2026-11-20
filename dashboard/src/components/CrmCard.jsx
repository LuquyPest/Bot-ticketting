import React, { useEffect, useState } from 'react';
import { Contact, ExternalLink } from 'lucide-react';
import api from '../api';
import { uiLocale } from '../i18n';

// Fiche ticket → CRM (v7, utils/crm.js): the requester's card in HubSpot or Salesforce, read only
export default function CrmCard({ ticketId, panelCard }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/crm/tickets/${ticketId}`).then(r => setData(r.data)).catch(() => setData(null)); }, [ticketId]);
  const c = data?.card;
  if (!c) return null;
  const money = v => (v == null ? null : new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 0 }).format(v));
  return (
    <div className={panelCard}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-4 mb-1 inline-flex items-center gap-1.5"><Contact size={12} aria-hidden="true" />{c.provider === 'hubspot' ? 'HubSpot' : 'Salesforce'}</p>
      <p className="text-sm text-ink-1" translate="no">{c.name || c.email}</p>
      <dl className="mt-1 space-y-0.5 text-[11px] text-ink-3">
        {c.title && <div><dt className="inline">Poste : </dt><dd className="inline text-ink-2" translate="no">{c.title}</dd></div>}
        {c.company?.name && <div><dt className="inline">Société : </dt><dd className="inline text-ink-2" translate="no">{c.company.name}{c.company.industry ? ` · ${c.company.industry}` : ''}</dd></div>}
        {c.company?.revenue != null && <div><dt className="inline">Chiffre d'affaires : </dt><dd className="inline text-ink-2">{money(c.company.revenue)}</dd></div>}
        {c.owner && <div><dt className="inline">Propriétaire : </dt><dd className="inline text-ink-2" translate="no">{c.owner}</dd></div>}
        {c.stage && <div><dt className="inline">Étape : </dt><dd className="inline text-ink-2" translate="no">{c.stage}</dd></div>}
        {c.phone && <div><dt className="inline">Téléphone : </dt><dd className="inline text-ink-2" translate="no">{c.phone}</dd></div>}
      </dl>
      {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary-light hover:underline">Ouvrir dans le CRM <ExternalLink size={10} aria-hidden="true" /></a>}
    </div>
  );
}
