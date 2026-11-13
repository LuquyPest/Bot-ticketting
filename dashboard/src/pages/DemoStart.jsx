import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../api';

// /demo: opens a session on the demonstration server straight away (link from the docs site).
// When the owner keeps the demonstration off, says so and offers the sign-in page.
export default function DemoStart() {
  const [error, setError] = useState(null);
  useEffect(() => {
    api.post('/demo/start')
      .then(() => { window.location.replace('/'); })
      .catch(err => setError(err.response?.data?.error || 'Démonstration indisponible pour le moment'));
  }, []);

  return (
    <div className="min-h-screen bg-base flex flex-col items-center justify-center gap-4 p-6 text-center" role="status">
      {error ? (
        <>
          <p className="text-sm text-ink-2">{error}</p>
          <a href="/login" className="text-sm text-primary-light underline">Page de connexion</a>
        </>
      ) : (
        <>
          <Loader2 size={22} className="animate-spin text-primary-light" />
          <p className="text-sm text-ink-3">Ouverture de la démonstration…</p>
        </>
      )}
    </div>
  );
}
