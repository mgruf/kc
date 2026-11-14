/* Sök och hoppa (⌘K): allt KC vet om, plus kommandon med ">". */
import {
  S, $, esc, go, store, emit, refresh, api, toast, todayStr, shortDate, dayLabel, hhmm, cleanTitle, people, projects, notes, tasks, events, contactOf,
} from './core.js';
import { openTask, openEvent, openAdd, openSetup } from './ui.js';

const COMMANDS = [
  ['Ny uppgift', () => openTask(null, {})],
  ['Ny händelse', () => openEvent(null, null, {})],
  ['Ny anteckning i Notes', () => openAdd('note')],
  ['Skapa dagens dagsanteckning', async () => { try { const r = await api('dailyNote', { date: todayStr() }, true); toast(r.exists ? 'Finns redan' : 'Köad – skapas i Notes inom 5 min'); } catch (e) { toast(e.message); } }],
  ['Ny samling (databas)', () => go('samling/_ny')],
  ['Lägg till person i projekt', () => import('./views/team.js').then(m => m.openTeamAdd({}))],
  ['Läs in manus', () => { const p = projects().find(x => x.cfg); go('projekt/' + encodeURIComponent(p ? p.tag : '') + '/manus'); }],
  ['Nytt projekt', () => go('samling/Projekt/ny')],
  ['Gå till Idag', () => go('idag')], ['Gå till Kalender – vecka', () => go('kalender/vecka')], ['Gå till Kalender – dag', () => go('kalender/dag')], ['Gå till Kalender – månad', () => go('kalender/manad')],
  ['Gå till Uppgifter', () => go('uppgifter')], ['Gå till Anteckningar', () => go('anteckningar')], ['Gå till Personer', () => go('personer')], ['Gå till Horisont', () => go('horisont')], ['Gå till Projekt', () => go('projekt')],
  ['Byt till jobbläge', () => { S.mode = 'jobb'; store.set('mode', 'jobb'); emit('render'); }],
  ['Byt till privatläge', () => { S.mode = 'privat'; store.set('mode', 'privat'); emit('render'); }],
  ['Uppdatera nu', () => refresh()],
  ['Koppla källor (jobb/privat)', () => openSetup()],
];

function index() {
  const out = [];
  projects().filter(p => p.cfg || p.tasks.length).forEach(p => out.push({ k: 'Projekt', t: p.name, s: p.tag, body: p.tag, go: () => go('projekt/' + encodeURIComponent(p.tag)), w: 6 }));
  tasks().forEach(t => out.push({ k: 'Uppgift', t: cleanTitle(t.title), s: (t.due ? dayLabel(t.due) + ' · ' : '') + t.list, body: t.notes + ' ' + (t.tags || []).join(' '), go: () => openTask(t.id), w: 4 }));
  [...(S.data?.events || []), ...S.extraEvents].forEach(e => out.push({ k: 'Händelse', t: e.title, s: (e.allDay ? shortDate(e.start) : dayLabel(e.start.slice(0, 10)) + ' ' + hhmm(e.start)) + ' · ' + e.cal, body: (e.location || '') + ' ' + (e.description || ''), go: () => openEvent(e.id, e.start), w: 3 }));
  notes().forEach(n => out.push({ k: 'Anteckning', t: n.title, s: n.folder, body: n.excerpt + ' ' + (n.tags || []).join(' '), go: () => go('anteckning/' + encodeURIComponent(n.id)), w: 3 }));
  people().forEach(p => out.push({ k: 'Person', t: p.name || p.email, s: [p.title, p.org].filter(Boolean).join(', ') || p.email, body: [p.email, ...(p.phones || []), ...(p.labels || [])].join(' '), go: () => go('person/' + encodeURIComponent(p.key)), w: 5 }));
  (S.data?.collections || []).forEach(c => {
    out.push({ k: 'Samling', t: c.name, s: c.rows.length + ' rader', body: '', go: () => go('samling/' + encodeURIComponent(c.name)), w: 5 });
    c.rows.forEach(r => out.push({ k: c.name, t: String(r[c.fields[0]?.name] || '(utan namn)'), s: c.fields.slice(1, 3).map(f => r[f.name]).filter(Boolean).join(' · '), body: Object.values(r).join(' '), go: () => go('samling/' + encodeURIComponent(c.name) + '/' + encodeURIComponent(r._id)), w: 3 }));
  });
  Object.entries(S.prod).forEach(([tag, pr]) => {
    (pr.scenes || []).forEach(s => out.push({ k: 'Scen', t: `${s.film} ${s.scene} · ${s.heading || s.place}`, s: s.status || '', body: (s.cast || '') + ' ' + tag, go: () => go(`projekt/${encodeURIComponent(tag)}/produktion/scener/${encodeURIComponent(s.film + '-' + s.scene)}`), w: 2 }));
    (pr.locations || []).forEach(l => out.push({ k: 'Plats', t: l.place, s: l.address, body: tag, go: () => go(`projekt/${encodeURIComponent(tag)}/produktion/platser`), w: 2 }));
  });
  return out;
}

let items = [], sel = 0, idx = null;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const mark = (t, q) => { if (!q) return esc(t); const i = norm(t).indexOf(norm(q.split(/\s+/)[0])); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.split(/\s+/)[0].length)) + '</mark>' + esc(t.slice(i + q.split(/\s+/)[0].length)); };

function search(q) {
  q = q.trim();
  if (q.startsWith('>')) {
    const s = norm(q.slice(1).trim());
    return COMMANDS.filter(([n]) => !s || norm(n).includes(s)).map(([t, fn]) => ({ k: 'Kommando', t, s: '', go: fn }));
  }
  if (!q) {
    const recent = store.get('recent', []);
    return [...recent.map(r => ({ ...r, go: () => (location.hash = r.hash) })), ...COMMANDS.slice(0, 4).map(([t, fn]) => ({ k: 'Kommando', t, s: '', go: fn }))];
  }
  const words = norm(q).split(/\s+/).filter(Boolean);
  idx ||= index();
  return idx.map(x => {
    const T = norm(x.t), B = norm(x.s + ' ' + x.body);
    if (!words.every(w => T.includes(w) || B.includes(w))) return null;
    let sc = x.w;
    if (T.startsWith(words[0])) sc += 10; else if (T.includes(' ' + words[0])) sc += 6; else if (T.includes(words[0])) sc += 4;
    return { ...x, sc };
  }).filter(Boolean).sort((a, b) => b.sc - a.sc).slice(0, 40);
}

function draw() {
  const q = $('#pInput').value;
  items = search(q);
  sel = Math.min(sel, Math.max(0, items.length - 1));
  let last = null;
  $('#pResults').innerHTML = items.map((x, i) => {
    const g = !q.trim() && x.k !== last ? `<div class="pgrp">${x.k === 'Kommando' ? 'Gör' : 'Senast öppnat'}</div>` : '';
    last = x.k;
    return g + `<div class="pres ${i === sel ? 'on' : ''}" data-i="${i}"><span class="k">${esc(x.k)}</span><span class="t">${mark(x.t, q.startsWith('>') ? '' : q)}</span><span class="s">${esc(x.s || '')}</span></div>`;
  }).join('') || `<p class="empty" style="padding:12px">Inget hittades. Skriv &gt; för kommandon.</p>`;
  $('#pResults').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

function choose(i) {
  const x = items[i]; if (!x) return;
  close();
  x.go();
  if (x.k !== 'Kommando') setTimeout(() => {
    const r = store.get('recent', []).filter(y => y.hash !== location.hash);
    r.unshift({ k: x.k, t: x.t, s: x.s, hash: location.hash });
    store.set('recent', r.slice(0, 6));
  }, 50);
}

export function openPalette(prefix = '') {
  idx = null;
  $('#palette').hidden = false;
  const i = $('#pInput'); i.value = prefix; sel = 0; draw(); setTimeout(() => i.focus(), 10);
}
function close() { $('#palette').hidden = true; }

$('#pInput').addEventListener('input', () => { sel = 0; draw(); });
$('#pInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  else if (e.key === 'Escape') { e.preventDefault(); close(); }
});
$('#pResults').addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) choose(Number(r.dataset.i)); });
$('#palette').addEventListener('click', e => { if (e.target.id === 'palette') close(); });
