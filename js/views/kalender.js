/* KC – kalendern, byggd som Sikt: dag, vecka, månad och agenda; kalenderset; ihopslagning av dubbletter;
   snabbinmatning på svenska; snabbblock; dra-för-att-skapa; hitta tid; dölj helger; detaljpanel med karta och Anslut.
   Dra uppgifter in som tidsblock, dra händelser till ny tid, dra nederkanten för längd. */
import {
  S, api, emit, go, $, $$, esc, toast, ymd, parseYmd, addDays, todayStr, hhmm, shortDate, DAYS, MONTHS, week, monday,
  events, cfgProjects, tagColor, isDateTag, cleanTitle, modeCls, visible, ensureRange, WX, isFire, refresh, gcalLink, claudeUrl, tagHtml,
} from '../core.js';
import { taskRow, section, timeBlock, moveEvent, openEvent, seg, empty, pref, setPref } from '../ui.js';
import { parseQuick } from '../quickparse.js';

const H = 48;                 // pixlar per timme
const SNAP = 15;              // minuter
const WORK = [8, 18];         // arbetstid för hitta tid och block
const MODES = [['dag', 'Dag'], ['vecka', 'Vecka'], ['manad', 'Månad'], ['agenda', 'Agenda']];
let scrollTop = null;         // tidsrutnätets scroll mellan renders
let lastKey = '';
let slots = null;             // { len, list: [{date, a, b}] } – förslag från "hitta tid"
let quickText = '';           // snabbinmatningen överlever omritningar

const isDesk = () => window.innerWidth >= 900;
function state(args) {
  const mode = MODES.some(m => m[0] === args[0]) ? args[0] : (isDesk() ? 'vecka' : 'dag');
  let date = /^\d{4}-\d{2}-\d{2}$/.test(args[1] || '') ? args[1] : todayStr();
  if (mode === 'dag' && hideWE()) { const d = parseYmd(date); if (d.getDay() === 6) date = ymd(addDays(d, 2)); if (d.getDay() === 0) date = ymd(addDays(d, 1)); }
  return { mode, date };
}
const hideWE = () => !!pref('k_hidewe', false);
const isWE = d => d.getDay() === 0 || d.getDay() === 6;
function range(mode, date) {
  const d = parseYmd(date);
  if (mode === 'dag') return { from: d, to: addDays(d, 1), days: [d] };
  if (mode === 'agenda') return { from: d, to: addDays(d, 14), days: [...Array(14)].map((_, i) => addDays(d, i)) };
  if (mode === 'vecka') { const m = monday(d); return { from: m, to: addDays(m, 7), days: [...Array(7)].map((_, i) => addDays(m, i)).filter(x => !hideWE() || !isWE(x)) }; }
  const first = new Date(d.getFullYear(), d.getMonth(), 1), m = monday(first);
  return { from: m, to: addDays(m, 42), days: [...Array(42)].map((_, i) => addDays(m, i)), month: d.getMonth() };
}
const step = (mode, date, dir) => {
  const d = parseYmd(date);
  if (mode === 'dag') { let x = addDays(d, dir); while (hideWE() && isWE(x)) x = addDays(x, dir); return ymd(x); }
  if (mode === 'vecka') return ymd(addDays(d, dir * 7));
  if (mode === 'agenda') return ymd(addDays(d, dir * 14));
  return ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1));
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- kalendrar och set ----------
const calKey = e => e.calId || e.cal || '?';
/** Alla kalendrar KC känner till: från backend, annars ur händelserna. */
function calendars() {
  const m = new Map();
  (S.data?.calendars || []).forEach(c => m.set(c.id, { id: c.id, name: c.name, mode: c.mode, writable: !!c.writable, _src: c._src }));
  (S.data?.writableCalendars || []).forEach(c => { const x = m.get(c.id); if (x) x.writable = true; else m.set(c.id, { id: c.id, name: c.name, mode: c.mode, writable: true, _src: c._src }); });
  [...(S.data?.events || []), ...S.extraEvents].forEach(e => { const k = calKey(e); if (!m.has(k)) m.set(k, { id: k, name: e.cal || k, mode: e.mode, writable: !!e.writable, _src: e._src }); });
  return [...m.values()].sort((a, b) => (a.mode === b.mode ? 0 : a.mode === 'jobb' ? -1 : 1) || String(a.name).localeCompare(String(b.name), 'sv'));
}
const calColor = c => tagColor('kal:' + (c?.name || c));
function builtinSets() {
  const cs = calendars();
  return [
    { id: 'alla', name: 'Alla', cals: null, builtin: true },
    { id: 'jobb', name: 'Jobb', cals: cs.filter(c => c.mode === 'jobb').map(c => c.id), builtin: true },
    { id: 'privat', name: 'Privat', cals: cs.filter(c => c.mode === 'privat').map(c => c.id), builtin: true },
  ];
}
const userSets = () => pref('k_sets', []);
const allSets = () => [...builtinSets(), ...userSets()];
const activeSet = () => allSets().find(s => s.id === pref('k_set', 'alla')) || builtinSets()[0];
/** Kalendrar som syns just nu: setets kalendrar, minus de man bockat ur i "Alla". */
function shownCals() {
  const s = activeSet();
  if (s.cals) return new Set(s.cals);
  const hidden = new Set(pref('k_hidden', []));
  return new Set(calendars().map(c => c.id).filter(id => !hidden.has(id)));
}
let SHOWN = null;
const calOn = e => !SHOWN || SHOWN.has(calKey(e)) || !calendars().some(c => c.id === calKey(e));
const evs = () => events().filter(calOn);

// ---------- ihopslagning (MergeEngine) ----------
const norm = t => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
const mergeKeyOf = e => `${norm(cleanTitle(e.title))}|${new Date(e.start).getTime() || e.start}|${new Date(e.end).getTime() || e.end}|${e.allDay ? 1 : 0}`;
const richness = e => (e.location ? 2 : 0) + (e.description ? 2 : 0) + (e.writable && !e.recurring ? 3 : 0);
/** Händelser som ligger i flera kalendrar blir ett block. Den skrivbara/rikaste varianten är primär. */
function merge(list) {
  const b = new Map();
  list.forEach(e => { const k = mergeKeyOf(e); (b.get(k) || b.set(k, []).get(k)).push(e); });
  return [...b.values()].map(g => {
    if (g.length === 1) return g[0];
    const p = g.slice().sort((x, y) => richness(y) - richness(x))[0];
    const cals = [...new Set(g.map(x => x.cal))];
    return Object.assign(Object.create(p), { _copies: g, _cals: cals, location: g.map(x => x.location).find(Boolean) || '', description: g.map(x => x.description).find(Boolean) || '' });
  });
}

// ---------- data per dag ----------
const minutesOf = iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
function timedOn(s) {
  return merge(evs().filter(e => !e.allDay).filter(e => {
    const a = ymd(new Date(e.start)), b = ymd(new Date(new Date(e.end).getTime() - 1));
    return a <= s && b >= s;
  }));
}
const allDayOn = s => merge(evs().filter(e => e.allDay && e.start <= s && e.end > s));
const birthdaysOn = s => (S.data?.birthdays || []).filter(b => b.date === s);
const shootOn = s => cfgProjects().filter(visible).flatMap(p => (p.shootDays || []).filter(x => x.date === s).map(x => ({ p, x })));
const weatherOn = s => (S.weather?.days || []).find(w => w.date === s);
const tagOf = e => (e.tags || []).find(t => !isDateTag(t) && t !== '#PRIVAT');
const edge = e => { const t = tagOf(e); return t ? tagColor(t) : calColor(e.cal); };
const badge = e => e._copies ? `<span class="kcopies" title="Finns i ${esc(e._cals.join(', '))}">${e._cals.length}</span>` : '';

/** Lägger överlappande händelser sida vid sida. */
function layout(list, s) {
  const items = list.map(e => {
    const a = ymd(new Date(e.start)) < s ? 0 : minutesOf(e.start);
    const b = ymd(new Date(e.end)) > s ? 24 * 60 : Math.max(a + 15, minutesOf(e.end) || 24 * 60);
    return { e, a, b };
  }).sort((x, y) => x.a - y.a || y.b - x.b);
  let cluster = [], end = -1;
  const flush = () => { const n = Math.max(...cluster.map(c => c.col)) + 1; cluster.forEach(c => c.n = n); cluster = []; };
  items.forEach(it => {
    if (it.a >= end && cluster.length) flush();
    const used = new Set(cluster.filter(c => c.b > it.a).map(c => c.col));
    let col = 0; while (used.has(col)) col++;
    it.col = col; cluster.push(it); end = Math.max(end, it.b);
  });
  if (cluster.length) flush();
  return items;
}

// ---------- hitta tid (FreeTimeFinder) ----------
function freeSlots(days, len) {
  const out = [], now = new Date();
  days.forEach(x => {
    if (isWE(x)) return;
    const s = ymd(x);
    const busy = timedOn(s).map(e => {
      const a = ymd(new Date(e.start)) < s ? 0 : minutesOf(e.start);
      const b = ymd(new Date(e.end)) > s ? 24 * 60 : minutesOf(e.end);
      return [a, b];
    }).sort((p, q) => p[0] - q[0]);
    const open = WORK[0] * 60, close = WORK[1] * 60;
    let cur = open;
    if (s === todayStr()) cur = Math.max(cur, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30);
    if (s < todayStr()) return;
    let found = 0;
    const take = lim => { let a = Math.ceil(cur / 30) * 30; while (found < 4 && a + len <= lim) { out.push({ date: s, a, b: a + len }); found++; a += Math.max(len, 30); } };
    for (const [a, b] of busy) {
      if (b <= cur || a >= close) continue;
      if (a > cur) take(Math.min(a, close));
      cur = Math.max(cur, b);
      if (found >= 4 || cur >= close) break;
    }
    if (found < 4 && cur < close) take(close);
  });
  return out;
}

// ---------- rendering ----------
export function render(el, args) {
  const { mode, date } = state(args);
  const r = range(mode, date);
  if (S.data) ensureRange(ymd(r.from), ymd(r.to));
  SHOWN = shownCals();
  const key = mode + date;
  const old = el.querySelector('.kscroll');
  if (old && lastKey === key) scrollTop = old.scrollTop;
  else if (lastKey !== key && lastKey.slice(0, 3) !== key.slice(0, 3)) scrollTop = null;
  if (lastKey !== key && slots) { if (slots.keep) slots.keep = false; else slots = null; }
  lastKey = key;
  const hadFocus = document.activeElement?.id === 'kq';
  const caret = hadFocus ? document.activeElement.selectionStart : null;

  const d = parseYmd(date);
  const title = mode === 'dag' ? `${cap(DAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]}`
    : mode === 'vecka' ? `Vecka ${week(r.from)}`
    : mode === 'agenda' ? 'Agenda'
    : `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
  const sub = mode === 'vecka' ? `${shortDate(ymd(r.from))} – ${shortDate(ymd(addDays(r.from, 6)))} ${r.from.getFullYear()}`
    : mode === 'dag' ? `Vecka ${week(d)}${date === todayStr() ? ' · idag' : ''}`
    : mode === 'agenda' ? `${shortDate(ymd(r.from))} – ${shortDate(ymd(addDays(r.to, -1)))}` : '';
  const nav = `<div class="knav"><button class="btn" data-kgo="prev" aria-label="Föregående">‹</button><button class="btn" data-kgo="today">Idag</button><button class="btn" data-kgo="next" aria-label="Nästa">›</button></div>`;
  const head = `<header class="vhead khead2"><div><h1>${esc(title)}</h1>${sub ? `<div class="vsub">${esc(sub)}</div>` : ''}</div><div class="vact">${nav}${seg('kalmode', MODES, mode)}</div></header>`;

  const set = activeSet();
  const tools = `<div class="ktools">
    <div class="kqwrap"><input id="kq" class="kq" placeholder="Ny händelse – t.ex. lunch med Kim tis 12 på Kaféet" autocomplete="off" value="${esc(quickText)}"><div class="kqprev" id="kqprev">${previewHtml(quickText)}</div></div>
    <div class="kbtns">
      <div class="ksets">${allSets().map(s => `<button class="chip ${s.id === set.id ? 'on' : ''}" data-kset="${esc(s.id)}">${esc(s.name)}</button>`).join('')}</div>
      <button class="btn" data-kpanel title="Välj kalendrar och set">Kalendrar</button>
      <button class="btn" data-kfind title="Hitta ledig tid (f)">Hitta tid</button>
      <button class="btn" data-kblock title="Blocka nästa lediga timme (b)">Block</button>
      <button class="btn ${hideWE() ? 'on' : ''}" data-khidewe title="Dölj helger (h)">${hideWE() ? 'Visa helger' : 'Dölj helger'}</button>
    </div>
    ${slots ? `<div class="kslotbar"><span>Lediga tider · ${slots.len} min · ${slots.list.length} förslag</span>${[30, 60, 90, 120].map(n => `<button class="chip ${n === slots.len ? 'on' : ''}" data-kfindlen="${n}">${n < 60 ? n + ' min' : n / 60 + ' tim'}</button>`).join('')}<button class="btn" data-kslotclose>Stäng</button></div>` : ''}
  </div>`;

  let body;
  if (mode === 'manad') body = monthHtml(r, date);
  else if (mode === 'agenda') body = `<div class="kwrap agenda"><div class="kagenda">${agendaHtml(r)}</div>${planHtml(r, mode)}</div>`;
  else {
    const strip = mode === 'dag' ? weekStrip(d) : '';
    body = `<div class="kwrap ${mode}">${strip ? `<div class="kstrip-wrap">${strip}</div>` : ''}<div class="kgridwrap">${gridHtml(r.days)}</div>${planHtml(r, mode)}</div>`;
  }
  const panelOpen = pref('k_panel', false) && isDesk();
  el.innerHTML = `<div class="kal ${panelOpen ? 'withpanel' : ''}" data-mode="${mode}" data-date="${date}">${head}${tools}<div class="kmainwrap">${panelOpen ? `<aside class="kpanel">${panelHtml()}</aside>` : ''}<div class="kcontent">${body}</div></div></div>`;

  const sc = el.querySelector('.kscroll');
  if (sc) {
    if (scrollTop == null) {
      const h = new Date().getHours();
      const first = Math.min(...r.days.flatMap(x => timedOn(ymd(x)).map(e => ymd(new Date(e.start)) === ymd(x) ? new Date(e.start).getHours() : 24)), 8);
      const startH = r.days.some(x => ymd(x) === todayStr()) && h >= 7 && h <= 18 ? h - 1 : Math.max(0, Math.min(first, 8) - 1);
      scrollTop = startH * H;
    }
    sc.scrollTop = scrollTop;
  }
  if (hadFocus) { const q = el.querySelector('#kq'); q.focus(); if (caret != null) q.setSelectionRange(caret, caret); }
  bind();
}

function previewHtml(text) {
  if (!text.trim()) return '';
  const p = parseQuick(text, { kind: 'event' });
  const d = parseYmd(p.date);
  const when = p.allDay ? `${cap(DAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${p.endDate ? ' – ' + shortDate(p.endDate) : ''} · heldag`
    : `${cap(DAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} · ${p.time}–${p.endTime}${p.endDate ? ' (' + shortDate(p.endDate) + ')' : ''}`;
  const cal = quickCal(p);
  return `<b>${esc(p.title)}</b><span>${esc(when)}</span>${p.location ? `<span>${esc(p.location)}</span>` : ''}${p.recur ? `<span>Upprepas ${esc(p.recur)}</span>` : ''}<span class="kqcal">${cal ? esc(cal.name) : 'Ingen skrivbar kalender'}</span><kbd>↵</kbd>`;
}
function quickCal(p) {
  // Backendens ordning gäller: första skrivbara kalendern är huvudkalendern.
  const order = (S.data?.writableCalendars || []).map(c => c.id);
  const w = calendars().filter(c => c.writable).sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  if (p?.calendarHint) { const h = p.calendarHint.toLowerCase(); const c = w.find(x => x.name.toLowerCase().startsWith(h)) || w.find(x => x.name.toLowerCase().includes(h)); if (c) return c; }
  return w.find(c => c.mode === S.mode && SHOWN?.has(c.id)) || w.find(c => c.mode === S.mode) || w[0];
}

function panelHtml() {
  const cs = calendars(), shown = shownCals(), set = activeSet();
  const group = m => cs.filter(c => (c.mode || 'jobb') === m);
  const row = c => `<label class="kcal"><input type="checkbox" data-kcal="${esc(c.id)}" ${shown.has(c.id) ? 'checked' : ''}><i style="--tc:${calColor(c)}"></i><span>${esc(c.name)}</span>${c.writable ? '' : '<small title="Läses bara">·</small>'}</label>`;
  return `<div class="kp-sec"><div class="kp-h">Set</div>${allSets().map(s => `<div class="kp-set ${s.id === set.id ? 'on' : ''}"><button data-kset="${esc(s.id)}">${esc(s.name)}</button>${s.builtin ? '' : `<button class="x" data-kdelset="${esc(s.id)}" title="Ta bort setet">×</button>`}</div>`).join('')}
      <button class="kp-add" data-ksaveset>+ Spara bockade som set</button></div>
    ${['jobb', 'privat'].map(m => group(m).length ? `<div class="kp-sec"><div class="kp-h">${m === 'jobb' ? 'Jobb' : 'Privat'}</div>${group(m).map(row).join('')}</div>` : '').join('')}
    <p class="kp-hint">${set.builtin && set.id === 'alla' ? 'Bocka ur kalendrar du inte vill se.' : `Setet "${esc(set.name)}" är aktivt. Ändringar sparas i setet.`}</p>`;
}

function weekStrip(d) {
  const m = monday(d);
  return `<div class="kstrip">${[...Array(7)].map((_, i) => {
    const x = addDays(m, i), s = ymd(x);
    if (hideWE() && isWE(x)) return '';
    const n = timedOn(s).length + allDayOn(s).length;
    return `<a href="#/kalender/dag/${s}" class="${s === ymd(d) ? 'on' : ''} ${s === todayStr() ? 'today' : ''}"><span>${DAYS[x.getDay()].slice(0, 2)}</span><b>${x.getDate()}</b>${n ? '<i></i>' : '<i class="no"></i>'}</a>`;
  }).join('')}</div>`;
}

function dayHead(x) {
  const s = ymd(x), w = weatherOn(s);
  return `<div class="kdh ${s === todayStr() ? 'today' : ''}" data-date="${s}">
    <a href="#/kalender/dag/${s}"><span class="wd">${DAYS[x.getDay()].slice(0, 3)}</span><span class="kdn">${x.getDate()}</span></a>
    ${w ? `<span class="wx" title="${esc(WX(w.code))} · ${Math.round(w.min)}°/${Math.round(w.max)}°">${Math.round(w.max)}°</span>` : ''}
  </div>`;
}

function allDayCell(x) {
  const s = ymd(x);
  const chips = [
    ...shootOn(s).map(({ p, x: sd }) => `<a class="kad shoot" style="--tc:${tagColor(p.tag)}" href="#/projekt/${encodeURIComponent(p.tag)}/produktion/dagar/${s}" title="${esc(p.name)} · inspelningsdag ${sd.day}${sd.hours ? ' · ' + esc(sd.hours) : ''}">Dag ${sd.day}${sd.note ? ' · ' + esc(sd.note) : ''}</a>`),
    ...allDayOn(s).map(e => `<div class="item kad ${modeCls(e.mode)} ${e.pending ? 'pending' : ''}" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}" style="--tc:${edge(e)}" title="${esc(e.title)}">${esc(cleanTitle(e.title))}${badge(e)}</div>`),
    ...birthdaysOn(s).map(b => `<div class="kad bday" title="Fyller år">◦ ${esc(b.title)}</div>`),
  ];
  return `<div class="kac" data-date="${s}" data-allday="1">${chips.join('')}</div>`;
}

function gridHtml(days) {
  const cols = days.length;
  const hours = [...Array(24)].map((_, h) => `<div class="khr ${h < WORK[0] || h >= WORK[1] ? 'off' : ''}"><span>${h ? String(h).padStart(2, '0') : ''}</span></div>`).join('');
  const now = new Date(), nowS = todayStr(), nowM = now.getHours() * 60 + now.getMinutes();
  const colHtml = days.map(x => {
    const s = ymd(x);
    const items = layout(timedOn(s), s).map(({ e, a, b, col, n }) => {
      const top = a / 60 * H, h = Math.max(18, (b - a) / 60 * H - 2);
      const can = e.writable && !e.recurring && !String(e.id).startsWith('tmp');
      const short = h < 34;
      return `<div class="item kev ${modeCls(e.mode)} ${e.pending ? 'pending' : ''} ${can ? 'can' : ''} ${short ? 'short' : ''} ${new Date(e.end) < now ? 'past' : ''}" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}"
        style="top:${top}px;height:${h}px;left:calc(${col / n * 100}% + 2px);width:calc(${100 / n}% - 4px);--tc:${edge(e)}">
        <div class="kt">${esc(cleanTitle(e.title))}${badge(e)}</div>${short ? '' : `<div class="km">${hhmm(e.start)}–${hhmm(e.end)}${e.location ? ' · ' + esc(e.location) : ''}</div>`}
        ${can ? '<div class="kres" title="Dra för att ändra längd"></div>' : ''}</div>`;
    }).join('');
    const sl = (slots?.list || []).filter(z => z.date === s).map(z => `<button class="kslot" data-kslot="${s}|${z.a}|${z.b}" style="top:${z.a / 60 * H}px;height:${(z.b - z.a) / 60 * H - 2}px" title="Ledigt ${fmtMin(z.a)}–${fmtMin(z.b)} – klicka för att boka">${fmtMin(z.a)}<span> ledigt</span></button>`).join('');
    const nowLine = s === nowS ? `<div class="know" style="top:${nowM / 60 * H}px"></div>` : '';
    return `<div class="kcol ${s === nowS ? 'today' : ''} ${isWE(x) ? 'we' : ''}" data-date="${s}">${items}${sl}${nowLine}</div>`;
  }).join('');
  return `<div class="kgrid" style="--cols:${cols}">
    <div class="khead"><div class="kgut">v.${week(days[0])}</div>${days.map(dayHead).join('')}</div>
    <div class="kallday"><div class="kgut">heldag</div>${days.map(allDayCell).join('')}</div>
    <div class="kscroll"><div class="kbody" style="height:${24 * H}px"><div class="khours">${hours}</div><div class="kcols">${colHtml}</div></div></div>
  </div>`;
}

function agendaHtml(r) {
  const t = todayStr();
  const tasksOn = s => (S.data?.tasks || []).filter(visible).filter(x => x.due === s && !S.done[x.id]);
  let out = '';
  r.days.forEach(x => {
    if (hideWE() && isWE(x)) return;
    const s = ymd(x);
    const all = allDayOn(s), timed = timedOn(s).sort((a, b) => String(a.start).localeCompare(String(b.start))), sh = shootOn(s), bd = birthdaysOn(s), ts = tasksOn(s);
    const sl = (slots?.list || []).filter(z => z.date === s);
    const n = all.length + timed.length + sh.length + bd.length + ts.length + sl.length;
    const w = weatherOn(s);
    out += `<div class="kag ${s === t ? 'today' : ''} ${n ? '' : 'emptyday'}">
      <a class="kag-h" href="#/kalender/dag/${s}"><b>${x.getDate()}</b><span>${DAYS[x.getDay()]}${s === t ? ' · idag' : ''}</span>${w ? `<small>${Math.round(w.max)}° ${esc(WX(w.code))}</small>` : ''}</a>
      <div class="kag-b">
        ${sh.map(({ p, x: sd }) => `<a class="item" href="#/projekt/${encodeURIComponent(p.tag)}/produktion/dagar/${s}"><div class="time">Dag ${sd.day}</div><div class="main"><div class="title">${esc(sd.note || 'Inspelning')}<span class="tags">${tagHtml([p.tag])}</span></div><div class="sub">${esc(sd.hours || '')}</div></div></a>`).join('')}
        ${[...all, ...timed].map(e => `<div class="item event kagev ${modeCls(e.mode)} ${e.pending ? 'pending' : ''} ${!e.allDay && new Date(e.end) < new Date() ? 'past' : ''}" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}" style="--tc:${edge(e)}">
            <div class="time">${e.allDay ? 'Heldag' : hhmm(e.start)}</div><div class="main"><div class="title">${esc(cleanTitle(e.title))}${badge(e)}<span class="tags">${tagHtml(e.tags)}</span></div>
            <div class="sub">${e.allDay ? '' : hhmm(e.start) + '–' + hhmm(e.end) + '<i class="sep">·</i>'}${esc(e._cals ? e._cals.join(', ') : e.cal)}${e.location ? '<i class="sep">·</i>' + esc(e.location) : ''}</div></div></div>`).join('')}
        ${sl.map(z => `<button class="item kslot-row" data-kslot="${s}|${z.a}|${z.b}"><div class="time">${fmtMin(z.a)}</div><div class="main"><div class="title">Ledigt ${fmtMin(z.a)}–${fmtMin(z.b)}</div><div class="sub">Klicka för att boka</div></div></button>`).join('')}
        ${ts.map(x2 => taskRow(x2, { noList: true })).join('')}
        ${bd.map(b => `<div class="item"><div class="time">◦</div><div class="main"><div class="title">${esc(b.title)} fyller år</div></div></div>`).join('')}
        ${n ? '' : '<p class="empty">Inget inplanerat.</p>'}
      </div></div>`;
  });
  return out;
}

function planHtml(r, mode) {
  if (!S.data) return '';
  const t = todayStr(), from = ymd(r.from), to = ymd(addDays(r.to, mode === 'dag' ? 6 : 0));
  const all = (S.data.tasks || []).filter(visible).filter(x => !S.done[x.id]);
  const over = all.filter(isFire);
  const today = all.filter(x => x.due === t);
  const period = all.filter(x => x.due && x.due > t && x.due >= from && x.due < to);
  const undated = all.filter(x => !x.due && !x.waiting);
  if (S.closed['kp-utan'] === undefined) S.closed['kp-utan'] = true;
  if (!isDesk() && S.closed['kp-mobil'] === undefined) S.closed['kp-mobil'] = true;
  const sec = (id, title, list, extra = '') => list.length ? section('kp-' + id, title, list.length, list.slice(0, 40).map(x => taskRow(x, { noList: true })).join('') + (list.length > 40 ? `<p class="empty">+ ${list.length - 40} till</p>` : ''), extra) : '';
  const html = sec('over', 'Förfallna', over, 'fire') + sec('idag', 'Idag', today) + sec('period', mode === 'dag' ? 'Kommande vecka' : 'Den här perioden', period) + sec('utan', 'Utan datum', undated);
  if (!isDesk()) return section('kp-mobil', 'Att planera', over.length + today.length + period.length + undated.length, html || empty('Inget att planera.'), 'kplan');
  return `<aside class="kplan"><div class="kplan-h"><b>Att planera</b><span>Dra in i kalendern</span></div>${html || empty('Inget att planera.')}</aside>`;
}

function monthHtml(r, date) {
  const t = todayStr();
  const we = hideWE();
  const names = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'].filter((_, i) => !we || i < 5);
  const head = names.map(x => `<div class="kmh">${x}</div>`).join('');
  let cells = '';
  for (let w = 0; w < 6; w++) {
    const wd = r.days.slice(w * 7, w * 7 + 7).filter(x => !we || !isWE(x));
    cells += `<div class="kmw">${week(wd[0])}</div>`;
    cells += wd.map(x => {
      const s = ymd(x);
      const list = [...allDayOn(s), ...timedOn(s).sort((a, b) => a.start.localeCompare(b.start))];
      const shoot = shootOn(s);
      const lines = [
        ...shoot.map(({ p, x: sd }) => `<div class="kml shoot" style="--tc:${tagColor(p.tag)}">Dag ${sd.day}</div>`),
        ...list.map(e => `<div class="kml ${modeCls(e.mode)} ${e.allDay ? 'ad' : ''}" style="--tc:${edge(e)}">${e.allDay ? '' : `<span>${hhmm(e.start)}</span>`}${esc(cleanTitle(e.title))}</div>`),
      ];
      const tasksDue = (S.data?.tasks || []).filter(visible).filter(x2 => x2.due === s && !S.done[x2.id]).length;
      return `<a class="kmc ${x.getMonth() !== r.month ? 'out' : ''} ${s === t ? 'today' : ''} ${isWE(x) ? 'we' : ''}" href="#/kalender/dag/${s}" data-date="${s}" data-mday="1">
        <div class="kmd"><b>${x.getDate()}</b>${tasksDue ? `<span class="kmt" title="${tasksDue} uppgifter">${tasksDue}</span>` : ''}</div>
        ${lines.slice(0, 4).join('')}${lines.length > 4 ? `<div class="kml more">+ ${lines.length - 4}</div>` : ''}</a>`;
    }).join('');
  }
  return `<div class="kmonth" style="--mcols:${we ? 5 : 7}"><div class="kmw h"></div>${head}${cells}</div>`;
}

// ---------- detaljpanel ----------
const CONF_RE = /https?:\/\/(?:[\w-]+\.)?(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com|[\w-]+\.webex\.com)\/[^\s<>"')]+/i;
const confUrl = e => ((e.location || '') + ' ' + (e.description || '')).match(CONF_RE)?.[0] || null;
const mappable = s => { const x = String(s || '').trim().toLowerCase(); return x.length > 2 && !x.startsWith('http') && !x.startsWith('www.') && !CONF_RE.test(x); };
const enc = s => encodeURIComponent(String(s).trim());
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

function openDetail(e, anchor) {
  closeDetail();
  const can = e.writable && !e.recurring && !String(e.id).startsWith('tmp');
  const conf = confUrl(e);
  const when = e.allDay
    ? (() => { const a = parseYmd(e.start), last = addDays(parseYmd(e.end), -1); return `${cap(DAYS[a.getDay()])} ${a.getDate()} ${MONTHS[a.getMonth()]}${ymd(last) > e.start ? ' – ' + shortDate(ymd(last)) : ''} · heldag`; })()
    : (() => { const a = new Date(e.start); return `${cap(DAYS[a.getDay()])} ${a.getDate()} ${MONTHS[a.getMonth()]} · ${hhmm(e.start)}–${hhmm(e.end)}`; })();
  const box = document.createElement('div');
  box.className = 'kdetail';
  box.innerHTML = `<div class="kd-bar" style="--tc:${edge(e)}"></div>
    <div class="kd-h"><h3>${esc(cleanTitle(e.title))}</h3><button class="kd-x" data-kdclose aria-label="Stäng">×</button></div>
    <div class="kd-when">${esc(when)}</div>
    ${tagOf(e) ? `<div class="kd-tags">${tagHtml(e.tags)}</div>` : ''}
    <div class="kd-cal">${esc(e._cals ? e._cals.join(' · ') : e.cal)}${e.recurring ? ' · återkommande' : ''}${!e.writable ? ' · läses bara' : ''}</div>
    ${conf ? `<a class="btn solid kd-join" href="${esc(conf)}" target="_blank" rel="noopener">Anslut</a>` : ''}
    ${e.location ? `<div class="kd-loc"><div>${linkify(e.location)}</div>${mappable(e.location) ? `<div class="kd-maps"><a href="https://www.google.com/maps/search/?api=1&query=${enc(e.location)}" target="_blank" rel="noopener">Google Maps</a><a href="https://maps.apple.com/?q=${enc(e.location)}" target="_blank" rel="noopener">Apple Kartor</a><a href="https://www.google.com/maps/dir/?api=1&destination=${enc(e.location)}" target="_blank" rel="noopener">Vägbeskrivning</a></div>` : ''}</div>` : ''}
    ${e.description ? `<div class="kd-desc">${linkify(e.description.slice(0, 1200))}</div>` : ''}
    <div class="kd-act">${can ? '<button class="btn solid" data-kdedit>Redigera</button>' : '<button class="btn" data-kdedit>Visa</button>'}
      ${e.calId ? `<a class="btn" href="${esc(gcalLink(e))}" target="_blank" rel="noopener">Google Kalender</a>` : ''}
      <a class="btn" href="${claudeUrl('Kalenderhändelse: ' + e.title + ', ' + when + (e.location ? ', ' + e.location : '') + (e.description ? '\n' + e.description : ''))}" target="_blank" rel="noopener">Fråga Claude</a></div>`;
  document.body.appendChild(box);
  box._ev = e;
  if (isDesk() && anchor) {
    const r = anchor.getBoundingClientRect(), W = 340;
    let left = r.right + 10; if (left + W > window.innerWidth - 12) left = Math.max(12, r.left - W - 10);
    const top = Math.max(12, Math.min(r.top, window.innerHeight - box.offsetHeight - 12));
    Object.assign(box.style, { left: left + 'px', top: top + 'px' });
  } else box.classList.add('sheet');
}
function closeDetail() { $$('.kdetail').forEach(x => x.remove()); }

// ---------- interaktion ----------
const snapMin = m => Math.max(0, Math.min(24 * 60 - SNAP, Math.round(m / SNAP) * SNAP));
const fmtMin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function minAt(col, clientY) { const r = col.getBoundingClientRect(); return (clientY - r.top) / H * 60; }
function colAt(x, y) { const el = document.elementFromPoint(x, y); return el?.closest?.('.kal .kcol'); }
const curState = () => { const k = $('.kal'); return k ? { mode: k.dataset.mode, date: k.dataset.date } : null; };

async function createQuick() {
  const text = $('#kq')?.value.trim(); if (!text) return;
  const p = parseQuick(text, { kind: 'event' });
  const cal = quickCal(p);
  if (!cal) return toast('Ingen kalender att skriva till');
  const params = { title: p.title, date: p.date, calendarId: cal.id, location: p.location || '' };
  if (!p.allDay) { params.time = p.time; params.endTime = p.endTime; if (p.endDate) params.endDate = p.endDate; }
  else if (p.endDate) params.endDate = p.endDate;
  if (p.recur) params.description = `Upprepas ${p.recur} – ställ in upprepningen i Google Kalender.`;
  quickText = ''; $('#kq').value = ''; $('#kqprev').innerHTML = '';
  const tmp = { id: 'tmp' + Date.now(), calId: cal.id, cal: cal.name, _src: cal._src, mode: cal.mode, title: p.title, location: p.location || '', allDay: p.allDay, writable: true, pending: true, tags: p.tags,
    start: p.allDay ? p.date : new Date(`${p.date}T${p.time}`).toISOString(), end: p.allDay ? ymd(addDays(parseYmd(p.endDate || p.date), 1)) : new Date(`${p.endDate || p.date}T${p.endTime}`).toISOString() };
  S.data.events.push(tmp); emit('render');
  try {
    await api('addEvent', params, true, cal._src || 'jobb');
    toast(`${p.title} · ${shortDate(p.date)}${p.allDay ? '' : ' ' + p.time}${p.recur ? ' · upprepningen ställs in i Google Kalender' : ''}`);
    refresh();
  } catch (err) { S.data.events = S.data.events.filter(x => x !== tmp); emit('render'); toast('Kunde inte skapa – ' + err.message); }
}

async function quickBlock() {
  const st = curState() || { mode: 'dag', date: todayStr() };
  const startDay = st.date >= todayStr() ? parseYmd(st.date) : new Date();
  const days = [...Array(7)].map((_, i) => addDays(startDay, i));
  const s = freeSlots(days, 60)[0];
  if (!s) return toast('Ingen ledig timme inom arbetstid den kommande veckan');
  const cal = quickCal(null);
  if (!cal) return toast('Ingen kalender att skriva till');
  const tmp = { id: 'tmp' + Date.now(), calId: cal.id, cal: cal.name, _src: cal._src, mode: cal.mode, title: 'Block', location: '', allDay: false, writable: true, pending: true, tags: [],
    start: new Date(`${s.date}T${fmtMin(s.a)}`).toISOString(), end: new Date(`${s.date}T${fmtMin(s.b)}`).toISOString() };
  S.data.events.push(tmp); emit('render');
  try { await api('addEvent', { title: 'Block', date: s.date, time: fmtMin(s.a), endTime: fmtMin(s.b), calendarId: cal.id }, true, cal._src || 'jobb'); toast(`Block ${shortDate(s.date)} ${fmtMin(s.a)}–${fmtMin(s.b)}`); refresh(); }
  catch (err) { S.data.events = S.data.events.filter(x => x !== tmp); emit('render'); toast('Kunde inte blocka – ' + err.message); }
}

function findTime(len) {
  const st = curState(); if (!st) return;
  let days = range(st.mode, st.date).days;
  if (st.mode === 'manad') { st.mode = 'vecka'; days = range('vecka', st.date).days; go(`kalender/vecka/${st.date >= todayStr() ? st.date : todayStr()}`); }
  if (st.mode === 'dag') days = [parseYmd(st.date)];
  days = days.filter(x => ymd(x) >= todayStr() && !isWE(x));
  if (!days.length) {
    // Perioden har passerat eller är helg: leta den kommande veckan i stället.
    days = [...Array(7)].map((_, i) => addDays(new Date(), i)).filter(x => !isWE(x));
    slots = { len, list: freeSlots(days, len), keep: true };
    go(`kalender/${st.mode === 'dag' ? 'dag' : 'vecka'}/${ymd(days[0])}`);
    return;
  }
  const list = freeSlots(days, len);
  slots = { len, list, keep: false };
  if (!list.length) toast('Inga lediga luckor inom arbetstid i den här perioden');
  emit('render');
}

function setSet(id) {
  setPref('k_set', id);
  emit('render');
}
function toggleCal(id, on) {
  const set = activeSet();
  if (set.builtin && set.id === 'alla') {
    const h = new Set(pref('k_hidden', [])); on ? h.delete(id) : h.add(id); setPref('k_hidden', [...h]);
  } else if (set.builtin) {
    // Ändring i Jobb/Privat → börja om från "Alla" med det urvalet
    const cur = shownCals(); on ? cur.add(id) : cur.delete(id);
    setPref('k_hidden', calendars().map(c => c.id).filter(x => !cur.has(x))); setPref('k_set', 'alla');
  } else {
    const sets = userSets().map(s => s.id === set.id ? { ...s, cals: on ? [...new Set([...s.cals, id])] : s.cals.filter(x => x !== id) } : s);
    setPref('k_sets', sets);
  }
  emit('render');
}
function saveSet() {
  const name = prompt('Namn på setet (t.ex. Inspelning):'); if (!name || !name.trim()) return;
  const s = { id: 's' + Date.now().toString(36), name: name.trim(), cals: [...shownCals()] };
  setPref('k_sets', [...userSets(), s]); setPref('k_set', s.id); emit('render');
}
function delSet(id) {
  const s = userSets().find(x => x.id === id); if (!s || !confirm(`Ta bort setet "${s.name}"?`)) return;
  setPref('k_sets', userSets().filter(x => x.id !== id)); if (pref('k_set') === id) setPref('k_set', 'alla'); emit('render');
}
function openPanelSheet() {
  let d = $('#kcalDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', '<dialog id="kcalDlg" class="sheet kal-sheet"><div class="kpanel" id="kcalBody"></div><div class="actions"><span class="spacer"></span><button class="ghost" data-kcalclose>Klar</button></div></dialog>');
    d = $('#kcalDlg');
    d.addEventListener('click', e => { if (e.target.closest('[data-kcalclose]') || e.target === d) d.close(); });
  }
  $('#kcalBody').innerHTML = panelHtml();
  if (!d.open) d.showModal();
}

let bound = false, drag = null, create = null, suppressClick = false;
function bind() {
  if (bound) return; bound = true;

  // Snabbinmatning
  document.addEventListener('input', e => {
    if (e.target.id !== 'kq') return;
    quickText = e.target.value;
    const pv = $('#kqprev'); if (pv) pv.innerHTML = previewHtml(quickText);
  });
  document.addEventListener('keydown', e => {
    if (e.target.id !== 'kq') return;
    if (e.key === 'Enter') { e.preventDefault(); createQuick(); }
    if (e.key === 'Escape') { e.target.value = ''; quickText = ''; $('#kqprev').innerHTML = ''; e.target.blur(); }
  });

  // Klick: navigering, verktyg, panel, förslag
  document.addEventListener('click', e => {
    if (!e.target.closest('.kdetail') && !e.target.closest('.kal [data-ev]')) closeDetail();
    const inSheet = e.target.closest('#kcalDlg');
    const k = e.target.closest('.kal') || (inSheet ? $('.kal') : null);
    if (!k) return;
    const mode = k.dataset.mode, date = k.dataset.date;
    const g = e.target.closest('[data-kgo]');
    if (g) { const v = g.dataset.kgo; scrollTop = null; return go(`kalender/${mode}/${v === 'today' ? todayStr() : step(mode, date, v === 'next' ? 1 : -1)}`); }
    const sg = e.target.closest('[data-segname="kalmode"] [data-seg]');
    if (sg) return go(`kalender/${sg.dataset.seg}/${date}`);
    const t = e.target.closest('[data-kset],[data-kdelset],[data-ksaveset],[data-kpanel],[data-kfind],[data-kfindlen],[data-kslotclose],[data-kblock],[data-khidewe],[data-kslot]');
    if (!t) return;
    if (t.dataset.kset) setSet(t.dataset.kset);
    else if (t.dataset.kdelset) delSet(t.dataset.kdelset);
    else if (t.hasAttribute('data-ksaveset')) saveSet();
    else if (t.hasAttribute('data-kpanel')) { if (isDesk()) { setPref('k_panel', !pref('k_panel', false)); emit('render'); } else openPanelSheet(); }
    else if (t.hasAttribute('data-kfind')) findTime(slots?.len || 60);
    else if (t.dataset.kfindlen) findTime(Number(t.dataset.kfindlen));
    else if (t.hasAttribute('data-kslotclose')) { slots = null; emit('render'); }
    else if (t.hasAttribute('data-kblock')) quickBlock();
    else if (t.hasAttribute('data-khidewe')) { setPref('k_hidewe', !hideWE()); emit('render'); }
    else if (t.dataset.kslot) { const [d, a, b] = t.dataset.kslot.split('|'); slots = null; openEvent(null, null, { date: d, time: fmtMin(+a), endTime: fmtMin(+b) }); }
    if ($('#kcalDlg')?.open) $('#kcalBody').innerHTML = panelHtml();
  });
  document.addEventListener('change', e => {
    const c = e.target.closest('[data-kcal]'); if (!c) return;
    toggleCal(c.dataset.kcal, c.checked);
    if ($('#kcalDlg')?.open) $('#kcalBody').innerHTML = panelHtml();
  });

  // Händelse i kalendern → detaljpanel (före main.js globala klick som öppnar redigeraren)
  document.addEventListener('click', e => {
    if (suppressClick) return;
    const node = e.target.closest('.kal [data-ev]');
    if (!node || e.target.closest('a')) return;
    e.stopPropagation(); e.preventDefault();
    const ev = findEv(node); if (ev) openDetail(ev, node);
  }, true);
  document.addEventListener('click', e => {
    const d = e.target.closest('.kdetail'); if (!d) return;
    if (e.target.closest('[data-kdclose]')) return closeDetail();
    if (e.target.closest('[data-kdedit]')) { const ev = d._ev; closeDetail(); openEvent(ev.id, ev.start); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); if (slots) { slots = null; emit('render'); } } });

  // Klick i tom tid → ny händelse. Undertryck klick direkt efter drag.
  document.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
    const col = e.target.closest('.kal .kcol');
    if (!col || e.target.closest('.kev, .kslot')) return;
    const m = snapMin(minAt(col, e.clientY) - SNAP / 2);
    openEvent(null, null, { date: col.dataset.date, time: fmtMin(m), endTime: fmtMin(Math.min(24 * 60 - 1, m + 60)) });
  }, true);

  // Dra händelser (flytta), nederkant (längd), och dra i tom tid (skapa)
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const ev = e.target.closest('.kal .kev.can');
    if (!ev) {
      const col = e.target.closest('.kal .kcol');
      if (col && !e.target.closest('.kev, .kslot') && e.pointerType !== 'touch') {
        const a = snapMin(minAt(col, e.clientY) - SNAP / 2);
        create = { col, a, b: a + SNAP, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
      }
      return;
    }
    const col = ev.closest('.kcol');
    const evt = findEv(ev);
    if (!evt) return;
    const resize = !!e.target.closest('.kres');
    const startMin = ymd(new Date(evt.start)) === col.dataset.date ? minutesOf(evt.start) : 0;
    const dur = (new Date(evt.end) - new Date(evt.start)) / 60000;
    drag = { el: ev, evt, resize, x0: e.clientX, y0: e.clientY, offset: minAt(col, e.clientY) - startMin, startMin, dur, moved: false, date: col.dataset.date, min: startMin, len: dur, ghost: null };
    ev.setPointerCapture?.(e.pointerId);
  });
  document.addEventListener('pointermove', e => {
    if (create) {
      if (!create.moved && Math.abs(e.clientY - create.y0) < 6) return;
      if (!create.moved) { create.moved = true; create.ghost = document.createElement('div'); create.ghost.className = 'kghost new'; }
      e.preventDefault();
      const m = snapMin(minAt(create.col, e.clientY) + SNAP / 2);
      const a = Math.min(create.a, m), b = Math.max(create.a + SNAP, m);
      create.lo = a; create.hi = b;
      placeGhostEl(create.ghost, create.col, a, b - a);
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'kghost';
      drag.el.classList.add('dragging');
      closeDetail();
    }
    e.preventDefault();
    if (drag.resize) {
      const col = drag.el.closest('.kcol');
      const end = snapMin(minAt(col, e.clientY));
      drag.len = Math.max(SNAP, end - drag.startMin);
      placeGhostEl(drag.ghost, col, drag.startMin, drag.len);
    } else {
      const col = colAt(e.clientX, e.clientY) || drag.el.closest('.kcol');
      drag.date = col.dataset.date;
      drag.min = snapMin(minAt(col, e.clientY) - drag.offset);
      placeGhostEl(drag.ghost, col, drag.min, drag.dur);
    }
  });
  const end = async () => {
    if (create) {
      const c = create; create = null;
      c.ghost?.remove();
      if (!c.moved) return;
      suppressClick = true; setTimeout(() => suppressClick = false, 300);
      return openEvent(null, null, { date: c.col.dataset.date, time: fmtMin(c.lo), endTime: fmtMin(Math.min(24 * 60 - 1, c.hi)) });
    }
    if (!drag) return;
    const d = drag; drag = null;
    d.el.classList.remove('dragging'); d.ghost?.remove();
    if (!d.moved) return;
    suppressClick = true; setTimeout(() => suppressClick = false, 300);
    const target = d.evt._copies ? d.evt._copies.find(x => x.writable && !x.recurring) || d.evt : d.evt;
    if (d.resize) { if (d.len !== d.dur) await moveEvent(target, ymd(new Date(d.evt.start)), hhmm(d.evt.start), d.len); }
    else if (d.min !== d.startMin || d.date !== ymd(new Date(d.evt.start))) await moveEvent(target, d.date, fmtMin(d.min));
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => { if (drag) { drag.el.classList.remove('dragging'); drag.ghost?.remove(); drag = null; } if (create) { create.ghost?.remove(); create = null; } });

  // Släpp uppgifter: på tid → tidsblock, på heldag/månadsdag → datum
  const taskDrag = e => [...(e.dataTransfer?.types || [])].includes('text/kc-task');
  document.addEventListener('dragover', e => {
    if (!taskDrag(e)) return;
    const col = e.target.closest?.('.kal .kcol');
    const day = e.target.closest?.('.kal [data-allday], .kal [data-mday]');
    if (!col && !day) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    $$('.kal .dropzone').forEach(x => x !== day && x.classList.remove('dropzone'));
    if (col) { taskGhost ||= Object.assign(document.createElement('div'), { className: 'kghost' }); placeGhostEl(taskGhost, col, snapMin(minAt(col, e.clientY) - SNAP), 60); }
    else { taskGhost?.remove(); day.classList.add('dropzone'); }
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget || !e.relatedTarget.closest?.('.kal')) clearDrop(); });
  document.addEventListener('drop', async e => {
    if (!taskDrag(e)) return;
    const col = e.target.closest?.('.kal .kcol');
    const day = e.target.closest?.('.kal [data-allday], .kal [data-mday]');
    if (!col && !day) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/kc-task');
    const t = (S.data?.tasks || []).find(x => x.id === id);
    clearDrop();
    if (!t) return;
    if (col) { const m = snapMin(minAt(col, e.clientY) - SNAP); await timeBlock(t, col.dataset.date, fmtMin(m), 60, quickCal(null)?.id); }
    else await setDue(t, day.dataset.date);
  });

  // Nu-linjen följer klockan
  setInterval(() => {
    const n = $('.kal .know'); if (!n) return;
    const now = new Date(); n.style.top = (now.getHours() * 60 + now.getMinutes()) / 60 * H + 'px';
  }, 60e3);
  document.addEventListener('scroll', e => { if (e.target.classList?.contains('kscroll')) scrollTop = e.target.scrollTop; }, true);
}

let taskGhost = null;
function placeGhostEl(g, col, min, len) {
  if (g.parentElement !== col) col.appendChild(g);
  g.style.top = min / 60 * H + 'px';
  g.style.height = Math.max(18, len / 60 * H - 2) + 'px';
  g.textContent = `${fmtMin(min)}–${fmtMin(Math.min(24 * 60, min + len))}`;
}
function clearDrop() { taskGhost?.remove(); taskGhost = null; $$('.kal .dropzone').forEach(x => x.classList.remove('dropzone')); }

function findEv(node) {
  const id = node.dataset.ev, st = node.dataset.evs;
  const s = node.closest('[data-date]')?.dataset.date;
  // Ihopslagna block: leta upp gruppen igen så att detaljpanelen visar alla kalendrar
  const pool = s ? [...timedOn(s), ...allDayOn(s)] : merge(evs());
  return pool.find(e => e.id === id && e.start === st) || events().find(e => e.id === id && e.start === st) || events().find(e => e.id === id);
}

async function setDue(t, date) {
  if (t.due === date) return;
  const before = t.due;
  t.due = date; t.pending = true; emit('render');
  try { await api('updateTask', { listId: t.listId, taskId: t.id, due: date }, true, t._src); t.pending = false; emit('render'); toast(`Flyttad till ${shortDate(date)}`); }
  catch (err) { t.due = before; t.pending = false; emit('render'); toast('Kunde inte flytta – ' + err.message); }
}

// ---------- kortkommandon och sammanhang ----------
export function key(e, args) {
  const { mode, date } = state(args);
  const k = e.key.toLowerCase();
  if (k === 'q') { e.preventDefault(); return $('#kq')?.focus(); }
  if (k === 'b') return quickBlock();
  if (k === 'f') return findTime(slots?.len || 60);
  if (k === 'h') { setPref('k_hidewe', !hideWE()); return emit('render'); }
  if (k === 't') { scrollTop = null; return go(`kalender/${mode}/${todayStr()}`); }
  if (e.key === 'ArrowLeft') return go(`kalender/${mode}/${step(mode, date, -1)}`);
  if (e.key === 'ArrowRight') return go(`kalender/${mode}/${step(mode, date, 1)}`);
  if (k === 'g') return go(`kalender/dag/${date}`);
  if (k === 'v') return go(`kalender/vecka/${date}`);
  if (k === 'm') return go(`kalender/manad/${date}`);
  if (k === 'a') return go(`kalender/agenda/${date}`);
}

export function context(args) {
  const { mode, date } = state(args);
  const r = range(mode, date);
  const from = ymd(r.from), to = ymd(r.to);
  SHOWN = shownCals();
  const list = merge(evs()).filter(e => { const s = e.allDay ? e.start : ymd(new Date(e.start)); return s >= from && s < to; })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return [`Kalender ${mode} ${from} – ${ymd(addDays(r.to, -1))} (set: ${activeSet().name}):`, ...list.slice(0, 60).map(e => `- ${e.allDay ? e.start + ' heldag' : new Date(e.start).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}: ${e.title}${e.location ? ' (' + e.location + ')' : ''}`)].join('\n');
}
