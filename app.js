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
const tagHtml = tags => (tags || []).filter(t => !isDateTag(t) && t !== '#PRIVAT').map(t => `<span class="tag" style="--tc:${tagColor(t)}">${esc(t.slice(1))}</span>`).join('');
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

function fireItems() {
  // Döljs det andra läget helt tystnar även dess bränder.
  return tasks().filter(isFire).filter(t => !(t.mode !== S.mode && S.other === 'dolj'));
}

// ---------- rader ----------
function taskRow(t) {
  const cls = ['item', modeCls(t.mode), S.done[t.id] ? 'done' : '', isFire(t) ? 'fire' : ''].join(' ');
  const due = t.due ? `<span class="due">${t.due === todayStr() ? 'idag' : shortDate(t.due)}</span> · ` : '';
  return `<div class="${cls}" data-task="${esc(t.id)}" data-list="${esc(t.listId)}">
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
  </div>`;

  if (!S.data) { el.innerHTML = html + `<p class="empty">Ingen data än.</p>`; return; }

  const fire = fireItems().sort((a, b) => a.due.localeCompare(b.due));
  const todayTasks = tasks().filter(x => x.due === t);
  const undated = tasks().filter(x => !x.due);
  const evs = events().filter(e => evDay(e) === t || (e.allDay && e.start <= t && e.end > t));
  const dnotes = notes().filter(n => (n.tags || []).some(g => tagDate(g) === t));

  let left = '';
  if (fire.length) left += section('fire', 'Det som brinner', fire.length, fire.map(taskRow).join(''), 'fire');
  left += section('tasks', 'Att göra idag', todayTasks.length, todayTasks.length ? todayTasks.map(taskRow).join('') : '<p class="empty">Inget med datum idag.</p>');
  if (undated.length) left += section('undated', 'Utan datum', undated.length, undated.map(taskRow).join(''));

  let right = section('cal', 'Kalender', evs.length, evs.length ? evs.map(e => eventRow(e)).join('') : '<p class="empty">Inget i kalendern.</p>');
  if (dnotes.length) right += section('dnotes', 'Anteckningar för idag', dnotes.length, dnotes.map(noteRow).join(''));

  el.innerHTML = html + `<div>${left}</div><div>${right}</div>`;
  if (S.closed.undated === undefined) { S.closed.undated = true; store.set('closed', S.closed); el.querySelector('[data-sec="undated"]')?.classList.add('closed'); }
}

// ---------- PROJEKT ----------
function projects() {
  const map = {};
  const add = (tag, kind, x) => {
    if (isDateTag(tag) || tag === '#PRIVAT') return;
    (map[tag] ||= { tag, tasks: [], notes: [], events: [], mode: null, modes: {} });
    map[tag][kind].push(x);
    map[tag].modes[x.mode] = (map[tag].modes[x.mode] || 0) + 1;
  };
  (S.data?.tasks || []).forEach(x => (x.tags || []).forEach(g => add(g, 'tasks', x)));
  (S.data?.notes || []).forEach(x => (x.tags || []).forEach(g => add(g, 'notes', x)));
  [...(S.data?.events || []), ...S.extraEvents].forEach(x => (x.tags || []).forEach(g => add(g, 'events', x)));
  const list = Object.values(map);
  list.forEach(p => p.mode = (p.modes.privat || 0) > (p.modes.jobb || 0) ? 'privat' : 'jobb');
  return list.sort((a, b) => (b.tasks.length + b.notes.length + b.events.length) - (a.tasks.length + a.notes.length + a.events.length));
}

function renderProjekt() {
  const el = $('#projekt');
  const ps = projects().filter(visible);
  if (S.project) {
    const p = ps.find(x => x.tag === S.project) || projects().find(x => x.tag === S.project);
    if (p) return renderProject(el, p);
    S.project = null;
  }
  if (!ps.length) { el.innerHTML = `<p class="empty" style="padding-top:24px">Inga projekt än. Ett projekt uppstår när en uppgift, anteckning eller händelse får en tagg som #JF4.</p>`; return; }
  const t = todayStr();
  el.innerHTML = `<div class="cards">${ps.map(p => {
    const fire = p.tasks.some(isFire);
    const open = p.tasks.filter(x => !S.done[x.id]).length;
    const next = p.events.filter(e => evDay(e) >= t).sort((a, b) => String(a.start).localeCompare(String(b.start)))[0];
    const phase = (S.data?.summaries?.[p.tag] || '').split('\n')[0];
    return `<button class="card ${modeCls(p.mode)}" data-project="${esc(p.tag)}">
      ${fire ? '<span class="dot"></span>' : ''}
      <h3>${esc(p.tag.slice(1))}</h3>
      <div class="phase">${esc(phase || (next ? 'Nästa: ' + next.title + ' · ' + shortDate(evDay(next)) : ''))}</div>
      <div class="stats"><span><b>${open}</b>uppgifter</span><span><b>${p.notes.length}</b>anteckningar</span></div>
    </button>`;
  }).join('')}</div>`;
}

function renderProject(el, p) {
  const t = todayStr();
  const summary = S.data?.summaries?.[p.tag] || '';
  const upcoming = [
    ...p.events.filter(e => evDay(e) >= t).map(e => ({ d: evDay(e), html: eventRow(e) })),
    ...p.notes.flatMap(n => (n.tags || []).map(tagDate).filter(d => d && d >= t).map(d => ({ d, html: noteRow(n) }))),
  ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 8);
  const ts = p.tasks.slice().sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  el.innerHTML = `<div class="phead"><button class="back" data-back>‹ Projekt</button><h2>${esc(p.tag.slice(1))}</h2></div>
  <div class="grid">
    <div class="w wide"><h4>Sammanfattning</h4><textarea data-summary="${esc(p.tag)}" placeholder="Skriv en kort sammanfattning – första raden blir fasen på kortet.">${esc(summary)}</textarea></div>
    <div class="w"><h4>Närmast</h4>${upcoming.length ? upcoming.map(u => u.html).join('') : '<p class="empty">Inget inplanerat.</p>'}</div>
    <div class="w"><h4>Uppgifter</h4>${ts.length ? ts.map(taskRow).join('') : '<p class="empty">Inga öppna uppgifter.</p>'}</div>
    <div class="w"><h4>Anteckningar</h4>${p.notes.length ? p.notes.slice(0, 12).map(noteRow).join('') : '<p class="empty">Inga anteckningar med taggen.</p>'}</div>
  </div>`;
}

// ---------- HORISONT ----------
function renderHorisont(keepScroll) {
  const el = $('#horisont');
  const from = addDays(new Date(), 1);
  const to = S.loadedTo ? parseYmd(S.loadedTo) : addDays(new Date(), 15);
  const f = S.filter;
  const match = x => !f || (x.tags || []).includes(f);
  const evs = events().filter(match), ts = tasks().filter(match), ns = notes().filter(match);
  const tagset = projects().filter(visible).map(p => p.tag);

  let html = `<div class="filters"><button class="chip ${!f ? 'on' : ''}" data-filter="">Allt</button>${tagset.map(g => `<button class="chip ${f === g ? 'on' : ''}" data-filter="${esc(g)}">${esc(g.slice(1))}</button>`).join('')}</div>`;
  let emptyRun = [];
  const flushEmpty = () => { if (emptyRun.length) { html += `<div class="dayrow empty-day">${emptyRun.length === 1 ? emptyRun[0] : emptyRun[0] + ' – ' + emptyRun[emptyRun.length - 1]}</div>`; emptyRun = []; } };

  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    const s = ymd(d);
    if (d.getDay() === 1) { flushEmpty(); html += `<div class="weekmark">Vecka ${week(d)}</div>`; }
    const de = evs.filter(e => evDay(e) === s || (e.allDay && e.start < s && e.end > s));
    const dt = ts.filter(x => x.due === s);
    const dn = ns.filter(n => (n.tags || []).some(g => tagDate(g) === s));
    const label = `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}/${d.getMonth() + 1}`;
    if (!de.length && !dt.length && !dn.length) { emptyRun.push(label); continue; }
    flushEmpty();
    html += `<div class="hday"><div class="dayh"><span class="d">${d.getDate()} ${MONTHS[d.getMonth()]}</span><span class="w2">${DAYS[d.getDay()]}</span></div>
      ${de.map(e => eventRow(e)).join('')}${dt.map(taskRow).join('')}${dn.map(noteRow).join('')}</div>`;
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
      lines.push(`Projekt ${p.tag}.`);
      if (S.data.summaries?.[p.tag]) lines.push('Sammanfattning: ' + S.data.summaries[p.tag]);
      p.tasks.slice(0, 15).forEach(x => lines.push(`- Uppgift: ${x.title}${x.due ? ' (' + x.due + ')' : ''}`));
    }
  } else {
    lines.push(`Idag ${t}.`);
    fireItems().forEach(x => lines.push(`- Brinner: ${x.title} (förföll ${x.due})`));
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

  if (b.matches('.mode button')) { S.mode = b.dataset.mode; store.set('mode', S.mode); S.project = null; return render(); }
  if (b.id === 'otherToggle') { S.other = S.other === 'dolj' ? 'ton' : 'dolj'; store.set('other', S.other); return render(); }
  if (b.matches('.tabs button')) { S.tab = b.dataset.tab; store.set('tab', S.tab); if (S.tab !== 'projekt') S.project = null; window.scrollTo(0, 0); return render(); }
  if (b.matches('.sec > h2')) { const s = b.parentElement, id = s.dataset.sec; S.closed[id] = !s.classList.contains('closed'); store.set('closed', S.closed); s.classList.toggle('closed'); return; }
  if (b.matches('[data-project]')) { S.project = b.dataset.project; window.scrollTo(0, 0); return render(); }
  if (b.matches('[data-back]')) { S.project = null; return render(); }
  if (b.matches('[data-filter]')) { S.filter = b.dataset.filter || null; store.set('filter', S.filter); return renderHorisont(); }
  if (b.id === 'addBtn') return openAdd();
  if (b.matches('.check')) {
    const row = b.closest('[data-task]'); const id = row.dataset.task, list = row.dataset.list;
    const done = !S.done[id];
    S.done[id] = done; render();
    try { await api('complete', { listId: list, taskId: id, done }, true); }
    catch { delete S.done[id]; render(); toast('Kunde inte spara – försök igen'); }
    return;
  }
  if (b.matches('.item') && !tgt.closest('a')) b.classList.toggle('open');
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
