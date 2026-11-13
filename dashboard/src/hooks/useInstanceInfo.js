import { useEffect, useState } from 'react';
import api from '../api';

// Public facts about the instance (GET /api/instance/info): bot name and avatar, demonstration
// on or off, privacy page. Fetched once per page load.
let pending = null;
let cached = null;

export function loadInstanceInfo() {
  if (!pending) {
    pending = api.get('/instance/info')
      .then(r => (cached = r.data))
      .catch(() => (cached = { name: 'Ticket Bot', avatar: null, demo: false, privacyUrl: null, contactEmail: null }));
  }
  return pending;
}

export function useInstanceInfo() {
  const [info, setInfo] = useState(cached);
  useEffect(() => {
    if (!cached) loadInstanceInfo().then(setInfo);
  }, []);
  return info;
}
