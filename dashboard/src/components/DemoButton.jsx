import React, { useState } from 'react';
import { PlayCircle, Loader2 } from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// Opens a session on the demonstration server (fictitious data, reset every night)
export default function DemoButton({ className = '', label = 'Essayer la démo', small = false }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try { await api.post('/demo/start'); window.location.href = '/'; }
    catch (err) { toast.error(err.response?.data?.error || 'Démonstration indisponible'); setBusy(false); }
  };
  return (
    <button type="button" onClick={start} disabled={busy}
      className={`inline-flex items-center justify-center gap-2 ${small ? 'px-3 py-1.5 rounded-lg text-xs' : 'px-4 py-2 rounded-xl text-sm'} font-semibold border border-primary/30 text-primary-light hover:bg-primary/10 disabled:opacity-50 ${className}`}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />} {label}
    </button>
  );
}
