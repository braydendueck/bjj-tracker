'use strict';
/* BJJ Tracker: static PWA. Training data (data.json) and the gym curriculum (curriculum.json) live in a PRIVATE GitHub
   repo and are read/written with the GitHub contents API using a fine-grained token kept only in this browser. */
(() => {
const API = 'https://api.github.com';
const DATA = 'data.json', CUR = 'curriculum.json';
const DEFAULT_REPO = 'braydendueck/bjj-tracker-data';
const LS = { token: 'bjj.token', repo: 'bjj.repo', cache: 'bjj.cache', pending: 'bjj.pending' };
const OTHER_TOKEN = 'ot.token'; // Order Tracker token on the same github.io origin (optional reuse)
const KIT = { gi: 'Gi', nogi: 'No-gi' };
const TYPES = [['fundamentals', 'Fundamentals'], ['drilling_sparring', 'Drilling & sparring'], ['open_mat', 'Open mat']];
const TYPE = Object.fromEntries(TYPES);
const RES = [['worked', 'Worked'], ['partly', 'Partly'], ['no', "Didn't come up"]];
const RESL = Object.fromEntries(RES);
const MST = [['not', 'Not started'], ['learning', 'Learning'], ['got', 'Got it']];
const TARGET = [25, 30];
const DEFAULT_FOCUS = [
  { week: 1, title: 'Mount escapes', moves: ['trap-and-roll-escape-upa', 'elbow-knee-escape'] },
  { week: 2, title: 'Side control escapes', moves: ['frame-and-shrimp-to-recover-guard', 'underhook-to-knees', 'run-the-pipe'] },
  { week: 3, title: 'Knee-slice and toreando passes', moves: ['knee-slice-pass', 'toreando-pass'] },
  { week: 4, title: 'Chaining them together', moves: ['chaining-survive-to-escape-to-sweep'] }];
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=BJJ+Tracker+phone&description=BJJ+Tracker+app%3A+read%2Fwrite+bjj-tracker-data+only&target_name=braydendueck&expires_in=90&contents=write';
const TOKEN_LIST = 'https://github.com/settings/personal-access-tokens';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const $ = s => document.querySelector(s);
const main = $('#main');
const S = {
  token: localStorage.getItem(LS.token) || '', repo: localStorage.getItem(LS.repo) || DEFAULT_REPO,
  base: null, sha: null, cur: null, curSha: null, syncedAt: null, loaded: false, pending: [],
  tab: 'log', view: 'main', net: 'idle', problem: null, open: new Set(), mq: '', mf: 'all',
};

// ---------- helpers ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDay(new Date());
const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const dayDiff = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 864e5);
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
function fmtDay(s, dow = true) { const d = parseDay(s); if (!d) return ''; const y = d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : ''; return `${dow ? DOW[d.getDay()] + ', ' : ''}${MON[d.getMonth()]} ${d.getDate()}${y}`; }
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function b64decode(b64) { const bin = atob(String(b64).replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
let toastT;
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
function ago(ts) { if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 6e4); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; return new Date(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); }

// ---------- data model ----------
function emptyData() { return { version: 1, settings: { focusStart: '2026-10-12', focus: clone(DEFAULT_FOCUS) }, sessions: [], moves: {}, checklist: {} }; }
function normalize(d) {
  const e = emptyData(); d = d && typeof d === 'object' ? d : {};
  return { ...d, version: 1, settings: { ...e.settings, ...(d.settings || {}) }, sessions: Array.isArray(d.sessions) ? d.sessions : [], moves: d.moves && typeof d.moves === 'object' ? d.moves : {}, checklist: d.checklist && typeof d.checklist === 'object' ? d.checklist : {} };
}
function applyOps(d0, ops) {
  const d = normalize(clone(d0 || emptyData()));
  for (const op of ops) {
    if (op.op === 'session') {
      const s = d.sessions.find(x => x.id === op.id);
      if (s) Object.assign(s, op.fields, { updatedAt: op.at });
      else if (op.create) d.sessions.push({ id: op.id, date: '', kit: 'gi', type: 'fundamentals', notes: '', goals: [], ...op.fields, createdAt: op.at, updatedAt: op.at });
    } else if (op.op === 'session.delete') d.sessions = d.sessions.filter(x => x.id !== op.id);
    else if (op.op === 'goal') {
      const s = d.sessions.find(x => x.id === op.id); const g = s && (s.goals || []).find(x => x.id === op.gid);
      if (g) { g.result = op.result; s.updatedAt = op.at; }
    } else if (op.op === 'move') { if (op.status === 'not') delete d.moves[op.id]; else d.moves[op.id] = op.status; }
    else if (op.op === 'check') { if (op.on) d.checklist[op.id] = op.on; else delete d.checklist[op.id]; }
    else if (op.op === 'settings') Object.assign(d.settings, op.fields);
  }
  return d;
}
const cur = () => applyOps(S.base, S.pending);
const C = () => S.cur || { blocks: [], groups: [], moves: [], checklist: [] };
const moveById = id => C().moves.find(m => m.id === id);
const mstat = (d, id) => d.moves[id] || 'not';
function sessionsSorted(d) { return d.sessions.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '')); }
function focusInfo(d, t = today()) {
  const st = d.settings.focusStart, f = d.settings.focus && d.settings.focus.length ? d.settings.focus : DEFAULT_FOCUS;
  if (!parseDay(st)) return { state: 'none', f };
  const diff = dayDiff(t, st);
  if (diff < 0) return { state: 'before', week: f[0], n: 1, start: st, days: -diff, f };
  const n = Math.floor(diff / 7) + 1;
  if (n > f.length) return { state: 'after', start: st, end: addDays(st, f.length * 7 - 1), f };
  return { state: 'on', week: f[n - 1], n, start: st, weekStart: addDays(st, (n - 1) * 7), weekEnd: addDays(st, n * 7 - 1), f };
}
const goalKey = g => g.moveId ? 'm:' + g.moveId : 't:' + String(g.text || '').trim().toLowerCase().replace(/\s+/g, ' ');
const goalName = g => (g.moveId && moveById(g.moveId) ? moveById(g.moveId).name : g.text) || '';
function goalStats(d) {
  const map = new Map();
  for (const s of d.sessions.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))) for (const g of s.goals || []) {
    const k = goalKey(g); if (!map.has(k)) map.set(k, { key: k, name: goalName(g), moveId: g.moveId || '', set: 0, worked: 0, partly: 0, no: 0, open: 0, hist: [] });
    const st = map.get(k); st.set++; st[g.result && RESL[g.result] ? g.result : 'open']++; st.hist.push({ date: s.date, result: g.result || 'open' });
  }
  const out = [...map.values()].map(x => { const up = x.worked + x.partly; return { ...x, cameUp: up, rated: up + x.no, rate: up ? Math.round((x.worked + x.partly / 2) / up * 100) : null }; });
  return out.sort((a, b) => b.set - a.set || (b.hist.at(-1).date || '').localeCompare(a.hist.at(-1).date || ''));
}
function persist() {
  localStorage.setItem(LS.cache, JSON.stringify({ data: S.base, sha: S.sha, cur: S.cur, curSha: S.curSha, at: S.syncedAt, repo: S.repo }));
  localStorage.setItem(LS.pending, JSON.stringify(S.pending));
}
function restore() {
  try { const c = JSON.parse(localStorage.getItem(LS.cache) || 'null'); if (c && c.repo === S.repo && c.cur) Object.assign(S, { base: c.data, sha: c.sha, cur: c.cur, curSha: c.curSha, syncedAt: c.at, loaded: true }); } catch (e) { /* ignore */ }
  try { S.pending = JSON.parse(localStorage.getItem(LS.pending) || '[]'); } catch (e) { S.pending = []; }
}

// ---------- GitHub API ----------
class ApiError extends Error { constructor(kind, msg, status) { super(msg); this.kind = kind; this.status = status; } }
async function gh(path, opts = {}, token = S.token) {
  let r;
  try { r = await fetch(API + path, { ...opts, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch (e) { throw new ApiError('offline', 'No connection to GitHub.'); }
  if (r.ok) return r.json();
  let body = {}; try { body = await r.json(); } catch (e) { /* ignore */ }
  const m = body.message || '';
  if (r.status === 401) throw new ApiError('auth', 'GitHub rejected the token (wrong, revoked or expired).', 401);
  if (r.status === 404) throw new ApiError('notfound', 'Not found', 404);
  if (r.status === 409 || (r.status === 422 && /sha/i.test(m))) throw new ApiError('conflict', 'Changed elsewhere', r.status);
  if (r.status === 403 && /rate limit/i.test(m)) throw new ApiError('rate', 'GitHub rate limit hit. Try again in a few minutes.', 403);
  if (r.status === 403) throw new ApiError('forbidden', `This token can't save. It needs Contents: Read and write on ${S.repo}.`, 403);
  throw new ApiError('http', `GitHub error ${r.status}${m ? ': ' + m : ''}`, r.status);
}
async function getFile(name, token, repo) { const j = await gh(`/repos/${repo}/contents/${name}`, {}, token); return { json: JSON.parse(b64decode(j.content)), sha: j.sha }; }
async function fetchRemote(token = S.token, repo = S.repo, wantCur = true) {
  let data, curr;
  try { data = await getFile(DATA, token, repo); }
  catch (e) {
    if (e.kind !== 'notfound') throw e;
    try { await gh(`/repos/${repo}`, {}, token); } catch (e2) { if (e2.kind === 'notfound') throw new ApiError('norepo', `This token can't see ${repo}. Give it access to that repository.`); throw e2; }
    data = { json: emptyData(), sha: null };
  }
  if (wantCur) {
    try { curr = await getFile(CUR, token, repo); } catch (e) { if (e.kind === 'notfound') throw new ApiError('http', `${CUR} is missing from ${repo}.`); throw e; }
    if (!curr.json || !Array.isArray(curr.json.moves)) throw new ApiError('http', `${CUR} is not in the expected format.`);
  }
  return { data: normalize(data.json), sha: data.sha, cur: curr && curr.json, curSha: curr && curr.sha };
}
function commitMsg(ops) {
  if (ops.length > 1) return `App: ${ops.length} changes`;
  const op = ops[0];
  if (op.op === 'session') return `App: ${op.create ? 'log' : 'update'} session ${op.fields.date || ''}`.trim();
  if (op.op === 'session.delete') return 'App: delete session';
  if (op.op === 'goal') return `App: goal ${RESL[op.result] || 'cleared'}`;
  if (op.op === 'move') return `App: ${(moveById(op.id) || {}).name || op.id} → ${Object.fromEntries(MST)[op.status]}`;
  if (op.op === 'check') return `App: checklist ${op.on ? 'ticked' : 'unticked'}`;
  return 'App: settings';
}
let syncing = null;
function sync() { if (!syncing) syncing = doSync().finally(() => { syncing = null; }); return syncing; }
async function doSync() {
  let conflicts = 0, merged = false;
  while (S.pending.length && S.token) {
    const ops = S.pending.slice();
    const next = applyOps(S.base, ops); next.updatedAt = new Date().toISOString();
    S.net = 'saving'; renderChrome();
    try {
      const body = { message: commitMsg(ops), content: b64encode(JSON.stringify(next, null, 2) + '\n') };
      if (S.sha) body.sha = S.sha;
      const res = await gh(`/repos/${S.repo}/contents/${DATA}`, { method: 'PUT', body: JSON.stringify(body) });
      S.base = next; S.sha = res.content.sha; S.syncedAt = Date.now();
      S.pending = S.pending.slice(ops.length); S.problem = null; S.net = 'idle'; persist();
    } catch (e) {
      if (e.kind === 'conflict' && conflicts < 3) {
        conflicts++; merged = true;
        try { const r = await fetchRemote(S.token, S.repo, false); S.base = r.data; S.sha = r.sha; persist(); continue; } catch (e2) { fail(e2); break; }
      }
      fail(e); break;
    }
  }
  if (merged && !S.pending.length) toast('Changes were made elsewhere too. Merged both.');
  render();
}
async function refresh() {
  if (!S.token) return;
  S.net = 'loading'; renderChrome();
  try {
    const r = await fetchRemote();
    Object.assign(S, { base: r.data, sha: r.sha, cur: r.cur, curSha: r.curSha, syncedAt: Date.now(), loaded: true, problem: null, net: 'idle' }); persist();
    if (S.pending.length) await sync(); else render();
  } catch (e) { fail(e); render(); }
}
function fail(e) { S.net = e.kind === 'offline' ? 'offline' : 'error'; S.problem = { kind: e.kind, msg: e.message }; }
function change(op, msg) { S.pending.push({ ...op, at: new Date().toISOString() }); persist(); render(); sync(); if (msg) toast(msg); }

// ---------- chrome ----------
function renderChrome() {
  const ss = $('#syncstate'), n = S.pending.length;
  let cls = '', txt = '';
  if (!S.token) txt = '';
  else if (S.net === 'saving') { cls = 'saving'; txt = 'Saving…'; }
  else if (S.net === 'loading') { cls = 'saving'; txt = 'Loading…'; }
  else if (S.net === 'offline') { cls = 'offline'; txt = n ? `Offline · ${n} unsaved` : 'Offline'; }
  else if (S.net === 'error') { cls = 'error'; txt = n ? `${n} unsaved` : 'Sync problem'; }
  else if (n) { cls = 'pending'; txt = `${n} unsaved`; }
  else if (S.syncedAt) txt = 'Synced';
  ss.className = 'syncstate ' + cls; ss.textContent = txt;
  const ready = !!S.token && S.view !== 'setup';
  $('#btnRefresh').hidden = !S.token; $('#btnSettings').hidden = !S.token;
  $('#btnSettings').classList.toggle('on', S.view === 'settings');
  $('#nav').hidden = !ready || !S.loaded; document.body.classList.toggle('noadd', $('#nav').hidden);
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', S.view === 'main' && b.dataset.tab === S.tab));
  const b = $('#banner'), p = S.problem;
  if (!S.token || !p) { b.hidden = true; return; }
  b.hidden = false; b.className = 'banner' + (p.kind === 'offline' ? '' : ' err');
  if (p.kind === 'offline') b.innerHTML = `<span>Offline. Showing the copy saved ${esc(ago(S.syncedAt))}.${n ? ' Your changes will save when you are back online.' : ''}</span><button data-act="retry">Retry</button>`;
  else if (['auth', 'norepo', 'forbidden'].includes(p.kind)) b.innerHTML = `<span>${esc(p.msg)}${n ? ` ${n} change(s) are kept on this phone.` : ''}</span><button data-act="newtoken">New token</button>`;
  else b.innerHTML = `<span>${esc(p.msg)}</span><button data-act="retry">Retry</button>`;
}
function render() {
  renderChrome();
  if (!S.token || S.view === 'setup') return renderSetup();
  if (!S.loaded) { main.innerHTML = '<div class="empty">Loading your training log…</div>'; return; }
  if (S.view === 'settings') return renderSettings();
  ({ log: renderLog, goals: renderGoals, moves: renderMoves, journey: renderJourney })[S.tab]();
}

// ---------- shared pieces ----------
function focusBanner(d) {
  const fi = focusInfo(d);
  if (fi.state === 'none') return '';
  if (fi.state === 'after') return `<button class="focus done" data-act="focusedit" id="focusBanner"><div class="fbody"><div class="fw">Four-week focus finished</div><div class="ft">${esc(fi.f.map(w => w.title).join(' → '))}</div><div class="fs">Ran ${esc(fmtDay(fi.start, false))} – ${esc(fmtDay(fi.end, false))}. Set a new start date for another block.</div></div><span class="fedit">Edit</span></button>`;
  const w = fi.week;
  const top = fi.state === 'before' ? `Focus starts ${fi.days === 1 ? 'tomorrow' : 'in ' + fi.days + ' days'} · Week 1 of ${fi.f.length}` : `Focus · Week ${fi.n} of ${fi.f.length}`;
  const sub = fi.state === 'before' ? `Starts ${fmtDay(fi.start)}` : `${fmtDay(fi.weekStart, false)} – ${fmtDay(fi.weekEnd, false)}${fi.n < fi.f.length ? ' · Next: ' + fi.f[fi.n].title : ''}`;
  return `<button class="focus" data-act="focusedit" id="focusBanner"><div class="fbody"><div class="fw">${esc(top)}</div><div class="ft">${esc(w.title)}</div><div class="fs">${esc(sub)}</div></div><span class="fedit">Edit</span></button>`;
}
function classCount(d, compact) {
  const n = d.sessions.length, [lo, hi] = TARGET;
  const msg = n >= hi ? 'Target reached. Tick it on the 90-day board.' : n >= lo ? `In the target range. ${hi - n} more to reach ${hi}.` : `${lo - n} more to reach ${lo}.`;
  return `<div class="count" id="classCount"><div class="big">${n} <small>class${n === 1 ? '' : 'es'} logged · target ${lo}–${hi}</small></div>
    <div class="bar${n >= lo ? ' ok' : ''}"><i style-w="${Math.min(100, pct(n, hi))}"></i><span class="tgt" style-l="${pct(lo, hi)}"></span></div>${compact ? '' : `<div class="msub">${esc(msg)}</div>`}</div>`;
}
// CSP blocks inline style attributes, so widths are applied through the CSSOM after render.
function applyBars(root = main) { root.querySelectorAll('[style-w]').forEach(e => { e.style.width = e.getAttribute('style-w') + '%'; }); root.querySelectorAll('[style-l]').forEach(e => { e.style.left = e.getAttribute('style-l') + '%'; }); }

// ---------- Log ----------
function sessionCard(s) {
  const unrated = (s.goals || []).some(g => !g.result);
  return `<article class="session" data-sid="${esc(s.id)}">
    <div class="shead2"><span class="sdate">${esc(fmtDay(s.date))}</span><span class="tag ${s.kit === 'nogi' ? 'nogi' : 'gi'}">${esc(KIT[s.kit] || 'Gi')}</span><span class="tag type">${esc(TYPE[s.type] || s.type)}</span></div>
    ${(s.goals || []).map(g => `<div class="goal" data-gid="${esc(g.id)}"><div class="gt">🎯 ${esc(goalName(g))}${g.moveId ? '' : (cur().settings.focus || []).some(w => w.title.toLowerCase() === String(g.text).trim().toLowerCase()) ? ' <small>(focus)</small>' : ' <small>(own goal)</small>'}</div>
      <div class="res">${RES.map(([k, l]) => `<button class="${k}${g.result === k ? ' on' : ''}" data-act="rate" data-r="${k}" aria-pressed="${g.result === k}">${esc(l)}</button>`).join('')}</div></div>`).join('')}
    ${unrated ? '<div class="rate-hint">After rolling, tap how each goal went.</div>' : ''}
    ${s.notes ? `<div class="snotes">${esc(s.notes)}</div>` : ''}
    <div class="sact"><button data-act="editsession">Edit</button></div></article>`;
}
function renderLog() {
  const d = cur(), ss = sessionsSorted(d);
  main.innerHTML = `${focusBanner(d)}${classCount(d)}
    <button class="primary" id="btnLog" data-act="newsession">+ Log a class</button>
    <h2>Sessions <span class="n">${ss.length}</span></h2>
    <div id="sessions">${ss.length ? ss.map(sessionCard).join('') : '<div class="empty">No classes logged yet. Tap “+ Log a class” before you roll to set a game plan.</div>'}</div>`;
  applyBars();
}

// ---------- Goals ----------
function renderGoals() {
  const d = cur(), st = goalStats(d), fi = focusInfo(d);
  const focusKeys = new Set(fi.week ? ['t:' + fi.week.title.toLowerCase(), ...fi.week.moves.map(m => 'm:' + m)] : []);
  main.innerHTML = `${focusBanner(d)}
    <h2>Game plan goals <span class="n">${st.length}</span></h2>
    <p class="legend">Success = worked, plus half credit for partly, out of the times it came up. <span class="dots"><i class="worked">✓</i> worked <i class="partly">~</i> partly <i class="no">–</i> didn't come up <i class="open">?</i> not rated</span></p>
    <div id="goalStats">${st.length ? st.map(g => `<div class="gstat" data-key="${esc(g.key)}"><div class="gn"><span>${esc(g.name)}${focusKeys.has(g.key) ? ` <span class="tag type">${fi.state === 'on' ? 'this week' : 'up next'}</span>` : ''}</span><span class="pct">${g.rate == null ? '–' : g.rate + '%'}</span></div>
      <div class="gl">Set ${g.set}× · worked ${g.worked} · partly ${g.partly} · didn't come up ${g.no}${g.open ? ` · ${g.open} not rated` : ''}</div>
      <div class="bar thin ok"><i style-w="${g.rate || 0}"></i></div>
      <div class="dots">${g.hist.slice(-14).map(h => `<i class="${h.result}" title="${esc(fmtDay(h.date) + ': ' + (RESL[h.result] || 'not rated'))}">${{ worked: '✓', partly: '~', no: '–', open: '?' }[h.result]}</i>`).join('')}</div></div>`).join('') : '<div class="empty">No goals yet. Pick 1–2 goals when you log a class, then rate them after rolling.</div>'}</div>`;
  applyBars();
}

// ---------- Moves (curriculum) ----------
function moveRow(m, d, gnum) {
  const s = mstat(d, m.id), others = [m.group, ...m.alsoIn].filter(g => g !== gnum);
  const key = `st:${gnum}:${m.id}`;
  return `<div class="move ${s}" data-mid="${esc(m.id)}"><div class="mt"><b>${esc(m.name)}</b><span class="kit">${{ gi: 'GI', nogi: 'NO-GI', both: 'GI + NO-GI' }[m.kit]}</span></div>
    ${others.length ? `<div class="also">Also in Group ${others.join(', ')}${m.group !== gnum ? ' (counted there)' : ''}</div>` : ''}
    <div class="ms">${MST.map(([k, l]) => `<button class="${k}${s === k ? ' on' : ''}" data-act="mstatus" data-s="${k}" aria-pressed="${s === k}">${l}</button>`).join('')}</div>
    ${m.steps.length ? `<details class="steps2" data-key="${key}"${S.open.has(key) ? ' open' : ''}><summary>Steps (${m.steps.length}) ▾</summary>${m.setup ? `<div class="setup">${esc(m.setup)}</div>` : ''}<ol>${m.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}</div>`;
}
function renderMoves() {
  const d = cur(), c = C();
  const q = S.mq.trim().toLowerCase(), f = S.mf, filtering = !!q || f !== 'all';
  const got = c.moves.filter(m => mstat(d, m.id) === 'got').length, learning = c.moves.filter(m => mstat(d, m.id) === 'learning').length;
  const match = m => (!q || m.name.toLowerCase().includes(q)) && (f === 'all' || mstat(d, m.id) === f);
  const blocks = c.blocks.map(b => {
    const bm = c.moves.filter(m => m.block === b.n), bg = bm.filter(m => mstat(d, m.id) === 'got').length;
    const groups = c.groups.filter(g => g.block === b.n).map(g => {
      const ms = g.moves.map(moveById).filter(Boolean), gg = ms.filter(m => mstat(d, m.id) === 'got').length;
      const shown = ms.filter(match); if (filtering && !shown.length) return '';
      const key = 'g:' + g.n, open = filtering || S.open.has(key);
      return `<details class="grp" data-key="${key}" id="group-${g.n}"${open ? ' open' : ''}><summary><div class="bt"><span>${g.n}. ${esc(g.name)}</span><small>${gg} of ${ms.length} got</small></div><div class="bar thin ok"><i style-w="${pct(gg, ms.length)}"></i></div></summary>
        <div class="grpbody">${filtering ? '' : `<details class="steps2" data-key="why:${g.n}"${S.open.has('why:' + g.n) ? ' open' : ''}><summary>Why this group ▾</summary><p class="why">${esc(g.why)}</p>
          ${g.sparring.length ? `<div class="extra"><h4>Positional sparring</h4>${g.sparring.map(x => `<p>${esc(x)}</p>`).join('')}</div>` : ''}
          ${g.check.length ? `<div class="extra"><h4>Check yourself</h4>${g.check.map(x => `<p>• ${esc(x)}</p>`).join('')}</div>` : ''}</details>`}
        ${shown.map(m => moveRow(m, d, g.n)).join('')}</div></details>`;
    }).join('');
    if (filtering && !groups) return '';
    const key = 'b:' + b.n, open = filtering || S.open.has(key);
    return `<details class="blk" data-key="${key}" id="block-${b.n}"${open ? ' open' : ''}><summary><div class="bn">Block ${b.n}</div><div class="bt"><span>${esc(b.name)}</span><small>${bg} of ${bm.length} got</small></div><div class="bar thin ok"><i style-w="${pct(bg, bm.length)}"></i></div></summary>${groups}</details>`;
  }).join('');
  const fl = [['all', 'All'], ['learning', 'Learning'], ['got', 'Got it'], ['not', 'Not started']];
  const act = document.activeElement && document.activeElement.id === 'mq';
  main.innerHTML = `<div class="prog" id="curSummary"><div class="big">${got} of ${c.moves.length} basics got</div><div class="msub">${learning} learning · ${c.moves.length - got - learning} not started · ${c.groups.length} groups in ${c.blocks.length} blocks</div><div class="bar ok"><i style-w="${pct(got, c.moves.length)}"></i></div></div>
    <input id="mq" class="search" type="search" placeholder="Search moves" value="${esc(S.mq)}" autocomplete="off">
    <div class="mfilter">${fl.map(([k, l]) => `<button class="fchip${f === k ? ' on' : ''}" data-mf="${k}">${l}</button>`).join('')}</div>
    <div id="curriculum">${blocks || '<div class="empty">No moves match.</div>'}</div>`;
  applyBars();
  if (act) { const i = $('#mq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

// ---------- 90 days ----------
function renderJourney() {
  const d = cur(), c = C(), n = d.sessions.length;
  const total = c.checklist.reduce((a, s) => a + s.items.length, 0), done = c.checklist.reduce((a, s) => a + s.items.filter(i => d.checklist[i.id]).length, 0);
  main.innerHTML = `<div class="prog"><div class="big">${done} of ${total} ticked</div><div class="msub">Your first 90 days. You decide what counts: “got it” means it works in drilling.</div><div class="bar ok"><i style-w="${pct(done, total)}"></i></div></div>
    ${classCount(d, true)}
    <div id="journey">${c.checklist.map(sec => `<section class="jsec" id="sec-${esc(sec.id)}"><h3>${esc(sec.title)} <small>${esc(sec.days)} · ${sec.items.filter(i => d.checklist[i.id]).length}/${sec.items.length}</small></h3>
      ${sec.items.map(i => { const on = d.checklist[i.id]; return `<button class="jitem${on ? ' on' : ''}" data-act="tick" data-cid="${esc(i.id)}" aria-pressed="${!!on}"><span class="box">${on ? '✓' : ''}</span><span class="jt">${esc(i.text)}${i.classes ? `<small>${n} logged in this app${n >= TARGET[0] ? ' · target reached' : ''}</small>` : ''}${on ? `<small>Ticked ${esc(fmtDay(on, false))}</small>` : ''}</span></button>`; }).join('')}
      ${sec.checkin ? `<div class="checkin">Check-in: ${esc(sec.checkin)}</div>` : ''}</section>`).join('')}</div>`;
  applyBars();
}

// ---------- setup / settings ----------
function tokenSteps(withLink) {
  return `<ol class="steps">
    <li>Open ${withLink ? `<a href="${TOKEN_URL}" target="_blank" rel="noopener noreferrer">GitHub’s new fine-grained token page</a>` : 'the GitHub page (button above)'} and sign in as <b>braydendueck</b>. The name, a 90-day expiry and the Contents permission are filled in for you.</li>
    <li><b>Repository access:</b> choose <b>Only select repositories</b> and pick <b>bjj-tracker-data</b> only.</li>
    <li><b>Permissions:</b> check that <b>Contents</b> is <b>Read and write</b>. Add nothing else.</li>
    <li><b>Expiration:</b> keep an expiry (90 days is fine). When it runs out, this app asks for a new token.</li>
    <li>Tap <b>Generate token</b>, copy it (it starts with <code>github_pat_</code>) and paste it below.</li></ol>
    <details><summary>Option: one token for both apps</summary><p class="small muted">Instead of a new token, you can open your Order Tracker token in <a href="${TOKEN_LIST}" target="_blank" rel="noopener noreferrer">GitHub token settings</a>, add <b>bjj-tracker-data</b> under Repository access, and paste that same token here. A separate token per app is the default because each one can then only touch its own data.</p></details>
    <p class="small muted">The token stays only on this device. It can only read and change your BJJ data, nothing else on your GitHub.</p>`;
}
function renderSetup() {
  $('#nav').hidden = true;
  const other = localStorage.getItem(OTHER_TOKEN);
  main.innerHTML = `<div class="setup" id="setup"><div class="card"><h3>Connect your training log</h3>
    <p class="lead">Your sessions, move progress and checklist are kept in your private GitHub repo <b>${esc(S.repo)}</b>. Paste a GitHub access token once so this phone can read and update them.</p>
    <a class="linkbtn" href="${TOKEN_URL}" target="_blank" rel="noopener noreferrer">Create the token on GitHub ↗</a>
    ${tokenSteps(false)}
    <form id="tokform" autocomplete="off">
      <label class="field"><span>Paste the token here</span><input id="tok" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <details><summary>Advanced: data repository</summary><label class="field"><span>owner/repo</span><input id="repo" value="${esc(S.repo)}" autocapitalize="off" spellcheck="false"></label></details>
      <div id="tokerr" class="err" hidden></div>
      <button class="primary" id="tokgo" type="submit">Connect</button>
      ${other ? '<button class="secondary" type="button" id="useOther">Try my Order Tracker token</button><p class="small muted">Works only if you added bjj-tracker-data to that token.</p>' : ''}
      ${S.pending.length ? `<p class="small muted">${S.pending.length} unsaved change(s) on this phone will save after you connect.</p>` : ''}
    </form></div></div>`;
  const connect = async tok => {
    const repo = ($('#repo').value.trim() || DEFAULT_REPO).replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
    const err = $('#tokerr'), go = $('#tokgo'); err.hidden = true;
    if (!tok) { err.textContent = 'Paste the token first.'; err.hidden = false; return; }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { err.textContent = 'Repository should look like owner/name.'; err.hidden = false; return; }
    go.disabled = true; go.textContent = 'Checking…';
    try {
      const r = await fetchRemote(tok, repo);
      if (repo !== S.repo) S.pending = [];
      Object.assign(S, { token: tok, repo, base: r.data, sha: r.sha, cur: r.cur, curSha: r.curSha, syncedAt: Date.now(), loaded: true, problem: null, net: 'idle', view: 'main' });
      localStorage.setItem(LS.token, tok); localStorage.setItem(LS.repo, repo); persist();
      if (S.pending.length) await sync(); else render();
      toast('Connected');
    } catch (ex) {
      err.textContent = ex.kind === 'auth' ? 'GitHub rejected this token. Check you copied all of it and that it has not expired.' : ex.message;
      err.hidden = false; go.disabled = false; go.textContent = 'Connect';
    }
  };
  $('#tokform').addEventListener('submit', e => { e.preventDefault(); connect($('#tok').value.trim()); });
  if (other) $('#useOther').addEventListener('click', () => connect(other));
}
function renderSettings() {
  const d = cur();
  main.innerHTML = `<div class="card" id="settings"><h3>Four-week focus</h3>
      <label class="field"><span>Week 1 starts on</span><input type="date" id="focusStart" value="${esc(d.settings.focusStart)}"></label>
      ${(d.settings.focus || DEFAULT_FOCUS).map(w => `<div class="kv"><span class="muted">Week ${w.week}</span><span>${esc(w.title)}</span></div>`).join('')}
      <button class="secondary" data-act="savefocus">Save start date</button></div>
    <div class="card"><h3>Sync</h3>
      <div class="kv"><span class="muted">Data repo</span><span>${esc(S.repo)} (private)</span></div>
      <div class="kv"><span class="muted">Last synced</span><span>${esc(ago(S.syncedAt))}</span></div>
      <div class="kv"><span class="muted">Unsaved changes</span><span>${S.pending.length}</span></div>
      <button class="secondary" data-act="retry">Refresh now</button>
      <button class="secondary" data-act="back">Back</button></div>
    <div class="card"><h3>Token</h3><p class="small muted">Replace the token when it expires, or sign out to remove the token and the saved copy of your training data from this device.</p>
      <button class="secondary" data-act="newtoken">Enter a new token</button>
      <button class="dangerbtn" id="signout" data-act="signout">Sign out / forget token</button>
      <details><summary>How to create a token</summary>${tokenSteps(true)}</details></div>`;
}

// ---------- sheets ----------
const sheet = $('#sheet');
function openSheet(html, full) { sheet.innerHTML = `<div class="sheet${full ? ' full' : ''}" role="dialog" aria-modal="true">${html}</div>`; sheet.hidden = false; document.body.classList.add('locked'); }
function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; document.body.classList.remove('locked'); }
let F = null; // session form state
function sessionForm(id) {
  const d = cur(), s = id ? d.sessions.find(x => x.id === id) : null;
  if (id && !s) return;
  F = s ? clone(s) : { date: today(), kit: (sessionsSorted(d)[0] || {}).kit || 'gi', type: 'fundamentals', notes: '', goals: [] };
  F.id = id; drawForm();
}
function drawForm() {
  const prevScroll = sheet.querySelector('.sheet') ? sheet.querySelector('.sheet').scrollTop : 0;
  const d = cur(), fi = focusInfo(d), full = F.goals.length >= 2;
  const used = new Set(F.goals.map(goalKey));
  const pick = (g, cls = '') => `<button type="button" class="pick ${cls}" data-act="pick" data-move="${esc(g.moveId || '')}" data-text="${esc(g.text || '')}" ${full || used.has(goalKey(g)) ? 'disabled' : ''}>${esc(goalName(g))}</button>`;
  const picks = [];
  if (fi.week) { picks.push(pick({ text: fi.week.title }, 'focuspick')); fi.week.moves.forEach(m => moveById(m) && picks.push(pick({ moveId: m }, 'focuspick'))); }
  const learning = C().moves.filter(m => mstat(d, m.id) === 'learning' && !(fi.week && fi.week.moves.includes(m.id))).slice(0, 6);
  learning.forEach(m => picks.push(pick({ moveId: m.id })));
  const recent = goalStats(d).filter(g => !g.moveId).slice(0, 3).filter(g => !(fi.week && g.key === 't:' + fi.week.title.toLowerCase()));
  recent.forEach(g => picks.push(pick({ text: g.name })));
  const opts = C().blocks.map(b => `<optgroup label="Block ${b.n}: ${esc(b.name)}">${C().moves.filter(m => m.block === b.n).map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  openSheet(`<form id="sform" novalidate><div class="shead"><h3>${F.id ? 'Edit session' : 'Log a class'}</h3><button type="button" class="iconbtn" data-act="close" aria-label="Close">✕</button></div>
    <label class="field"><span>Date</span><input type="date" name="date" id="fdate" value="${esc(F.date)}" required></label>
    <span class="lbl">Gi or no-gi</span><div class="seg2 c2" id="fkit">${Object.entries(KIT).map(([k, l]) => `<button type="button" data-act="fkit" data-v="${k}" class="${F.kit === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <span class="lbl">Class type</span><div class="seg2 c3" id="ftype">${TYPES.map(([k, l]) => `<button type="button" data-act="ftype" data-v="${k}" class="${F.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <span class="lbl">Game plan for rolling: pick 1 or 2 goals (optional)</span>
    <div class="picked" id="picked">${F.goals.map((g, i) => `<div class="pk"><span>🎯 ${esc(goalName(g))}</span><button type="button" data-act="unpick" data-i="${i}" aria-label="Remove goal">✕</button></div>${F.id ? `<div class="res" data-i="${i}">${RES.map(([k, l]) => `<button type="button" class="${k}${g.result === k ? ' on' : ''}" data-act="frate" data-i="${i}" data-r="${k}">${esc(l)}</button>`).join('')}</div>` : ''}`).join('') || '<div class="small muted">No goals yet.</div>'}</div>
    ${full ? '<div class="small muted">Two goals picked. Remove one to change it.</div>' : `<div class="picks" id="quickpicks">${picks.join('')}</div>
    <div class="addgoal"><input id="gtext" placeholder="Or type your own goal" maxlength="80" enterkeyhint="done"><button type="button" data-act="addtext">Add</button></div>
    <div class="selwrap"><select id="gmove" aria-label="Pick a move from the curriculum"><option value="">Pick any curriculum move…</option>${opts}</select></div>`}
    <label class="field"><span>Quick notes</span><textarea name="notes" id="fnotes" rows="3" placeholder="What clicked, what to ask the coach…">${esc(F.notes)}</textarea></label>
    <div id="formerr" class="err" hidden></div>
    <button class="primary" type="submit">${F.id ? 'Save changes' : 'Save session'}</button>
    <button class="secondary" type="button" data-act="close">Cancel</button>
    ${F.id ? '<button class="dangerbtn" type="button" data-act="delsession">Delete session</button>' : ''}</form>`, true);
  const gm = $('#gmove'); if (gm) gm.addEventListener('change', () => { if (gm.value) addGoal({ moveId: gm.value }); });
  const gt = $('#gtext'); if (gt) gt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addGoal({ text: gt.value.trim() }); } });
  $('#fdate').addEventListener('change', e => { F.date = e.target.value; });
  $('#fnotes').addEventListener('input', e => { F.notes = e.target.value; });
  $('#sform').addEventListener('submit', e => { e.preventDefault(); saveForm(); });
  sheet.querySelector('.sheet').scrollTop = prevScroll;
}
function addGoal(g) {
  if (!g.moveId && !g.text) return;
  if (F.goals.length >= 2) return toast('Pick at most 2 goals');
  if (F.goals.some(x => goalKey(x) === goalKey(g))) return toast('Already picked');
  F.goals.push({ id: uid('g'), moveId: g.moveId || '', text: g.moveId ? '' : g.text, result: '' }); drawForm();
}
function saveForm() {
  const err = $('#formerr');
  if (!parseDay(F.date)) { err.textContent = 'Pick a date.'; err.hidden = false; return; }
  const fields = { date: F.date, kit: F.kit, type: F.type, notes: F.notes.trim(), goals: F.goals };
  if (F.id) {
    const old = cur().sessions.find(x => x.id === F.id), diff = {};
    for (const k of Object.keys(fields)) if (JSON.stringify(old[k]) !== JSON.stringify(fields[k])) diff[k] = fields[k];
    closeSheet(); if (Object.keys(diff).length) change({ op: 'session', id: F.id, fields: diff }, 'Saved');
  } else {
    closeSheet(); S.tab = 'log';
    change({ op: 'session', id: uid('s'), fields, create: true }, fields.goals.length ? 'Logged. Rate your goals after rolling.' : 'Class logged');
  }
}
function focusSheet() {
  const d = cur();
  openSheet(`<div class="shead"><h3>Four-week focus</h3><button class="iconbtn" data-act="close" aria-label="Close">✕</button></div>
    <label class="field"><span>Week 1 starts on</span><input type="date" id="fsStart" value="${esc(d.settings.focusStart)}"></label>
    ${(d.settings.focus || DEFAULT_FOCUS).map(w => `<div class="kv"><span class="muted">Week ${w.week} · ${esc(fmtDay(addDays(d.settings.focusStart || today(), (w.week - 1) * 7), false))}</span><span>${esc(w.title)}</span></div>`).join('')}
    <button class="primary" data-act="savefocus2">Save</button><button class="secondary" data-act="close">Cancel</button>`);
}
function setFocusStart(v) {
  if (!parseDay(v)) return toast('Pick a date');
  if (v !== cur().settings.focusStart) change({ op: 'settings', fields: { focusStart: v } }, 'Focus start updated');
}

// ---------- events ----------
document.addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.key; if (k) { if (e.target.open) S.open.add(k); else S.open.delete(k); } }, true);
document.addEventListener('click', e => {
  const tab = e.target.closest('#nav [data-tab]');
  if (tab) { S.tab = tab.dataset.tab; S.view = 'main'; render(); window.scrollTo(0, 0); return; }
  const mf = e.target.closest('[data-mf]'); if (mf) { S.mf = mf.dataset.mf; return render(); }
  const t = e.target.closest('[data-act]'); if (!t) { if (e.target === sheet) closeSheet(); return; }
  const act = t.dataset.act, sid = (t.closest('[data-sid]') || { dataset: {} }).dataset.sid;
  switch (act) {
    case 'newsession': return sessionForm(null);
    case 'editsession': return sessionForm(sid);
    case 'rate': { const gid = t.closest('[data-gid]').dataset.gid, s = cur().sessions.find(x => x.id === sid), g = s.goals.find(x => x.id === gid);
      return change({ op: 'goal', id: sid, gid, result: g.result === t.dataset.r ? '' : t.dataset.r }); }
    case 'mstatus': { const mid = t.closest('[data-mid]').dataset.mid; if (mstat(cur(), mid) !== t.dataset.s) change({ op: 'move', id: mid, status: t.dataset.s }); return; }
    case 'tick': { const id = t.dataset.cid, on = cur().checklist[id]; return change({ op: 'check', id, on: on ? null : today() }); }
    case 'fkit': F.kit = t.dataset.v; return drawForm();
    case 'ftype': F.type = t.dataset.v; return drawForm();
    case 'pick': return addGoal({ moveId: t.dataset.move, text: t.dataset.text });
    case 'unpick': F.goals.splice(+t.dataset.i, 1); return drawForm();
    case 'addtext': return addGoal({ text: ($('#gtext').value || '').trim() });
    case 'frate': { const g = F.goals[+t.dataset.i]; g.result = g.result === t.dataset.r ? '' : t.dataset.r; return drawForm(); }
    case 'delsession': if (confirm('Delete this session?')) { const id = F.id; closeSheet(); change({ op: 'session.delete', id }, 'Deleted'); } return;
    case 'close': return closeSheet();
    case 'focusedit': return focusSheet();
    case 'savefocus2': { const v = $('#fsStart').value; closeSheet(); return setFocusStart(v); }
    case 'savefocus': return setFocusStart($('#focusStart').value);
    case 'retry': return refresh();
    case 'back': S.view = 'main'; return render();
    case 'newtoken': S.view = 'setup'; return render();
    case 'signout': {
      const n = S.pending.length;
      if (!confirm(n ? `${n} change(s) have not been saved to GitHub yet and will be lost. Sign out anyway?` : 'Forget the token and the saved copy of your training data on this device?')) return;
      for (const k of Object.values(LS)) localStorage.removeItem(k);
      Object.assign(S, { token: '', repo: DEFAULT_REPO, base: null, sha: null, cur: null, curSha: null, syncedAt: null, loaded: false, pending: [], view: 'main', problem: null, net: 'idle' });
      render(); toast('Signed out. Token removed from this device.');
    }
  }
});
$('#btnRefresh').addEventListener('click', () => refresh());
$('#btnSettings').addEventListener('click', () => { S.view = S.view === 'settings' ? 'main' : 'settings'; render(); window.scrollTo(0, 0); });
main.addEventListener('input', e => { if (e.target.id === 'mq') { S.mq = e.target.value; renderMoves(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
window.addEventListener('online', () => refresh());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token && Date.now() - (S.syncedAt || 0) > 60e3) refresh(); });

// ---------- boot ----------
restore();
render();
if (S.token) refresh();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__BJJ = { applyOps, goalStats, focusInfo, state: S, cur };
})();
