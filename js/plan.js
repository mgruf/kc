/* KC – delegering med avstämning och kapacitetsmätare.
   Delegering lagras som rader i uppgiftens anteckning (följer med till Google Tasks och telefonen):
     Delegerad: Namn <adress>
     Avstämning: ÅÅÅÅ-MM-DD
   Kapacitet räknas fram ur kalendern, uppgifterna och inspelningsdagarna. Inställningar i layout '_CAP'. */
import {
  S, api, emit, refresh, $, esc, toast, ymd, parseYmd, addDays, todayStr, monday, shortDate, dayLabel, DAYS,
  tasks, events, cfgProjects, visible, cleanTitle, isShootDup, personIn, people, firstName, initials, contactLine,
} from './core.js';

// ---------- delegering ----------
const RE_DEL = /^\s*Delegerad:\s*(.+)$/im;
const RE_CHK = /^\s*Avstämning:\s*(\d{4}-\d{2}-\d{2})/im;

/** { person: {name,email}|null, check: 'ÅÅÅÅ-MM-DD'|null } eller null om uppgiften inte är delegerad. */
export function delegationOf(t) {
  const n = String(t?.notes || '');
  const m = RE_DEL.exec(n), c = RE_CHK.exec(n);
  if (!m && !c) return null;
  return { person: m ? personIn(m[1]) || { name: m[1].trim(), email: '' } : null, check: c ? c[1] : null };
}

/** Skriver delegeringsraderna (överst, efter ev. Kontakt-rad), flyttar till VÄNTAR/DELEGATED-listan. */
export async function delegate(task, person, checkDate) {
  const t = task;
  const keep = String(t.notes || '').split('\n').filter(l => !/^\s*(Delegerad|Avstämning):/i.test(l));
  const contact = keep.filter(l => /^\s*Kontakt:/i.test(l));
  const rest = keep.filter(l => !/^\s*Kontakt:/i.test(l));
  const p = typeof person === 'string' ? (personIn(person) || { name: person.trim(), email: '' }) : person;
  const lines = [];
  if (p) lines.push(`Delegerad: ${p.email && p.name !== p.email ? `${p.name} <${p.email}>` : (p.email ? `<${p.email}>` : p.name)}`);
  if (checkDate) lines.push(`Avstämning: ${checkDate}`);
  const notes = [...contact, ...lines, ...rest].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const wl = (S.data?.taskLists || []).find(l => l._src === (t._src || 'jobb') && /VÄNTAR|DELEGATED/i.test(l.title));
  const newListId = wl && wl.id !== t.listId ? wl.id : '';
  const before = { notes: t.notes, listId: t.listId, list: t.list, waiting: t.waiting };
  Object.assign(t, { notes, pending: true }); if (wl) Object.assign(t, { listId: wl.id, list: wl.title, waiting: true });
  emit('render');
  try {
    const r = await api('updateTask', { listId: before.listId, taskId: t.id, notes, newListId }, true, t._src || 'jobb');
    if (r?.id) t.id = r.id;
    t.pending = false;
    toast(`Delegerad till ${firstName(p?.name || '')}${checkDate ? ' · stäm av ' + dayLabel(checkDate) : ''}`);
    refresh();
    return true;
  } catch (e) {
    Object.assign(t, before, { pending: false }); emit('render');
    toast('Kunde inte delegera – ' + e.message);
    return false;
  }
}

/** Ny avstämningsdag på en redan delegerad uppgift. */
export async function setCheck(task, checkDate) {
  const d = delegationOf(task);
  return delegate(task, d?.person || null, checkDate);
}

/** Delegerade uppgifter vars avstämningsdag är idag eller passerad. */
export function delegationFire() {
  const t = todayStr();
  return tasks().filter(x => !S.done[x.id]).filter(x => { const d = delegationOf(x); return d?.check && d.check <= t; });
}
export const delegated = () => tasks().filter(x => !S.done[x.id] && delegationOf(x));

/** Delegerat, grupperat per person, med knappar (klicken hanteras av plan.js själv). */
export function delegationsHtml(list = delegated()) {
  if (!list.length) return '<p class="empty">Inget delegerat. Öppna en uppgift och välj Delegera.</p>';
  const by = new Map();
  list.forEach(x => { const d = delegationOf(x); const k = (d.person?.email || d.person?.name || '–').toLowerCase(); if (!by.has(k)) by.set(k, { p: d.person, items: [] }); by.get(k).items.push({ t: x, d }); });
  const t = todayStr();
  return `<div class="dlg">${[...by.values()].map(g => `
    <div class="dlg-p">
      <div class="dlg-h"><span class="avatar" style="width:26px;height:26px;font-size:10px">${esc(initials(g.p?.name || '?'))}</span><b>${esc(g.p?.name || 'Okänd')}</b><span class="n">${g.items.length}</span></div>
      ${g.items.sort((a, b) => String(a.d.check || '9').localeCompare(String(b.d.check || '9'))).map(({ t: x, d }) => `
        <div class="dlg-row ${d.check && d.check <= t ? 'fire' : ''}" data-dtask="${esc(x.id)}">
          <div class="main" data-open-task="${esc(x.id)}"><div class="title">${esc(cleanTitle(x.title))}</div>
            <div class="sub">${d.check ? `<span class="due">Stäm av ${esc(dayLabel(d.check))}</span>` : '<span>Ingen avstämning</span>'}</div></div>
          <div class="dlg-act">
            <button class="btn" data-dlg="stam" title="Stäm av">Stäm av</button>
            <button class="btn" data-dlg="plus3" title="Ny avstämning om 3 dagar">+3</button>
            <button class="btn" data-dlg="plus7" title="Ny avstämning om 7 dagar">+7</button>
            <button class="btn" data-dlg="klar" title="Klar">Klar</button>
          </div></div>`).join('')}
    </div>`).join('')}</div>`;
}

async function dlgAction(act, id) {
  const t = (S.data?.tasks || []).find(x => x.id === id); if (!t) return;
  const d = delegationOf(t) || {};
  if (act === 'plus3' || act === 'plus7') return setCheck(t, ymd(addDays(new Date(), act === 'plus3' ? 3 : 7)));
  if (act === 'klar') {
    S.done[id] = true; emit('render');
    try { await api('complete', { listId: t.listId, taskId: id, done: true }, true, t._src || 'jobb'); toast('Klar'); }
    catch { delete S.done[id]; emit('render'); toast('Kunde inte spara'); }
    return;
  }
  if (act === 'stam') {
    if (d.person?.email) {
      const subj = encodeURIComponent('Avstämning: ' + cleanTitle(t.title));
      const body = encodeURIComponent(`Hej ${firstName(d.person.name)}!\n\nHur går det med "${cleanTitle(t.title)}"?\n\n`);
      location.href = `mailto:${d.person.email}?subject=${subj}&body=${body}`;
      setCheck(t, ymd(addDays(new Date(), 3)));
    } else {
      const inbox = (S.data?.taskLists || []).find(l => l._src === (t._src || 'jobb') && /INBOX/i.test(l.title));
      try { await api('addTask', { title: `Stäm av med ${d.person?.name || 'ansvarig'}: ${cleanTitle(t.title)}`, due: todayStr(), listId: inbox?.id || '' }, true, t._src || 'jobb'); toast('Uppgift skapad'); refresh(); }
      catch (e) { toast('Kunde inte skapa – ' + e.message); }
    }
  }
}

// ---------- delegera-dialog ----------
let DTASK = null;
export function delegateDialog(task) {
  DTASK = task;
  let d = $('#delegateDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="delegateDlg" class="sheet"><form id="delegateForm">
      <h2>Delegera</h2>
      <p class="hint" id="dlgTitle"></p>
      <input id="dlgPerson" placeholder="Till vem? Namn &lt;adress&gt;" list="dlgPeople" autocomplete="off" required>
      <datalist id="dlgPeople"></datalist>
      <label class="lbl">Stäm av</label>
      <div class="row"><input type="date" id="dlgDate" required></div>
      <div class="quick" id="dlgQuick"><button type="button" data-plus="2">Om 2 dagar</button><button type="button" data-plus="5">Om 5 dagar</button><button type="button" data-plus="7">Om en vecka</button><button type="button" data-plus="14">Om två veckor</button></div>
      <p class="hint">Uppgiften flyttas till listan för väntande och dyker upp under Det som brinner på avstämningsdagen.</p>
      <div class="actions"><span class="spacer"></span><button type="button" class="ghost" id="dlgCancel">Avbryt</button><button type="submit">Delegera</button></div>
    </form></dialog>`);
    d = $('#delegateDlg');
    $('#dlgCancel').onclick = () => d.close();
    $('#dlgQuick').onclick = e => { const b = e.target.closest('[data-plus]'); if (b) $('#dlgDate').value = ymd(addDays(new Date(), Number(b.dataset.plus))); };
    $('#delegateForm').onsubmit = async e => {
      e.preventDefault();
      const p = personIn($('#dlgPerson').value) || { name: $('#dlgPerson').value.trim(), email: '' };
      d.close();
      await delegate(DTASK, p, $('#dlgDate').value);
    };
  }
  const cur = delegationOf(task);
  $('#dlgTitle').textContent = cleanTitle(task.title);
  $('#dlgPeople').innerHTML = people().filter(p => p.email).slice(0, 1500).map(p => `<option value="${esc(p.name && p.name !== p.email ? `${p.name} <${p.email}>` : p.email)}">`).join('');
  $('#dlgPerson').value = cur?.person ? (cur.person.email ? `${cur.person.name} <${cur.person.email}>` : cur.person.name) : '';
  $('#dlgDate').value = cur?.check || ymd(addDays(new Date(), 5));
  [...document.querySelectorAll('dialog[open]')].forEach(x => x !== d && x.close());
  d.showModal();
  setTimeout(() => $('#dlgPerson').focus(), 30);
}

// ---------- kapacitet ----------
const CAP_DEFAULT = { hoursPerDay: 8, workdays: [1, 2, 3, 4, 5], taskHours: 0.5, shootHours: 4, dayStart: 7, dayEnd: 20 };
export const capSettings = () => ({ ...CAP_DEFAULT, ...((S.data?.layouts || {})['_CAP'] || {}) });
export async function saveCapSettings(s) {
  (S.data.layouts ||= {})['_CAP'] = s; emit('render');
  try { await api('setLayout', { tag: '_CAP', layout: s }, true); toast('Sparat'); } catch { toast('Kunde inte spara'); }
}

/** Timmar ur raden "Tid: 2h", "Tid: 90 min", "Tid: 1,5 h". */
export function taskHoursOf(t, def = capSettings().taskHours) {
  const m = /^\s*Tid:\s*([\d.,]+)\s*(h|tim|timmar|t|min|minuter|m)?\b/im.exec(String(t.notes || ''));
  if (!m) return def;
  const v = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(v)) return def;
  return /^m/i.test(m[2] || 'h') ? v / 60 : v;
}

/** Per dag i [from, to] (ÅÅÅÅ-MM-DD, inklusive): möten, uppgifter, inspelning, totalt, tillgängligt, procent, status. */
export function capacity(dateFrom, dateTo) {
  const s = capSettings();
  const evs = events().filter(e => !e.allDay && !isShootDup(e));
  const ts = tasks().filter(x => x.due && !S.done[x.id] && !delegationOf(x));
  const shoot = {};
  cfgProjects().filter(visible).forEach(p => (p.shootDays || []).forEach(d => { shoot[d.date] = (shoot[d.date] || []).concat({ p, d }); }));
  const out = [];
  for (let d = parseYmd(dateFrom); ymd(d) <= dateTo; d = addDays(d, 1)) {
    const day = ymd(d);
    const lo = new Date(d); lo.setHours(s.dayStart, 0, 0, 0);
    const hi = new Date(d); hi.setHours(s.dayEnd, 0, 0, 0);
    // mötestid: klipp till dagens ram och slå ihop överlapp
    const iv = evs.map(e => [Math.max(+new Date(e.start), +lo), Math.min(+new Date(e.end), +hi)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    let meet = 0, cur = null;
    iv.forEach(([a, b]) => { if (!cur || a > cur[1]) { if (cur) meet += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); });
    if (cur) meet += cur[1] - cur[0];
    meet /= 36e5;
    const dayTasks = ts.filter(x => x.due === day);
    const taskH = dayTasks.reduce((a, x) => a + taskHoursOf(x, s.taskHours), 0);
    const shootH = shoot[day] ? s.shootHours : 0;
    const total = meet + taskH + shootH;
    const avail = s.workdays.includes(d.getDay()) ? s.hoursPerDay : 0;
    const pct = avail ? Math.round(total / avail * 100) : (total ? Infinity : 0);
    out.push({ date: day, weekday: d.getDay(), meet, tasks: taskH, taskCount: dayTasks.length, shoot: shootH, shootDays: shoot[day] || [], total, avail, pct,
      status: pct === Infinity ? 'helg' : pct > 100 ? 'over' : pct >= 85 ? 'full' : 'ok' });
  }
  return out;
}
const h1 = v => (Math.round(v * 10) / 10).toLocaleString('sv-SE');

/** En stapel för en dag (från capacity()). */
export function capacityBar(day) {
  const w = day.pct === Infinity ? 100 : Math.min(100, day.pct);
  const label = day.status === 'helg' ? `${h1(day.total)} h på en ledig dag` : `${day.pct} % · ${h1(day.total)} av ${h1(day.avail)} h`;
  return `<div class="cap-bar cap-${day.status}" title="${esc(label)} – möten ${h1(day.meet)} h, uppgifter ${h1(day.tasks)} h${day.shoot ? ', inspelning ' + h1(day.shoot) + ' h' : ''}"><i style="width:${w}%"></i></div>`;
}

/** Veckans kapacitet: en stapel per dag + ärlig varningsrad om veckan är över 110 %. */
export function capacityWeekHtml(weekStart = ymd(monday(new Date())), opt = {}) {
  const s = capSettings();
  const from = typeof weekStart === 'string' ? weekStart : ymd(weekStart);
  const toD = opt.rest ? ymd(addDays(monday(parseYmd(from)), 6)) : ymd(addDays(parseYmd(from), 6));
  const days = capacity(from, toD);
  const work = days.filter(d => d.avail);
  const tot = days.reduce((a, d) => a + d.total, 0), avail = work.reduce((a, d) => a + d.avail, 0);
  const pct = avail ? Math.round(tot / avail * 100) : 0;
  const t = todayStr();
  const shown = days.filter(d => d.avail || d.total);
  let warn = '';
  if (pct > 110) {
    const movable = tasks().filter(x => x.due && x.due >= t && x.due >= from && x.due <= toD && !S.done[x.id] && !/^\s*Tid:/im.test(x.notes || ''))
      .sort((a, b) => taskHoursOf(b) - taskHoursOf(a)).slice(0, 4);
    warn = `<div class="cap-warn">Veckan är ${pct} % full – ${h1(tot - avail)} h mer än du har.${movable.length ? ` Det som kan flyttas: ${movable.map(x => `<button class="cap-mv" data-open-task="${esc(x.id)}">${esc(cleanTitle(x.title))}</button>`).join(', ')}.` : ' Se över mötena.'}</div>`;
  }
  return `<div class="cap ${opt.compact ? 'compact' : ''}">
    <div class="cap-sum"><b class="num ${pct > 100 ? 'firetext' : ''}">${pct} %</b><span>${opt.compact ? (opt.rest ? 'Resten av veckan · ' : from > todayStr() ? 'Nästa vecka · ' : '') : ''}${h1(tot)} av ${h1(avail)} h</span></div>
    <div class="cap-parts">${[['möten', days.reduce((a, d) => a + d.meet, 0)], ['uppgifter', days.reduce((a, d) => a + d.tasks, 0)], ['inspelning', days.reduce((a, d) => a + d.shoot, 0)]].filter(([, v]) => v).map(([n, v]) => `<span>${n} ${h1(v)} h</span>`).join('') || '<span>Inget inplanerat</span>'}</div>
    <div class="cap-days">${shown.map(d => `<a class="cap-day ${d.date === t ? 'today' : ''} ${d.date < t ? 'pastd' : ''}" href="#/kalender/dag/${d.date}">
      <span class="cap-d">${DAYS[d.weekday].slice(0, 3)}</span>${capacityBar(d)}<span class="cap-p ${d.status === 'over' || d.status === 'helg' ? 'firetext' : ''}">${d.status === 'helg' ? h1(d.total) + ' h' : d.pct + ' %'}</span></a>`).join('')}</div>
    ${warn}</div>`;
}

// ---------- klick (delegerat och kapacitet), binds en gång ----------
let bound = false;
function bindOnce() {
  if (bound) return; bound = true;
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open-task]');
    if (o && !e.target.closest('[data-dlg]')) { e.preventDefault(); e.stopPropagation(); import('./ui.js').then(m => m.openTask(o.dataset.openTask)); return; }
    const b = e.target.closest('[data-dlg]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    dlgAction(b.dataset.dlg, b.closest('[data-dtask]')?.dataset.dtask);
  }, true);
}
bindOnce();
