/* IDAG – dashboarden. Widgets i ett rutnät som man väljer, flyttar och storleksändrar själv (Anpassa).
   Layouten sparas i Apps Script under '_IDAG' och följer med mellan dator och telefon. */
import {
  S, api, emit, refresh, $, esc, toast, ymd, parseYmd, addDays, todayStr, week, hhmm, DAYS, MONTHS, shortDate, dayLabel, monday, relTime,
  tasks, events, notes, evOnDay, tagDate, fireList, cfgProjects, visible, projects, WX, modeCls, tagHtml, tagColor, isFire, isWaitingLong, waitedDays,
  cleanTitle, contactOf, initials, firstName, claudeUrl, SHOOT_EV, isShootDup,
} from '../core.js';
import { taskRow, eventRow, noteRow, empty, pref, setPref, openTask } from '../ui.js';

let parseQuick = null, PLAN = null;
import('../plan.js').then(m => { PLAN = m; emit('render'); }).catch(() => {});
import('../quickparse.js').then(m => { parseQuick = m.parseQuick; }).catch(() => {});

// ---------- widgetkatalog ----------
const W = {
  greet:      { title: 'Dagen', size: 'xl', bare: true },
  capture:    { title: 'Fånga', size: 's' },
  focus:      { title: 'Fokus', size: 's' },
  fire:       { title: 'Det som brinner', size: 's' },
  next:       { title: 'Härnäst', size: 's' },
  agenda:     { title: 'Dagens schema', size: 'l' },
  tasks:      { title: 'Uppgifter', size: 'l' },
  week:       { title: 'Veckan', size: 'xl' },
  projects:   { title: 'Projekt', size: 'xl' },
  shoot:      { title: 'Inspelning', size: 's', when: () => cfgProjects().some(p => p.shoot) },
  waiting:    { title: 'Väntar på', size: 's' },
  stats:      { title: 'Läget', size: 'l' },
  milestones: { title: 'Milstolpar', size: 'l' },
  notes:      { title: 'Anteckningar', size: 'l' },
  links:      { title: 'Snabblänkar', size: 's' },
  weather:    { title: 'Väder', size: 's' },
  contact:    { title: 'Att kontakta', size: 's' },
  mail:       { title: 'Mejl', size: 's' },
  capacity:   { title: 'Kapacitet', size: 's' },
  delegated:  { title: 'Delegerat', size: 's' },
};
// Ordningen är också ordningen på mobilen. S = sidokolumnen, L = huvudkolumnen, XL = hela bredden.
const DEFAULT = ['greet', 'capture', 'fire', 'agenda', 'next', 'tasks', 'shoot', 'mail', 'focus', 'waiting', 'delegated', 'capacity', 'milestones', 'notes', 'week', 'projects', 'stats', 'links'];
const zone = sz => sz === 'xl' ? 'full' : sz === 's' ? 'side' : 'main';
const SIZE_LABEL = { s: 'Sida', m: 'Huvud', l: 'Huvud', xl: 'Bred' };
// Tomma "lugna" widgets slås ihop till en rad i stället för att ta plats var för sig.
const CALM = {
  fire: () => !fireList().length && 'Inget brinner',
  focus: () => !tasks().some(x => /FOKUS/i.test(x.list) || (x.tags || []).includes('#FOKUS') || x.due === todayStr()) && 'Fokus är tomt',
  waiting: () => !tasks().some(x => x.waiting) && 'Du väntar inte på någon',
  delegated: () => PLAN && !PLAN.delegated().length && 'Inget delegerat',
  contact: () => !tasks().some(x => /KONTAKTA|SVARA/i.test(x.list)) && 'Ingen att kontakta',
};
let editing = false;

function layout() {
  const saved = (S.data?.layouts || {})['_IDAG'];
  if (saved?.length) return saved.filter(w => W[w.id]);
  return DEFAULT.filter(id => !W[id].when || W[id].when()).map(id => ({ id, size: W[id].size }));
}
const setLayout = l => { (S.data.layouts ||= {})['_IDAG'] = l; emit('render'); };

export function render(el) {
  if (!S.data) {
    el.innerHTML = `<div class="dboard">${greet()}</div>` + empty('Ingen data än. Håll inne på tiden uppe till vänster (eller Mer → Koppla källor) för att koppla KC.');
    return;
  }
  const l = layout(), used = new Set(l.map(w => w.id));
  const free = Object.keys(W).filter(id => !used.has(id) && (!W[id].when || W[id].when()));
  const calm = [];
  const cell = (w, i) => {
    if (!editing && CALM[w.id]) { const c = CALM[w.id](); if (c) { calm.push(c); return calm.length === 1 ? '<!--calm-->' : ''; } }
    return `<section class="dw sz-${w.size} ${W[w.id].bare ? 'bare' : ''} dw-${w.id}" data-w="${i}" draggable="${editing}" style="order:${i}">
      <div class="wtools"><button data-wmove="-1" aria-label="Flytta bakåt">‹</button><button data-wsize aria-label="Placering" title="Sida, huvudkolumn eller hela bredden">${SIZE_LABEL[w.size] || 'Huvud'}</button><button data-wmove="1" aria-label="Flytta framåt">›</button><button data-wremove aria-label="Ta bort">×</button></div>
      ${W[w.id].bare ? '' : `<h4>${esc(W[w.id].title)}${headExtra(w.id)}</h4>`}${safe(w.id, w.size)}</section>`;
  };
  // Band: en XL-widget är ett eget band; övriga samlas i två kolumner (huvud + sida) tills nästa XL.
  const bands = []; let band = null;
  l.forEach((w, i) => {
    if (zone(w.size) === 'full') { band = null; bands.push({ full: cell(w, i) }); return; }
    if (!band) bands.push(band = { main: [], side: [] });
    band[zone(w.size)].push(cell(w, i));
  });
  const calmHtml = calm.length ? `<section class="dw dw-calm" style="order:999"><span class="calm-ok">✓</span> ${calm.map(esc).join(' · ')}</section>` : '';
  const fill = x => x.replace('<!--calm-->', calmHtml);
  el.innerHTML = `<div class="dboard ${editing ? 'editing' : ''}">
    ${bands.map(b => b.full != null ? `<div class="dband full">${fill(b.full)}</div>` : `<div class="dband ${b.side.join('').trim() ? '' : 'noside'} ${b.main.join('').trim() ? '' : 'nomain'}"><div class="dcol dmain">${fill(b.main.join(''))}</div><div class="dcol dside">${fill(b.side.join(''))}</div></div>`).join('')}
    ${editing && free.length ? `<div class="dband full"><section class="dw addw"><h4>Lägg till widget</h4><div class="chips">${free.map(id => `<button class="chip" data-wadd="${id}">${esc(W[id].title)}</button>`).join('')}</div></section></div>` : ''}
    <div class="dtools"><button class="btn ${editing ? 'solid' : ''}" data-dedit>${editing ? 'Klar' : 'Anpassa Idag'}</button>${editing ? '<span class="hint">Flytta med ‹ › eller dra. Placering: Sida, Huvud eller Bred. × tar bort.</span>' : ''}</div>
  </div>`;
  bind(el);
}
function safe(id, size) { try { return widget(id, size); } catch (e) { console.error(e); return empty('Kunde inte visa: ' + esc(e.message)); } }

function headExtra(id) {
  if (id === 'tasks') { const t = pref('d_tasks', 'idag'); return `<span class="dtabs">${[['idag', 'Idag'], ['vecka', 'Veckan'], ['forsenat', 'Försenat'], ['utan', 'Utan datum']].map(([k, l]) => `<button data-dtab="${k}" class="${k === t ? 'on' : ''}">${l}</button>`).join('')}</span>`; }
  if (id === 'week') return `<a class="hlink" href="#/kalender/vecka">Kalender →</a>`;
  if (id === 'projects') return `<a class="hlink" href="#/projekt">Alla →</a>`;
  if (id === 'notes') return `<a class="hlink" href="#/anteckningar">Alla →</a>`;
  return '';
}

// ---------- widgets ----------
function widget(id, size) {
  const t = todayStr(), now = new Date();
  switch (id) {
    case 'greet': return greet();
    case 'capture': {
      const inbox = tasks().filter(x => /INBOX/i.test(x.list));
      return `<form class="capture" data-capture><input placeholder="Skriv något – ”ring Kim imorgon #PROJ”" autocomplete="off" aria-label="Fånga"><button aria-label="Lägg till">↵</button></form>
        <div class="cap-prev" data-capprev></div>
        <div class="cap-meta"><a href="#/uppgifter">Inkorgen: <b>${inbox.length}</b></a></div>
        ${inbox.slice(-3).reverse().map(x => `<div class="mini" data-task="${esc(x.id)}">${esc(cleanTitle(x.title))}</div>`).join('')}`;
    }
    case 'focus': {
      const f = tasks().filter(x => /FOKUS/i.test(x.list) || (x.tags || []).includes('#FOKUS'))
        .sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 5);
      const extra = f.length < 3 ? tasks().filter(x => x.due === t && !f.includes(x)).slice(0, 3 - f.length) : [];
      const all = [...f, ...extra];
      return all.length ? `<div class="focus">${all.map(x => `<div class="fitem item task ${S.done[x.id] ? 'done' : ''}" data-task="${esc(x.id)}"><button class="check" aria-label="Bocka av"></button><div class="main"><div class="title">${esc(cleanTitle(x.title))}</div>${x.due ? `<div class="sub"><span class="due ${isFire(x) ? 'firetext' : ''}">${esc(dayLabel(x.due))}</span></div>` : ''}</div></div>`).join('')}</div>`
        : empty('Lägg uppgifter i listan FOKUS eller tagga #FOKUS.');
    }
    case 'fire': {
      const f = fireList();
      return f.length ? f.slice(0, 8).map(x => x.kind === 'task' ? taskRow(x.t) : x.kind === 'mail' ? `<a class="item fire" href="${esc(x.t.url)}"><div class="glyph" style="color:var(--fire)">✉</div><div class="main"><div class="title">${esc(x.t.subject)}</div><div class="sub">Inget svar på ${x.t.days ?? '?'} dagar · ${esc(x.t.to || x.t.toEmail || '')}</div></div></a>` : x.t && x.kind !== 'warn' ? (x.html || taskRow(x.t)) : `<a class="item fire" href="${esc(x.w.url || '#/projekt/' + encodeURIComponent(x.p.tag))}"><div class="glyph" style="color:var(--fire)">!</div><div class="main"><div class="title">${esc(x.w.name)}</div><div class="sub">${esc(x.p.name)}</div></div></a>`).join('') + (f.length > 8 ? `<a class="more-link" href="#/uppgifter/forsenade">${f.length - 8} till</a>` : '')
        : `<div class="calm">Inget brinner. ✓</div>`;
    }
    case 'next': {
      const up = events().filter(e => !e.allDay && new Date(e.end) > now && !isShootDup(e)).sort((a, b) => a.start.localeCompare(b.start));
      const cur = up.find(e => new Date(e.start) <= now), nx = up.find(e => new Date(e.start) > now);
      const mins = nx ? Math.round((new Date(nx.start) - now) / 60e3) : 0;
      const when = m => m < 60 ? `om ${m} min` : m < 24 * 60 ? `om ${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}` : dayLabel(ymd(new Date(nx.start))) + ' ' + hhmm(nx.start);
      const video = e => (/(https?:\/\/[^\s]*(meet\.google|zoom\.us|teams\.microsoft)[^\s]*)/.exec((e.location || '') + ' ' + (e.description || '')) || [])[1];
      const block = (e, label) => `<div class="nx item event" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}"><div class="main"><div class="nx-l">${label}</div><div class="nx-t">${esc(cleanTitle(e.title))}</div><div class="sub">${hhmm(e.start)}–${hhmm(e.end)}${e.location ? '<i class="sep">·</i>' + esc(e.location) : ''}</div>${video(e) ? `<a class="btn solid nx-join" href="${esc(video(e))}" target="_blank" rel="noopener">Anslut</a>` : ''}</div></div>`;
      // Inspelningsdag (idag/imorgon) räknas som nästa sak om den börjar före nästa händelse
      const sd = cfgProjects().filter(visible).flatMap(p => (p.shootDays || []).map(d => ({ p, d })))
        .map(x => { const m = /(\d{1,2})[:.](\d{2})\s*[–-]\s*(\d{1,2})[:.](\d{2})/.exec(x.d.hours || ''); const st = parseYmd(x.d.date), en = parseYmd(x.d.date); if (m) { st.setHours(+m[1], +m[2]); en.setHours(+m[3], +m[4]); } else { st.setHours(7); en.setHours(19); } return { ...x, st, en }; })
        .filter(x => x.en > now).sort((a, b) => a.st - b.st)[0];
      const shootBlock = x => `<a class="nx item" href="#/projekt/${encodeURIComponent(x.p.tag)}/produktion/dagar/${x.d.date}" style="--tc:${tagColor(x.p.tag)}"><div class="main"><div class="nx-l">${x.st <= now ? 'Pågår nu' : x.d.date === t ? 'idag ' + hhmm(x.st.toISOString()) : dayLabel(x.d.date) + ' ' + hhmm(x.st.toISOString())}</div><div class="nx-t">Inspelning dag ${x.d.day}</div><div class="sub">${esc([x.d.note, x.d.hours, x.p.name].filter(Boolean).join(' · '))}</div></div></a>`;
      const useShoot = sd && (sd.st - now) < 36 * 36e5 && (!nx || sd.st <= new Date(nx.start) || sd.st <= now);
      return (cur ? block(cur, 'Pågår nu') : '') + (useShoot ? shootBlock(sd) : '') + (nx && !(useShoot && cur) ? block(nx, when(mins)) : '') || `<div class="calm">Inget mer i kalendern idag.</div>`;
    }
    case 'agenda': return agenda();
    case 'tasks': {
      const tab = pref('d_tasks', 'idag');
      const mon = monday(now), sun = ymd(addDays(mon, 6));
      const list = tab === 'vecka' ? tasks().filter(x => x.due && x.due >= t && x.due <= sun) :
        tab === 'forsenat' ? tasks().filter(isFire) : tab === 'utan' ? tasks().filter(x => !x.due && !x.waiting) : tasks().filter(x => x.due === t);
      list.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
      return `<div class="dlist">${list.slice(0, 12).map(x => taskRow(x)).join('') || empty('Inget här.')}</div>${list.length > 12 ? `<a class="more-link" href="#/uppgifter">Alla ${list.length}</a>` : ''}<button class="addrow" data-dnewtask>+ Ny uppgift</button>`;
    }
    case 'week': return weekStrip();
    case 'projects': {
      const ps = projects().filter(visible).filter(p => p.cfg || p.tasks.length).slice(0, 8);
      return `<div class="dproj">${ps.map(p => {
        const sh = p.cfg?.shoot, open = p.tasks.length;
        const next = nextMs(p);
        const pct = sh ? Math.round(sh.doneDays / sh.totalDays * 100) : null;
        return `<a class="dp" href="#/projekt/${encodeURIComponent(p.tag)}" style="--tc:${tagColor(p.tag)}">
          <div class="dp-top"><span class="dp-tag">${esc(p.tag.slice(1))}</span>${p.fire.length ? `<span class="dp-fire">${p.fire.length}</span>` : ''}</div>
          <div class="dp-name">${esc(p.name)}</div><div class="dp-phase">${esc((S.data.summaries?.[p.tag] || '').split('\n')[0] || p.cfg?.phase || '')}</div>
          ${pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="dp-s">Dag ${sh.doneDays}/${sh.totalDays} · ${sh.filmed}/${sh.scenes} scener</div>` : ''}
          <div class="dp-s">${open} uppgifter${next ? ` · ${esc(next.name)} ${esc(dayLabel(next.date))}` : ''}</div></a>`;
      }).join('')}</div>`;
    }
    case 'shoot': {
      const ps = cfgProjects().filter(visible).filter(p => p.shoot);
      return ps.map(p => {
        const s = p.shoot, d = s.today || s.next;
        return `<a class="shootw" href="#/projekt/${encodeURIComponent(p.tag)}/produktion${d ? '/dagar/' + d.date : ''}">
          <div class="big"><span class="num">${s.doneDays}</span><span class="of">av ${s.totalDays} dagar · ${esc(p.name)}</span></div>
          <div class="bar"><i style="width:${Math.round(s.doneDays / s.totalDays * 100)}%"></i></div>
          ${d ? `<div class="kv"><span>${s.today ? 'Idag' : esc(dayLabel(d.date))} · Dag ${d.day}</span><b>${esc(d.note || '')}</b></div><div class="kv"><span>Tider</span><b>${esc(d.hours || '')}</b></div>` : '<div class="kv"><span>Inspelningen är klar</span></div>'}
          <div class="kv"><span>Filmat</span><b>${s.filmed}/${s.scenes}</b></div>${s.restad ? `<div class="kv"><span>Restat</span><b class="firetext">${s.restad}</b></div>` : ''}</a>`
          + (p.callsheet ? `<a class="more-link" href="${esc(p.callsheet.url)}" target="_blank" rel="noopener">Senaste callsheet</a>` : '');
      }).join('');
    }
    case 'waiting': {
      const w = tasks().filter(x => x.waiting).sort((a, b) => waitedDays(b) - waitedDays(a));
      return w.length ? w.slice(0, 8).map(x => { const c = contactOf(x); return `<div class="witem item task ${isWaitingLong(x) ? 'fire' : ''}" data-task="${esc(x.id)}"><div class="main"><div class="title">${esc(cleanTitle(x.title))}</div><div class="sub">${c ? esc(c.name) + '<i class="sep">·</i>' : ''}<span class="due">${waitedDays(x)} dagar</span></div></div></div>`; }).join('') : `<div class="calm">Du väntar inte på någon.</div>`;
    }
    case 'stats': {
      const mon = monday(now), monS = ymd(mon), sunS = ymd(addDays(mon, 6));
      const doneWeek = (S.data.doneTasks || []).filter(x => x.completed && ymd(new Date(x.completed)) >= monS).filter(visible).length;
      const meet = events().filter(e => !e.allDay && evDay(e) >= monS && evDay(e) <= sunS).reduce((s, e) => s + (new Date(e.end) - new Date(e.start)) / 36e5, 0);
      const open = tasks().length, over = tasks().filter(isFire).length;
      return `<div class="stats">
        <div><b class="num">${doneWeek}</b><span>klara i veckan</span></div>
        <div><b class="num">${open}</b><span>öppna</span></div>
        <div><b class="num ${over ? 'firetext' : ''}">${over}</b><span>försenade</span></div>
        <div><b class="num">${Math.round(meet)}</b><span>tim möten resten av veckan</span></div></div>`;
    }
    case 'milestones': {
      const items = cfgProjects().filter(visible).flatMap(p => [
        ...(p.deadlines || []).map(x => ({ d: x.date, n: x.name, p })), ...(p.phases || []).filter(x => x.milestone).map(x => ({ d: x.start, n: (x.film ? 'F' + x.film + ' ' : '') + x.name, p })),
        ...(p.shoot?.lastDay ? [{ d: p.shoot.lastDay, n: 'Sista inspelningsdag', p }] : []),
      ]).filter(x => x.d >= t).sort((a, b) => a.d.localeCompare(b.d))
        .filter((x, i, a) => a.findIndex(y => y.d === x.d && y.p === x.p && (y.n === x.n || y.n.replace(/^F\d /, '') === x.n.replace(/^F\d /, '') && /^F\d /.test(y.n) !== /^F\d /.test(x.n))) === i).slice(0, 7);
      return items.length ? items.map(x => `<a class="item" href="#/projekt/${encodeURIComponent(x.p.tag)}"><div class="time"><small>${esc(MONTHS[parseYmd(x.d).getMonth()].slice(0, 3))}</small>${parseYmd(x.d).getDate()}</div><div class="main"><div class="title">${esc(x.n)}</div><div class="sub">${esc(x.p.name)}<i class="sep">·</i>${esc(dayLabel(x.d))}</div></div></a>`).join('') : empty('Inga kommande milstolpar.');
    }
    case 'notes': {
      const daily = (S.data.notes || []).find(n => (n.tags || []).includes('#' + t.slice(2).replace(/-/g, '')) && /^dag\b/i.test(n.title));
      const recent = notes().slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified))).slice(0, 5);
      return (daily ? `<a class="dailycard" href="#/anteckning/${encodeURIComponent(daily.id)}"><b>${esc(daily.title)}</b><span>${esc((daily.excerpt || '').replace(/^.*\n/, '')).slice(0, 160)}</span></a>`
        : `<button class="dailycard empty-card" data-daily><span>Skriv dagens anteckning</span><span class="btn">Skapa i Notes</span></button>`) + recent.map(noteRow).join('');
    }
    case 'links': {
      const pins = S.data.pins || [];
      return `<div class="lgrid">${pins.map((p, i) => `<a class="lk" href="${esc(p.url)}" target="_blank" rel="noopener" data-pin="${i}"><span class="lk-i">${esc(p.name.slice(0, 1).toUpperCase())}</span><span>${esc(p.name)}</span></a>`).join('')}<button class="lk add" data-addpin><span class="lk-i">+</span><span>Lägg till</span></button></div>`;
    }
    case 'weather': {
      const w = S.weather; if (!w?.days) return empty('Ingen väderprognos.');
      return `<div class="wx">${w.days.map(d => `<div><span>${esc(DAYS[parseYmd(d.date).getDay()].slice(0, 3))}</span><b>${Math.round(d.max)}°</b><small>${Math.round(d.min)}° · ${esc(WX(d.code))}</small></div>`).join('')}</div>`;
    }
    case 'capacity': { if (!PLAN) return empty('Laddar…'); const d = now.getDay(); return PLAN.capacityWeekHtml(d === 0 || d === 6 ? ymd(addDays(monday(now), 7)) : t, { compact: true, rest: d !== 0 && d !== 6 }); }
    case 'delegated': return PLAN ? PLAN.delegationsHtml() : empty('Laddar…');
    case 'mail': return `<div data-mailbox='{"kind":"widget"}'><p class="empty">Hämtar mejl…</p></div>`;
    case 'contact': {
      const c = tasks().filter(x => /KONTAKTA|SVARA/i.test(x.list)).slice(0, 8);
      return c.length ? c.map(x => taskRow(x)).join('') : empty('Ingen att kontakta.');
    }
  }
  return '';
}

function greet() {
  const now = new Date(), t = todayStr(), w = S.weather;
  const q = window.KC_QUOTES || [];
  const qi = q.length ? q[Math.floor((parseYmd(t) - new Date(2026, 0, 1)) / 864e5) % q.length] : null;
  const bdays = (S.data?.birthdays || []).filter(b => b.date === t);
  const h = now.getHours();
  const hello = h < 5 ? 'God natt' : h < 10 ? 'God morgon' : h < 17 ? 'Hej' : h < 22 ? 'God kväll' : 'God natt';
  return `<div class="greet">
    <div class="g-hello">${hello}</div>
    <div class="g-day">${DAYS[now.getDay()][0].toUpperCase() + DAYS[now.getDay()].slice(1)} ${now.getDate()} ${MONTHS[now.getMonth()]}</div>
    <div class="g-meta"><span>Vecka ${week(now)}</span>${w ? `<span><b class="num">${Math.round(w.temp)}°</b> ${WX(w.code)}, ${Math.round(w.min)}°/${Math.round(w.max)}°${w.place ? ' i ' + esc(w.place) : ''}</span>` : ''}${bdays.length ? `<span>Fyller år: ${bdays.map(b => esc(b.title)).join(', ')}</span>` : ''}</div>
    ${qi ? `<blockquote class="quote"><p>${esc(qi[0])}</p><cite>${esc(qi[1])}</cite></blockquote>` : ''}
  </div>`;
}

/** Kalenderhändelser som bara upprepar en inspelningsdag ("Inspelningsdag 45") visas inte bredvid själva dagen. */
function dayItems(day) {
  const shoot = cfgProjects().filter(visible).flatMap(p => (p.shootDays || []).filter(d => d.date === day).map(d => ({ p, d })));
  const evs = events().filter(e => evOnDay(e, day)).filter(e => !(shoot.length && SHOOT_EV.test(e.title)))
    .sort((a, b) => (a.allDay === b.allDay ? String(a.start).localeCompare(String(b.start)) : a.allDay ? -1 : 1));
  return { shoot, all: evs.filter(e => e.allDay), timed: evs.filter(e => !e.allDay) };
}
function agendaDay(day, now) {
  const { shoot, all, timed } = dayItems(day);
  const chips = shoot.map(({ p, d }) => `<a class="ag-chip" style="--tc:${tagColor(p.tag)}" href="#/projekt/${encodeURIComponent(p.tag)}/produktion/dagar/${day}">Inspelning dag ${d.day}${d.note ? ' · ' + esc(d.note) : ''}${d.hours ? ' · ' + esc(d.hours) : ''}</a>`)
    .concat(all.map(e => `<span class="ag-chip item event" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}" style="--tc:${e.tags?.[0] ? tagColor(e.tags[0]) : 'var(--ink-3)'}">${esc(cleanTitle(e.title))}</span>`)).join('');
  let nowDone = !now;
  const rows = timed.map(e => {
    const past = now && new Date(e.end) < now, cur = now && new Date(e.start) <= now && new Date(e.end) > now;
    let line = '';
    if (!nowDone && new Date(e.start) > now) { nowDone = true; line = '<div class="ag-nowl"><span>' + hhmm(now.toISOString()) + '</span></div>'; }
    if (cur) nowDone = true;
    return line + `<div class="ag-row item event ${modeCls(e.mode)} ${past ? 'past' : ''} ${cur ? 'cur' : ''}" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}" style="--tc:${e.tags?.[0] ? tagColor(e.tags[0]) : 'var(--line-2)'}">
      <span class="ag-t">${hhmm(e.start)}<small>${hhmm(e.end)}</small></span><span class="ag-m"><b>${esc(cleanTitle(e.title))}</b>${e.location || e.cal ? `<small>${esc([e.location, e.cal].filter(Boolean).join(' · '))}</small>` : ''}</span></div>`;
  }).join('') + (!nowDone && timed.length ? '<div class="ag-nowl"><span>' + hhmm(now.toISOString()) + '</span></div>' : '');
  return { html: (chips ? `<div class="ag-all">${chips}</div>` : '') + rows, n: timed.length + all.length + shoot.length, left: now ? timed.filter(e => new Date(e.end) > now).length : timed.length };
}
/** Dagens schema som lista med nu-linje. När dagen är slut visas morgondagen under. */
function agenda() {
  const now = new Date(), t = todayStr(), tm = ymd(addDays(now, 1));
  const a = agendaDay(t, now);
  const late = !a.left && (now.getHours() >= 15 || !a.n);
  const b = late ? agendaDay(tm, null) : null;
  return `<div class="ag-list">${a.n ? a.html : '<div class="calm">Inget i kalendern idag.</div>'}</div>` +
    (b ? `<div class="ag-next"><div class="ag-nh">Imorgon · ${esc(DAYS[addDays(now, 1).getDay()])}</div><div class="ag-list">${b.n ? b.html : '<div class="calm">Inget inplanerat.</div>'}</div></div>` : '');
}

function weekStrip() {
  const mon = monday(new Date()), t = todayStr();
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  return `<div class="wk">${days.map(d => {
    const s = ymd(d);
    const shoot = cfgProjects().filter(visible).flatMap(p => (p.shootDays || []).filter(x => x.date === s).map(x => ({ p, x })));
    const evs = events().filter(e => evOnDay(e, s)).filter(e => !(shoot.length && SHOOT_EV.test(e.title))).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const ts = tasks().filter(x => x.due === s);
    return `<a class="wkd ${s === t ? 'today' : ''} ${s < t ? 'pastd' : ''}" href="#/kalender/dag/${s}">
      <div class="wkh"><span>${DAYS[d.getDay()].slice(0, 3)}</span><b>${d.getDate()}</b></div>
      ${shoot.map(({ p, x }) => `<div class="wkc" style="--tc:${tagColor(p.tag)}">Dag ${x.day}</div>`).join('')}
      ${evs.slice(0, 4).map(e => `<div class="wke" style="--tc:${e.tags?.[0] ? tagColor(e.tags[0]) : 'var(--ink-3)'}">${e.allDay ? '' : `<i>${hhmm(e.start)}</i>`}${esc(cleanTitle(e.title))}</div>`).join('')}
      ${evs.length > 4 ? `<div class="wkm">+${evs.length - 4}</div>` : ''}
      ${ts.length ? `<div class="wkt">${ts.length} att göra</div>` : ''}</a>`;
  }).join('')}</div>`;
}

function nextMs(p) {
  const t = todayStr(), c = p.cfg || {};
  return [...(c.deadlines || []).map(x => ({ date: x.date, name: x.name })), ...(c.phases || []).filter(x => x.milestone).map(x => ({ date: x.start, name: x.name }))]
    .filter(x => x.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
}
const evDay = e => e.allDay ? e.start : ymd(new Date(e.start));

// ---------- interaktion ----------
function bind(el) {
  el.querySelector('[data-dedit]').onclick = async () => {
    if (editing) { try { await api('setLayout', { tag: '_IDAG', layout: layout() }, true); toast('Sparat'); } catch { toast('Kunde inte spara layouten'); } }
    editing = !editing; emit('render');
  };
  el.querySelectorAll('[data-wmove],[data-wsize],[data-wremove],[data-wadd]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const l = layout().map(x => ({ ...x })), i = Number(b.closest('[data-w]')?.dataset.w);
    if (b.dataset.wadd) l.push({ id: b.dataset.wadd, size: W[b.dataset.wadd].size });
    else if (b.hasAttribute('data-wremove')) l.splice(i, 1);
    else if (b.hasAttribute('data-wsize')) l[i].size = { s: 'l', m: 'xl', l: 'xl', xl: 's' }[l[i].size] || 'l';
    else { const j = i + Number(b.dataset.wmove); if (j >= 0 && j < l.length) [l[i], l[j]] = [l[j], l[i]]; }
    setLayout(l);
  });
  let from = null;
  el.querySelectorAll('.editing [data-w]').forEach(w => {
    w.addEventListener('dragstart', () => from = Number(w.dataset.w));
    w.addEventListener('dragover', e => { if (from != null) e.preventDefault(); });
    w.addEventListener('drop', e => { e.preventDefault(); const l = layout().map(x => ({ ...x })); const [m] = l.splice(from, 1); l.splice(Number(w.dataset.w), 0, m); from = null; setLayout(l); });
  });
  el.querySelectorAll('[data-dtab]').forEach(b => b.onclick = e => { e.stopPropagation(); setPref('d_tasks', b.dataset.dtab); emit('render'); });
  el.querySelector('[data-dnewtask]')?.addEventListener('click', () => openTask(null, { due: pref('d_tasks', 'idag') === 'idag' ? todayStr() : null }));
  el.querySelector('[data-daily]')?.addEventListener('click', makeDaily);
  el.querySelector('[data-addpin]')?.addEventListener('click', addPin);
  el.querySelectorAll('[data-pin]').forEach(a => {
    let tm; a.addEventListener('pointerdown', () => tm = setTimeout(() => removePin(Number(a.dataset.pin)), 650));
    a.addEventListener('pointerup', () => clearTimeout(tm)); a.addEventListener('pointerleave', () => clearTimeout(tm));
    a.addEventListener('contextmenu', e => { e.preventDefault(); removePin(Number(a.dataset.pin)); });
  });
  el.querySelectorAll('.mini[data-task]').forEach(m => m.onclick = () => openTask(m.dataset.task));
  // Fånga: tolkar datum och #taggar medan man skriver
  const f = el.querySelector('[data-capture]');
  if (f) {
    const inp = f.querySelector('input'), prev = el.querySelector('[data-capprev]');
    inp.value = capDraft; if (capFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    const show = () => {
      capDraft = inp.value;
      const r = parse(inp.value);
      prev.innerHTML = inp.value.trim() ? `<span>${esc(r.title || '…')}</span>${r.date ? `<span class="pv">${esc(dayLabel(r.date))}${r.time ? ' ' + r.time : ''}</span>` : ''}${(r.tags || []).map(g => `<span class="pv tagpv" style="--tc:${tagColor(g)}">${esc(g.slice(1))}</span>`).join('')}${r.recur ? `<span class="pv">↻ ${esc(r.recur)}</span>` : ''}` : '';
    };
    inp.addEventListener('input', show); inp.addEventListener('focus', () => capFocus = true); inp.addEventListener('blur', () => capFocus = false);
    show();
    f.onsubmit = async e => {
      e.preventDefault();
      const raw = inp.value.trim(); if (!raw) return;
      const r = parse(raw);
      const title = [r.title || raw, ...(r.tags || [])].join(' ');
      const notes = r.recur ? `Upprepa: ${r.recur}` : '';
      capDraft = ''; inp.value = ''; prev.innerHTML = '';
      const inbox = (S.data.taskLists || []).find(l => /INBOX/i.test(l.title) && l._src === 'jobb');
      try { await api('addTask', { title, notes, due: r.date || '', listId: inbox?.id || '' }, true); toast('I inkorgen' + (r.date ? ' · ' + dayLabel(r.date) : '')); refresh(); }
      catch (err) { toast('Kunde inte spara – ' + err.message); capDraft = raw; emit('render'); }
    };
  }
}
let capDraft = '', capFocus = false;
function parse(text) {
  if (parseQuick) { try { return parseQuick(text, { kind: 'task', now: new Date() }); } catch {} }
  const tags = (text.match(/#[0-9A-Za-zÅÄÖåäö_-]+/g) || []).map(x => x.toUpperCase());
  let title = text.replace(/#[0-9A-Za-zÅÄÖåäö_-]+/g, '').trim(), date = null;
  const rel = { idag: 0, imorgon: 1, 'i morgon': 1, 'i övermorgon': 2 };
  for (const k of Object.keys(rel)) if (new RegExp('\\b' + k + '\\b', 'i').test(title)) { date = ymd(addDays(new Date(), rel[k])); title = title.replace(new RegExp('\\s*\\b' + k + '\\b', 'i'), '').trim(); }
  return { title, date, tags };
}

async function makeDaily(e) {
  e.currentTarget.disabled = true;
  try { const r = await api('dailyNote', { date: todayStr() }, true); toast(r.exists ? 'Finns redan' : 'Köad – skapas i Notes inom 5 min'); }
  catch (err) { toast('Kunde inte skapa – ' + err.message); }
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
export function key(e) {
  if (e.key === 'f' || e.key === 'i') { e.preventDefault(); document.querySelector('[data-capture] input')?.focus(); }
  if (e.key === 'a') { editing = !editing; emit('render'); }
}
