import { useState, useEffect, useCallback } from 'react';
import api from '../api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

export default function usePushNotifications() {
  const [supported, setSupported]     = useState(false);
  const [permission, setPermission]   = useState('default');
  const [subscribed, setSubscribed]   = useState(false);
  const [loading, setLoading]         = useState(false);

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window);
    setPermission(Notification.permission);
  }, []);

  const subscribe = useCallback(async () => {
    if (!supported || loading) return;
    setLoading(true);
    try {
      const { data: { publicKey } } = await api.get('/push/vapid-public-key');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const existing = await reg.pushManager.getSubscription();
      if (existing) { setSubscribed(true); setLoading(false); return; }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { setLoading(false); return; }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await api.post('/push/subscribe', sub.toJSON());
      setSubscribed(true);
    } catch (err) {
      console.error('push subscribe error:', err);
    } finally {
      setLoading(false);
    }
  }, [supported, loading]);

  const unsubscribe = useCallback(async () => {
    if (!supported || loading) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (!reg) { setSubscribed(false); return; }
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error('push unsubscribe error:', err);
    } finally {
      setLoading(false);
    }
  }, [supported, loading]);

  // Check current subscription state on mount
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.getRegistration('/sw.js').then(async reg => {
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription().catch(() => null);
      setSubscribed(!!sub);
    }).catch(() => null);
  }, [supported]);

  return { supported, permission, subscribed, loading, subscribe, unsubscribe };
}
