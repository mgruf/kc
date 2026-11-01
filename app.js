/* KC – kommandocentralen. Snabb sida: visar senast kända läge direkt, hämtar färskt i bakgrunden. */
(() => {
'use strict';

// ---------- lagring (bara den här webbläsaren) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('kc_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kc_' + k, JSON.stringify(v)); } catch {} },
};

const S = {
  data: store.get('data', null),
  mode: store.get('mode', 'jobb'),
  other: store.get('other', 'ton'),      // 'ton' = nedtonat, 'dolj' = dolt helt
  tab: store.get('tab', 'idag'),
  closed: store.get('closed', {}),
  filter: store.get('filter', null),
  project: null,
  editing: false,
  done: {},                               // optimistiskt avbockade uppgifter
  extraEvents: [], loadedTo: null, loadingMore: false,
  weather: store.get('weather', null),
};

const cfg = () => ({ url: store.get('url', ''), key: store.get('key', '') });
const DAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- datum ----------
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayStr = () => ymd(new Date());
const week = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const evDay = e => e.allDay ? e.start : ymd(new Date(e.start));
const tagDate = t => { const m = /^#(\d{2})(\d{2})(\d{2})$/.exec(t); return m ? `20${m[1]}-${m[2]}-${m[3]}` : null; };
const isDateTag = t => !!tagDate(t);
const shortDate = s => { const d = parseYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

// ---------- taggfärger (enda färgen utöver rött) ----------
const TAG_COLORS = ['#3B6EA8', '#7A5AA6', '#2F8A6B', '#B0702A', '#A2466E', '#4E7F2E', '#2C7F94', '#8A6A3B'];
const tagColor = t => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TAG_COLORS[h % TAG_COLORS.length]; };
let HIDE_TAG = null;   // projektets egen tagg visas inte inne i projektet
const tagHtml = tags => (tags || []).filter(t => !isDateTag(t) && t !== '#PRIVAT' && t !== HIDE_TAG).map(t => `<span class="tag" style="--tc:${tagColor(t)}">${esc(t.slice(1))}</span>`).join('');
const cleanTitle = s => String(s || '').replace(/\s*#[0-9A-Za-zÅÄÖåäö_-]+/g, '').trim() || s;

// ---------- läge ----------
const modeCls = m => (m && m !== S.mode) ? (S.other === 'dolj' ? null : 'dim') : '';
const visible = x => modeCls(x.mode) !== null;

// ---------- API ----------
async function api(action, params = {}, post = false) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error('ej kopplad');
  let res;
  if (post) {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, key, ...params }) });
  } else {
    const q = new URLSearchParams({ action, key, ...params });
    res = await fetch(`${url}?${q}`);
  }
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'fel');
  return j;
}

async function refresh() {
  setSync('…');
  try {
    const d = await api('data', { days: 15 });
    S.data = d; S.done = {}; S.extraEvents = []; S.loadedTo = null;
    store.set('data', d);
    render();
    weather();
    setSync(hhmm(d.generated));
  } catch (e) {
    setSync(e.message === 'ej kopplad' ? '' : 'offline');
    if (e.message === 'ej kopplad') openSetup();
    if (e.message === 'nyckel') { toast('Fel nyckel'); openSetup(); }
  }
}

async function weather() {
  const loc = S.data?.weather;              // plats kommer från Apps Script, inte från koden
  if (!loc) return;
  if (S.weather && Date.now() - S.weather.t < 30 * 60e3) return;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FStockholm&forecast_days=1`;
    const j = await (await fetch(u)).json();
    S.weather = { t: Date.now(), place: loc.name, temp: j.current.temperature_2m, code: j.current.weather_code, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0] };
    store.set('weather', S.weather);
    if (S.tab === 'idag') renderIdag();
  } catch {}
}
const WX = c => c === 0 ? 'Klart' : c <= 2 ? 'Lätt molnigt' : c === 3 ? 'Mulet' : c <= 48 ? 'Dimma' : c <= 57 ? 'Duggregn' : c <= 67 ? 'Regn' : c <= 77 ? 'Snö' : c <= 82 ? 'Regnskurar' : c <= 86 ? 'Snöbyar' : 'Åska';

// ---------- urval ----------
const tasks = () => (S.data?.tasks || []).filter(visible);
const events = () => [...(S.data?.events || []), ...S.extraEvents].filter(visible);
const notes = () => (S.data?.notes || []).filter(visible);
const isFire = t => t.due && t.due < todayStr() && !S.done[t.id];
const WAIT_DAYS = 7;
const waitedDays = t => Math.floor((Date.now() - new Date(t.updated)) / 864e5);
const isWaitingLong = t => t.waiting && !t.due && !S.done[t.id] && waitedDays(t) >= WAIT_DAYS;

// Allt som brinner: förfallna uppgifter, svar man väntat för länge på, röda planvarningar, restade scener utan datum.
// Döljs det andra läget helt tystnar även dess bränder.
function fireItems() {
  const ok = m => !(m && m !== S.mode && S.other === 'dolj');
  const out = [];
  tasks().filter(isFire).filter(t => ok(t.mode)).sort((a, b) => a.due.localeCompare(b.due)).forEach(t => out.push({ html: taskRow(t), ctx: `Förfallen uppgift: ${t.title} (${t.due})` }));
  tasks().filter(isWaitingLong).filter(t => ok(t.mode)).forEach(t => out.push({ html: taskRow(t), ctx: `Väntat ${waitedDays(t)} dagar på svar: ${t.title}` }));
  cfgProjects().filter(p => ok(p.mode)).forEach(p => {
    (p.warnings || []).filter(w => /röd/i.test(w.level)).forEach(w => out.push({ html: warnRow(w, p), ctx: `${p.name}: ${w.text}` }));
    if (p.shoot?.restadUtanDatum) out.push({ html: warnRow({ name: `${p.shoot.restadUtanDatum} restade scener utan nytt datum`, text: 'Scenarket' , url: p.sceneSheetUrl }, p), ctx: `${p.name}: ${p.shoot.restadUtanDatum} restade scener utan nytt datum` });
  });
  return out;
}
function warnRow(w, p) {
  return `<div class="item fire ${modeCls(p.mode)}"><div class="noteglyph firetext">!</div><div class="main">
    <div class="title">${esc(w.name)}<span class="tags">${tagHtml([p.tag])}</span></div>
    <div class="sub"><span class="due">${esc(w.text || '')}</span></div>
    ${w.url ? `<div class="more"><div class="links"><a href="${esc(w.url)}" target="_blank" rel="noopener">Öppna</a></div></div>` : ''}</div></div>`;
}

// ---------- rader ----------
function taskRow(t) {
  const cls = ['item', modeCls(t.mode), S.done[t.id] ? 'done' : '', isFire(t) ? 'fire' : ''].join(' ');
  const due = t.due ? `<span class="due">${t.due === todayStr() ? 'idag' : shortDate(t.due)}</span> · ` : isWaitingLong(t) ? `<span class="due">väntat ${waitedDays(t)} dagar</span> · ` : '';
  return `<div class="${cls} ${isWaitingLong(t) ? 'fire' : ''}" data-task="${esc(t.id)}" data-list="${esc(t.listId)}">
    <button class="check" aria-label="Bocka av"></button>
    <div class="main">
      <div class="title">${esc(cleanTitle(t.title))}<span class="tags">${tagHtml(t.tags)}</span></div>
      <div class="sub">${due}${esc(t.list)}</div>
      <div class="more">${t.notes ? esc(t.notes) : ''}<div class="links">
        <a href="${claudeUrl('Uppgift: ' + t.title + (t.notes ? '\n' + t.notes : ''))}" target="_blank" rel="noopener">Fråga Claude</a>
        ${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">Öppna i Tasks</a>` : ''}
      </div></div>
    </div></div>`;
}

function eventRow(e, showDay) {
  const now = new Date();
  const past = !e.allDay && new Date(e.end) < now;
  const cur = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
  const time = e.allDay ? 'Heldag' : hhmm(e.start);
  return `<div class="item ${modeCls(e.mode)} ${past ? 'past' : ''}">
    <div class="time ${cur ? 'now' : ''}">${time}</div>
    <div class="main">
      <div class="title">${esc(e.title)}<span class="tags">${tagHtml(e.tags)}</span></div>
      <div class="sub">${!e.allDay ? hhmm(e.start) + '–' + hhmm(e.end) + ' · ' : ''}${esc(e.cal)}${e.location ? ' · ' + esc(e.location) : ''}</div>
      <div class="more"><div class="links"><a href="${claudeUrl('Kalenderhändelse: ' + e.title + ' ' + (e.allDay ? e.start : new Date(e.start).toLocaleString('sv-SE')) + (e.location ? ', ' + e.location : ''))}" target="_blank" rel="noopener">Fråga Claude</a></div></div>
    </div></div>`;
}

function noteRow(n) {
  const open = `shortcuts://run-shortcut?name=${encodeURIComponent('KC anteckning')}&input=text&text=${encodeURIComponent(n.folder + '|' + n.title)}`;
  return `<div class="item ${modeCls(n.mode)}">
    <div class="noteglyph">≡</div>
    <div class="main">
      <div class="title">${esc(n.title)}<span class="tags">${tagHtml(n.tags)}</span></div>
      <div class="sub">${esc(n.folder)}</div>
      <div class="more">${esc(n.excerpt)}<div class="links">
        <a href="${open}">Öppna i Notes</a>
        <a href="${claudeUrl('Anteckning "' + n.title + '" (' + n.folder + '):\n' + n.excerpt)}" target="_blank" rel="noopener">Fråga Claude</a>
      </div></div>
    </div></div>`;
}

function section(id, title, n, body, extra = '') {
  const closed = S.closed[id] ? 'closed' : '';
  return `<div class="sec ${closed} ${extra}" data-sec="${id}"><h2>${title}${n != null ? ` <span class="n">${n}</span>` : ''}</h2><div class="body">${body}</div></div>`;
}

const claudeUrl = ctx => 'https://claude.ai/new?q=' + encodeURIComponent(`Från KC (${new Date().toLocaleDateString('sv-SE')}):\n${ctx}\n\n`);

// ---------- Fästa genvägar ----------
function pinsHtml() {
  const pins = S.data?.pins || [];
  return `<div class="pins">${pins.map((p, i) => `<a class="pin" href="${esc(p.url)}" target="_blank" rel="noopener" data-pin="${i}">${esc(p.name)}</a>`).join('')}<button class="pin add" data-addpin title="Fäst en genväg">+</button></div>`;
}

// ---------- IDAG ----------
function renderIdag() {
  const el = $('#idag');
  const now = new Date(), t = todayStr();
  const q = window.KC_QUOTES || [];
  const qi = q.length ? q[Math.floor((parseYmd(t) - new Date(2026, 0, 1)) / 864e5) % q.length] : null;
  const w = S.weather;
  const bdays = (S.data?.birthdays || []).filter(b => b.date === t);

  let html = `<div class="hero">
    <div class="day">${DAYS[now.getDay()][0].toUpperCase() + DAYS[now.getDay()].slice(1)}</div>
    <div class="date">${now.getDate()} ${MONTHS[now.getMonth()]} · v. ${week(now)}</div>
    <div class="meta">${w ? `<span><span class="num">${Math.round(w.temp)}°</span> ${WX(w.code)}, ${Math.round(w.min)}°/${Math.round(w.max)}°${w.place ? ' i ' + esc(w.place) : ''}</span>` : ''}</div>
    ${bdays.length ? `<div class="bday">Fyller år: ${bdays.map(b => esc(b.title)).join(', ')}</div>` : ''}
    ${qi ? `<blockquote class="quote"><p>${esc(qi[0])}</p><cite>${esc(qi[1])}</cite></blockquote>` : ''}
  </div>
  ${pinsHtml()}`;

  if (!S.data) { el.innerHTML = html + `<p class="empty">Ingen data än.</p>`; return; }

  const fire = fireItems();
  const todayTasks = tasks().filter(x => x.due === t);
  const undated = tasks().filter(x => !x.due);
  const evs = events().filter(e => evDay(e) === t || (e.allDay && e.start <= t && e.end > t));
  const dnotes = notes().filter(n => (n.tags || []).some(g => tagDate(g) === t));

  let left = '';
  if (fire.length) left += section('fire', 'Det som brinner', fire.length, fire.map(f => f.html).join(''), 'fire');
  left += section('tasks', 'Att göra idag', todayTasks.length, todayTasks.length ? todayTasks.map(taskRow).join('') : '<p class="empty">Inget med datum idag.</p>');
  if (undated.length) left += section('undated', 'Utan datum', undated.length, undated.map(taskRow).join(''));

  let right = section('cal', 'Kalender', evs.length, evs.length ? evs.map(e => eventRow(e)).join('') : '<p class="empty">Inget i kalendern.</p>');
  // Dagens inspelning hör ihop med kalendern. Ingen inspelning idag → nästa dag som en rad.
  const shoots = cfgProjects().filter(visible).filter(p => p.shoot && (p.shoot.today || p.shoot.next));
  if (shoots.length) right += section('shoot', 'Inspelning', null, shoots.map(p => {
    const s = p.shoot, d = s.today || s.next;
    const head = s.today ? `Dag ${d.day} av ${s.totalDays}` : `Nästa: ${DAYS[parseYmd(d.date).getDay()]} ${shortDate(d.date)} · dag ${d.day} av ${s.totalDays}`;
    return `<div class="shoothead">${esc(p.name)} · ${esc(head)}${p.callsheet ? ` · <a href="${esc(p.callsheet.url)}" target="_blank" rel="noopener">Callsheet</a>` : ''}</div>` + shootRow(d, p, !!s.today);
  }).join(''));
  if (dnotes.length) right += section('dnotes', 'Anteckningar för idag', dnotes.length, dnotes.map(noteRow).join(''));

  el.innerHTML = html + `<div>${left}</div><div>${right}</div>`;
  if (S.closed.undated === undefined) { S.closed.undated = true; store.set('closed', S.closed); el.querySelector('[data-sec="undated"]')?.classList.add('closed'); }
}

// ---------- PROJEKT ----------
const cfgProjects = () => S.data?.projects || [];
const cfgProject = tag => cfgProjects().find(p => p.tag === tag);

function projects() {
  const map = {};
  const ensure = tag => (map[tag] ||= { tag, tasks: [], notes: [], events: [], modes: {}, cfg: cfgProject(tag) || null });
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
  const list = Object.values(map);
  list.forEach(p => {
    p.mode = p.cfg?.mode || ((p.modes.privat || 0) > (p.modes.jobb || 0) ? 'privat' : 'jobb');
    p.name = p.cfg?.name || p.tag.slice(1);
    p.fire = projectFire(p);
  });
  const weight = p => (p.cfg ? 1000 : 0) + p.tasks.length * 3 + p.notes.length + p.events.length;
  return list.sort((a, b) => weight(b) - weight(a));
}

function projectFire(p) {
  const out = [];
  p.tasks.filter(isFire).forEach(t => out.push(t));
  p.tasks.filter(isWaitingLong).forEach(t => out.push(t));
  const c = p.cfg;
  (c?.warnings || []).filter(w => /röd/i.test(w.level)).forEach(w => out.push(w));
  if (c?.shoot?.restadUtanDatum) out.push({ restad: c.shoot.restadUtanDatum });
  return out;
}

// Widgets: varje widget vet sin titel och hur den ritas för ett projekt.
const W = {
  summary:  { title: 'Sammanfattning', size: 'l' },
  shoot:    { title: 'Inspelningsläge', size: 'm', when: p => p.cfg?.shoot },
  upcoming: { title: 'Närmast', size: 'm' },
  tasks:    { title: 'Uppgifter', size: 'm' },
  waiting:  { title: 'Väntar på svar', size: 'm' },
  timeline: { title: 'Tidslinje', size: 'l', when: p => p.cfg?.phases?.length || p.cfg?.shootDays?.length },
  files:    { title: 'Filer', size: 'm' },
  scripts:  { title: 'Manusversioner', size: 's', when: p => p.cfg?.scripts?.length },
  notes:    { title: 'Anteckningar', size: 'm' },
  budget:   { title: 'Budget', size: 'm', when: p => p.cfg?.budget },
  team:     { title: 'Team', size: 's', when: p => p.cfg?.crew },
};
const DEFAULT_JOBB = ['summary', 'shoot', 'upcoming', 'tasks', 'waiting', 'timeline', 'budget', 'files', 'scripts', 'team', 'notes'];
const DEFAULT_PRIVAT = ['summary', 'upcoming', 'tasks', 'notes', 'files'];

function layoutFor(p) {
  const saved = (S.data?.layouts || {})[p.tag]; if (saved?.length) return saved;
  return (p.mode === 'privat' ? DEFAULT_PRIVAT : DEFAULT_JOBB)
    .filter(id => !W[id].when || W[id].when(p))
    .map(id => ({ id, size: W[id].size }));
}

function renderProjekt() {
  const el = $('#projekt');
  const all = projects();
  if (S.project) {
    const p = all.find(x => x.tag === S.project);
    if (p) return renderProject(el, p);
    S.project = null;
  }
  const ps = all.filter(visible);
  if (!ps.length) { el.innerHTML = `<p class="empty" style="padding-top:24px">Inga projekt än. Ett projekt uppstår när en uppgift, anteckning eller händelse får en tagg som #JF4.</p>`; return; }
  const main = ps.filter(p => p.cfg || p.tasks.length), rest = ps.filter(p => !p.cfg && !p.tasks.length);
  const t = todayStr();
  const card = p => {
    const open = p.tasks.filter(x => !S.done[x.id]).length;
    const sum = (S.data?.summaries?.[p.tag] || '').split('\n')[0];
    const sh = p.cfg?.shoot;
    const phase = sum || (sh?.today ? `Inspelning · dag ${sh.today.day} av ${sh.totalDays}` : sh && sh.next ? `Inspelning · nästa ${shortDate(sh.next.date)}` : p.cfg?.phase || '');
    return `<button class="card ${modeCls(p.mode)}" data-project="${esc(p.tag)}">
      ${p.fire.length ? '<span class="dot"></span>' : ''}
      <h3>${esc(p.name)}</h3>
      <div class="phase">${esc(phase)}</div>
      <div class="stats"><span><b>${open}</b>uppgifter</span><span><b>${p.notes.length}</b>anteckningar</span></div>
    </button>`;
  };
  el.innerHTML = `<div class="cards">${main.map(card).join('')}</div>` +
    (rest.length ? section('restproj', 'Övriga taggar', rest.length, `<div class="cards small">${rest.map(card).join('')}</div>`) : '');
  if (S.closed.restproj === undefined) { S.closed.restproj = true; store.set('closed', S.closed); el.querySelector('[data-sec="restproj"]')?.classList.add('closed'); }
}

function renderProject(el, p) {
  HIDE_TAG = p.tag;
  try { renderProjectInner(el, p); } finally { HIDE_TAG = null; }
}
function renderProjectInner(el, p) {
  const layout = layoutFor(p);
  const used = new Set(layout.map(w => w.id));
  const free = Object.keys(W).filter(id => !used.has(id));
  el.innerHTML = `<div class="phead">
      <button class="back" data-back>‹ Projekt</button>
      <h2>${esc(p.name)}</h2>
      <button class="editbtn" data-edit>${S.editing ? 'Klar' : 'Redigera'}</button>
    </div>
    <div class="grid ${S.editing ? 'editing' : ''}" data-grid="${esc(p.tag)}">
      ${layout.map((w, i) => `<div class="w size-${w.size}" data-w="${i}" draggable="${S.editing}">
        <div class="wtools"><button data-wmove="-1" aria-label="Flytta bakåt">‹</button><button data-wsize aria-label="Storlek">${w.size.toUpperCase()}</button><button data-wmove="1" aria-label="Flytta framåt">›</button><button data-wremove aria-label="Ta bort">×</button></div>
        <h4>${esc(W[w.id]?.title || w.id)}</h4>${renderWidget(w.id, p)}</div>`).join('')}
      ${S.editing && free.length ? `<div class="w size-s addw"><h4>Lägg till</h4>${free.map(id => `<button class="chip" data-wadd="${id}">${esc(W[id].title)}</button>`).join(' ')}</div>` : ''}
    </div>`;
}

function renderWidget(id, p) {
  const t = todayStr(), c = p.cfg || {};
  const empty = s => `<p class="empty">${s}</p>`;
  switch (id) {
    case 'summary':
      return `<textarea data-summary="${esc(p.tag)}" placeholder="Skriv en kort sammanfattning – första raden blir fasen på kortet.">${esc(S.data?.summaries?.[p.tag] || '')}</textarea>`;
    case 'upcoming': {
      const items = [
        ...p.events.filter(e => evDay(e) >= t).map(e => ({ d: evDay(e), html: eventRow(e) })),
        ...p.notes.flatMap(n => (n.tags || []).map(tagDate).filter(d => d && d >= t).map(d => ({ d, html: noteRow(n) }))),
        ...(c.deadlines || []).filter(x => x.date >= t).map(x => ({ d: x.date, html: planRow(x, p) })),
        ...(c.phases || []).filter(x => x.milestone && x.start >= t).map(x => ({ d: x.start, html: planRow({ date: x.start, name: x.name, text: 'Milstolpe' }, p) })),
        ...(c.shootDays || []).filter(x => x.date >= t).slice(0, 3).map(x => ({ d: x.date, html: shootRow(x, p) })),
      ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 8);
      return items.length ? items.map(u => u.html).join('') : empty('Inget inplanerat.');
    }
    case 'tasks': {
      const ts = p.tasks.filter(x => !x.waiting).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
      return ts.length ? ts.map(taskRow).join('') : empty('Inga öppna uppgifter.');
    }
    case 'waiting': {
      const ts = p.tasks.filter(x => x.waiting);
      return ts.length ? ts.map(taskRow).join('') : empty('Du väntar inte på något här.');
    }
    case 'notes':
      return p.notes.length ? p.notes.slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified))).slice(0, 12).map(noteRow).join('') : empty('Inga anteckningar med taggen.');
    case 'files': {
      const links = [
        c.driveUrl && ['Projektmapp', c.driveUrl],
        c.callsheet && ['Senaste callsheet', c.callsheet.url, c.callsheet.name],
        c.sceneSheetUrl && ['Scenarket', c.sceneSheetUrl],
        c.planSheetUrl && ['Produktionsplan', c.planSheetUrl],
        ...((S.data?.links || {})[p.tag] || []).map(l => [l.name, l.url]),
      ].filter(Boolean);
      return `<div class="files">${links.map(([n, u, sub]) => `<a class="file" href="${esc(u)}" target="_blank" rel="noopener"><span>${esc(n)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</a>`).join('') || empty('Inga filer kopplade.')}
        <button class="addlink" data-addlink="${esc(p.tag)}">+ Länk</button></div>`;
    }
    case 'shoot': {
      const s = c.shoot; if (!s) return empty('Ingen inspelning kopplad.');
      const pct = s.totalDays ? Math.round(s.doneDays / s.totalDays * 100) : 0;
      const nd = s.today || s.next;
      return `<div class="big"><span class="num">${s.doneDays}</span><span class="of">/ ${s.totalDays} dagar</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="kv"><span>Scener filmade</span><b>${s.filmed} / ${s.scenes}</b></div>
        <div class="kv"><span>Bekräftade i DPR</span><b>${s.confirmed}</b></div>
        ${s.restad ? `<div class="kv ${s.restadUtanDatum ? 'firetext' : ''}"><span>Restade${s.restadUtanDatum ? ` · ${s.restadUtanDatum} utan datum` : ''}</span><b>${s.restad}</b></div>` : ''}
        ${nd ? `<div class="kv"><span>${s.today ? 'Idag' : 'Nästa'} · dag ${nd.day}</span><b>${shortDate(nd.date)}</b></div>` : ''}
        ${s.lastDay ? `<div class="kv"><span>Sista dag</span><b>${shortDate(s.lastDay)}</b></div>` : ''}`;
    }
    case 'timeline': return timelineHtml(p);
    case 'scripts':
      return (c.scripts || []).map(s => { const m = /^(\d{6})_?(.*)$/.exec(s.version) || []; return `<div class="kv"><span>${esc(s.film)}</span><b>${esc(m[2] || s.version)}${m[1] ? ` · ${shortDate('20' + m[1].slice(0, 2) + '-' + m[1].slice(2, 4) + '-' + m[1].slice(4))}` : ''}</b></div>`; }).join('') || empty('Inga manusversioner hittade.');
    case 'budget': return budgetHtml(c.budget);
    case 'team':
      return c.crew ? `<div class="files"><a class="file" href="${esc(c.crew.url)}" target="_blank" rel="noopener"><span>Crewlista</span><small>${esc(c.crew.name)} · uppdaterad ${esc(shortDate(c.crew.updated))}</small></a></div>
        <p class="empty">Import till Google Kontakter med projektetikett kommer – du godkänner varje omgång.</p>` : empty('Ingen crewlista kopplad.');
  }
  return '';
}

const kr = n => (Math.round(n / 1000)).toLocaleString('sv-SE') + ' tkr';
const mkr = n => (n / 1e6).toLocaleString('sv-SE', { maximumFractionDigits: 1 }) + ' Mkr';
function budgetHtml(b) {
  if (!b) return '<p class="empty">Ingen budget inläst än. Macen läser senaste Budget_Working-PDF:en automatiskt.</p>';
  const prev = {}; (b.prev?.rows || []).forEach(([acc, amt]) => prev[acc] = amt);
  const changed = (b.rows || []).filter(([acc, , amt]) => prev[acc] !== undefined && prev[acc] !== amt)
    .map(([acc, name, amt]) => ({ acc, name, d: amt - prev[acc] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const dTot = b.prev ? b.total - b.prev.total : 0;
  return `<div class="big"><span class="num">${esc(mkr(b.total))}</span><span class="of">totalt</span></div>
    ${(b.groups || []).map(g => `<div class="kv"><span>${esc(g.name.toLowerCase().replace(/^./, c => c.toUpperCase()))}</span><b>${esc(mkr(g.amount))}</b></div>`).join('')}
    <div class="sub2">Version ${esc(shortDate(b.date))}${b.prev ? ` · jämfört med ${esc(shortDate(b.prev.date))}` : ''}</div>
    ${b.prev ? (changed.length ? `<div class="sub2">Omfördelat${dTot ? ` · totalen ${dTot > 0 ? '+' : ''}${esc(kr(dTot))}` : ''}</div>` + changed.slice(0, 6).map(r => `<div class="kv"><span>${esc(r.acc)} ${esc(r.name.toLowerCase())}</span><b>${r.d > 0 ? '+' : ''}${esc(kr(r.d))}</b></div>`).join('') : '<div class="sub2">Inga omfördelningar sedan förra versionen.</div>') : ''}`;
}

function planRow(x, p) {
  return `<div class="item ${modeCls(p?.mode)}"><div class="noteglyph">◆</div><div class="main">
    <div class="title">${esc(x.name)}${p ? `<span class="tags">${tagHtml([p.tag])}</span>` : ''}</div>
    <div class="sub">${esc(shortDate(x.date))}${x.text ? ' · ' + esc(x.text) : ''}${x.to ? ' · ' + esc(x.to) : ''}</div></div></div>`;
}

// "BLACK CYCLES PÅ SLOTTSBERGET" → "Black Cycles på Slottsberget"; korta förkortningar (MC, GSI) behålls.
const SMALL = new Set(['på', 'och', 'i', 'med', 'till', 'av', 'för', 'vid', 'ur', 'om', 'en', 'ett', 'the', 'of']);
const placeCase = s => s.split(/(\s+|·|\/|-)/).map(w => {
  if (!/[A-ZÅÄÖ]/.test(w) || w !== w.toUpperCase()) return w;
  const l = w.toLowerCase();
  if (SMALL.has(l)) return l;
  if (w.length <= 3 && !/\d/.test(w)) return w;
  return l.replace(/^([^a-zåäö]*)([a-zåäö])/, (m, a, b) => a + b.toUpperCase());
}).join('').replace(/^([^A-Za-zÅÄÖåäö]*)([a-zåäö])/, (m, a, b) => a + b.toUpperCase());

function shootRow(d, p, full) {
  const scenes = d.scenes || [];
  return `<div class="item ${modeCls(p?.mode)}"><div class="time">Dag ${d.day}</div><div class="main">
    <div class="title">${d.note ? esc(placeCase(d.note)) : 'Inspelning'}${p ? `<span class="tags">${tagHtml([p.tag])}</span>` : ''}</div>
    <div class="sub">${esc(d.hours)}${d.pages ? ' · ' + esc(d.pages) + ' sidor' : ''}${d.strips ? ' · ' + d.strips + ' scener' : ''}</div>
    ${d.info || scenes.length ? `<div class="more ${full ? 'shown' : ''}">${d.info ? `<div class="scene info">${esc(d.info)}</div>` : ''}${scenes.map(s => `<div class="scene"><b>${esc(s.scene)}</b> ${esc(s.ie)} ${esc(s.place)} · ${esc(s.tod)} · ${esc(s.pages)}${s.cast ? `<small>${esc(s.cast)}</small>` : ''}</div>`).join('')}</div>` : ''}
  </div></div>`;
}

function timelineHtml(p) {
  const c = p.cfg || {}, t = new Date(), weeks = 16;
  const from = addDays(t, -7), to = addDays(from, weeks * 7);
  const span = to - from, pos = s => Math.max(0, Math.min(100, (parseYmd(s) - from) / span * 100));
  const rows = [];
  const sd = c.shootDays || [];
  if (sd.length) rows.push({ name: 'Inspelning', start: sd[0].date, end: sd[sd.length - 1].date });
  (c.phases || []).filter(x => !x.background && !x.milestone && x.end >= ymd(from) && x.start <= ymd(to)).slice(0, 8).forEach(x => rows.push({ name: (x.film ? x.film + ' ' : '') + x.name, start: x.start, end: x.end }));
  const ms = (c.phases || []).filter(x => x.milestone && x.start >= ymd(from) && x.start <= ymd(to));
  const dl = (c.deadlines || []).filter(x => x.date >= ymd(from) && x.date <= ymd(to));
  if (!rows.length && !ms.length && !dl.length) return '<p class="empty">Inget de närmaste veckorna.</p>';
  const months = []; for (let d = new Date(from.getFullYear(), from.getMonth() + 1, 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  return `<div class="tl">
    <div class="tlhead">${months.map(m => `<span style="left:${pos(ymd(m))}%">${MONTHS[m.getMonth()].slice(0, 3)}</span>`).join('')}</div>
    ${rows.map(r => `<div class="tlrow"><span class="tlname">${esc(r.name)}</span><div class="tltrack"><i style="left:${pos(r.start)}%;width:${Math.max(1, pos(r.end) - pos(r.start))}%"></i></div></div>`).join('')}
    ${ms.length || dl.length ? `<div class="tlrow"><span class="tlname">Milstolpar</span><div class="tltrack">${[...ms.map(x => [x.start, x.name]), ...dl.map(x => [x.date, x.name])].map(([d, n]) => `<b class="ms" style="left:${pos(d)}%" title="${esc(n)} · ${esc(shortDate(d))}"></b>`).join('')}</div></div>` : ''}
    <div class="tlnow" style="--p:${pos(todayStr())}"></div>
  </div>
  ${c.planSheetUrl ? `<a class="more-link" href="${esc(c.planSheetUrl)}" target="_blank" rel="noopener">Öppna hela planen</a>` : ''}`;
}

// ---------- HORISONT ----------
function renderHorisont(keepScroll) {
  const el = $('#horisont');
  const from = addDays(new Date(), 1);
  const to = S.loadedTo ? parseYmd(S.loadedTo) : addDays(new Date(), 15);
  const f = S.filter;
  const match = x => !f || (x.tags || []).includes(f);
  const evs = events().filter(match), ts = tasks().filter(match), ns = notes().filter(match);
  const cps = cfgProjects().filter(visible).filter(p => !f || p.tag === f);
  const tagset = projects().filter(visible).filter(p => p.cfg || p.tasks.length).map(p => p.tag);

  let html = `<div class="filters"><button class="chip ${!f ? 'on' : ''}" data-filter="">Allt</button>${tagset.map(g => `<button class="chip ${f === g ? 'on' : ''}" data-filter="${esc(g)}">${esc(g.slice(1))}</button>`).join('')}</div>`;
  let emptyRun = [];
  const flushEmpty = () => { if (emptyRun.length) { html += `<div class="dayrow empty-day">${emptyRun.length === 1 ? emptyRun[0] : emptyRun[0] + ' – ' + emptyRun[emptyRun.length - 1]}</div>`; emptyRun = []; } };

  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    const s = ymd(d);
    if (d.getDay() === 1) { flushEmpty(); html += `<div class="weekmark">Vecka ${week(d)}</div>`; }
    const de = evs.filter(e => evDay(e) === s || (e.allDay && e.start < s && e.end > s));
    const dt = ts.filter(x => x.due === s);
    const dn = ns.filter(n => (n.tags || []).some(g => tagDate(g) === s));
    const dp = cps.flatMap(p => [
      ...(p.shootDays || []).filter(x => x.date === s).map(x => shootRow(x, p)),
      ...(p.deadlines || []).filter(x => x.date === s).map(x => planRow(x, p)),
      ...(p.phases || []).filter(x => x.milestone && x.start === s).map(x => planRow({ date: x.start, name: x.name, text: 'Milstolpe' }, p)),
    ]);
    const label = `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}/${d.getMonth() + 1}`;
    if (!de.length && !dt.length && !dn.length && !dp.length) { emptyRun.push(label); continue; }
    flushEmpty();
    html += `<div class="hday"><div class="dayh"><span class="d">${d.getDate()} ${MONTHS[d.getMonth()]}</span><span class="w2">${DAYS[d.getDay()]}</span></div>
      ${dp.join('')}${de.map(e => eventRow(e)).join('')}${dt.map(taskRow).join('')}${dn.map(noteRow).join('')}</div>`;
  }
  flushEmpty();
  html += `<div class="sentinel" id="sentinel"></div>`;
  const y = window.scrollY;
  el.innerHTML = html;
  if (keepScroll) window.scrollTo(0, y);
  observeSentinel();
}

let io;
function observeSentinel() {
  io?.disconnect();
  const s = $('#sentinel'); if (!s) return;
  io = new IntersectionObserver(es => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: '600px' });
  io.observe(s);
}
async function loadMore() {
  if (S.loadingMore || !S.data) return;
  S.loadingMore = true;
  const from = S.loadedTo ? parseYmd(S.loadedTo) : addDays(new Date(), 15);
  const to = addDays(from, 21);
  try {
    const r = await api('range', { from: ymd(from), to: ymd(to) });
    S.extraEvents.push(...r.events);
    S.data.birthdays = [...(S.data.birthdays || []), ...(r.birthdays || [])];
  } catch {}
  S.loadedTo = ymd(to);
  S.loadingMore = false;
  if (S.tab === 'horisont') renderHorisont(true);
}

// ---------- allt ----------
function render() {
  document.querySelectorAll('.mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  $('#otherToggle').textContent = S.other === 'dolj' ? 'Dolt' : 'Tonat';
  $('#otherToggle').title = `${S.mode === 'jobb' ? 'Privat' : 'Jobb'} visas ${S.other === 'dolj' ? 'inte alls' : 'nedtonat'}`;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === S.tab));
  const n = S.data ? fireItems().length : 0;
  const badge = $('#fireBadge'); badge.hidden = !n; badge.textContent = n;
  $('#claudeBtn').href = claudeUrl(contextForClaude());
  if (S.tab === 'idag') renderIdag();
  if (S.tab === 'projekt') renderProjekt();
  if (S.tab === 'horisont') renderHorisont();
}

function contextForClaude() {
  if (!S.data) return '';
  const t = todayStr();
  const lines = [];
  if (S.tab === 'projekt' && S.project) {
    const p = projects().find(x => x.tag === S.project);
    if (p) {
      lines.push(`Projekt ${p.name} (${p.tag}).`);
      if (p.cfg?.shoot) lines.push(`Inspelning: dag ${p.cfg.shoot.doneDays} av ${p.cfg.shoot.totalDays}, ${p.cfg.shoot.filmed}/${p.cfg.shoot.scenes} scener filmade.`);
      if (S.data.summaries?.[p.tag]) lines.push('Sammanfattning: ' + S.data.summaries[p.tag]);
      p.tasks.slice(0, 15).forEach(x => lines.push(`- Uppgift: ${x.title}${x.due ? ' (' + x.due + ')' : ''}`));
    }
  } else {
    lines.push(`Idag ${t}.`);
    fireItems().forEach(x => lines.push(`- Brinner: ${x.ctx}`));
    tasks().filter(x => x.due === t).forEach(x => lines.push(`- Att göra: ${x.title}`));
    events().filter(e => evDay(e) === t).forEach(e => lines.push(`- ${e.allDay ? 'Heldag' : hhmm(e.start)}: ${e.title}`));
  }
  return lines.join('\n');
}

// ---------- händelser ----------
document.addEventListener('click', async ev => {
  const tgt = ev.target;
  const b = tgt.closest('button, a, h2, .item');
  if (!b) return;

  if (b.matches('.mode button')) { S.mode = b.dataset.mode; store.set('mode', S.mode); return render(); }
  if (b.id === 'otherToggle') { S.other = S.other === 'dolj' ? 'ton' : 'dolj'; store.set('other', S.other); return render(); }
  if (b.matches('.tabs button')) { S.tab = b.dataset.tab; store.set('tab', S.tab); if (S.tab !== 'projekt') S.project = null; window.scrollTo(0, 0); return render(); }
  if (b.matches('.sec > h2')) { const s = b.parentElement, id = s.dataset.sec; S.closed[id] = !s.classList.contains('closed'); store.set('closed', S.closed); s.classList.toggle('closed'); return; }
  if (b.matches('[data-project]')) { S.project = b.dataset.project; S.editing = false; window.scrollTo(0, 0); return render(); }
  if (b.matches('[data-back]')) { if (S.editing) saveLayout(); S.project = null; S.editing = false; return render(); }
  if (b.matches('[data-filter]')) { S.filter = b.dataset.filter || null; store.set('filter', S.filter); return renderHorisont(); }
  if (b.id === 'addBtn') return openAdd();
  if (b.matches('[data-edit]')) { if (S.editing) saveLayout(); S.editing = !S.editing; return render(); }
  if (b.matches('[data-wmove], [data-wsize], [data-wremove], [data-wadd]')) return editWidget(b);
  if (b.matches('[data-addlink]')) return addLink(b.dataset.addlink);
  if (b.matches('[data-addpin]')) return addPin();
  if (b.matches('.check')) {
    const row = b.closest('[data-task]'); const id = row.dataset.task, list = row.dataset.list;
    const done = !S.done[id];
    S.done[id] = done; render();
    try { await api('complete', { listId: list, taskId: id, done }, true); }
    catch { delete S.done[id]; render(); toast('Kunde inte spara – försök igen'); }
    return;
  }
  if (b.matches('.item') && !tgt.closest('a') && !b.closest('.editing')) b.classList.toggle('open');
});

// ---------- redigera widgets ----------
function currentLayout() {
  const p = projects().find(x => x.tag === S.project);
  return { p, layout: layoutFor(p).map(w => ({ ...w })) };
}
function setLayoutLocal(tag, layout) { (S.data.layouts ||= {})[tag] = layout; store.set('data', S.data); }
function editWidget(b) {
  const { p, layout } = currentLayout();
  const i = Number(b.closest('[data-w]')?.dataset.w);
  if (b.dataset.wadd) layout.push({ id: b.dataset.wadd, size: W[b.dataset.wadd].size });
  else if (b.hasAttribute('data-wremove')) layout.splice(i, 1);
  else if (b.hasAttribute('data-wsize')) layout[i].size = { s: 'm', m: 'l', l: 's' }[layout[i].size] || 'm';
  else { const j = i + Number(b.dataset.wmove); if (j >= 0 && j < layout.length) [layout[i], layout[j]] = [layout[j], layout[i]]; }
  setLayoutLocal(p.tag, layout); render();
}
async function saveLayout() {
  const { p, layout } = currentLayout();
  try { await api('setLayout', { tag: p.tag, layout }, true); toast('Sparat'); } catch { toast('Kunde inte spara'); }
}
// Dra och släpp på datorn
let dragFrom = null;
document.addEventListener('dragstart', e => { const w = e.target.closest?.('.editing [data-w]'); if (w) dragFrom = Number(w.dataset.w); });
document.addEventListener('dragover', e => { if (dragFrom != null && e.target.closest?.('.editing [data-w]')) e.preventDefault(); });
document.addEventListener('drop', e => {
  const w = e.target.closest?.('.editing [data-w]'); if (!w || dragFrom == null) return;
  e.preventDefault();
  const { p, layout } = currentLayout(); const to = Number(w.dataset.w);
  const [m] = layout.splice(dragFrom, 1); layout.splice(to, 0, m); dragFrom = null;
  setLayoutLocal(p.tag, layout); render();
});

async function addLink(tag) {
  const url = prompt('Klistra in länken (Drive, ark, webbsida):'); if (!url) return;
  const name = prompt('Vad ska den heta?', ''); if (!name) return;
  const links = [...((S.data.links ||= {})[tag] || []), { name, url }];
  S.data.links[tag] = links; store.set('data', S.data); render();
  try { await api('setLinks', { tag, links }, true); } catch { toast('Kunde inte spara'); }
}
async function addPin() {
  const url = prompt('Klistra in länken du vill fästa:'); if (!url) return;
  const name = prompt('Kort namn:', ''); if (!name) return;
  const pins = [...(S.data.pins || []), { name, url }];
  S.data.pins = pins; store.set('data', S.data); render();
  try { await api('setPins', { pins }, true); } catch { toast('Kunde inte spara'); }
}
// Håll inne (eller högerklicka) på en fäst genväg för att ta bort den.
let pinT;
document.addEventListener('pointerdown', e => { const a = e.target.closest?.('[data-pin]'); if (a) pinT = setTimeout(() => removePin(Number(a.dataset.pin)), 650); });
document.addEventListener('pointerup', () => clearTimeout(pinT));
document.addEventListener('contextmenu', e => { const a = e.target.closest?.('[data-pin]'); if (a) { e.preventDefault(); removePin(Number(a.dataset.pin)); } });
async function removePin(i) {
  const p = (S.data.pins || [])[i]; if (!p || !confirm(`Ta bort "${p.name}"?`)) return;
  const pins = S.data.pins.filter((_, j) => j !== i); S.data.pins = pins; store.set('data', S.data); render();
  try { await api('setPins', { pins }, true); } catch { toast('Kunde inte spara'); }
}

// ---------- kortkommandon (dator) ----------
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, dialog')) return;
  const k = e.key.toLowerCase();
  const tab = { '1': 'idag', '2': 'projekt', '3': 'horisont' }[k];
  if (tab) { S.tab = tab; store.set('tab', tab); S.project = null; window.scrollTo(0, 0); return render(); }
  if (k === 'n') { e.preventDefault(); return openAdd(); }
  if (k === 'j' || k === 'p') { S.mode = k === 'j' ? 'jobb' : 'privat'; store.set('mode', S.mode); return render(); }
  if (k === 'd') { S.other = S.other === 'dolj' ? 'ton' : 'dolj'; store.set('other', S.other); return render(); }
  if (k === 'r') return refresh();
  if (k === 'c') return window.open($('#claudeBtn').href, '_blank');
});

// Sammanfattning sparas när man lämnar fältet.
document.addEventListener('focusout', async ev => {
  const ta = ev.target.closest?.('[data-summary]'); if (!ta) return;
  const tag = ta.dataset.summary, text = ta.value;
  if ((S.data.summaries?.[tag] || '') === text) return;
  (S.data.summaries ||= {})[tag] = text; store.set('data', S.data);
  try { await api('setSummary', { tag, text }, true); toast('Sparat'); } catch { toast('Kunde inte spara'); }
});

// ---------- snabbinmatning ----------
let kind = 'task';
function openAdd() {
  const d = $('#addDlg');
  $('#addForm').reset();
  setKind(S.tab === 'horisont' ? 'event' : 'task');
  const cals = S.data?.writableCalendars || [];
  $('#addCal').innerHTML = cals.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  const pref = cals.find(c => c.mode === S.mode); if (pref) $('#addCal').value = pref.id;
  d.showModal(); setTimeout(() => $('#addTitle').focus(), 50);
}
function setKind(k) {
  kind = k;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.kind === k));
  $('#addText').hidden = k !== 'note';
  $('#addWhen').hidden = k === 'note';
  $('#addTime').hidden = k !== 'event';
  $('#addCal').hidden = k !== 'event';
  $('#addTitle').placeholder = k === 'note' ? 'Titel' : 'Vad?';
  const cals = S.data?.writableCalendars || [];
  $('#addHint').textContent =
    k === 'task' ? 'Hamnar i Tasks-inkorgen. Datum är valfritt.' :
    k === 'note' ? 'Läggs i Notes-inkorgen när Macen synkar nästa gång. Taggar som #JF4 eller #261105 fungerar.' :
    (S.mode === 'privat' && !cals.some(c => c.mode === 'privat') ? 'Privata kalendern går inte att skriva till än – händelsen hamnar i jobbkalendern.' : 'Utan tid blir det en heldag.');
  if (k === 'event' && !$('#addDate').value) $('#addDate').value = todayStr();
}
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
$('#addCancel').addEventListener('click', () => $('#addDlg').close());
$('#addForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const title = $('#addTitle').value.trim(); if (!title) return;
  $('#addDlg').close();
  try {
    if (kind === 'task') await api('addTask', { title, due: $('#addDate').value || '' }, true);
    if (kind === 'event') await api('addEvent', { title, date: $('#addDate').value || todayStr(), time: $('#addTime').value || '', calendarId: $('#addCal').value }, true);
    if (kind === 'note') await api('addNote', { title, text: $('#addText').value }, true);
    toast('Sparat'); refresh();
  } catch { toast('Kunde inte spara'); }
});

// ---------- koppling ----------
function openSetup() {
  const d = $('#setupDlg'); if (d.open) return;
  $('#setupUrl').value = cfg().url; $('#setupKey').value = cfg().key;
  d.showModal();
}
$('#setupForm').addEventListener('submit', ev => {
  ev.preventDefault();
  store.set('url', $('#setupUrl').value.trim()); store.set('key', $('#setupKey').value.trim());
  $('#setupDlg').close(); refresh();
});
// Lång tryckning på synktiden öppnar kopplingen igen.
let pressT; const sync = $('#sync');
sync.addEventListener('pointerdown', () => pressT = setTimeout(openSetup, 700));
sync.addEventListener('pointerup', () => clearTimeout(pressT));

// ---------- småhjälp ----------
function setSync(s) { $('#sync').textContent = s; }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

// ---------- start ----------
render();
weather();
refresh();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); weather(); } });
setInterval(() => { if (!document.hidden) refresh(); }, 5 * 60e3);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
