import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';
import { purgeOldDrafts } from './hooks/useDraft';
import { startTranslation } from './i18n';
import { installErrorReporting } from './utils/reportError';
import { applySkin, readSkin } from './ui/skin';
import { loadInstanceInfo } from './hooks/useInstanceInfo';

applySkin(readSkin());
loadInstanceInfo(); // bot name in the tab title as early as possible

// Installable dashboard (v6): the service worker serves an offline page (and the push notifications)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

purgeOldDrafts();
installErrorReporting();
startTranslation();

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: { background: '#222538', color: '#e2e8f0', border: '1px solid #374151' },
        success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } }
      }}
    />
  </BrowserRouter>
);
