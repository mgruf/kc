/* IDAG – startsidan. */
import {
  S, api, emit, $, esc, toast, ymd, parseYmd, addDays, todayStr, week, hhmm, DAYS, MONTHS, shortDate, dayLabel,
  tasks, events, notes, evOnDay, tagDate, fireList, cfgProjects, visible, projects, WX, modeCls, tagHtml, refresh, monday,
} from '../core.js';
import { taskRow, eventRow, noteRow, section, empty } from '../ui.js';

function warnRow(w, p) {
  return `<a class="item fire ${modeCls(p.mode)}" href="${esc(w.url || '#/projekt/' + encodeURIComponent(p.tag))}"><div class="glyph" style="color:var(--fire)">!</div><div class="main">
    <div class="title">${esc(w.name)}<span class="tags">${tagHtml([p.tag])}</span></div>
    <div class="sub"><span class="due" style="color:var(--fire)">${esc(w.text || '')}</span></div></div></a>`;
}

function shootLine(p, d, isToday) {
  const s = p.shoot;
  return `<a class="item" href="#/projekt/${encodeURIComponent(p.tag)}/produktion/dagar/${d.date}"><div class="time">Dag ${d.day}</div><div class="main">
    <div class="title">${esc(d.note || 'Inspelning')}<span class="tags">${tagHtml([p.tag])}</span></div>
    <div class="sub"><span>${isToday ? 'Idag' : esc(dayLabel(d.date))}</span><i class="sep">·</i><span>${esc(d.hours || '')}</span>${d.strips ? `<i class="sep">·</i><span>${d.strips} scener</span>` : ''}<i class="sep">·</i><span>${s.doneDays}/${s.totalDays}</span></div></div></a>`;
}

const dailyTitle = t => (S.data?.notes || []).find(n => (n.tags || []).includes('#' + t.slice(2).replace(/-/g, '')) && /^dag\b/i.test(n.title));

export function render(el) {
  const now = new Date(), t = todayStr();
  const q = window.KC_QUOTES || [];
  const qi = q.length ? q[Math.floor((parseYmd(t) - new Date(2026, 0, 1)) / 864e5) % q.length] : null;
  const w = S.weather;
  const bdays = (S.data?.birthdays || []).filter(b => b.date === t);
  let html = `<div class="hero">
    <div class="hday">${DAYS[now.getDay()][0].toUpperCase() + DAYS[now.getDay()].slice(1)}</div>
    <div class="hdate">${now.getDate()} ${MONTHS[now.getMonth()]} · vecka ${week(now)}</div>
    <div class="hmeta">${w ? `<span><b class="num">${Math.round(w.temp)}°</b> ${WX(w.code)}, ${Math.round(w.min)}°/${Math.round(w.max)}°${w.place ? ' i ' + esc(w.place) : ''}</span>` : ''}${bdays.length ? `<span>Fyller år: ${bdays.map(b => esc(b.title)).join(', ')}</span>` : ''}</div>
    ${qi ? `<blockquote class="quote"><p>${esc(qi[0])}</p><cite>${esc(qi[1])}</cite></blockquote>` : ''}
  </div>
  ${pinsHtml()}`;
  if (!S.data) { el.innerHTML = html + empty('Ingen data än. Håll inne på tiden uppe till vänster (eller Mer → Koppla källor) för att koppla KC.'); return; }

  const fire = fireList();
  const all = tasks();
  const todayTasks = all.filter(x => x.due === t);
  const mon = monday(now), sun = ymd(addDays(mon, 6));
  const weekTasks = all.filter(x => x.due && x.due > t && x.due <= sun).sort((a, b) => a.due.localeCompare(b.due));
  const undated = all.filter(x => !x.due && !x.waiting);
  const evs = events().filter(e => evOnDay(e, t));
  const tom = ymd(addDays(now, 1));
  const evsTom = events().filter(e => evOnDay(e, tom));
  const dnotes = notes().filter(n => (n.tags || []).some(g => tagDate(g) === t));
  const daily = dailyTitle(t);
  const recent = notes().slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified))).slice(0, 5);

  let left = '';
  if (fire.length) left += section('fire', 'Det som brinner', fire.length, fire.map(f => f.kind === 'task' ? taskRow(f.t) : warnRow(f.w, f.p)).join(''), 'fire');
  left += section('tasks', 'Att göra idag', todayTasks.length, todayTasks.length ? todayTasks.map(x => taskRow(x)).join('') : empty('Inget med datum idag.'), '', '<a class="act btn" href="#/kalender/dag/' + t + '">Planera dagen</a>');
  if (weekTasks.length) left += section('week', 'Resten av veckan', weekTasks.length, weekTasks.map(x => taskRow(x)).join(''));
  if (undated.length) left += section('undated', 'Utan datum', undated.length, undated.slice(0, 40).map(x => taskRow(x)).join('') + (undated.length > 40 ? `<a class="more-link" href="#/uppgifter">Alla ${undated.length} i Uppgifter</a>` : ''));

  let right = section('cal', 'Kalender', evs.length, evs.length ? evs.map(e => eventRow(e)).join('') : empty('Inget i kalendern.'), '', '<a class="act btn" href="#/kalender">Vecka</a>');
  const shoots = cfgProjects().filter(visible).filter(p => p.shoot && (p.shoot.today || p.shoot.next));
  if (shoots.length) right += section('shoot', 'Inspelning', null, shoots.map(p => shootLine(p, p.shoot.today || p.shoot.next, !!p.shoot.today) + (p.callsheet ? `<div class="sub" style="padding:0 0 8px 66px"><a class="mchip" style="margin:0" href="${esc(p.callsheet.url)}" target="_blank" rel="noopener">Senaste callsheet</a></div>` : '')).join(''));
  if (evsTom.length) right += section('tom', 'Imorgon', evsTom.length, evsTom.map(e => eventRow(e)).join(''));
  right += section('daily', 'Dagsanteckning', null, daily
    ? `<a class="dailycard" href="#/anteckning/${encodeURIComponent(daily.id)}"><b>${esc(daily.title)}</b><span>${esc(daily.excerpt || '').slice(0, 220)}</span></a>`
    : `<div class="dailycard empty-card"><span>Ingen anteckning för idag än.</span><button class="btn" data-daily>Skapa i Notes</button></div>`);
  if (dnotes.length) right += section('dnotes', 'Taggat idag', dnotes.length, dnotes.map(noteRow).join(''));
  right += section('recent', 'Senast ändrat', null, recent.map(noteRow).join(''));

  el.innerHTML = html + `<div class="idag-grid"><div>${left}</div><div>${right}</div></div>`;
  if (S.closed.undated === undefined) { S.closed.undated = true; el.querySelector('[data-sec="undated"]')?.classList.add('closed'); }
  if (S.closed.recent === undefined) { S.closed.recent = false; }
  el.querySelector('[data-daily]')?.addEventListener('click', makeDaily);
  bindPins(el);
}

async function makeDaily(e) {
  e.target.disabled = true;
  try { const r = await api('dailyNote', { date: todayStr() }, true); toast(r.exists ? 'Finns redan' : 'Köad – skapas i Notes inom 5 min'); }
  catch (err) { toast('Kunde inte skapa – ' + err.message); e.target.disabled = false; }
}

// ---------- fästa genvägar ----------
function pinsHtml() {
  const pins = S.data?.pins || [];
  return `<div class="pins">${pins.map((p, i) => `<a class="pin" href="${esc(p.url)}" target="_blank" rel="noopener" data-pin="${i}">${esc(p.name)}</a>`).join('')}<button class="pin add" data-addpin title="Fäst en genväg">+</button></div>`;
}
let pinT;
function bindPins(el) {
  el.querySelector('[data-addpin]')?.addEventListener('click', addPin);
  el.querySelectorAll('[data-pin]').forEach(a => {
    a.addEventListener('pointerdown', () => pinT = setTimeout(() => removePin(Number(a.dataset.pin)), 650));
    a.addEventListener('pointerup', () => clearTimeout(pinT));
    a.addEventListener('contextmenu', e => { e.preventDefault(); removePin(Number(a.dataset.pin)); });
  });
}
async function addPin() {
  const url = prompt('Klistra in länken du vill fästa:'); if (!url) return;
  const name = prompt('Kort namn:', ''); if (!name) return;
  const pins = [...(S.data.pins || []), { name, url }];
  S.data.pins = pins; emit('render');
  try { await api('setPins', { pins }, true); } catch { toast('Kunde inte spara'); }
}
async function removePin(i) {
  const p = (S.data.pins || [])[i]; if (!p || !confirm(`Ta bort "${p.name}"?`)) return;
  const pins = S.data.pins.filter((_, j) => j !== i); S.data.pins = pins; emit('render');
  try { await api('setPins', { pins }, true); } catch { toast('Kunde inte spara'); }
}

export function context() {
  if (!S.data) return '';
  const t = todayStr(), lines = [`Idag ${t}.`];
  fireList().forEach(x => lines.push(`- Brinner: ${x.ctx}`));
  tasks().filter(x => x.due === t).forEach(x => lines.push(`- Att göra: ${x.title}`));
  events().filter(e => evOnDay(e, t)).forEach(e => lines.push(`- ${e.allDay ? 'Heldag' : hhmm(e.start)}: ${e.title}`));
  return lines.join('\n');
}
