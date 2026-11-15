/* KC – Produktionsplanens regelmotor (portad ur den tidigare planeringssidan, regelmotor v2).
   Rena funktioner: arbetsdagar, kalendrar mån–fre/mån–tors, svenska röda dagar, uppehåll,
   FS/SS/FF-beroenden med marginal, mjuka beroenden, låsta milstolpar, resurser som köar,
   timmar + bemanning, läsperioder, mottagare, delade faser. Datum är 'YYYY-MM-DD' i UTC.
   Används av planvyn (js/plan/app.js), översiktswidgeten (planTimelineHtml) och testerna. */
const DAY = 86400000;
function toD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function toS(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { return toS(new Date(toD(s).getTime() + n * DAY)); }
function dow(s) { return toD(s).getUTCDay(); } // 0=sön

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return toS(new Date(Date.UTC(y, month - 1, day)));
}
// Svenska röda dagar + de facto lediga (midsommar-, jul-, nyårsafton)
function swedishHolidays(y) {
  const e = easter(y);
  const h = {};
  const add = (s, n) => { h[s] = n; };
  add(`${y}-01-01`, 'Nyårsdagen'); add(`${y}-01-06`, 'Trettondedag jul');
  add(addDays(e, -2), 'Långfredagen'); add(addDays(e, 1), 'Annandag påsk');
  add(`${y}-05-01`, 'Första maj'); add(addDays(e, 39), 'Kristi himmelsfärd');
  add(`${y}-06-06`, 'Nationaldagen');
  for (let d = 19; d <= 25; d++) { const s = `${y}-06-${String(d).padStart(2, '0')}`; if (dow(s) === 5) add(s, 'Midsommarafton'); }
  add(`${y}-12-24`, 'Julafton'); add(`${y}-12-25`, 'Juldagen'); add(`${y}-12-26`, 'Annandag jul'); add(`${y}-12-31`, 'Nyårsafton');
  return h;
}
function holidayMap(years) { const m = {}; years.forEach(y => Object.assign(m, swedishHolidays(y))); return m; }

// Normalisera resurser: varje grupp får minst en person
function normResources(resources) {
  return (resources || []).map(r => {
    const members = (r.members && r.members.length) ? r.members : [{ id: r.id, name: r.name, blocks: r.blocks || [] }];
    return Object.assign({}, r, { members });
  });
}


// Kalendrar: w5 = mån–fre (post, kontor), s4 = mån–tors (inspelning). who = lista med person-ID
function makeCal(settings, resources) {
  const hol = settings.holidays ? holidayMap([2025, 2026, 2027, 2028, 2029, 2030, 2031]) : {};
  const blocked = {}; // personId -> Set(datum)
  const addBlock = (pid, b) => {
    if (!b || !b.on || !b.from || !b.to) return;
    let s = b.from; const set = blocked[pid] || (blocked[pid] = new Set()); let g = 0;
    while (s <= b.to && g++ < 3000) { set.add(s); s = addDays(s, 1); }
  };
  normResources(resources).forEach(r => r.members.forEach(m => {
    (r.blocks || []).forEach(b => addBlock(m.id, b));
    (m.blocks || []).forEach(b => addBlock(m.id, b));
  }));
  // globala uppehåll (sommar, jul/nyår …) gäller alla som inte jobbar igenom dem
  const brk = {};
  (settings.breaks || []).forEach(b => {
    if (!b || !b.on || !b.from || !b.to) return;
    let s = b.from, g = 0; while (s <= b.to && g++ < 3000) { if (!brk[s]) brk[s] = b.name || 'Uppehåll'; s = addDays(s, 1); }
  });
  // cal-nyckel: 'w5' eller 's4', med tillägg '|h' = jobbar på röda dagar, '|b' = jobbar under uppehåll och ledighet
  function isWork(s, cal, who) {
    const w = dow(s); const c = cal || 'w5';
    if (w === 0 || w === 6) return false;
    if (c.startsWith('s4') && w === 5) return false;
    const ignH = c.indexOf('|h') > 0, ignB = c.indexOf('|b') > 0;
    if (hol[s] && !ignH) return false;
    if (brk[s] && !ignB) return false;
    if (who && !ignB) for (const p of who) if (blocked[p] && blocked[p].has(s)) return false;
    return true;
  }
  function firstWork(s, cal, who) { let g = 0; while (!isWork(s, cal, who)) { s = addDays(s, 1); if (++g > 3000) break; } return s; }
  function nextWork(s, cal, who) { return firstWork(addDays(s, 1), cal, who); }
  function addWork(s, n, cal, who) { s = firstWork(s, cal, who); for (let i = 0; i < n; i++) s = nextWork(s, cal, who); return s; }
  function endOf(s, n, cal, who) { return n <= 1 ? firstWork(s, cal, who) : addWork(s, n - 1, cal, who); }
  return { hol, brk, blocked, isWork, firstWork, nextWork, addWork, endOf };
}

function hoursPerDay(cal) { return String(cal || '').startsWith('s4') ? 10 : 8; }
function calKey(t) { return (t.cal || 'w5') + (t.ignoreHol ? '|h' : '') + (t.ignoreBreaks ? '|b' : ''); }
function taskDur(t, pool) {
  const cal = calKey(t);
  if (t.hours) {
    const k = Math.max(1, Math.min(t.crew || 1, pool ? pool.members.length : (t.crew || 1)));
    return Math.max(1, Math.ceil(t.hours / (k * hoursPerDay(cal))));
  }
  return Math.max(1, t.dur || 1);
}

// Schemalägg: beroenden (FS/SS/FF + marginal i arbetsdagar) + personer som köar
function schedule(plan) {
  const resources = normResources(plan.resources);
  const C = makeCal(plan.settings, resources);
  const pools = {}; const memberPool = {}; const memberName = {};
  resources.forEach(r => { pools[r.id] = r; r.members.forEach(m => { memberPool[m.id] = r.id; memberName[m.id] = m.name; }); });
  const byId = {}; plan.tasks.forEach(t => byId[t.id] = t);
  const out = {}; const busy = {}; // personId -> [[start,end,taskId]]
  const warnings = [];
  const order = []; const state = {};
  function visit(t) {
    if (state[t.id] === 2) return; if (state[t.id] === 1) { warnings.push(`Cirkulärt beroende vid ${t.name}`); return; }
    state[t.id] = 1;
    (t.deps || []).forEach(d => byId[d.id] && visit(byId[d.id]));
    if (t.with && byId[t.with]) visit(byId[t.with]);
    state[t.id] = 2; order.push(t);
  }
  plan.tasks.forEach(visit);
  const overlaps = (pid, s, e) => (busy[pid] || []).find(([a, b]) => s <= b && e >= a);
  const reserve = (pid, s, e, id) => (busy[pid] = busy[pid] || []).push([s, e, id]);

  for (const t of order) {
    const cal = calKey(t);
    const pool = t.res ? pools[t.res] : null;
    if (t.res && !pool) warnings.push(`${t.name}: okänd resursgrupp “${t.res}”`);
    const crew = pool ? Math.max(1, Math.min(t.crew || 1, pool.members.length)) : 1;
    if (t.type === 'fixed') {
      const o = { start: t.start, end: t.end || t.start };
      if (pool) {
        const who = t.member && memberPool[t.member] === pool.id ? [t.member] : pool.members.slice(0, crew).map(m => m.id);
        who.forEach(p => reserve(p, o.start, o.end, t.id)); o.members = who;
      }
      out[t.id] = o; continue;
    }
    let earliest = plan.settings.projectStart;
    if (t.notBefore && t.notBefore > earliest) earliest = t.notBefore;
    let depEarliest = plan.settings.projectStart;
    let msDate = null;
    for (const d of (t.deps || [])) {
      const p = out[d.id]; if (!p) continue; const lag = d.lag || 0;
      let v;
      if (d.type === 'SS') v = C.addWork(p.start, lag, cal);
      else if (d.type === 'FF') { v = lag ? C.addWork(p.end, lag, cal) : p.end; msDate = msDate ? max(msDate, v) : v; continue; }
      else v = C.addWork(C.nextWork(p.end, cal), lag, cal);
      depEarliest = max(depEarliest, v);
    }
    earliest = max(earliest, depEarliest);
    if (t.type === 'milestone') {
      const onlyFF = (t.deps || []).length && (t.deps || []).every(x => x.type === 'FF');
      const d = onlyFF && msDate ? msDate : (msDate ? max(msDate, earliest) : C.firstWork(earliest, cal));
      out[t.id] = { start: d, end: d }; continue;
    }
    const dur = taskDur(t, pool);
    if (!pool) {
      const start = C.firstWork(earliest, cal); out[t.id] = { start, end: C.endOf(start, dur, cal), dur, depStart: C.firstWork(depEarliest, cal), cal };
    } else {
      // vilka personer kan komma i fråga?
      let fixedWho = null;
      if (t.member && memberPool[t.member] === pool.id) fixedWho = [t.member];
      else if (t.with && out[t.with] && out[t.with].members) { const w = out[t.with].members.filter(p => memberPool[p] === pool.id); if (w.length) fixedWho = w.slice(0, crew); }
      if (t.member && memberPool[t.member] !== pool.id) warnings.push(`${t.name}: personen hör inte till ${pool.name}`);
      const cands = fixedWho || pool.members.map(m => m.id);
      const need = fixedWho ? fixedWho.length : crew;
      let start = C.firstWork(earliest, cal); let chosen = null, end = null; let guard = 0;
      while (guard++ < 400) {
        const free = []; let nextTry = null;
        for (const p of cands) {
          const s = C.firstWork(start, cal, [p]);
          if (s !== start) { nextTry = nextTry ? (s < nextTry ? s : nextTry) : s; continue; }
          const e = C.endOf(start, dur, cal, [p]);
          const hit = overlaps(p, start, e);
          if (!hit) free.push(p); else { const n = C.nextWork(hit[1], cal); nextTry = nextTry ? (n < nextTry ? n : nextTry) : n; }
        }
        if (free.length >= need) {
          chosen = free.slice(0, need); end = C.endOf(start, dur, cal, chosen);
          if (chosen.every(p => !overlaps(p, start, end))) break;
          start = C.nextWork(start, cal); chosen = null; continue;
        }
        start = nextTry && nextTry > start ? C.firstWork(nextTry, cal) : C.nextWork(start, cal);
      }
      if (!chosen) { chosen = cands.slice(0, need); end = C.endOf(start, dur, cal, chosen); warnings.push(`${t.name}: hittade ingen ledig person`); }
      chosen.forEach(p => reserve(p, start, end, t.id));
      const base = C.firstWork(earliest, cal);
      const waited = start > base ? workdaysBetween(C, base, start, cal) : 0;
      out[t.id] = { start, end, dur, members: chosen, depStart: C.firstWork(depEarliest, cal), cal };
      if (waited) out[t.id].waited = waited;
    }
    if (t.deadline && out[t.id].end > t.deadline) warnings.push(`${t.name} slutar ${out[t.id].end}, efter deadline ${t.deadline}`);
  }
  plan.tasks.forEach(t => {
    if (t.mustFinishBefore && out[t.id] && out[t.mustFinishBefore]) {
      const gap = workdaysBetween(C, out[t.id].end, out[t.mustFinishBefore].start, 'w5') - 1;
      out[t.id].margin = gap;
      if (gap < (t.minMargin || 0)) warnings.push(`${t.film ? 'F' + t.film + ' ' : ''}${t.name} klar ${out[t.id].end} – bara ${Math.max(gap, 0)} arbetsdagars marginal till ${byId[t.mustFinishBefore].name} (krav ${t.minMargin || 0})`);
    }
  });
  // Låsta hållpunkter och mjuka beroenden: flyttar aldrig något, mäter bara marginalen.
  const flags = [];
  const needOf = (t, d) => { const p = out[d.id]; if (!p) return null; const cal = calKey(t); const lag = d.lag || 0;
    if (d.type === 'SS') return C.addWork(p.start, lag, cal);
    if (d.type === 'FF') return lag ? C.addWork(p.end, lag, cal) : p.end;
    return C.addWork(C.nextWork(p.end, cal), lag, cal); };
  plan.tasks.forEach(t => {
    const r = out[t.id]; if (!r) return;
    const list = t.locked ? (t.deps || []).concat(t.soft || []) : (t.soft || []);
    if (!list.length) return;
    let worst = null, by = null;
    list.forEach(d => { const v = needOf(t, d); if (v && (!worst || v > worst)) { worst = v; by = d.id; } });
    if (!worst) return;
    const slack = worst > r.start ? -workdaysBetween(C, r.start, worst, 'w5') : workdaysBetween(C, worst, r.start, 'w5');
    if (t.locked) {
      const lim = t.minMargin || LOCK_MARGIN;
      r.slack = slack; r.slackBy = by; r.slackLim = lim;
      const level = slack < 0 ? 'bad' : slack < lim ? 'warn' : '';
      if (level) { r.lock = level; flags.push({ kind: 'lock', id: t.id, level, slack, by, worst, lim }); }
    } else if (slack < 0) {
      r.lock = 'warn'; flags.push({ kind: 'soft', id: t.id, level: 'warn', slack, by, worst });
    }
  });
  return { dates: out, warnings, flags, cal: C, memberName, memberPool, pools };
}
const LOCK_MARGIN = 10; // arbetsdagar – standardgräns för gul varning på låsta hållpunkter
function max(a, b) { return a > b ? a : b; }
function workdaysBetween(C, a, b, cal) { let n = 0, s = a; if (b <= a) return 0; let g = 0; while (s < b && g++ < 5000) { s = addDays(s, 1); if (C.isWork(s, cal)) n++; } return n; }



// Översättning mellan plan-objektet och Google Sheet-rader (v2)
const FASER_HEAD = ['ID', 'Grupp', 'Film', 'Namn', 'Typ', 'Arbetsdagar', 'Kalender', 'Resurs', 'Beroenden', 'Fast start', 'Fast slut', 'Klar före (ID)', 'Min marginal (d)', 'Stil', 'Beräknad start', 'Beräknat slut', 'Anteckning', 'Person', 'Samma person som', 'Tidigast start', 'Timmar', 'Bemanning', 'Tilldelad', 'Färg', 'Del av', 'Rad', 'Jobbar röda dagar', 'Jobbar under uppehåll', 'Status', 'Fri start', 'Fritt slut', 'Mjuka beroenden', 'Mottagare', 'Levereras kl', 'Feedback senast kl', 'Utförare', 'Ansvarig'];
const parseDoers = v => String(v || '').split(/[,;]/).map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^(.+?)\s+(\d{1,3})\s*%?$/); return m ? { id: m[1].trim(), pct: Math.max(1, Math.min(100, +m[2])) } : { id: x, pct: 100 }; });
const doersToStr = ds => (ds || []).map(d => d.pct && d.pct !== 100 ? `${d.id} ${d.pct}%` : d.id).join(', ');
const MOT_HEAD = ['Mottagare-ID', 'Namn', 'Typ', 'Aktiv'];
const DEFAULT_RECIPIENTS = [{ id: 'kanal', name: 'Kanalen', kind: 'Kanal', on: true }];
const ROW_HEAD = ['Rad-ID', 'Sektion', 'Namn', 'Fet', 'Färg', 'Indrag'];
const CAL_HEAD = ['Uppehåll', 'Från', 'Till', 'Aktiv'];
const MALL_HEAD = ['Mall', 'Mall-ID', 'Grupp', 'Namn', 'Typ', 'Arbetsdagar', 'Timmar', 'Bemanning', 'Kalender', 'Resurs', 'Beroenden', 'Samma person som', 'Klar före (ID)', 'Min marginal (d)', 'Stil', 'Färg', 'Anteckning', 'Koppling', 'Rad', 'Rad-sektion', 'Jobbar röda dagar', 'Jobbar under uppehåll', 'Mjuka beroenden'];
const RES_HEAD = ['Grupp-ID', 'Resursgrupp', 'Person-ID', 'Person', 'Ledighet', 'Från', 'Till', 'Aktiv'];
const SET_HEAD = ['Inställning', 'Värde'];

function depsToStr(deps) {
  return (deps || []).map(d => `${d.id} ${d.type || 'FS'}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`).join(', ');
}
function strToDeps(s) {
  if (!s) return [];
  return String(s).split(/[,;]/).map(x => x.trim()).filter(Boolean).map(x => {
    const m = x.match(/^(\S+)\s*(FS|SS|FF)?\s*([+-]\s*\d+)?$/i);
    if (!m) return null;
    return { id: m[1], type: (m[2] || 'FS').toUpperCase(), lag: m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0 };
  }).filter(Boolean);
}
const STATUS_LABEL = { klar: 'Klar', pagar: 'Pågår', risk: 'Risk', beslut: 'Väntar på beslut', bokad: 'Bokad' };
const statusKey = v => { v = String(v || '').trim().toLowerCase(); if (!v) return ''; for (const k in STATUS_LABEL) if (k === v || STATUS_LABEL[k].toLowerCase() === v) return k; return ''; };
const TYP_OUT = t => t.read ? 'läsperiod' : t.type === 'fixed' ? (t.locked ? (t.ms ? 'låst milstolpe' : 'låst') : (t.ms ? 'milstolpe' : 'fast')) : t.type === 'milestone' ? 'milstolpe' : 'fas';

function planToRows(plan, sched) {
  const dates = sched ? sched.dates : null; const names = sched ? sched.memberName : {};
  const faser = [FASER_HEAD].concat(plan.tasks.map(t => {
    const r = dates && dates[t.id];
    return [
      t.id, t.group || '', t.film ? `F${t.film}` : '', t.name, TYP_OUT(t), t.hours ? (r && r.dur) || '' : (t.dur || ''), t.cal === 's4' ? 'mån–tors' : 'mån–fre',
      t.res || '', depsToStr(t.deps), t.type === 'fixed' ? t.start : '', t.type === 'fixed' ? t.end : '',
      t.mustFinishBefore || '', t.minMargin || '', t.light ? 'bakgrund' : '',
      r ? r.start : '', r ? r.end : '', t.note || '',
      t.member || '', t.with || '', t.notBefore || '', t.hours || '', t.crew && t.crew > 1 ? t.crew : '',
      r && r.members ? r.members.map(m => names[m] || m).join(', ') : '',
      t.color || '', t.splitOf || '', t.row || '', t.ignoreHol ? 'ja' : '', t.ignoreBreaks ? 'ja' : '',
      t.status ? (STATUS_LABEL[t.status] || t.status) : '', t.fs || '', t.fe || '', depsToStr(t.soft), (t.to || []).join(', '), t.read ? (t.dlvAt || '') : '', t.read ? (t.fbAt || '') : '', doersToStr(t.doers), t.owner || '',
    ];
  }));
  const res = [RES_HEAD];
  plan.resources.forEach(g => {
    (g.blocks || []).forEach(b => res.push([g.id, g.name, '', '(alla)', b.name || '', b.from, b.to, b.on ? 'ja' : 'nej']));
    (g.members || []).forEach(m => {
      const bl = m.blocks || [];
      if (!bl.length) res.push([g.id, g.name, m.id, m.name, '', '', '', '']);
      else bl.forEach(b => res.push([g.id, g.name, m.id, m.name, b.name || '', b.from, b.to, b.on ? 'ja' : 'nej']));
    });
  });
  const rader = [ROW_HEAD].concat((plan.rows || []).map(r => [r.id, r.section || '', r.name, r.bold ? 'ja' : '', r.fill || '', r.indent || '']));
  const kal = [CAL_HEAD].concat(((plan.settings || {}).breaks || []).map(b => [b.name || '', b.from, b.to, b.on ? 'ja' : 'nej']));
  const set = [SET_HEAD, ['Projekt', plan.meta.title], ['Bolag', plan.meta.company || ''], ['Röda dagar räknas bort', plan.settings.holidays ? 'ja' : 'nej'], ['Planstart', plan.settings.projectStart], ['Senast uppdaterad', plan.meta.updated || ''], ['Formatversion', '5']];
  if (plan.settings.calSync && Object.keys(plan.settings.calSync).length) set.push(['Kalenderexport', JSON.stringify(plan.settings.calSync)]);
  if (plan.sections && plan.sections.length) set.push(['Sektioner', JSON.stringify(plan.sections)]);
  set.push(['Beroenden', plan.settings.free ? 'av' : 'på']);
  const mot = [MOT_HEAD].concat((plan.recipients || []).map(x => [x.id, x.name, x.kind || '', x.on === false ? 'nej' : 'ja']));
  return { faser, res, set, rader, kal, mot };
}

const num = v => (/^\d{4}-\d{2}-\d{2}/.test(v) ? NaN : parseFloat(String(v).replace(',', '.')));
function cell(row, i) { if (i < 0) return ''; const v = row[i]; return v === undefined || v === null ? '' : String(v).trim(); }
function normDate(v) {
  v = String(v || '').trim(); if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return v;
}
const isYes = v => /^(ja|yes|true|1|x)$/i.test(v);
function rowsToPlan(faser, res, set, rader, kal, mot) {
  const head = faser[0].map(String);
  const ix = name => head.indexOf(name);
  const tasks = faser.slice(1).filter(r => cell(r, ix('ID'))).map(r => {
    const typ = cell(r, ix('Typ')).toLowerCase();
    const fs = normDate(cell(r, ix('Fast start'))), fe = normDate(cell(r, ix('Fast slut')));
    const film = cell(r, ix('Film')).replace(/\D/g, '');
    const t = { id: cell(r, ix('ID')), group: cell(r, ix('Grupp')), name: cell(r, ix('Namn')), deps: strToDeps(cell(r, ix('Beroenden'))) };
    if (film) t.film = Number(film);
    if (fs) { t.type = 'fixed'; t.start = fs; t.end = fe || fs; if (/milstolpe/.test(typ)) { t.ms = true; t.end = fs; } if (/låst|last/.test(typ)) t.locked = true; }
    else if (/milstolpe/.test(typ)) { t.type = 'milestone'; t.ms = true; }
    const sdp = strToDeps(cell(r, ix('Mjuka beroenden'))); if (sdp.length) t.soft = sdp;
    if (/läs/.test(typ)) { t.read = true; if (t.ms && !fs) { delete t.ms; delete t.type; } }
    const to = cell(r, ix('Mottagare')).split(/[,;]/).map(x => x.trim()).filter(Boolean); if (to.length) t.to = to;
    const dl = cell(r, ix('Levereras kl')); if (dl) t.dlvAt = dl;
    const fb = cell(r, ix('Feedback senast kl')); if (fb) t.fbAt = fb;
    const dz = parseDoers(cell(r, ix('Utförare'))); if (dz.length) t.doers = dz;
    const ow = cell(r, ix('Ansvarig')); if (ow) t.owner = ow;
    const hours = num(cell(r, ix('Timmar')));
    if (hours > 0) t.hours = hours;
    else { const dur = Math.round(num(cell(r, ix('Arbetsdagar')))); if (dur) t.dur = dur; }
    const crew = Math.round(num(cell(r, ix('Bemanning')))); if (crew > 1) t.crew = crew;
    if (/tors/.test(cell(r, ix('Kalender')))) t.cal = 's4';
    const resId = cell(r, ix('Resurs')); if (resId) t.res = resId;
    const mem = cell(r, ix('Person')); if (mem) t.member = mem;
    const w = cell(r, ix('Samma person som')); if (w) t.with = w;
    const nb = normDate(cell(r, ix('Tidigast start'))); if (nb) t.notBefore = nb;
    const mb = cell(r, ix('Klar före (ID)')); if (mb) t.mustFinishBefore = mb;
    const mm = Math.round(num(cell(r, ix('Min marginal (d)')))); if (mm) t.minMargin = mm;
    if (/bakgrund/.test(cell(r, ix('Stil')))) t.light = true;
    const note = cell(r, ix('Anteckning')); if (note) t.note = note;
    const stv = statusKey(cell(r, ix('Status'))); if (stv) t.status = stv;
    const fsv = normDate(cell(r, ix('Fri start'))); if (/^\d{4}-/.test(fsv)) { t.fs = fsv; const fev = normDate(cell(r, ix('Fritt slut'))); t.fe = /^\d{4}-/.test(fev) ? fev : fsv; }
    const col = cell(r, ix('Färg')); if (col) t.color = col;
    const so = cell(r, ix('Del av')); if (so) t.splitOf = so;
    const rw = cell(r, ix('Rad')); if (rw) t.row = rw;
    if (isYes(cell(r, ix('Jobbar röda dagar')))) t.ignoreHol = true;
    if (isYes(cell(r, ix('Jobbar under uppehåll')))) t.ignoreBreaks = true;
    return t;
  });
  const resources = []; const byId = {};
  const rh = (res && res[0] || []).map(String);
  if (rh.includes('Grupp-ID')) {
    const ri = n => rh.indexOf(n);
    res.slice(1).forEach(r => {
      const gid = cell(r, ri('Grupp-ID')); if (!gid) return;
      let g = byId[gid]; if (!g) { g = byId[gid] = { id: gid, name: cell(r, ri('Resursgrupp')) || gid, blocks: [], members: [] }; resources.push(g); }
      const pid = cell(r, ri('Person-ID'));
      const from = normDate(cell(r, ri('Från'))), to = normDate(cell(r, ri('Till')));
      const block = from && to ? { name: cell(r, ri('Ledighet')), from, to, on: isYes(cell(r, ri('Aktiv'))) } : null;
      if (!pid) { if (block) g.blocks.push(block); return; }
      let m = g.members.find(x => x.id === pid); if (!m) { m = { id: pid, name: cell(r, ri('Person')) || pid, blocks: [] }; g.members.push(m); }
      if (block) m.blocks.push(block);
    });
  } else { // format v1: en rad per resurs
    (res || []).slice(1).forEach(r => {
      const id = cell(r, 0); if (!id) return;
      let o = byId[id]; if (!o) { o = byId[id] = { id, name: cell(r, 1) || id, blocks: [], members: [{ id, name: cell(r, 1) || id, blocks: [] }] }; resources.push(o); }
      const from = normDate(cell(r, 3)), to = normDate(cell(r, 4));
      if (from && to) o.members[0].blocks.push({ name: cell(r, 2), from, to, on: isYes(cell(r, 5)) });
    });
  }
  resources.forEach(g => { if (!g.members.length) g.members.push({ id: g.id + '_1', name: g.name, blocks: [] }); });
  const s = {}; (set || []).slice(1).forEach(r => { s[cell(r, 0)] = cell(r, 1); });
  const rdh = ((rader || [])[0] || []).map(x => String(x).trim()); const rx = n => rdh.indexOf(n);
  const rows = (rader || []).slice(1).filter(r => cell(r, 0)).map(r => { const o = { id: cell(r, 0), section: cell(r, 1) || 'Övrigt', name: cell(r, 2) || cell(r, 0) };
    if (isYes(cell(r, rx('Fet')))) o.bold = true; const fc = cell(r, rx('Färg')); if (fc) o.fill = fc; const ind = parseInt(cell(r, rx('Indrag')), 10); if (ind > 0) o.indent = Math.min(3, ind); return o; });
  const breaks = (kal || []).slice(1).filter(r => normDate(cell(r, 1)) && normDate(cell(r, 2))).map(r => ({ name: cell(r, 0) || 'Uppehåll', from: normDate(cell(r, 1)), to: normDate(cell(r, 2)), on: !/^nej$/i.test(cell(r, 3) || 'ja') }));
  return {
    meta: { title: s['Projekt'] || 'Produktionsplan', company: s['Bolag'] || '', updated: s['Senast uppdaterad'] || '' },
    settings: { projectStart: normDate(s['Planstart']) || '2027-01-01', holidays: !/^nej$/i.test(s['Röda dagar räknas bort'] || 'ja'), breaks, free: /^av$/i.test(s['Beroenden'] || ''), calSync: (() => { try { return JSON.parse(s['Kalenderexport'] || '{}'); } catch (e) { return {}; } })() },
    resources, rows, tasks,
    recipients: (() => { const out = (mot || []).slice(1).filter(r => cell(r, 0)).map(r => ({ id: cell(r, 0), name: cell(r, 1) || cell(r, 0), kind: cell(r, 2), on: !/^nej$/i.test(cell(r, 3)) })); return out.length ? out : DEFAULT_RECIPIENTS.map(x => Object.assign({}, x)); })(),
    sections: (() => { try { const x = JSON.parse(s['Sektioner'] || 'null'); return Array.isArray(x) ? x.filter(o => o && o.name).map(o => o.color ? { name: String(o.name), color: String(o.color) } : { name: String(o.name) }) : undefined; } catch (e) { return undefined; } })(),
  };
}
function templatesToRows(templates) {
  const rows = [MALL_HEAD];
  (templates || []).forEach(tp => tp.tasks.forEach((o, i) => rows.push([
    tp.name, o.lid, o.group || '', o.name, o.ms ? 'milstolpe' : 'fas', o.ms || o.hours ? '' : (o.dur || 1), o.hours || '', o.crew > 1 ? o.crew : '',
    o.cal === 's4' ? 'mån–tors' : 'mån–fre', o.res || '', depsToStr(o.deps), o.with || '', o.mustFinishBefore || '', o.minMargin || '', o.light ? 'bakgrund' : '', o.color || '', o.note || '', i === 0 ? (tp.anchor || '') : '', o.rowName || '', o.rowSection || '', o.ignoreHol ? 'ja' : '', o.ignoreBreaks ? 'ja' : '', depsToStr(o.soft),
  ])));
  return rows;
}
function rowsToTemplates(rows) {
  if (!rows || !rows.length) return [];
  const h = rows[0].map(String); const ix = n => h.indexOf(n);
  const out = []; const by = {};
  rows.slice(1).forEach(r => {
    const name = cell(r, ix('Mall')), lid = cell(r, ix('Mall-ID')); if (!name || !lid) return;
    let tp = by[name]; if (!tp) { tp = by[name] = { name, tasks: [] }; out.push(tp); }
    const anc = cell(r, ix('Koppling')); if (anc) tp.anchor = anc;
    const o = { lid, group: cell(r, ix('Grupp')), name: cell(r, ix('Namn')), deps: strToDeps(cell(r, ix('Beroenden'))) };
    const osd = strToDeps(cell(r, ix('Mjuka beroenden'))); if (osd.length) o.soft = osd;
    if (/milstolpe/i.test(cell(r, ix('Typ')))) o.ms = true;
    const hrs = num(cell(r, ix('Timmar'))); if (hrs > 0) o.hours = hrs;
    const dur = Math.round(num(cell(r, ix('Arbetsdagar')))); if (!o.ms && !o.hours) o.dur = dur > 0 ? dur : 1;
    const crew = Math.round(num(cell(r, ix('Bemanning')))); if (crew > 1) o.crew = crew;
    if (/tors/.test(cell(r, ix('Kalender')))) o.cal = 's4';
    const map = { res: 'Resurs', with: 'Samma person som', mustFinishBefore: 'Klar före (ID)', color: 'Färg', note: 'Anteckning' };
    for (const k in map) { const v = cell(r, ix(map[k])); if (v) o[k] = v; }
    const mm = Math.round(num(cell(r, ix('Min marginal (d)')))); if (mm > 0) o.minMargin = mm;
    if (/bakgrund/.test(cell(r, ix('Stil')))) o.light = true;
    const rn = cell(r, ix('Rad')); if (rn) { o.rowName = rn; o.rowSection = cell(r, ix('Rad-sektion')) || o.group; }
    if (isYes(cell(r, ix('Jobbar röda dagar')))) o.ignoreHol = true;
    if (isYes(cell(r, ix('Jobbar under uppehåll')))) o.ignoreBreaks = true;
    tp.tasks.push(o);
  });
  return out;
}




// Redigeringsoperationer på planen (rena funktioner, testbara i node)
function opsClone(o) { return JSON.parse(JSON.stringify(o)); }
function uniqueId(plan, base, taken) {
  base = String(base || 'fas').replace(/\s+/g, '_');
  const has = id => plan.tasks.some(t => t.id === id) || (taken && taken.has(id));
  if (!has(base)) return base;
  let n = 2; while (has(base + '_' + n)) n++; return base + '_' + n;
}
const baseName = n => String(n || '').replace(/ \((del \d+|kopia)\)$/, '');

// Dela en fas vid ett datum. Den nya första delen får fasens beroenden; originalets ID blir sista delen,
// så allt som hänger på fasen fortsätter att vänta på hela arbetet.
function splitTask(plan, sched, id, at) {
  const t = plan.tasks.find(x => x.id === id); if (!t) return { error: 'Fasen finns inte' };
  const r = sched.dates[id]; if (!r) return { error: 'Fasen är inte beräknad' };
  if (t.type === 'milestone' || t.ms) return { error: 'En milstolpe kan inte delas' };
  if (at <= r.start || at > r.end) return { error: 'Välj ett datum inne i stapeln' };
  const root = t.splitOf || t.id;
  const first = opsClone(t);
  first.id = uniqueId(plan, root + '_del');
  first.splitOf = root;
  if (t.type === 'fixed') {
    first.end = addDays(at, -1); t.start = at;
    delete first.mustFinishBefore;
  } else {
    const cal = sched.cal; const c = calKey(t);
    let k = 0; for (let s = r.start; s < at; s = addDays(s, 1)) if (cal.isWork(s, c)) k++;
    const total = r.dur || t.dur || 1;
    if (k < 1 || k >= total) return { error: 'Det blir ingen arbetsdag kvar i en av delarna' };
    first.dur = k; delete first.hours; delete first.crew;
    if (t.hours) { first.hours = Math.round(t.hours * k / total); first.crew = t.crew; delete first.dur; t.hours = t.hours - first.hours; }
    else t.dur = total - k;
    delete first.mustFinishBefore; delete first.minMargin;
    t.deps = [{ id: first.id, type: 'FS', lag: 0 }];
    delete t.notBefore;
    if (t.res && !t.member) t.with = first.id;
  }
  t.splitOf = root;
  // Allt som hänger på fasen (FS, SS och FF) fortsätter att hänga på sista delen, som behåller fasens ID.
  plan.tasks.splice(plan.tasks.indexOf(t), 0, first);
  return { first: first.id, last: t.id };
}
// Numrera delar (del 1, del 2 …) efter startdatum
function renumberParts(plan, sched) {
  const groups = {};
  plan.tasks.forEach(t => { if (t.splitOf) (groups[t.splitOf] = groups[t.splitOf] || []).push(t); });
  Object.values(groups).forEach(list => {
    if (list.length < 2) { list.forEach(t => { t.name = baseName(t.name); delete t.splitOf; }); return; }
    list.sort((a, b) => ((sched.dates[a.id] || {}).start || '') < ((sched.dates[b.id] || {}).start || '') ? -1 : 1)
      .forEach((t, i) => { t.name = `${baseName(t.name)} (del ${i + 1})`; });
  });
}

// Duplicera faser. Beroenden inom urvalet pekar om till kopiorna; beroenden utanför behålls.
function duplicateTasks(plan, ids, opts) {
  opts = opts || {};
  const src = plan.tasks.filter(t => ids.includes(t.id)); if (!src.length) return [];
  const map = {}; const taken = new Set();
  src.forEach(t => { const nid = uniqueId(plan, t.id + (opts.suffix || '_k'), taken); taken.add(nid); map[t.id] = nid; });
  const copies = src.map(t => {
    const c = opsClone(t); c.id = map[t.id];
    if (!opts.keepName) c.name = baseName(t.name) + ' (kopia)';
    c.deps = (c.deps || []).map(d => Object.assign({}, d, { id: map[d.id] || d.id }));
    if (c.with) c.with = map[c.with] || c.with;
    if (c.mustFinishBefore) c.mustFinishBefore = map[c.mustFinishBefore] || c.mustFinishBefore;
    if (c.splitOf) c.splitOf = map[c.splitOf] || (c.splitOf + '_k');
    if (opts.film !== undefined) { if (opts.film) c.film = opts.film; else delete c.film; }
    return c;
  });
  const lastIdx = Math.max(...src.map(t => plan.tasks.indexOf(t)));
  plan.tasks.splice(lastIdx + 1, 0, ...copies);
  return copies.map(c => c.id);
}

// Mall av markerade faser: relativ struktur utan datum, film och personer
function templateFromTasks(plan, sched, ids, name) {
  const src = plan.tasks.filter(t => ids.includes(t.id)); if (!src.length) return null;
  const lid = {}; const used = new Set();
  src.forEach(t => {
    let l = t.film ? t.id.replace(String(t.film), '') : t.id;
    l = l.replace(/^_+|_+$/g, '') || 'fas';
    let x = l, n = 2; while (used.has(x)) x = l + n++; used.add(x); lid[t.id] = x;
  });
  const tasks = src.map(t => {
    const r = sched.dates[t.id] || {};
    const o = { lid: lid[t.id], group: t.group, name: baseName(t.name) };
    if (t.type === 'milestone' || t.ms) o.ms = true;
    if (!o.ms) {
      if (t.hours) { o.hours = t.hours; if (t.crew) o.crew = t.crew; }
      else o.dur = t.type === 'fixed' ? Math.max(1, r.dur || workdaysBetween(sched.cal, r.start, r.end, t.cal || 'w5') + 1) : (t.dur || r.dur || 1);
    }
    if (t.cal) o.cal = t.cal;
    if (t.res) o.res = t.res;
    if (t.with && lid[t.with]) o.with = lid[t.with];
    o.deps = (t.deps || []).filter(d => lid[d.id]).map(d => Object.assign({}, d, { id: lid[d.id] }));
    const sft = (t.soft || []).filter(d => lid[d.id]).map(d => Object.assign({}, d, { id: lid[d.id] })); if (sft.length) o.soft = sft;
    if (o.ms && !o.deps.length && t.deps && t.deps.length === 0) o.deps = [];
    if (t.mustFinishBefore && lid[t.mustFinishBefore]) { o.mustFinishBefore = lid[t.mustFinishBefore]; if (t.minMargin) o.minMargin = t.minMargin; }
    if (t.light) o.light = true;
    if (t.color) o.color = t.color;
    if (t.note) o.note = t.note;
    if (t.ignoreHol) o.ignoreHol = true;
    if (t.ignoreBreaks) o.ignoreBreaks = true;
    const row = (plan.rows || []).find(x => x.id === t.row);
    if (row) { o.rowName = t.film ? row.name.split('F' + t.film).join('F{F}') : row.name; o.rowSection = row.section; }
    return o;
  });
  return { name: name || 'Ny mall', tasks };
}

// Infoga mall. rootDeps = beroenden för mallens startfaser (de utan interna beroenden).
// Hitta en rad med samma namn i samma sektion, annars skapa den sist i sektionen
function ensureRow(plan, name, section) {
  plan.rows = plan.rows || [];
  name = String(name || 'Ny rad').trim();
  let r = plan.rows.find(x => x.name === name && x.section === section);
  if (r) return r.id;
  let n = 1; const ids = new Set(plan.rows.map(x => x.id)); while (ids.has('r' + n)) n++;
  r = { id: 'r' + n, name, section };
  let idx = -1; plan.rows.forEach((x, i) => { if (x.section === section) idx = i; });
  if (idx >= 0) plan.rows.splice(idx + 1, 0, r); else plan.rows.push(r);
  return r.id;
}
function newRow(plan, name, section, afterId) {
  plan.rows = plan.rows || [];
  let n = 1; const ids = new Set(plan.rows.map(x => x.id)); while (ids.has('r' + n)) n++;
  const r = { id: 'r' + n, name: name || 'Ny rad', section: section || 'Förproduktion' };
  const i = afterId ? plan.rows.findIndex(x => x.id === afterId) : -1;
  if (i >= 0) plan.rows.splice(i + 1, 0, r);
  else { let idx = -1; plan.rows.forEach((x, j) => { if (x.section === r.section) idx = j; }); if (idx >= 0) plan.rows.splice(idx + 1, 0, r); else plan.rows.push(r); }
  return r.id;
}
// Ge faser utan rad en egen rad (t.ex. när arket saknar radkolumnen)
function ensureRowsForAll(plan) {
  plan.rows = plan.rows || [];
  plan.tasks.forEach(t => { if (!t.row || !plan.rows.some(r => r.id === t.row)) t.row = ensureRow(plan, baseName(t.name), t.group || 'Övrigt'); });
}
function insertTemplate(plan, tpl, opts) {
  opts = opts || {};
  const suffix = opts.film ? String(opts.film) : (opts.suffix || '_m');
  const map = {}; const taken = new Set();
  tpl.tasks.forEach(o => { const nid = uniqueId(plan, o.lid + suffix, taken); taken.add(nid); map[o.lid] = nid; });
  const rootDeps = opts.rootDeps || [];
  const added = tpl.tasks.map(o => {
    const t = { id: map[o.lid], name: o.name, group: o.group };
    if (opts.film) t.film = opts.film;
    if (o.ms) { t.type = 'milestone'; t.ms = true; }
    else if (o.hours) { t.hours = o.hours; if (o.crew) t.crew = o.crew; }
    else t.dur = o.dur || 1;
    ['cal', 'res', 'light', 'color', 'note', 'minMargin', 'ignoreHol', 'ignoreBreaks'].forEach(k => { if (o[k] !== undefined) t[k] = o[k]; });
    if (opts.row) t.row = opts.row;
    else if (o.rowName) t.row = ensureRow(plan, o.rowName.split('F{F}').join(opts.film ? 'F' + opts.film : ''), o.rowSection || o.group);
    if (o.with) t.with = map[o.with];
    if (o.mustFinishBefore) t.mustFinishBefore = map[o.mustFinishBefore];
    t.deps = (o.deps || []).map(d => Object.assign({}, d, { id: map[d.id] }));
    if (o.soft && o.soft.length) t.soft = o.soft.filter(d => map[d.id]).map(d => Object.assign({}, d, { id: map[d.id] }));
    const isRoot = !t.deps.length;
    if (isRoot) {
      t.deps = rootDeps.map(d => Object.assign({}, d));
      if (opts.notBefore) t.notBefore = opts.notBefore;
      if (t.type === 'milestone' && !t.deps.length) { delete t.type; t.ms = true; t.type = 'fixed'; t.start = t.end = opts.notBefore || plan.settings.projectStart; }
    }
    return t;
  });
  plan.tasks.push(...added);
  return added.map(t => t.id);
}

// Flytta flera faser lika många kalenderdagar. Framräknade faser får "tidigast start", låsta flyttas.
function shiftTasks(plan, sched, ids, days) {
  let skipped = 0;
  ids.forEach(id => {
    const t = plan.tasks.find(x => x.id === id); const r = sched.dates[id]; if (!t || !r) return;
    if (t.locked) { skipped++; return; }
    if (t.type === 'fixed') { t.start = addDays(t.start, days); t.end = addDays(t.end || t.start, days); return; }
    if (t.type === 'milestone') { skipped++; return; }
    const c = calKey(t);
    const want = days > 0 ? sched.cal.firstWork(addDays(r.start, days), c) : sched.cal.firstWork(addDays(r.start, days), c);
    if (want <= (r.depStart || r.start)) delete t.notBefore; else t.notBefore = want;
  });
  return { skipped };
}

function removeTasks(plan, ids) {
  const set = new Set(ids);
  // en borttagen fas lämnar över sina beroenden till dem som väntade på den
  const removed = plan.tasks.filter(t => set.has(t.id));
  plan.tasks = plan.tasks.filter(t => !set.has(t.id));
  plan.tasks.forEach(t => {
    const next = [];
    (t.deps || []).forEach(d => {
      if (!set.has(d.id)) { next.push(d); return; }
      const gone = removed.find(x => x.id === d.id);
      (gone.deps || []).filter(x => !set.has(x.id)).forEach(x => { if (!next.some(y => y.id === x.id)) next.push(Object.assign({}, x)); });
    });
    t.deps = next;
    if (t.soft) { t.soft = t.soft.filter(d => !set.has(d.id)); if (!t.soft.length) delete t.soft; }
    if (set.has(t.mustFinishBefore)) delete t.mustFinishBefore;
    if (set.has(t.with)) delete t.with;
  });
}


export {
  DAY, toD, toS, addDays, dow, easter, swedishHolidays, holidayMap, normResources, makeCal, hoursPerDay, calKey, taskDur, schedule, LOCK_MARGIN, workdaysBetween, FASER_HEAD, parseDoers, doersToStr, MOT_HEAD, DEFAULT_RECIPIENTS, ROW_HEAD, CAL_HEAD, MALL_HEAD, RES_HEAD, SET_HEAD, depsToStr, strToDeps, STATUS_LABEL, statusKey, TYP_OUT, planToRows, num, cell, normDate, isYes, rowsToPlan, templatesToRows, rowsToTemplates, opsClone, uniqueId, baseName, splitTask, renumberParts, duplicateTasks, templateFromTasks, ensureRow, newRow, ensureRowsForAll, insertTemplate, shiftTasks, removeTasks,
};
