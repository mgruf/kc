/* KC – kärnan: tillstånd, datakällor, API, hjälpfunktioner, router.
   Repot innehåller bara själva sidan. Allt innehåll kommer från Apps Script-källorna. */

// ---------- lagring (bara den här webbläsaren) ----------
export const store = {
  get(k, d) { try { const v = localStorage.getItem('kc_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kc_' + k, JSON.stringify(v)); } catch {} },
};

// ---------- källor: jobb och ev. privat (eget konto) ----------
export function sources() {
  let s = store.get('sources', null);
  if (!s) {
    const url = store.get('url', ''), key = store.get('key', '');
    s = url ? [{ id: 'jobb', label: 'Jobb', url, key }] : [];
  }
  return s;
}
export function setSources(list) { store.set('sources', list); }

// ---------- tillstånd ----------
export const S = {
  raw: store.get('raw', {}),        // data per källa
  data: null,                        // sammanslaget
  mode: store.get('mode', 'jobb'),
  other: store.get('other', 'ton'),  // 'ton' = nedtonat, 'dolj' = dolt helt
  closed: store.get('closed', {}),
  done: {},                          // optimistiskt avbockade uppgifter
  extraEvents: [],                   // händelser utanför standardfönstret (kalender/horisont)
  loaded: {},                        // laddade intervall
  contacts: store.get('contacts', null),
  prod: {},                          // produktion per projekttagg
  noteText: {},                      // hela texten per anteckning
  weather: store.get('weather', null),
  route: { view: 'idag', args: [] },
};

// ---------- API ----------
export async function api(action, params = {}, post = false, src = 'jobb') {
  const s = sources().find(x => x.id === src) || sources()[0];
  if (!s || !s.url || !s.key) throw new Error('ej kopplad');
  let res;
  if (post) {
    res = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, key: s.key, ...params }) });
  } else {
    const q = new URLSearchParams({ action, key: s.key, ...params });
    res = await fetch(`${s.url}?${q}`);
  }
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'fel');
  return j;
}

// Slår ihop källorna. Varje sak får _src så att ändringar går till rätt konto.
export function merge() {
  const list = sources();
  const out = { tasks: [], doneTasks: [], calendars: [], events: [], notes: [], birthdays: [], projects: [], taskLists: [], writableCalendars: [], collections: [], summaries: {}, layouts: {}, links: {}, pins: [], weather: null, generated: null };
  list.forEach((s, i) => {
    const d = S.raw[s.id]; if (!d) return;
    const tag = x => Object.assign(x, { _src: s.id });
    ['tasks', 'doneTasks', 'calendars', 'events', 'notes', 'birthdays', 'projects', 'taskLists', 'writableCalendars'].forEach(k => (d[k] || []).forEach(x => out[k].push(tag(x))));
    (d.collections || []).forEach(c => out.collections.push({ ...c, _src: s.id, rows: (c.rows || []).map(tag) }));
    Object.assign(out.summaries, d.summaries || {}); Object.assign(out.layouts, d.layouts || {}); Object.assign(out.links, d.links || {});
    if (i === 0) { out.pins = d.pins || []; out.weather = d.weather; out.generated = d.generated; out.dbUrl = d.dbUrl; }
  });
  out.events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  S.data = Object.keys(S.raw).length ? out : null;
  return S.data;
}

let refreshing = null;
export async function refresh() {
  if (refreshing) return refreshing;
  setSync('…');
  refreshing = (async () => {
    const list = sources();
    if (!list.length) { emit('setup'); setSync(''); return; }
    const results = await Promise.allSettled(list.map(s => api('data', { days: 15 }, false, s.id).then(d => (S.raw[s.id] = d))));
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length === results.length) {
      const msg = failed[0].reason?.message;
      setSync(msg === 'ej kopplad' ? '' : 'offline');
      if (msg === 'ej kopplad' || msg === 'nyckel') emit('setup', msg);
      return;
    }
    S.done = {}; S.extraEvents = []; S.loaded = {};
    store.set('raw', S.raw);
    merge();
    emit('render');
    setSync(hhmm(S.data.generated) + (failed.length ? ' · en källa saknas' : ''));
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Händelser i ett intervall (för kalender och horisont). Hämtas en gång per intervall. */
export async function ensureRange(from, to) {
  const key = from + '|' + to;
  if (S.loaded[key]) return;
  S.loaded[key] = true;
  const have = new Set([...(S.data?.events || []), ...S.extraEvents].map(e => e._src + e.id + e.start));
  await Promise.all(sources().map(async s => {
    try {
      const r = await api('range', { from, to }, false, s.id);
      r.events.forEach(e => { e._src = s.id; if (!have.has(e._src + e.id + e.start)) { S.extraEvents.push(e); have.add(e._src + e.id + e.start); } });
      (r.birthdays || []).forEach(b => { if (!S.data.birthdays.some(x => x.date === b.date && x.title === b.title)) S.data.birthdays.push(b); });
    } catch { delete S.loaded[key]; }
  }));
  emit('render');
}

export async function loadContacts(force) {
  if (S.contacts && !force && Date.now() - (S.contacts.t || 0) < 30 * 60e3) return S.contacts;
  try {
    const r = await api('contacts');
    S.contacts = { t: Date.now(), list: r.contacts, labels: r.labels };
    store.set('contacts', S.contacts);
    emit('render');
  } catch (e) { if (!S.contacts) S.contacts = { t: 0, list: [], labels: [], error: e.message }; }
  return S.contacts;
}

export async function loadProduction(tag, force) {
  if (S.prod[tag] && !force) return S.prod[tag];
  const p = (S.data?.projects || []).find(x => x.tag === tag);
  try {
    const r = await api('production', { tag }, false, p?._src || 'jobb');
    S.prod[tag] = r.production;
  } catch (e) { S.prod[tag] = { error: e.message }; }
  emit('render');
  return S.prod[tag];
}

export async function loadNoteText(n) {
  if (S.noteText[n.id]) return S.noteText[n.id];
  try {
    const r = await api('note', { id: n.id }, false, n._src || 'jobb');
    S.noteText[n.id] = r.note.excerpt || '';
  } catch (e) { S.noteText[n.id] = null; }
  emit('render');
  return S.noteText[n.id];
}

// ---------- händelser mellan moduler ----------
const bus = {};
export const on = (ev, fn) => (bus[ev] ||= []).push(fn);
export const emit = (ev, ...a) => (bus[ev] || []).forEach(fn => fn(...a));

// ---------- router (#/vy/arg/arg) ----------
export function go(path) { if (location.hash !== '#/' + path) location.hash = '#/' + path; else emit('route'); }
export function parseRoute() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  S.route = { view: parts[0] || 'idag', args: parts.slice(1) };
  return S.route;
}

// ---------- DOM ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
export function setSync(s) { const el = $('#sync'); if (el) el.textContent = s; }

// ---------- datum ----------
export const DAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
export const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYmd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const todayStr = () => ymd(new Date());
export const week = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
export const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const evDay = e => e.allDay ? e.start : ymd(new Date(e.start));
export const evOnDay = (e, s) => e.allDay ? (e.start <= s && e.end > s) : ymd(new Date(e.start)) === s;
export const tagDate = t => { const m = /^#(\d{2})(\d{2})(\d{2})$/.exec(t); return m ? `20${m[1]}-${m[2]}-${m[3]}` : null; };
export const isDateTag = t => !!tagDate(t);
export const shortDate = s => { if (!s) return ''; const d = parseYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
export const dayLabel = s => { const t = todayStr(); if (s === t) return 'idag'; if (s === ymd(addDays(new Date(), 1))) return 'imorgon'; if (s === ymd(addDays(new Date(), -1))) return 'igår'; const d = parseYmd(s); const diff = (d - parseYmd(t)) / 864e5; return diff > 0 && diff < 7 ? DAYS[d.getDay()] : shortDate(s); };
export const relTime = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60e3); if (m < 60) return m + ' min sedan'; const h = Math.round(m / 60); if (h < 24) return h + ' tim sedan'; const d = Math.round(h / 24); return d < 30 ? d + ' d sedan' : shortDate(ymd(new Date(iso))); };

// ---------- taggar (enda färgen utöver rött) ----------
export const TAG_RE = /#[0-9A-Za-zÅÄÖåäö_-]+/g;
const TAG_COLORS = ['#3B6EA8', '#7A5AA6', '#2F8A6B', '#B0702A', '#A2466E', '#4E7F2E', '#2C7F94', '#8A6A3B'];
export const tagColor = t => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TAG_COLORS[h % TAG_COLORS.length]; };
export const ctx = { hideTag: null };   // projektets egen tagg visas inte inne i projektet
// Taggar är spans (inte länkar) så att de kan ligga inuti klickbara rader; main.js navigerar vid klick.
export const tagHtml = tags => (tags || []).filter(t => !isDateTag(t) && t !== '#PRIVAT' && t !== ctx.hideTag).map(t => `<span class="tag" data-tag="${esc(t)}" style="--tc:${tagColor(t)}">${esc(t.slice(1))}</span>`).join('');
export const cleanTitle = s => String(s || '').replace(/\s*#[0-9A-Za-zÅÄÖåäö_-]+/g, '').trim() || s;

// ---------- läge jobb/privat ----------
export const modeCls = m => (m && m !== S.mode) ? (S.other === 'dolj' ? null : 'dim') : '';
export const visible = x => modeCls(x.mode) !== null;

// ---------- urval ----------
export const tasks = () => (S.data?.tasks || []).filter(visible);
export const events = () => [...(S.data?.events || []), ...S.extraEvents].filter(visible);
export const notes = () => (S.data?.notes || []).filter(visible);
export const isFire = t => t.due && t.due < todayStr() && !S.done[t.id];
export const WAIT_DAYS = 7;
export const waitedDays = t => Math.floor((Date.now() - new Date(t.updated)) / 864e5);
export const isWaitingLong = t => t.waiting && !t.due && !S.done[t.id] && waitedDays(t) >= WAIT_DAYS;
export const cfgProjects = () => S.data?.projects || [];
export const cfgProject = tag => cfgProjects().find(p => p.tag === tag);

// ---------- kontakt och mail (samma format som MailPro) ----------
export function personIn(text) {
  const t = String(text || '').trim();
  const m = /^(.*?)<\s*([^>\s]+@[^>\s]+)\s*>/.exec(t);
  if (m) { const n = m[1].trim().replace(/^["']|["']$/g, ''); return { name: n || m[2], email: m[2] }; }
  const tok = t.split(/\s+/).find(x => x.includes('@'));
  if (!tok) return null;
  const e = tok.replace(/[<>,;"']/g, '');
  return { name: e, email: e };
}
export function contactOf(t) {
  const lines = String(t.notes || '').split('\n').map(l => l.trim());
  for (const k of ['Kontakt:', 'Från:']) {
    const l = lines.find(x => x.startsWith(k));
    const p = l && personIn(l.slice(k.length));
    if (p) return p;
  }
  return null;
}
export const contactLine = p => p.name && p.name.toLowerCase() !== p.email.toLowerCase() ? `Kontakt: ${p.name} <${p.email}>` : `Kontakt: <${p.email}>`;
export function threadOf(t) {
  const s = (t.notes || '') + ' ' + (t.mail || '');
  let m = /mailpro:\/\/thread\/([A-Za-z0-9]+)/.exec(s); if (m) return m[1];
  m = /mail\.google\.com\/mail\/[^\s#]*#[^\s\/]+\/([A-Fa-f0-9]{10,})/.exec(s);
  return m ? m[1] : null;
}
export const mailHref = t => { const id = threadOf(t); return id ? 'mailpro://thread/' + id : (t.mail || null); };
export const firstName = n => String(n || '').split(/[\s@]+/)[0];
export const initials = n => String(n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('');
/** Alla personer KC känner till: Google Kontakter + kontaktrader i uppgifter. Nyckel = e-post (gemener). */
export function people() {
  const m = new Map();
  (S.contacts?.list || []).forEach(c => {
    const email = (c.emails[0] || '').toLowerCase();
    m.set(email || c.id, { ...c, email, key: email || c.id, source: 'kontakter' });
  });
  (S.data?.tasks || []).forEach(t => {
    const p = contactOf(t); if (!p) return;
    const k = p.email.toLowerCase();
    if (!m.has(k)) {
      const c = (S.contacts?.list || []).find(x => x.emails.some(e => e.toLowerCase() === k));
      m.set(k, c ? { ...c, email: k, key: k, source: 'kontakter' } : { id: null, name: p.name, email: k, emails: [p.email], phones: [], labels: [], key: k, source: 'uppgift' });
    }
  });
  return [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'sv'));
}
export const personByKey = k => people().find(p => p.key === String(k).toLowerCase());
export const tasksFor = email => (S.data?.tasks || []).filter(t => contactOf(t)?.email.toLowerCase() === String(email).toLowerCase());

export const gcalLink = e => { try { return 'https://calendar.google.com/calendar/event?eid=' + btoa(unescape(encodeURIComponent(String(e.id).replace(/@google\.com$/, '') + ' ' + e.calId))).replace(/=+$/, ''); } catch { return 'https://calendar.google.com/'; } };
export const notesUrl = n => `shortcuts://run-shortcut?name=${encodeURIComponent('KC anteckning')}&input=text&text=${encodeURIComponent(n.folder + '|' + n.title)}`;
export const claudeUrl = c => 'https://claude.ai/new?q=' + encodeURIComponent(`Från KC (${new Date().toLocaleDateString('sv-SE')}):\n${c}\n\n`);

// ---------- projekt (tagg → allt som hör dit) ----------
export function projects() {
  const map = {};
  const ensure = tag => (map[tag] ||= { tag, tasks: [], notes: [], events: [], rows: [], modes: {}, cfg: cfgProject(tag) || null });
  const add = (tag, kind, x) => {
    if (isDateTag(tag) || tag === '#PRIVAT') return;
    const p = ensure(tag);
    p[kind].push(x);
    p.modes[x.mode] = (p.modes[x.mode] || 0) + 1;
  };
  cfgProjects().forEach(c => ensure(c.tag));
  (S.data?.tasks || []).forEach(x => (x.tags || []).forEach(g => add(g, 'tasks', x)));
  (S.data?.notes || []).forEach(x => (x.tags || []).forEach(g => add(g, 'notes', x)));
  [...(S.data?.events || []), ...S.extraEvents].forEach(x => (x.tags || []).forEach(g => add(g, 'events', x)));
  (S.data?.collections || []).filter(c => c.name !== 'Projekt').forEach(c => c.fields.filter(f => f.type === 'projekt').forEach(f => c.rows.forEach(r => {
    String(r[f.name] || '').split(/[\s,]+/).filter(Boolean).forEach(t => { const tag = t.startsWith('#') ? t.toUpperCase() : '#' + t.toUpperCase(); const p = ensure(tag); p.rows.push({ coll: c.name, row: r }); });
  })));
  const list = Object.values(map);
  list.forEach(p => {
    p.mode = p.cfg?.mode || ((p.modes.privat || 0) > (p.modes.jobb || 0) ? 'privat' : 'jobb');
    p.name = p.cfg?.name || p.tag.slice(1);
    p.fire = [...p.tasks.filter(isFire), ...p.tasks.filter(isWaitingLong), ...(p.cfg?.warnings || []).filter(w => /röd/i.test(w.level))];
    if (p.cfg?.shoot?.restadUtanDatum) p.fire.push({ restad: p.cfg.shoot.restadUtanDatum });
  });
  const weight = p => (p.cfg ? 1000 : 0) + p.tasks.length * 3 + p.notes.length + p.events.length;
  return list.sort((a, b) => weight(b) - weight(a));
}
export const knownTags = () => projects().filter(p => p.cfg || p.tasks.length).map(p => p.tag);

// ---------- anteckningar som sidor ----------
const norm = s => String(s || '').trim().toLowerCase();
export const noteByTitle = t => (S.data?.notes || []).find(n => norm(n.title) === norm(t));
export const backlinks = n => (S.data?.notes || []).filter(x => x !== n && (x.links || []).some(l => norm(l) === norm(n.title)));
/** Text med [[länkar]], #taggar, adresser och webblänkar som klickbara. */
export function richText(text) {
  let h = esc(text);
  h = h.replace(/\[\[([^\]|#]+?)(?:\|([^\]]+))?\]\]/g, (m, t, label) => {
    const n = noteByTitle(t);
    return n ? `<a class="wl" href="#/anteckning/${encodeURIComponent(n.id)}">${label || t}</a>` : `<span class="wl missing" title="Finns ingen anteckning med den titeln">${label || t}</span>`;
  });
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/(^|\s)(#[0-9A-Za-zÅÄÖåäö_-]{2,})/g, (m, sp, t) => sp + (isDateTag(t) ? `<a class="tag date" href="#/kalender/dag/${tagDate(t)}">${t}</a>` : `<a class="tag" href="#/projekt/${encodeURIComponent(t.toUpperCase())}" style="--tc:${tagColor(t.toUpperCase())}">${t.slice(1)}</a>`));
  return h;
}

// ---------- väder ----------
export const WX = c => c === 0 ? 'Klart' : c <= 2 ? 'Lätt molnigt' : c === 3 ? 'Mulet' : c <= 48 ? 'Dimma' : c <= 57 ? 'Duggregn' : c <= 67 ? 'Regn' : c <= 77 ? 'Snö' : c <= 82 ? 'Regnskurar' : c <= 86 ? 'Snöbyar' : 'Åska';
export async function weather() {
  const loc = S.data?.weather;
  if (!loc) return;
  if (S.weather && Date.now() - S.weather.t < 30 * 60e3) return;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FStockholm&forecast_days=7`;
    const j = await (await fetch(u)).json();
    S.weather = { t: Date.now(), place: loc.name, temp: j.current.temperature_2m, code: j.current.weather_code, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0],
      days: j.daily.time.map((d, i) => ({ date: d, max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], code: j.daily.weather_code[i] })) };
    store.set('weather', S.weather);
    emit('render');
  } catch {}
}

// ---------- det som brinner ----------
/** Allt som brinner: förfallna uppgifter, svar man väntat för länge på, röda planvarningar, restade scener utan datum.
    Döljs det andra läget helt tystnar även dess bränder. */
export function fireList() {
  const ok = m => !(m && m !== S.mode && S.other === 'dolj');
  const out = [];
  tasks().filter(isFire).filter(t => ok(t.mode)).sort((a, b) => a.due.localeCompare(b.due)).forEach(t => out.push({ kind: 'task', t, ctx: `Förfallen uppgift: ${t.title} (${t.due})` }));
  tasks().filter(isWaitingLong).filter(t => ok(t.mode)).forEach(t => out.push({ kind: 'task', t, ctx: `Väntat ${waitedDays(t)} dagar på svar: ${t.title}` }));
  cfgProjects().filter(p => ok(p.mode)).forEach(p => {
    (p.warnings || []).filter(w => /röd/i.test(w.level)).forEach(w => out.push({ kind: 'warn', w, p, ctx: `${p.name}: ${w.text}` }));
    if (p.shoot?.restadUtanDatum) out.push({ kind: 'warn', w: { name: `${p.shoot.restadUtanDatum} restade scener utan nytt datum`, text: 'Scenarket', url: '#/projekt/' + encodeURIComponent(p.tag) + '/produktion/scener' }, p, ctx: `${p.name}: ${p.shoot.restadUtanDatum} restade scener utan nytt datum` });
  });
  FIRE_EXTRA.forEach(f => { try { out.push(...(f() || [])); } catch {} });
  return out;
}
export const FIRE_EXTRA = [];   // andra moduler (mejl, delegering, avtal …) lägger till egna bränder här
export const fireCount = () => fireList().length;
