// Sign-in from a new device: the account owner gets a Discord DM (browser, system, IP, time, and
// what to do if it was not them). A device is the browser + system pair read from the user agent;
// it is new when none of the account's previous successful sign-ins used it. The very first
// sign-in of an account sends nothing. A new IP on a known device sends nothing either (mobile
// and home connections change IP all the time).
const { globalQuery } = require('./globalDb');

function deviceOf(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur inconnu';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'système inconnu';
  return `${browser} sur ${os}`;
}

// Call before the sign-in itself is logged in login_logs. Returns the device when an alert is due.
async function newDeviceFor(userId, userAgent) {
  const rows = await globalQuery("SELECT user_agent FROM login_logs WHERE user_id = ? AND status = 'success' ORDER BY id DESC LIMIT 100", [userId]);
  if (!rows.length) return null; // first sign-in
  const device = deviceOf(userAgent);
  return rows.some(r => deviceOf(r.user_agent) === device) ? null : device;
}

// send: (userId, payload) => Promise — posts a DM through the bot
async function alertNewDevice({ userId, userAgent, ip, baseUrl, send }) {
  const device = await newDeviceFor(userId, userAgent);
  if (!device) return null;
  const base = baseUrl ? baseUrl.replace(/\/$/, '') : null;
  await send(userId, {
    embeds: [{
      color: 0xf59e0b,
      title: '🔐 Nouvelle connexion au dashboard',
      description: `Ton compte vient de se connecter depuis un appareil inhabituel.\n\n**Appareil :** ${device}\n**Adresse IP :** \`${ip || 'inconnue'}\`\n**Date :** <t:${Math.floor(Date.now() / 1000)}:F>\n\nSi ce n'est pas toi : ouvre ton profil → **Sessions actives** → déconnecte toutes les sessions, puis active la double authentification.`,
      ...(base ? { url: `${base}/profile` } : {}),
      footer: { text: 'Message de sécurité automatique' },
    }],
  });
  return device;
}

module.exports = { deviceOf, newDeviceFor, alertNewDevice };
