import React, { useEffect, useState, useCallback } from 'react';
import {
  Save, RefreshCw, ShieldCheck, ShieldOff, Loader2, Eye, EyeOff,
  Check, Star, Clock, Trophy, Ticket, Palmtree, Link, Pencil, X,
} from 'lucide-react';
import api from '../api';
import toast from 'react-hot-toast';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(seconds) {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getAvatar(profile) {
  if (profile?.profilePictureUrl) return profile.profilePictureUrl;
  if (profile?.discordAvatar)
    return `https://cdn.discordapp.com/avatars/${profile.userId}/${profile.discordAvatar}.webp?size=256`;
  return null;
}

function buildHeatmap(data) {
  const map = {};
  for (const { day, cnt } of data) map[day] = Number(cnt);
  const today = new Date();
  const days = [];
  for (let i = 55; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    days.push({ date: key, count: map[key] || 0 });
  }
  const weeks = [];
  for (let i = 0; i < 56; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

function heatColor(n) {
  if (n === 0) return 'bg-white/[0.04] border-white/[0.06]';
  if (n <= 2)  return 'bg-primary/25 border-primary/20';
  if (n <= 5)  return 'bg-primary/45 border-primary/30';
  if (n <= 10) return 'bg-primary/70 border-primary/50';
  return 'bg-primary border-primary/80';
}

const ROLE_STYLES = {
  fondateur: { text: 'text-violet-300', bg: 'bg-violet-500/10 border-violet-500/20', label: 'Fondateur' },
  support:   { text: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Support' },
  nouveau:   { text: 'text-amber-300',   bg: 'bg-amber-500/10 border-amber-500/20',    label: 'Nouveau' },
};

const PRIORITY_STYLES = {
  urgent: 'text-red-400 bg-red-500/10 border-red-500/20',
  normal: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  low:    'text-ink-4 bg-white/[0.04] border-white/[0.08]',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, value, label, sub, subColor }) {
  return (
    <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon size={15} className="text-primary-light" />
        </div>
        <p className="text-xs text-ink-4 font-medium">{label}</p>
      </div>
      <p className="text-2xl font-bold text-ink-1 tabular-nums leading-none">{value}</p>
      {sub && <p className={`text-xs ${subColor || 'text-ink-4'}`}>{sub}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-surface-card border border-white/[0.06] rounded-2xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink-2 border-b border-white/[0.06] pb-3">{title}</h2>
      {children}
    </div>
  );
}

function TotpInput({ value, onChange, autoFocus, label = 'Code 2FA' }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-ink-3">{label}</label>
      <input type="text" inputMode="numeric" value={value}
        onChange={e => onChange(e.target.value)} placeholder="000 000" maxLength={7}
        autoFocus={autoFocus}
        className="w-full px-3 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08]
                   text-base text-ink-1 placeholder-ink-4 outline-none focus:border-primary/50
                   text-center tracking-[0.4em] font-mono transition-colors" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Profile() {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [imgError, setImgError] = useState(false);

  // Edit fields
  const [bio, setBio]                     = useState('');
  const [bannerColor, setBannerColor]     = useState('#6366f1');
  const [photoUrl, setPhotoUrl]           = useState('');
  const [vacation, setVacation]           = useState(false);
  const [editingPhoto, setEditingPhoto]   = useState(false);

  // 2FA
  const [twoFaEnabled, setTwoFaEnabled]   = useState(false);
  const [twoFaLoading, setTwoFaLoading]   = useState(true);
  const [twoFaStep, setTwoFaStep]         = useState('idle');
  const [qrDataUrl, setQrDataUrl]         = useState('');
  const [secret, setSecret]               = useState('');
  const [showSecret, setShowSecret]       = useState(false);
  const [totpCode, setTotpCode]           = useState('');
  const [twoFaActionLoading, set2FaAL]    = useState(false);
  const [twoFaError, setTwoFaError]       = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/profile')
      .then(r => {
        setData(r.data);
        setBio(r.data.profile.bio || '');
        setBannerColor(r.data.profile.bannerColor || '#6366f1');
        setPhotoUrl(r.data.profile.profilePictureUrl || '');
        setVacation(r.data.profile.vacationMode || false);
        setImgError(false);
      })
      .catch(() => toast.error('Erreur chargement du profil'))
      .finally(() => setLoading(false));

    api.get('/profile/2fa')
      .then(r => setTwoFaEnabled(r.data.enabled))
      .catch(() => {})
      .finally(() => setTwoFaLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/profile', {
        bio:               bio || null,
        bannerColor,
        profilePictureUrl: photoUrl || null,
        vacationMode:      vacation,
      });
      toast.success('Profil sauvegardé');
      setEditingPhoto(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur sauvegarde');
    }
    setSaving(false);
  };

  // ── 2FA ────────────────────────────────────────────────────────────────

  const reset2Fa = () => { setTwoFaStep('idle'); setTotpCode(''); setTwoFaError(''); setQrDataUrl(''); setSecret(''); setShowSecret(false); };

  const start2FaSetup = async () => {
    set2FaAL(true); setTwoFaError('');
    try {
      const r = await api.post('/profile/2fa/setup');
      setQrDataUrl(r.data.qrDataUrl);
      setSecret(r.data.secret);
      setTotpCode('');
      setTwoFaStep('setup');
    } catch (err) { setTwoFaError(err.response?.data?.error || 'Erreur'); }
    set2FaAL(false);
  };

  const confirm2FaEnable = async (e) => {
    e.preventDefault();
    set2FaAL(true); setTwoFaError('');
    try {
      await api.post('/profile/2fa/enable', { code: totpCode });
      setTwoFaEnabled(true);
      reset2Fa();
      toast.success('2FA activé — ton compte est maintenant protégé');
    } catch (err) { setTwoFaError(err.response?.data?.error || 'Code invalide'); }
    set2FaAL(false);
  };

  const confirm2FaDisable = async (e) => {
    e.preventDefault();
    set2FaAL(true); setTwoFaError('');
    try {
      await api.post('/profile/2fa/disable', { code: totpCode });
      setTwoFaEnabled(false);
      reset2Fa();
      toast.success('2FA désactivé');
    } catch (err) { setTwoFaError(err.response?.data?.error || 'Code invalide'); }
    set2FaAL(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex h-full min-h-[400px] items-center justify-center">
      <Loader2 size={24} className="animate-spin text-primary-light" />
    </div>
  );
  if (!data) return <div className="p-6 text-red-400">Impossible de charger le profil.</div>;

  const { profile, stats, heatmap, recentTickets } = data;
  const roleStyle = ROLE_STYLES[profile.role] || ROLE_STYLES.nouveau;
  const avatarUrl = !imgError ? getAvatar(profile) : null;
  const weeks = buildHeatmap(heatmap || []);

  const monthDiff = stats.thisMonth - stats.lastMonth;
  const monthDiffLabel = monthDiff === 0 ? '= vs mois dernier'
    : monthDiff > 0 ? `↑ +${monthDiff} vs mois dernier`
    : `↓ ${monthDiff} vs mois dernier`;
  const monthDiffColor = monthDiff > 0 ? 'text-emerald-400' : monthDiff < 0 ? 'text-red-400' : 'text-ink-4';

  return (
    <div className="p-6 space-y-5 max-w-4xl">

      {/* ── Hero / Banner ───────────────────────────────────────────────── */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl overflow-hidden">
        {/* Banner */}
        <div className="h-28 relative"
          style={{ background: `linear-gradient(135deg, ${bannerColor}66 0%, ${bannerColor}22 100%)` }}>
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/30" />
          {/* Refresh button */}
          <button onClick={load} title="Actualiser"
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/20 text-white/60
                       hover:text-white hover:bg-black/40 transition-all">
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Avatar + identity */}
        <div className="px-6 pb-5">
          <div className="flex items-end gap-4 -mt-12 mb-3">
            <div className="relative flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt=""
                  onError={() => setImgError(true)}
                  className="w-20 h-20 rounded-2xl ring-4 ring-base object-cover" />
              ) : (
                <div className="w-20 h-20 rounded-2xl ring-4 ring-base
                                bg-gradient-to-br from-violet-500 to-indigo-600
                                flex items-center justify-center text-2xl font-bold text-white">
                  {profile.username?.[0]?.toUpperCase()}
                </div>
              )}
              {profile.vacationMode && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-amber-500/90
                                border-2 border-base flex items-center justify-center"
                  title="Mode vacances actif">
                  <Palmtree size={11} className="text-white" />
                </div>
              )}
            </div>
            <div className="pb-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-ink-1 truncate">{profile.username}</h1>
                <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide
                                 px-2 py-0.5 rounded-md border ${roleStyle.bg} ${roleStyle.text}`}>
                  {roleStyle.label}
                </span>
                {twoFaEnabled && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5
                                   rounded-md border text-emerald-300 bg-emerald-500/10 border-emerald-500/20">
                    <ShieldCheck size={9} /> 2FA
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-4 mt-0.5">
                {profile.bio || <span className="italic">Aucune bio</span>}
              </p>
            </div>
          </div>
          <p className="text-[10px] text-ink-4">
            Membre depuis {profile.firstLogin ? new Date(profile.firstLogin).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' }) : '—'}
          </p>
        </div>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Ticket} value={stats.thisMonth}
          label="Tickets ce mois" sub={monthDiffLabel} subColor={monthDiffColor} />
        <StatCard icon={Star}
          value={stats.avgRating ? `${stats.avgRating} ★` : '—'}
          label="Note moyenne"
          sub={stats.ratingCount > 0 ? `sur ${stats.ratingCount} avis` : 'Aucun avis'} />
        <StatCard icon={Clock}
          value={fmtTime(stats.avgResponseSeconds)}
          label="Temps de réponse"
          sub={`${stats.allTimeClosed} tickets fermés`} />
        <StatCard icon={Trophy}
          value={stats.rank ? `#${stats.rank}` : '—'}
          label="Classement"
          sub={stats.totalStaff > 0 ? `sur ${stats.totalStaff} membres` : ''} />
      </div>

      {/* ── Heatmap + Recent tickets ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Heatmap */}
        <Section title="Activité — 8 dernières semaines">
          <div className="space-y-3">
            <div className="flex gap-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1 flex-1">
                  {week.map((day, di) => (
                    <div key={di} title={`${day.date} — ${day.count} action${day.count !== 1 ? 's' : ''}`}
                      className={`h-3.5 rounded-sm border transition-colors ${heatColor(day.count)}`} />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <span className="text-[10px] text-ink-4">Moins</span>
              {[0, 2, 5, 10, 15].map(n => (
                <div key={n} className={`w-3 h-3 rounded-sm border ${heatColor(n)}`} />
              ))}
              <span className="text-[10px] text-ink-4">Plus</span>
            </div>
          </div>
        </Section>

        {/* Recent tickets */}
        <Section title="Tickets récents">
          {recentTickets.length === 0 ? (
            <p className="text-xs text-ink-4 italic py-2">Aucun ticket traité</p>
          ) : (
            <div className="space-y-2">
              {recentTickets.map(t => (
                <div key={t.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl
                             bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-2 truncate">
                      {t.subject || `Ticket #${t.id}`}
                    </p>
                    <p className="text-[10px] text-ink-4 truncate">{t.owner_tag}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border
                                     ${PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.normal}`}>
                      {t.priority}
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border
                                     ${t.status === 'open'
                                       ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                                       : 'text-ink-4 bg-white/[0.04] border-white/[0.08]'}`}>
                      {t.status === 'open' ? 'Ouvert' : 'Fermé'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ── Edit + Security ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Edit profile */}
        <Section title="Modifier le profil">
          <div className="space-y-4">
            {/* Photo */}
            <div>
              <label className="text-sm text-ink-2 font-medium block mb-1">Photo de profil</label>
              <p className="text-xs text-ink-4 mb-2">URL d'une image — remplace ton avatar Discord</p>
              {!editingPhoto ? (
                <div className="flex items-center gap-3">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" onError={() => setImgError(true)}
                      className="w-10 h-10 rounded-xl object-cover flex-shrink-0 ring-1 ring-white/10" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600
                                    flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {profile.username?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <button onClick={() => setEditingPhoto(true)}
                    className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1
                               px-3 py-2 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition-all">
                    <Link size={12} /> {photoUrl ? 'Changer l\'URL' : 'Ajouter une URL'}
                  </button>
                  {photoUrl && (
                    <button onClick={() => { setPhotoUrl(''); }}
                      className="p-2 rounded-lg text-ink-4 hover:text-red-400 hover:bg-red-400/10 transition-all"
                      title="Retirer la photo">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input type="url" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)}
                    placeholder="https://…/photo.jpg" autoFocus
                    className="flex-1 bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4
                               rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors" />
                  <button onClick={() => setEditingPhoto(false)}
                    className="px-3 py-2 rounded-lg text-sm text-ink-3 hover:text-ink-1
                               hover:bg-white/[0.05] border border-white/[0.08] transition-all">
                    OK
                  </button>
                </div>
              )}
            </div>

            {/* Bio */}
            <div>
              <label className="text-sm text-ink-2 font-medium block mb-1">Bio</label>
              <textarea value={bio} onChange={e => setBio(e.target.value.slice(0, 160))} rows={2}
                placeholder="Quelques mots sur toi…"
                className="w-full bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4
                           rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary
                           transition-colors resize-none" />
              <p className="text-[10px] text-ink-4 text-right mt-0.5">{bio.length}/160</p>
            </div>

            {/* Banner color */}
            <div>
              <label className="text-sm text-ink-2 font-medium block mb-1">Couleur de bannière</label>
              <div className="flex items-center gap-2">
                <input type="color" value={bannerColor} onChange={e => setBannerColor(e.target.value)}
                  className="w-10 h-9 rounded-lg border border-white/[0.08] bg-transparent cursor-pointer p-0.5 flex-shrink-0" />
                <input type="text" value={bannerColor} onChange={e => setBannerColor(e.target.value)}
                  pattern="^#[0-9a-fA-F]{6}$" placeholder="#6366f1"
                  className="flex-1 bg-surface border border-white/[0.08] text-ink-1 placeholder-ink-4
                             rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary transition-colors" />
                <div className="w-9 h-9 rounded-lg flex-shrink-0" style={{ background: bannerColor }} />
              </div>
            </div>

            {/* Vacation mode */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div onClick={() => setVacation(v => !v)}
                className={`w-10 h-5 rounded-full transition-colors flex-shrink-0
                           ${vacation ? 'bg-amber-500' : 'bg-white/[0.1]'}`}>
                <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-transform
                                ${vacation ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <div>
                <p className="text-sm text-ink-2 font-medium flex items-center gap-1.5">
                  <Palmtree size={13} className={vacation ? 'text-amber-400' : 'text-ink-4'} />
                  Mode vacances
                </p>
                <p className="text-xs text-ink-4">Indique que tu es absent temporairement</p>
              </div>
            </label>

            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-light
                         text-white text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
          </div>
        </Section>

        {/* Security / 2FA */}
        <Section title="Sécurité">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-2 font-medium">Double authentification (2FA)</p>
              {twoFaLoading ? (
                <Loader2 size={14} className="animate-spin text-ink-4" />
              ) : (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border
                                 ${twoFaEnabled
                                   ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                                   : 'text-ink-4 bg-white/[0.04] border-white/[0.08]'}`}>
                  {twoFaEnabled ? '● Activé' : '○ Désactivé'}
                </span>
              )}
            </div>

            {twoFaStep === 'idle' && !twoFaLoading && (
              <>
                <p className="text-xs text-ink-4">
                  {twoFaEnabled
                    ? 'Ton compte est protégé. Tu devras entrer un code à chaque connexion.'
                    : 'Protège ton compte avec une application comme Google Authenticator ou Authy.'}
                </p>
                {twoFaEnabled ? (
                  <button onClick={() => { setTwoFaStep('disable'); setTotpCode(''); setTwoFaError(''); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                               text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all">
                    <ShieldOff size={14} /> Désactiver le 2FA
                  </button>
                ) : (
                  <button onClick={start2FaSetup} disabled={twoFaActionLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                               text-white bg-primary hover:bg-primary-light disabled:opacity-60 transition-all">
                    {twoFaActionLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                    Activer le 2FA
                  </button>
                )}
              </>
            )}

            {twoFaStep === 'setup' && (
              <form onSubmit={confirm2FaEnable} className="space-y-4">
                <p className="text-xs text-ink-3 text-center">
                  Scanne le QR avec ton application, puis entre le code pour confirmer.
                </p>
                {qrDataUrl && (
                  <div className="flex justify-center">
                    <img src={qrDataUrl} alt="QR 2FA"
                      className="w-36 h-36 rounded-xl border border-white/[0.1] p-2 bg-white" />
                  </div>
                )}
                {secret && (
                  <div className="text-center">
                    <button type="button" onClick={() => setShowSecret(s => !s)}
                      className="text-[10px] text-ink-4 hover:text-ink-2 flex items-center gap-1 mx-auto transition-colors">
                      {showSecret ? <EyeOff size={10} /> : <Eye size={10} />}
                      {showSecret ? 'Masquer' : 'Afficher'} la clé manuelle
                    </button>
                    {showSecret && (
                      <p className="text-[10px] font-mono text-ink-3 mt-1 break-all select-all px-2">{secret}</p>
                    )}
                  </div>
                )}
                <TotpInput value={totpCode} onChange={setTotpCode} autoFocus />
                {twoFaError && <p className="text-xs text-red-400 text-center">{twoFaError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={reset2Fa}
                    className="flex-1 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1
                               hover:bg-white/[0.05] transition-all">Annuler</button>
                  <button type="submit"
                    disabled={twoFaActionLoading || totpCode.replace(/\s/g, '').length < 6}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-primary
                               hover:bg-primary-light disabled:opacity-60 transition-all
                               flex items-center justify-center gap-2">
                    {twoFaActionLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Confirmer
                  </button>
                </div>
              </form>
            )}

            {twoFaStep === 'disable' && (
              <form onSubmit={confirm2FaDisable} className="space-y-4">
                <p className="text-xs text-ink-3 text-center">
                  Entre le code de ton application pour confirmer la désactivation.
                </p>
                <TotpInput value={totpCode} onChange={setTotpCode} autoFocus />
                {twoFaError && <p className="text-xs text-red-400 text-center">{twoFaError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={reset2Fa}
                    className="flex-1 py-2 rounded-xl text-sm text-ink-3 hover:text-ink-1
                               hover:bg-white/[0.05] transition-all">Annuler</button>
                  <button type="submit"
                    disabled={twoFaActionLoading || totpCode.replace(/\s/g, '').length < 6}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-red-600
                               hover:bg-red-500 disabled:opacity-60 transition-all
                               flex items-center justify-center gap-2">
                    {twoFaActionLoading ? <Loader2 size={13} className="animate-spin" /> : <ShieldOff size={13} />}
                    Désactiver
                  </button>
                </div>
              </form>
            )}
          </div>
        </Section>
      </div>

      {/* ── All-time stats footer ─────────────────────────────────────────── */}
      <div className="bg-surface-card border border-white/[0.06] rounded-2xl px-5 py-4">
        <p className="text-xs font-semibold text-ink-3 mb-3">Statistiques globales</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Tickets claim',   value: stats.allTimeClaimed },
            { label: 'Tickets fermés',  value: stats.allTimeClosed  },
            { label: 'Avis reçus',      value: stats.ratingCount    },
            { label: 'Score mois prec.', value: stats.lastMonth     },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xl font-bold text-ink-1 tabular-nums">{value ?? 0}</p>
              <p className="text-[10px] text-ink-4 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
