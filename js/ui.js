/* KC – gemensamma byggstenar: rader, sektioner, redigerare för uppgifter och händelser, snabbinmatning. */
import {
  S, api, refresh, emit, $, $$, esc, toast, ymd, parseYmd, addDays, todayStr, hhmm, shortDate, dayLabel, DAYS,
  tagHtml, cleanTitle, TAG_RE, isDateTag, modeCls, isFire, isWaitingLong, waitedDays, contactOf, contactLine, personIn,
  mailHref, firstName, initials, people, knownTags, gcalLink, claudeUrl, notesUrl, go, merge, store, sources, setSources,
} from './core.js';

// ---------- rader ----------
export function taskRow(t, opt = {}) {
  const cls = ['item', 'task', modeCls(t.mode), S.done[t.id] ? 'done' : '', isFire(t) || isWaitingLong(t) ? 'fire' : '', t.pending ? 'pending' : ''].join(' ');
  const due = t.due ? `<span class="due">${dayLabel(t.due)}</span>` : isWaitingLong(t) ? `<span class="due">väntat ${waitedDays(t)} d</span>` : '';
  const p = contactOf(t), mh = mailHref(t);
  const meta = [due, opt.noList ? '' : `<span>${esc(t.list)}</span>`].filter(Boolean).join('<i class="sep">·</i>');
  return `<div class="${cls}" data-task="${esc(t.id)}" draggable="true">
    <button class="check" aria-label="Bocka av"></button>
    <div class="main">
      <div class="title">${esc(cleanTitle(t.title))}<span class="tags">${tagHtml(t.tags)}</span></div>
      ${meta || p || mh ? `<div class="sub">${meta}${p ? `<a class="pchip" href="#/person/${encodeURIComponent(p.email.toLowerCase())}" title="${esc(p.name)}"><i>${esc(initials(p.name))}</i>${esc(firstName(p.name))}</a>` : ''}${mh ? `<a class="mchip" href="${esc(mh)}" title="Öppna mailet">Mailet</a>` : ''}</div>` : ''}
    </div></div>`;
}

export function eventRow(e, opt = {}) {
  const now = new Date();
  const past = !e.allDay && new Date(e.end) < now;
  const cur = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
  const time = e.allDay ? 'Heldag' : hhmm(e.start);
  return `<div class="item event ${modeCls(e.mode)} ${past ? 'past' : ''} ${e.pending ? 'pending' : ''}" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}">
    <div class="time ${cur ? 'now' : ''}">${opt.day ? `<small>${esc(dayLabel(e.allDay ? e.start : ymd(new Date(e.start))))}</small>` : ''}${time}</div>
    <div class="main">
      <div class="title">${esc(cleanTitle(e.title))}<span class="tags">${tagHtml(e.tags)}</span></div>
      <div class="sub">${!e.allDay ? hhmm(e.start) + '–' + hhmm(e.end) + '<i class="sep">·</i>' : ''}${esc(e.cal)}${e.location ? '<i class="sep">·</i>' + esc(e.location) : ''}</div>
    </div></div>`;
}

export function noteRow(n) {
  return `<a class="item note ${modeCls(n.mode)}" href="#/anteckning/${encodeURIComponent(n.id)}">
    <div class="glyph">≡</div>
    <div class="main">
      <div class="title">${esc(n.title)}<span class="tags">${tagHtml(n.tags)}</span></div>
      <div class="sub"><span>${esc(n.folder)}</span>${n.modified ? `<i class="sep">·</i><span>${esc(shortDate(ymd(new Date(n.modified))))}</span>` : ''}</div>
    </div></a>`;
}

export function section(id, title, n, body, extra = '', action = '') {
  const closed = S.closed[id] ? 'closed' : '';
  return `<section class="sec ${closed} ${extra}" data-sec="${id}"><h2><span class="h">${title}</span>${n != null ? `<span class="n">${n}</span>` : ''}${action}</h2><div class="body">${body}</div></section>`;
}
export const empty = s => `<p class="empty">${s}</p>`;

// ---------- ark (dialoger) ----------
const DIALOGS = `
<dialog id="taskDlg" class="sheet">
  <form id="taskForm">
    <input id="tTitle" class="big-input" placeholder="Uppgift" autocomplete="off" required>
    <div class="row"><input type="date" id="tDue" aria-label="Datum"><select id="tList" aria-label="Lista"></select></div>
    <div class="quick" id="tQuick"><button type="button" data-due="0">Idag</button><button type="button" data-due="1">Imorgon</button><button type="button" data-due="mon">Måndag</button><button type="button" data-due="7">Om en vecka</button><button type="button" data-due="">Inget datum</button></div>
    <input id="tContact" placeholder="Kontakt – namn &lt;adress&gt;" list="contactList" autocomplete="off">
    <datalist id="contactList"></datalist>
    <div class="tagpick" id="tTags"></div>
    <textarea id="tNotes" rows="5" placeholder="Anteckning"></textarea>
    <details id="tBlock"><summary>Boka tid i kalendern</summary>
      <div class="row"><input type="date" id="tbDate"><input type="time" id="tbTime" step="900">
        <select id="tbLen"><option value="30">30 min</option><option value="60" selected>1 tim</option><option value="90">1½ tim</option><option value="120">2 tim</option><option value="180">3 tim</option><option value="240">4 tim</option></select></div>
      <div class="row"><select id="tbCal"></select><button type="button" class="solid" id="tbAdd">Boka</button></div>
    </details>
    <div class="links" id="tLinks"></div>
    <div class="actions"><button type="button" class="ghost danger" id="tDelete">Ta bort</button><span class="spacer"></span><button type="button" class="ghost" id="tCancel">Avbryt</button><button type="submit">Spara</button></div>
  </form>
</dialog>
<dialog id="evDlg" class="sheet">
  <form id="evForm">
    <input id="eTitle" class="big-input" placeholder="Händelse" autocomplete="off" required>
    <div class="row when"><input type="date" id="eDate" aria-label="Dag"><input type="time" id="eStart" step="900" aria-label="Start"><span id="eDash" class="dash">–</span><input type="time" id="eEnd" step="900" aria-label="Slut"><input type="date" id="eEndDate" aria-label="Sista dag" hidden></div>
    <label class="inline"><input type="checkbox" id="eAllDay"> Heldag</label>
    <select id="eCal" aria-label="Kalender"></select>
    <input id="eLoc" placeholder="Plats" autocomplete="off">
    <textarea id="eDesc" rows="4" placeholder="Beskrivning"></textarea>
    <p class="hint" id="eHint"></p>
    <div class="links" id="eLinks"></div>
    <div class="actions"><button type="button" class="ghost danger" id="eDelete">Ta bort</button><span class="spacer"></span><button type="button" class="ghost" id="eCancel">Avbryt</button><button type="submit" id="eSave">Spara</button></div>
  </form>
</dialog>
<dialog id="addDlg" class="sheet">
  <form id="addForm">
    <div class="seg" role="group"><button type="button" data-kind="task" class="on">Uppgift</button><button type="button" data-kind="event">Händelse</button><button type="button" data-kind="note">Anteckning</button></div>
    <input id="addTitle" class="big-input" placeholder="Vad?" autocomplete="off" required>
    <textarea id="addText" placeholder="Text" rows="5" hidden></textarea>
    <div class="row" id="addWhen"><input type="date" id="addDate"><input type="time" id="addTime" step="900" hidden></div>
    <select id="addCal" hidden></select><select id="addList" hidden></select>
    <p class="hint" id="addHint"></p>
    <div class="actions"><span class="spacer"></span><button type="button" class="ghost" id="addCancel">Avbryt</button><button type="submit">Spara</button></div>
  </form>
</dialog>
<dialog id="setupDlg" class="sheet">
  <form id="setupForm">
    <h2>Koppla KC</h2>
    <p class="hint">Adress och nyckel till Apps Script-webbappen. Sparas bara i den här webbläsaren. Den privata källan är valfri.</p>
    <label class="lbl">Jobb</label>
    <input id="setupUrl" placeholder="https://script.google.com/macros/s/…/exec" required>
    <input id="setupKey" placeholder="Nyckel" required>
    <label class="lbl">Privat (eget Google-konto)</label>
    <input id="setupUrl2" placeholder="https://script.google.com/macros/s/…/exec">
    <input id="setupKey2" placeholder="Nyckel">
    <div class="actions"><span class="spacer"></span><button type="button" class="ghost" id="setupCancel">Avbryt</button><button type="submit">Spara</button></div>
  </form>
</dialog>`;

export function initDialogs() {
  document.body.insertAdjacentHTML('beforeend', DIALOGS);
  bindTask(); bindEvent(); bindAdd(); bindSetup();
}
const closeAll = () => $$('dialog[open]').forEach(d => d.close());

// ---------- uppgiftsredigeraren ----------
const listOptions = src => (S.data?.taskLists || []).filter(l => !src || l._src === src).map(l => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join('');
const calOptions = src => (S.data?.writableCalendars || []).filter(c => !src || c._src === src).map(c => `<option value="${esc(c.id)}" data-src="${esc(c._src)}">${esc(c.name)}</option>`).join('');
const findTask = id => (S.data?.tasks || []).find(t => t.id === id);
let TASK = null, TTAGS = [];

/** Öppnar en uppgift. id = null skapar ny; preset = { due, tag, title, listId, contact }. */
export function openTask(id, preset = {}) {
  const t = id ? findTask(id) : null;
  if (id && !t) return;
  TASK = t || { id: null, title: preset.title || '', notes: '', due: preset.due || null, listId: preset.listId || '', _src: preset.src || 'jobb', mode: S.mode, tags: [] };
  closeAll();
  const raw = String(TASK.title).match(TAG_RE) || [];
  TTAGS = raw.filter(x => !isDateTag(x)).map(x => x.toUpperCase());
  if (preset.tag && !TTAGS.includes(preset.tag)) TTAGS.push(preset.tag);
  $('#tTitle').value = TASK.title ? cleanTitle(TASK.title) : '';
  $('#tDue').value = TASK.due || '';
  $('#tList').innerHTML = listOptions(TASK._src);
  const inbox = (S.data?.taskLists || []).find(l => l._src === TASK._src && /INBOX/i.test(l.title));
  $('#tList').value = TASK.listId || inbox?.id || $('#tList').value;
  const c = t ? contactOf(t) : preset.contact || null;
  $('#tContact').value = c ? (c.name !== c.email ? `${c.name} <${c.email}>` : c.email) : '';
  $('#contactList').innerHTML = people().filter(p => p.email).slice(0, 800).map(p => `<option value="${esc(p.name !== p.email ? `${p.name} <${p.email}>` : p.email)}">`).join('');
  $('#tNotes').value = String(TASK.notes || '').split('\n').filter(l => !/^\s*Kontakt:/.test(l)).join('\n').replace(/^\n+/, '');
  drawTagPick();
  $('#tbCal').innerHTML = calOptions();
  const pref = (S.data?.writableCalendars || []).find(x => x.mode === TASK.mode); if (pref) $('#tbCal').value = pref.id;
  $('#tbDate').value = TASK.due && TASK.due >= todayStr() ? TASK.due : todayStr();
  $('#tbTime').value = `${String(Math.min(new Date().getHours() + 1, 20)).padStart(2, '0')}:00`;
  $('#tBlock').open = false; $('#tBlock').hidden = !t || !(S.data?.writableCalendars || []).length;
  $('#tDelete').hidden = !t;
  const mh = t && mailHref(t);
  $('#tLinks').innerHTML = !t ? '' : [
    mh && `<a href="${esc(mh)}">Öppna mailet</a>`,
    c && `<a href="#/person/${encodeURIComponent(c.email.toLowerCase())}">Allt med ${esc(firstName(c.name))}</a>`,
    `<a href="${claudeUrl('Uppgift: ' + t.title + (t.notes ? '\n' + t.notes : ''))}" target="_blank" rel="noopener">Fråga Claude</a>`,
    t.link && `<a href="${esc(t.link)}" target="_blank" rel="noopener">Öppna i Tasks</a>`,
  ].filter(Boolean).join('');
  $('#taskDlg').showModal();
  if (!t) setTimeout(() => $('#tTitle').focus(), 30);
}
function drawTagPick() {
  const all = [...new Set([...knownTags(), ...TTAGS])];
  $('#tTags').innerHTML = all.map(g => `<button type="button" class="chip ${TTAGS.includes(g) ? 'on' : ''}" data-ttag="${esc(g)}">${esc(g.slice(1))}</button>`).join('');
}
function bindTask() {
  $('#tTags').addEventListener('click', e => {
    const b = e.target.closest('[data-ttag]'); if (!b) return;
    const g = b.dataset.ttag; TTAGS = TTAGS.includes(g) ? TTAGS.filter(x => x !== g) : [...TTAGS, g]; drawTagPick();
  });
  $('#tQuick').addEventListener('click', e => {
    const b = e.target.closest('[data-due]'); if (!b) return;
    const v = b.dataset.due, d = new Date();
    if (v === '') $('#tDue').value = '';
    else if (v === 'mon') { const n = (8 - d.getDay()) % 7 || 7; $('#tDue').value = ymd(addDays(d, n)); }
    else $('#tDue').value = ymd(addDays(d, Number(v)));
  });
  $('#tCancel').addEventListener('click', () => $('#taskDlg').close());
  $('#taskForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const t = TASK;
    const dateTags = (String(t.title).match(TAG_RE) || []).filter(isDateTag);
    const title = [$('#tTitle').value.trim() || cleanTitle(t.title), ...TTAGS, ...dateTags].join(' ');
    let notes = $('#tNotes').value.replace(/\s+$/, '');
    const c = personIn($('#tContact').value);
    if (c) notes = contactLine(c) + (notes ? '\n' + notes : '');
    const due = $('#tDue').value || '', listId = $('#tList').value;
    $('#taskDlg').close();
    if (!t.id) {
      try { await api('addTask', { title, notes, due, listId }, true, t._src); toast('Sparat'); refresh(); }
      catch (e) { toast('Kunde inte spara – ' + e.message); }
      return;
    }
    const before = { ...t };
    const list = (S.data.taskLists || []).find(l => l.id === listId);
    Object.assign(t, { title, notes, due: due || null, pending: true, listId, list: list?.title || t.list, tags: [...new Set((title.match(TAG_RE) || []).map(x => x.toUpperCase()))] });
    emit('render');
    try {
      await api('updateTask', { listId: before.listId, taskId: t.id, title, notes, due, newListId: listId !== before.listId ? listId : '' }, true, t._src);
      toast('Sparat'); refresh();
    } catch (e) { Object.assign(t, before, { pending: false }); emit('render'); toast('Kunde inte spara – ' + e.message); }
  });
  $('#tDelete').addEventListener('click', async () => {
    const t = TASK; if (!confirm(`Ta bort "${cleanTitle(t.title)}"?`)) return;
    $('#taskDlg').close();
    const i = S.data.tasks.indexOf(t); S.data.tasks.splice(i, 1); emit('render');
    try { await api('deleteTask', { listId: t.listId, taskId: t.id }, true, t._src); toast('Borttagen'); }
    catch (e) { S.data.tasks.splice(i, 0, t); emit('render'); toast('Kunde inte ta bort – ' + e.message); }
  });
  $('#tbAdd').addEventListener('click', async () => {
    const t = TASK, date = $('#tbDate').value, time = $('#tbTime').value, minutes = Number($('#tbLen').value);
    if (!date || !time) return toast('Välj dag och tid');
    $('#taskDlg').close();
    await timeBlock(t, date, time, minutes, $('#tbCal').value);
  });
}

/** Bokar tid i kalendern för en uppgift och ger uppgiften datumet om den saknar ett. Används också vid drag till kalendern. */
export async function timeBlock(t, date, time, minutes = 60, calId) {
  const cals = S.data.writableCalendars || [];
  const cal = cals.find(c => c.id === calId) || cals.find(c => c.mode === t.mode && c._src === t._src) || cals[0];
  if (!cal) return toast('Ingen kalender att skriva till');
  const tags = (t.tags || []).filter(x => !isDateTag(x)).join(' ');
  const title = cleanTitle(t.title) + (tags ? ' ' + tags : '');
  const description = [`Tidsblock för uppgiften "${cleanTitle(t.title)}" (${t.list}).`, t.link ? 'Uppgiften: ' + t.link : ''].filter(Boolean).join('\n');
  const start = new Date(`${date}T${time}`), end = new Date(start.getTime() + minutes * 60000);
  const tmp = { id: 'tmp' + Date.now(), calId: cal.id, cal: cal.name, _src: cal._src, mode: cal.mode, title, location: '', allDay: false, start: start.toISOString(), end: end.toISOString(), tags: t.tags || [], writable: true, pending: true, block: t.id };
  S.data.events.push(tmp);
  const setDue = !t.due; if (setDue) t.due = date;
  emit('render');
  try {
    await api('addEvent', { title, date, time, minutes, calendarId: cal.id, description }, true, cal._src);
    if (setDue) await api('updateTask', { listId: t.listId, taskId: t.id, due: date }, true, t._src);
    toast(`Bokat ${dayLabel(date)} ${time}`); refresh();
  } catch (e) { S.data.events = S.data.events.filter(x => x !== tmp); emit('render'); toast('Kunde inte boka – ' + e.message); }
}

// ---------- händelseredigeraren ----------
let EVENT = null;
const allEvents = () => [...(S.data?.events || []), ...S.extraEvents];
export const findEvent = (id, start) => allEvents().find(e => e.id === id && e.start === start) || allEvents().find(e => e.id === id);

/** Öppnar en händelse. id = null skapar ny; preset = { date, time, endTime, allDay, title, tag }. */
export function openEvent(id, start, preset = {}) {
  const e = id ? findEvent(id, start) : null;
  if (id && !e) return;
  closeAll();
  const isNew = !e;
  const cals = S.data?.writableCalendars || [];
  EVENT = e || { id: null, title: preset.title || (preset.tag ? ' ' + preset.tag : ''), allDay: !!preset.allDay, location: '', description: '', writable: true, mode: S.mode,
    start: preset.allDay ? (preset.date || todayStr()) : new Date(`${preset.date || todayStr()}T${preset.time || '09:00'}`).toISOString(),
    end: preset.allDay ? ymd(addDays(parseYmd(preset.date || todayStr()), 1)) : new Date(`${preset.date || todayStr()}T${preset.endTime || addMin(preset.time || '09:00', 60)}`).toISOString() };
  const editable = isNew ? !!cals.length : (e.writable && !e.recurring && !String(e.id).startsWith('tmp'));
  $('#eTitle').value = EVENT.title;
  $('#eAllDay').checked = !!EVENT.allDay;
  if (EVENT.allDay) {
    $('#eDate').value = EVENT.start;
    const last = ymd(addDays(parseYmd(EVENT.end), -1));
    $('#eEndDate').value = last > EVENT.start ? last : EVENT.start;
    $('#eStart').value = '09:00'; $('#eEnd').value = '10:00';
  } else {
    $('#eDate').value = ymd(new Date(EVENT.start));
    $('#eStart').value = hhmm(EVENT.start); $('#eEnd').value = hhmm(EVENT.end);
    $('#eEndDate').value = ymd(new Date(EVENT.end));
  }
  $('#eLoc').value = EVENT.location || '';
  $('#eDesc').value = EVENT.description || '';
  $('#eCal').innerHTML = calOptions();
  const pref = cals.find(c => c.mode === S.mode); if (pref) $('#eCal').value = pref.id;
  $('#eCal').hidden = !isNew;
  setAllDay();
  $('#evForm').querySelectorAll('input, textarea').forEach(x => x.disabled = !editable);
  $('#eSave').hidden = !editable; $('#eDelete').hidden = !editable || isNew;
  $('#eLoc').hidden = !editable && !EVENT.location; $('#eDesc').hidden = !editable && !EVENT.description;
  $('#eAllDay').closest('label').hidden = !editable;
  $('#eCancel').textContent = editable ? 'Avbryt' : 'Stäng';
  $('#eHint').textContent = isNew ? '' : editable ? e.cal : e.recurring ? `${e.cal} · Återkommande – ändras i Google Kalender.` : `${e.cal} · Läses bara härifrån.`;
  $('#eLinks').innerHTML = isNew ? '' : [
    e.calId && `<a href="${esc(gcalLink(e))}" target="_blank" rel="noopener">Öppna i Google Kalender</a>`,
    `<a href="${claudeUrl('Kalenderhändelse: ' + e.title + ' ' + (e.allDay ? e.start : new Date(e.start).toLocaleString('sv-SE')) + (e.location ? ', ' + e.location : '') + (e.description ? '\n' + e.description : ''))}" target="_blank" rel="noopener">Fråga Claude</a>`,
  ].filter(Boolean).join('');
  $('#evDlg').showModal();
  if (isNew) setTimeout(() => { const i = $('#eTitle'); i.focus(); i.setSelectionRange(0, 0); }, 30);
}
const addMin = (t, m) => { const [h, mm] = t.split(':').map(Number); const x = h * 60 + mm + m; return `${String(Math.min(23, Math.floor(x / 60))).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
function setAllDay() {
  const a = $('#eAllDay').checked;
  $('#eStart').hidden = a; $('#eEnd').hidden = a; $('#eDash').hidden = a; $('#eEndDate').hidden = !a;
}

/** Flyttar en händelse (drag i kalendern). */
export async function moveEvent(e, date, time, minutes) {
  if (!e.writable || e.recurring) return toast(e.recurring ? 'Återkommande – flytta i Google Kalender' : 'Kalendern går inte att ändra härifrån');
  const before = { ...e };
  const dur = minutes || (new Date(e.end) - new Date(e.start)) / 60000;
  const s = new Date(`${date}T${time}`), en = new Date(s.getTime() + dur * 60000);
  Object.assign(e, { start: s.toISOString(), end: en.toISOString(), allDay: false, pending: true });
  emit('render');
  try { await api('updateEvent', { calendarId: e.calId, id: e.id, date, time, endTime: hhmm(en.toISOString()), endDate: ymd(en) }, true, e._src); e.pending = false; emit('render'); }
  catch (err) { Object.assign(e, before); emit('render'); toast('Kunde inte flytta – ' + err.message); }
}

function bindEvent() {
  $('#eAllDay').addEventListener('change', setAllDay);
  $('#eStart').addEventListener('change', () => {
    const e = EVENT; if (!e || e.allDay) return;
    const dur = new Date(e.end) - new Date(e.start);
    const s = new Date(`${$('#eDate').value}T${$('#eStart').value}`); if (isNaN(s)) return;
    $('#eEnd').value = hhmm(new Date(s.getTime() + dur).toISOString());
  });
  $('#eCancel').addEventListener('click', () => $('#evDlg').close());
  $('#evForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const e = EVENT, before = { ...e };
    const allDay = $('#eAllDay').checked, date = $('#eDate').value;
    const p = { title: $('#eTitle').value.trim() || e.title, location: $('#eLoc').value, description: $('#eDesc').value, date };
    if (allDay) { p.endDate = $('#eEndDate').value > date ? $('#eEndDate').value : ''; }
    else { p.time = $('#eStart').value; p.endTime = $('#eEnd').value; if (p.endTime <= p.time) p.endDate = ymd(addDays(parseYmd(date), 1)); }
    $('#evDlg').close();
    if (!e.id) {
      const opt = $('#eCal').selectedOptions[0];
      try { await api('addEvent', { ...p, calendarId: $('#eCal').value }, true, opt?.dataset.src || 'jobb'); toast('Sparat'); refresh(); }
      catch (err) { toast('Kunde inte spara – ' + err.message); }
      return;
    }
    Object.assign(e, { title: p.title, location: p.location, description: p.description, allDay, pending: true });
    if (allDay) { e.start = date; e.end = ymd(addDays(parseYmd(p.endDate || date), 1)); }
    else { e.start = new Date(`${date}T${p.time}`).toISOString(); e.end = new Date(`${p.endDate || date}T${p.endTime}`).toISOString(); }
    emit('render');
    try { await api('updateEvent', { calendarId: e.calId, id: e.id, ...p }, true, e._src); toast('Sparat'); refresh(); }
    catch (err) { Object.assign(e, before); emit('render'); toast('Kunde inte spara – ' + err.message); }
  });
  $('#eDelete').addEventListener('click', async () => {
    const e = EVENT; if (!confirm(`Ta bort "${e.title}"?`)) return;
    $('#evDlg').close();
    const keep = S.data.events, keepX = S.extraEvents;
    S.data.events = keep.filter(x => x !== e); S.extraEvents = keepX.filter(x => x !== e); emit('render');
    try { await api('deleteEvent', { calendarId: e.calId, id: e.id }, true, e._src); toast('Borttagen'); }
    catch (err) { S.data.events = keep; S.extraEvents = keepX; emit('render'); toast('Kunde inte ta bort – ' + err.message); }
  });
}

// ---------- snabbinmatning (N) ----------
let kind = 'task';
export function openAdd(k, preset = {}) {
  closeAll();
  $('#addForm').reset();
  setKind(k || 'task');
  $('#addCal').innerHTML = calOptions();
  const pref = (S.data?.writableCalendars || []).find(c => c.mode === S.mode); if (pref) $('#addCal').value = pref.id;
  $('#addList').innerHTML = listOptions('jobb');
  const inbox = (S.data?.taskLists || []).find(l => /INBOX/i.test(l.title)); if (inbox) $('#addList').value = inbox.id;
  if (preset.title) $('#addTitle').value = preset.title;
  if (preset.date) $('#addDate').value = preset.date;
  $('#addDlg').showModal(); setTimeout(() => $('#addTitle').focus(), 50);
}
function setKind(k) {
  kind = k;
  $$('#addDlg .seg button').forEach(b => b.classList.toggle('on', b.dataset.kind === k));
  $('#addText').hidden = k !== 'note';
  $('#addWhen').hidden = k === 'note';
  $('#addTime').hidden = k !== 'event';
  $('#addCal').hidden = k !== 'event';
  $('#addList').hidden = k !== 'task' || !(S.data?.taskLists || []).length;
  $('#addTitle').placeholder = k === 'note' ? 'Titel' : 'Vad?';
  $('#addHint').textContent =
    k === 'task' ? 'Datum är valfritt. #TAGG i titeln kopplar till projektet.' :
    k === 'note' ? 'Skapas i Notes när Macen synkar nästa gång. [[Länkar]] och #taggar fungerar.' :
    'Utan tid blir det en heldag.';
  if (k === 'event' && !$('#addDate').value) $('#addDate').value = todayStr();
}
function bindAdd() {
  $$('#addDlg .seg button').forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
  $('#addCancel').addEventListener('click', () => $('#addDlg').close());
  $('#addForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const title = $('#addTitle').value.trim(); if (!title) return;
    $('#addDlg').close();
    try {
      if (kind === 'task') await api('addTask', { title, due: $('#addDate').value || '', listId: $('#addList').value || '' }, true);
      if (kind === 'event') { const o = $('#addCal').selectedOptions[0]; await api('addEvent', { title, date: $('#addDate').value || todayStr(), time: $('#addTime').value || '', calendarId: $('#addCal').value }, true, o?.dataset.src || 'jobb'); }
      if (kind === 'note') await api('addNote', { title, text: $('#addText').value }, true);
      toast(kind === 'note' ? 'Köad – syns i Notes inom 5 min' : 'Sparat'); refresh();
    } catch (e) { toast('Kunde inte spara – ' + e.message); }
  });
}

// ---------- koppling ----------
export function openSetup() {
  const d = $('#setupDlg'); if (d.open) return;
  const s = sources();
  $('#setupUrl').value = s[0]?.url || ''; $('#setupKey').value = s[0]?.key || '';
  $('#setupUrl2').value = s[1]?.url || ''; $('#setupKey2').value = s[1]?.key || '';
  closeAll(); d.showModal();
}
function bindSetup() {
  $('#setupCancel').addEventListener('click', () => $('#setupDlg').close());
  $('#setupForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const list = [{ id: 'jobb', label: 'Jobb', url: $('#setupUrl').value.trim(), key: $('#setupKey').value.trim() }];
    if ($('#setupUrl2').value.trim() && $('#setupKey2').value.trim()) list.push({ id: 'privat', label: 'Privat', url: $('#setupUrl2').value.trim(), key: $('#setupKey2').value.trim() });
    setSources(list);
    Object.keys(S.raw).forEach(k => { if (!list.some(s => s.id === k)) delete S.raw[k]; });
    $('#setupDlg').close(); refresh();
  });
}

// ---------- bocka av ----------
export async function toggleDone(id) {
  const t = (S.data?.tasks || []).find(x => x.id === id); if (!t) return;
  const done = !S.done[id];
  S.done[id] = done; emit('render');
  try { await api('complete', { listId: t.listId, taskId: id, done }, true, t._src); }
  catch { delete S.done[id]; emit('render'); toast('Kunde inte spara – försök igen'); }
}

// ---------- vyhuvud ----------
export function head(title, sub = '', actions = '') {
  return `<header class="vhead"><div><h1>${title}</h1>${sub ? `<div class="vsub">${sub}</div>` : ''}</div><div class="vact">${actions}</div></header>`;
}
/** Segmentväljare för vyer: [['lista','Lista'],...] */
export function seg(name, opts, cur) {
  return `<div class="seg small" data-segname="${esc(name)}">${opts.map(([v, l]) => `<button type="button" data-seg="${esc(v)}" class="${v === cur ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
export const pref = (k, d) => store.get('pref_' + k, d);
export const setPref = (k, v) => store.set('pref_' + k, v);
