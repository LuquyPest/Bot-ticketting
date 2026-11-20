// Jira, GitHub and GitLab for a space (v7, conception/v7.md §3.10). From a ticket, the staff creates
// an issue in the team's tracker or links an existing one; its state shows on the ticket and is kept
// up to date by the tracker's webhook; when the issue is closed, an internal note says so.
// Tokens are given by a founder, sealed, never sent back. Outgoing calls only go to the configured
// tracker (https; api.github.com for GitHub); GITHUB_API_URL / DEV_ALLOW_PRIVATE_HOSTS exist for tests.
// Incoming webhooks: one secret per space and tracker in the URL; GitHub's HMAC signature and
// GitLab's token header are checked too.
const crypto = require('crypto');
const { seal, open } = require('./secretBox');

const PROVIDERS = ['github', 'gitlab', 'jira'];
const LABELS = { github: 'GitHub', gitlab: 'GitLab', jira: 'Jira' };
const MAX_LINKS = 20;
const githubBase = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');

async function raw(db) {
  const [c] = await db('SELECT dev_integrations FROM guild_config WHERE id = 1').catch(() => []);
  try { return c?.dev_integrations ? JSON.parse(open(c.dev_integrations)) : {}; } catch { return {}; }
}
async function settings(db, guildId) {
  const r = await raw(db);
  const base = String(require('./config').config.webServerBaseUrl || '').replace(/\/$/, '');
  const out = {};
  for (const p of PROVIDERS) {
    const s = r[p] || {};
    out[p] = { enabled: !!s.enabled, hasToken: !!s.token, repo: s.repo || '', baseUrl: s.baseUrl || '', project: s.project || '', email: s.email || '', issueType: s.issueType || '',
      webhookUrl: s.secret ? `${base}/api/dev-hooks/${guildId}/${p}/${s.secret}` : null };
  }
  return out;
}
function httpsOk(url) {
  try { const u = new URL(url); return u.protocol === 'https:' || (process.env.DEV_ALLOW_PRIVATE_HOSTS === '1' && u.protocol === 'http:'); } catch { return false; }
}
async function saveSettings(db, provider, input = {}) {
  if (!PROVIDERS.includes(provider)) return { error: 'Outil inconnu' };
  const all = await raw(db);
  const cur = all[provider] || {};
  const str = (k, max = 300) => (typeof input[k] === 'string' ? input[k].trim().slice(0, max) : cur[k] || '');
  const next = { enabled: !!input.enabled, token: typeof input.token === 'string' && input.token.trim() ? input.token.trim().slice(0, 500) : cur.token || '', secret: cur.secret || crypto.randomBytes(20).toString('hex') };
  if (provider === 'github') {
    next.repo = str('repo', 140);
    if (next.enabled && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(next.repo)) return { error: 'Dépôt GitHub : propriétaire/dépôt' };
  } else if (provider === 'gitlab') {
    next.baseUrl = (str('baseUrl', 300) || 'https://gitlab.com').replace(/\/$/, '');
    next.project = str('project', 200);
    if (next.enabled && (!httpsOk(next.baseUrl) || !next.project)) return { error: 'GitLab : adresse https et projet (identifiant ou groupe/projet)' };
  } else {
    next.baseUrl = str('baseUrl', 300).replace(/\/$/, '');
    next.email = str('email', 254);
    next.project = str('project', 40).toUpperCase();
    next.issueType = str('issueType', 60) || 'Task';
    if (next.enabled && (!httpsOk(next.baseUrl) || !next.email || !/^[A-Z][A-Z0-9_]{0,39}$/.test(next.project))) return { error: 'Jira : adresse https, adresse e-mail du compte et clé du projet (ABC)' };
  }
  if (next.enabled && !next.token) return { error: 'Jeton d\'accès requis' };
  if (input.newSecret) next.secret = crypto.randomBytes(20).toString('hex');
  all[provider] = next;
  await db('UPDATE guild_config SET dev_integrations = ? WHERE id = 1', [seal(JSON.stringify(all))]);
  return { ok: true };
}

// ── HTTP ──
async function call(url, { method = 'GET', headers = {}, body } = {}) {
  if (!httpsOk(url) && !url.startsWith(githubBase())) throw new Error('Adresse refusée');
  const res = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json', 'User-Agent': 'Datick', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error(`${res.status}${data?.message ? ` (${String(data.message).slice(0, 120)})` : data?.errorMessages?.[0] ? ` (${String(data.errorMessages[0]).slice(0, 120)})` : ''}`), { status: res.status });
  return data;
}
const ghHeaders = s => ({ Authorization: `Bearer ${s.token}`, 'X-GitHub-Api-Version': '2022-11-28' });
const glHeaders = s => ({ 'PRIVATE-TOKEN': s.token });
const jiraHeaders = s => ({ Authorization: `Basic ${Buffer.from(`${s.email}:${s.token}`).toString('base64')}` });
const glProject = s => encodeURIComponent(s.project);

// The tracker's answer → { externalId, key, url, title, state }
const shapeGh = i => ({ externalId: String(i.number), key: `#${i.number}`, url: i.html_url, title: i.title, state: i.state === 'closed' ? 'closed' : 'open' });
const shapeGl = i => ({ externalId: String(i.iid), key: `#${i.iid}`, url: i.web_url, title: i.title, state: i.state === 'closed' ? 'closed' : 'open' });
const shapeJira = (s, i) => ({ externalId: i.key, key: i.key, url: `${s.baseUrl}/browse/${encodeURIComponent(i.key)}`, title: i.fields?.summary || i.key, state: i.fields?.status?.statusCategory?.key === 'done' ? 'closed' : 'open', status: i.fields?.status?.name || null });

async function createIssue(s, provider, { title, body }) {
  if (provider === 'github') return shapeGh(await call(`${githubBase()}/repos/${s.repo}/issues`, { method: 'POST', headers: ghHeaders(s), body: { title, body } }));
  if (provider === 'gitlab') return shapeGl(await call(`${s.baseUrl}/api/v4/projects/${glProject(s)}/issues`, { method: 'POST', headers: glHeaders(s), body: { title, description: body } }));
  const created = await call(`${s.baseUrl}/rest/api/2/issue`, { method: 'POST', headers: jiraHeaders(s), body: { fields: { project: { key: s.project }, summary: title, description: body, issuetype: { name: s.issueType || 'Task' } } } });
  return shapeJira(s, await call(`${s.baseUrl}/rest/api/2/issue/${encodeURIComponent(created.key)}?fields=summary,status`, { headers: jiraHeaders(s) }));
}
async function fetchIssue(s, provider, ref) {
  if (provider === 'github') { const n = /(\d+)\s*$/.exec(String(ref))?.[1]; if (!n) throw new Error('Numéro d\'issue invalide'); return shapeGh(await call(`${githubBase()}/repos/${s.repo}/issues/${n}`, { headers: ghHeaders(s) })); }
  if (provider === 'gitlab') { const n = /(\d+)\s*$/.exec(String(ref))?.[1]; if (!n) throw new Error('Numéro d\'issue invalide'); return shapeGl(await call(`${s.baseUrl}/api/v4/projects/${glProject(s)}/issues/${n}`, { headers: glHeaders(s) })); }
  const key = /([A-Z][A-Z0-9_]*-\d+)\s*$/.exec(String(ref).toUpperCase())?.[1];
  if (!key) throw new Error('Clé de ticket Jira invalide (ABC-12)');
  return shapeJira(s, await call(`${s.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,status`, { headers: jiraHeaders(s) }));
}

// ── Links of a ticket ──
async function linksOf(db, ticketId) {
  return (await db('SELECT id, provider, external_id, issue_key, url, title, state, status_name, updated_at FROM ticket_issues WHERE ticket_id = ? ORDER BY id', [ticketId]).catch(() => []))
    .map(r => ({ id: r.id, provider: r.provider, label: LABELS[r.provider], key: r.issue_key, url: r.url, title: r.title, state: r.state, status: r.status_name || null, updatedAt: r.updated_at }));
}
async function store(db, ticketId, provider, i) {
  await db(`INSERT INTO ticket_issues (ticket_id, provider, external_id, issue_key, url, title, state, status_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE url = VALUES(url), title = VALUES(title), state = VALUES(state), status_name = VALUES(status_name)`,
  [ticketId, provider, i.externalId, i.key.slice(0, 40), String(i.url || '').slice(0, 500), String(i.title || '').slice(0, 300), i.state, i.status ? String(i.status).slice(0, 60) : null]);
}
const note = (db, ticketId, text) => db("INSERT INTO ticket_notes (ticket_id, author_id, author_tag, content, source) VALUES (?, 'system', 'Intégrations', ?, 'system')", [ticketId, text]);

async function enabledProvider(db, provider) {
  const s = (await raw(db))[provider];
  return s?.enabled && s.token ? s : null;
}
// From a ticket: a new issue (title and body written by the staff) or an existing one
async function create(db, ticket, provider, input, actor) {
  const s = await enabledProvider(db, provider);
  if (!s) return { error: `${LABELS[provider] || 'Outil'} n'est pas branché`, status: 404 };
  const [{ n }] = await db('SELECT COUNT(*) AS n FROM ticket_issues WHERE ticket_id = ?', [ticket.id]);
  if (Number(n) >= MAX_LINKS) return { error: `${MAX_LINKS} issues au plus par ticket` };
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 250) : (ticket.subject || `Ticket #${ticket.id}`);
  const body = typeof input.body === 'string' ? input.body.slice(0, 10000) : '';
  let i;
  try { i = await createIssue(s, provider, { title, body }); } catch (err) { return { error: `${LABELS[provider]} : ${err.message}`, status: 502 }; }
  await store(db, ticket.id, provider, i);
  await note(db, ticket.id, `🔗 ${LABELS[provider]} ${i.key} créée par ${actor?.username || actor?.tag || '—'} : ${i.title}`);
  await require('./audit').recordEvent(db, { actor, action: 'dev_issue', ticketId: ticket.id, details: { provider, key: i.key, created: true } });
  return { ok: true, issue: i };
}
async function link(db, ticket, provider, ref, actor) {
  const s = await enabledProvider(db, provider);
  if (!s) return { error: `${LABELS[provider] || 'Outil'} n'est pas branché`, status: 404 };
  let i;
  try { i = await fetchIssue(s, provider, ref); } catch (err) { return { error: `${LABELS[provider]} : ${err.message}`, status: err.status === 404 ? 404 : 502 }; }
  await store(db, ticket.id, provider, i);
  await require('./audit').recordEvent(db, { actor, action: 'dev_issue', ticketId: ticket.id, details: { provider, key: i.key, created: false } });
  return { ok: true, issue: i };
}
async function unlink(db, ticketId, id) {
  await db('DELETE FROM ticket_issues WHERE id = ? AND ticket_id = ?', [id, ticketId]);
  return { ok: true };
}

// ── Incoming webhooks ──
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// → { updated } or { error, status }
async function webhook(db, provider, secret, headers, rawBody) {
  const s = (await raw(db))[provider];
  if (!s?.enabled || !s.secret || !safeEq(secret, s.secret)) return { error: 'Inconnu', status: 404 };
  if (provider === 'github') {
    const sig = String(headers['x-hub-signature-256'] || '');
    const want = `sha256=${crypto.createHmac('sha256', s.secret).update(rawBody).digest('hex')}`;
    if (!safeEq(sig, want)) return { error: 'Signature invalide', status: 401 };
  }
  if (provider === 'gitlab' && !safeEq(headers['x-gitlab-token'] || '', s.secret)) return { error: 'Jeton invalide', status: 401 };
  let p;
  try { p = JSON.parse(rawBody.toString('utf8')); } catch { return { error: 'Corps invalide', status: 400 }; }
  let i = null;
  if (provider === 'github' && p.issue) i = { externalId: String(p.issue.number), title: p.issue.title, state: p.issue.state === 'closed' ? 'closed' : 'open', status: null };
  if (provider === 'gitlab' && p.object_attributes && (p.object_kind === 'issue' || p.event_type === 'issue')) i = { externalId: String(p.object_attributes.iid), title: p.object_attributes.title, state: p.object_attributes.state === 'closed' ? 'closed' : 'open', status: null };
  if (provider === 'jira' && p.issue?.key) i = { externalId: p.issue.key, title: p.issue.fields?.summary, state: p.issue.fields?.status?.statusCategory?.key === 'done' ? 'closed' : 'open', status: p.issue.fields?.status?.name || null };
  if (!i) return { updated: 0 };
  const rows = await db('SELECT id, ticket_id, state, issue_key FROM ticket_issues WHERE provider = ? AND external_id = ?', [provider, i.externalId]);
  for (const r of rows) {
    await db('UPDATE ticket_issues SET state = ?, title = COALESCE(?, title), status_name = ? WHERE id = ?', [i.state, i.title ? String(i.title).slice(0, 300) : null, i.status ? String(i.status).slice(0, 60) : null, r.id]);
    if (r.state !== 'closed' && i.state === 'closed') await note(db, r.ticket_id, `✅ ${LABELS[provider]} ${r.issue_key} fermée${i.title ? ` : ${i.title}` : ''}`);
    if (r.state === 'closed' && i.state === 'open') await note(db, r.ticket_id, `↩️ ${LABELS[provider]} ${r.issue_key} rouverte`);
    require('./sse').broadcast('ticket', { id: r.ticket_id }, db.guildId);
  }
  return { updated: rows.length };
}

// « Tester » (v8): reads the project with the saved token → { ok, detail } or { error }
async function test(db, provider) {
  if (!PROVIDERS.includes(provider)) return { error: 'Outil inconnu', status: 404 };
  const s = (await raw(db))[provider];
  if (!s?.token) return { error: 'Aucun jeton enregistré' };
  const { explain } = require('./crm');
  try {
    if (provider === 'github') {
      const r = await call(`${githubBase()}/repos/${s.repo}`, { headers: ghHeaders(s) });
      if (r?.has_issues === false) return { error: `${r.full_name} : les issues sont désactivées sur ce dépôt` };
      return { ok: true, detail: `GitHub : dépôt ${r?.full_name || s.repo} lisible${r?.permissions && !r.permissions.push && !r.permissions.triage ? ' (le jeton ne pourra peut-être pas créer d\'issue)' : ''}.` };
    }
    if (provider === 'gitlab') {
      const r = await call(`${s.baseUrl}/api/v4/projects/${glProject(s)}`, { headers: glHeaders(s) });
      return { ok: true, detail: `GitLab : projet ${r?.path_with_namespace || s.project} lisible.` };
    }
    const me = await call(`${s.baseUrl}/rest/api/2/myself`, { headers: jiraHeaders(s) });
    const pr = await call(`${s.baseUrl}/rest/api/2/project/${encodeURIComponent(s.project)}`, { headers: jiraHeaders(s) });
    const types = (pr?.issueTypes || []).map(t => t.name);
    if (types.length && !types.includes(s.issueType || 'Task')) return { error: `Jira : le type « ${s.issueType || 'Task'} » n'existe pas dans ${s.project} (${types.slice(0, 8).join(', ')})` };
    return { ok: true, detail: `Jira : connecté en tant que ${me?.displayName || s.email}, projet ${pr?.name || s.project}.` };
  } catch (err) { return { error: explain(err) }; }
}

module.exports = { test, PROVIDERS, LABELS, settings, saveSettings, linksOf, create, link, unlink, webhook };
