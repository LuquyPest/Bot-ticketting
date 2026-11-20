import React, { useEffect, useRef, useState } from 'react';
import { Camera, Monitor, Mic, Square } from 'lucide-react';

// Recordings from the browser (v7, conception/v7.md §3.7): a screenshot (PNG), a video of the screen
// (WebM, 90 s at most, low bit rate) or a voice message (WebM/Ogg, 3 min at most), handed to the
// page as a File — it then goes like any attachment. Nothing leaves the browser before it is sent.
const LIMITS = { video: 90, voice: 180 };
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const supported = () => typeof window !== 'undefined' && !!navigator.mediaDevices && typeof window.MediaRecorder !== 'undefined';

export const RECORDER_FR = {
  screenshot: 'Capture d\'écran', video: 'Vidéo de l\'écran', voice: 'Message vocal', stop: 'Arrêter', recording: 'Enregistrement…', denied: 'Accès refusé par le navigateur',
};

export default function Recorder({ onFile, labels = RECORDER_FR, disabled = false, onError }) {
  const [rec, setRec] = useState(null); // { kind, started }
  const [left, setLeft] = useState(0);
  const ref = useRef({ recorder: null, stream: null, timer: null });
  useEffect(() => () => { const r = ref.current; clearInterval(r.timer); r.stream?.getTracks().forEach(t => t.stop()); }, []);
  if (!supported()) return null;
  const fail = err => { onError?.(err?.name === 'NotAllowedError' ? labels.denied : String(err?.message || err)); };

  const screenshot = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise(r => setTimeout(r, 300));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      track.stop();
      canvas.toBlob(b => b && onFile(new File([b], `capture-${stamp()}.png`, { type: 'image/png' })), 'image/png');
    } catch (err) { fail(err); }
  };
  const stop = () => { const r = ref.current; clearInterval(r.timer); if (r.recorder?.state === 'recording') r.recorder.stop(); };
  const record = async kind => {
    try {
      const stream = kind === 'video' ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false }) : await navigator.mediaDevices.getUserMedia({ audio: true });
      const types = kind === 'video' ? ['video/webm;codecs=vp9', 'video/webm'] : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];
      const mimeType = types.find(t => window.MediaRecorder.isTypeSupported?.(t)) || '';
      const recorder = new window.MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), ...(kind === 'video' ? { videoBitsPerSecond: 500000 } : { audioBitsPerSecond: 48000 }) });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        setRec(null);
        const type = (recorder.mimeType || mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm')).split(';')[0];
        const ext = type.includes('ogg') ? 'ogg' : 'webm';
        if (chunks.length) onFile(new File(chunks, `${kind === 'video' ? 'ecran' : 'vocal'}-${stamp()}.${ext}`, { type }));
      };
      stream.getVideoTracks()[0]?.addEventListener('ended', stop); // « Stop sharing » in the browser
      ref.current = { recorder, stream, timer: null };
      recorder.start(1000);
      setRec({ kind }); setLeft(LIMITS[kind]);
      ref.current.timer = setInterval(() => setLeft(s => { if (s <= 1) { stop(); return 0; } return s - 1; }), 1000);
    } catch (err) { fail(err); }
  };

  const btn = 'p-1.5 rounded-lg text-ink-3 hover:text-ink-1 hover:bg-overlay/5 disabled:opacity-50';
  if (rec) return (
    <span className="inline-flex items-center gap-1.5 text-xs text-red-400" role="status">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />{`${labels.recording} ${left} s`}
      <button type="button" onClick={stop} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10"><Square size={11} aria-hidden="true" />{labels.stop}</button>
    </span>
  );
  return (
    <span className="inline-flex items-center">
      {navigator.mediaDevices.getDisplayMedia && <button type="button" disabled={disabled} onClick={screenshot} aria-label={labels.screenshot} title={labels.screenshot} className={btn}><Camera size={14} /></button>}
      {navigator.mediaDevices.getDisplayMedia && <button type="button" disabled={disabled} onClick={() => record('video')} aria-label={labels.video} title={labels.video} className={btn}><Monitor size={14} /></button>}
      <button type="button" disabled={disabled} onClick={() => record('voice')} aria-label={labels.voice} title={labels.voice} className={btn}><Mic size={14} /></button>
    </span>
  );
}
