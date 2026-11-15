/* KC – Produktionsplanen (port av planeringssidan v5 till KC).
   Körs i plan.html, som KC:s vy #/plan visar i en iframe. Regelmotorn ligger i ../plan-engine.js.
   Läser och skriver projektets planark via KC:s Apps Script (planRead/planWrite – bara ändrade celler,
   med kontroll mot det som lästes). Ingen claude.ai-koppling behövs. */
import { DAY, toD, toS, addDays, dow, easter, swedishHolidays, holidayMap, normResources, makeCal, hoursPerDay, calKey, taskDur, schedule, LOCK_MARGIN, workdaysBetween, FASER_HEAD, parseDoers, doersToStr, MOT_HEAD, DEFAULT_RECIPIENTS, ROW_HEAD, CAL_HEAD, MALL_HEAD, RES_HEAD, SET_HEAD, depsToStr, strToDeps, STATUS_LABEL, statusKey, TYP_OUT, planToRows, num, cell, normDate, isYes, rowsToPlan, templatesToRows, rowsToTemplates, opsClone, uniqueId, baseName, splitTask, renumberParts, duplicateTasks, templateFromTasks, ensureRow, newRow, ensureRowsForAll, insertTemplate, shiftTasks, removeTasks } from '../plan-engine.js';

let cur = { id: '', tag: '', name: '' }; // projektet som är öppet i planvyn (tagg från KC)
const sheetUrl = () => cur.url || ('https://docs.google.com/spreadsheets/d/' + cur.id + '/edit');
// ===== KC-brygga: källor, API och ersättare för claude.ai-kopplingarna =====
// Sidan körs i en iframe i KC (samma ursprung) och når arken via KC:s Apps Script (actions planRead/planWrite/…).
const KC = (() => {
  const get = (k, d) => { try { const v = localStorage.getItem('kc_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  let s = get('sources', null);
  if (!s) { const url = get('url', ''), key = get('key', ''); s = url ? [{ id: 'jobb', label: 'Jobb', url, key }] : []; }
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const qs = new URLSearchParams(location.search);
  return { sources: s, src: qs.get('src') || 'jobb', tag: h && h !== 'pf' ? h : '', pf: h === 'pf' || !h };
})();
async function kcApi(action, params, post) {
  const s = KC.sources.find(x => x.id === KC.src) || KC.sources[0];
  if (!s || !s.url || !s.key) throw { code: 'kc_nosource', message: 'KC är inte kopplat till någon källa' };
  let res;
  if (post) res = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, key: s.key }, params || {})) });
  else res = await fetch(s.url + '?' + new URLSearchParams(Object.assign({ action, key: s.key }, params || {})));
  const j = await res.json();
  if (!j.ok) throw { code: 'tool_error', message: j.error || 'fel' };
  return j;
}
// Vilket ark ett spreadsheetId pekar på: det öppna projektet (tagg), registret eller ett annat planark i portföljen
const REG_ID = 'reg';
let REG_URL = '';
const kcTarget = id => id === REG_ID ? { reg: true } : (!id || id === cur.id) && cur.tag ? { tag: cur.tag } : { ssId: id };
const snapCache = {};
const STD_TABS = /^(Faser|Rader|Resurser|Kalender|Mallar|Inställningar|Varianter|Mottagare|Status|Budget|Läs mig)$/;
function kcSnap(id, tab, fresh) {
  const k = id || '_cur';
  if (id !== REG_ID && tab && !STD_TABS.test(tab)) return kcApi('planRead', Object.assign(kcTarget(id), { tabs: tab }), true);
  const c = snapCache[k];
  if (!fresh && c && Date.now() - c.t < 8000) return c.p;
  const p = kcApi('planRead', kcTarget(id), true);
  snapCache[k] = { t: Date.now(), p }; p.catch(() => { delete snapCache[k]; });
  return p;
}
const dropSnap = id => { delete snapCache[id || '_cur']; delete snapCache['_cur']; if (cur.id) delete snapCache[cur.id]; };
const tabOf = range => { const m = /^'?(.+?)'?!/.exec(range); return m ? m[1] : range; };
const a1 = range => { const m = /!\$?([A-Z]+)\$?(\d+)/.exec(range); if (!m) return { col: 1, row: 1 }; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { col: c, row: +m[2] }; };
let lastRaw = {};        // flikarna så som de såg ut när planen lästes (för diff och optimistisk låsning)
let loadedVersion = 0;   // arkets ändringsstämpel vid senaste läsning
let staleNote = '';
const kcMcp = {
  async callTool(server, tool, args) {
    if (tool === 'get_values') {
      const tab = tabOf(args.range);
      const d = await kcSnap(args.spreadsheetId, tab);
      if (args.spreadsheetId === REG_ID) REG_URL = d.url || REG_URL;
      else if (!args.spreadsheetId || args.spreadsheetId === cur.id || (cur.tag && d.tag === cur.tag)) { if (d.url) { cur.url = d.url; const m = /\/d\/([A-Za-z0-9_-]+)/.exec(d.url); if (m) cur.id = m[1]; } if (d.version) loadedVersion = d.version; lastRaw = Object.assign({}, lastRaw, d.sheets); }
      const v = d.sheets[tab]; if (!v) throw { code: 'tool_error', message: 'fliken ' + tab + ' finns inte' };
      return { payload: { values: v } };
    }
    if (tool === 'update_values') {   // bara registret går den här vägen (enstaka rader)
      const tab = tabOf(args.range), at = a1(args.range);
      const d = await kcSnap(args.spreadsheetId, tab); const rows = d.sheets[tab] || [[]]; const head = rows[0] || [];
      const values = {}; (args.values[0] || []).forEach((v, j) => { const h = head[at.col - 1 + j]; if (h) values[h] = v; });
      const item = at.row <= rows.length ? { at: at.row, values } : { values };
      const r = await kcApi('planWrite', Object.assign(kcTarget(args.spreadsheetId), { sheet: tab, rows: [item] }), true);
      dropSnap(args.spreadsheetId);
      if (r.conflicts && r.conflicts.length) throw { code: 'tool_error', message: 'raden hade ändrats i arket – uppdatera och försök igen' };
      return { payload: r };
    }
    if (tool === 'update_spreadsheet') return { payload: {} };   // flikar skapas av servern vid behov
    if (tool === 'list_calendars') { const r = await kcApi('calendars', {}); return { payload: { calendars: (r.calendars || []).map(c => ({ id: c.id, summary: c.name })) } }; }
    if (tool === 'create_event') {
      const date = String(args.startTime).slice(0, 10);
      const r = await kcApi('addEvent', { title: args.summary, date, calendarId: args.calendarId || '', description: args.description || '' }, true);
      return { payload: r };
    }
    throw { code: 'tool_error', message: 'stöds inte i KC: ' + tool };
  },
};
const kcDownloads = {
  async save({ filename, data }) {
    const blob = data instanceof ArrayBuffer ? new Blob([data], { type: /\.pdf$/i.test(filename) ? 'application/pdf' : 'application/octet-stream' }) : new Blob([data], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  },
};
// ---- Diff mot det som lästes: bara ändrade celler skickas, varje rad kontrolleras mot vad sidan såg ----
const cellS = v => String(v == null ? '' : v).trim();
function diffTab(oldRows, newRows, keyCol) {
  const head = (newRows[0] || []).map(String), oh = ((oldRows || [])[0] || []).map(String);
  const ov = (r, c) => { const i = oh.indexOf(c); return i < 0 ? '' : cellS(r[i]); };
  const nv = (r, c) => cellS(r[head.indexOf(c)]);
  const rows = [], del = [];
  const changedCols = (o, n) => head.filter(c => c && ov(o, c) !== nv(n, c));
  const valsOf = (n, cols) => { const v = {}; cols.forEach(c => { v[c] = n[head.indexOf(c)] == null ? '' : n[head.indexOf(c)]; }); return v; };
  const old = oldRows || [[]];
  if (keyCol) {
    const byKey = new Map();
    old.forEach((r, i) => { if (!i) return; const k = ov(r, keyCol); if (!k) return; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); });
    const seen = new Set();
    newRows.slice(1).forEach(n => {
      const k = nv(n, keyCol); if (!k) return;
      const list = byKey.get(k) || []; const i = list.find(x => !seen.has(x));
      if (i == null) { rows.push({ key: { [keyCol]: k }, values: valsOf(n, head.filter(c => c && nv(n, c))) }); return; }
      seen.add(i); const o = old[i]; const ch = changedCols(o, n); if (!ch.length) return;
      const expect = { [keyCol]: k }; if (oh.includes('Namn')) expect['Namn'] = ov(o, 'Namn'); ch.forEach(c => { if (oh.includes(c)) expect[c] = ov(o, c); });
      rows.push({ at: i + 1, key: { [keyCol]: k }, expect, values: valsOf(n, ch) });
    });
    byKey.forEach((list, k) => list.forEach(i => { if (!seen.has(i)) del.push({ at: i + 1, key: { [keyCol]: k }, expect: oh.includes('Namn') ? { Namn: ov(old[i], 'Namn') } : {} }); }));
  } else {
    const N = Math.max(old.length, newRows.length);
    for (let i = 1; i < N; i++) {
      const o = old[i], n = newRows[i];
      if (o && n) { const ch = changedCols(o, n); if (!ch.length) continue; const expect = {}; oh.forEach(c => { if (c) expect[c] = ov(o, c); }); rows.push({ at: i + 1, expect, values: valsOf(n, ch) }); }
      else if (n) { if (n.some(x => cellS(x))) rows.push({ values: valsOf(n, head.filter(c => c && nv(n, c))) }); }
      else if (o && o.some(x => cellS(x))) { const expect = {}; oh.forEach(c => { if (c) expect[c] = ov(o, c); }); del.push({ at: i + 1, expect }); }
    }
  }
  return { rows, del };
}

const SERVER = 'Google Sheets';
const MON = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONL = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni', 'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'];
const DEPT = { 'Utveckling': 'utv', 'Förproduktion': 'prep', 'Inspelning': 'shoot', 'Klipp': 'klipp', 'Ljud': 'ljud', 'Musik': 'musik', 'Bild': 'bild', 'Leverans': 'lev' };
const DEFAULT_GROUPS = ['Utveckling', 'Förproduktion', 'Inspelning', 'Klipp', 'Ljud', 'Musik', 'Bild', 'Leverans'];
const GROUP_ORDER = DEFAULT_GROUPS.slice(); // synkas med plan.sections
const COLORS = [['', 'Avdelningens'], ['red', 'Röd'], ['orange', 'Orange'], ['yellow', 'Gul'], ['green', 'Grön'], ['teal', 'Turkos'], ['blue', 'Blå'], ['purple', 'Lila'], ['pink', 'Rosa'], ['grey', 'Grå']];
const DEP_TYPES = [['FS', 'när den är klar'], ['SS', 'när den startar'], ['FF', 'på dess slutdag']];
const PX = { day: 30, week: 16, month: 5, quarter: 2 };
const ROW_H = 28, GROUP_H = 32;
const F1_CHAIN = ['fin1', 'pl1', 'dia1', 'fol1', 'atm1', 'ld1', 'adr1', 'pm1a', 'pm1b', 'mus1', 'mix1', 'vfx1', 'grd1', 'gfx1', 'onl1', 'lev1'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const fmt = s => { if (!s) return '–'; const d = toD(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtShort = s => { if (!s) return '–'; const d = toD(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const WD = ['sön', 'mån', 'tis', 'ons', 'tors', 'fre', 'lör'];
const wdOf = s => s ? WD[toD(s).getUTCDay()] : '';
const recipName = id => ((plan.recipients || []).find(x => x.id === id) || { name: id }).name;
const recipNames = t => (t.to || []).map(recipName).join(', ');
const readText = (t, r) => `${recipNames(t) || 'Mottagaren'} får det ${wdOf(r.start)} ${fmtShort(r.start)}, ${t.dlvAt || 'dagens början'} · feedback senast ${wdOf(r.end)} ${fmtShort(r.end)}, ${t.fbAt || 'dagens slut'}`;
const recipId = n => { let b = String(n).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'mott'; let id = b, k = 2; while ((plan.recipients || []).some(x => x.id === id)) id = b + k++; return id; };
const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / DAY);
const deptColor = g => sectionColor(g);
const barColor = t => t.color ? `var(--x-${t.color})` : deptColor(t.group);
const filmTag = t => t.film ? 'F' + t.film : '';
const label = t => (t.film ? 'F' + t.film + ' ' : '') + t.name;
const isMsT = t => !!(t.ms || t.type === 'milestone');
const editing = () => /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '');
const mod = navigator.platform && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
function isoWeek(s) { const d = toD(s); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const n = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - n + 3); const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - f) / DAY - 3 + ((f.getUTCDay() + 6) % 7)) / 7); }
function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('kc_plan.' + k)); localStorage.setItem('kc_plan.' + k, JSON.stringify(v)); } catch (e) { return null; } }
const nowStamp = () => { const n = new Date(); return `${n.getDate()} ${MON[n.getMonth()]} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; };

// ---- State ----
function normalize(p) {
  p.resources = normResources(p.resources).map(r => Object.assign({ blocks: [] }, r, { members: r.members.map(m => Object.assign({ blocks: [] }, m)) }));
  p.settings.breaks = p.settings.breaks || [];
  if (!p.recipients || !p.recipients.length) p.recipients = DEFAULT_RECIPIENTS.map(x => Object.assign({}, x));
  ensureRowsForAll(p);
  syncSections(p);
  return p;
}
let plan = normalize({ meta: { title: '', company: '', updated: '' }, settings: { projectStart: toS(new Date()), holidays: true, breaks: [] }, resources: [], rows: [], tasks: [] });
const FREE = () => !!(plan && plan.settings && plan.settings.free);
// Fritt läge: varje fas ligger på sina egna datum (fs/fe); beroenden och resurser vilar men finns kvar.
function planSchedule(p) {
  if (!p.settings || !p.settings.free) return schedule(p);
  const missing = p.tasks.filter(t => t.type !== 'fixed' && !t.fs);
  if (missing.length) { const r0 = schedule(Object.assign({}, p, { settings: Object.assign({}, p.settings, { free: false }) })); missing.forEach(t => { const d = r0.dates[t.id]; if (d) { t.fs = d.start; t.fe = d.end; } }); }
  const q = Object.assign({}, p, { tasks: p.tasks.map(t => t.type === 'fixed' || !t.fs ? t : Object.assign({}, t, { type: 'fixed', start: t.fs, end: t.fe || t.fs, ms: isMsT(t) || undefined, deps: [], notBefore: undefined, with: undefined, mustFinishBefore: undefined })) });
  return schedule(q);
}
let result = planSchedule(plan);
let templates = [];
let baselinePlan = clone(plan);
let baseline = clone(result.dates);
let source = { kind: 'loading', at: '' };
let dirty = false;
let sheetRows = { faser: 77, res: 18, set: 7, mall: 17, rader: 27, kal: 6, var: 0 };
const ui = Object.assign({ zoom: 'month', film: 'all', groupBy: 'dept', rows: 'manual', arrows: 'sel', collapsed: [] }, store('ui4') || {});
if (!PX[ui.zoom]) ui.zoom = 'month';
let sel = new Set(), selected = null, panelMode = null; // 'task' | 'multi' | 'res' | 'tpl' | 'cal'
let clipboard = null, mcp = null, downloads = null;
const undoStack = [], redoStack = [];
const snap = () => JSON.stringify({ plan, templates });

function pushUndo() { undoStack.push(snap()); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
function restore(s) { const o = JSON.parse(s); plan = o.plan; templates = o.templates; }
function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); afterHistory('Ångrat'); }
function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); afterHistory('Gjort om'); }
function afterHistory(msg) { dirty = true; sel = new Set([...sel].filter(id => taskById(id))); if (selected && !taskById(selected)) { selected = null; if (panelMode === 'task') panelMode = null; } recompute(); toast(msg); }
function recompute() { ensureRowsForAll(plan); syncSections(plan); result = planSchedule(plan); if (plan.tasks.some(t => t.splitOf)) renumberParts(plan, result); render(); }
function change(fn) { pushUndo(); const r = fn(); dirty = true; recompute(); return r; }
function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 3800); }
const taskById = id => plan.tasks.find(t => t.id === id);
const poolById = id => plan.resources.find(r => r.id === id);
const rowById = id => plan.rows.find(r => r.id === id);
const memberName = id => result.memberName[id] || id;
const filmsList = () => [...new Set(plan.tasks.map(t => t.film).filter(Boolean))].sort((a, b) => a - b);
const sections = () => GROUP_ORDER.slice();
function milestoneSnapshot() { const o = {}; plan.tasks.forEach(t => { if (isMsT(t) && result.dates[t.id]) o[t.id] = result.dates[t.id].start; }); return o; }
function impact(before) {
  const after = milestoneSnapshot();
  const moved = Object.keys(after).filter(id => before[id] && before[id] !== after[id]).map(id => { const dd = daysBetween(before[id], after[id]); return `${label(taskById(id))} ${dd > 0 ? '+' : '−'}${Math.abs(dd)} d`; });
  return moved.length ? ' Påverkar ' + moved.slice(0, 4).join(', ') + (moved.length > 4 ? ' m.fl.' : '.') : '';
}
// Väntar a (direkt eller indirekt) på b?
function dependsOn(a, b, seen) {
  seen = seen || new Set(); if (a === b) return true; if (seen.has(a)) return false; seen.add(a);
  const t = taskById(a); if (!t) return false;
  return (t.deps || []).some(d => dependsOn(d.id, b, seen)) || (t.with ? dependsOn(t.with, b, seen) : false);
}

// ---- Render: topp ----
function renderSource() {
  const sheetLink = cur.id || cur.url ? `<a href="${sheetUrl()}" target="_blank" rel="noopener">${esc(cur.name || 'arket')}</a>` : '';
  $('#title').textContent = plan.meta.title || cur.name || (view === 'pf' ? 'Alla projekt' : 'Produktionsplan');
  let s = source.kind === 'sheet'
    ? `<span class="dot live"></span> Google Sheet ${sheetLink} · hämtad ${esc(source.at)}`
    : source.kind === 'loading' ? (cur.tag ? `<span class="dot"></span> Hämtar planen…` : '') : `<span class="dot"></span> ${esc(source.at || '')}`;
  if (dirty) s += ` · <span class="dot dirty"></span> Osparade ändringar${ui.autosave && mcp && source.kind === 'sheet' ? ' – sparas strax' : ''} <button class="linkbtn" type="button" id="btnReset">Återställ</button>`;
  s += draftHtml();
  if (staleNote) s += `<div class="nosave">${esc(staleNote)}</div>`;
  $('#source').innerHTML = s;
  const noSheet = !cur.tag && !cur.id;
  $('#btnLoad').disabled = noSheet; $('#btnSave').disabled = noSheet || source.kind !== 'sheet';

  $('#btnUndo').disabled = !undoStack.length; $('#btnRedo').disabled = !redoStack.length;
}
function renderKeys() {
  const d = result.dates; const byName = {};
  plan.tasks.forEach(t => {
    if (!isMsT(t) && t.group !== 'Inspelning') return;
    const key = t.group === 'Inspelning' ? 'Inspelning' : t.name;
    (byName[key] = byName[key] || { group: t.group, items: [] }).items.push(t);
  });
  $('#keys').innerHTML = Object.entries(byName).map(([name, g]) => {
    const lines = g.items.map(t => {
      const r = d[t.id]; if (!r) return '';
      const b = cmpBase()[t.id];
      const val = t.group === 'Inspelning' ? `${fmtShort(r.start)} – ${fmt(r.end)}` : fmt(r.start);
      let delta = '';
      if (b) { const dd = daysBetween(b.end, r.end); if (dd) delta = `<span class="delta ${dd > 0 ? 'later' : 'earlier'}" title="${esc(cmpLabel())}">${dd > 0 ? '+' : '−'}${Math.abs(dd)} d</span>`; }
      else if (dirty) delta = `<span class="delta later" title="Ny sedan senast hämtade">ny</span>`;
      return `<div class="line"><span class="f">${filmTag(t)}</span><span class="d">${val}</span>${delta}</div>`;
    }).join('');
    return `<div class="key"><h3><i style="background:${deptColor(g.group)}"></i>${esc(name)}</h3>${lines}</div>`;
  }).join('');
}
function flagText(f) {
  const t = taskById(f.id), r = result.dates[f.id] || {}, by = taskById(f.by);
  const byN = esc(by ? label(by) : f.by);
  if (f.kind === 'soft') return `<b>${esc(label(t))}</b> startar ${fmt(r.start)} men väntar mjukt på ${byN}, som tillåter start först ${fmt(f.worst)}.`;
  if (f.level === 'bad') return `<b>${esc(label(t))}</b> är låst till ${fmt(r.start)} men hinns inte. ${byN} gör att den tidigast kan ligga ${fmt(f.worst)}, ${-f.slack} arbetsdagar för sent.`;
  return `<b>${esc(label(t))}</b> är låst till ${fmt(r.start)}. Marginalen till ${byN} är ${f.slack} arbetsdagar, under gränsen ${f.lim}.`;
}
document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('#alerts [data-goto]'); if (a && typeof select === 'function') select([a.dataset.goto], { open: true }); });
function renderAlerts() {
  const items = [];
  (result.flags || []).slice().sort((a, b) => (a.level === 'bad' ? 0 : 1) - (b.level === 'bad' ? 0 : 1))
    .forEach(f => items.push(`<div class="alert${f.level === 'bad' ? ' bad' : ''}" data-goto="${esc(f.id)}" title="Visa i planen">${flagText(f)}</div>`));
  result.warnings.forEach(w => items.push(`<div class="alert">${esc(w)}</div>`));
  plan.tasks.forEach(t => {
    const r = result.dates[t.id];
    if (r && r.waited > 0) items.push(`<div class="alert"><b>${esc(label(t))}</b> väntar ${r.waited} arbetsdagar på ${esc((r.members || []).map(memberName).join(' och ') || 'en ledig person')}.</div>`);
    (t.deps || []).forEach(dp => { if (!taskById(dp.id)) items.push(`<div class="alert"><b>${esc(label(t))}</b> hänvisar till okänt ID “${esc(dp.id)}”.</div>`); });
  });
  $('#alerts').innerHTML = items.join('');
}

// ---- Rader ----
function visibleTask(t) { if (ui.f && ui.f.hide && filterOn() && !matchF(t)) return false; return ui.film === 'all' || !t.film || String(t.film) === String(ui.film); }
function layoutSections() {
  const out = [];
  if (ui.rows === 'manual') {
    for (const sec of sections()) {
      const secRows = plan.rows.filter(r => r.section === sec);
      const hidden = new Set(); const kids = new Set(); const stack = [];
      secRows.forEach((r, i) => { const ind = r.indent || 0; while (stack.length && (stack[stack.length - 1].indent || 0) >= ind) stack.pop(); if (stack.some(a => (ui.rcol || []).includes(a.id))) hidden.add(r.id); const nx = secRows[i + 1]; if (nx && (nx.indent || 0) > ind) kids.add(r.id); stack.push(r); });
      const rows = secRows.filter(r => !hidden.has(r.id)).map(r => {
        const all = plan.tasks.filter(t => t.row === r.id); const tasks = all.filter(visibleTask);
        if (all.length && !tasks.length) return null;
        const films = [...new Set(tasks.map(t => t.film).filter(Boolean))];
        return { key: 'r:' + r.id, rowId: r.id, label: r.name, sub: '', tag: films.length === 1 && !/F\d/.test(r.name) ? 'F' + films[0] : '', tasks, indent: r.indent || 0, bold: !!r.bold, fill: r.fill || '', kids: kids.has(r.id), folded: (ui.rcol || []).includes(r.id) };
      }).filter(Boolean);
      if (!rows.length && !plan.rows.some(r => r.section === sec)) continue;
      out.push({ key: sec, label: sec, color: deptColor(sec), rowAdd: true, rows });
    }
    return out;
  }
  const ts = plan.tasks.filter(visibleTask); const map = new Map();
  if (ui.groupBy === 'film') {
    map.set('Gemensamt', []); filmsList().forEach(f => map.set('Film ' + f, []));
    ts.forEach(t => { const k = t.film ? 'Film ' + t.film : 'Gemensamt'; if (!map.has(k)) map.set(k, []); map.get(k).push(t); });
    for (const [, list] of map) list.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  } else {
    GROUP_ORDER.forEach(k => map.set(k, []));
    ts.forEach(t => { const k = t.group || 'Övrigt'; if (!map.has(k)) map.set(k, []); map.get(k).push(t); });
  }
  for (const [g, list] of map) {
    if (!list.length) continue;
    let rows;
    if (ui.rows === 'detail') rows = list.map(t => ({ key: 'd:' + t.id, label: t.name, tag: filmTag(t), sub: (result.dates[t.id] && result.dates[t.id].members || []).map(memberName).join(' + '), tasks: [t], detail: true }));
    else {
      const m = new Map();
      list.forEach(t => {
        const r = result.dates[t.id]; if (!r) return;
        const mem = r.members && r.members.length ? r.members : null;
        const key = mem ? 'p:' + mem.slice().sort().join('+') : 'n:' + baseName(t.name);
        if (!m.has(key)) { const pool = t.res && poolById(t.res); m.set(key, mem ? { key, label: mem.map(memberName).join(' + '), sub: pool ? pool.name : '', tasks: [] } : { key, label: baseName(t.name), sub: '', tasks: [] }); }
        m.get(key).tasks.push(t);
      });
      rows = [...m.values()].map(row => { const films = [...new Set(row.tasks.map(t => t.film).filter(Boolean))]; if (!row.sub && films.length > 1) row.sub = films.map(f => 'F' + f).join(' · '); if (films.length === 1 && row.tasks.length === 1) row.tag = 'F' + films[0]; return row; });
    }
    out.push({ key: g, label: g, color: ui.groupBy === 'dept' ? deptColor(g) : 'var(--d-ovr)', rows });
  }
  return out;
}
// Staplar i banor utan överlapp; milstolpar ligger ovanpå sin stapel
function lanesFor(tasks) {
  const bars = tasks.filter(t => !isMsT(t) && result.dates[t.id]).sort((a, b) => result.dates[a.id].start < result.dates[b.id].start ? -1 : 1);
  const lanes = []; const laneOf = {};
  bars.forEach(t => { const r = result.dates[t.id]; let i = lanes.findIndex(end => end < r.start); if (i < 0) { i = lanes.length; lanes.push(''); } lanes[i] = r.end; laneOf[t.id] = i; });
  tasks.filter(t => isMsT(t) && result.dates[t.id]).forEach(t => {
    const d = result.dates[t.id].start;
    const host = bars.find(b => result.dates[b.id].start <= d && result.dates[b.id].end >= d && (t.deps || []).some(x => x.id === b.id)) || bars.find(b => result.dates[b.id].start <= d && result.dates[b.id].end >= d);
    laneOf[t.id] = host ? laneOf[host.id] : 0;
  });
  return { n: Math.max(1, lanes.length), laneOf };
}
function range() {
  let a = null, b = null;
  for (const id in result.dates) { const r = result.dates[id]; if (!a || r.start < a) a = r.start; if (!b || r.end > b) b = r.end; }
  a = a || '2027-01-01'; b = b || '2027-12-31';
  const s = toD(a); const start = toS(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1)));
  const e = toD(b); const end = toS(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)));
  return { start, end: addDays(end, 31) };
}
// Icke-arbetsdagar inne i en stapel (röda dagar, uppehåll, ledighet) – helger räknas inte
function pauses(t, r) {
  if (!r || isMsT(t) || t.type === 'fixed' || ui.zoom === 'quarter') return [];
  const cal = result.cal; const ck = r.cal || calKey(t); const who = r.members || null;
  const runs = []; let cur = null;
  for (let s = r.start; s <= r.end; s = addDays(s, 1)) {
    const w = dow(s); const normalOff = w === 0 || w === 6 || (ck.startsWith('s4') && w === 5);
    const off = !normalOff && !cal.isWork(s, ck, who);
    if (off) { if (!cur) { cur = { from: s, to: s, why: cal.hol[s] || cal.brk[s] || 'Ledig' }; runs.push(cur); } else cur.to = s; }
    else if (!normalOff) cur = null;
  }
  return runs;
}
let geo = null;
function rowDates(row) {
  let a = null, b = null; row.tasks.forEach(t => { const r = result.dates[t.id]; if (!r) return; if (!a || r.start < a) a = r.start; if (!b || r.end > b) b = r.end; });
  if (!a) return '';
  const y = s => String(toD(s).getUTCFullYear()).slice(2);
  return `<span class="rd" title="${fmt(a)} – ${fmt(b)}">${a === b ? fmtShort(a) + ' ' + y(a) : fmtShort(a) + (y(a) !== y(b) ? ' ' + y(a) : '') + '–' + fmtShort(b) + ' ' + y(b)}</span>`;
}
function renderGantt() {
  const px = PX[ui.zoom]; const R = range(); const total = daysBetween(R.start, R.end) + 1; const W = total * px;
  const X = s => daysBetween(R.start, s) * px;
  geo = { px, R, X };
  const cal = result.cal;
  let scale = '', over = '';
  for (let s = R.start; s <= R.end; s = addDays(s, 1)) {
    const d = toD(s); const wd = d.getUTCDay(); const we = wd === 0 || wd === 6;
    if (d.getUTCDate() === 1) {
      const lbl = ui.zoom === 'quarter' ? MON[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : '') : (ui.zoom === 'month' ? MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2) : MONL[d.getUTCMonth()] + ' ' + d.getUTCFullYear());
      scale += `<div class="m" style="left:${X(s)}px">${esc(lbl)}</div>`;
      over += `<div class="vl month" style="left:${X(s)}px"></div>`;
    }
    if (ui.zoom === 'day') {
      scale += `<div class="dd${we ? ' we' : ''}${cal.hol[s] ? ' hol' : ''}${cal.brk[s] && !we ? ' brk' : ''}" style="left:${X(s)}px;width:${px}px"${cal.hol[s] || cal.brk[s] ? ` title="${esc(cal.hol[s] || cal.brk[s])}"` : ''}>${d.getUTCDate()}</div>`;
      over += `<div class="vl ${wd === 1 ? 'week' : 'day'}" style="left:${X(s)}px"></div>`;
    } else if (ui.zoom === 'week') {
      if (wd === 1) scale += `<div class="w" style="left:${X(s)}px;width:${px * 7}px">v${isoWeek(s)}</div>`;
      over += `<div class="vl ${wd === 1 ? 'week' : 'day'}" style="left:${X(s)}px"></div>`;
    } else if (wd === 1 && ui.zoom === 'month') {
      scale += `<div class="w" style="left:${X(s)}px;width:${px * 7}px">${isoWeek(s)}</div>`;
      over += `<div class="vl week" style="left:${X(s)}px"></div>`;
    }
    if (ui.zoom !== 'quarter' && we) over += `<div class="band we" style="left:${X(s)}px;width:${px}px"></div>`;
    if (cal.hol[s] && !we) over += `<div class="band hol" style="left:${X(s)}px;width:${Math.max(px, 2)}px" title="${esc(cal.hol[s])}"></div>`;
    else if (cal.brk[s] && !we) over += `<div class="band brk" style="left:${X(s)}px;width:${Math.max(px, 1)}px" title="${esc(cal.brk[s])}"></div>`;
  }
  (plan.settings.breaks || []).filter(b => b.on && b.to >= R.start && b.from <= R.end).forEach(b => { scale += `<div class="bkl" style="left:${X(b.from)}px;width:${Math.max(X(addDays(b.to, 1)) - X(b.from), 2)}px" title="${esc(b.name)} ${fmtShort(b.from)}–${fmt(b.to)}">${ui.zoom === 'quarter' ? '' : esc(b.name)}</div>`; });
  const today = toS(new Date());
  if (today >= R.start && today <= R.end) over += `<div class="today" style="left:${X(today)}px" title="Idag"></div>`;

  let html = ''; let y = 0; const pos = {};
  for (const sec of layoutSections()) {
    const collapsed = ui.collapsed.includes(sec.key);
    let a = null, b = null; sec.rows.forEach(row => row.tasks.forEach(t => { const r = result.dates[t.id]; if (!r) return; if (!a || r.start < a) a = r.start; if (!b || r.end > b) b = r.end; }));
    const n = sec.rows.reduce((s, r) => s + r.tasks.length, 0);
    const sum = a ? `<div class="bar sum" style="--c:${sec.color};left:${X(a)}px;width:${Math.max(X(addDays(b, 1)) - X(a), 3)}px"></div>` : '';
    html += `<div class="row group${collapsed ? ' collapsed' : ''}" data-group="${esc(sec.key)}" data-section="${esc(sec.key)}"><div class="name"><span class="chev">▾</span>${ui.groupBy === 'dept' || ui.rows === 'manual' ? `<i style="background:${sec.color}"></i>` : ''}<span class="gl">${esc(sec.label)}</span> <span class="rs">${n}</span>${sec.rowAdd ? `<button class="addrow" type="button" data-act="addrow" data-section="${esc(sec.key)}" title="Ny rad i ${esc(sec.label)}">+ rad</button>` : ''}</div><div class="lane" style="width:${W}px">${collapsed ? sum : ''}</div></div>`;
    y += GROUP_H;
    if (collapsed) continue;
    for (const row of sec.rows) {
      const L = lanesFor(row.tasks); const h = L.n * ROW_H;
      let lane = '';
      const single = row.tasks.length === 1;
      for (const t of row.tasks) {
        const r = result.dates[t.id]; if (!r) continue;
        const c = barColor(t); const hit = sel.has(t.id) ? ' hit' : '';
        const top = L.laneOf[t.id] * ROW_H;
        if (isMsT(t)) {
          const onBar = row.tasks.some(b => !isMsT(b) && result.dates[b.id] && result.dates[b.id].end === r.start);
          const x = onBar ? X(addDays(r.start, 1)) : X(r.start) + px / 2;
          lane += `<div class="ms${hit}${matchF(t) ? '' : ' dim'}${(t.to || []).length ? ' to' : ''}${t.locked ? ' locked' : ''}${r.lock ? ' mg-' + r.lock : ''}" data-id="${esc(t.id)}" style="--c:${c};left:${x}px;top:${top + ROW_H / 2}px" title="${esc(label(t))} ${fmt(r.start)}"></div>`;
          lane += `<div class="lbl${matchF(t) ? '' : ' dim'}" style="left:${x + 10}px;top:${top}px">${esc(single ? '' : (t.name + (t.film ? ' F' + t.film : '')))} ${fmtShort(r.start)}${(t.to || []).length ? ' · ' + esc(recipNames(t)) : ''}</div>`;
          pos[t.id] = { x1: x, x2: x, y: y + top + ROW_H / 2 };
          continue;
        }
        const left = X(r.start), w = Math.max(X(addDays(r.end, 1)) - left, 3);
        const fixed = t.type === 'fixed';
        const full = row.detail || (single && ui.rows !== 'manual') ? t.name : label(t);
        const txt = w > full.length * 6.4 + 14 ? full : (w > 26 && t.film ? 'F' + t.film : '');
        if (r.waited) { const ws = X(addDays(r.start, -Math.round(r.waited * 7 / 5))); lane += `<div class="wait" style="left:${ws}px;width:${left - ws}px;top:${top + ROW_H / 2}px" title="Väntar ${r.waited} arbetsdagar"></div>`; }
        if (ui.cmp) { const g = cmpBase()[t.id]; if (g && (g.start !== r.start || g.end !== r.end)) lane += `<div class="ghost" style="left:${X(g.start)}px;width:${Math.max(X(addDays(g.end, 1)) - X(g.start), 3)}px;top:${top + ROW_H - 7}px" title="${esc(ui.cmp)}: ${fmt(g.start)} – ${fmt(g.end)}"></div>`; }
        const pz = pauses(t, r).map(p => `<span class="pz" style="left:${X(p.from) - left}px;width:${Math.max(X(addDays(p.to, 1)) - X(p.from), 1)}px" title="${esc(p.why)}"></span>`).join('');
        const flags = w < 60 ? '' : (t.ignoreHol ? '<span class="fl-i" title="Jobbar på röda dagar">R</span>' : '') + (t.ignoreBreaks ? '<span class="fl-i" title="Jobbar under uppehåll och ledighet">U</span>' : '');
        const cls = ['bar', matchF(t) ? '' : 'dim', t.light ? 'light' : '', fixed ? 'fixed rz' : 'rz', t.notBefore ? 'pinned' : '', t.splitOf ? 'part' : '', t.locked ? 'locked' : '', r.lock ? 'mg-' + r.lock : '', t.read ? 'read' : ''].filter(Boolean).join(' ');
        const who = (r.members || []).map(memberName).join(' + ');
        lane += `<div class="${cls}${hit}" data-id="${esc(t.id)}" style="--c:${c};left:${left}px;width:${w}px;top:${top + 5}px" title="${esc(label(t))}: ${fmt(r.start)} – ${fmt(r.end)}${r.dur ? ' · ' + r.dur + ' arbetsdagar' : ''}${who ? ' · ' + esc(who) : ''}${t.notBefore ? ' · låst tidigast ' + fmt(t.notBefore) : ''}${t.status && STATUS[t.status] ? ' · ' + STATUS[t.status].l : ''}${t.note ? ' · ' + esc(t.note) : ''}${t.read ? ' · ' + esc(readText(t, r)) : ''}${(t.doers || []).length ? ' · Utförs av ' + esc(t.doers.map(d => personName(d.id) + (d.pct !== 100 ? ' ' + d.pct + ' %' : '')).join(', ')) : ''}${t.owner ? ' · Ansvarig ' + esc(personName(t.owner)) : ''}">${t.read ? '<span class="rd rd-s"></span><span class="rd rd-e"></span>' : ''}${pz}${statusBadge(t, w)}${noteMark(t)}<span class="bt">${esc(txt)}</span>${flags}</div>`;
        if (sel.has(t.id) && sel.size === 1 && !FREE()) lane += `<div class="lk lk-s" data-id="${esc(t.id)}" style="left:${left - 14}px;top:${top + 8}px" title="Dra till en annan stapel: den startar när den här startar"></div><div class="lk lk-e" data-id="${esc(t.id)}" style="left:${left + w + 3}px;top:${top + 8}px" title="Dra till en annan stapel: den väntar tills den här är klar"></div>`;
        const fbTxt = t.read ? `feedback ${wdOf(r.end)} ${fmtShort(r.end)}, ${t.fbAt || 'dagens slut'}` : '';
        if (single) lane += `<div class="lbl" style="left:${left + w + (sel.has(t.id) && sel.size === 1 ? 20 : 6)}px;top:${top}px">${esc(txt === full ? '' : full + ' · ')}${fmtShort(r.start)} – ${fmtShort(r.end)}${fbTxt ? ' · ' + esc(fbTxt) : ''}</div>`;
        else if (fbTxt && (ui.zoom === 'day' || ui.zoom === 'week')) lane += `<div class="lbl rdl" style="left:${left + w + (sel.has(t.id) && sel.size === 1 ? 20 : 6)}px;top:${top}px">${esc(fbTxt)}</div>`;
        pos[t.id] = { x1: left, x2: left + w, y: y + top + ROW_H / 2 };
      }
      const t0 = row.tasks[0];
      const selRow = row.tasks.length && row.tasks.every(t => sel.has(t.id)) ? ' sel' : '';
      const rowAttr = row.rowId ? ` data-rowid="${esc(row.rowId)}"` : '';
      const tg = row.rowId ? (rowById(row.rowId) || {}).section : (t0 ? t0.group : sec.key);
      const nameTitle = ui.rows === 'manual' ? 'Klicka: markera radens faser · dubbelklicka: byt namn · dra: flytta raden · högerklicka: fler val' : (ui.rows === 'detail' ? 'Dra för att flytta raden' : 'Klicka för att markera radens arbete');
      html += `<div class="row${selRow}${row.tasks.length ? '' : ' empty'}" style="height:${h}px" data-row="${esc(row.key)}"${rowAttr} data-section="${esc(sec.key)}" data-tg="${esc(tg || '')}" data-film="${t0 && t0.film && !row.rowId ? t0.film : ''}"${row.detail ? ` data-id="${esc(t0.id)}"` : ''}><div class="name${row.bold ? ' rb' : ''}${row.fill ? ' rf' : ''}" title="${esc(nameTitle)}" style="${row.indent ? `padding-left:${10 + row.indent * 16}px;` : ''}${row.fill ? `--rf:var(--x-${row.fill});` : ''}">${row.kids ? `<button type="button" class="rchev${row.folded ? ' folded' : ''}" data-act="rtoggle" data-rid="${esc(row.rowId)}" aria-label="${row.folded ? 'Visa' : 'Dölj'} underrader">▾</button>` : ''}<span class="grip" aria-hidden="true"></span><span class="fl">${esc(row.tag || '')}</span><span class="nm">${esc(row.label)}</span>${row.sub ? `<span class="sub">${esc(row.sub)}</span>` : ''}${ui.rows === 'manual' && !row.tasks.length ? '<span class="sub">tom – rita här</span>' : ''}${rowDates(row)}</div><div class="lane" style="width:${W}px">${lane}</div></div>`;
      y += h;
    }
  }
  const scroller = $('#scroller'); const keepL = scroller.scrollLeft, keepT = scroller.scrollTop;
  $('#grid').style.width = `calc(var(--name-w) + ${W}px)`;
  $('#grid').className = 'grid z-' + ui.zoom;
  $('#grid').innerHTML = `<div class="hdr"><div class="corner">${ui.rows === 'manual' ? 'Rad' : ui.rows === 'packed' ? 'Vem' : 'Fas'}</div><div class="scale" style="width:${W}px">${scale}</div></div>
    <div class="lanes"><div class="overlay" style="left:var(--name-w);width:${W}px">${over}</div><div class="rowsbox">${html}</div><svg class="arrows" id="arrows" style="left:var(--name-w)" width="${W}" height="${y}" aria-hidden="true"></svg></div>`;
  scroller.scrollLeft = keepL; scroller.scrollTop = keepT;
  geo.pos = pos; geo.H = y;
  renderArrows();
  renderSelBar();
}
function renderArrows() {
  const svg = $('#arrows'); if (!svg || !geo) return;
  if (ui.arrows === 'off' || FREE()) { svg.innerHTML = ''; return; }
  const pos = geo.pos; let paths = '';
  plan.tasks.forEach(t => (t.deps || []).map(d => [d, '']).concat((t.soft || []).map(d => [d, 'soft'])).forEach(([d, kind]) => {
    const a = pos[d.id], b = pos[t.id]; if (!a || !b) return;
    const on = sel.has(t.id) || sel.has(d.id);
    if (ui.arrows === 'sel' && !on) return;
    const x0 = d.type === 'SS' ? a.x1 : a.x2, x1 = d.type === 'FF' ? b.x2 : b.x1;
    const y0 = a.y, y1 = b.y;
    const mid = Math.max(x0 + 8, Math.min(x1 - 8, x0 + 12));
    const p = Math.abs(y1 - y0) < 2 ? `M${x0},${y0} H${x1 - 4}` : `M${x0},${y0} H${mid} V${y1} H${x1 - 4}`;
    paths += `<path class="${[on ? 'on' : '', kind].filter(Boolean).join(' ')}" d="${p}" marker-end="url(#ah${on ? 'on' : ''})"></path>`;
    if (d.lag && on) paths += `<text x="${mid + 3}" y="${(y0 + y1) / 2 - 3}">${d.lag > 0 ? '+' : ''}${d.lag} d</text>`;
  }));
  svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="ahp"></path></marker><marker id="ahon" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="ahp on"></path></marker></defs>${paths}`;
}
function renderSelBar() {
  const n = sel.size; const b = $('#selbar');
  if (!n) { b.hidden = true; return; }
  b.hidden = false;
  const one = n === 1 ? taskById([...sel][0]) : null;
  b.innerHTML = `<b>${n} ${n === 1 ? 'fas' : 'faser'} markerade</b>
    <button class="btn small" type="button" data-act="res">Resurs…</button>
    <button class="btn small" type="button" data-act="cal">Röda dagar och uppehåll…</button>
    <button class="btn small" type="button" data-act="dup">Duplicera</button>
    <button class="btn small" type="button" data-act="tpl">Spara som mall</button>
    ${one && !isMsT(one) ? `<button class="btn small" type="button" data-act="split">Dela</button><button class="btn small" type="button" data-act="msend">+ Milstolpe vid slut</button>` : ''}
    <button class="btn small danger" type="button" data-act="del">Ta bort</button>
    <button class="btn small" type="button" data-act="clear">Avmarkera</button>`;
}
function renderLegend() {
  const used = new Set(plan.tasks.map(t => t.group));
  $('#legend').innerHTML = GROUP_ORDER.filter(g => used.has(g)).map(g => `<span><i style="background:${deptColor(g)}"></i>${esc(g)}</span>`).join('') +
    `<span><i class="lg-hol"></i>Röd dag</span><span><i class="lg-brk"></i>Uppehåll</span><span><i class="lg-pz"></i>Paus i stapel</span><span><i class="w8"></i>Väntar på ledig person</span><span><i style="background:var(--ink);opacity:.55;width:3px"></i>Flyttad för hand</span>`;
}
function renderControls() {
  $$('#zoom button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ui.zoom));
  const films = filmsList(); if (ui.film !== 'all' && !films.includes(Number(ui.film))) ui.film = 'all';
  $('#film').innerHTML = `<button type="button" data-v="all" aria-pressed="${ui.film === 'all'}">Alla</button>` + films.map(f => `<button type="button" data-v="${f}" aria-pressed="${String(ui.film) === String(f)}">F${f}</button>`).join('');
  $$('#groupby button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ui.groupBy));
  $('#groupwrap').hidden = ui.rows === 'manual';
  $$('#rowmode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ui.rows));
  $$('#arrowmode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ui.arrows));
  renderRulesCtl();
}
function render() {
  renderSource(); renderKeys(); renderAlerts(); renderControls(); renderGantt(); renderLegend(); renderFilterInfo();
  ({ task: renderTaskPanel, multi: renderMultiPanel, res: renderResPanel, tpl: renderTplPanel, cal: renderCalPanel, sec: renderSecPanel, rules: renderRulesPanel, newproj: renderNewProjPanel, var: renderVarPanel, calexp: renderCalExportPanel, pdfexp: renderPdfPanel, bud: renderBudPanel, log: renderLogPanel, ai: renderAiPanel, imp: renderImportPanel }[panelMode] || (() => {}))();
}

// ---- Markering ----
function select(ids, opts) {
  opts = opts || {};
  if (opts.toggle) ids.forEach(id => sel.has(id) ? sel.delete(id) : sel.add(id));
  else sel = new Set(ids);
  if (sel.size === 1 && opts.open !== false) { selected = [...sel][0]; panelMode = 'task'; }
  else if (sel.size > 1) { selected = null; if (panelMode === 'task' || panelMode === 'multi' || opts.open) panelMode = 'multi'; }
  else if (!sel.size && (panelMode === 'task' || panelMode === 'multi')) { selected = null; panelMode = null; $('#panel').hidden = true; }
  renderGantt();
  ({ task: renderTaskPanel, multi: renderMultiPanel, res: renderResPanel, cal: renderCalPanel, tpl: renderTplPanel }[panelMode] || (() => {}))();
}
function clearSel() { select([]); }
function closePanel() { selected = null; if (panelMode === 'task' || panelMode === 'multi') sel = new Set(); panelMode = null; $('#panel').hidden = true; $('#panel').classList.remove('wide'); renderGantt(); }
function openPanel(mode) { panelMode = mode; render(); }

// ---- Operationer ----
function opDuplicate(ids) {
  ids = ids || [...sel]; if (!ids.length) return;
  const before = milestoneSnapshot();
  const added = change(() => duplicateTasks(plan, ids));
  select(added, { open: added.length === 1 });
  toast(`Duplicerade ${added.length} ${added.length === 1 ? 'fas' : 'faser'} på samma rad.${impact(before)}`, 5000);
}
function opDelete(ids) {
  ids = ids || [...sel]; if (!ids.length) return;
  const before = milestoneSnapshot();
  const names = ids.map(id => label(taskById(id))).slice(0, 3).join(', ');
  change(() => removeTasks(plan, ids));
  sel = new Set(); selected = null; if (panelMode === 'task' || panelMode === 'multi') { panelMode = null; $('#panel').hidden = true; }
  renderGantt(); toast(`Tog bort ${names}${ids.length > 3 ? ' m.fl.' : ''}. Det som väntade på dem tar över deras beroenden. Ångra med ${mod}Z.${impact(before)}`, 6000);
}
function opSplit(id, at) {
  const t = taskById(id); const r = result.dates[id]; if (!t || !r) return;
  if (!at) { const n = Math.max(2, r.dur || 2); at = result.cal.addWork(r.start, Math.floor(n / 2), r.cal || 'w5'); }
  pushUndo();
  if (FREE() && t.type !== 'fixed') {
    if (at <= r.start || at > r.end) { undoStack.pop(); toast('Välj ett datum inne i stapeln'); return; }
    const root = t.splitOf || t.id; const first = clone(t); first.id = uniqueId(plan, root + '_del'); first.splitOf = root; first.fs = r.start; first.fe = addDays(at, -1);
    t.fs = at; t.fe = r.end; t.splitOf = root; t.deps = [{ id: first.id, type: 'FS', lag: 0 }]; plan.tasks.splice(plan.tasks.indexOf(t), 0, first);
    dirty = true; recompute(); select([t.id], { open: true }); toast(`Delad vid ${fmt(at)}. Dra delarna dit du vill.`, 5000); return;
  }
  const res = splitTask(plan, result, id, at);
  if (res.error) { undoStack.pop(); toast(res.error); return; }
  dirty = true; recompute(); select([res.last], { open: true });
  toast(`Delad vid ${fmt(at)}. Dra den andra delen för att skapa ett uppehåll.`, 5000);
}
function opShift(ids, days) {
  ids = ids.filter(id => taskById(id)); if (!ids.length || !days) return;
  const before = milestoneSnapshot(); let skipped = 0;
  if (FREE()) change(() => ids.forEach(id => { const t = taskById(id); if (t.type === 'fixed') { t.start = addDays(t.start, days); t.end = addDays(t.end || t.start, days); } else { t.fs = addDays(t.fs || result.dates[id].start, days); t.fe = addDays(t.fe || result.dates[id].end, days); } }));
  else change(() => { skipped = shiftTasks(plan, result, ids, days).skipped; });
  toast(`Flyttade ${ids.length - skipped} ${ids.length - skipped === 1 ? 'fas' : 'faser'} ${days > 0 ? '+' : '−'}${Math.abs(days)} d.${skipped ? ` ${skipped} låsta hållpunkter eller framräknade milstolpar flyttades inte.` : ''}${impact(before)}`, 5000);
}
function opCopy(ids) {
  ids = ids || [...sel]; if (!ids.length) return;
  const tpl = templateFromTasks(plan, result, ids, 'Urklipp');
  const films = [...new Set(ids.map(id => taskById(id).film).filter(Boolean))];
  clipboard = { tpl, start: ids.map(id => result.dates[id].start).sort()[0], film: films.length === 1 ? films[0] : null, n: ids.length };
  toast(`Kopierade ${ids.length} ${ids.length === 1 ? 'fas' : 'faser'}. Klistra in med ${mod}V, eller högerklicka i en rad och välj Klistra in här.`, 5000);
}
function opPaste(atDate, rowEl) {
  if (!clipboard) { toast(`Urklipp är tomt. Markera faser och kopiera med ${mod}C.`); return; }
  const before = milestoneSnapshot();
  const rowId = rowEl && rowEl.dataset.rowid;
  const added = change(() => insertTemplate(plan, clipboard.tpl, { film: clipboard.film || undefined, suffix: '_v', notBefore: atDate || clipboard.start, row: rowId || undefined }));
  select(added, { open: false });
  toast(`Klistrade in ${added.length} ${added.length === 1 ? 'fas' : 'faser'} från ${fmt(atDate || clipboard.start)}.${impact(before)}`, 5000);
}
function opSaveTemplate(ids, name) {
  ids = ids || [...sel]; if (!ids.length) return;
  const tpl = templateFromTasks(plan, result, ids, name || 'Ny mall');
  const roots = tpl.tasks.filter(o => !o.deps.length).map(o => o.lid);
  change(() => { templates = templates.filter(t => t.name !== tpl.name); templates.push(tpl); });
  toast(`Mallen “${tpl.name}” sparad med ${tpl.tasks.length} faser. Startfaser: ${roots.join(', ')}. Spara till Sheet för att dela den.`, 6000);
  openPanel('tpl');
}
function opInsertTemplate(i, film, depsStr, notBefore) {
  const tpl = templates[i]; if (!tpl) return;
  const before = milestoneSnapshot();
  const rootDeps = strToDeps(depsStr);
  const unknown = rootDeps.filter(d => !taskById(d.id)).map(d => d.id);
  if (unknown.length) { toast(`Okänt ID i kopplingen: ${unknown.join(', ')}`); return; }
  const added = change(() => insertTemplate(plan, tpl, { film: film || undefined, rootDeps, notBefore: notBefore || undefined }));
  select(added, { open: false });
  const lev = added.map(taskById).filter(t => isMsT(t)).map(t => `${t.name} ${fmt(result.dates[t.id].start)}`);
  toast(`La in “${tpl.name}”${film ? ' som film ' + film : ''}: ${added.length} faser.${lev.length ? ' ' + lev.join(', ') + '.' : ''}${impact(before)}`, 7000);
}
function newTaskAt(start, n, rowEl) {
  const rowId = rowEl && rowEl.dataset.rowid;
  const sec = rowId ? (rowById(rowId) || {}).section : (rowEl ? rowEl.dataset.tg : 'Förproduktion');
  const film = rowEl && rowEl.dataset.film ? Number(rowEl.dataset.film) : null;
  const key = rowEl ? (rowEl.dataset.row || '') : '';
  const t = { id: uniqueId(plan, 'ny'), name: 'Ny fas', group: GROUP_ORDER.includes(sec) ? sec : 'Förproduktion', dur: Math.max(1, n || 5), deps: [], notBefore: start };
  if (film) t.film = film;
  if (rowId) t.row = rowId;
  else { const rowTask = rowEl && rowEl.querySelector('[data-id]'); if (rowTask) t.row = (taskById(rowTask.dataset.id) || {}).row; }
  if (key.startsWith('p:')) { const mems = key.slice(2).split('+'); const pid = result.memberPool[mems[0]]; if (pid) { t.res = pid; if (mems.length === 1) t.member = mems[0]; else t.crew = mems.length; } }
  change(() => { plan.tasks.push(t); });
  select([t.id], { open: true });
  setTimeout(() => { const f = $('#pName'); if (f) { f.focus(); f.select(); } }, 0);
}
function addMilestoneAtEnd(id) {
  const t = taskById(id); if (!t || isMsT(t)) return;
  const m = { id: uniqueId(plan, t.id + '_ms'), name: 'Milstolpe', group: t.group, type: 'milestone', ms: true, deps: [{ id: t.id, type: 'FF', lag: 0 }], row: t.row };
  if (t.film) m.film = t.film;
  change(() => { plan.tasks.splice(plan.tasks.indexOf(t) + 1, 0, m); });
  select([m.id], { open: true });
  setTimeout(() => { const f = $('#pName'); if (f) { f.focus(); f.select(); } }, 0);
}
function setColor(ids, color) { change(() => ids.forEach(id => { const t = taskById(id); if (t) { if (color) t.color = color; else delete t.color; } })); }
function setFlag(ids, key, on) {
  const before = milestoneSnapshot();
  change(() => ids.forEach(id => { const t = taskById(id); if (t && !isMsT(t) && t.type !== 'fixed') { if (on) t[key] = true; else delete t[key]; } }));
  toast(`${ids.length} ${ids.length === 1 ? 'fas' : 'faser'} ${on ? 'jobbar nu' : 'pausar nu'} ${key === 'ignoreHol' ? 'på röda dagar' : 'under uppehåll och ledighet'}.${impact(before)}`, 5000);
}
function assign(ids, poolId, memberId) {
  const before = milestoneSnapshot(); let n = 0;
  change(() => ids.forEach(id => { const t = taskById(id); if (!t || isMsT(t) || t.type === 'fixed') return; n++; if (poolId) t.res = poolId; else delete t.res; delete t.with; if (memberId) t.member = memberId; else delete t.member; const g = poolById(poolId); if (!g || t.crew > g.members.length) delete t.crew; }));
  toast(`${n} ${n === 1 ? 'fas' : 'faser'} görs nu av ${memberId ? memberName(memberId) : poolId ? (poolById(poolId) || {}).name + ' (den som är ledig först)' : 'ingen särskild resurs'}.${impact(before)}`, 5000);
}
function addDep(fromId, toId, type) {
  const a = taskById(fromId), b = taskById(toId); if (!a || !b || fromId === toId) return;
  if (dependsOn(fromId, toId)) { toast(`Det går inte: ${label(a)} väntar redan på ${label(b)}, så det skulle bli en slinga.`); renderGantt(); return; }
  if ((b.deps || []).some(d => d.id === fromId)) { toast(`${label(b)} väntar redan på ${label(a)}.`); renderGantt(); return; }
  if (b.type === 'fixed') { toast(`${label(b)} har låsta datum. Ändra typen till Fas som räknas fram för att den ska kunna vänta på något.`, 5000); renderGantt(); return; }
  const before = milestoneSnapshot();
  const t = isMsT(b) ? 'FF' : type;
  change(() => { b.deps = (b.deps || []).concat([{ id: fromId, type: t, lag: 0 }]); });
  toast(`${label(b)} ${t === 'SS' ? 'startar när' : t === 'FF' ? 'ligger på slutdagen för' : 'väntar på'} ${label(a)}${t === 'SS' ? ' startar' : ''}.${impact(before)} Ändra typ och marginal i panelen.`, 6000);
}

// ---- Rader: åtgärder ----
function rowAdd(section, afterId, before) {
  let id;
  change(() => {
    id = newRow(plan, 'Ny rad', section, afterId);
    if (before) { const r = rowById(id); plan.rows.splice(plan.rows.indexOf(r), 1); plan.rows.splice(plan.rows.findIndex(x => x.id === before), 0, r); }
  });
  setTimeout(() => renameRow(id), 0);
}
function renameRow(id) {
  const el = $(`.row[data-rowid="${CSS.escape(id)}"] .nm`); const r = rowById(id); if (!el || !r) return;
  el.innerHTML = `<input class="rn" value="${esc(r.name)}" aria-label="Radens namn">`;
  const inp = el.querySelector('input'); inp.focus(); inp.select();
  const done = ok => { if (done.d) return; done.d = true; const v = inp.value.trim(); if (ok && v && v !== r.name) change(() => { r.name = v; }); else renderGantt(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
  inp.addEventListener('blur', () => done(true));
}
function moveRow(id, dir) {
  const r = rowById(id); if (!r) return;
  const same = plan.rows.filter(x => x.section === r.section); const i = same.indexOf(r); const j = i + dir;
  if (j < 0 || j >= same.length) { toast(dir < 0 ? 'Raden ligger redan först i sektionen. Dra den för att flytta den till en annan sektion.' : 'Raden ligger redan sist i sektionen.'); return; }
  change(() => { const other = same[j]; const a = plan.rows.indexOf(r), b = plan.rows.indexOf(other); plan.rows[a] = other; plan.rows[b] = r; });
}
function deleteRow(id, withTasks) {
  const r = rowById(id); if (!r) return;
  const ts = plan.tasks.filter(t => t.row === id).map(t => t.id);
  const before = milestoneSnapshot();
  change(() => { if (withTasks && ts.length) removeTasks(plan, ts); else plan.tasks.forEach(t => { if (t.row === id) delete t.row; }); plan.rows = plan.rows.filter(x => x.id !== id); });
  toast(`Raden “${r.name}” är borttagen${ts.length ? withTasks ? ` med ${ts.length} faser` : `. Dess ${ts.length} faser fick egna rader` : ''}.${impact(before)}`, 5000);
}

// ---- Panel: en fas ----
function swatches(cur, act) {
  return `<div class="swatches">${COLORS.map(([k, n]) => `<button type="button" class="sw${(cur || '') === k ? ' on' : ''}" data-act="${act}" data-color="${k}" title="${n}" aria-label="${n}" style="--c:${k ? `var(--x-${k})` : 'var(--surface-2)'}">${k ? '' : 'A'}</button>`).join('')}</div>`;
}
function taskOptions(excludeId, cur) {
  const secs = sections(); const opts = [];
  for (const sec of secs) {
    const ts = plan.tasks.filter(t => t.id !== excludeId && (t.group || 'Övrigt') === sec); if (!ts.length) continue;
    opts.push(`<optgroup label="${esc(sec)}">${ts.map(t => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${esc(label(t))}</option>`).join('')}</optgroup>`);
  }
  const rest = plan.tasks.filter(t => t.id !== excludeId && !secs.includes(t.group || 'Övrigt'));
  if (rest.length) opts.push(rest.map(t => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${esc(label(t))}</option>`).join(''));
  return opts.join('');
}
function depEditor(t) {
  const items = (t.deps || []).map((d, i) => ({ d, i, k: 'h' })).concat((t.soft || []).map((d, i) => ({ d, i, k: 's' })));
  const succ = plan.tasks.filter(x => (x.deps || []).concat(x.soft || []).some(d => d.id === t.id));
  const att = it => `data-i="${it.i}" data-k="${it.k}"`;
  return `<div class="deps">
    ${items.map(it => { const d = it.d; return `<div class="dep">
      <select data-f="dId" ${att(it)} aria-label="Väntar på">${taskById(d.id) ? '' : `<option value="${esc(d.id)}" selected>Okänt: ${esc(d.id)}</option>`}${taskOptions(t.id, d.id)}</select>
      <select data-f="dType" ${att(it)} aria-label="Typ">${DEP_TYPES.map(([k, n]) => `<option value="${k}" ${(d.type || 'FS') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <input type="number" data-f="dLag" ${att(it)} value="${d.lag || 0}" aria-label="Marginal i arbetsdagar" title="Marginal i arbetsdagar">
      <select data-f="dKind" ${att(it)} aria-label="Hårt eller mjukt" title="Hårt flyttar fasen. Mjukt flyttar aldrig, varnar bara."><option value="h" ${it.k === 'h' ? 'selected' : ''}>hårt</option><option value="s" ${it.k === 's' ? 'selected' : ''}>mjukt</option></select>
      <button class="xbtn" type="button" data-act="dDel" ${att(it)} aria-label="Ta bort beroendet">×</button></div>`; }).join('') || `<p class="hint">${t.locked ? 'Hållpunkten mäter ingen marginal ännu. Lägg till det den väntar på.' : 'Fasen väntar inte på något. Den startar vid Tidigast start eller planens början.'}</p>`}
    <select id="dNew" aria-label="Lägg till föregångare"><option value="">+ Väntar också på …</option>${taskOptions(t.id, null)}</select>
    ${succ.length ? `<div class="succ"><span class="hint">Följs av:</span> ${succ.map(x => `<button class="chip" type="button" data-act="goto" data-id="${esc(x.id)}">${esc(label(x))}</button>`).join(' ')}</div>` : ''}
    <span class="hint">${t.locked ? '<b>Låst:</b> flyttas aldrig. Det den väntar på används bara för att räkna marginalen. ' : '<b>Hårt</b> = flyttar fasen. <b>Mjukt</b> = flyttar aldrig, varnar bara om fasen hamnar för tidigt. '}<b>när den är klar</b> = startar dagen efter · <b>när den startar</b> = samtidig start · <b>på slutdagen</b> = för milstolpar. Siffran är marginal i arbetsdagar.</span>
  </div>`;
}
function renderTaskPanel() {
  const t = taskById(selected); const p = $('#panel'); p.classList.remove('wide');
  if (!t) { closePanel(); return; }
  const r = result.dates[t.id] || {};
  const fixed = t.type === 'fixed'; const isMs = isMsT(t);
  const pool = t.res && poolById(t.res);
  const poolOpts = `<option value="">– ingen –</option>` + plan.resources.map(x => `<option value="${esc(x.id)}" ${x.id === t.res ? 'selected' : ''}>${esc(x.name)} (${x.members.length})</option>`).join('');
  const memOpts = pool ? `<option value="">Den som är ledig först</option>` + pool.members.map(m => `<option value="${esc(m.id)}" ${m.id === t.member ? 'selected' : ''}>${esc(m.name)}</option>`).join('') : '';
  const withOpts = pool ? `<option value="">–</option>` + plan.tasks.filter(x => x.res === t.res && x.id !== t.id).map(x => `<option value="${esc(x.id)}" ${x.id === t.with ? 'selected' : ''}>${esc(label(x))}</option>`).join('') : '';
  const grpOpts = GROUP_ORDER.concat(GROUP_ORDER.includes(t.group) ? [] : [t.group || 'Övrigt']).map(g => `<option ${g === t.group ? 'selected' : ''}>${esc(g)}</option>`).join('');
  const rowOpts = sections().map(sec => { const rs = plan.rows.filter(x => x.section === sec); return rs.length ? `<optgroup label="${esc(sec)}">${rs.map(x => `<option value="${esc(x.id)}" ${x.id === t.row ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : ''; }).join('');
  const films = filmsList(); const nextF = (films[films.length - 1] || 0) + 1;
  const mb = t.mustFinishBefore && result.dates[t.mustFinishBefore];
  const hoursMode = !!t.hours;
  const mid = r.start && !isMs ? result.cal.addWork(r.start, Math.floor(Math.max(2, r.dur || 2) / 2), r.cal || 'w5') : '';
  const pz = pauses(t, r);
  p.innerHTML = `
    <header><div><div class="meta">${esc(t.group || '')}${t.film ? ' · Film ' + t.film : ''}${t.splitOf ? ' · delad fas' : ''}</div><h2>${esc(t.name)}</h2></div>
      <button class="btn small" data-act="close" type="button">Stäng</button></header>
    <div class="computed">
      <div><span>Start</span><span class="mono">${fmt(r.start)}</span></div>
      <div><span>Slut</span><span class="mono">${fmt(r.end)}</span></div>
      ${r.dur ? `<div><span>Längd</span><span class="mono">${r.dur} arbetsdagar</span></div>` : ''}
      ${r.members ? `<div><span>Görs av</span><span>${esc(r.members.map(memberName).join(', '))}</span></div>` : ''}
      ${pz.length ? `<div><span>Pausar</span><span>${esc(pz.map(x => `${x.why} ${fmtShort(x.from)}${x.to !== x.from ? '–' + fmtShort(x.to) : ''}`).join(', '))}</span></div>` : ''}
      ${r.waited ? `<div><span>Väntar på ledig person</span><span class="mono">${r.waited} arbetsdagar</span></div>` : ''}
      ${t.locked && r.slack != null ? `<div><span>Marginal till ${esc(label(taskById(r.slackBy) || { name: r.slackBy }))}</span><span class="mono">${r.slack} arbetsdagar${r.lock ? (r.lock === 'bad' ? ' – bruten' : ' – under ' + r.slackLim) : ''}</span></div>` : ''}
      ${mb ? `<div><span>Marginal till ${esc(label(taskById(t.mustFinishBefore)))}</span><span class="mono">${r.margin} arbetsdagar</span></div>` : ''}
      ${cmpBase()[t.id] && cmpBase()[t.id].end !== r.end ? `<div><span>${ui.cmp ? 'Slut i ' + esc(ui.cmp) : 'Slut senast hämtat'}</span><span class="mono">${fmt(cmpBase()[t.id].end)}</span></div>` : ''}
    </div>
    <div class="quick">
      <button class="btn small" type="button" data-act="dupOne">Duplicera</button>
      <button class="btn small" type="button" data-act="copyOne">Kopiera</button>
      ${!isMs ? '<button class="btn small" type="button" data-act="msend">+ Milstolpe vid slut</button>' : ''}
      <button class="btn small" type="button" data-act="tplOne">Spara som mall</button>

      <button class="btn small danger" data-act="del" type="button">Ta bort</button>
    </div>
    <div class="field"><label for="pName">Namn</label><input id="pName" value="${esc(t.name)}"></div>
    <div class="two"><div class="field"><label for="pStatus">Status</label><select id="pStatus">${statusOptions(t.status)}</select></div><div></div></div>
    <div class="field"><label for="pNote">Kommentar</label><textarea id="pNote" rows="2" placeholder="Syns när du håller över stapeln">${esc(t.note || '')}</textarea></div>
    <div class="two">
      <div class="field"><label for="pRow">Rad</label><select id="pRow">${rowOpts}</select></div>
      <div class="field"><label for="pFilm">Film</label><select id="pFilm"><option value="">Gemensam</option>${films.concat([nextF]).map(f => `<option value="${f}" ${t.film == f ? 'selected' : ''}>F${f}${f === nextF ? ' (ny)' : ''}</option>`).join('')}</select></div>
    </div>
    ${FREE() && !fixed ? `<div class="two"><div class="field"><label for="pFs">Start</label><input type="date" id="pFs" value="${esc(t.fs || r.start || '')}"></div>${isMs ? '' : `<div class="field"><label for="pFe">Slut</label><input type="date" id="pFe" value="${esc(t.fe || r.end || '')}"></div>`}</div><p class="hint">Beroenden är avslagna. Fasen ligger där du lägger den.</p>` : ''}
    ${(!fixed || t.locked) && !FREE() ? `<div class="field"><label>Väntar på</label>${depEditor(t)}</div>` : ''}
    ${!fixed && !isMs && !FREE() ? `<div class="field"><label>Arbetsdagar som räknas</label>
      <label class="check"><input type="checkbox" id="pIgnHol" ${t.ignoreHol ? 'checked' : ''}> Jobbar på röda dagar</label>
      <label class="check"><input type="checkbox" id="pIgnBrk" ${t.ignoreBreaks ? 'checked' : ''}> Jobbar under uppehåll och semester</label></div>` : ''}
    ${!isMs ? `<div class="field"><label for="pSplit">Dela fasen</label><div class="inline"><input type="date" id="pSplit" value="${esc(mid)}" min="${esc(r.start ? addDays(r.start, 1) : '')}" max="${esc(r.end || '')}"><button class="btn small" type="button" data-act="split">Dela här</button></div>
      <span class="hint">Andra delen börjar på datumet. Dra den sedan för att skapa ett uppehåll.</span></div>` : ''}
    ${!isMs ? `<div class="field"><label>Utförare</label>
      ${(t.doers || []).map((d, i) => `<div class="dep"><span class="dn">${esc(personName(d.id))}</span><input type="number" min="5" max="100" step="5" data-f="dPct" data-i="${i}" value="${d.pct || 100}" aria-label="Beläggning i procent"><span class="hint">%</span><button class="xbtn" type="button" data-act="doerDel" data-i="${i}" aria-label="Ta bort utföraren">×</button></div>`).join('')}
      <select id="doerNew" aria-label="Lägg till utförare"><option value="">${people === null ? 'Hämtar personregistret…' : '+ Lägg till utförare …'}</option>${(people || []).filter(x => x.on && !(t.doers || []).some(d => d.id === x.id)).map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.role ? ' – ' + esc(x.role) : ''}</option>`).join('')}</select>
      <span class="hint">Procent = hur stor del av arbetstiden momentet tar. Krock först över 100 % totalt, i alla projekt.</span></div>` : ''}
    <div class="field"><label for="pOwner">Ansvarig</label><select id="pOwner"><option value="">–</option>${(people || []).filter(x => x.on || x.id === t.owner).map(x => `<option value="${esc(x.id)}" ${x.id === t.owner ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${t.owner && !(people || []).some(x => x.id === t.owner) ? `<option value="${esc(t.owner)}" selected>${esc(t.owner)}</option>` : ''}</select></div>
    <div class="field"><label for="pNewPerson">Ny person i registret</label><div class="inline"><input id="pNewPerson" placeholder="För- och efternamn"><input id="pNewRole" placeholder="Roll"><button class="btn small" type="button" data-act="addPerson">Lägg till</button></div>${peopleErr ? `<span class="hint">${esc(peopleErr)}</span>` : '<span class="hint">Hamnar i fliken Personer i portföljregistret och blir utförare här.</span>'}</div>
    <div class="field"><label>Färg</label>${swatches(t.color, 'color')}</div>
    <div class="field"><label for="pType">Typ</label><select id="pType">
      <option value="fas" ${!fixed && !isMs && !t.read ? 'selected' : ''}>Fas som räknas fram</option>
      <option value="fast" ${fixed && !t.ms && !t.locked && !t.read ? 'selected' : ''}>Fas med fasta datum</option>
      <option value="milstolpe" ${isMs && !t.locked ? 'selected' : ''}>Milstolpe</option>
      <option value="last" ${t.locked ? 'selected' : ''}>Låst hållpunkt – flyttas aldrig</option>
      <option value="las" ${t.read ? 'selected' : ''}>Läsperiod – mottagaren läser och ger feedback</option></select></div>
    ${isMs || t.read ? `<div class="field"><label>Mottagare</label><div class="recips">${(plan.recipients || []).filter(x => x.on !== false || (t.to || []).includes(x.id)).map(x => `<label class="check"><input type="checkbox" data-f="to" value="${esc(x.id)}" ${(t.to || []).includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div>
      <div class="inline"><input id="pNewRec" placeholder="Ny mottagare, t.ex. Viaplay" aria-label="Ny mottagare"><button class="btn small" type="button" data-act="addRec">Lägg till</button></div></div>` : ''}
    ${t.read ? `<div class="two"><div class="field"><label for="pDlv">Mottagaren får det</label><input id="pDlv" list="tidlista" value="${esc(t.dlvAt || '')}" placeholder="dagens början"><span class="hint">${wdOf(r.start)} ${fmtShort(r.start)}</span></div>
      <div class="field"><label for="pFb">Feedback senast</label><input id="pFb" list="tidlista" value="${esc(t.fbAt || '')}" placeholder="dagens slut"><span class="hint">${wdOf(r.end)} ${fmtShort(r.end)}</span></div></div>
      <datalist id="tidlista"><option value="dagens början"><option value="dagens slut"><option value="09.00"><option value="12.00"><option value="17.00"></datalist>
      <p class="hint">Stapeln börjar när mottagaren får materialet och slutar när feedbacken ska vara inne. Flytta eller förläng stapeln för att ändra dagarna.</p>` : ''}
    ${fixed ? `<div class="two"><div class="field"><label for="pStart">Fast start</label><input type="date" id="pStart" value="${esc(t.start)}"></div>
      <div class="field"><label for="pEnd">Fast slut</label><input type="date" id="pEnd" value="${esc(t.end)}"></div></div>` : ''}
    ${t.locked ? `<div class="field"><label for="pMm">Varna när marginalen är under (arbetsdagar)</label><input type="number" min="0" id="pMm" value="${t.minMargin || LOCK_MARGIN}"><span class="hint">Gult under gränsen, rött när den är bruten.</span></div>` : ''}
    ${!fixed && !isMs && !FREE() ? `
      <div class="field"><label for="pRes">Resurs</label><select id="pRes">${poolOpts}</select></div>
      ${pool ? `<div class="two"><div class="field"><label for="pMember">Person</label><select id="pMember">${memOpts}</select></div>
        <div class="field"><label for="pCrew">Antal personer</label><input type="number" min="1" max="${pool.members.length}" id="pCrew" value="${t.crew || 1}"><span class="hint">av ${pool.members.length}</span></div></div>
        <div class="field"><label for="pWith">Samma person som</label><select id="pWith">${withOpts}</select></div>` : ''}
      <div class="field"><label>Arbetsmängd</label><div class="seg-inline">
        <label><input type="radio" name="pAmt" value="d" ${hoursMode ? '' : 'checked'}> Arbetsdagar</label>
        <label><input type="radio" name="pAmt" value="h" ${hoursMode ? 'checked' : ''}> Timmar</label></div></div>
      <div class="two">${hoursMode
        ? `<div class="field"><label for="pHours">Timmar totalt</label><input type="number" min="1" id="pHours" value="${t.hours}"><span class="hint">= ${r.dur || '–'} arbetsdagar med ${t.crew || 1} pers à ${t.cal === 's4' ? 10 : 8} h</span></div>`
        : `<div class="field"><label for="pDur">Arbetsdagar</label><input type="number" min="1" id="pDur" value="${t.dur || 1}"><span class="hint">${((t.dur || 1) / 5).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} veckor</span></div>`}
        <div class="field"><label for="pCal">Veckor</label><select id="pCal"><option value="w5" ${t.cal !== 's4' ? 'selected' : ''}>mån–fre</option><option value="s4" ${t.cal === 's4' ? 'selected' : ''}>mån–tors</option></select></div></div>
      <div class="field"><label for="pNb">Tidigast start</label><div class="inline"><input type="date" id="pNb" value="${esc(t.notBefore || '')}">${t.notBefore ? `<button class="btn small" type="button" data-act="clearNb">Släpp låsningen</button>` : ''}</div>
        <span class="hint">Sätts när du drar fasen. Utan värde startar den så tidigt som reglerna tillåter.</span></div>
      <div class="two"><div class="field"><label for="pMb">Måste vara klar före</label><select id="pMb"><option value="">–</option>${taskOptions(t.id, t.mustFinishBefore)}</select></div>
        <div class="field"><label for="pMm">Min marginal (d)</label><input type="number" min="0" id="pMm" value="${t.minMargin || 0}"></div></div>` : ''}
    <details class="adv"><summary>Mer</summary>
      <div class="two"><div class="field"><label for="pGroup">Avdelning (färg)</label><select id="pGroup">${grpOpts}</select></div>
        <div class="field"><label for="pLight">Stil</label><select id="pLight"><option value="">Vanlig</option><option value="1" ${t.light ? 'selected' : ''}>Bakgrundsspår</option></select></div></div>
      ${!fixed || t.locked ? `<div class="field"><label for="pSoft">Mjuka beroenden som text</label><input id="pSoft" value="${esc(depsToStr(t.soft))}" spellcheck="false" class="mono"></div>` : ''}
      ${!fixed || t.locked ? `<div class="field"><label for="pDeps">Beroenden som text</label><input id="pDeps" value="${esc(depsToStr(t.deps))}" spellcheck="false" class="mono"><span class="hint">ID TYP+marginal, t.ex. fin1 FS+5, dia1 SS</span></div>` : ''}
      <div class="field"><label for="pId">ID</label><input id="pId" value="${esc(t.id)}" class="mono" spellcheck="false"><span class="hint">Byts även i andra fasers beroenden.</span></div>
    </details>`;
  p.hidden = false;
}
function onTaskChange(e) {
  const t = taskById(selected); if (!t) return;
  const id = e.target.id || e.target.name; const v = e.target.value; const f = e.target.dataset.f;
  if (id === 'pSplit') return;
  const set = (k, val) => { if (val === '' || val == null || val === false) delete t[k]; else t[k] = val; };
  const loop = () => { undoStack.pop(); toast('Det skulle bli en slinga – den fasen väntar redan på den här.'); renderTaskPanel(); };
  const before = milestoneSnapshot();
  pushUndo();
  if (f === 'dId' || f === 'dType' || f === 'dLag' || f === 'dKind') {
    const k = e.target.dataset.k === 's' ? 's' : 'h'; const arr = k === 's' ? (t.soft = t.soft || []) : (t.deps = t.deps || []);
    const i = +e.target.dataset.i; const d = arr[i]; if (!d) { undoStack.pop(); return; }
    if (f === 'dKind') {
      if (v === k) { undoStack.pop(); return; }
      if (v === 'h' && !t.locked && dependsOn(d.id, t.id)) return loop();
      arr.splice(i, 1); (v === 's' ? (t.soft = t.soft || []) : (t.deps = t.deps || [])).push(d);
    }
    if (f === 'dId') { if (k === 'h' && !t.locked && v !== d.id && dependsOn(v, t.id)) return loop(); d.id = v; }
    if (f === 'dType') d.type = v;
    if (f === 'dLag') d.lag = parseInt(v, 10) || 0;
    if (t.soft && !t.soft.length) delete t.soft;
  }
  else if (id === 'dNew') { if (!v) { undoStack.pop(); return; } if (dependsOn(v, t.id)) return loop(); t.deps = (t.deps || []).concat([{ id: v, type: isMsT(t) ? 'FF' : 'FS', lag: 0 }]); }
  else if (id === 'pName') t.name = v;
  else if (id === 'pGroup') t.group = v;
  else if (id === 'pRow') t.row = v;
  else if (id === 'pFilm') set('film', v ? Number(v) : '');
  else if (id === 'pIgnHol') set('ignoreHol', e.target.checked);
  else if (id === 'pIgnBrk') set('ignoreBreaks', e.target.checked);
  else if (f === 'to') { const st = new Set(t.to || []); if (e.target.checked) st.add(v); else st.delete(v); if (st.size) t.to = [...st]; else delete t.to; }
  else if (f === 'dPct') { const i = +e.target.dataset.i; const n = Math.max(1, Math.min(100, parseInt(v, 10) || 100)); if (t.doers && t.doers[i]) t.doers[i].pct = n; }
  else if (id === 'doerNew') { if (!v) { undoStack.pop(); return; } t.doers = (t.doers || []).concat([{ id: v, pct: 100 }]); }
  else if (id === 'pOwner') set('owner', v);
  else if (id === 'pDlv') set('dlvAt', v.trim());
  else if (id === 'pFb') set('fbAt', v.trim());
  else if (id === 'pType') {
    const r = result.dates[t.id] || {};
    if (v !== 'las') delete t.read;
    if (v === 'las') {
      delete t.locked;
      if (isMsT(t)) { delete t.ms; if (t.type === 'fixed') t.end = result.cal.addWork(t.start, 4, 'w5'); else { delete t.type; t.dur = 5; } }
      t.read = true; if (!(t.to || []).length && (plan.recipients || [])[0]) t.to = [plan.recipients[0].id];
    } else
    if (v === 'last') { if (t.type !== 'fixed') { t.type = 'fixed'; t.start = r.start; t.end = isMsT(t) ? r.start : r.end; } t.locked = true; }
    else if (v === 'fast') { delete t.locked; t.type = 'fixed'; delete t.ms; t.start = r.start; t.end = r.end; }
    else if (v === 'milstolpe') { delete t.locked; if (t.type === 'fixed') { t.end = t.start; t.ms = true; } else { t.type = 'milestone'; t.ms = true; } }
    else { delete t.locked; delete t.type; delete t.ms; delete t.start; delete t.end; t.dur = t.dur || Math.max(1, (r.start ? workdaysBetween(result.cal, r.start, r.end, 'w5') + 1 : 5)); }
  }
  else if (id === 'pStart') { t.start = v; if (t.ms || !t.end || t.end < v) t.end = v; }
  else if (id === 'pEnd') t.end = v < t.start ? t.start : v;
  else if (id === 'pRes') { set('res', v); delete t.member; delete t.with; delete t.crew; }
  else if (id === 'pMember') { set('member', v); if (v) delete t.with; }
  else if (id === 'pWith') { set('with', v); if (v) delete t.member; }
  else if (id === 'pCrew') { const n = parseInt(v, 10); set('crew', n > 1 ? n : ''); }
  else if (id === 'pAmt') { const r = result.dates[t.id] || {}; if (v === 'h') { t.hours = (r.dur || t.dur || 1) * (t.crew || 1) * (t.cal === 's4' ? 10 : 8); delete t.dur; } else { t.dur = r.dur || 1; delete t.hours; } }
  else if (id === 'pHours') { const n = parseFloat(v); if (!(n > 0)) { undoStack.pop(); return; } t.hours = n; }
  else if (id === 'pDur') { const n = parseInt(v, 10); if (!(n > 0)) { undoStack.pop(); return; } t.dur = n; }
  else if (id === 'pCal') set('cal', v === 's4' ? 's4' : '');
  else if (id === 'pNb') set('notBefore', v);
  else if (id === 'pDeps') t.deps = strToDeps(v);
  else if (id === 'pSoft') { const sd = strToDeps(v); if (sd.length) t.soft = sd; else delete t.soft; }
  else if (id === 'pMb') set('mustFinishBefore', v);
  else if (id === 'pMm') { const n = parseInt(v, 10); set('minMargin', n > 0 ? n : ''); }
  else if (id === 'pLight') set('light', !!v);
  else if (id === 'pNote') set('note', v.trim());
  else if (id === 'pStatus') set('status', v);
  else if (id === 'pFs') { if (!v) { undoStack.pop(); return; } const len = t.fe && t.fs ? daysBetween(t.fs, t.fe) : 0; t.fs = v; t.fe = isMsT(t) ? v : addDays(v, Math.max(0, len)); }
  else if (id === 'pFe') { if (!v) { undoStack.pop(); return; } t.fe = v < t.fs ? t.fs : v; }
  else if (id === 'pId') {
    const nid = v.trim(); if (!nid || nid === t.id) { undoStack.pop(); return; }
    if (taskById(nid)) { undoStack.pop(); toast(`ID “${nid}” används redan`); e.target.value = t.id; return; }
    const old = t.id;
    plan.tasks.forEach(x => { (x.deps || []).concat(x.soft || []).forEach(d => { if (d.id === old) d.id = nid; }); if (x.mustFinishBefore === old) x.mustFinishBefore = nid; if (x.with === old) x.with = nid; if (x.splitOf === old) x.splitOf = nid; });
    t.id = nid; sel = new Set([nid]); selected = nid;
  } else { undoStack.pop(); return; }
  redoStack.length = 0; dirty = true; recompute();
  const imp = impact(before); if (imp) toast(imp.trim(), 5000);
}

// ---- Panel: flera faser ----
function tri(ids, key) { const n = ids.filter(id => taskById(id)[key]).length; return n === 0 ? '' : n === ids.length ? 'checked' : 'data-mixed="1"'; }
function workSel() { return [...sel].filter(x => { const t = taskById(x); return t && !isMsT(t) && t.type !== 'fixed'; }); }
function renderMultiPanel() {
  const ids = [...sel].filter(id => taskById(id)); const p = $('#panel'); p.classList.remove('wide');
  if (ids.length < 2) { if (ids.length === 1) { selected = ids[0]; panelMode = 'task'; renderTaskPanel(); } else closePanel(); return; }
  const ts = ids.map(taskById);
  const starts = ids.map(id => result.dates[id].start).sort(); const ends = ids.map(id => result.dates[id].end).sort();
  const work = workSel();
  p.innerHTML = `
    <header><div><div class="meta">Markering</div><h2>${ids.length} faser</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <div class="computed"><div><span>Från</span><span class="mono">${fmt(starts[0])}</span></div><div><span>Till</span><span class="mono">${fmt(ends[ends.length - 1])}</span></div></div>
    <ul class="mlist">${ts.map(t => `<li><i style="background:${barColor(t)}"></i>${esc(label(t))} <span class="mono">${fmtShort(result.dates[t.id].start)}–${fmtShort(result.dates[t.id].end)}</span></li>`).join('')}</ul>
    ${work.length ? `<div class="field"><label>Arbetsdagar som räknas (${work.length} faser)</label>
      <label class="check"><input type="checkbox" id="mIgnHol" ${tri(work, 'ignoreHol')}> Jobbar på röda dagar</label>
      <label class="check"><input type="checkbox" id="mIgnBrk" ${tri(work, 'ignoreBreaks')}> Jobbar under uppehåll och semester</label></div>
    <div class="two"><div class="field"><label for="mPool">Resurs för alla</label><select id="mPool"><option value="">Välj …</option><option value="-">– ingen –</option>${plan.resources.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="mMem">Person</label><select id="mMem" disabled><option value="">Den som är ledig först</option></select></div></div>` : ''}
    <div class="field"><label for="mStatus">Status för alla</label><select id="mStatus">${statusOptions(ts.every(t => (t.status || '') === (ts[0].status || '')) ? ts[0].status : '*', !ts.every(t => (t.status || '') === (ts[0].status || '')))}</select></div>
    <div class="field"><label for="mShift">Flytta alla</label><div class="inline"><input type="number" id="mShift" value="7" step="1"><span class="unit">dagar</span><button class="btn small" type="button" data-act="mshift">Flytta</button></div>
      <span class="hint">Negativt tal flyttar bakåt. Du kan också dra en av de markerade staplarna eller använda piltangenterna.</span></div>
    <div class="field"><label for="mRow">Flytta alla till rad</label><select id="mRow"><option value="">Välj rad …</option>${sections().map(sec => { const rs = plan.rows.filter(x => x.section === sec); return rs.length ? `<optgroup label="${esc(sec)}">${rs.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></div>
    <div class="quick"><button class="btn small" type="button" data-act="dupM">Duplicera</button><button class="btn small" type="button" data-act="copyM">Kopiera</button><button class="btn small" type="button" data-act="chain" title="Varje fas väntar på den före i datumordning">Koppla i ordning</button><button class="btn small danger" type="button" data-act="delM">Ta bort</button></div>
    <div class="field"><label for="mTpl">Spara som mall</label><div class="inline"><input id="mTpl" placeholder="Namn på mallen" value=""><button class="btn small" type="button" data-act="mtpl">Spara</button></div></div>
    <div class="field"><label>Färg på alla</label>${swatches(null, 'mcolor')}</div>`;
  p.hidden = false;
  $$('#panel input[data-mixed]').forEach(i => { i.indeterminate = true; });
}

// ---- Panel: resurser ----
function renderResPanel() {
  const p = $('#panel'); p.classList.add('wide');
  const usage = {};
  for (const id in result.dates) { const r = result.dates[id]; (r.members || []).forEach(m => { const u = usage[m] = usage[m] || { n: 0, days: 0, from: null, to: null }; u.n++; u.days += r.dur || 0; if (!u.from || r.start < u.from) u.from = r.start; if (!u.to || r.end > u.to) u.to = r.end; }); }
  const used = id => plan.tasks.filter(t => t.res === id).length;
  const ns = workSel().length;
  const blockRow = (b, path) => `<div class="blk">
      <input class="bn" data-f="bname" data-path="${path}" value="${esc(b.name || '')}" placeholder="Ledighet, t.ex. semester" aria-label="Namn på ledighet">
      <input type="date" data-f="bfrom" data-path="${path}" value="${esc(b.from)}" aria-label="Från">
      <input type="date" data-f="bto" data-path="${path}" value="${esc(b.to)}" aria-label="Till">
      <label class="check"><input type="checkbox" data-f="bon" data-path="${path}" ${b.on ? 'checked' : ''}> Aktiv</label>
      <button class="xbtn" type="button" data-act="delBlock" data-path="${path}" aria-label="Ta bort ledighet">×</button></div>`;
  p.innerHTML = `
    <header><div><div class="meta">Vem som gör jobbet</div><h2>Resurser</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">En resursgrupp är en roll, till exempel dialogläggare. Varje person gör en sak åt gången, så fler personer i en grupp gör att arbete kan gå parallellt. ${ns ? `<b>${ns} markerade faser</b> – klicka Tilldela vid en grupp eller person för att ge dem jobbet.` : 'Markera staplar i tidslinjen för att tilldela dem härifrån.'}</p>
    <div class="pools">
    ${plan.resources.map((g, gi) => `<div class="pool">
      <div class="ph"><input data-f="gname" data-path="${gi}" value="${esc(g.name)}" aria-label="Resursgruppens namn"><span class="count">${g.members.length} pers · ${used(g.id)} faser</span>
        ${ns ? `<button class="btn small" type="button" data-act="assignPool" data-path="${gi}">Tilldela</button>` : ''}
        <button class="xbtn" type="button" data-act="delPool" data-path="${gi}" aria-label="Ta bort gruppen" title="${used(g.id) ? 'Används av faser – de blir utan resurs' : 'Ta bort gruppen'}">×</button></div>
      ${(g.blocks || []).map((b, bi) => blockRow(b, `${gi}.g.${bi}`)).join('')}
      ${g.members.map((m, mi) => { const u = usage[m.id]; return `<div class="mem">
        <div class="mh"><input data-f="mname" data-path="${gi}.${mi}" value="${esc(m.name)}" aria-label="Namn">${ns ? `<button class="btn small" type="button" data-act="assignMem" data-path="${gi}.${mi}">Tilldela</button>` : ''}<button class="xbtn" type="button" data-act="delMember" data-path="${gi}.${mi}" aria-label="Ta bort person" ${g.members.length < 2 ? 'disabled' : ''}>×</button></div>
        <div class="use">${u ? `${u.n} faser · ${u.days} arbetsdagar · ${fmtShort(u.from)} – ${fmt(u.to)}` : 'Inga faser än'}</div>
        ${(m.blocks || []).map((b, bi) => blockRow(b, `${gi}.${mi}.${bi}`)).join('')}
        <button class="linkbtn" type="button" data-act="addBlock" data-path="${gi}.${mi}">+ Ledighet</button></div>`; }).join('')}
      <button class="linkbtn" type="button" data-act="addMember" data-path="${gi}">+ Person</button>
    </div>`).join('')}
    </div>
    <div><button class="btn small" type="button" data-act="addPool">+ Ny resursgrupp</button></div>`;
  p.hidden = false;
}
function blockAt(path) { const [gi, mi, bi] = path.split('.'); const g = plan.resources[gi]; return mi === 'g' ? { list: g.blocks, i: +bi } : { list: g.members[mi].blocks, i: +bi }; }
function onResChange(e) {
  const f = e.target.dataset.f; if (!f) return; const path = e.target.dataset.path; const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  pushUndo();
  if (f === 'gname') plan.resources[path].name = v || plan.resources[path].name;
  else if (f === 'mname') { const [gi, mi] = path.split('.'); plan.resources[gi].members[mi].name = v || plan.resources[gi].members[mi].name; }
  else { const { list, i } = blockAt(path); const b = list[i]; if (f === 'bname') b.name = v; if (f === 'bfrom') { b.from = v; if (b.to < v) b.to = v; } if (f === 'bto') b.to = v < b.from ? b.from : v; if (f === 'bon') b.on = v; }
  redoStack.length = 0; dirty = true; recompute();
}
function uid(base) { let n = 1; const ids = new Set(); plan.resources.forEach(g => { ids.add(g.id); g.members.forEach(m => ids.add(m.id)); }); while (ids.has(base + n)) n++; return base + n; }
function onResAction(act, path) {
  if (act === 'assignPool') assign(workSel(), plan.resources[path].id, null);
  else if (act === 'assignMem') { const [gi, mi] = path.split('.'); assign(workSel(), plan.resources[gi].id, plan.resources[gi].members[mi].id); }
  else if (act === 'addMember') change(() => { const g = plan.resources[path]; g.members.push({ id: uid(g.id + '_'), name: `${g.name} ${g.members.length + 1}`, blocks: [] }); });
  else if (act === 'delMember') change(() => { const [gi, mi] = path.split('.'); const g = plan.resources[gi]; const m = g.members[mi]; g.members.splice(mi, 1); plan.tasks.forEach(t => { if (t.member === m.id) delete t.member; if (t.res === g.id && t.crew > g.members.length) t.crew = g.members.length; }); });
  else if (act === 'addBlock') change(() => { const [gi, mi] = path.split('.'); plan.resources[gi].members[mi].blocks.push({ name: 'Semester', from: '2028-07-03', to: '2028-07-28', on: true }); });
  else if (act === 'delBlock') change(() => { const { list, i } = blockAt(path); list.splice(i, 1); });
  else if (act === 'addPool') change(() => { const id = uid('grupp'); plan.resources.push({ id, name: 'Ny resursgrupp', blocks: [], members: [{ id: id + '_1', name: 'Person 1', blocks: [] }] }); });
  else if (act === 'delPool') change(() => { const g = plan.resources[+path]; plan.tasks.forEach(t => { if (t.res === g.id) { delete t.res; delete t.member; delete t.with; delete t.crew; } }); plan.resources.splice(+path, 1); });
}

// ---- Panel: kalender ----
function renderCalPanel() {
  const p = $('#panel'); p.classList.remove('wide');
  const R = range(); const hol = Object.entries(result.cal.hol).filter(([d]) => d >= R.start && d <= R.end && dow(d) > 0 && dow(d) < 6).sort();
  const work = workSel();
  p.innerHTML = `
    <header><div><div class="meta">Lediga dagar</div><h2>Kalender</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">Inget arbete läggs på röda dagar eller under uppehåll. En stapel som går över dem pausar och blir längre. Faser som ska jobba igenom kryssar du i här eller i fasens panel.</p>
    ${work.length ? `<div class="pool"><b>${work.length} markerade faser</b>
      <label class="check"><input type="checkbox" id="mIgnHol" ${tri(work, 'ignoreHol')}> Jobbar på röda dagar</label>
      <label class="check"><input type="checkbox" id="mIgnBrk" ${tri(work, 'ignoreBreaks')}> Jobbar under uppehåll och semester</label></div>` : '<p class="hint">Markera staplar för att låta dem jobba igenom röda dagar eller uppehåll.</p>'}
    <label class="check"><input type="checkbox" id="optHol" ${plan.settings.holidays ? 'checked' : ''}> Räkna bort röda dagar och aftnar (midsommar-, jul- och nyårsafton)</label>
    <div class="field"><label>Uppehåll för hela produktionen</label>
      ${(plan.settings.breaks || []).map((b, i) => `<div class="blk">
        <input class="bn" data-f="kname" data-i="${i}" value="${esc(b.name)}" aria-label="Namn på uppehållet">
        <input type="date" data-f="kfrom" data-i="${i}" value="${esc(b.from)}" aria-label="Från">
        <input type="date" data-f="kto" data-i="${i}" value="${esc(b.to)}" aria-label="Till">
        <label class="check"><input type="checkbox" data-f="kon" data-i="${i}" ${b.on ? 'checked' : ''}> Aktiv</label>
        <button class="xbtn" type="button" data-act="kdel" data-i="${i}" aria-label="Ta bort uppehållet">×</button></div>`).join('') || '<p class="hint">Inga uppehåll.</p>'}
      <button class="linkbtn" type="button" data-act="kadd">+ Uppehåll</button>
      <span class="hint">Ledighet för en enskild person lägger du under Resurser.</span></div>
    <details class="adv"><summary>Röda dagar i planen (${hol.length})</summary><ul class="mlist">${hol.map(([d, n]) => `<li><i class="lg-hol"></i>${esc(n)} <span class="mono">${fmt(d)}</span></li>`).join('')}</ul></details>`;
  p.hidden = false;
  $$('#panel input[data-mixed]').forEach(i => { i.indeterminate = true; });
}

// ---- Panel: mallar ----
function anchorFor(tpl, film) {
  if (!tpl.anchor) return '';
  const prev = film ? film - 1 : (filmsList().slice(-1)[0] || 1);
  return tpl.anchor.replace(/\{F-1\}/g, prev).replace(/\{F\}/g, film || '');
}
function renderTplPanel() {
  const p = $('#panel'); p.classList.remove('wide'); const films = filmsList(); const nextF = (films[films.length - 1] || 0) + 1;
  p.innerHTML = `
    <header><div><div class="meta">Återanvänd upplägg</div><h2>Mallar</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">En mall är en kedja av faser med längder, resurser, rader och beroenden, utan datum. Markera faser i tidslinjen och välj Spara som mall. Infoga en mall för att lägga till samma kedja för en ny film eller ett nytt block.</p>
    ${templates.length ? templates.map((tp, i) => `<div class="pool tpl">
      <div class="ph"><input data-f="tname" data-i="${i}" value="${esc(tp.name)}" aria-label="Mallens namn"><span class="count">${tp.tasks.length} faser</span>
        <button class="xbtn" type="button" data-act="tdel" data-i="${i}" aria-label="Ta bort mallen">×</button></div>
      <div class="use">${esc(tp.tasks.slice(0, 7).map(o => o.name).join(' → '))}${tp.tasks.length > 7 ? ' …' : ''}</div>
      <div class="two"><div class="field"><label for="tFilm${i}">Infoga för</label><select id="tFilm${i}" data-f="tfilm" data-i="${i}"><option value="">Gemensamt (ingen film)</option>${films.map(f => `<option value="${f}">F${f}</option>`).join('')}<option value="${nextF}" selected>F${nextF} (ny film)</option></select></div>
        <div class="field"><label for="tNb${i}">Tidigast start</label><input type="date" id="tNb${i}"></div></div>
      <div class="field"><label for="tDeps${i}">Startfaserna väntar på</label><input id="tDeps${i}" class="mono" spellcheck="false" value="${esc(anchorFor(tp, nextF))}" placeholder="t.ex. fin3 SS+10, grov FS">
        <span class="hint">Samma format som beroenden som text. Tomt = startar vid Tidigast start.</span></div>
      <div><button class="btn small primary" type="button" data-act="tins" data-i="${i}">Infoga mallen</button></div>
    </div>`).join('') : '<p class="foot">Inga mallar än.</p>'}
    ${sel.size ? `<div class="field"><label for="tNew">Ny mall av de ${sel.size} markerade</label><div class="inline"><input id="tNew" placeholder="Namn på mallen"><button class="btn small" type="button" data-act="tnew">Spara</button></div></div>` : ''}`;
  p.hidden = false;
}

// ---- Högerklicksmeny ----
function openMenu(x, y, items) {
  const m = $('#ctx');
  m.innerHTML = items.map(it => it === '-' ? '<hr>' : it.html ? it.html : `<button type="button" data-k="${it.k}"${it.disabled ? ' disabled' : ''}>${esc(it.label)}${it.kbd ? `<kbd>${it.kbd}</kbd>` : ''}</button>`).join('');
  m.hidden = false;
  const w = m.offsetWidth || 240, h = m.offsetHeight || 320;
  m.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  openMenu.items = items;
}
function closeMenu() { $('#ctx').hidden = true; openMenu.items = null; }
function dateAtX(clientX) { const lane = document.querySelector('.rowsbox .lane'); if (!lane || !geo) return null; const rect = lane.getBoundingClientRect(); return addDays(geo.R.start, Math.floor((clientX - rect.left) / geo.px)); }
function onContextMenu(e) {
  const bar = e.target.closest('.bar[data-id], .ms[data-id]');
  const name = e.target.closest('.row:not(.group) > .name');
  const row = e.target.closest('.row:not(.group)');
  const grp = e.target.closest('.row.group');
  if (grp && !bar && ui.rows === 'manual' && plan.sections.some(x => x.name === grp.dataset.section)) {
    e.preventDefault(); const sn = grp.dataset.section;
    openMenu(e.clientX, e.clientY, [
      { k: 'secedit', label: 'Byt namn, färg och ordning…' },
      { html: `<div class="ctxsw"><span>Färg</span>${swatches((plan.sections.find(x => x.name === sn) || {}).color || null, 'secfill').replace(/data-act="secfill"/g, `data-act="secfill" data-sec="${esc(sn)}"`)}</div>` },
      { k: 'secup', label: 'Flytta sektionen upp', sn }, { k: 'secdown', label: 'Flytta sektionen ner', sn },
      '-', { k: 'secnew', label: 'Ny sektion efter den här…', sn },
    ]);
    return;
  }
  if (!bar && !row) return;
  e.preventDefault();
  if (name && row.dataset.rowid) {
    const rid = row.dataset.rowid; const n = plan.tasks.filter(t => t.row === rid).length;
    openMenu(e.clientX, e.clientY, [
      { k: 'rsel', label: `Markera radens faser (${n})`, rid, disabled: !n },
      { k: 'rren', label: 'Byt namn', rid },
      { html: `<div class="ctxsw"><span>Radfärg</span>${swatches((rowById(rid) || {}).fill || null, 'rowfill').replace(/data-act="rowfill"/g, `data-act="rowfill" data-rid="${esc(rid)}"`)}</div>` },
      { k: 'rbold', label: (rowById(rid) || {}).bold ? '✓ Fetstil' : 'Fetstil', rid },
      { k: 'rind', label: 'Indrag (underrad)', rid, disabled: ((rowById(rid) || {}).indent || 0) >= 3 },
      { k: 'rout', label: 'Ta bort indrag', rid, disabled: !((rowById(rid) || {}).indent) },
      '-',
      { k: 'rabove', label: 'Ny rad ovanför', rid }, { k: 'rbelow', label: 'Ny rad nedanför', rid },
      { k: 'rup', label: 'Flytta upp', rid }, { k: 'rdown', label: 'Flytta ner', rid },
      '-',
      { k: 'rdelkeep', label: n ? 'Ta bort raden (faserna får egna rader)' : 'Ta bort raden', rid },
      n ? { k: 'rdelall', label: `Ta bort raden och dess ${n} faser`, rid } : null,
    ].filter(Boolean));
    return;
  }
  const at = dateAtX(e.clientX);
  if (bar) {
    const id = bar.dataset.id; if (!sel.has(id)) select([id], { open: false });
    const ids = [...sel]; const one = ids.length === 1 ? taskById(ids[0]) : null;
    const r = one && result.dates[one.id];
    const canSplit = one && !isMsT(one) && at > r.start && at <= r.end;
    const work = workSel();
    const allHol = work.length && work.every(x => taskById(x).ignoreHol), allBrk = work.length && work.every(x => taskById(x).ignoreBreaks);
    openMenu(e.clientX, e.clientY, [
      { k: 'edit', label: ids.length > 1 ? `Redigera ${ids.length} faser` : 'Redigera', kbd: 'Enter' },
      one && !isMsT(one) ? { k: 'split', label: canSplit ? `Dela här (${fmtShort(at)})` : 'Dela på mitten', at: canSplit ? at : null } : null,
      one && !isMsT(one) ? { k: 'msend', label: 'Lägg milstolpe vid slutet' } : null,
      { k: 'dup', label: 'Duplicera', kbd: mod + 'D' },
      { k: 'copy', label: 'Kopiera', kbd: mod + 'C' },
      { k: 'tpl', label: 'Spara som mall…' },
      '-',
      work.length ? { k: 'hol', label: allHol ? '✓ Jobbar på röda dagar' : 'Jobba på röda dagar', on: !allHol } : null,
      work.length ? { k: 'brk', label: allBrk ? '✓ Jobbar under uppehåll och semester' : 'Jobba under uppehåll och semester', on: !allBrk } : null,
      work.length ? { k: 'res', label: 'Resurs…' } : null,
      { html: `<div class="ctxsw"><span>Färg</span>${swatches(one ? one.color : null, 'ctxcolor')}</div>` },
      { html: `<div class="ctxst"><span>Status</span>${Object.entries(STATUS).map(([k, x]) => `<button type="button" class="st st-${k}" data-act="ctxst" data-st="${k}" title="${esc(x.l)}">${x.g}</button>`).join('')}<button type="button" class="st st-none" data-act="ctxst" data-st="" title="Ingen status">×</button></div>` },
      ids.some(x => taskById(x).notBefore) ? { k: 'unpin', label: 'Släpp låsningen' } : null,
      '-',
      { k: 'del', label: ids.length > 1 ? `Ta bort ${ids.length} faser` : 'Ta bort', kbd: 'Del' },
    ].filter(Boolean));
  } else {
    openMenu(e.clientX, e.clientY, [
      { k: 'new', label: `Ny fas här (${fmtShort(at)})`, at, row },
      { k: 'paste', label: clipboard ? `Klistra in ${clipboard.n} ${clipboard.n === 1 ? 'fas' : 'faser'} här` : 'Klistra in här', disabled: !clipboard, at, row, kbd: mod + 'V' },
      row.dataset.rowid ? { k: 'rbelow', label: 'Ny rad nedanför', rid: row.dataset.rowid } : null,
      { k: 'tplmenu', label: 'Infoga mall…' },
    ].filter(Boolean));
  }
}
function onMenuClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'ctxcolor') { setColor([...sel], b.dataset.color); closeMenu(); return; }
  if (b.dataset.act === 'ctxst') { setStatus([...sel], b.dataset.st); closeMenu(); return; }
  if (b.dataset.act === 'secfill') { const sn = b.dataset.sec; closeMenu(); setSectionColor(sn, b.dataset.color); return; }
  if (b.dataset.act === 'rowfill') { const r = rowById(b.dataset.rid); closeMenu(); if (r) change(() => { if (b.dataset.color) r.fill = b.dataset.color; else delete r.fill; }); return; }
  const it = (openMenu.items || []).find(x => x && x.k === b.dataset.k); closeMenu(); if (!it) return;
  const ids = [...sel]; const work = workSel();
  const rr = it.rid && rowById(it.rid);
  ({
    edit: () => select(ids, { open: true }),
    split: () => opSplit(ids[0], it.at),
    msend: () => addMilestoneAtEnd(ids[0]),
    dup: () => opDuplicate(ids), copy: () => opCopy(ids),
    tpl: () => { openPanel('tpl'); setTimeout(() => { const f = $('#tNew'); if (f) f.focus(); }, 0); },
    hol: () => setFlag(work, 'ignoreHol', it.on), brk: () => setFlag(work, 'ignoreBreaks', it.on),
    res: () => openPanel('res'),
    unpin: () => change(() => ids.forEach(x => delete taskById(x).notBefore)),
    del: () => opDelete(ids),
    new: () => newTaskAt(it.at, 5, it.row), paste: () => opPaste(it.at, it.row), tplmenu: () => openPanel('tpl'),
    rbold: () => change(() => { rr.bold = !rr.bold; if (!rr.bold) delete rr.bold; }),
    rind: () => change(() => { rr.indent = Math.min(3, (rr.indent || 0) + 1); }),
    rout: () => change(() => { rr.indent = Math.max(0, (rr.indent || 0) - 1); if (!rr.indent) delete rr.indent; }),
    rsel: () => select(plan.tasks.filter(t => t.row === it.rid).map(t => t.id), { open: true }),
    rren: () => renameRow(it.rid),
    rabove: () => rowAdd(rr.section, null, rr.id),
    rbelow: () => rowAdd(rr.section, rr.id),
    rup: () => moveRow(it.rid, -1), rdown: () => moveRow(it.rid, 1),
    rdelkeep: () => deleteRow(it.rid, false), rdelall: () => deleteRow(it.rid, true),
    secedit: () => openPanel('sec'), secup: () => moveSection(it.sn, -1), secdown: () => moveSection(it.sn, 1),
    secnew: () => { openPanel('sec'); setTimeout(() => { const pos = $('#secPos'); if (pos) pos.value = it.sn; const f = $('#secNew'); if (f) f.focus(); }, 0); },
    xpdf: exportPdf, xcal: () => openPanel('calexp'), xcsv: exportCsv,
  }[it.k] || (() => {}))();
}

// ---- Dra: staplar, rita, rader, koppla ----
let drag = null;
function rowAt(y) { return $$('.rowsbox .row').find(r => { const b = r.getBoundingClientRect(); return y >= b.top && y < b.bottom; }) || null; }
function barAt(x, y) { return $$('.rowsbox .bar[data-id], .rowsbox .ms[data-id]').find(b => { const r = b.getBoundingClientRect(); return x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3; }) || null; }
function onPointerDown(e) {
  if (e.button !== 0 || e.pointerType === 'touch') return;
  if (e.target.closest('input, button, select')) return;
  closeMenu();
  const lk = e.target.closest('.lk');
  const bar = e.target.closest('.bar[data-id], .ms[data-id]');
  const name = e.target.closest('.row:not(.group) > .name');
  const lane = e.target.closest('.row:not(.group) > .lane');
  if (lk || (bar && e.altKey)) {
    const el = lk || bar; const r = el.getBoundingClientRect();
    const startEnd = lk && lk.classList.contains('lk-s');
    drag = { kind: 'link', src: el.dataset.id, type: startEnd ? 'SS' : 'FS', x0: startEnd ? r.left : r.right, y0: r.top + r.height / 2 };
    el.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  if (bar) {
    const t = taskById(bar.dataset.id); if (!t) return;
    const rect = bar.getBoundingClientRect();
    const isMs = bar.classList.contains('ms');
    const mode = !isMs && rect.width >= 24 && rect.right - e.clientX <= 7 ? 'resize' : 'move';
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const group = !additive && sel.has(t.id) && sel.size > 1 && mode === 'move';
    drag = { kind: 'bar', el: bar, t, x0: e.clientX, y0: e.clientY, mode, isMs, w0: rect.width, moved: false, r: result.dates[t.id], additive, group, row0: bar.closest('.row') };
    bar.setPointerCapture(e.pointerId); e.preventDefault();
  } else if (name) {
    const row = name.parentElement;
    drag = { kind: 'rowname', row, y0: e.clientY, moved: false, additive: e.shiftKey || e.metaKey || e.ctrlKey, canMove: !!row.dataset.rowid || (ui.rows === 'detail' && !!row.dataset.id) };
    name.setPointerCapture(e.pointerId); e.preventDefault();
  } else if (lane) {
    drag = { kind: 'draw', lane, row: lane.parentElement, x0: e.clientX, moved: false };
    lane.setPointerCapture(e.pointerId); e.preventDefault();
  }
}
function dragDelta(dx) { return Math.round(dx / geo.px); }
function tipAt(e, text) { const tip = $('#dragtip'); tip.hidden = false; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; tip.textContent = text; }
function clearDropMarks() { $$('.droptarget, .dropbad, .dropline, .lifting, .linktarget').forEach(r => r.classList.remove('droptarget', 'dropbad', 'dropline', 'lifting', 'linktarget')); }
function onPointerMove(e) {
  if (!drag) return;
  if (drag.kind === 'link') {
    drag.moved = true;
    let line = $('#linkline'); if (!line) { line = document.createElement('div'); line.id = 'linkline'; document.body.appendChild(line); }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; const len = Math.hypot(dx, dy);
    line.style.left = drag.x0 + 'px'; line.style.top = drag.y0 + 'px'; line.style.width = len + 'px'; line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    clearDropMarks(); const tb = barAt(e.clientX, e.clientY); drag.target = tb && tb.dataset.id !== drag.src ? tb.dataset.id : null;
    if (drag.target) tb.classList.add('linktarget');
    tipAt(e, drag.target ? `${label(taskById(drag.target))} ${drag.type === 'SS' ? 'startar när' : 'väntar på'} ${label(taskById(drag.src))}` : 'Släpp på stapeln som ska vänta');
    return;
  }
  if (drag.kind === 'bar') {
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 6) return;
    drag.moved = true;
    const dd = dragDelta(dx); const px = dd * geo.px;
    const els = drag.group ? $$('.bar.hit, .ms.hit') : [drag.el];
    els.forEach(el => el.classList.add('dragging'));
    if (drag.mode === 'move') els.forEach(el => { el.style.transform = `translateX(${px}px)`; });
    else drag.el.style.width = Math.max(geo.px, drag.w0 + px) + 'px';
    clearDropMarks(); drag.target = null; drag.targetRow = null;
    if (!drag.group && drag.mode === 'move' && Math.abs(dy) > 10) {
      const row = rowAt(e.clientY);
      if (row && row !== drag.row0 && !row.classList.contains('group')) {
        if (ui.rows === 'manual') { if (row.dataset.rowid) { row.classList.add('droptarget'); drag.targetRow = row.dataset.rowid; } }
        else if (ui.rows === 'packed') {
          const key = row.dataset.row || '';
          const ok = key.startsWith('p:') && drag.t.res && key.slice(2).split('+').length === 1 && result.memberPool[key.slice(2)] === drag.t.res;
          row.classList.add(ok ? 'droptarget' : 'dropbad'); if (ok) drag.target = key.slice(2);
        }
      }
    }
    const r = drag.r;
    const extra = drag.target ? ` → ${memberName(drag.target)}` : drag.targetRow ? ` → rad ${rowById(drag.targetRow).name}` : '';
    tipAt(e, drag.mode === 'move'
      ? (drag.group ? `${sel.size} faser ${dd ? (dd > 0 ? '+' : '') + dd + ' d' : ''}` : `${drag.isMs ? '' : 'Start '}${fmt(addDays(r.start, dd))}${dd ? ` (${dd > 0 ? '+' : ''}${dd} d)` : ''}`) + extra
      : `Slut ${fmt(addDays(r.end, dd))}${dd ? ` (${dd > 0 ? '+' : ''}${dd} d)` : ''}`);
  } else if (drag.kind === 'draw') {
    const dx = e.clientX - drag.x0; if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    const a = dateAtX(Math.min(drag.x0, e.clientX)), b = dateAtX(Math.max(drag.x0, e.clientX));
    let g = drag.lane.querySelector('.ghost'); if (!g) { g = document.createElement('div'); g.className = 'ghost'; drag.lane.appendChild(g); }
    g.style.left = geo.X(a) + 'px'; g.style.width = Math.max(geo.px, geo.X(addDays(b, 1)) - geo.X(a)) + 'px';
    const n = Math.max(1, workdaysBetween(result.cal, a, b, 'w5') + (result.cal.isWork(a, 'w5') ? 1 : 0));
    drag.a = a; drag.n = n; tipAt(e, `Ny fas ${fmtShort(a)} – ${fmt(b)} · ${n} arbetsdagar`);
  } else if (drag.kind === 'rowname') {
    const dy = e.clientY - drag.y0; if (!drag.canMove || (!drag.moved && Math.abs(dy) < 6)) return;
    drag.moved = true; clearDropMarks(); drag.row.classList.add('lifting');
    const row = rowAt(e.clientY); drag.target = row && row !== drag.row ? row : null;
    if (drag.target) drag.target.classList.add('dropline');
    const tn = drag.target ? (drag.target.classList.contains('group') ? `först i ${drag.target.dataset.section}` : `före ${drag.target.querySelector('.nm').textContent}`) : '';
    tipAt(e, drag.target ? `Flytta ${tn}` : 'Flytta raden');
  }
}
function onPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null; $('#dragtip').hidden = true; onPointerUp.at = Date.now();
  const line = $('#linkline'); if (line) line.remove();
  clearDropMarks();
  if (d.kind === 'link') { if (d.target) addDep(d.src, d.target, d.type); else renderGantt(); return; }
  if (d.kind === 'bar') {
    if (!d.moved) { if (d.additive) select([d.t.id], { toggle: true, open: false }); else select([d.t.id], { open: true }); return; }
    const dd = dragDelta(e.clientX - d.x0);
    if (d.group) { if (dd) opShift([...sel], dd); else renderGantt(); return; }
    if (!dd && !d.target && !d.targetRow) { renderGantt(); return; }
    applyDrag(d.t, d.mode, dd, d.target, d.targetRow);
  } else if (d.kind === 'draw') {
    const g = d.lane.querySelector('.ghost'); if (g) g.remove();
    if (!d.moved) { if (sel.size) clearSel(); return; }
    newTaskAt(d.a, d.n, d.row);
  } else if (d.kind === 'rowname') {
    if (!d.moved) {
      const ids = d.row.dataset.rowid ? plan.tasks.filter(t => t.row === d.row.dataset.rowid && visibleTask(t)).map(t => t.id) : [...d.row.querySelectorAll('[data-id]')].map(x => x.dataset.id).filter((v, i, a) => a.indexOf(v) === i && taskById(v));
      if (ids.length) select(ids, { toggle: d.additive, open: true }); else if (d.row.dataset.rowid) renameRow(d.row.dataset.rowid);
      return;
    }
    if (!d.target) return;
    if (d.row.dataset.rowid) {
      const r = rowById(d.row.dataset.rowid);
      change(() => {
        plan.rows.splice(plan.rows.indexOf(r), 1);
        if (d.target.classList.contains('group')) { r.section = d.target.dataset.section; const i = plan.rows.findIndex(x => x.section === r.section); if (i >= 0) plan.rows.splice(i, 0, r); else plan.rows.push(r); }
        else { const tr = rowById(d.target.dataset.rowid); if (!tr) { plan.rows.push(r); return; } r.section = tr.section; plan.rows.splice(plan.rows.indexOf(tr), 0, r); }
      });
    } else if (d.row.dataset.id && d.target.dataset.id) {
      const a = d.row.dataset.id, b = d.target.dataset.id;
      change(() => { const t = taskById(a); plan.tasks.splice(plan.tasks.indexOf(t), 1); plan.tasks.splice(plan.tasks.findIndex(x => x.id === b), 0, t); const tb = taskById(b); if (tb.group !== t.group) t.group = tb.group; });
    }
  }
}
function applyDrag(t, mode, dd, targetMember, targetRow) {
  const r = result.dates[t.id]; const before = milestoneSnapshot();
  const cal = result.cal; const c = r.cal || calKey(t);
  if (t.locked && dd) { toast(`${label(t)} är en låst hållpunkt och flyttas inte genom att dra. Ändra datumet i panelen om beslutet ändras.`, 5000); renderGantt(); return; }
  if (t.type === 'milestone' && dd && !targetRow && !FREE()) { toast(`${label(t)} räknas fram från fasen före. Dra den fasen i stället, eller dra milstolpen upp eller ner till en annan rad.`, 5000); renderGantt(); return; }
  pushUndo(); redoStack.length = 0;
  let note = '';
  if (targetMember) { t.member = targetMember; delete t.with; note += ` Görs nu av ${memberName(targetMember)}.`; }
  if (targetRow) { t.row = targetRow; note += ` Flyttad till raden ${rowById(targetRow).name}.`; }
  if (dd && FREE() && t.type !== 'fixed') {
    if (mode === 'move' || isMsT(t)) { let d2 = dd; const w = toD(addDays(t.fs || r.start, dd)).getUTCDay(); if (w === 6) d2 += dd > 0 ? 2 : -1; if (w === 0) d2 += dd > 0 ? 1 : -2; t.fs = addDays(t.fs || r.start, d2); t.fe = isMsT(t) ? t.fs : addDays(t.fe || r.end, d2); }
    else { t.fe = addDays(t.fe || r.end, dd); if (t.fe < t.fs) t.fe = t.fs; }
    dd = 0;
  }
  if (dd && t.type !== 'milestone') {
    if (t.type === 'fixed') {
      if (mode === 'move') { t.start = addDays(t.start, dd); t.end = addDays(t.end || t.start, dd); }
      else { t.end = addDays(t.end, dd); if (t.end < t.start) t.end = t.start; }
    } else if (mode === 'resize') {
      let newEnd = addDays(r.end, dd); if (newEnd < r.start) newEnd = r.start;
      const n = Math.max(1, workdaysBetween(cal, r.start, newEnd, c) + (cal.isWork(r.start, c) ? 1 : 0));
      if (t.hours) t.hours = n * (t.crew || 1) * (c.startsWith('s4') ? 10 : 8); else t.dur = n;
      note += ` Ny längd ${n} arbetsdagar.`;
    } else {
      const want = cal.firstWork(addDays(r.start, dd), c);
      const nextPart = t.splitOf ? plan.tasks.find(x => x.splitOf === t.splitOf && x.id !== t.id && (x.deps || []).some(d => d.id === t.id)) : null;
      if (want < r.depStart && nextPart && (t.deps || []).length) {
        // En tidig del av en delad fas får ligga före det fasen väntar på; nästa del tar över kopplingarna.
        const moved = t.deps.filter(d => !nextPart.deps.some(x => x.id === d.id));
        nextPart.deps = nextPart.deps.concat(moved); t.deps = []; t.notBefore = want;
        note += ` Delen är inte längre bunden till ${moved.map(d => { const x = taskById(d.id); return x ? label(x) : d.id; }).join(', ') || 'föregående fas'}, det gäller nu nästa del.`;
      } else if (want <= r.depStart) { delete t.notBefore; if (want < r.depStart) note += ` Tidigast möjligt är ${fmt(r.depStart)} på grund av det den väntar på.`; }
      else t.notBefore = want;
    }
  }
  dirty = true; recompute();
  const nr = result.dates[t.id];
  if (mode === 'move' && t.type !== 'fixed' && t.notBefore && nr.start !== t.notBefore) note += ` ${nr.members ? nr.members.map(memberName).join(' och ') + ' är upptagen' : 'Kalendern tillåter inte'} – start ${fmt(nr.start)}.`;
  toast(`${label(t)}: ${fmtShort(nr.start)} – ${fmt(nr.end)}.${note}${impact(before)}`, 6000);
}

// ---- Tangentbord ----
function onKey(e) {
  const k = e.key.toLowerCase(); const cmd = e.metaKey || e.ctrlKey;
  if (!$('#ctx').hidden && k === 'escape') { closeMenu(); return; }
  if (editing()) { if (k === 'escape') document.activeElement.blur(); return; }
  if (view === 'pf') { if (k === 'escape' && panelMode) closePanel(); return; }
  if (cmd && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (cmd && ((k === 'z' && e.shiftKey) || k === 'y')) { e.preventDefault(); redo(); return; }
  if (cmd && k === 'v') { e.preventDefault(); opPaste(); return; }
  if (cmd && k === 'a') { e.preventDefault(); select(plan.tasks.filter(visibleTask).map(t => t.id), { open: false }); return; }
  if (!sel.size) { if (k === 'escape' && panelMode) closePanel(); return; }
  if (cmd && k === 'd') { e.preventDefault(); opDuplicate(); }
  else if (cmd && k === 'c') { e.preventDefault(); opCopy(); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); opDelete(); }
  else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); opShift([...sel], (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 7 : 1)); }
  else if (k === 'enter') { e.preventDefault(); select([...sel], { open: true }); }
  else if (k === 'escape') closePanel();
}

// ---- Händelser ----
function wire() {
  const seg = (s, key, extra) => $(s).addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; ui[key] = v; if (extra) extra(); store('ui4', ui); renderControls(); renderGantt(); });
  seg('#zoom', 'zoom'); seg('#film', 'film'); seg('#groupby', 'groupBy', () => { ui.collapsed = []; }); seg('#rowmode', 'rows', () => { ui.collapsed = []; }); seg('#arrowmode', 'arrows');
  $('#grid').addEventListener('click', e => {
    const add = e.target.closest('[data-act=addrow]'); if (add) { rowAdd(add.dataset.section, null); return; }
    const tg = e.target.closest('[data-act=rtoggle]'); if (tg) { const id = tg.dataset.rid; ui.rcol = (ui.rcol || []).includes(id) ? ui.rcol.filter(x => x !== id) : (ui.rcol || []).concat(id); store('ui4', ui); renderGantt(); return; }
    const g = e.target.closest('.row.group');
    if (g) { const k = g.dataset.group; ui.collapsed = ui.collapsed.includes(k) ? ui.collapsed.filter(x => x !== k) : ui.collapsed.concat(k); store('ui4', ui); renderGantt(); }
  });
  $('#grid').addEventListener('dblclick', e => {
    const el = e.target.closest('.bar[data-id], .ms[data-id]');
    if (el) { select([el.dataset.id], { open: true }); setTimeout(() => { const f = $('#pName'); if (f) { f.focus(); f.select(); } }, 0); return; }
    const nm = e.target.closest('.row[data-rowid] > .name'); if (nm) { renameRow(nm.parentElement.dataset.rowid); return; }
    const lane = e.target.closest('.row:not(.group) > .lane'); if (lane) newTaskAt(dateAtX(e.clientX), 5, lane.parentElement);
  });
  $('#grid').addEventListener('pointerdown', onPointerDown);
  $('#grid').addEventListener('pointermove', onPointerMove);
  $('#grid').addEventListener('pointerup', onPointerUp);
  $('#grid').addEventListener('pointercancel', () => { if (drag) { drag = null; $('#dragtip').hidden = true; const l = $('#linkline'); if (l) l.remove(); renderGantt(); } });
  $('#grid').addEventListener('contextmenu', onContextMenu);
  $('#ctx').addEventListener('click', onMenuClick);
  document.addEventListener('pointerdown', e => { if (!$('#ctx').hidden && !e.target.closest('#ctx')) closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
  $('#source').addEventListener('click', e => { if (e.target.id === 'btnReset') { pushUndo(); plan = clone(baselinePlan); dirty = false; sel = new Set(); closePanel(); recompute(); toast('Återställd till senast hämtade versionen. Ångra finns om du ångrar dig.'); } });
  $('#selbar').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    ({ dup: () => opDuplicate(), del: () => opDelete(), clear: () => clearSel(), split: () => opSplit([...sel][0]), msend: () => addMilestoneAtEnd([...sel][0]),
      res: () => openPanel('res'), cal: () => openPanel('cal'),
      tpl: () => { openPanel('tpl'); setTimeout(() => { const f = $('#tNew'); if (f) f.focus(); }, 0); } }[b.dataset.act] || (() => {}))();
  });
  $('#panel').addEventListener('change', e => {
    if (panelMode === 'sec') { onSecChange(e); return; }
    if (panelMode === 'var' && e.target.id === 'vCmp') { ui.cmp = e.target.value; render(); return; }
    const id = e.target.id;
    if (id === 'mIgnHol' || id === 'mIgnBrk') return setFlag(workSel(), id === 'mIgnHol' ? 'ignoreHol' : 'ignoreBreaks', e.target.checked);
    if (id === 'optHol') return change(() => { plan.settings.holidays = e.target.checked; });
    if (panelMode === 'task') return onTaskChange(e);
    if (panelMode === 'res') return onResChange(e);
    if (panelMode === 'cal') {
      const f = e.target.dataset.f, i = +e.target.dataset.i; if (!f) return; const b = plan.settings.breaks[i];
      change(() => { if (f === 'kname') b.name = e.target.value; if (f === 'kfrom') { b.from = e.target.value; if (b.to < b.from) b.to = b.from; } if (f === 'kto') b.to = e.target.value < b.from ? b.from : e.target.value; if (f === 'kon') b.on = e.target.checked; });
      return;
    }
    if (panelMode === 'multi') {
      if (id === 'mPool') { const v = e.target.value; if (!v) return; if (v === '-') { assign(workSel(), null, null); return; } assign(workSel(), v, null); const g = poolById(v); const mm = $('#mMem'); if (mm && g) { $('#mPool').value = v; mm.disabled = false; mm.innerHTML = `<option value="">Den som är ledig först</option>${g.members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}`; } return; }
      if (id === 'mMem') { const pid = $('#mPool').value; if (pid && pid !== '-') assign(workSel(), pid, e.target.value || null); return; }
      if (id === 'mStatus') { if (e.target.value !== '*') setStatus([...sel], e.target.value); return; }
      if (id === 'mRow') { const v = e.target.value; if (v) change(() => [...sel].forEach(x => { taskById(x).row = v; })); return; }
    }
    if (panelMode === 'tpl') {
      const i = e.target.dataset.i;
      if (e.target.dataset.f === 'tname') { const v = e.target.value.trim(); if (v) change(() => { templates[i].name = v; }); }
      if (e.target.dataset.f === 'tfilm') { const d = $('#tDeps' + i); if (d) d.value = anchorFor(templates[i], Number(e.target.value) || null); }
    }
  });
  $('#panel').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act;
    if (act === 'close') return closePanel();
    if (panelMode === 'var') return onVarAction(act, b);
    if (panelMode === 'sec') return onSecAction(act, b);
    if (panelMode === 'rules') return onRulesAction(act);
    if (panelMode === 'calexp') { if (act === 'cesend') calExport(b); return; }
    if (panelMode === 'pdfexp') return onPdfAction(act, b);
    if (panelMode === 'bud') return onBudAction(act);
    if (panelMode === 'ai') return onAiAction(act, b);
    if (panelMode === 'imp') { if (act === 'impgo') doImport(); return; }
    if (panelMode === 'res') return onResAction(act, b.dataset.path);
    if (panelMode === 'cal') {
      if (act === 'kadd') change(() => { plan.settings.breaks.push({ name: 'Uppehåll', from: '2028-12-22', to: '2029-01-05', on: true }); });
      if (act === 'kdel') change(() => { plan.settings.breaks.splice(+b.dataset.i, 1); });
      return;
    }
    if (panelMode === 'tpl') {
      const i = +b.dataset.i;
      if (act === 'tins') opInsertTemplate(i, Number($('#tFilm' + i).value) || null, $('#tDeps' + i).value, $('#tNb' + i).value);
      if (act === 'tdel') { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '?'; b.title = 'Klicka igen för att ta bort'; return; } change(() => { templates.splice(i, 1); }); }
      if (act === 'tnew') { const n = ($('#tNew').value || '').trim() || 'Ny mall'; opSaveTemplate([...sel], n); }
      return;
    }
    if (panelMode === 'multi') {
      if (act === 'mshift') opShift([...sel], parseInt($('#mShift').value, 10) || 0);
      if (act === 'dupM') opDuplicate(); if (act === 'copyM') opCopy(); if (act === 'delM') opDelete();
      if (act === 'mtpl') opSaveTemplate([...sel], ($('#mTpl').value || '').trim() || 'Ny mall');
      if (act === 'mcolor') setColor([...sel], b.dataset.color);
      if (act === 'chain') { const ids = [...sel].sort((x, y) => result.dates[x].start < result.dates[y].start ? -1 : 1); const before = milestoneSnapshot(); let n = 0; change(() => ids.forEach((id, i) => { if (!i) return; const t = taskById(id); if (t.type === 'fixed' || dependsOn(ids[i - 1], id) || (t.deps || []).some(d => d.id === ids[i - 1])) return; t.deps = (t.deps || []).concat([{ id: ids[i - 1], type: isMsT(t) ? 'FF' : 'FS', lag: 0 }]); n++; })); toast(`Kopplade ${n} faser i datumordning.${impact(before)}`, 5000); }
      return;
    }
    const t = taskById(selected); if (!t) return;
    if (act === 'doerDel') { const i = +b.dataset.i; change(() => { t.doers.splice(i, 1); if (!t.doers.length) delete t.doers; }); return; }
    if (act === 'addPerson') { const nm = (($('#pNewPerson') || {}).value || '').trim(); const role = (($('#pNewRole') || {}).value || '').trim(); if (!nm) { toast('Skriv personens namn först.'); return; }
      b.disabled = true; addPerson(nm, role).then(pid => { change(() => { if (!(t.doers || []).some(d => d.id === pid)) t.doers = (t.doers || []).concat([{ id: pid, pct: 100 }]); }); toast(`${nm} finns nu i personregistret.`); }).catch(err => toast(mcpError(err, 'spara i personregistret'), 7000)).finally(() => { b.disabled = false; }); return; }
    if (act === 'addRec') { const nm = (($('#pNewRec') || {}).value || '').trim(); if (!nm) { toast('Skriv mottagarens namn först.'); return; } change(() => { const ex = (plan.recipients || []).find(x => x.name.toLowerCase() === nm.toLowerCase()); const rid = ex ? ex.id : recipId(nm); if (!ex) plan.recipients.push({ id: rid, name: nm, kind: '', on: true }); t.to = [...new Set((t.to || []).concat(rid))]; }); toast(`${nm} finns nu som mottagare och sparas i fliken Mottagare.`); return; }
    if (act === 'dDel') { const i = +b.dataset.i; const soft = b.dataset.k === 's'; change(() => { if (soft) { t.soft.splice(i, 1); if (!t.soft.length) delete t.soft; } else t.deps.splice(i, 1); }); }
    else if (act === 'goto') select([b.dataset.id], { open: true });
    else if (act === 'clearNb') change(() => { delete t.notBefore; });
    else if (act === 'color') setColor([t.id], b.dataset.color);
    else if (act === 'split') opSplit(t.id, $('#pSplit').value);
    else if (act === 'msend') addMilestoneAtEnd(t.id);
    else if (act === 'dupOne') opDuplicate([t.id]);
    else if (act === 'copyOne') opCopy([t.id]);
    else if (act === 'tplOne') { sel = new Set([t.id]); openPanel('tpl'); setTimeout(() => { const f = $('#tNew'); if (f) f.focus(); }, 0); }
    else if (act === 'del') opDelete([t.id]);
  });
  document.addEventListener('keydown', onKey);
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnRes').addEventListener('click', () => panelMode === 'res' ? closePanel() : openPanel('res'));
  $('#btnTpl').addEventListener('click', () => panelMode === 'tpl' ? closePanel() : openPanel('tpl'));
  $('#btnSec').addEventListener('click', () => panelMode === 'sec' ? closePanel() : openPanel('sec'));
  $('#btnVar').addEventListener('click', () => panelMode === 'var' ? closePanel() : openPanel('var'));
  $('#btnBud').addEventListener('click', () => panelMode === 'bud' ? closePanel() : openPanel('bud'));
  $('#btnLog').addEventListener('click', () => { if (panelMode === 'log') return closePanel(); openPanel('log'); if (mcp) loadLog(); });
  $('#btnAi').addEventListener('click', () => panelMode === 'ai' ? closePanel() : openPanel('ai'));
  $('#btnImp').addEventListener('click', () => panelMode === 'imp' ? closePanel() : openPanel('imp'));
  let impT = null;
  $('#panel').addEventListener('input', e => { if (panelMode !== 'imp' || e.target.id !== 'impText') return; clearTimeout(impT); impT = setTimeout(() => { const pos = e.target.selectionStart; renderImportPanel(); const t = $('#impText'); if (t) { t.focus(); try { t.setSelectionRange(pos, pos); } catch (x) {} } }, 450); });
  $('#panel').addEventListener('change', e => { if (panelMode !== 'imp') return; if (e.target.id === 'impSec') { impState.section = e.target.value; renderImportPanel(); } if (e.target.id === 'impMode') { impState.mode = e.target.value; renderImportPanel(); } });
  $('#btnCal').addEventListener('click', () => panelMode === 'cal' ? closePanel() : openPanel('cal'));
  $('#btnRow').addEventListener('click', () => { if (ui.rows !== 'manual') { ui.rows = 'manual'; store('ui4', ui); renderControls(); } const cur = taskById(selected); const r = cur && rowById(cur.row); rowAdd(r ? r.section : 'Förproduktion', r ? r.id : null); });
  $('#btnNew').addEventListener('click', () => {
    const cur = taskById(selected);
    const t = { id: uniqueId(plan, 'ny'), name: 'Ny fas', group: cur ? cur.group : 'Förproduktion', dur: 5, deps: cur ? [{ id: cur.id, type: 'FS', lag: 0 }] : [] };
    if (cur && cur.row) t.row = cur.row;
    if (cur && cur.film) t.film = cur.film;
    change(() => { const idx = cur ? plan.tasks.indexOf(cur) + 1 : plan.tasks.length; plan.tasks.splice(idx, 0, t); });
    select([t.id], { open: true });
  });
  $('#btnLoad').addEventListener('click', () => loadFromSheet(true));
  $('#btnSave').addEventListener('click', () => saveToSheet(false));

}

// ---- Google Sheets ----
function mcpError(err, verb) {
  if (err && err.code === 'kc_nosource') return 'KC är inte kopplat till någon källa. Koppla källor i KC först.';
  return `Det gick inte att ${verb}${err && err.message ? ': ' + err.message : '.'}`;
}
async function getRange(range) {
  const res = await mcp.callTool(SERVER, 'get_values', { spreadsheetId: cur.id, range }, { cache: false });
  const p = res.payload || {}; return (p && p.values) || [];
}
const tryRange = async range => { try { return await getRange(range); } catch (e) { return null; } };
async function loadFromSheet(user, force) {
  if (!mcp) return false;
  const btn = $('#btnLoad');
  if (dirty && user && !force && !loadFromSheet._armed) { loadFromSheet._armed = true; btn.textContent = 'Klicka igen – osparat ersätts'; setTimeout(() => { loadFromSheet._armed = false; btn.textContent = 'Hämta från Sheet'; }, 4000); return; }
  loadFromSheet._armed = false; btn.textContent = 'Hämtar…'; btn.disabled = true; dropSnap(cur.id); staleNote = '';
  try {
    const [f, r, s] = await Promise.all([getRange('Faser!A1:AK800'), getRange('Resurser!A1:H300'), getRange('Inställningar!A1:B50')]);
    const [m, ra, ka, va, mo] = await Promise.all([tryRange('Mallar!A1:W1500'), tryRange('Rader!A1:F500'), tryRange('Kalender!A1:D200'), tryRange('Varianter!A1:E200'), tryRange('Mottagare!A1:D200')]);
    const [bu, lg] = await Promise.all([tryRange('Budget!A1:H3000'), tryRange('Ändringslogg!A1:A20000')]);
    if (!f.length) throw { message: 'fliken Faser är tom' };
    if (dirty) pushUndo();
    const p = normalize(rowsToPlan(f, r, s, ra || [], ka || [], mo || []));
    p.budget = budgetFromRows(bu);
    plan = p; result = planSchedule(p); baselinePlan = clone(p); baseline = clone(result.dates); cur.name = p.meta.title || cur.name;
    if (m) { const tl = rowsToTemplates(m); templates = tl; }
    variants = va && va.length > 1 ? rowsToVariants(va) : builtinVariants();
    sheetRows = { faser: f.length, res: r.length, set: s.length, mall: m ? m.length : 1, rader: ra ? ra.length : 1, kal: ka ? ka.length : 1, var: va ? va.length : 0, mot: mo ? mo.length : 1, log: lg ? lg.length : 0, bud: bu ? bu.length : 1 };
    source = { kind: 'sheet', at: nowStamp() };
    dirty = false; sel = new Set(); if (panelMode === 'task' || panelMode === 'multi') closePanel(); render();
    if (people === null) loadPeople();
    if (user) toast(`Hämtade ${p.tasks.length} faser på ${p.rows.length} rader, ${p.resources.length} resursgrupper och ${templates.length} mallar.`);
    undoStack.length = 0; redoStack.length = 0; checkDraft();
    if (view === 'pf') renderPortfolio();
    return true;
  } catch (err) { if (user) toast(mcpError(err, 'hämta planen')); return false; }
  finally { btn.textContent = 'Hämta från Sheet'; btn.disabled = !mcp; }
}
function pad(rows, n, w) { const out = rows.slice(); while (out.length < n) out.push(new Array(w).fill('')); return out.map(r => { const x = r.slice(); while (x.length < w) x.push(''); return x; }); }
const colL = n => n <= 26 ? String.fromCharCode(64 + n) : String.fromCharCode(64 + Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26));
// Fliken Status: veckans deadlines och varningar, läses av kommandocentralens morgonuppdatering
function statusRows() {
  const today = toS(new Date()), lim = addDays(today, 120), stamp = today, proj = plan.meta.title || cur.name;
  const own = t => t.owner ? personName(t.owner) : '';
  const rows = [['Typ', 'Nivå', 'Datum', 'Projekt', 'Moment', 'ID', 'Text', 'Mottagare', 'Ansvarig', 'Uppdaterad']];
  const dl = [];
  plan.tasks.forEach(t => { const d = result.dates[t.id]; if (!d) return;
    const push = (date, txt) => { if (date >= today && date <= lim) dl.push(['deadline', '', date, proj, label(t), t.id, txt, recipNames(t), own(t), stamp]); };
    if (t.read) { push(d.start, `${recipNames(t) || 'Mottagaren'} får materialet, ${t.dlvAt || 'dagens början'}`); push(d.end, `Feedback senast, ${t.fbAt || 'dagens slut'}`); }
    else if (isMsT(t)) push(d.start, t.locked ? 'Låst hållpunkt' : (t.to || []).length ? 'Leverans till ' + recipNames(t) : 'Milstolpe');
  });
  dl.sort((a, b) => a[2] < b[2] ? -1 : 1).forEach(r => rows.push(r));
  (result.flags || []).forEach(f => { const t = taskById(f.id); if (!t) return; const tmp = document.createElement('div'); tmp.innerHTML = flagText(f);
    rows.push(['varning', f.level === 'bad' ? 'röd' : 'gul', (result.dates[f.id] || {}).start || '', proj, label(t), f.id, tmp.textContent, recipNames(t), own(t), stamp]); });
  return rows;
}
async function saveToSheet(auto) {
  if (!mcp || saveBusy) return false;
  saveBusy = true; let ok = false;
  const btn = $('#btnSave'); btn.disabled = true; btn.textContent = 'Sparar…';
  plan.meta.updated = toS(new Date());
  const rows = planToRows(plan, result);
  let logEntries = []; try { logEntries = diffPlans(baselinePlan, planSchedule(baselinePlan), plan, result); } catch (e) { logEntries = []; }
  // Varje flik diffas mot det som lästes. Faser matchas på ID, övriga flikar rad för rad – och varje rad
  // skickas med de värden sidan såg, så att servern vägrar skriva om någon annan hunnit ändra raden.
  const tabs = [
    ['Faser', rows.faser, 'ID'], ['Resurser', rows.res], ['Inställningar', rows.set], ['Rader', rows.rader],
    ['Kalender', rows.kal], ['Mallar', templatesToRows(templates)], ['Mottagare', rows.mot],
  ];
  if ((plan.budget || []).length || (lastRaw.Budget || []).length > 1) tabs.push(['Budget', budgetToRows(plan.budget)]);
  if (variants.length || (lastRaw.Varianter || []).length > 1) tabs.push(['Varianter', variantsToRows()]);
  tabs.push(['Status', statusRows()]);
  const tgt = kcTarget(cur.id);
  let conflicts = 0, written = 0; const miss = [];
  try {
    for (const [tab, nw, key] of tabs) {
      const d = diffTab(lastRaw[tab], nw, key);
      if (!d.rows.length && !d.del.length) continue;
      try {
        const r = await kcApi('planWrite', Object.assign({}, tgt, { sheet: tab, keyCols: key ? [key] : undefined, rows: d.rows, del: d.del }), true);
        conflicts += (r.conflicts || []).length; written += (r.written || 0) + (r.appended || 0) + (r.deleted || 0);
        if (r.version) loadedVersion = r.version;
      } catch (e) { miss.push(tab); }
    }
    try { await writeLog(logEntries); } catch (e) { miss.push('Ändringslogg'); }
    // läs om det som nu ligger i arket, så nästa diff görs mot rätt rader
    dropSnap(cur.id);
    try { const d = await kcSnap(cur.id, null, true); lastRaw = Object.assign({}, lastRaw, d.sheets); if (d.version) loadedVersion = d.version; } catch (e) {}
    if (miss.length === tabs.length) throw { message: 'ingen flik kunde sparas' };
    if (conflicts) {
      staleNote = `${conflicts} rad${conflicts === 1 ? '' : 'er'} hade ändrats i arket av någon annan och sparades inte. Hämta från Sheet och gör om de ändringarna.`;
      toast('Kunde inte spara allt: ' + staleNote, 9000);
    } else {
      baselinePlan = clone(plan); baseline = clone(result.dates); dirty = false; staleNote = '';
      source = { kind: 'sheet', at: nowStamp() };
      ok = true; clearDraft();
      if (!auto || miss.length) toast('Sparat' + (written ? '' : ' (inget hade ändrats)') + '.' + (miss.length ? ` Kunde inte spara ${miss.join(', ')}.` : ''), miss.length ? 7000 : 2600);
    }
    render();
  } catch (err) { toast('Kunde inte spara: ' + ((err && err.message) || 'okänt fel') + '. Ändringarna finns kvar här.', 7000); }
  finally { btn.textContent = 'Spara till Sheet'; btn.disabled = !mcp; saveBusy = false; kcSaved(ok); }
  return ok;
}
async function exportCsv() {
  if (!downloads) return;
  const head = ['Rad', 'Fas', 'Avdelning', 'Film', 'Start', 'Slut', 'Arbetsdagar', 'Resursgrupp', 'Person', 'Milstolpe'];
  const q = v => { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const order = plan.rows.map(r => r.id);
  const ts = plan.tasks.slice().sort((a, b) => order.indexOf(a.row) - order.indexOf(b.row));
  const lines = [head.join(';')].concat(ts.map(t => { const r = result.dates[t.id] || {}; const g = t.res && poolById(t.res); return [(rowById(t.row) || {}).name || '', t.name, t.group, filmTag(t), r.start, r.end, r.dur || t.dur || '', g ? g.name : '', (r.members || []).map(memberName).join(', '), isMsT(t) ? 'ja' : ''].map(q).join(';'); }));
  try { await downloads.save({ filename: (plan.meta.title || 'Produktionsplan').replace(/[^\wåäöÅÄÖ-]+/g, '_') + '.csv', data: '﻿' + lines.join('\r\n') }); }
  catch (err) { if (err && err.code !== 'cancelled' && err.code !== 'declined') toast('Exporten gick inte att spara'); }
}

// ---- Portfölj: alla projekt, krockar och bemanning över projekt ----
const DRIVE = 'Google Drive';
const PF_SUM = [['Utveckling', ['Utveckling'], 'utv'], ['Förproduktion', ['Förproduktion'], 'prep'], ['Inspelning', ['Inspelning'], 'shoot'], ['Post', ['Klipp', 'Ljud', 'Musik', 'Bild'], 'klipp'], ['Leverans', ['Leverans'], 'lev']];
const PF_PX = { week: 10, month: 3, quarter: 1.3, year: 0.55 };
let registry = null; // [{name, short, id, color, status, on, note, row}]
// ---- Personregister: gemensamt för bolaget, fliken Personer i portföljarket ----
let people = null; let peopleErr = '';
const PEOPLE_HEAD = ['Person-ID', 'Namn', 'Roll', 'Bolag', 'Aktiv', 'Krockvarning'];
let acks = []; // kvitterade krockar: [{key, row}]
const ACK_TAB = 'Kvitterade krockar';
async function loadAcks() {
  try { const res = await mcp.callTool(SERVER, 'get_values', { spreadsheetId: REG_ID, range: `'${ACK_TAB}'!A1:D2000` }, { cache: false });
    const v = ((res.payload || {}).values) || []; acks = v.slice(1).map((r, i) => ({ key: String(r[0] || '').trim(), row: i + 2 })).filter(x => x.key); acks.rows = v.length; }
  catch (e) { acks = []; acks.rows = 1; }
}
async function loadPeople() {
  if (!mcp) { people = people || []; return; }
  try { const res = await mcp.callTool(SERVER, 'get_values', { spreadsheetId: REG_ID, range: 'Personer!A1:E1000' }, { cache: false });
    const v = ((res.payload || {}).values) || []; const h = (v[0] || []).map(x => String(x).trim()); const ix = n => h.indexOf(n);
    const c = (r, n) => { const i = ix(n); return i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim(); };
    people = v.slice(1).map((r, i) => ({ id: c(r, 'Person-ID'), name: c(r, 'Namn') || c(r, 'Person-ID'), role: c(r, 'Roll'), org: c(r, 'Bolag'), on: !/^nej$/i.test(c(r, 'Aktiv')), warn: !/^nej$/i.test(c(r, 'Krockvarning')), row: i + 2 })).filter(x => x.id);
    await loadAcks();
    peopleErr = '';
  } catch (e) { people = people || []; peopleErr = mcpError(e, 'hämta personregistret'); }
  if (panelMode === 'task') renderTaskPanel(); if (view === 'pf') renderPortfolio();
}
const personName = id => ((people || []).find(x => x.id === id) || { name: id }).name;
const personId = name => { let b = String(name).trim().split(/\s+/)[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '') || 'person'; let id = b, k = 2; while ((people || []).some(x => x.id === id)) id = b + k++; return id; };
async function addPerson(name, role) {
  if (!mcp) throw { message: 'kopplingen till Google Sheets saknas' };
  if (people === null) await loadPeople();
  const ex = people.find(x => norm(x.name) === norm(name)); if (ex) return ex.id;
  const id = personId(name); const row = people.length + 2;
  await mcp.callTool(SERVER, 'update_values', { spreadsheetId: REG_ID, range: `Personer!A${row}:F${row}`, values: [[id, name, role || '', plan.meta.company || '', 'ja', 'ja']] }, { cache: false });
  people.push({ id, name, role: role || '', org: plan.meta.company || '', on: true, warn: true, row });
  return id;
}
// Beläggning per person och vardag över alla projekt. Ansvar ger ingen beläggning.
function loadMap(ps) {
  const M = {};
  const add = (key, name, p, t, r, pct) => {
    const o = M[key] = M[key] || { key, name, days: {}, items: [] }; o.items.push({ p, t, r, pct });
    for (let s = r.start, g = 0; s <= r.end && g < 2500; s = addDays(s, 1), g++) { const w = toD(s).getUTCDay(); if (!w || w === 6) continue; const d = o.days[s] = o.days[s] || { pct: 0, items: [] }; d.pct += pct; d.items.push({ p, t, pct }); }
  };
  ps.forEach(p => {
    if (!p.plan) return;
    p.plan.tasks.forEach(t => { const r = p.result.dates[t.id]; if (!r || isMsT(t)) return; (t.doers || []).forEach(d => add('p:' + d.id, personName(d.id), p, t, r, d.pct || 100)); });
    bookings(p).filter(b => b.named && !(b.task.doers || []).length).forEach(b => { const pr = (people || []).find(x => norm(x.name) === b.key); add(pr ? 'p:' + pr.id : 'n:' + b.key, pr ? pr.name : b.name, p, b.task, p.result.dates[b.task.id], 100); });
  });
  return M;
}
const olKey = o => o.key + '|' + [...o.items.keys()].sort().join(',');
const warnsFor = key => !key.startsWith('p:') || ((people || []).find(x => 'p:' + x.id === key) || { warn: true }).warn !== false;
async function ackOverload(k) {
  const row = (acks.rows || 1) + 1;
  await mcp.callTool(SERVER, 'update_values', { spreadsheetId: REG_ID, range: `'${ACK_TAB}'!A${row}:D${row}`, values: [[k, k.split('|')[0].replace(/^[pn]:/, ''), '', toS(new Date())]] }, { cache: false });
  acks.push({ key: k, row }); acks.rows = row;
}
async function unackOverload(k) {
  const a = acks.find(x => x.key === k); if (!a) return;
  await mcp.callTool(SERVER, 'update_values', { spreadsheetId: REG_ID, range: `'${ACK_TAB}'!A${a.row}:D${a.row}`, values: [['', '', '', '']] }, { cache: false });
  acks = Object.assign(acks.filter(x => x !== a), { rows: acks.rows });
}
async function setPersonWarn(pid, on) {
  const pr = (people || []).find(x => x.id === pid); if (!pr) return;
  await mcp.callTool(SERVER, 'update_values', { spreadsheetId: REG_ID, range: `Personer!F${pr.row}`, values: [[on ? 'ja' : 'nej']] }, { cache: false });
  pr.warn = on;
}
function overloads(ps) {
  const out = []; const M = loadMap(ps);
  Object.values(M).forEach(o => {
    const days = Object.keys(o.days).filter(d => o.days[d].pct > 100).sort(); let cur0 = null;
    days.forEach(d => {
      if (cur0 && d <= addDays(cur0.e, 3)) { cur0.e = d; cur0.max = Math.max(cur0.max, o.days[d].pct); o.days[d].items.forEach(x => cur0.items.set(x.p.short + '|' + x.t.id, x)); }
      else { cur0 = { key: o.key, name: o.name, s: d, e: d, max: o.days[d].pct, items: new Map() }; o.days[d].items.forEach(x => cur0.items.set(x.p.short + '|' + x.t.id, x)); out.push(cur0); }
    });
  });
  return out.sort((a, b) => a.s < b.s ? -1 : 1);
}
let pfData = {};     // sheetId -> {plan, result, err, at}
let pfBusy = false, pfErr = '';
const pfUi = Object.assign({ zoom: 'month', compact: false, open: [] }, store('pf') || {});
let view = store('view') === 'pf' ? 'pf' : 'plan';
const sheetIdOf = s => { const m = String(s || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/); return m ? m[1] : String(s || '').trim(); };
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? String(c).trim() : '#6B7280';
const ROLE_WORDS = /^(mixare|ljudmixare|finklippare|grovklippare|klippare|dialogläggare|foleyartist|foley|effektläggare|vfx|colorist|kompositör|författare|manusförfattare|fotograf|regissör|producent|ljudtekniker|ljuddesigner|scripta|inspelningsledare|scenograf|kostymör|maskör|elektriker|passare|gaffer|attributör)\b/;
function isPlaceholder(name, poolName) {
  const n = norm(name), p = norm(poolName);
  if (!n) return true;
  if (p && (n === p || n.startsWith(p.split(' ')[0]))) return true;
  if (/\s(f?\d+|[a-zåäö])$/i.test(String(name).trim())) return true;
  return ROLE_WORDS.test(n);
}
function weekdaysIn(a, b) { let n = 0, s = a, g = 0; while (s <= b && g++ < 4000) { const w = toD(s).getUTCDay(); if (w && w !== 6) n++; s = addDays(s, 1); } return n; }
const mondayOf = s => { const w = (toD(s).getUTCDay() + 6) % 7; return addDays(s, -w); };

// Projektet som är öppet i planvyn räknas alltid med sina osparade ändringar
function projects() {
  const reg = (registry || [{ name: plan.meta.title, short: plan.meta.title, id: cur.id, color: '#BD1B22', status: '', on: true, note: '' }]).filter(p => p.on);
  return reg.map(p => {
    if (p.id && p.id === cur.id) return Object.assign({}, p, { plan, result, live: true, at: source.at });
    const d = p.id ? pfData[p.id] : null;
    return Object.assign({}, p, d ? { plan: d.plan, result: d.result, err: d.err, at: d.at } : {});
  });
}
const tagBySheet = {};   // planark-ID -> KC-tagg, så att Öppna går till KC:s projektflik
async function kcPortfolio() {
  try { const r = await kcApi('portfolio', {}); (r.projects || []).forEach(p => { if (p.tag && p.sheet) tagBySheet[p.sheet] = p.tag; }); if (r.registryUrl) REG_URL = r.registryUrl; return r; } catch (e) { return null; }
}
async function loadRegistry() {
  const pf = await kcPortfolio();
  let v = null;
  if (pf && pf.registry) { try { const res = await mcp.callTool(SERVER, 'get_values', { spreadsheetId: REG_ID, range: 'Projekt!A1:G200' }, { cache: false }); v = ((res.payload || {}).values) || []; } catch (e) { v = null; } }
  if (v) {
    const head = (v[0] || []).map(h => String(h).trim()); const ix = n => head.indexOf(n);
    const c = (r, n) => { const i = ix(n); return i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim(); };
    registry = v.slice(1).map((r, i) => ({ name: c(r, 'Projekt'), short: c(r, 'Kortnamn') || c(r, 'Projekt'), id: sheetIdOf(c(r, 'Sheet-ID')), color: safeColor(c(r, 'Färg')), status: c(r, 'Status'), on: !/^nej$/i.test(c(r, 'I portföljen')), note: c(r, 'Anteckning'), row: i + 2 })).filter(p => p.name);
  } else registry = [];
  // KC-projekt med planark som inte står i registret räknas också med
  ((pf && pf.projects) || []).filter(p => p.sheet && !registry.some(x => x.id === p.sheet)).forEach(p => registry.push({ name: p.name, short: p.name, id: p.sheet, color: '#6B7280', status: p.phase || '', on: true, note: '', row: 0 }));
}
async function loadProjectData(id) {
  const g = range => mcp.callTool(SERVER, 'get_values', { spreadsheetId: id, range }, { cache: false }).then(r => ((r.payload || {}).values) || []);
  const t = range => g(range).catch(() => null);
  const [f, r, s] = await Promise.all([g('Faser!A1:AK800'), g('Resurser!A1:H300'), g('Inställningar!A1:B50')]);
  const [ra, ka] = await Promise.all([t('Rader!A1:F500'), t('Kalender!A1:D200')]);
  if (!f.length) throw { message: 'fliken Faser är tom' };
  const p = normalize(rowsToPlan(f, r, s, ra || [], ka || []));
  return { plan: p, result: planSchedule(p), at: nowStamp() };
}
async function refreshPortfolio(user) {
  if (!mcp || pfBusy) return;
  pfBusy = true; pfErr = ''; renderPortfolio();
  try {
    await loadRegistry(); await loadPeople();
    const todo = registry.filter(p => p.on && p.id && p.id !== cur.id);
    await Promise.all(todo.map(async p => { try { pfData[p.id] = await loadProjectData(p.id); } catch (e) { pfData[p.id] = { err: mcpError(e, 'hämta ' + p.name) }; } }));
    renderProjSel();
    if (user) toast(`Hämtade ${registry.length} projekt från portföljen.`);
  } catch (e) { pfErr = mcpError(e, 'hämta portföljen'); }
  finally { pfBusy = false; renderPortfolio(); }
}

// ---- Analys ----
function summarize(p) {
  const out = PF_SUM.map(([label, groups, key]) => ({ label, key, spans: [], ms: [] }));
  if (!p.plan) return out;
  p.plan.tasks.forEach(t => {
    const r = p.result.dates[t.id]; if (!r) return;
    const i = PF_SUM.findIndex(s => s[1].includes(t.group)); if (i < 0) return;
    if (isMsT(t)) { out[i].ms.push({ name: label(t), d: r.start }); return; }
    if (t.light) return;
    out[i].spans.push([r.start, r.end]);
  });
  out.forEach(o => { // slå ihop överlappande perioder
    o.spans.sort((a, b) => a[0] < b[0] ? -1 : 1);
    const m = []; o.spans.forEach(s => { const l = m[m.length - 1]; if (l && s[0] <= addDays(l[1], 3)) { if (s[1] > l[1]) l[1] = s[1]; } else m.push(s.slice()); });
    o.spans = m;
  });
  return out;
}
function bookings(p) {
  const out = []; if (!p.plan) return out;
  const poolName = id => { const g = p.plan.resources.find(r => r.id === id); return g ? g.name : ''; };
  p.plan.tasks.forEach(t => {
    const r = p.result.dates[t.id]; if (!r || !r.members || isMsT(t)) return;
    r.members.forEach(mid => {
      const name = p.result.memberName[mid] || mid; const pool = poolName(p.result.memberPool[mid]);
      out.push({ proj: p, task: t, label: label(t), name, pool, key: norm(name), named: !isPlaceholder(name, pool), start: r.start, end: r.end });
    });
  });
  return out;
}
function collisions(ps) {
  const people = [], phases = [];
  const all = ps.flatMap(bookings).filter(b => b.named);
  const byKey = {}; all.forEach(b => { (byKey[b.key] = byKey[b.key] || []).push(b); });
  Object.values(byKey).forEach(list => {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; if (a.proj === b.proj) continue;
      const s = a.start > b.start ? a.start : b.start, e = a.end < b.end ? a.end : b.end;
      if (s > e) continue; const n = weekdaysIn(s, e); if (!n) continue;
      people.push({ name: a.name, a, b, s, e, n });
    }
  });
  const heavy = p => (p.plan ? p.plan.tasks : []).filter(t => !isMsT(t) && (t.group === 'Inspelning' || /hard\s*prep/i.test(t.name))).map(t => ({ t, p, r: p.result.dates[t.id], shoot: t.group === 'Inspelning' })).filter(x => x.r);
  const hv = ps.map(heavy);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) hv[i].forEach(a => hv[j].forEach(b => {
    if (!a.shoot && !b.shoot) return;
    const s = a.r.start > b.r.start ? a.r.start : b.r.start, e = a.r.end < b.r.end ? a.r.end : b.r.end; if (s > e) return;
    const n = weekdaysIn(s, e); if (!n) return;
    phases.push({ a, b, s, e, n, level: a.shoot && b.shoot ? 'hard' : 'soft' });
  }));
  people.sort((x, y) => y.n - x.n); phases.sort((x, y) => (x.level === 'hard' ? -1 : 1) - (y.level === 'hard' ? -1 : 1) || y.n - x.n);
  return { people, phases };
}
function demand(ps, R) { // personer i arbete per yrkesroll och vecka, alla projekt
  const roles = {};
  ps.forEach(p => bookings(p).forEach(b => {
    const role = b.pool || 'Övrigt'; const k = norm(role);
    const o = roles[k] = roles[k] || { role, weeks: {} };
    for (let w = mondayOf(b.start > R.start ? b.start : R.start); w <= b.end && w <= R.end; w = addDays(w, 7)) {
      const ws = w < b.start ? b.start : w, we = addDays(w, 4) > b.end ? b.end : addDays(w, 4); if (ws > we || !weekdaysIn(ws, we)) continue;
      const c = o.weeks[w] = o.weeks[w] || {}; (c[p.short] = c[p.short] || new Set()).add(b.proj.short + '|' + b.name);
    }
  }));
  return Object.values(roles).map(o => { const weeks = {}; let max = 0; for (const w in o.weeks) { const per = {}; let n = 0; for (const s in o.weeks[w]) { per[s] = o.weeks[w][s].size; n += per[s]; } weeks[w] = { n, per }; if (n > max) max = n; } return { role: o.role, weeks, max }; }).filter(o => o.max).sort((a, b) => b.max - a.max);
}

// ---- Rendering ----
function pfRange(ps) {
  let a = null, b = null;
  ps.forEach(p => { if (!p.result) return; for (const id in p.result.dates) { const r = p.result.dates[id]; if (!a || r.start < a) a = r.start; if (!b || r.end > b) b = r.end; } });
  a = a || toS(new Date()); b = b || addDays(a, 365);
  const s = toD(a), e = toD(b);
  return { start: toS(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1))), end: addDays(toS(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0))), 31) };
}
function renderPortfolio() {
  const box = $('#pf'); if (!box) return;
  const ps = projects();
  const st = $('#pfStatus');
  const loaded = ps.filter(p => p.plan).length;
  st.innerHTML = !mcp ? 'Portföljen behöver kopplingen till Google Sheets. Den inbyggda planen visas.'
    : pfBusy ? 'Hämtar projekt…'
      : pfErr ? `<span class="pf-err">${esc(pfErr)}</span>`
        : registry ? `${loaded} av ${ps.length} projekt har en plan · register: <a href="${REG_URL}" target="_blank" rel="noopener">Projektportföljen</a>`
          : `Bara öppet projekt visas. <button class="linkbtn" type="button" data-pf="refresh">Hämta portföljen</button>`;
  $$('#pfZoom button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === pfUi.zoom));
  $('#pfCompact').setAttribute('aria-pressed', pfUi.compact);
  $('#pfRefresh').disabled = !mcp || pfBusy; $('#pfNew').disabled = !mcp; $('#pfAdd').disabled = !mcp;

  const px = PF_PX[pfUi.zoom]; const R = pfRange(ps); const W = (daysBetween(R.start, R.end) + 1) * px; const X = s => daysBetween(R.start, s) * px;
  let scale = '', over = '';
  for (let s = R.start; s <= R.end; s = addDays(s, 1)) {
    const d = toD(s);
    if (d.getUTCDate() === 1) {
      const m = d.getUTCMonth();
      const lbl = pfUi.zoom === 'year' ? (m === 0 ? String(d.getUTCFullYear()) : m % 3 === 0 ? MON[m] : '') : pfUi.zoom === 'quarter' ? (m % 3 === 0 ? MON[m] + (m === 0 ? ' ' + d.getUTCFullYear() : '') : '') : MON[m] + ' ' + String(d.getUTCFullYear()).slice(2);
      if (lbl) scale += `<div class="m" style="left:${X(s)}px">${esc(lbl)}</div>`;
      over += `<div class="vl ${m === 0 ? 'year' : 'month'}" style="left:${X(s)}px"></div>`;
    }
  }
  const today = toS(new Date()); if (today >= R.start && today <= R.end) over += `<div class="today" style="left:${X(today)}px" title="Idag"></div>`;
  const C = collisions(ps.filter(p => p.plan));
  // markera krockar i tidslinjen
  C.phases.forEach(c => { over += `<div class="pf-clash ${c.level}" style="left:${X(c.s)}px;width:${Math.max(X(addDays(c.e, 1)) - X(c.s), 2)}px" title="${esc(c.a.p.short)}: ${esc(c.a.t.name)} samtidigt som ${esc(c.b.p.short)}: ${esc(c.b.t.name)}"></div>`; });

  let html = '';
  ps.forEach((p, pi) => {
    const color = p.color; const open = !pfUi.compact;
    const sum = summarize(p);
    let first = Infinity, last = '';
    sum.forEach(o => o.spans.forEach(s => { if (s[0] < first) first = s[0]; if (s[1] > last) last = s[1]; }));
    const meta = p.plan ? `${p.live ? (dirty ? 'öppet · osparat' : 'öppet') : 'hämtat ' + esc(p.at || '')}` : (p.err ? '' : p.id ? (pfBusy ? 'hämtar…' : 'ej hämtat') : 'saknar plan');
    const btn = p.live ? '' : p.id ? `<button class="addrow" type="button" data-pf="open" data-id="${esc(p.id)}" title="Öppna planen för redigering">öppna</button>` : `<button class="addrow" type="button" data-pf="link" data-row="${p.row || ''}" title="Koppla ett planark till projektet">koppla ark</button>`;
    html += `<div class="row group pf-proj" data-pi="${pi}"><div class="name"><i style="background:${color}"></i><span class="gl">${esc(p.short || p.name)}</span> <span class="rs">${meta}</span>${btn}</div><div class="lane" style="width:${W}px">${p.plan && first !== Infinity ? `<div class="bar sum" style="--c:${color};left:${X(first)}px;width:${Math.max(X(addDays(last, 1)) - X(first), 3)}px" title="${esc(p.name)}: ${fmt(first)} – ${fmt(last)}"></div>` : ''}</div></div>`;
    if (p.err) { html += `<div class="row"><div class="name"><span class="sub pf-err">${esc(p.err)}</span></div><div class="lane" style="width:${W}px"></div></div>`; return; }
    if (!p.plan) {
      if (linkRow === p.row) html += `<div class="row pf-linkrow"><div class="name"><input id="pfLinkIn" placeholder="Klistra in länk till planarket" aria-label="Länk till planark för ${esc(p.name)}"><button class="btn small" type="button" data-pf="linksave" data-row="${p.row}">Spara</button></div><div class="lane" style="width:${W}px"></div></div>`;
      return;
    }
    const rows = open ? sum : [{ label: 'Alla faser', key: 'all', spans: [], ms: [], all: sum }];
    rows.forEach(o => {
      let lane = '';
      const parts = o.all ? o.all.map(x => [x, x.key]) : [[o, o.key]];
      parts.forEach(([x, key]) => {
        x.spans.forEach(s => { const l = X(s[0]), w = Math.max(X(addDays(s[1], 1)) - l, 3); lane += `<div class="bar pf-b" data-pf="open" data-id="${esc(p.id || '')}" style="--c:var(--d-${key});left:${l}px;width:${w}px" title="${esc(p.short)} · ${esc(x.label)}: ${fmt(s[0])} – ${fmt(s[1])}"><span class="bt">${w > x.label.length * 6.4 + 12 ? esc(x.label) : ''}</span></div>`; });
        if (open) x.ms.forEach(m => { lane += `<div class="ms" style="--c:var(--d-${key});left:${X(m.d) + px / 2}px;top:${ROW_H / 2}px" title="${esc(m.name)} ${fmt(m.d)}"></div>`; });
      });
      html += `<div class="row"><div class="name"><span class="nm">${esc(o.label)}</span></div><div class="lane" style="width:${W}px">${lane}</div></div>`;
    });
  });
  // en persons uppdrag över alla projekt
  const LM = loadMap(ps.filter(p => p.plan));
  const pSel = $('#pfPerson'); if (pSel) { const opts = new Map(); (people || []).filter(x => x.on).forEach(x => opts.set('p:' + x.id, x.name)); Object.values(LM).forEach(o => opts.set(o.key, o.name));
    pSel.innerHTML = '<option value="">Alla</option>' + [...opts].sort((a, b) => a[1].localeCompare(b[1], 'sv')).map(([k, n]) => `<option value="${esc(k)}" ${pfUi.person === k ? 'selected' : ''}>${esc(n)}</option>`).join(''); }
  if (pfUi.person) {
    const L = LM[pfUi.person]; const pid = pfUi.person.startsWith('p:') ? pfUi.person.slice(2) : null;
    const owned = pid ? ps.filter(p => p.plan).flatMap(p => p.plan.tasks.filter(t => t.owner === pid && p.result.dates[t.id]).map(t => ({ p, t, r: p.result.dates[t.id] }))) : [];
    const nm = L ? L.name : pid ? personName(pid) : pfUi.person.slice(2);
    html += `<div class="row group"><div class="name"><span class="gl">${esc(nm)}</span> <span class="rs">${L ? L.items.length : 0} uppdrag · ansvarig för ${owned.length}</span></div><div class="lane" style="width:${W}px"></div></div>`;
    const byProj = new Map(); (L ? L.items : []).forEach(it => { (byProj.get(it.p) || byProj.set(it.p, []).get(it.p)).push(it); }); owned.forEach(it => { (byProj.get(it.p) || byProj.set(it.p, []).get(it.p)).push(Object.assign({ own: true }, it)); });
    byProj.forEach((list, p) => {
      let lane = '';
      list.forEach(it => { if (!it.r) return; const l = X(it.r.start), w = Math.max(X(addDays(it.r.end, 1)) - l, 3); const txt = `${label(it.t)}${it.own ? ' (ansvarig)' : it.pct !== 100 ? ' ' + it.pct + ' %' : ''}`;
        lane += isMsT(it.t) ? `<div class="ms" style="--c:${p.color};left:${X(it.r.start) + px / 2}px;top:${ROW_H / 2}px" title="${esc(txt)} ${fmt(it.r.start)}"></div>` : `<div class="bar pf-b${it.own ? ' light' : ''}" data-pf="open" data-id="${esc(p.id || '')}" style="--c:${p.color};left:${l}px;width:${w}px" title="${esc(p.short)} · ${esc(txt)}: ${fmt(it.r.start)} – ${fmt(it.r.end)}"><span class="bt">${w > txt.length * 6.4 ? esc(txt) : ''}</span></div>`; });
      html += `<div class="row"><div class="name"><i style="background:${p.color}"></i><span class="nm">${esc(p.short)}</span></div><div class="lane" style="width:${W}px">${lane}</div></div>`;
    });
    if (L) { let lane = ''; const wk = {}; Object.entries(L.days).forEach(([d, o]) => { const m = mondayOf(d); wk[m] = Math.max(wk[m] || 0, o.pct); });
      Object.entries(wk).forEach(([m, v]) => { lane += `<div class="pf-cell${v > 100 ? ' over' : ''}" style="left:${X(m)}px;width:${Math.max(px * 7 - 1, 2)}px;--a:${Math.min(.15 + v / 200 * .7, .9)}" title="v${isoWeek(m)}: ${v} %">${px * 7 >= 22 ? v : ''}</div>`; });
      html += `<div class="row pf-dem"><div class="name"><span class="nm">Beläggning</span><span class="sub">% per vecka, högsta dag</span></div><div class="lane" style="width:${W}px">${lane}</div></div>`; }
  }
  // bemanning per roll
  const D = demand(ps.filter(p => p.plan), R);
  if (D.length) {
    html += `<div class="row group"><div class="name"><span class="gl">Bemanning</span> <span class="rs">personer/vecka</span></div><div class="lane" style="width:${W}px"></div></div>`;
    D.forEach(o => {
      let lane = '';
      for (const w in o.weeks) {
        const c = o.weeks[w]; const tip = Object.entries(c.per).map(([k, n]) => `${k}: ${n}`).join(', ');
        const multi = Object.keys(c.per).length > 1;
        lane += `<div class="pf-cell${multi ? ' multi' : ''}" style="left:${X(w)}px;width:${Math.max(px * 7 - 1, 2)}px;--a:${Math.min(.18 + c.n / Math.max(o.max, 1) * .7, .9)}" title="${esc(o.role)} v${isoWeek(w)}: ${c.n} (${esc(tip)})">${px * 7 >= 14 ? c.n : ''}</div>`;
      }
      html += `<div class="row pf-dem"><div class="name"><span class="nm">${esc(o.role)}</span><span class="sub">max ${o.max}</span></div><div class="lane" style="width:${W}px">${lane}</div></div>`;
    });
  }
  const sc = $('#pfscroll'); const keepL = sc.scrollLeft, keepT = sc.scrollTop;
  $('#pfgrid').style.width = `calc(var(--name-w) + ${W}px)`;
  $('#pfgrid').innerHTML = `<div class="hdr"><div class="corner">Projekt</div><div class="scale" style="width:${W}px">${scale}</div></div><div class="lanes"><div class="overlay" style="left:var(--name-w);width:${W}px">${over}</div><div class="rowsbox">${html}</div></div>`;
  if (!renderPortfolio._scrolled && ps.some(p => p.plan) && !$('#pf').hidden) { renderPortfolio._scrolled = true; sc.scrollLeft = Math.max(0, X(today) - 60); } else { sc.scrollLeft = keepL; sc.scrollTop = keepT; }

  // krockar
  const items = [];
  C.phases.forEach(c => items.push(`<div class="alert${c.level === 'hard' ? ' pf-hard' : ''}"><b>${c.level === 'hard' ? 'Två inspelningar samtidigt' : 'Inspelning under en annan produktions hard prepp'}</b> · ${esc(c.a.p.short)} ${esc(c.a.t.name)} och ${esc(c.b.p.short)} ${esc(c.b.t.name)} överlappar ${fmtShort(c.s)} – ${fmt(c.e)} (${c.n} vardagar).</div>`));
  const OLall = overloads(ps.filter(p => p.plan)); const ackSet = new Set((acks || []).map(a => a.key));
  const OL = OLall.filter(o => warnsFor(o.key) && !ackSet.has(olKey(o))); const OLign = OLall.filter(o => !OL.includes(o));
  const byPerson = {}; OL.forEach(o => { (byPerson[o.key] = byPerson[o.key] || []).push(o); });
  const olTxt = o => `<b>${esc(o.name)}</b> är belagd ${o.max} % ${fmtShort(o.s)} – ${fmt(o.e)}: ${[...o.items.values()].slice(0, 5).map(x => `${esc(x.p.short)} ${esc(label(x.t))} (${x.pct} %)`).join(', ')}${o.items.size > 5 ? ` och ${o.items.size - 5} till` : ''}.`;
  OL.forEach(o => items.push(`<div class="alert">${olTxt(o)} <span class="olact"><button class="linkbtn" type="button" data-pf="olIgnore" data-k="${esc(olKey(o))}">Ignorera</button>${o.key.startsWith('p:') ? ` · <button class="linkbtn" type="button" data-pf="olNever" data-p="${esc(o.key.slice(2))}">Varna aldrig för ${esc(o.name.split(' ')[0])}</button>` : ''}</span></div>`));
  const mute = (people || []).filter(x => x.warn === false);
  if (OLign.length || mute.length) {
    items.push(`<div class="pf-ok"><button class="linkbtn" type="button" data-pf="olShow">${pfUi.showIgn ? 'Dölj' : 'Visa'} ignorerade (${OLign.length})</button>${mute.length ? ` · Varnar inte för ${mute.map(x => `${esc(x.name)} <button class="linkbtn" type="button" data-pf="olWarn" data-p="${esc(x.id)}">varna igen</button>`).join(', ')}` : ''}</div>`);
    if (pfUi.showIgn) OLign.forEach(o => items.push(`<div class="alert info">${olTxt(o)} <span class="olact">${ackSet.has(olKey(o)) ? `<button class="linkbtn" type="button" data-pf="olUndo" data-k="${esc(olKey(o))}">Varna igen</button>` : 'Personen varnas inte'}</span></div>`));
  }
  [].forEach(([name, list]) => items.push(`<div class="alert"><b>${esc(name)}</b> är bokad i två projekt samtidigt: ${list.slice(0, 4).map(c => `${esc(c.a.proj.short)} ${esc(c.a.label)} och ${esc(c.b.proj.short)} ${esc(c.b.label)}, ${fmtShort(c.s)} – ${fmtShort(c.e)} (${c.n} vardagar)`).join('; ')}${list.length > 4 ? ` och ${list.length - 4} till` : ''}.</div>`));
  const named = ps.filter(p => p.plan).flatMap(bookings).filter(b => b.named).length;
  const nProj = ps.filter(p => p.plan).length;
  if (!items.length) items.push(`<div class="pf-ok">${nProj < 2 ? 'Krockar syns när minst två projekt har en plan. Koppla fler planark i listan ovan.' : 'Inga krockar mellan projekten.'}${named ? '' : ' Inga personer har riktiga namn ännu, så bara inspelningskrockar kan hittas. Skriv för- och efternamn under Resurser.'}</div>`);
  $('#pfClash').innerHTML = `<h2 class="pf-h">Krockar <span class="rs">${C.phases.length + Object.keys(byPerson).length}</span></h2>` + items.join('');
}
let linkRow = null;
function renderProjSel() {
  const s = $('#projSel'); if (!s) return;
  const list = (registry || []).filter(p => p.id);
  if (!list.some(p => p.id === cur.id)) list.unshift({ name: plan.meta.title, id: cur.id });
  s.innerHTML = list.map(p => `<option value="${esc(p.id)}"${p.id === cur.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  s.hidden = list.length < 2;
}
function setView(v) {
  view = v; store('view', v);
  $('#planview').hidden = v !== 'plan'; $('#pf').hidden = v !== 'pf';
  $$('#viewSel button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  if (v === 'pf') { renderPortfolio(); if (mcp && !registry && !pfBusy) refreshPortfolio(false); }
  else render();
}
async function switchProject(id) {
  if (id === cur.id) return;
  const p = (registry || []).find(x => x.id === id);
  if (dirty && !switchProject._armed) { switchProject._armed = id; toast('Planen har osparade ändringar. Välj projektet igen för att byta ändå, eller spara först.', 6000); renderProjSel(); setTimeout(() => { switchProject._armed = null; }, 6000); return; }
  switchProject._armed = null;
  const prev = cur; cur = { id, name: p ? p.name : 'Projekt' }; store('proj', cur);
  const ok = await loadFromSheet(true, true);
  if (!ok) { cur = prev; store('proj', cur); }
  renderProjSel(); if (ok) setView('plan');
}
async function saveLink(row) {
  const v = sheetIdOf(($('#pfLinkIn') || {}).value); if (!v || v.length < 20) { toast('Det ser inte ut som en länk till ett Google Sheet.'); return; }
  try { await mcp.callTool(SERVER, 'update_values', { spreadsheetId: REG_ID, range: `Projekt!C${row}`, values: [[v]] }, { cache: false }); linkRow = null; toast('Arket kopplat. Hämtar…'); await refreshPortfolio(false); }
  catch (e) { toast(mcpError(e, 'spara länken')); }
}

// ---- Ny produktion ----
function renderNewProjPanel() {
  const p = $('#panel'); p.hidden = false; p.classList.remove('wide');
  const keep = id => { const el = $('#' + id); return el ? el.value : ''; };
  const v = { name: keep('npName'), short: keep('npShort'), start: keep('npStart') || addDays(toS(new Date()), 30), color: keep('npColor') || '#2F6FB0', base: keep('npBase') || 'copy' };
  p.innerHTML = `<header><div><div class="meta">Portfölj</div><h2>Ny produktion</h2></div><button class="btn small" type="button" data-act="close">Stäng</button></header>
    <p class="foot">Skapar ett nytt planark i din Drive i samma format som ${esc(plan.meta.title)} och lägger in det i portföljen.</p>
    <div class="field"><label for="npName">Namn</label><input id="npName" value="${esc(v.name)}" placeholder="t.ex. Projekt säsong 3"></div>
    <div class="field"><label for="npShort">Kortnamn</label><input id="npShort" value="${esc(v.short)}" placeholder="t.ex. PROJ S3"></div>
    <div class="field"><label for="npBase">Upplägg</label><select id="npBase"><option value="copy"${v.base === 'copy' ? ' selected' : ''}>Kopiera ${esc(plan.meta.title)} och flytta till nytt startdatum</option><option value="empty"${v.base === 'empty' ? ' selected' : ''}>Tom plan</option></select><span class="hint">Kopian behåller rader, resurser och regler. Fasta datum flyttas lika långt som startdatumet. Personer blir platshållare igen.</span></div>
    <div class="field"><label for="npStart">Planstart</label><input id="npStart" type="date" value="${esc(v.start)}"></div>
    <div class="field"><label for="npColor">Färg i portföljen</label><input id="npColor" type="color" value="${esc(v.color)}"></div>
    <button class="btn primary" type="button" data-pf="create">Skapa planark</button>`;
}
function shiftedCopy(src, start, title) {
  const p = clone(src); const delta = daysBetween(src.settings.projectStart, start);
  const sh = s => s ? addDays(s, delta) : s;
  p.tasks.forEach(t => { if (t.start) t.start = sh(t.start); if (t.end) t.end = sh(t.end); if (t.notBefore) t.notBefore = sh(t.notBefore); });
  p.resources.forEach(g => { g.blocks = []; g.members.forEach(m => { m.blocks = []; m.name = isPlaceholder(m.name, g.name) ? m.name : g.name + ' ' + (g.members.indexOf(m) + 1); }); });
  p.settings.projectStart = start; p.meta = { title, company: src.meta.company || '', updated: toS(new Date()) };
  return p;
}
function emptyPlan(start, title) {
  return normalize({ meta: { title, company: plan.meta.company || '', updated: toS(new Date()) }, settings: { projectStart: start, holidays: true, breaks: clone(plan.settings.breaks || []) }, resources: [],
    rows: [{ id: 'r_utv', section: 'Utveckling', name: 'Utveckling' }], tasks: [{ id: 'start', name: 'Projektstart', group: 'Utveckling', type: 'fixed', ms: true, start, end: start, row: 'r_utv' }] });
}
async function createProject() {
  const name = ($('#npName').value || '').trim(); const short = ($('#npShort').value || '').trim() || name;
  const start = $('#npStart').value; const color = $('#npColor').value; const base = $('#npBase').value;
  if (!name) { toast('Ge produktionen ett namn.'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { toast('Välj ett startdatum.'); return; }
  const btn = $('[data-pf=create]'); btn.disabled = true; btn.textContent = 'Skapar…';
  try {
    const np = base === 'copy' ? shiftedCopy(plan, start, name) : emptyPlan(start, name);
    const sc = schedule(np); const rows = planToRows(np, sc); const mrows = templatesToRows(templates);
    const r = await kcApi('planCreate', { name, tabs: { 'Faser': rows.faser, 'Resurser': rows.res, 'Inställningar': rows.set, 'Rader': rows.rader, 'Kalender': rows.kal, 'Mallar': mrows, 'Mottagare': rows.mot },
      reg: { 'Projekt': name, 'Kortnamn': short, 'Färg': color, 'Status': 'Utveckling', 'I portföljen': 'ja', 'Anteckning': 'Skapad från KC ' + toS(new Date()) } }, true);
    pfData[r.id] = { plan: normalize(np), result: sc, at: nowStamp() };
    dropSnap(REG_ID); await loadRegistry(); renderProjSel(); closePanel(); renderPortfolio();
    toast(`${name} är skapad${r.registered ? ' och ligger i portföljen' : ''}. Länka arket i projektets rad i KC (Produktionsplan) för att öppna det som projektflik.`, 8000);
  } catch (e) { toast(mcpError(e, 'skapa planarket'), 8000); btn.disabled = false; btn.textContent = 'Skapa planark'; }
}
function wirePortfolio() {
  $('#viewSel').addEventListener('click', e => { const v = e.target.dataset.v; if (v) setView(v); });
  $('#projSel').addEventListener('change', e => switchProject(e.target.value));
  $('#pfZoom').addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; pfUi.zoom = v; store('pf', pfUi); renderPortfolio(); });
  $('#pfPerson').addEventListener('change', e => { pfUi.person = e.target.value; store('pf', pfUi); renderPortfolio(); });
  $('#pfCompact').addEventListener('click', () => { pfUi.compact = !pfUi.compact; store('pf', pfUi); renderPortfolio(); });
  $('#pfRefresh').addEventListener('click', () => refreshPortfolio(true));
  $('#pfNew').addEventListener('click', () => { panelMode === 'newproj' ? closePanel() : openPanel('newproj'); });
  $('#pfAdd').addEventListener('click', () => window.open(REG_URL, '_blank', 'noopener'));
  $('#pf').addEventListener('click', e => {
    const b = e.target.closest('[data-pf]'); if (!b) return; const a = b.dataset.pf;
    if (a === 'refresh') refreshPortfolio(true);
    if (a === 'open' && b.dataset.id) { const tg = tagBySheet[b.dataset.id]; if (tg && window.parent !== window) { parent.location.hash = '#/plan/' + encodeURIComponent(tg); return; } if (b.dataset.id === cur.id) setView('plan'); else switchProject(b.dataset.id); }
    if (a === 'link') { linkRow = +b.dataset.row || null; renderPortfolio(); const i = $('#pfLinkIn'); if (i) i.focus(); }
    if (a === 'linksave') saveLink(+b.dataset.row);
    const olDo = (fn, msg) => { if (!mcp) return; b.disabled = true; fn().then(() => { toast(msg); renderPortfolio(); }).catch(err => { toast(mcpError(err, 'spara i portföljarket'), 7000); b.disabled = false; }); };
    if (a === 'olIgnore') olDo(() => ackOverload(b.dataset.k), 'Krocken är ignorerad. Den kommer tillbaka om momenten i den ändras.');
    if (a === 'olUndo') olDo(() => unackOverload(b.dataset.k), 'Krocken varnas igen.');
    if (a === 'olNever') olDo(() => setPersonWarn(b.dataset.p, false), `Inga krockvarningar för ${personName(b.dataset.p)}. Personvyn visar fortfarande beläggningen.`);
    if (a === 'olWarn') olDo(() => setPersonWarn(b.dataset.p, true), `Krockvarningar för ${personName(b.dataset.p)} är på igen.`);
    if (a === 'olShow') { pfUi.showIgn = !pfUi.showIgn; store('pf', pfUi); renderPortfolio(); }
  });
  $('#panel').addEventListener('click', e => { const b = e.target.closest('[data-pf=create]'); if (b && panelMode === 'newproj') createProject(); });
}

// ---- Varianter: spara planen som alternativ och jämför nyckeldatum ----
const VAR_HEAD = ['Variant', 'Sparad', 'Anteckning', 'Plan (JSON)', 'Typ'];
let variants = [];
function builtinVariants() {
  return [];
}
function variantsToRows() { return [VAR_HEAD].concat(variants.map(v => [v.name, v.saved || '', v.note || '', JSON.stringify(v.plan), v.kind || 'scenario'])); }
function rowsToVariants(rows) {
  if (!rows || rows.length < 2) return [];
  return rows.slice(1).map(r => { try { const plan = normalize(JSON.parse(r[3])); return plan && plan.tasks ? { name: String(r[0] || 'Variant'), saved: String(r[1] || ''), note: String(r[2] || ''), plan, kind: /version/i.test(String(r[4] || '')) ? 'version' : 'scenario' } : null; } catch (e) { return null; } }).filter(Boolean);
}
function keyDates(p, res) {
  const out = {};
  p.tasks.forEach(t => { if (isMsT(t) && res.dates[t.id]) out[t.id] = { label: label(t), d: res.dates[t.id].start, group: t.group }; });
  const lev = p.tasks.filter(t => t.group === 'Leverans' && res.dates[t.id]).map(t => res.dates[t.id].end).sort();
  if (lev.length) out.__last = { label: 'Sista leverans', d: lev[lev.length - 1], group: 'Leverans' };
  return out;
}
function renderVarPanel() {
  const p = $('#panel'); p.classList.add('wide');
  const cols = [{ name: 'Nuvarande plan', kd: keyDates(plan, result) }].concat(variants.map(v => ({ name: v.name, note: v.note, kd: keyDates(v.plan, planSchedule(v.plan)) })));
  const ids = []; cols.forEach(c => Object.keys(c.kd).forEach(id => { if (!ids.includes(id)) ids.push(id); }));
  const order = id => { const k = cols.map(c => c.kd[id]).find(Boolean); return (k && k.d) || ''; };
  ids.sort((a, b) => a === '__last' ? 1 : b === '__last' ? -1 : order(a) < order(b) ? -1 : 1);
  const head = `<tr><th>Nyckeldatum</th>${cols.map((c, i) => `<th>${esc(c.name)}${i ? `<div class="vkind">${variants[i - 1].kind === 'version' ? 'version' : 'scenario'}${variants[i - 1].saved ? ' · ' + esc(fmtShort(variants[i - 1].saved)) : ''}</div><div class="vact"><button class="linkbtn" type="button" data-act="vuse" data-i="${i - 1}">Använd</button> · <button class="linkbtn" type="button" data-act="vdel" data-i="${i - 1}">Ta bort</button></div>` : ''}</th>`).join('')}</tr>`;
  const body = ids.map(id => {
    const base = cols[0].kd[id];
    const lbl = (cols.map(c => c.kd[id]).find(Boolean) || {}).label || id;
    return `<tr${id === '__last' ? ' class="vlast"' : ''}><td>${esc(lbl)}</td>${cols.map((c, i) => { const k = c.kd[id]; if (!k) return '<td class="vna">–</td>'; let dl = ''; if (i && base) { const dd = daysBetween(base.d, k.d); if (dd) dl = ` <span class="delta ${dd > 0 ? 'later' : 'earlier'}">${dd > 0 ? '+' : '−'}${Math.abs(dd)} d</span>`; } return `<td class="mono">${fmtShort(k.d)} ${String(toD(k.d).getUTCFullYear()).slice(2)}${dl}</td>`; }).join('')}</tr>`;
  }).join('');
  p.innerHTML = `
    <header><div><div class="meta">Jämför</div><h2>Versioner och scenarier</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <div class="field"><label for="vCmp">Visa förskjutning i planen mot</label><select id="vCmp"><option value="">Senast sparat</option>${variants.map(v => `<option value="${esc(v.name)}" ${ui.cmp === v.name ? 'selected' : ''}>${v.kind === 'version' ? 'Version' : 'Scenario'}: ${esc(v.name)}${v.saved ? ' (' + esc(fmtShort(v.saved)) + ')' : ''}</option>`).join('')}</select><span class="hint">Avvikelser syns som en tunn stapel under varje fas och som dagar i nyckeldatumen.</span></div>
    <p class="foot"><b>Version</b> = en bild av planen som den var, t.ex. när kanalen godkände den. <b>Scenario</b> = ett tänk om-alternativ att jämföra med. Spara planen som den ser ut nu som en variant, ändra något och jämför. Pilarna visar hur mycket varje variant skiljer sig från den nuvarande planen. Använd gör en variant till nuvarande plan, och det går att ångra. Varianterna sparas i fliken Varianter när du sparar till Sheet.</p>
    ${variants.length ? `<div class="vwrap"><table class="vtab">${head}${body}</table></div>` : '<p class="foot">Inga varianter än.</p>'}
    <div class="field"><label for="vName">Spara nuvarande plan</label><div class="inline"><input id="vName" placeholder="t.ex. Godkänd av kanalen, eller Tre mixare"><button class="btn small primary" type="button" data-act="vsave" data-kind="version">Som version</button><button class="btn small" type="button" data-act="vsave" data-kind="scenario">Som scenario</button></div>
      <input id="vNote" placeholder="Anteckning, valfri" aria-label="Anteckning till varianten"></div>`;
  p.hidden = false;
}
function onVarAction(act, b) {
  const i = +b.dataset.i;
  if (act === 'vsave') {
    const name = ($('#vName').value || '').trim() || 'Variant ' + (variants.length + 1);
    const kind = b.dataset.kind === 'version' ? 'version' : 'scenario';
    if (variants.some(v => v.name === name)) { toast(`Det finns redan en med namnet “${name}”.`); return; }
    variants.push({ name, saved: toS(new Date()), note: ($('#vNote').value || '').trim(), plan: clone(plan), kind }); dirty = true;
    if (kind === 'version') ui.cmp = name;
    renderVarPanel(); renderSource(); render(); toast(kind === 'version' ? `Sparade versionen “${name}”. Planen jämförs nu mot den.` : `Sparade scenariot “${name}”. Ändra planen och jämför här.`, 5000);
  }
  if (act === 'vuse') {
    const v = variants[i]; if (!v) return;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Klicka igen'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Använd'; } }, 4000); return; }
    const before = milestoneSnapshot();
    change(() => { plan = normalize(clone(v.plan)); });
    toast(`Planen följer nu “${v.name}”.${impact(before)} Ångra med ${mod}Z.`, 6000); renderVarPanel();
  }
  if (act === 'vdel') {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Klicka igen'; return; }
    if (variants[i] && ui.cmp === variants[i].name) ui.cmp = ''; variants.splice(i, 1); dirty = true; renderVarPanel(); renderSource(); render();
  }
}

// ---- Status, kommentarer, filter, export (PDF, kalender) ----
const STATUS = {
  klar: { l: 'Klar', g: '✓' }, pagar: { l: 'Pågår', g: '▸' }, risk: { l: 'Risk', g: '!' },
  beslut: { l: 'Väntar på beslut', g: '?' }, bokad: { l: 'Bokad', g: 'B' },
};
const statusBadge = (t, w) => t.status && STATUS[t.status] && w >= 16 ? `<span class="st st-${t.status}" title="${esc(STATUS[t.status].l)}">${STATUS[t.status].g}</span>` : '';
const noteMark = t => t.note ? `<span class="cm" title="${esc(t.note)}"></span>` : '';
function statusOptions(cur, mixed) { return (mixed ? '<option value="*">Blandat</option>' : '') + `<option value="">Ingen status</option>` + Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${s.g} ${esc(s.l)}</option>`).join(''); }
function setStatus(ids, st) { change(() => ids.forEach(id => { const t = taskById(id); if (!t) return; if (st) t.status = st; else delete t.status; })); }

// Filter
ui.f = Object.assign({ q: '', when: '', status: '', hide: false }, ui.f || {});
const filterOn = () => !!(ui.f.q || ui.f.when || ui.f.status);
function matchF(t) {
  if (!filterOn()) return true;
  const r = result.dates[t.id]; if (!r) return false;
  if (ui.f.status && (ui.f.status === 'any' ? !t.status : t.status !== ui.f.status)) return false;
  if (ui.f.when) {
    const today = toS(new Date());
    const span = { now: [today, today], d30: [today, addDays(today, 30)], d90: [today, addDays(today, 90)], past: ['0000', addDays(today, -1)] }[ui.f.when];
    if (span && (r.end < span[0] || r.start > span[1])) return false;
  }
  if (ui.f.q) {
    const row = rowById(t.row);
    const hay = [label(t), t.group, t.note, row && row.name, (r.members || []).map(memberName).join(' '), (t.doers || []).map(d => personName(d.id)).join(' '), t.owner ? personName(t.owner) : '', t.status && STATUS[t.status] && STATUS[t.status].l].join(' ').toLowerCase();
    if (!ui.f.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
  }
  return true;
}
function renderFilterInfo() {
  const el = $('#fInfo'); if (!el) return;
  if (!filterOn()) { el.textContent = ''; $('#fClear').hidden = true; return; }
  const n = plan.tasks.filter(matchF).length;
  el.textContent = `${n} av ${plan.tasks.length} faser`; $('#fClear').hidden = false;
}
function scrollToToday() {
  if (!geo) return; const today = toS(new Date());
  if (today < geo.R.start || today > geo.R.end) { toast('Idag ligger utanför planens tidslinje.'); return; }
  $('#scroller').scrollLeft = Math.max(0, geo.X(today) - 80);
}
function wireExtras() {
  const q = $('#fq'); let tmr = null;
  q.value = ui.f.q; $('#fwhen').value = ui.f.when; $('#fstatus').value = ui.f.status; $('#fhide').checked = !!ui.f.hide;
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { ui.f.q = q.value.trim(); store('ui4', ui); renderGantt(); renderFilterInfo(); }, 160); });
  $('#fwhen').addEventListener('change', e => { ui.f.when = e.target.value; store('ui4', ui); renderGantt(); renderFilterInfo(); });
  $('#fstatus').addEventListener('change', e => { ui.f.status = e.target.value; store('ui4', ui); renderGantt(); renderFilterInfo(); });
  $('#fhide').addEventListener('change', e => { ui.f.hide = e.target.checked; store('ui4', ui); renderGantt(); });
  $('#fClear').addEventListener('click', () => { ui.f = { q: '', when: '', status: '', hide: ui.f.hide }; q.value = ''; $('#fwhen').value = ''; $('#fstatus').value = ''; store('ui4', ui); renderGantt(); renderFilterInfo(); });
  $('#btnToday').addEventListener('click', scrollToToday);
  $('#btnExport').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, [
      { k: 'xpdf', label: 'PDF att skicka (A4, liggande)…' },
      { k: 'xcal', label: 'Milstolpar till Google Kalender…', disabled: !mcp },
      { k: 'xcsv', label: 'CSV för Excel', disabled: !downloads },
    ]);
  });
}

// ---- PDF ----
const PRINT_DEPT = { 'Utveckling': '#4F6185', 'Förproduktion': '#A86F12', 'Inspelning': '#B3191F', 'Klipp': '#18736C', 'Ljud': '#5D47A0', 'Musik': '#9A4766', 'Bild': '#2F7346', 'Leverans': '#30353C' };
const PRINT_X = { red: '#B3191F', orange: '#C2581A', yellow: '#A88207', green: '#2F7346', teal: '#18736C', blue: '#2D5FA8', purple: '#5D47A0', pink: '#A23E78', grey: '#5F666E' };
function loadScript(src) { return new Promise((res, rej) => { if (loadScript[src]) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => { loadScript[src] = 1; res(); }; s.onerror = () => rej(new Error('kunde inte ladda ' + src)); document.head.appendChild(s); }); }
const hex = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const pdfTxt = s => String(s == null ? '' : s).replace(/[▸✓]/g, '').replace(/[^\x20-\xFF–—’‘“”…•]/g, '');
function exportPdf() { openPanel('pdfexp'); }
async function buildPdf() {
  toast('Bygger PDF…', 8000);
  if (!window.jspdf) { try { await loadScript(new URL('./jspdf.umd.min.js', import.meta.url).href); } catch (e) { toast('Det gick inte att ladda PDF-verktyget.'); return; } }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const PW = 420, PH = 297, M = 12, NAME = 58;
  const secs = layoutSections().map(s => Object.assign({}, s, { rows: s.rows.filter(r => r.tasks.length) })).filter(s => s.rows.length);
  let a = null, b = null; secs.forEach(s => s.rows.forEach(r => r.tasks.forEach(t => { const d = result.dates[t.id]; if (!d) return; if (!a || d.start < a) a = d.start; if (!b || d.end > b) b = d.end; })));
  if (!a) { toast('Inget att skriva ut med nuvarande filter.'); return; }
  const s0 = toD(a); const start = toS(new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth(), 1)));
  const e0 = toD(b); const end = toS(new Date(Date.UTC(e0.getUTCFullYear(), e0.getUTCMonth() + 1, 0)));
  const days = daysBetween(start, end) + 1; const X0 = M + NAME, TW = PW - M - X0;
  const X = s => X0 + daysBetween(start, s) / days * TW;
  // rubrik
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(22, 24, 27);
  doc.text(pdfTxt(plan.meta.title || cur.name), M, M + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(92, 99, 106);
  doc.text(pdfTxt(`${plan.meta.company || ''} · Produktionsplan · utskriven ${fmt(toS(new Date()))}${filterOn() ? ' · filtrerad' : ''}${ui.film !== 'all' ? ' · film ' + ui.film : ''}`), M, M + 11.5);
  // nyckeldatum
  const keys = plan.tasks.filter(t => isMsT(t) && result.dates[t.id]).sort((x, y) => result.dates[x.id].start < result.dates[y.id].start ? -1 : 1);
  const byName = {}; keys.forEach(t => { (byName[t.name] = byName[t.name] || []).push(t); });
  let kx = PW - M; doc.setFontSize(8);
  Object.entries(byName).reverse().slice(0, 5).forEach(([n, list]) => {
    const lines = list.map(t => (t.film ? 'F' + t.film + '  ' : '') + fmt(result.dates[t.id].start));
    doc.setFont('helvetica', 'bold'); const tw = doc.getTextWidth(pdfTxt(n.toUpperCase())); doc.setFont('helvetica', 'normal');
    const w = Math.max(tw, ...lines.map(l => doc.getTextWidth(pdfTxt(l)))) + 7;
    kx -= w; doc.setTextColor(92, 99, 106); doc.setFont('helvetica', 'bold'); doc.text(pdfTxt(n.toUpperCase()), kx, M + 2);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(22, 24, 27); lines.slice(0, 3).forEach((l, i) => doc.text(pdfTxt(l), kx, M + 6 + i * 3.6));
  });
  // tidsaxel
  const top = M + 22; const nRows = secs.reduce((n, s) => n + s.rows.length + 1, 0);
  const avail = PH - top - 18; const RH = Math.max(3.2, Math.min(7, avail / Math.max(nRows, 1)));
  const bottom = top + 8 + nRows * RH;
  doc.setDrawColor(215, 219, 215); doc.setLineWidth(0.15);
  for (let s = start; s <= end; s = addDays(s, 1)) {
    const d = toD(s); const wd = d.getUTCDay();
    const brk = result.cal.brk[s], hol = result.cal.hol[s];
    if ((hol || brk) && wd && wd !== 6) { doc.setFillColor(...(hol ? [250, 222, 220] : [226, 233, 244])); doc.rect(X(s), top + 8, Math.max(TW / days, 0.3), nRows * RH, 'F'); }
    if (d.getUTCDate() === 1) {
      doc.setDrawColor(...(d.getUTCMonth() === 0 ? [140, 146, 152] : [215, 219, 215])); doc.line(X(s), top, X(s), bottom);
      const mw = TW * new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() / days;
      doc.setFontSize(mw > 9 ? 7 : 5.5); doc.setTextColor(22, 24, 27); doc.setFont('helvetica', 'bold');
      if (mw > 5) doc.text(pdfTxt(MON[d.getUTCMonth()] + (mw > 9 ? ' ' + String(d.getUTCFullYear()).slice(2) : '')), X(s) + 0.8, top + 5);
    }
  }
  doc.setDrawColor(140, 146, 152); doc.line(M, top + 8, PW - M, top + 8);
  const today = toS(new Date()); if (today >= start && today <= end) { doc.setDrawColor(179, 25, 31); doc.setLineWidth(0.4); doc.line(X(today), top + 6, X(today), bottom); doc.setLineWidth(0.15); }
  // rader
  let y = top + 8; const fs = Math.max(5.5, Math.min(8.5, RH * 1.55));
  secs.forEach(sec => {
    doc.setFillColor(246, 247, 245); doc.rect(M, y, PW - 2 * M, RH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs); doc.setTextColor(22, 24, 27);
    const sc = hex(printColor(sec.key)); doc.setFillColor(...sc); doc.rect(M + 1, y + RH / 2 - 1.2, 2.4, 2.4, 'F');
    doc.text(pdfTxt(sec.label.toUpperCase()), M + 5, y + RH / 2 + fs * 0.13);
    y += RH;
    sec.rows.forEach(row => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(fs); doc.setTextColor(22, 24, 27);
      let nm = pdfTxt((row.tag ? row.tag + ' ' : '') + row.label); while (nm.length > 3 && doc.getTextWidth(nm) > NAME - 6) nm = nm.slice(0, -2) + '…';
      doc.text(nm, M + 5, y + RH / 2 + fs * 0.13);
      row.tasks.forEach(t => {
        const d = result.dates[t.id]; if (!d) return;
        const col = hex(t.color ? (PRINT_X[t.color] || '#6B7280') : printColor(t.group));
        if (isMsT(t)) {
          const cx = X(addDays(d.start, 1)), cy = y + RH / 2, r = Math.min(1.6, RH * 0.3);
          doc.setFillColor(...col); doc.lines([[r, r], [-r, r], [-r, -r], [r, -r]], cx, cy - r, [1, 1], 'F', true);
          doc.setFontSize(fs * 0.85); doc.setTextColor(92, 99, 106); doc.text(pdfTxt(fmtShort(d.start)), cx + r + 0.8, cy + fs * 0.11); doc.setFontSize(fs);
          return;
        }
        const x1 = X(d.start), x2 = X(addDays(d.end, 1)); const h = RH * 0.62;
        if (t.light) { doc.setDrawColor(...col); doc.setFillColor(...col.map(c => Math.round(c + (255 - c) * 0.75))); doc.rect(x1, y + (RH - h) / 2, Math.max(x2 - x1, 0.4), h, 'FD'); }
        else { doc.setFillColor(...col); doc.rect(x1, y + (RH - h) / 2, Math.max(x2 - x1, 0.4), h, 'F'); }
        const txt = pdfTxt((t.status && STATUS[t.status] ? STATUS[t.status].l + ': ' : '') + label(t));
        doc.setFontSize(fs * 0.85);
        if (doc.getTextWidth(txt) + 2 < x2 - x1) { doc.setTextColor(...(t.light ? [22, 24, 27] : [255, 255, 255])); doc.text(txt, x1 + 1, y + RH / 2 + fs * 0.11); }
        doc.setFontSize(fs);
      });
      doc.setDrawColor(231, 234, 230); doc.line(M, y + RH, PW - M, y + RH);
      y += RH;
    });
  });
  // legend
  let lx = M; const ly = PH - M + 2; doc.setFontSize(7.5);
  GROUP_ORDER.filter(n => plan.tasks.some(t => t.group === n)).map(n => [n, printColor(n)]).forEach(([n, c]) => { doc.setFillColor(...hex(c)); doc.rect(lx, ly - 2.4, 4, 2.6, 'F'); doc.setTextColor(92, 99, 106); doc.text(pdfTxt(n), lx + 5.2, ly); lx += doc.getTextWidth(pdfTxt(n)) + 10; });
  doc.setFillColor(250, 222, 220); doc.rect(lx, ly - 2.4, 4, 2.6, 'F'); doc.text('Röd dag', lx + 5.2, ly); lx += 18;
  doc.setFillColor(226, 233, 244); doc.rect(lx, ly - 2.4, 4, 2.6, 'F'); doc.text('Uppehåll', lx + 5.2, ly); lx += 20;
  doc.setDrawColor(179, 25, 31); doc.setLineWidth(0.4); doc.line(lx + 2, ly - 2.6, lx + 2, ly + 0.4); doc.setLineWidth(0.15); doc.text('Idag', lx + 4, ly);
  const fname = (plan.meta.title || cur.name).replace(/[^\wåäöÅÄÖ -]/g, '').replace(/\s+/g, '_') + '_Produktionsplan_' + toS(new Date()) + '.pdf';
  const openTab = () => { try { const url = URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })); const w = window.open(url, '_blank'); if (w) { toast('PDF:en öppnades i en ny flik. Spara eller skriv ut den därifrån.', 6000); return true; } } catch (x) {} return false; };
  if (!downloads) { if (!openTab()) toast('Den här vyn kan inte spara filer. Öppna KC i webbläsaren och exportera därifrån.', 8000); return; }
  try { await downloads.save({ filename: fname, data: doc.output('arraybuffer') }); toast('PDF:en är sparad i dina hämtade filer.', 5000); }
  catch (e) { if (e && e.code === 'declined') toast('Du avbröt nedladdningen.'); else if (!openTab()) toast('Det gick inte att spara PDF:en här (' + ((e && (e.code || e.message)) || 'okänt fel') + '). Öppna sidan i webbläsaren på claude.ai och försök igen.', 8000); }
}


// ===== PDF v2: liggande A4, mottagaranpassad, faser i veckonivå =====
const PDF_POST = ['Klipp', 'Ljud', 'Musik', 'Bild'];
const PDF_WMAX = 66; // veckor per A4-sida innan det blir för trångt
const pdfGroupOf = s => PDF_POST.includes(s) ? 'Postproduktion' : s;
const pMonday = s => addDays(s, -((toD(s).getUTCDay() + 6) % 7));
const taskSec = t => ((plan.rows || []).find(r => r.id === t.row) || {}).section || t.group || 'Övrigt';
function pdfGroups() {
  const order = []; const seen = new Set();
  sections().concat(plan.tasks.map(taskSec)).forEach(s => { const g = pdfGroupOf(s); if (!seen.has(g) && plan.tasks.some(t => pdfGroupOf(taskSec(t)) === g && result.dates[t.id])) { seen.add(g); order.push(g); } });
  return order;
}
function pdfRange() {
  let a = null, b = null; plan.tasks.forEach(t => { const d = result.dates[t.id]; if (!d) return; if (!a || d.start < a) a = d.start; if (!b || d.end > b) b = d.end; });
  return { a, b };
}
function pdfState() {
  if (!ui.pdf || ui.pdf.plan !== (plan.meta.title || cur.name)) {
    const R = pdfRange();
    ui.pdf = { plan: plan.meta.title || cur.name, to: '', from: R.a, until: R.b, incl: pdfGroups().filter(g => g !== 'Personal'), detail: [], brk: 'auto' };
  }
  return ui.pdf;
}
function pdfWeeks(st) { const out = []; let m = pMonday(st.from); const end = st.until; let g = 0; while (m <= end && g++ < 600) { out.push(m); m = addDays(m, 7); } return out; }
// hur "rörigt" det är att bryta sidan på måndagen m: antal pågående staplar, minus bonus för uppehåll
function pdfCutScore(m) {
  let n = 0; plan.tasks.forEach(t => { if (t.light || isMsT(t)) return; const d = result.dates[t.id]; if (d && d.start < m && d.end >= m) n++; });
  if ((plan.settings.breaks || []).some(b => b.on && b.from <= m && b.to >= addDays(m, -3))) n -= 2;
  return n;
}
function pdfPages(st) {
  const W = pdfWeeks(st); const n = W.length; if (n <= PDF_WMAX) return [[0, n]];
  if (st.brk !== 'auto') { const k = W.indexOf(st.brk); if (k > 0 && k < n) return [[0, k], [k, n]]; }
  const pages = []; let cur0 = 0;
  while (n - cur0 > PDF_WMAX) {
    const left = n - cur0; const pagesLeft = Math.ceil(left / PDF_WMAX);
    const ideal = cur0 + Math.round(left / pagesLeft);
    const lo = Math.max(cur0 + 8, cur0 + left - PDF_WMAX * (pagesLeft - 1)), hi = Math.min(cur0 + PDF_WMAX, n - 8);
    let best = ideal, bs = Infinity;
    for (let k = lo; k <= hi; k++) { const sc = pdfCutScore(W[k]) * 10 + Math.abs(k - ideal); if (sc < bs) { bs = sc; best = k; } }
    pages.push([cur0, best]); cur0 = best;
  }
  pages.push([cur0, n]); return pages;
}
// Rader i PDF:en: sammanfattad fas per sektion, eller detaljerade rader
function mergeIv(list, gap) {
  const s = list.slice().sort((x, y) => x[0] < y[0] ? -1 : 1); const out = [];
  s.forEach(([a, b]) => { const l = out[out.length - 1]; if (l && addDays(l[1], gap) >= a) { if (b > l[1]) l[1] = b; } else out.push([a, b]); });
  return out;
}
function pdfModel(st) {
  const inP = d => d && d.end >= st.from && d.start <= st.until;
  const R = st.to; const forR = t => R && (t.to || []).includes(R);
  const rows = [];
  pdfGroups().filter(g => st.incl.includes(g)).forEach(g => {
    const ts = plan.tasks.filter(t => pdfGroupOf(taskSec(t)) === g && inP(result.dates[t.id]));
    if (!ts.length) return;
    const color = g === 'Postproduktion' ? printColor('Klipp') : printColor(g);
    if (st.detail.includes(g)) {
      rows.push({ kind: 'head', label: g, color });
      const secNames = new Set(ts.map(taskSec));
      (plan.rows || []).filter(r => secNames.has(r.section)).forEach(r => {
        const rt = ts.filter(t => t.row === r.id); if (!rt.length) return;
        rows.push({ kind: 'detail', label: r.name, color, tasks: rt });
      });
    } else {
      const work = ts.filter(t => !isMsT(t) && !t.light);
      const base = work.length ? work : ts.filter(t => !isMsT(t));
      const ivs = mergeIv(base.map(t => [result.dates[t.id].start, result.dates[t.id].end]), 10);
      const ms = ts.filter(t => (isMsT(t) && (R ? forR(t) : (t.locked || (t.to || []).length))) || (t.read && forR(t)));
      rows.push({ kind: 'sum', label: g, color, ivs, ms });
    }
  });
  return rows;
}
function pdfKeyList(st) {
  const R = st.to; const inP = s => s >= st.from && s <= st.until; const out = [];
  plan.tasks.forEach(t => {
    const d = result.dates[t.id]; if (!d) return;
    const mine = R ? (t.to || []).includes(R) : (t.locked || (t.to || []).length);
    if (!mine) return;
    if (t.read) {
      const who = R ? recipName(R) : recipNames(t) || 'Mottagaren';
      if (inP(d.start)) out.push({ d: d.start, what: label(t), note: `${who} får materialet ${t.dlvAt || 'dagens början'}` });
      if (inP(d.end)) out.push({ d: d.end, what: label(t), note: `Feedback senast ${t.fbAt || 'dagens slut'}` });
    } else if (isMsT(t) && inP(d.start)) out.push({ d: d.start, what: label(t), note: t.locked ? 'Fast datum' : '' });
  });
  return out.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : 0);
}
function renderPdfPanel() {
  const p = $('#panel'); p.classList.remove('wide'); const st = pdfState();
  const W = pdfWeeks(st); const pages = pdfPages(st); const groups = pdfGroups();
  const cutTxt = pages.length > 1 ? pages.slice(1).map(pg => `v. ${isoWeek(W[pg[0]])} (${fmtShort(W[pg[0]])} ${toD(W[pg[0]]).getUTCFullYear()})`).join(', ') : '';
  const two = W.length > PDF_WMAX || st.brk !== 'auto';
  p.innerHTML = `
    <header><div><div class="meta">Export</div><h2>PDF – liggande A4</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <div class="field"><label for="pdTo">Mottagare</label><select id="pdTo"><option value="">Ingen särskild – nyckeldatum</option>${(plan.recipients || []).map(x => `<option value="${esc(x.id)}" ${st.to === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <span class="hint">Mottagarens milstolpar och läsperioder lyfts fram och listas sist med datum och klockslag.</span></div>
    <div class="two"><div class="field"><label for="pdFrom">Från</label><input type="date" id="pdFrom" value="${esc(st.from || '')}"></div>
      <div class="field"><label for="pdUntil">Till</label><input type="date" id="pdUntil" value="${esc(st.until || '')}"></div></div>
    <div class="quick"><button class="btn small" type="button" data-act="pdAll">Hela planen</button></div>
    <div class="field"><label>Faser</label>
      <table class="pdt"><thead><tr><th></th><th>Med</th><th>I detalj</th></tr></thead><tbody>
      ${groups.map(g => `<tr><td>${esc(g)}</td><td><input type="checkbox" data-pdi="${esc(g)}" ${st.incl.includes(g) ? 'checked' : ''} aria-label="Ta med ${esc(g)}"></td><td><input type="checkbox" data-pdd="${esc(g)}" ${st.detail.includes(g) ? 'checked' : ''} ${st.incl.includes(g) ? '' : 'disabled'} aria-label="${esc(g)} i detalj"></td></tr>`).join('')}
      </tbody></table>
      <span class="hint">Utan "i detalj" blir fasen en stapel i veckonivå. Med blir varje rad i planen synlig, t.ex. bara manusutvecklingen för kanalen.</span></div>
    ${two ? `<div class="field"><label for="pdBrk">Sidbrytning</label><select id="pdBrk"><option value="auto" ${st.brk === 'auto' ? 'selected' : ''}>Automatisk – där minst pågår</option>${W.slice(8, -8).map(m => `<option value="${m}" ${st.brk === m ? 'selected' : ''}>v. ${isoWeek(m)} · ${fmt(m)}</option>`).join('')}</select>
      <span class="hint">Sidan bryts alltid vid ett veckoskifte.</span></div>` : ''}
    <p class="foot">${W.length} veckor på ${pages.length} ${pages.length === 1 ? 'sida' : 'sidor'}${cutTxt ? `, ny sida från ${cutTxt}` : ''}.</p>
    <button class="btn primary" type="button" data-act="pdfgo">Skapa PDF</button>`;
  p.hidden = false;
  if (!renderPdfPanel.wired) {
    renderPdfPanel.wired = true;
    p.addEventListener('change', e => {
      if (panelMode !== 'pdfexp') return; const s2 = pdfState(); const el = e.target;
      if (el.id === 'pdTo') s2.to = el.value;
      else if (el.id === 'pdFrom' && el.value) { s2.from = el.value; s2.brk = 'auto'; }
      else if (el.id === 'pdUntil' && el.value) { s2.until = el.value; s2.brk = 'auto'; }
      else if (el.id === 'pdBrk') s2.brk = el.value;
      else if (el.dataset.pdi) { const g = el.dataset.pdi; s2.incl = el.checked ? s2.incl.concat(g) : s2.incl.filter(x => x !== g); if (!el.checked) s2.detail = s2.detail.filter(x => x !== g); }
      else if (el.dataset.pdd) { const g = el.dataset.pdd; s2.detail = el.checked ? s2.detail.concat(g) : s2.detail.filter(x => x !== g); }
      else return;
      if (s2.until < s2.from) s2.until = s2.from;
      renderPdfPanel();
    });
  }
}
function onPdfAction(act, b) {
  const st = pdfState();
  if (act === 'pdAll') { const R = pdfRange(); st.from = R.a; st.until = R.b; st.brk = 'auto'; renderPdfPanel(); return; }
  if (act === 'pdfgo') { b.disabled = true; buildPdfA4(st).catch(e => toast('PDF:en kunde inte skapas: ' + ((e && e.message) || e), 8000)).finally(() => { b.disabled = false; }); }
}
async function buildPdfA4(st) {
  toast('Bygger PDF…', 8000);
  if (!window.jspdf) { try { await loadScript(new URL('./jspdf.umd.min.js', import.meta.url).href); } catch (e) { toast('Det gick inte att ladda PDF-verktyget.'); return; } }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = 297, PH = 210, M = 10, NAME = 44, X0 = M + NAME, TW = PW - M - X0;
  const W = pdfWeeks(st); const pages = pdfPages(st); const rows = pdfModel(st); const keys = pdfKeyList(st);
  if (!rows.length) { toast('Inget att skriva ut med de valen.'); return; }
  const maxW = Math.max(...pages.map(([a, b]) => b - a)); const wk = TW / maxW; const dpx = wk / 7;
  const R = st.to; const rName = R ? recipName(R) : '';
  const INK = [22, 24, 27], MUTED = [92, 99, 106], LINE = [221, 224, 220];
  const title = plan.meta.title || cur.name;
  const sub = `${plan.meta.company || ''} · Produktionsplan${rName ? ' för ' + rName : ''} · v. ${isoWeek(W[0])} ${toD(W[0]).getUTCFullYear()} – v. ${isoWeek(W[W.length - 1])} ${toD(W[W.length - 1]).getUTCFullYear()} · ${fmt(toS(new Date()))}`;
  const nUnits = rows.reduce((n, r) => n + (r.kind === 'head' ? 0.8 : 1), 0);
  const top = M + 16, axisH = 9, legendH = 8;
  const RH = Math.max(3.4, Math.min(11, (PH - top - axisH - legendH - M) / Math.max(nUnits, 1)));
  const fs = Math.max(5.5, Math.min(8.5, RH * 1.2));
  let y = 0;
  pages.forEach(([wa, wb], pi) => {
    if (pi) doc.addPage('a4', 'landscape');
    const start = W[wa], endEx = addDays(W[wb - 1], 7);
    const X = s => X0 + Math.max(0, Math.min(daysBetween(start, s), (wb - wa) * 7)) * dpx;
    // rubrik
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(pdfTxt(title), M, M + 5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(pdfTxt(sub), M, M + 10);
    if (pages.length > 1) doc.text(`Sida ${pi + 1} av ${pages.length}`, PW - M, M + 5, { align: 'right' });
    // tidsaxel: månader + veckor
    const ay = top; doc.setDrawColor(...LINE); doc.setLineWidth(0.15);
    for (let k = wa; k < wb; k++) {
      const m = W[k]; const x = X(m);
      doc.setFontSize(Math.min(6, wk * 1.6)); doc.setTextColor(...MUTED);
      if (wk > 2.2 || isoWeek(m) % 2 === 0) doc.text(String(isoWeek(m)), x + wk / 2, ay + 8, { align: 'center' });
    }
    for (let s = start; s < endEx; s = addDays(s, 1)) { const d = toD(s); if (d.getUTCDate() === 1 || s === start) {
      const x = X(s); doc.setDrawColor(...(d.getUTCMonth() === 0 ? [150, 155, 160] : LINE));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...INK);
      const daysLeft = Math.min(daysBetween(s, endEx), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() - d.getUTCDate() + 1);
      let ml = pdfTxt(MON[d.getUTCMonth()] + (d.getUTCMonth() === 0 || s === start ? ' ' + d.getUTCFullYear() : '')); if (doc.getTextWidth(ml) + 1.5 > daysLeft * dpx) ml = pdfTxt(MON[d.getUTCMonth()]);
      if (doc.getTextWidth(ml) + 1.5 <= daysLeft * dpx) doc.text(ml, x + 0.8, ay + 3.5);
      doc.setFont('helvetica', 'normal'); } }
    const gy0 = ay + axisH; const gy1 = gy0 + nUnits * RH;
    // uppehåll och röda dagar som band, månadslinjer
    for (let s = start; s < endEx; s = addDays(s, 1)) { const d = toD(s); const wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue;
      const hol = result.cal.hol[s], brk = result.cal.brk[s]; if (hol || brk) { doc.setFillColor(...(hol ? [250, 226, 224] : [232, 237, 245])); doc.rect(X(s), gy0, dpx, gy1 - gy0, 'F'); } }
    for (let s = start; s < endEx; s = addDays(s, 1)) { if (toD(s).getUTCDate() === 1) { doc.setDrawColor(...(toD(s).getUTCMonth() === 0 ? [150, 155, 160] : LINE)); doc.line(X(s), ay, X(s), gy1); } }
    doc.setDrawColor(150, 155, 160); doc.line(M, gy0, PW - M, gy0);
    // rader
    y = gy0;
    const diamond = (cx, cy, r, col) => { doc.setFillColor(...col); doc.lines([[r, r], [-r, r], [-r, -r], [r, -r]], cx, cy - r, [1, 1], 'F', true); };
    const vis = d => d && d.end >= start && d.start < endEx;
    rows.forEach(row => {
      const col = hex(row.color);
      if (row.kind === 'head') {
        const h = RH * 0.8; doc.setFont('helvetica', 'bold'); doc.setFontSize(fs * 0.9); doc.setTextColor(...INK);
        doc.setFillColor(...col); doc.rect(M, y + h / 2 - 1, 2, 2, 'F'); doc.text(pdfTxt(row.label), M + 3.5, y + h / 2 + fs * 0.12); doc.setFont('helvetica', 'normal');
        y += h; return;
      }
      doc.setFontSize(fs); doc.setTextColor(...INK); doc.setFont('helvetica', row.kind === 'sum' ? 'bold' : 'normal');
      if (row.kind === 'sum') { doc.setFillColor(...col); doc.rect(M, y + RH / 2 - 1, 2, 2, 'F'); }
      let nm = pdfTxt(row.label); const nx = row.kind === 'sum' ? M + 3.5 : M + 5.5; while (nm.length > 3 && doc.getTextWidth(nm) > NAME - (nx - M) - 2) nm = nm.slice(0, -2) + '…';
      doc.text(nm, nx, y + RH / 2 + fs * 0.12); doc.setFont('helvetica', 'normal');
      const bh = RH * 0.56, by = y + (RH - bh) / 2;
      if (row.kind === 'sum') {
        row.ivs.forEach(([a, b]) => { if (b < start || a >= endEx) return; const x1 = X(a), x2 = X(addDays(b, 1)); doc.setFillColor(...col); doc.rect(x1, by, Math.max(x2 - x1, 0.6), bh, 'F'); });
        row.ms.forEach(t => { const d = result.dates[t.id]; if (!vis(d)) return;
          if (t.read) { const x1 = X(d.start), x2 = X(addDays(d.end, 1)); doc.setFillColor(...INK); doc.rect(x1, by + bh * 0.25, Math.max(x2 - x1, 0.6), bh * 0.5, 'F'); return; }
          const cx = X(d.start) + dpx / 2; diamond(cx, y + RH / 2, Math.min(1.8, RH * 0.32), INK);
          doc.setFontSize(fs * 0.8); doc.setTextColor(...INK); doc.text(pdfTxt(fmtShort(d.start)), cx + 2.2, y + RH / 2 + fs * 0.1); });
      } else {
        row.tasks.forEach(t => { const d = result.dates[t.id]; if (!vis(d)) return;
          const hi = R && (t.to || []).includes(R); const tc = hex(t.color ? (PRINT_X[t.color] || row.color) : row.color);
          if (isMsT(t)) { const cx = X(d.start) + dpx / 2; diamond(cx, y + RH / 2, Math.min(hi ? 2 : 1.5, RH * 0.32), hi ? INK : tc);
            doc.setFontSize(fs * 0.8); doc.setTextColor(...(hi ? INK : MUTED)); doc.text(pdfTxt(fmtShort(d.start)), cx + 2.2, y + RH / 2 + fs * 0.1); return; }
          const x1 = X(d.start), x2 = X(addDays(d.end, 1)); const w = Math.max(x2 - x1, 0.6);
          if (t.light) { doc.setDrawColor(...tc); doc.setFillColor(...tc.map(c => Math.round(c + (255 - c) * 0.75))); doc.rect(x1, by, w, bh, 'FD'); }
          else { doc.setFillColor(...(t.read && hi ? INK : tc)); doc.rect(x1, by, w, bh, 'F'); }
          if (t.read) { doc.setFillColor(...INK); doc.rect(x1, by - 0.6, 0.5, bh + 1.2, 'F'); doc.rect(x1 + w - 0.5, by - 0.6, 0.5, bh + 1.2, 'F'); }
          doc.setFontSize(fs * 0.78); const txt = pdfTxt(label(t));
          if (doc.getTextWidth(txt) + 1.5 < w) { doc.setTextColor(...(t.light ? INK : [255, 255, 255])); doc.text(txt, x1 + 0.8, y + RH / 2 + fs * 0.1); }
        });
      }
      doc.setDrawColor(...LINE); doc.line(M, y + RH, PW - M, y + RH); y += RH;
    });
    const today = toS(new Date()); if (today >= start && today < endEx) { doc.setDrawColor(179, 25, 31); doc.setLineWidth(0.35); doc.line(X(today), gy0 - 1, X(today), gy1); doc.setLineWidth(0.15); }
    // förklaring
    let lx = M; const ly = PH - M + 3; doc.setFontSize(6.5); doc.setTextColor(...MUTED);
    const leg = (draw, txt) => { draw(lx); doc.text(pdfTxt(txt), lx + 5, ly); lx += doc.getTextWidth(pdfTxt(txt)) + 10; };
    leg(x => { doc.setFillColor(250, 226, 224); doc.rect(x, ly - 2.2, 3.6, 2.6, 'F'); }, 'Röd dag');
    leg(x => { doc.setFillColor(232, 237, 245); doc.rect(x, ly - 2.2, 3.6, 2.6, 'F'); }, 'Uppehåll');
    leg(x => diamond(x + 1.8, ly - 0.9, 1.3, INK), rName ? `Milstolpe för ${rName}` : 'Milstolpe');
    if (rows.some(r => r.kind === 'detail' && r.tasks.some(t => t.read)) || rows.some(r => r.kind === 'sum' && r.ms.some(t => t.read))) leg(x => { doc.setFillColor(...INK); doc.rect(x, ly - 1.8, 3.6, 1.6, 'F'); }, 'Läsperiod: leverans till feedback');
    doc.text('Veckonummer överst', PW - M, ly, { align: 'right' });
  });
  // lista med mottagarens datum
  if (keys.length) {
    const lh = 4.6; const need = 9 + keys.length * lh;
    let ky = y + 8; if (ky + need > PH - M - 6) { doc.addPage('a4', 'landscape'); ky = M + 6; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK);
    doc.text(pdfTxt(rName ? `Datum för ${rName}` : 'Nyckeldatum'), M, ky); ky += 5;
    doc.setFontSize(7.5);
    keys.forEach(k => {
      if (ky > PH - M - 4) { doc.addPage('a4', 'landscape'); ky = M + 6; }
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(pdfTxt(`${wdOf(k.d)} ${fmt(k.d)}`), M, ky);
      doc.setFont('helvetica', 'normal'); doc.text(pdfTxt(k.what), M + 32, ky);
      doc.setTextColor(...MUTED); doc.text(pdfTxt(k.note), M + 110, ky);
      doc.setDrawColor(...LINE); doc.line(M, ky + 1.6, PW - M, ky + 1.6); ky += lh;
    });
  }
  const fname = `${title}_Plan_${rName || 'oversikt'}_${toS(new Date())}`.replace(/[^\wåäöÅÄÖ -]/g, '').replace(/\s+/g, '_') + '.pdf';
  const openTab = () => { try { const url = URL.createObjectURL(new Blob([doc.output('arraybuffer')], { type: 'application/pdf' })); const w = window.open(url, '_blank'); if (w) { toast('PDF:en öppnades i en ny flik. Spara eller skriv ut den därifrån.', 6000); return true; } } catch (x) {} return false; };
  if (!downloads) { if (!openTab()) toast('Den här vyn kan inte spara filer. Öppna KC i webbläsaren och exportera därifrån.', 8000); return; }
  try { await downloads.save({ filename: fname, data: doc.output('arraybuffer') }); toast('PDF:en är sparad i dina hämtade filer.', 5000); }
  catch (e) { if (e && e.code === 'declined') toast('Du avbröt nedladdningen.'); else if (!openTab()) toast('Det gick inte att spara PDF:en här (' + ((e && (e.code || e.message)) || 'okänt fel') + ').', 8000); }
}

// ---- Milstolpar till Google Kalender (v2: välj kalender, påminnelse, mottagare, läsperioder) ----
const CALSRV = 'Google Calendar';
function calKeyOf(t) { return t.id; }
let calList = null, calListErr = '';
async function loadCalList() {
  if (calList || !mcp) return;
  try { const res = await mcp.callTool(CALSRV, 'list_calendars', {}, { cache: false }); const pl = (res && (res.payload || res)) || {};
    calList = (pl.calendars || []).filter(c => c.id && !/#holiday|#weeknum|@import\.calendar/.test(c.id)).map(c => ({ id: c.id, name: c.summary || c.id }));
  } catch (e) { calListErr = mcpError(e, 'läsa dina kalendrar').replace(/Google Sheets/g, 'Google Kalender'); calList = []; }
  if (panelMode === 'calexp') renderCalExportPanel();
}
function calItems(rf) {
  const out = [];
  plan.tasks.forEach(t => {
    const d = result.dates[t.id]; if (!d) return;
    if (rf && !(t.to || []).includes(rf)) return;
    if (t.read) {
      const who = rf ? recipName(rf) : (recipNames(t) || 'Mottagaren');
      out.push({ key: t.id + ':lev', t, d: d.start, title: `${who} får: ${label(t)}`, note: `${who} får materialet ${t.dlvAt || 'dagens början'}.` });
      out.push({ key: t.id + ':fb', t, d: d.end, title: `Feedback från ${who}: ${label(t)}`, note: `Feedback senast ${t.fbAt || 'dagens slut'}.` });
    } else if (isMsT(t)) out.push({ key: t.id, t, d: d.start, title: label(t) + ((t.to || []).length && !rf ? ' · ' + recipNames(t) : ''), note: t.locked ? 'Låst hållpunkt.' : '' });
  });
  return out.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : 0);
}
function renderCalExportPanel() {
  const p = $('#panel'); p.classList.remove('wide');
  const sync = plan.settings.calSync || {}; const st = ui.calx = ui.calx || { rf: '' };
  const target = sync._cal || 'primary'; const remind = sync._remind != null ? sync._remind : 3;
  if (!calList && mcp) loadCalList();
  const items = calItems(st.rf); const short = plan.meta.title || cur.name;
  const calOpts = `<option value="primary" ${target === 'primary' ? 'selected' : ''}>Huvudkalendern</option>` + (calList || []).filter(c => c.id !== 'primary').map(c => `<option value="${esc(c.id)}" ${target === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + (target !== 'primary' && calList && !calList.some(c => c.id === target) ? `<option value="${esc(target)}" selected>${esc(target)}</option>` : '');
  p.innerHTML = `
    <header><div><div class="meta">Export</div><h2>Milstolpar till kalendern</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">Bara milstolpar och läsperiodernas leverans- och feedbackdagar exporteras, som heldagshändelser markerade som lediga. Inga inbjudningar skickas.</p>
    <div class="field"><label for="ceCal">Kalender</label><select id="ceCal">${calList ? calOpts : '<option>Hämtar dina kalendrar…</option>'}</select>${calListErr ? `<span class="hint">${esc(calListErr)}</span>` : '<span class="hint">Välj gärna en egen kalender för projektet, så kan du visa eller dölja den.</span>'}</div>
    <div class="two"><div class="field"><label for="ceRf">Mottagare</label><select id="ceRf"><option value="">Alla</option>${(plan.recipients || []).map(x => `<option value="${esc(x.id)}" ${st.rf === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="ceRem">Påminnelse, dagar innan</label><input type="number" min="0" max="28" id="ceRem" value="${remind}"><span class="hint">Kl 9.00. 0 = ingen.</span></div></div>
    <div class="field"><label for="ceTitle">Prefix i kalendern</label><input id="ceTitle" value="${esc(short)}"></div>
    <div class="celist">${items.map(it => { const s = sync[it.key]; const changed = s && s !== it.d; const fresh = !s || changed;
      return `<label class="check"><input type="checkbox" data-ce="${esc(it.key)}" ${fresh ? 'checked' : ''}> <span>${esc(it.title)}</span> <span class="mono">${fmt(it.d)}</span>${s ? (changed ? ` <span class="delta later">ändrat, låg ${fmtShort(s)}</span>` : ' <span class="delta earlier">i kalendern</span>') : ''}</label>`; }).join('') || '<p class="hint">Inga milstolpar för den mottagaren.</p>'}</div>
    <button class="btn primary" type="button" data-act="cesend" ${calList ? '' : 'disabled'}>Lägg i kalendern</button>`;
  p.hidden = false;
  if (!renderCalExportPanel.wired) {
    renderCalExportPanel.wired = true;
    p.addEventListener('change', e => {
      if (panelMode !== 'calexp') return; const el = e.target; const sy = plan.settings.calSync = plan.settings.calSync || {};
      if (el.id === 'ceCal') { sy._cal = el.value; dirty = true; renderSource(); }
      else if (el.id === 'ceRem') { const n = Math.max(0, Math.min(28, parseInt(el.value, 10) || 0)); sy._remind = n; dirty = true; renderSource(); }
      else if (el.id === 'ceRf') { (ui.calx = ui.calx || {}).rf = el.value; renderCalExportPanel(); }
    });
  }
}
async function calExport(btn) {
  const keys = $$('#panel [data-ce]').filter(c => c.checked).map(c => c.dataset.ce);
  if (!keys.length) { toast('Markera minst en milstolpe.'); return; }
  const sy = plan.settings.calSync = plan.settings.calSync || {};
  const pre = ($('#ceTitle').value || '').trim(); const calId = ($('#ceCal') || {}).value || sy._cal || 'primary';
  const days = sy._remind != null ? sy._remind : 3;
  const items = calItems((ui.calx || {}).rf || ''); const byKey = {}; items.forEach(i => byKey[i.key] = i);
  btn.disabled = true; btn.textContent = 'Lägger in…';
  let ok = 0; const fail = [];
  for (const k of keys) {
    const it = byKey[k]; if (!it) continue;
    const args = { summary: (pre ? pre + ' · ' : '') + it.title, startTime: it.d + 'T00:00:00', endTime: addDays(it.d, 1) + 'T00:00:00', allDay: true, availability: 'AVAILABILITY_FREE', notificationLevel: 'NONE', description: `Från produktionsplanen för ${plan.meta.title || cur.name}. ${it.note}`.trim() };
    if (calId && calId !== 'primary') args.calendarId = calId;
    if (days > 0) args.overrideReminders = [{ method: 'popup', minutes: days * 1440 - 9 * 60 }]; else args.useDefaultReminders = false;
    try { await mcp.callTool(CALSRV, 'create_event', args, { cache: false }); sy[k] = it.d; ok++; }
    catch (e) { fail.push(it.title); if (e && /reauth|not_connected|selection|consent|approval|manifest|policy/.test(e.code || '')) { toast(mcpError(e, 'lägga in i kalendern').replace(/Google Sheets/g, 'Google Kalender'), 8000); break; } }
  }
  if (ok) dirty = true;
  renderCalExportPanel(); renderSource();
  const calName = calId === 'primary' ? 'huvudkalendern' : ((calList || []).find(c => c.id === calId) || { name: calId }).name;
  if (ok) toast(`${ok} händelser ligger nu i ${calName}.${fail.length ? ' Misslyckades: ' + fail.join(', ') + '.' : ''} Spara till Sheet så minns planen vad som är exporterat.`, 7000);
  else if (fail.length) toast('Inget kunde läggas in. Har du skrivrätt i den kalendern?', 7000);
}


// ===== Steg 6: versioner, ändringslogg, budget =====
let whoName = '';
let cmpCache = { key: '', dates: null };
function cmpVariant() { return ui.cmp ? variants.find(v => v.name === ui.cmp) : null; }
function cmpBase() {
  const v = cmpVariant(); if (!v) return baseline;
  const k = v.name + '|' + v.saved; if (cmpCache.key !== k) cmpCache = { key: k, dates: planSchedule(v.plan).dates, plan: v.plan };
  return cmpCache.dates;
}
const cmpLabel = () => { const v = cmpVariant(); return v ? `Jämfört med ${v.kind === 'version' ? 'versionen' : 'scenariot'} “${v.name}”` : 'Jämfört med senast hämtade'; };

// ---- Ändringslogg ----
function diffPlans(a, ra, b, rb) {
  const out = []; let cascade = 0;
  const A = new Map(a.tasks.map(t => [t.id, t])), B = new Map(b.tasks.map(t => [t.id, t]));
  const fd = d => d ? fmtShort(d) : '–'; const sv = v => v == null || v === '' ? '–' : String(v);
  const F = { dur: 'arbetsdagar', hours: 'timmar', res: 'resurs', member: 'person', status: 'status', note: 'kommentar', owner: 'ansvarig', notBefore: 'tidigast start', minMargin: 'marginalgräns', row: 'rad', film: 'film' };
  B.forEach((t, id) => {
    const o = A.get(id); if (!o) { out.push([label(t), id, 'Nytt moment' + (rb.dates[id] ? ` ${fd(rb.dates[id].start)}–${fd(rb.dates[id].end)}` : '')]); return; }
    const ch = [];
    if (o.name !== t.name) ch.push(`namn “${o.name}” → “${t.name}”`);
    if (TYP_OUT(o) !== TYP_OUT(t)) ch.push(`typ ${TYP_OUT(o)} → ${TYP_OUT(t)}`);
    if ((o.start || '') !== (t.start || '') || (o.end || '') !== (t.end || '')) { if (t.type === 'fixed' || o.type === 'fixed') ch.push(`fasta datum ${fd(o.start)}–${fd(o.end)} → ${fd(t.start)}–${fd(t.end)}`); }
    for (const k in F) if (JSON.stringify(o[k] == null ? null : o[k]) !== JSON.stringify(t[k] == null ? null : t[k])) ch.push(`${F[k]} ${sv(o[k])} → ${sv(t[k])}`);
    if (depsToStr(o.deps) !== depsToStr(t.deps)) ch.push(`beroenden ${depsToStr(o.deps) || '–'} → ${depsToStr(t.deps) || '–'}`);
    if (depsToStr(o.soft) !== depsToStr(t.soft)) ch.push(`mjuka beroenden ${depsToStr(o.soft) || '–'} → ${depsToStr(t.soft) || '–'}`);
    if (doersToStr(o.doers) !== doersToStr(t.doers)) ch.push(`utförare ${doersToStr(o.doers) || '–'} → ${doersToStr(t.doers) || '–'}`);
    if ((o.to || []).join(',') !== (t.to || []).join(',')) ch.push(`mottagare ${(o.to || []).join(', ') || '–'} → ${(t.to || []).join(', ') || '–'}`);
    if ((o.dlvAt || '') !== (t.dlvAt || '') || (o.fbAt || '') !== (t.fbAt || '')) ch.push(`klockslag ${o.dlvAt || 'början'}/${o.fbAt || 'slut'} → ${t.dlvAt || 'början'}/${t.fbAt || 'slut'}`);
    const x = ra.dates[id], y = rb.dates[id]; const moved = x && y && (x.start !== y.start || x.end !== y.end);
    if (ch.length) { if (moved) ch.push(`ligger nu ${fd(y.start)}–${fd(y.end)} (var ${fd(x.start)}–${fd(x.end)})`); out.push([label(t), id, ch.join('; ')]); }
    else if (moved) { if (isMsT(t) || t.locked || t.read) out.push([label(t), id, `följdflytt ${fd(x.start)} → ${fd(y.start)}`]); else cascade++; }
  });
  A.forEach((t, id) => { if (!B.has(id)) out.push([label(t), id, 'Borttaget']); });
  if (cascade) out.push(['–', '', `${cascade} faser flyttades som följd av ändringarna`]);
  return out;
}
async function writeLog(entries) {
  if (!entries.length || !mcp) return;
  const n = new Date(); const ts = `${toS(n)} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  const rows = entries.map(e => ({ values: { 'Tid': ts, 'Vem': whoName || 'KC', 'Moment': e[0], 'ID': e[1], 'Ändring': e[2] } }));
  await kcApi('planWrite', Object.assign({}, kcTarget(cur.id), { sheet: 'Ändringslogg', rows }), true);
}
let logState = { rows: null, err: '', busy: false };
async function loadLog() {
  logState.busy = true; renderLogPanel();
  try { const v = await tryRange('Ändringslogg!A1:E20000'); logState.rows = v ? v.slice(1).filter(r => r[0]).reverse() : []; logState.err = v ? '' : 'Fliken Ändringslogg finns inte ännu. Den skapas första gången du sparar en ändring.'; }
  catch (e) { logState.err = mcpError(e, 'läsa ändringsloggen'); }
  logState.busy = false; if (panelMode === 'log') renderLogPanel();
}
function renderLogPanel() {
  const p = $('#panel'); p.classList.add('wide'); const q = (logState.q || '').toLowerCase();
  const rows = (logState.rows || []).filter(r => !q || r.join(' ').toLowerCase().includes(q)).slice(0, 300);
  p.innerHTML = `<header><div><div class="meta">Historik</div><h2>Ändringslogg</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">Varje gång planen sparas loggas vad som ändrats, av vem och när. Följdflyttar av vanliga faser räknas ihop på en rad; milstolpar, låsta punkter och läsperioder loggas var för sig.</p>
    <div class="field"><input id="logQ" placeholder="Sök i loggen, t.ex. ett moment eller ett namn" value="${esc(logState.q || '')}" aria-label="Sök i loggen"></div>
    ${logState.busy ? '<p class="foot">Hämtar…</p>' : logState.err ? `<div class="alert info">${esc(logState.err)}</div>` : rows.length ? `<div class="vwrap"><table class="vtab"><tr><th>Tid</th><th>Vem</th><th>Moment</th><th>Ändring</th></tr>${rows.map(r => `<tr><td class="mono">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[4])}</td></tr>`).join('')}</table></div>` : '<p class="foot">Inga ändringar loggade än.</p>'}`;
  p.hidden = false;
  const qi = $('#logQ'); if (qi) qi.oninput = () => { logState.q = qi.value; const pos = qi.selectionStart; renderLogPanel(); const n = $('#logQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
}

// ---- Budget ur Movie Magic ----
const BUD_HEAD = ['Konto', 'Beskrivning', 'Fas', 'Enhet', 'Antal', 'Personer', 'Pris', 'Budget'];
const kr = n => (Math.round(n || 0)).toLocaleString('sv-SE') + ' kr';
const numSv = v => { const x = parseFloat(String(v == null ? '' : v).replace(/\s|kr/gi, '').replace(/\u00a0/g, '').replace(',', '.')); return isNaN(x) ? 0 : x; };
function budgetFromRows(rows) {
  if (!rows || rows.length < 2) return [];
  return rows.slice(1).filter(r => cell(r, 0) || cell(r, 1)).map(r => ({ acct: cell(r, 0), desc: cell(r, 1), fas: cell(r, 2), unit: /vecka|week/i.test(cell(r, 3)) ? 'vecka' : /dag|day/i.test(cell(r, 3)) ? 'dag' : 'fast', qty: numSv(cell(r, 4)), n: numSv(cell(r, 5)) || 1, rate: numSv(cell(r, 6)), amt: numSv(cell(r, 7)) }));
}
const budgetToRows = b => [BUD_HEAD].concat((b || []).map(L => [L.acct, L.desc, L.fas || '', L.unit, L.unit === 'fast' ? '' : (L.qty || ''), L.unit === 'fast' ? '' : L.n, L.unit === 'fast' ? '' : L.rate, L.amt]));
function fasTasksIn(p, fas) {
  const ids = String(fas || '').split(/[,;]/).map(s => s.trim()).filter(Boolean); const out = new Set();
  ids.forEach(x => { const t = p.tasks.find(y => y.id === x); if (t) out.add(t); else p.tasks.filter(y => !isMsT(y) && !y.light && (((p.rows || []).find(r => r.id === y.row) || {}).section === x || y.group === x || pdfGroupOf(((p.rows || []).find(r => r.id === y.row) || {}).section || y.group) === x)).forEach(y => out.add(y)); });
  return [...out];
}
function budgetCalc(p, res, L) {
  const ts = fasTasksIn(p, L.fas); const days = new Set();
  const lens = [];
  ts.forEach(t => { const r = res.dates[t.id]; if (!r || isMsT(t)) return; let n = 0; for (let s = r.start, g = 0; s <= r.end && g < 4000; s = addDays(s, 1), g++) if (res.cal.isWork(s, r.cal || 'w5')) { days.add(s); n++; } lens.push(n); });
  const d = [...days].sort(); const per = L.n || 1;
  const avgDays = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0; const planUnits = L.unit === 'vecka' ? avgDays / 5 : avgDays;
  let planAmt = L.amt;
  if (L.fas && lens.length && L.unit !== 'fast') planAmt = L.qty > 0 ? L.amt * planUnits / L.qty : L.rate * per * planUnits;
  return { days: d, planAmt, planUnits, mapped: !!L.fas && ts.length > 0 };
}
function budgetWeeks(p, res) {
  const W = {}; let unmapped = 0;
  (plan.budget || []).forEach(L => { const c = budgetCalc(p, res, L); if (!c.days.length) { unmapped += c.planAmt; return; } const each = c.planAmt / c.days.length; c.days.forEach(d => { const m = mondayOf(d); W[m] = (W[m] || 0) + each; }); });
  return { W, unmapped };
}
let budState = { paste: '', show: 'all' };
function parseMMB(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim()); if (!lines.length) return [];
  const delim = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : ',';
  const rows = lines.map(l => l.split(delim).map(x => x.replace(/^"|"$/g, '').trim()));
  let hi = rows.findIndex(r => r.some(c => /^(acct|account|konto)/i.test(c)));
  const H = hi >= 0 ? rows[hi].map(c => c.toLowerCase()) : null;
  const col = re => H ? H.findIndex(c => re.test(c)) : -1;
  const ci = { acct: H ? col(/^(acct|account|konto)/) : 0, desc: H ? col(/desc|beskr/) : 1, qty: col(/^(amount|antal|qty)$/), unit: col(/^(units?|enhet)$/), x: col(/^x$/), rate: col(/rate|pris|à/), total: H ? (col(/^total$/) >= 0 ? col(/^total$/) : col(/total|belopp|subtotal|summa/)) : 2 };
  const out = [];
  rows.slice(hi + 1).forEach(r => {
    const acct = r[ci.acct] || ''; if (!/^\d{3,6}([-.]\d+)?$/.test(acct)) return;
    const unitTxt = ci.unit >= 0 ? r[ci.unit] : ''; const unit = /week|wk|vecka|v\b/i.test(unitTxt) ? 'vecka' : /day|dag/i.test(unitTxt) ? 'dag' : 'fast';
    const total = numSv(r[ci.total]); const rate = ci.rate >= 0 ? numSv(r[ci.rate]) : 0; const x = ci.x >= 0 ? numSv(r[ci.x]) || 1 : 1;
    const qty = ci.qty >= 0 ? numSv(r[ci.qty]) : 0; out.push({ acct, desc: ci.desc >= 0 ? r[ci.desc] : '', unit: unit !== 'fast' && rate ? unit : 'fast', qty, n: x, rate, amt: total || (rate * x * (qty || 1)) });
  });
  return out;
}
function renderBudPanel() {
  const p = $('#panel'); p.classList.add('wide'); const B = plan.budget || [];
  const calc = B.map(L => Object.assign({ L }, budgetCalc(plan, result, L)));
  const tb = B.reduce((s, L) => s + L.amt, 0), tp = calc.reduce((s, c) => s + c.planAmt, 0);
  const v = cmpVariant(); const cur0 = budgetWeeks(plan, result); const cmpW = v ? budgetWeeks(v.plan, planSchedule(v.plan)).W : null;
  const weeks = [...new Set(Object.keys(cur0.W).concat(cmpW ? Object.keys(cmpW) : []))].sort();
  let chart = '';
  if (weeks.length) {
    const max = Math.max(...weeks.map(w => Math.max(cur0.W[w] || 0, cmpW ? cmpW[w] || 0 : 0)), 1); const bw = Math.max(3, Math.min(14, 760 / weeks.length)); const H = 140; const Wd = weeks.length * bw;
    const bars = weeks.map((w, i) => `<rect x="${i * bw}" y="${H - (cur0.W[w] || 0) / max * H}" width="${Math.max(bw - 1, 1)}" height="${(cur0.W[w] || 0) / max * H}" class="bud-bar"><title>v${isoWeek(w)} ${toD(w).getUTCFullYear()}: ${kr(cur0.W[w])}${cmpW ? ' · ' + esc(v.name) + ': ' + kr(cmpW[w]) : ''}</title></rect>`).join('');
    const line = cmpW ? `<polyline class="bud-cmp" points="${weeks.map((w, i) => `${i * bw + bw / 2},${H - (cmpW[w] || 0) / max * H}`).join(' ')}"></polyline>` : '';
    const yrs = weeks.map((w, i) => i === 0 || toD(w).getUTCFullYear() !== toD(weeks[i - 1]).getUTCFullYear() ? `<text x="${i * bw}" y="${H + 14}" class="bud-ax">${toD(w).getUTCFullYear()}</text>` : '').join('');
    chart = `<div class="field"><label>Kostnad per vecka enligt planen${v ? ` – linjen visar “${esc(v.name)}”` : ''}</label><div class="vwrap"><svg width="${Wd}" height="${H + 18}" role="img" aria-label="Kostnad per vecka">${bars}${line}${yrs}</svg></div>${cur0.unmapped ? `<span class="hint">${kr(cur0.unmapped)} är inte knutet till någon fas och syns inte i kurvan.</span>` : ''}</div>`;
  }
  const secs = [...new Set(plan.tasks.map(t => pdfGroupOf(taskSec(t))))];
  const show = budState.show === 'diff' ? calc.filter(c => Math.round(c.planAmt) !== Math.round(c.L.amt)) : budState.show === 'nofas' ? calc.filter(c => !c.L.fas) : calc;
  p.innerHTML = `<header><div><div class="meta">Budget</div><h2>Budget mot planen</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">Varje konto knyts till en fas en gång. Konton per vecka eller dag räknas om efter fasens längd i planen, fasta belopp ligger kvar. Kurvan visar när pengarna går åt.</p>
    ${B.length ? `<div class="bud-sum"><div><span>Budget</span><b>${kr(tb)}</b></div><div><span>Enligt planen</span><b>${kr(tp)}</b></div><div class="${tp - tb > 0 ? 'over' : ''}"><span>Skillnad</span><b>${tp - tb >= 0 ? '+' : '−'}${kr(Math.abs(tp - tb))}</b></div></div>${chart}
    <div class="field"><label>Visa</label><div class="seg-inline">${[['all', 'Alla konton'], ['diff', 'Bara de som skiljer'], ['nofas', 'Utan fas']].map(([k, n]) => `<label><input type="radio" name="budShow" value="${k}" ${budState.show === k ? 'checked' : ''}> ${n}</label>`).join('')}</div></div>
    <div class="vwrap"><table class="vtab bud"><tr><th>Konto</th><th>Beskrivning</th><th>Fas</th><th>Enhet</th><th>Längd budget → plan</th><th>Pers.</th><th>Budget</th><th>Planen</th></tr>
    ${show.map(c => { const i = B.indexOf(c.L); const d = c.planAmt - c.L.amt; return `<tr><td class="mono">${esc(c.L.acct)}</td><td>${esc(c.L.desc)}</td><td><input list="budFas" data-b="fas" data-i="${i}" value="${esc(c.L.fas)}" placeholder="välj fas" aria-label="Fas för ${esc(c.L.acct)}"></td>
      <td><select data-b="unit" data-i="${i}" aria-label="Enhet"><option value="fast" ${c.L.unit === 'fast' ? 'selected' : ''}>fast</option><option value="vecka" ${c.L.unit === 'vecka' ? 'selected' : ''}>vecka</option><option value="dag" ${c.L.unit === 'dag' ? 'selected' : ''}>dag</option></select></td>
      <td class="num">${c.L.unit === 'fast' ? '' : `${c.L.qty ? c.L.qty.toLocaleString('sv-SE') : '–'} → ${c.mapped ? (Math.round(c.planUnits * 10) / 10).toLocaleString('sv-SE') : '–'} ${c.L.unit === 'vecka' ? 'v' : 'd'}`}</td><td>${c.L.unit === 'fast' ? '' : `<input type="number" min="0" step="0.5" data-b="n" data-i="${i}" value="${c.L.n}" aria-label="Personer">`}</td><td class="num">${kr(c.L.amt)}</td><td class="num ${Math.round(d) ? (d > 0 ? 'later' : 'earlier') : ''}">${kr(c.planAmt)}${c.L.fas && !c.mapped ? ' <span class="hint">fasen finns inte</span>' : ''}</td></tr>`; }).join('')}</table></div>
    <datalist id="budFas">${secs.map(s => `<option value="${esc(s)}">`).join('')}${plan.tasks.filter(t => !isMsT(t)).map(t => `<option value="${esc(t.id)}">${esc(label(t))}</option>`).join('')}</datalist>` : '<p class="foot">Ingen budget inläst ännu.</p>'}
    <div class="field"><label for="budPaste">Läs in från Movie Magic</label><textarea id="budPaste" rows="4" placeholder="Exportera kontolistan till Excel från Movie Magic Budgeting, markera raderna (med rubrikraden) och klistra in här.">${esc(budState.paste)}</textarea>
      <div class="quick"><button class="btn small primary" type="button" data-act="budImp">Läs in</button></div>
      <span class="hint">Koppla tidsbundna konton till de faser de betalar, t.ex. fin1, fin2, fin3 för finklipparna. Beloppet räknas om med fasernas längd jämfört med budgetens antal veckor eller dagar. Kolumnerna hittas på rubrikerna (Acct, Description, Amount, Units, X, Rate, Total). Konton som redan har en fas behåller den. Sparas i fliken Budget när du sparar planen.</span></div>`;
  p.hidden = false;
  if (!renderBudPanel.wired) { renderBudPanel.wired = true;
    p.addEventListener('change', e => { if (panelMode !== 'bud') return; const el = e.target;
      if (el.name === 'budShow') { budState.show = el.value; renderBudPanel(); return; }
      const k = el.dataset.b; if (!k) return; const L = (plan.budget || [])[+el.dataset.i]; if (!L) return;
      if (k === 'fas') L.fas = el.value.trim(); if (k === 'unit') L.unit = el.value; if (k === 'n') L.n = numSv(el.value) || 1;
      if (k === 'unit' && L.unit !== 'fast' && !L.rate) { L.rate = L.amt; toast('Priset sattes till hela budgetbeloppet. Justera det i fliken Budget om kontot har ett styckpris.', 6000); }
      dirty = true; renderSource(); renderBudPanel(); });
    p.addEventListener('input', e => { if (panelMode === 'bud' && e.target.id === 'budPaste') budState.paste = e.target.value; });
  }
}
function onBudAction(act) {
  if (act !== 'budImp') return;
  const got = parseMMB(budState.paste || ($('#budPaste') || {}).value);
  if (!got.length) { toast('Hittade inga konton. Ta med rubrikraden och kolumnen med kontonummer.', 6000); return; }
  const old = plan.budget || []; const keep = new Map(old.map(L => [L.acct + '|' + L.desc, L.fas]));
  plan.budget = got.map(L => Object.assign(L, { fas: keep.get(L.acct + '|' + L.desc) || '' }));
  dirty = true; budState.paste = ''; renderSource(); renderBudPanel();
  const n0 = plan.budget.filter(L => !L.fas).length;
  toast(`Läste in ${got.length} konton.${n0 ? ` ${n0} saknar fas – knyt dem till en fas i tabellen.` : ''}`, 6000);
}

// ---- Spara: autospara till arket + lokalt utkast som skyddsnät ----
let lastSnap = null, autoT = null, draftOffer = null;
ui.autosave = ui.autosave !== false;
const draftKey = () => 'draft.' + (cur.tag || cur.id);
function draftTick() {
  if (!dirty) return;
  const s = JSON.stringify({ plan, variants });
  if (s === lastSnap) return; lastSnap = s;
  store(draftKey(), { at: Date.now(), stamp: nowStamp(), data: s }); cloudWrite(s);
  if (ui.autosave && mcp && source.kind === 'sheet' && !saveBusy) { clearTimeout(autoT); autoT = setTimeout(() => { if (dirty && !saveBusy) saveToSheet(true); }, 2500); }
}
let saveBusy = false;
function clearDraft() { try { localStorage.removeItem('kc_plan.' + draftKey()); } catch (e) {} lastSnap = null; draftOffer = null; cloudClear(); }
function checkDraft(loadedAt) {
  const d = store(draftKey()); if (!d || !d.data) return;
  if (loadedAt && d.at < loadedAt - 1000 && !dirty) { /* utkastet är äldre än det som nyss hämtades men kan ändå vara osparat */ }
  draftOffer = d; renderSource();
}
function draftHtml() { return draftOffer && !dirty ? ` · <span class="dot dirty"></span> Osparade ändringar från ${esc(draftOffer.stamp)} finns kvar <button class="linkbtn" type="button" id="btnDraftUse">Återställ dem</button> <button class="linkbtn" type="button" id="btnDraftDrop">Släng</button>` : ''; }
function wireSave() {
  setInterval(draftTick, 1500);
  window.addEventListener('beforeunload', e => { if (dirty) { draftTick(); e.preventDefault(); e.returnValue = ''; } });
  $('#source').addEventListener('click', e => {
    if (e.target.id === 'btnDraftUse' && draftOffer) { try { const o = JSON.parse(draftOffer.data); pushUndo(); plan = normalize(o.plan); variants = (o.variants || []).map(v => Object.assign(v, { plan: normalize(v.plan) })); dirty = true; draftOffer = null; recompute(); toast(ui.autosave && mcp && source.kind === 'sheet' ? 'Återställt. Sparar till arket…' : 'Återställt. Tryck Spara till Sheet för att behålla dem.', 6000); } catch (x) { toast('Utkastet gick inte att läsa.'); } }
    if (e.target.id === 'btnDraftDrop') { clearDraft(); renderSource(); }
    if (e.target.id === 'btnDraftUse' && mcp && source.kind === 'sheet' && ui.autosave) setTimeout(() => saveToSheet(true), 300);
  });
  const a = $('#autosave'); a.checked = ui.autosave;
  a.addEventListener('change', () => { ui.autosave = a.checked; store('ui4', ui); if (a.checked && dirty) draftTick(); toast(a.checked ? 'Ändringar sparas till arket automatiskt några sekunder efter att du gjort dem.' : 'Autospara är av. Tryck Spara till Sheet när du vill spara.', 5000); });
}

// ---- Molnutkast: ändringar sparas i ditt Claude-konto när arket inte går att nå ----
let cloudDb = null, cloudUid = null, cloudT = null;
const cloudRef = () => cloudDb && cloudUid ? cloudDb.doc('data/users/' + cloudUid + '/utkast_' + cur.id.replace(/[^A-Za-z0-9_-]/g, '')) : null;
async function initCloud() {
  try { if (window.claude && claude.use) { cloudDb = await claude.use('db'); const u = await claude.use('user'); cloudUid = u ? await u.id() : null; try { const me = u && u.me ? await u.me() : null; whoName = (me && me.name) || ''; } catch (e) {} } } catch (e) { cloudDb = null; }
  if (!cloudRef()) { renderSource(); return; }
  try {
    const snap = await cloudRef().get();
    const d = snap.exists ? snap.data() : null; const local = store(draftKey());
    if (d && d.data && (!local || (d.at || 0) > (local.at || 0))) draftOffer = { at: d.at, stamp: d.stamp + ' (sparade i ditt Claude-konto)', data: d.data };
  } catch (e) {}
  renderSource();
}
function cloudWrite(s) {
  const ref = cloudRef(); if (!ref) return;
  clearTimeout(cloudT); cloudT = setTimeout(() => { ref.set({ at: Date.now(), stamp: nowStamp(), sheet: cur.id, data: s }).catch(() => {}); }, 3000);
}
function cloudClear() { const ref = cloudRef(); clearTimeout(cloudT); if (ref) ref.delete().catch(() => {}); }

// ---- AI-assistent: beskriv en ändring, få ett förslag, godkänn ----
let sampleFn = null; let aiState = { prompt: '', busy: false, ctl: null, result: null, preview: null, err: '' };
const AI_FIELDS = ['name', 'dur', 'hours', 'crew', 'res', 'member', 'notBefore', 'start', 'end', 'ignoreHol', 'ignoreBreaks', 'status', 'note', 'color', 'row', 'film', 'mustFinishBefore', 'minMargin', 'with', 'group', 'light', 'cal'];
function planForAi() {
  return {
    title: plan.meta.title, today: toS(new Date()),
    settings: { projectStart: plan.settings.projectStart, breaks: (plan.settings.breaks || []).map(b => ({ name: b.name, from: b.from, to: b.to, on: b.on })) },
    resources: plan.resources.map(g => ({ id: g.id, name: g.name, members: g.members.map(m => ({ id: m.id, name: m.name })) })),
    rows: plan.rows.map(r => ({ id: r.id, section: r.section, name: r.name })),
    tasks: plan.tasks.map(t => { const r = result.dates[t.id] || {}; const o = { id: t.id, name: t.name, group: t.group, row: t.row };
      ['film', 'type', 'dur', 'hours', 'crew', 'res', 'member', 'with', 'notBefore', 'start', 'end', 'ms', 'cal', 'ignoreHol', 'ignoreBreaks', 'mustFinishBefore', 'minMargin', 'status', 'note', 'light', 'locked', 'read', 'to', 'owner'].forEach(k => { if (t[k] !== undefined && t[k] !== '' && t[k] !== false) o[k] = t[k]; });
      if (t.deps && t.deps.length) o.deps = t.deps.map(d => d.id + ' ' + (d.type || 'FS') + (d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''));
      if (t.soft && t.soft.length) o.softDeps = depsToStr(t.soft);
      o.computed = r.start ? r.start + '..' + r.end : null; if (r.members) o.who = r.members.map(memberName); return o; }),
  };
}
function aiPrompt(q) {
  return `Du är planeringsassistent i ett regelstyrt Gantt-verktyg för film- och tv-produktion (svenska). Användaren är producent och ber om en ändring i planen. Svara ENDAST med ett JSON-objekt.

Hur verktyget räknar:
- Faser utan "type" räknas fram: "dur" = arbetsdagar (eller "hours" + "crew": timmar delat på personer, 8 h/dag, 10 h/dag om cal "s4"). Kalender "w5" = mån–fre, "s4" = mån–tors.
- "deps" är beroenden: "ID FS" startar när ID är klar, "ID SS" startar samtidigt, "ID FF" slutar samtidigt. "+N" = N arbetsdagars marginal (kan vara negativt).
- type "fixed" har fasta datum "start"/"end" (YYYY-MM-DD). Milstolpe: type "milestone" (ms true) med deps, eller type "fixed" med start=end och ms true.
- "res" = resursgrupp-ID. En person gör en sak i taget; faser i samma grupp köar. "member" = person-ID som ska göra det. "with" = samma person som fas X.
- "notBefore" = tidigast start (YYYY-MM-DD). Röda dagar och uppehåll (breaks) är lediga dagar om inte "ignoreHol"/"ignoreBreaks" är true.
- "mustFinishBefore" = ID som fasen ska vara klar före, "minMargin" arbetsdagar.
- "row" = rad-ID där stapeln ligger. "film" = filmnummer. "status": klar|pagar|risk|beslut|bokad.

Svarsformat:
{"summary": "1–3 meningar på svenska om vad du ändrar och varför",
 "ops": [ ... ],
 "question": "fyll i bara om begäran är oklar, annars tom sträng"}
Tillåtna ops:
{"op":"set","id":"<fas-ID>","field":"<${AI_FIELDS.join('|')}>","value":<värde eller null för att ta bort>}
{"op":"deps","id":"<fas-ID>","deps":["fin1 FS+5","grov FS"]}   (ersätter alla beroenden)
{"op":"add","task":{"id":"nytt_id","name":"...","group":"<avdelning>","row":"<rad-ID>","dur":5,"deps":["..."], ...}}
{"op":"remove","id":"<fas-ID>"}
{"op":"addMember","pool":"<grupp-ID>","id":"nytt_person_id","name":"Namn"}
{"op":"addPool","id":"nytt_grupp_id","name":"Yrkesroll","members":[{"id":"...","name":"..."}]}
{"op":"addRow","id":"r_ny","section":"<avdelning>","name":"Radnamn"}
{"op":"break","name":"Sommaruppehåll","from":"YYYY-MM-DD","to":"YYYY-MM-DD","on":true}   (lägger till eller ändrar uppehåll med samma namn och år)
Avdelningar: ${GROUP_ORDER.join(', ')}.
Regler: Faser med locked:true är låsta hållpunkter (t.ex. inspelningsstart, green light): ändra aldrig deras start eller end om användaren inte uttryckligen ber om just det datumet, och flytta dem aldrig som följd av annat. softDeps flyttar ingenting. Ändra så lite som möjligt. Använd befintliga ID:n. Hitta inte på personnamn. Föredra regler (deps, dur, res) framför fasta datum. Lägg aldrig till något användaren inte bett om. Om begäran gäller "per film", gör det för varje film som finns. Om begäran är en fråga utan ändring: tom ops och svaret i summary.

${aiState.rules ? `VIKTIGT – planen ligger i fritt läge: datumen (computed) är lagda för hand och beroenden är avslagna. Uppgiften är att föreslå regler: beroenden (deps), längder (dur) och vid behov resurser och notBefore, så att planen när reglerna slås på hamnar så nära dagens datum som möjligt. Behåll fasta faser (type fixed) som de är. Lägg inte till eller ta bort faser. Förklara i summary vilka kedjor du byggt och var det skiljer.

` : ''}Planen (computed = framräknade datum just nu):
${JSON.stringify(planForAi())}

Användarens begäran: ${q}`;
}
function parseDeps(list) { return (list || []).map(x => typeof x === 'string' ? strToDeps(x)[0] : x).filter(d => d && d.id).map(d => ({ id: d.id, type: (d.type || 'FS').toUpperCase(), lag: +d.lag || 0 })); }
function applyAiOps(p, ops) {
  const done = [], bad = [];
  const tk = id => p.tasks.find(t => t.id === id);
  const nm = t => (t.film ? 'F' + t.film + ' ' : '') + t.name;
  (ops || []).forEach(o => {
    try {
      if (o.op === 'set') {
        const t = tk(o.id); if (!t) throw 'okänd fas ' + o.id; if (!AI_FIELDS.includes(o.field)) throw 'fält ' + o.field + ' kan inte ändras';
        const old = t[o.field];
        if (o.value === null || o.value === '' || o.value === false) delete t[o.field]; else t[o.field] = ['dur', 'hours', 'crew', 'film', 'minMargin'].includes(o.field) ? Number(o.value) : o.value;
        const show = v => { if (o.field === 'member') { for (const g of p.resources) { const m = g.members.find(x => x.id === v); if (m) return m.name; } } if (o.field === 'res') { const g = p.resources.find(x => x.id === v); if (g) return g.name; } if (o.field === 'row') { const rw = p.rows.find(x => x.id === v); if (rw) return rw.name; } if (['with', 'mustFinishBefore'].includes(o.field)) { const x = tk(v); if (x) return nm(x); } if (o.field === 'status' && STATUS[v]) return STATUS[v].l; return fmtVal(v); };
        done.push(`${nm(t)}: ${aiFieldName(o.field)} ${show(old)} → ${show(t[o.field])}${t.locked && ['start', 'end'].includes(o.field) ? ' (låst hållpunkt – ändras för att du bad om det)' : ''}`);
      } else if (o.op === 'deps') {
        const t = tk(o.id); if (!t) throw 'okänd fas ' + o.id; const d = parseDeps(o.deps);
        d.forEach(x => { if (!tk(x.id)) throw 'okänt beroende ' + x.id; });
        t.deps = d; done.push(`${nm(t)} väntar nu på: ${d.length ? depsToStr(d) : 'inget'}`);
      } else if (o.op === 'add') {
        const n = Object.assign({}, o.task || {}); if (!n.name) throw 'ny fas utan namn';
        n.id = uniqueId(p, n.id || n.name.toLowerCase().replace(/[^a-z0-9åäö]+/g, '_'));
        n.deps = parseDeps(n.deps); n.group = n.group || 'Förproduktion';
        if (n.row && !p.rows.some(r => r.id === n.row)) delete n.row;
        if (!n.row) n.row = ensureRow(p, baseName(n.name), n.group);
        if (n.type !== 'fixed' && !n.ms && !n.dur && !n.hours) n.dur = 5;
        if (n.type === 'milestone') n.ms = true;
        p.tasks.push(n); done.push(`Ny: ${nm(n)}`);
      } else if (o.op === 'remove') {
        const i = p.tasks.findIndex(t => t.id === o.id); if (i < 0) throw 'okänd fas ' + o.id;
        const t = p.tasks[i]; removeTasks(p, [t.id]); done.push(`Tar bort: ${nm(t)}`);
      } else if (o.op === 'addMember') {
        const g = p.resources.find(x => x.id === o.pool); if (!g) throw 'okänd resursgrupp ' + o.pool;
        const id = o.id && !g.members.some(m => m.id === o.id) ? o.id : g.id + '_' + (g.members.length + 1);
        g.members.push({ id, name: o.name || g.name + ' ' + (g.members.length + 1), blocks: [] }); done.push(`${g.name}: ny person ${o.name || id}`);
      } else if (o.op === 'addPool') {
        if (p.resources.some(x => x.id === o.id)) throw 'gruppen finns redan';
        p.resources.push({ id: o.id, name: o.name || o.id, blocks: [], members: (o.members || [{ id: o.id + '_1', name: o.name || o.id }]).map(m => ({ id: m.id, name: m.name, blocks: [] })) }); done.push(`Ny resursgrupp: ${o.name || o.id}`);
      } else if (o.op === 'addRow') {
        const id = o.id && !p.rows.some(r => r.id === o.id) ? o.id : null;
        if (id) { let idx = -1; p.rows.forEach((x, i) => { if (x.section === o.section) idx = i; }); p.rows.splice(idx + 1 || p.rows.length, 0, { id, section: o.section || 'Förproduktion', name: o.name || 'Ny rad' }); }
        else ensureRow(p, o.name, o.section || 'Förproduktion');
        done.push(`Ny rad: ${o.name}`);
      } else if (o.op === 'break') {
        p.settings.breaks = p.settings.breaks || [];
        const b = p.settings.breaks.find(x => x.name === o.name && String(x.from).slice(0, 4) === String(o.from).slice(0, 4));
        if (b) { b.from = o.from; b.to = o.to; b.on = o.on !== false; done.push(`${o.name}: ${fmtShort(o.from)}–${fmt(o.to)}${o.on === false ? ' (av)' : ''}`); }
        else { p.settings.breaks.push({ name: o.name || 'Uppehåll', from: o.from, to: o.to, on: o.on !== false }); done.push(`Nytt uppehåll: ${o.name} ${fmtShort(o.from)}–${fmt(o.to)}`); }
      } else throw 'okänd operation ' + o.op;
    } catch (e) { bad.push(String(e)); }
  });
  return { done, bad };
}
const aiFieldName = f => ({ name: 'namn', dur: 'arbetsdagar', hours: 'timmar', crew: 'personer', res: 'resurs', member: 'person', notBefore: 'tidigast start', start: 'start', end: 'slut', ignoreHol: 'jobbar röda dagar', ignoreBreaks: 'jobbar under uppehåll', status: 'status', note: 'kommentar', color: 'färg', row: 'rad', film: 'film', mustFinishBefore: 'klar före', minMargin: 'marginal', with: 'samma person som', group: 'avdelning', light: 'bakgrundsspår', cal: 'veckor' }[f] || f);
const fmtVal = v => v === undefined || v === null || v === '' ? '–' : v === true ? 'ja' : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmt(v) : String(v);
function renderAiPanel() {
  const p = $('#panel'); p.classList.add('wide');
  const st = aiState; const pv = st.preview;
  let body = '';
  if (st.busy) body = `<div class="ai-busy"><span class="spin" aria-hidden="true"></span> Tänker… det tar oftast 20–60 sekunder. <button class="btn small" type="button" data-act="aistop">Avbryt</button></div>`;
  else if (st.err) body = `<div class="alert">${esc(st.err)}</div>`;
  else if (st.result) {
    const r = st.result;
    body += `<div class="ai-sum">${esc(r.summary || '')}</div>`;
    if (r.question) body += `<div class="alert">${esc(r.question)}</div>`;
    if (pv && pv.done.length) {
      body += `<div class="field"><label>Ändringar</label><ul class="ai-ops">${pv.done.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      if (pv.bad.length) body += `<div class="alert">Hoppar över ${pv.bad.length}: ${esc(pv.bad.join('; '))}</div>`;
      if (pv.diff.length) body += `<div class="field"><label>Påverkan på nyckeldatum</label><div class="vwrap"><table class="vtab"><tr><th>Milstolpe</th><th>Nu</th><th>Efter</th></tr>${pv.diff.map(d => `<tr><td>${esc(d.label)}</td><td class="mono">${fmt(d.a)}</td><td class="mono">${fmt(d.b)} <span class="delta ${d.dd > 0 ? 'later' : 'earlier'}">${d.dd > 0 ? '+' : '−'}${Math.abs(d.dd)} d</span></td></tr>`).join('')}</table></div></div>`;
      else body += `<p class="foot">Inga milstolpar flyttas.</p>`;
      if (pv.moved && pv.moved.length) body += `<div class="field"><label>Faser som hamnar mer än en vecka från dagens datum (${pv.moved.length})</label><ul class="ai-ops">${pv.moved.slice(0, 10).map(x => `<li>${esc(label(x.t))}: ${x.dd > 0 ? '+' : '−'}${Math.abs(x.dd)} d</li>`).join('')}</ul></div>`;
      else if (aiState.rules) body += `<p class="foot">Alla faser hamnar inom en vecka från där de ligger nu.</p>`;
      if (pv.warnings.length) body += pv.warnings.slice(0, 4).map(w => `<div class="alert">${esc(w)}</div>`).join('');
      body += `<div class="quick"><button class="btn primary" type="button" data-act="aiapply">Genomför</button><button class="btn small" type="button" data-act="aivar">Spara som variant i stället</button><button class="btn small" type="button" data-act="aidrop">Släng förslaget</button></div>`;
    } else if (pv && pv.bad.length) body += `<div class="alert">Förslaget gick inte att använda: ${esc(pv.bad.join('; '))}</div>`;
  }
  p.innerHTML = `
    <header><div><div class="meta">Assistent</div><h2>Ändra planen med ord</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    ${st.rules ? `<div class="ai-sum"><b>Föreslå beroenden.</b> Assistenten läser hur planen ligger nu och föreslår beroenden och längder så att planen fortsätter se likadan ut när reglerna slås på. Du ser vilka faser som skulle flytta innan något ändras. Skriv gärna till sådant du vet, till exempel "ljudet ska alltid börja en vecka efter picture lock".</div> <button class="linkbtn" type="button" data-act="ainorules">Vanlig assistent i stället</button>` : ''}
    <p class="foot">Beskriv vad du vill ändra. Du får ett förslag med vad som påverkas, och inget ändras förrän du trycker Genomför. Det går att ångra efteråt.</p>
    <div class="field"><label for="aiQ">Vad vill du ändra?</label><textarea id="aiQ" rows="3" placeholder="t.ex. Lägg till en tredje mixare som tar F3. Eller: Flytta inspelningsstart en vecka och låt finklippet jobba igenom juli.">${esc(st.prompt)}</textarea>
      <div class="ai-ex">${['Lägg till en tredje ljudmixare som tar F3', 'Flytta inspelningsstart till 13 mars', 'Grade ska vara 10 dagar per film', 'Vad är flaskhalsen för F3:s leverans?'].map(x => `<button type="button" class="chip" data-act="aiex">${esc(x)}</button>`).join('')}</div>
      <div class="quick"><button class="btn primary" type="button" data-act="aiask" ${st.busy || !sampleFn ? 'disabled' : ''}>Föreslå ändring</button>${SR ? `<button class="btn small" type="button" data-act="aimic" ${st.busy ? 'disabled' : ''}>${micOn ? 'Lyssnar… tryck för att sluta' : 'Säg det'}</button>` : ''}</div></div>
    ${body}`;
  p.hidden = false;
}
async function aiAsk() {
  const q = ($('#aiQ').value || '').trim(); if (!q) { toast('Skriv vad du vill ändra.'); return; }
  aiState = { prompt: q, busy: true, ctl: new AbortController(), result: null, preview: null, err: '', rules: aiState.rules && FREE() }; renderAiPanel();
  try {
    const r = await sampleFn.json(aiPrompt(q), { signal: aiState.ctl.signal, cache: false });
    const work = normalize(clone(plan)); const before = keyDates(plan, result);
    const res = applyAiOps(work, r && r.ops);
    if (aiState.rules) { work.settings.free = false; work.tasks.forEach(t => { delete t.fs; delete t.fe; }); }
    const after = planSchedule(work); const ka = keyDates(work, after);
    const moved = aiState.rules ? plan.tasks.filter(t => !isMsT(t) && result.dates[t.id] && after.dates[t.id]).map(t => ({ t, dd: daysBetween(result.dates[t.id].start, after.dates[t.id].start) })).filter(x => Math.abs(x.dd) > 5).sort((a, b) => Math.abs(b.dd) - Math.abs(a.dd)) : [];
    const diff = Object.keys(before).map(id => ka[id] && ka[id].d !== before[id].d ? { label: before[id].label, a: before[id].d, b: ka[id].d, dd: daysBetween(before[id].d, ka[id].d) } : null).filter(Boolean);
    aiState.result = r || {}; aiState.preview = Object.assign(res, { plan: work, diff, moved, warnings: after.warnings.filter(w => !result.warnings.includes(w)) });
  } catch (e) {
    aiState.err = e && e.code === 'cancelled' ? '' : e && e.code === 'not_granted' ? 'Assistenten behöver ditt godkännande för att använda Claude. Försök igen och välj Tillåt.' : e && e.code === 'rate_limited' ? 'För många frågor just nu. Vänta en stund.' : e && e.code === 'invalid_json' ? 'Svaret gick inte att tolka. Formulera om och försök igen.' : 'Assistenten svarade inte: ' + ((e && (e.message || e.code)) || 'okänt fel');
  } finally { aiState.busy = false; if (panelMode === 'ai') renderAiPanel(); }
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let micOn = false, micRec = null;
function micToggle() {
  if (micOn && micRec) { micRec.stop(); return; }
  try {
    micRec = new SR(); micRec.lang = 'sv-SE'; micRec.interimResults = true; micRec.continuous = false;
    let said = '';
    micRec.onresult = e => { said = [...e.results].map(r => r[0].transcript).join(' '); const q = $('#aiQ'); if (q) q.value = said; };
    micRec.onerror = e => { micOn = false; renderAiPanel(); toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Mikrofonen är inte tillåten här. Använd dikteringen i tangentbordet i stället (Mac: tryck två gånger på fn).' : 'Hörde inget. Försök igen eller skriv.', 7000); };
    micRec.onend = () => { micOn = false; aiState.prompt = said || aiState.prompt; renderAiPanel(); if (said.trim()) aiAsk(); };
    micRec.start(); micOn = true; renderAiPanel();
  } catch (e) { micOn = false; toast('Mikrofonen går inte att starta här. Använd dikteringen i tangentbordet.', 6000); }
}
function onAiAction(act, b) {
  if (act === 'aimic') return micToggle();
  if (act === 'aiask') return aiAsk();
  if (act === 'ainorules') { aiState.rules = false; renderAiPanel(); return; }
  if (act === 'aistop') { if (aiState.ctl) aiState.ctl.abort(); return; }
  if (act === 'aiex') { $('#aiQ').value = b.textContent; $('#aiQ').focus(); return; }
  if (act === 'aidrop') { aiState.result = null; aiState.preview = null; renderAiPanel(); return; }
  const pv = aiState.preview; if (!pv) return;
  if (act === 'aiapply') { const before = milestoneSnapshot(); const wasRules = aiState.rules; aiState.rules = false; change(() => { plan = pv.plan; }); if (wasRules) renderControls(); toast(`Genomfört: ${pv.done.length} ändringar.${impact(before)} Ångra med ${mod}Z.`, 6000); aiState.result = null; aiState.preview = null; renderAiPanel(); }
  if (act === 'aivar') { variants.push({ name: (aiState.prompt || 'AI-förslag').slice(0, 60), saved: toS(new Date()), note: (aiState.result.summary || '').slice(0, 200), plan: clone(pv.plan) }); dirty = true; renderSource(); toast('Sparat som variant. Jämför under Varianter.'); aiState.result = null; aiState.preview = null; openPanel('var'); }
}

// ---- Klistra in från Excel / Tom's Planner ----
let impState = { text: '', section: 'Förproduktion', mode: 'own' };
function parseDateAny(s) {
  s = String(s).trim(); let m;
  if ((m = s.match(/^(\d{4})[ .\-/](\d{1,2})[ .\-/](\d{1,2})$/))) return mkDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[ .\-/](\d{1,2})[ .\-/](\d{2,4})$/))) return mkDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function mkDate(y, mo, d) { if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function datesIn(cell, bad) {
  const out = []; const re = /\d{4,6}[ .\-/]\d{1,2}[ .\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/g; let m;
  while ((m = re.exec(cell))) { const d = parseDateAny(m[0]); if (d) out.push(d); else if (bad) bad.push(m[0]); }
  return out;
}
function parseImport(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  const sep = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : ',';
  const rows = lines.map(l => l.split(sep).map(c => c.trim()));
  let head = null;
  if (rows.length && !rows[0].some(c => datesIn(c).length) && rows[0].some(c => /namn|name|fas|activity|aktivitet|start|slut|end|grupp|sektion/i.test(c))) head = rows.shift().map(c => c.toLowerCase());
  const col = re => head ? head.findIndex(h => re.test(h)) : -1;
  const ci = { name: col(/namn|name|fas|activity|aktivitet|task/), start: col(/start|från|from|begin/), end: col(/slut|till|end|to$/), sec: col(/grupp|sektion|section|group|avdelning/), row: col(/^rad|row|resurs|resource/) };
  const items = []; const skipped = [];
  rows.forEach((r, i) => {
    let ds = []; const bad = [];
    if (ci.start >= 0) { ds = datesIn(r[ci.start] || '', bad); if (ci.end >= 0) ds = ds.concat(datesIn(r[ci.end] || '', bad)); }
    if (!ds.length) r.forEach(c => { ds = ds.concat(datesIn(c, bad)); });
    const name = ci.name >= 0 ? r[ci.name] : r.find(c => c && !datesIn(c).length && !/^\d+([.,]\d+)?$/.test(c));
    if (!name) { skipped.push(i + 1); return; }
    if (!ds.length) { skipped.push(`${name} (inget datum)`); return; }
    ds.sort(); const start = ds[0], end = ds[ds.length - 1];
    items.push({ name, start, end, ms: start === end, section: ci.sec >= 0 && r[ci.sec] ? matchSection(r[ci.sec]) : matchSection(name), row: ci.row >= 0 ? r[ci.row] : '', bad });
  });
  return { items, skipped };
}
function matchSection(s) { const n = norm(s); return GROUP_ORDER.find(g => norm(g) === n) || ({ prepp: 'Förproduktion', 'pre-production': 'Förproduktion', preproduction: 'Förproduktion', shoot: 'Inspelning', 'post-production': 'Klipp', post: 'Klipp', edit: 'Klipp', sound: 'Ljud', music: 'Musik', vfx: 'Bild', grade: 'Bild', online: 'Bild', delivery: 'Leverans', 'script-writing': 'Utveckling', script: 'Utveckling' }[n]) || null; }
function renderImportPanel() {
  const p = $('#panel'); p.classList.add('wide');
  const keep = $('#impText'); if (keep) impState.text = keep.value;
  const r = parseImport(impState.text);
  p.innerHTML = `
    <header><div><div class="meta">Import</div><h2>Klistra in en plan</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">Kopiera rader från Excel, Google Sheets eller Tom's Planner och klistra in här. En rad per fas, med ett namn och ett eller två datum. Datum som 2026.08.31, 2026-08-31 och 31/8/2026 fungerar, också "2026.08.31 – 2026.11.30" i en och samma cell. Faserna läggs in med låsta datum, och du kan sedan koppla dem med regler.</p>
    <div class="field"><label for="impText">Klistra in här</label><textarea id="impText" rows="8" class="mono" placeholder="Namn&#9;Start&#9;Slut&#10;Shoot&#9;2026.08.31&#9;2026.11.30">${esc(impState.text)}</textarea></div>
    <div class="two"><div class="field"><label for="impSec">Lägg i sektion</label><select id="impSec">${GROUP_ORDER.map(g => `<option ${g === impState.section ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select><span class="hint">Om en kolumn heter Grupp eller Sektion används den i stället.</span></div>
      <div class="field"><label for="impMode">Rader</label><select id="impMode"><option value="own" ${impState.mode === 'own' ? 'selected' : ''}>En rad per namn</option><option value="one" ${impState.mode === 'one' ? 'selected' : ''}>Allt på en ny rad</option></select></div></div>
    ${r.items.length ? `<div class="field"><label>Förhandsgranskning: ${r.items.length} faser</label><div class="vwrap"><table class="vtab"><tr><th>Namn</th><th>Start</th><th>Slut</th><th>Sektion</th></tr>${r.items.slice(0, 40).map(it => `<tr><td>${esc(it.name)}${it.ms ? ' <span class="rs">milstolpe</span>' : ''}${it.bad.length ? ` <span class="delta later" title="Kunde inte läsa ${esc(it.bad.join(', '))}">kontrollera datum</span>` : ''}</td><td class="mono">${fmtShort(it.start)} ${String(it.start).slice(2, 4)}</td><td class="mono">${it.ms ? '' : fmtShort(it.end) + ' ' + String(it.end).slice(2, 4)}</td><td>${esc(it.section || impState.section)}</td></tr>`).join('')}</table></div>${r.items.length > 40 ? `<span class="hint">… och ${r.items.length - 40} till</span>` : ''}</div>` : ''}
    ${r.skipped.length ? `<div class="alert">Hoppar över ${r.skipped.length} rader utan namn eller giltigt datum: ${esc(r.skipped.slice(0, 6).join(', '))}${r.skipped.length > 6 ? ' …' : ''}</div>` : ''}
    <div><button class="btn primary" type="button" data-act="impgo" ${r.items.length ? '' : 'disabled'}>Lägg in ${r.items.length || ''} faser</button></div>`;
  p.hidden = false;
}
function doImport() {
  impState.text = $('#impText').value; const r = parseImport(impState.text); if (!r.items.length) return;
  const before = milestoneSnapshot();
  change(() => {
    let oneRow = null;
    r.items.forEach(it => {
      const sec = it.section || impState.section;
      const row = impState.mode === 'one' ? (oneRow = oneRow || newRow(plan, 'Importerat ' + fmtShort(toS(new Date())), sec)) : ensureRow(plan, it.row || it.name, sec);
      plan.tasks.push({ id: uniqueId(plan, 'imp_' + it.name.toLowerCase().replace(/[^a-z0-9åäö]+/g, '_').slice(0, 24)), name: it.name, group: sec, type: 'fixed', start: it.start, end: it.end, ms: it.ms || undefined, row });
    });
  });
  toast(`Lade in ${r.items.length} faser.${impact(before)}`, 5000); impState.text = ''; closePanel();
}

// ---- Sektioner (kategorier): lägg till, ta bort, byt namn, ordning och färg ----
function syncSections(p) {
  p = p || plan; if (!p) return;
  if (!Array.isArray(p.sections) || !p.sections.length) p.sections = DEFAULT_GROUPS.map(name => ({ name }));
  const have = new Set(p.sections.map(s => s.name));
  (p.rows || []).forEach(r => { if (r.section && !have.has(r.section)) { p.sections.push({ name: r.section }); have.add(r.section); } });
  (p.tasks || []).forEach(t => { if (t.group && !have.has(t.group)) { p.sections.push({ name: t.group }); have.add(t.group); } });
  GROUP_ORDER.splice(0, GROUP_ORDER.length, ...p.sections.map(s => s.name));
}
const colorCss = c => !c ? '' : c[0] === '#' ? c : c.startsWith('d:') ? `var(--d-${c.slice(2)})` : `var(--x-${c})`;
function sectionColor(g) {
  const s = plan && (plan.sections || []).find(x => x.name === g);
  if (s && s.color) return colorCss(s.color);
  return DEPT[g] ? `var(--d-${DEPT[g]})` : 'var(--d-ovr)';
}
function printColor(g) {
  const s = (plan.sections || []).find(x => x.name === g);
  if (s && s.color) { if (s.color[0] === '#') return s.color; if (s.color.startsWith('d:')) { const k = Object.keys(DEPT).find(n => DEPT[n] === s.color.slice(2)); return PRINT_DEPT[k] || '#6B7280'; } return PRINT_X[s.color] || '#6B7280'; }
  return PRINT_DEPT[g] || '#6B7280';
}
function renameSection(oldN, newN) {
  newN = String(newN || '').trim(); if (!newN || newN === oldN) return false;
  if (plan.sections.some(s => s.name === newN)) { toast(`Det finns redan en sektion som heter “${newN}”.`); return false; }
  change(() => {
    const sec = plan.sections.find(s => s.name === oldN); sec.name = newN;
    if (!sec.color && DEPT[oldN]) sec.color = 'd:' + DEPT[oldN]; // behåll färgen när namnet byts
    plan.rows.forEach(r => { if (r.section === oldN) r.section = newN; });
    plan.tasks.forEach(t => { if (t.group === oldN) t.group = newN; });
    templates.forEach(tp => (tp.tasks || []).forEach(o => { if (o.group === oldN) o.group = newN; if (o.rowSection === oldN) o.rowSection = newN; }));
    ui.collapsed = (ui.collapsed || []).map(k => k === oldN ? newN : k);
  });
  return true;
}
function addSection(name, afterName, color) {
  name = String(name || '').trim(); if (!name) { toast('Ge sektionen ett namn.'); return; }
  if (plan.sections.some(s => s.name === name)) { toast(`Det finns redan en sektion som heter “${name}”.`); return; }
  change(() => {
    const i = afterName === '__first' ? 0 : plan.sections.findIndex(s => s.name === afterName) + 1 || plan.sections.length;
    plan.sections.splice(i, 0, color ? { name, color } : { name });
    newRow(plan, name, name);
  });
  toast(`Sektionen “${name}” är tillagd med en tom rad. Rita faser på raden eller flytta dit befintliga.`, 5000);
}
function deleteSection(name, moveTo) {
  const nRows = plan.rows.filter(r => r.section === name).length, nTasks = plan.tasks.filter(t => t.group === name).length;
  if ((nRows || nTasks) && !moveTo) { toast('Välj vart sektionens rader och faser ska flyttas.'); return; }
  change(() => {
    plan.rows.forEach(r => { if (r.section === name) r.section = moveTo; });
    plan.tasks.forEach(t => { if (t.group === name) t.group = moveTo; });
    plan.sections = plan.sections.filter(s => s.name !== name);
  });
  toast(nRows || nTasks ? `Sektionen är borttagen. ${nRows} rader och ${nTasks} faser ligger nu under ${moveTo}.` : 'Sektionen är borttagen.', 5000);
}
function moveSection(name, dir) {
  const i = plan.sections.findIndex(s => s.name === name), j = i + dir; if (i < 0 || j < 0 || j >= plan.sections.length) return;
  change(() => { const [s] = plan.sections.splice(i, 1); plan.sections.splice(j, 0, s); });
}
function setSectionColor(name, color) { change(() => { const s = plan.sections.find(x => x.name === name); if (!s) return; if (color) s.color = color; else delete s.color; }); }
function renderSecPanel() {
  const p = $('#panel'); p.classList.add('wide');
  const secs = plan.sections;
  p.innerHTML = `
    <header><div><div class="meta">Struktur</div><h2>Sektioner</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">Sektionerna är planens kategorier, som Förproduktion och Ljud. Byt namn genom att skriva i fältet. Färgen gäller alla faser i sektionen som inte har en egen färg. Ordningen här är ordningen i planen.</p>
    <div class="seclist">${secs.map((s, i) => { const nR = plan.rows.filter(r => r.section === s.name).length, nT = plan.tasks.filter(t => t.group === s.name).length;
      return `<div class="secitem" data-sec="${esc(s.name)}">
        <div class="sechead"><i style="background:${sectionColor(s.name)}"></i><input data-f="secname" data-i="${i}" value="${esc(s.name)}" aria-label="Namn på sektionen">
          <span class="count">${nR} rader · ${nT} faser</span>
          <button class="xbtn" type="button" data-act="secup" data-i="${i}" ${i ? '' : 'disabled'} aria-label="Flytta upp">↑</button>
          <button class="xbtn" type="button" data-act="secdown" data-i="${i}" ${i < secs.length - 1 ? '' : 'disabled'} aria-label="Flytta ner">↓</button>
          <button class="xbtn" type="button" data-act="secdel" data-i="${i}" aria-label="Ta bort sektionen">×</button></div>
        <div class="secsw">${COLORS.map(([k, n]) => `<button type="button" class="sw${((s.color || '').startsWith('d:') ? '' : (s.color || '')) === k ? ' on' : ''}" data-act="seccolor" data-i="${i}" data-color="${k}" title="${k ? n : 'Standard'}" aria-label="${k ? n : 'Standardfärg'}" style="--c:${k ? `var(--x-${k})` : (DEPT[s.name] ? `var(--d-${DEPT[s.name]})` : s.color && s.color.startsWith('d:') ? colorCss(s.color) : 'var(--d-ovr)')}">${k ? '' : 'A'}</button>`).join('')}
          <label class="cpick" title="Egen färg"><input type="color" data-f="seccustom" data-i="${i}" value="${s.color && s.color[0] === '#' ? s.color : '#4F6185'}"> Egen</label></div>
        ${(nR || nT) ? `<div class="secdel" hidden><label>Flytta innehållet till <select data-f="secmove" data-i="${i}">${secs.filter(x => x.name !== s.name).map(x => `<option>${esc(x.name)}</option>`).join('')}</select></label> <button class="btn small danger" type="button" data-act="secdelok" data-i="${i}">Ta bort</button></div>` : ''}
      </div>`; }).join('')}</div>
    <div class="field"><label for="secNew">Ny sektion</label><div class="inline"><input id="secNew" placeholder="t.ex. Personal"><select id="secPos" aria-label="Placering"><option value="__first">Först</option>${secs.map((s, i) => `<option value="${esc(s.name)}" ${i === 1 ? 'selected' : ''}>Efter ${esc(s.name)}</option>`).join('')}</select><button class="btn small" type="button" data-act="secadd">Lägg till</button></div></div>`;
  p.hidden = false;
}
function onSecAction(act, b) {
  const i = +b.dataset.i; const s = plan.sections[i];
  if (act === 'secup') moveSection(s.name, -1);
  if (act === 'secdown') moveSection(s.name, 1);
  if (act === 'seccolor') setSectionColor(s.name, b.dataset.color || (s.color && s.color.startsWith('d:') && !DEPT[s.name] ? s.color : ''));
  if (act === 'secadd') addSection($('#secNew').value, $('#secPos').value);
  if (act === 'secdel') {
    const box = b.closest('.secitem').querySelector('.secdel');
    if (box) { box.hidden = !box.hidden; return; }
    deleteSection(s.name, null);
  }
  if (act === 'secdelok') deleteSection(s.name, b.closest('.secitem').querySelector('[data-f=secmove]').value);
}
function onSecChange(e) {
  const f = e.target.dataset.f; if (!f) return false; const i = +e.target.dataset.i; const s = plan.sections[i];
  if (f === 'secname') { if (!renameSection(s.name, e.target.value)) e.target.value = s.name; return true; }
  if (f === 'seccustom') { setSectionColor(s.name, e.target.value); return true; }
  return f === 'secmove';
}

// ---- Ljust / mörkt läge ----
let hostTheme;
function applyTheme(t) {
  const el = document.documentElement;
  if (hostTheme === undefined) hostTheme = el.getAttribute('data-theme');
  if (t === 'light' || t === 'dark') el.setAttribute('data-theme', t); else if (hostTheme) el.setAttribute('data-theme', hostTheme); else el.removeAttribute('data-theme');
  $$('#themeSel button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === (t || 'auto')));
}
function wireTheme() {
  const t = store('theme') || 'auto'; applyTheme(t);
  $('#themeSel').addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; store('theme', v); applyTheme(v); renderGantt(); });
}

// ---- Beroenden på/av (fritt läge) ----
function renderRulesCtl() { $$('#rulesSel button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === (FREE() ? 'off' : 'on'))); document.body.classList.toggle('free', FREE()); }
function rulesOff() {
  if (FREE()) return;
  change(() => { plan.tasks.forEach(t => { if (t.type === 'fixed') return; const d = result.dates[t.id]; if (d) { t.fs = d.start; t.fe = d.end; } }); plan.settings.free = true; });
  renderRulesCtl();
  toast('Beroenden är avslagna. Dra och ändra staplarna fritt – inget annat flyttar med. Beroenden och resurser ligger kvar vilande tills du slår på dem igen.', 7000);
}
function renderRulesPanel() {
  const p = $('#panel'); p.classList.remove('wide');
  p.innerHTML = `
    <header><div><div class="meta">Beroenden</div><h2>Slå på beroenden igen</h2></div><button class="btn small" data-act="close" type="button">Stäng</button></header>
    <p class="foot">Just nu ligger varje fas där du har lagt den. När beroenden slås på räknas datumen fram ur reglerna igen. Välj hur:</p>
    <div class="rchoice"><button class="btn primary" type="button" data-act="rules_ai" ${sampleFn ? '' : 'disabled'}>Låt assistenten föreslå beroenden</button>
      <span class="hint">Assistenten föreslår beroenden och längder utifrån hur planen ligger nu. Du ser vad som skulle flytta innan något ändras.${sampleFn ? '' : ' (Inte tillgänglig i den här vyn.)'}</span></div>
    <div class="rchoice"><button class="btn" type="button" data-act="rules_old">Använd de gamla beroendena</button>
      <span class="hint">Beroendena som fanns innan du slog av dem gäller igen. Faser du flyttat för hand kan hoppa tillbaka. Det går att ångra.</span></div>`;
  p.hidden = false;
}
function onRulesAction(act) {
  if (act === 'rules_old') { const before = milestoneSnapshot(); change(() => { plan.settings.free = false; plan.tasks.forEach(t => { delete t.fs; delete t.fe; }); }); renderRulesCtl(); closePanel(); toast(`Beroenden är på igen.${impact(before)} Ångra med ${mod}Z om det blev fel.`, 7000); }
  if (act === 'rules_ai') { aiState = { prompt: 'Föreslå beroenden och längder som håller planen där den ligger nu.', busy: false, ctl: null, result: null, preview: null, err: '', rules: true }; openPanel('ai'); }
}
function wireRules() {
  $('#rulesSel').addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; if (v === 'off') rulesOff(); else if (FREE()) openPanel('rules'); });
}

// ---- Start (KC) ----
variants = builtinVariants();
mcp = kcMcp; downloads = kcDownloads; whoName = 'KC';
if (KC.pf) view = 'pf'; else view = 'plan';
cur = { id: '', tag: KC.tag, name: KC.tag || 'Produktionsplan' };
wireTheme(); wireRules(); wire(); wirePortfolio(); wireExtras(); wireSave(); render(); setView(view);
function kcSaved(ok) { try { parent.postMessage({ kcPlan: ok ? 'saved' : 'unsaved', tag: cur.tag }, location.origin); } catch (e) {} }
(async () => {
  $('#btnAi').hidden = true;   // assistenten (claude.ai sample) finns inte i KC
  if (window.parent !== window) { $('#viewSel').hidden = true; document.body.classList.add('embedded'); if (KC.pf) document.body.classList.add('pfmode'); }   // KC:s rubrik och flikar gäller
  renderSource();
  if (!KC.sources.length) { toast('KC är inte kopplat till någon källa. Koppla källor i KC först.', 8000); return; }
  if (cur.tag) { dropSnap(); await loadFromSheet(false); }
  refreshPortfolio(false);
  renderProjSel(); if (view === 'pf') renderPortfolio();
  if (source.kind !== 'sheet') checkDraft();
  // Har någon annan sparat i arket? Kolla varje minut. Utan osparat här hämtas den nya versionen tyst.
  setInterval(async () => {
    if (document.hidden || saveBusy || !cur.tag || source.kind !== 'sheet') return;
    try {
      const r = await kcApi('planVersion', { tag: cur.tag });
      if (!r.version || !loadedVersion || r.version <= loadedVersion) return;
      if (!dirty) { dropSnap(); await loadFromSheet(false); }
      else { staleNote = 'Arket har ändrats av någon annan sedan du hämtade det. Spara inte över – hämta från Sheet först (dina ändringar finns kvar som utkast).'; renderSource(); }
    } catch (e) {}
  }, 60000);
})();
