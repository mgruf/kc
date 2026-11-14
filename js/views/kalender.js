/* KC – kalendern: dag, vecka och månad. Dra uppgifter in som tidsblock, dra händelser till ny tid, dra nederkanten för längd. */
import {
  S, api, emit, go, $, $$, esc, toast, ymd, parseYmd, addDays, todayStr, hhmm, shortDate, DAYS, MONTHS, week, monday,
  events, cfgProjects, tagColor, isDateTag, cleanTitle, modeCls, visible, ensureRange, WX, isFire,
} from '../core.js';
import { taskRow, section, timeBlock, moveEvent, openEvent, seg, empty } from '../ui.js';

const H = 48;                 // pixlar per timme
const SNAP = 15;              // minuter
const MODES = [['dag', 'Dag'], ['vecka', 'Vecka'], ['manad', 'Månad']];
let scrollTop = null;         // tidsrutnätets scroll mellan renders
let lastKey = '';

const isDesk = () => window.innerWidth >= 900;
function state(args) {
  const mode = MODES.some(m => m[0] === args[0]) ? args[0] : (isDesk() ? 'vecka' : 'dag');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args[1] || '') ? args[1] : todayStr();
  return { mode, date };
}
function range(mode, date) {
  const d = parseYmd(date);
  if (mode === 'dag') return { from: d, to: addDays(d, 1), days: [d] };
  if (mode === 'vecka') { const m = monday(d); return { from: m, to: addDays(m, 7), days: [...Array(7)].map((_, i) => addDays(m, i)) }; }
  const first = new Date(d.getFullYear(), d.getMonth(), 1), m = monday(first);
  return { from: m, to: addDays(m, 42), days: [...Array(42)].map((_, i) => addDays(m, i)), month: d.getMonth() };
}
const step = (mode, date, dir) => {
  const d = parseYmd(date);
  if (mode === 'dag') return ymd(addDays(d, dir));
  if (mode === 'vecka') return ymd(addDays(d, dir * 7));
  return ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1));
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- data per dag ----------
const minutesOf = iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
function timedOn(s) {
  return events().filter(e => !e.allDay).filter(e => {
    const a = ymd(new Date(e.start)), b = ymd(new Date(new Date(e.end).getTime() - 1));
    return a <= s && b >= s;
  });
}
const allDayOn = s => events().filter(e => e.allDay && e.start <= s && e.end > s);
const birthdaysOn = s => (S.data?.birthdays || []).filter(b => b.date === s);
const shootOn = s => cfgProjects().filter(visible).flatMap(p => (p.shootDays || []).filter(x => x.date === s).map(x => ({ p, x })));
const weatherOn = s => (S.weather?.days || []).find(w => w.date === s);
const tagOf = e => (e.tags || []).find(t => !isDateTag(t) && t !== '#PRIVAT');
const edge = e => { const t = tagOf(e); return t ? tagColor(t) : 'var(--ink-3)'; };

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

// ---------- rendering ----------
export function render(el, args) {
  const { mode, date } = state(args);
  const r = range(mode, date);
  if (S.data) ensureRange(ymd(r.from), ymd(r.to));
  const key = mode + date;
  const old = el.querySelector('.kscroll');
  if (old && lastKey === key) scrollTop = old.scrollTop;
  else if (lastKey !== key && lastKey.slice(0, 3) !== key.slice(0, 3)) scrollTop = null;
  lastKey = key;

  const d = parseYmd(date);
  const title = mode === 'dag' ? `${cap(DAYS[d.getDay()])} ${d.getDate()} ${MONTHS[d.getMonth()]}`
    : mode === 'vecka' ? `Vecka ${week(r.from)}`
    : `${cap(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
  const sub = mode === 'vecka' ? `${shortDate(ymd(r.from))} – ${shortDate(ymd(addDays(r.to, -1)))} ${r.from.getFullYear()}`
    : mode === 'dag' ? `Vecka ${week(d)}${date === todayStr() ? ' · idag' : ''}` : '';
  const nav = `<div class="knav"><button class="btn" data-kgo="prev" aria-label="Föregående">‹</button><button class="btn" data-kgo="today">Idag</button><button class="btn" data-kgo="next" aria-label="Nästa">›</button></div>`;
  const head = `<header class="vhead"><div><h1>${esc(title)}</h1>${sub ? `<div class="vsub">${esc(sub)}</div>` : ''}</div><div class="vact">${nav}${seg('kalmode', MODES, mode)}</div></header>`;

  let body;
  if (mode === 'manad') body = monthHtml(r, date);
  else {
    const strip = mode === 'dag' ? weekStrip(d) : '';
    body = `<div class="kwrap ${mode}">${strip ? `<div class="kstrip-wrap">${strip}</div>` : ''}<div class="kgridwrap">${gridHtml(r.days)}</div>${planHtml(r, mode)}</div>`;
  }
  el.innerHTML = `<div class="kal" data-mode="${mode}" data-date="${date}">${head}${body}</div>`;

  const sc = el.querySelector('.kscroll');
  if (sc) {
    if (scrollTop == null) {
      // Arbetsdagen i fokus: nu minus en timme om klockan är 7–18 och idag syns, annars dagens första händelse (högst 8).
      const h = new Date().getHours();
      const first = Math.min(...r.days.flatMap(x => timedOn(ymd(x)).map(e => ymd(new Date(e.start)) === ymd(x) ? new Date(e.start).getHours() : 24)), 8);
      const startH = r.days.some(x => ymd(x) === todayStr()) && h >= 7 && h <= 18 ? h - 1 : Math.max(0, Math.min(first, 8) - 1);
      scrollTop = startH * H;
    }
    sc.scrollTop = scrollTop;
  }
  bind();
}

function weekStrip(d) {
  const m = monday(d);
  return `<div class="kstrip">${[...Array(7)].map((_, i) => {
    const x = addDays(m, i), s = ymd(x);
    const n = timedOn(s).length + allDayOn(s).length;
    return `<a href="#/kalender/dag/${s}" class="${s === ymd(d) ? 'on' : ''} ${s === todayStr() ? 'today' : ''}"><span>${DAYS[x.getDay()].slice(0, 2)}</span><b>${x.getDate()}</b>${n ? '<i></i>' : '<i class="no"></i>'}</a>`;
  }).join('')}</div>`;
}

function dayHead(x) {
  const s = ymd(x), w = weatherOn(s);
  return `<div class="kdh ${s === todayStr() ? 'today' : ''}" data-date="${s}">
    <a href="#/kalender/dag/${s}"><span class="wd">${DAYS[x.getDay()].slice(0, 3)}</span><span class="dn">${x.getDate()}</span></a>
    ${w ? `<span class="wx" title="${esc(WX(w.code))} · ${Math.round(w.min)}°/${Math.round(w.max)}°">${Math.round(w.max)}°</span>` : ''}
  </div>`;
}

function allDayCell(x) {
  const s = ymd(x);
  const chips = [
    ...shootOn(s).map(({ p, x: sd }) => `<a class="kad shoot" style="--tc:${tagColor(p.tag)}" href="#/projekt/${encodeURIComponent(p.tag)}/produktion/dagar" title="${esc(p.name)} · inspelningsdag ${sd.day}${sd.hours ? ' · ' + esc(sd.hours) : ''}">Dag ${sd.day}${sd.note ? ' · ' + esc(sd.note) : ''}</a>`),
    ...allDayOn(s).map(e => `<div class="item kad ${modeCls(e.mode)} ${e.pending ? 'pending' : ''}" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}" style="--tc:${edge(e)}" title="${esc(e.title)}">${esc(cleanTitle(e.title))}</div>`),
    ...birthdaysOn(s).map(b => `<div class="kad bday" title="Fyller år">◦ ${esc(b.title)}</div>`),
  ];
  return `<div class="kac" data-date="${s}" data-allday="1">${chips.join('')}</div>`;
}

function gridHtml(days) {
  const cols = days.length;
  const hours = [...Array(24)].map((_, h) => `<div class="khr"><span>${h ? String(h).padStart(2, '0') : ''}</span></div>`).join('');
  const now = new Date(), nowS = todayStr(), nowM = now.getHours() * 60 + now.getMinutes();
  const colHtml = days.map(x => {
    const s = ymd(x);
    const items = layout(timedOn(s), s).map(({ e, a, b, col, n }) => {
      const top = a / 60 * H, h = Math.max(18, (b - a) / 60 * H - 2);
      const can = e.writable && !e.recurring && !String(e.id).startsWith('tmp');
      const short = h < 34;
      return `<div class="item kev ${modeCls(e.mode)} ${e.pending ? 'pending' : ''} ${can ? 'can' : ''} ${short ? 'short' : ''} ${new Date(e.end) < now ? 'past' : ''}" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}"
        style="top:${top}px;height:${h}px;left:calc(${col / n * 100}% + 2px);width:calc(${100 / n}% - 4px);--tc:${edge(e)}">
        <div class="kt">${esc(cleanTitle(e.title))}</div>${short ? '' : `<div class="km">${hhmm(e.start)}–${hhmm(e.end)}${e.location ? ' · ' + esc(e.location) : ''}</div>`}
        ${can ? '<div class="kres" title="Dra för att ändra längd"></div>' : ''}</div>`;
    }).join('');
    const nowLine = s === nowS ? `<div class="know" style="top:${nowM / 60 * H}px"></div>` : '';
    return `<div class="kcol ${s === nowS ? 'today' : ''} ${x.getDay() === 0 || x.getDay() === 6 ? 'we' : ''}" data-date="${s}">${items}${nowLine}</div>`;
  }).join('');
  return `<div class="kgrid" style="--cols:${cols}">
    <div class="khead"><div class="kgut">v.${week(days[0])}</div>${days.map(dayHead).join('')}</div>
    <div class="kallday"><div class="kgut">heldag</div>${days.map(allDayCell).join('')}</div>
    <div class="kscroll"><div class="kbody" style="height:${24 * H}px"><div class="khours">${hours}</div><div class="kcols">${colHtml}</div></div></div>
  </div>`;
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
  const sec = (id, title, list, extra = '') => list.length ? section('kp-' + id, title, list.length, list.slice(0, 40).map(x => taskRow(x, { noList: true })).join('') + (list.length > 40 ? `<p class="empty">+ ${list.length - 40} till</p>` : ''), extra) : '';
  const html = sec('over', 'Förfallna', over, 'fire') + sec('idag', 'Idag', today) + sec('period', mode === 'dag' ? 'Kommande vecka' : 'Den här veckan', period) + sec('utan', 'Utan datum', undated);
  return `<aside class="kplan"><div class="kplan-h"><b>Att planera</b><span>Dra in i kalendern</span></div>${html || empty('Inget att planera.')}</aside>`;
}

function monthHtml(r, date) {
  const t = todayStr();
  const head = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'].map(x => `<div class="kmh">${x}</div>`).join('');
  let cells = '';
  for (let w = 0; w < 6; w++) {
    const wd = r.days.slice(w * 7, w * 7 + 7);
    cells += `<div class="kmw">${week(wd[0])}</div>`;
    cells += wd.map(x => {
      const s = ymd(x);
      const evs = [...allDayOn(s), ...timedOn(s).sort((a, b) => a.start.localeCompare(b.start))];
      const shoot = shootOn(s);
      const lines = [
        ...shoot.map(({ p, x: sd }) => `<div class="kml shoot" style="--tc:${tagColor(p.tag)}">Dag ${sd.day}</div>`),
        ...evs.map(e => `<div class="kml ${modeCls(e.mode)}" style="--tc:${edge(e)}">${e.allDay ? '' : `<span>${hhmm(e.start)}</span>`}${esc(cleanTitle(e.title))}</div>`),
      ];
      const tasksDue = (S.data?.tasks || []).filter(visible).filter(x => x.due === s && !S.done[x.id]).length;
      return `<a class="kmc ${x.getMonth() !== r.month ? 'out' : ''} ${s === t ? 'today' : ''} ${x.getDay() === 0 || x.getDay() === 6 ? 'we' : ''}" href="#/kalender/dag/${s}" data-date="${s}" data-mday="1">
        <div class="kmd"><b>${x.getDate()}</b>${tasksDue ? `<span class="kmt" title="${tasksDue} uppgifter">${tasksDue}</span>` : ''}</div>
        ${lines.slice(0, 4).join('')}${lines.length > 4 ? `<div class="kml more">+ ${lines.length - 4}</div>` : ''}</a>`;
    }).join('');
  }
  return `<div class="kmonth"><div class="kmw h"></div>${head}${cells}</div>`;
}

// ---------- interaktion ----------
const snapMin = m => Math.max(0, Math.min(24 * 60 - SNAP, Math.round(m / SNAP) * SNAP));
const fmtMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function minAt(col, clientY) { const r = col.getBoundingClientRect(); return (clientY - r.top) / H * 60; }
function colAt(x, y) { const el = document.elementFromPoint(x, y); return el?.closest?.('.kal .kcol'); }

let bound = false, drag = null, suppressClick = false;
function bind() {
  if (bound) return; bound = true;

  // Navigering
  document.addEventListener('click', e => {
    const k = e.target.closest('.kal');
    if (!k) return;
    const mode = k.dataset.mode, date = k.dataset.date;
    const g = e.target.closest('[data-kgo]');
    if (g) { const v = g.dataset.kgo; scrollTop = null; return go(`kalender/${mode}/${v === 'today' ? todayStr() : step(mode, date, v === 'next' ? 1 : -1)}`); }
    const sg = e.target.closest('[data-segname="kalmode"] [data-seg]');
    if (sg) return go(`kalender/${sg.dataset.seg}/${date}`);
  });

  // Klick i tom tid → ny händelse. Undertryck klick direkt efter drag.
  document.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
    const col = e.target.closest('.kal .kcol');
    if (!col || e.target.closest('.kev')) return;
    const m = snapMin(minAt(col, e.clientY) - SNAP / 2);
    openEvent(null, null, { date: col.dataset.date, time: fmtMin(m), endTime: fmtMin(Math.min(24 * 60 - 1, m + 60)) });
  }, true);

  // Dra händelser (flytta) och nederkant (längd)
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const ev = e.target.closest('.kal .kev.can');
    if (!ev) return;
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
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'kghost';
      drag.el.classList.add('dragging');
    }
    e.preventDefault();
    if (drag.resize) {
      const col = drag.el.closest('.kcol');
      const end = snapMin(minAt(col, e.clientY));
      drag.len = Math.max(SNAP, end - drag.startMin);
      placeGhost(col, drag.startMin, drag.len);
    } else {
      const col = colAt(e.clientX, e.clientY) || drag.el.closest('.kcol');
      drag.date = col.dataset.date;
      drag.min = snapMin(minAt(col, e.clientY) - drag.offset);
      placeGhost(col, drag.min, drag.dur);
    }
  });
  const end = async () => {
    if (!drag) return;
    const d = drag; drag = null;
    d.el.classList.remove('dragging'); d.ghost?.remove();
    if (!d.moved) return;
    suppressClick = true; setTimeout(() => suppressClick = false, 300);
    if (d.resize) { if (d.len !== d.dur) await moveEvent(d.evt, ymd(new Date(d.evt.start)), hhmm(d.evt.start), d.len); }
    else if (d.min !== d.startMin || d.date !== ymd(new Date(d.evt.start))) await moveEvent(d.evt, d.date, fmtMin(d.min));
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => { if (drag) { drag.el.classList.remove('dragging'); drag.ghost?.remove(); drag = null; } });

  // Släpp uppgifter: på tid → tidsblock, på heldag/månadsdag → datum
  const taskDrag = e => [...(e.dataTransfer?.types || [])].includes('text/kc-task');
  document.addEventListener('dragover', e => {
    if (!taskDrag(e)) return;
    const col = e.target.closest?.('.kal .kcol');
    const day = e.target.closest?.('.kal [data-allday], .kal [data-mday]');
    if (!col && !day) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    $$('.kal .dropzone').forEach(x => x !== day && x.classList.remove('dropzone'));
    if (col) placeGhost(col, snapMin(minAt(col, e.clientY) - SNAP), 60, true);
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
    if (col) { const m = snapMin(minAt(col, e.clientY) - SNAP); await timeBlock(t, col.dataset.date, fmtMin(m), 60); }
    else await setDue(t, day.dataset.date);
  });

  // Nu-linjen följer klockan
  setInterval(() => {
    const n = $('.kal .know'); if (!n) return;
    const now = new Date(); n.style.top = (now.getHours() * 60 + now.getMinutes()) / 60 * H + 'px';
  }, 60e3);
  // Spara scroll löpande
  document.addEventListener('scroll', e => { if (e.target.classList?.contains('kscroll')) scrollTop = e.target.scrollTop; }, true);
}

let taskGhost = null;
function placeGhost(col, min, len, forTask) {
  let g = forTask ? taskGhost : drag?.ghost;
  if (!g) { g = document.createElement('div'); g.className = 'kghost'; if (forTask) taskGhost = g; }
  if (g.parentElement !== col) col.appendChild(g);
  g.style.top = min / 60 * H + 'px';
  g.style.height = Math.max(18, len / 60 * H - 2) + 'px';
  g.textContent = `${fmtMin(min)}–${fmtMin(Math.min(24 * 60, min + len))}`;
}
function clearDrop() { taskGhost?.remove(); taskGhost = null; $$('.kal .dropzone').forEach(x => x.classList.remove('dropzone')); }

function findEv(node) {
  const id = node.dataset.ev, st = node.dataset.evs;
  return events().find(e => e.id === id && e.start === st) || events().find(e => e.id === id);
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
  if (k === 't') { scrollTop = null; return go(`kalender/${mode}/${todayStr()}`); }
  if (e.key === 'ArrowLeft') return go(`kalender/${mode}/${step(mode, date, -1)}`);
  if (e.key === 'ArrowRight') return go(`kalender/${mode}/${step(mode, date, 1)}`);
  if (k === 'g') return go(`kalender/dag/${date}`);
  if (k === 'v') return go(`kalender/vecka/${date}`);
  if (k === 'm') return go(`kalender/manad/${date}`);
}

export function context(args) {
  const { mode, date } = state(args);
  const r = range(mode, date);
  const from = ymd(r.from), to = ymd(r.to);
  const evs = events().filter(e => { const s = e.allDay ? e.start : ymd(new Date(e.start)); return s >= from && s < to; })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return [`Kalender ${mode} ${from} – ${ymd(addDays(r.to, -1))}:`, ...evs.slice(0, 60).map(e => `- ${e.allDay ? e.start + ' heldag' : new Date(e.start).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}: ${e.title}${e.location ? ' (' + e.location + ')' : ''}`)].join('\n');
}
