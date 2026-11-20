// Datick mobile (v7, conception/v7.md §3.11): the instance is chosen once and remembered; its
// dashboard then opens in the app. Notifications: this local page (the only one with the native
// bridge) registers with Firebase Cloud Messaging and hands the device token to the instance
// through /mobile-link, where the signed-in person attaches it to their account.
(function () {
  var KEY = 'datick.instance';
  var f = document.getElementById('f'), input = document.getElementById('url'), msg = document.getElementById('msg'), go = document.getElementById('go'), change = document.getElementById('change');
  var Cap = window.Capacitor, Push = Cap && Cap.Plugins && Cap.Plugins.PushNotifications;
  var platform = Cap && Cap.getPlatform ? Cap.getPlatform() : 'web';

  function say(text, err) { msg.textContent = text; msg.className = err ? 'err' : ''; }
  function clean(v) {
    v = String(v || '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { var u = new URL(v); return u.protocol === 'https:' ? u.origin : null; } catch (e) { return null; }
  }
  // A push token, when Firebase is set up in this build (else null, the app works without)
  function pushToken() {
    if (!Push) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false, finish = function (t) { if (!done) { done = true; resolve(t); } };
      setTimeout(function () { finish(null); }, 6000);
      Push.addListener('registration', function (t) { finish(t && t.value); });
      Push.addListener('registrationError', function () { finish(null); });
      Push.requestPermissions().then(function (p) { if (p.receive === 'granted') Push.register(); else finish(null); }).catch(function () { finish(null); });
    });
  }
  function open(origin) {
    say('Connexion à ' + origin + '…');
    go.disabled = true;
    fetch(origin + '/api/health', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function () {
        localStorage.setItem(KEY, origin);
        return pushToken().then(function (token) {
          window.location.href = token ? origin + '/mobile-link#' + encodeURIComponent(platform) + ':' + encodeURIComponent(token) : origin + '/';
        });
      })
      .catch(function () { say('Instance injoignable : vérifie l\'adresse ou ta connexion.', true); go.disabled = false; change.hidden = false; });
  }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var origin = clean(input.value);
    if (!origin) { say('Une adresse https://…', true); return; }
    open(origin);
  });
  change.addEventListener('click', function () { localStorage.removeItem(KEY); change.hidden = true; input.focus(); say(''); });
  // A notification tapped: open the ticket it is about
  if (Push) Push.addListener('pushNotificationActionPerformed', function (a) { var u = a && a.notification && a.notification.data && a.notification.data.url; var o = localStorage.getItem(KEY); if (u && o && u.indexOf(o + '/') === 0) window.location.href = u; });
  var saved = localStorage.getItem(KEY);
  if (saved) { input.value = saved; open(saved); }
})();
