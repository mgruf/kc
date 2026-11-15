/* MÖTE – en sida per möte: deltagare, tidigare möten, uppgifter, anteckningar, beslut, kopplat och mejl.
   Läget "Efter mötet" gör sammanfattning, beslut och vem-gör-vad till anteckning, beslutsrader och uppgifter i ett svep. */
import {
  S, api, emit, refresh, go, $, esc, toast, ymd, parseYmd, addDays, hhmm, DAYS, MONTHS, dayLabel, shortDate,
  ensureRange, cleanTitle, tagHtml, isDateTag, people, personByKey, contactOf, contactLine, initials, notes, claudeUrl, richText, todayStr,
} from '../core.js';
import { taskRow, noteRow, section, empty, openTask, openEvent } from '../ui.js';
import { relatedHtml, eventKey, linkItems } from '../kopplat.js';

const DETAIL = {}, PAST = {};
let mode = {};                       // per möte: 'fore' | 'efter'
const drafts = {};                   // per möte: utkast för Efter mötet

const allEvents = () => [...(S.data?.events || []), ...(S.extraEvents || [])];
const findEv = (id, start) => allEvents().find(e => e.id === id && e.start === start) || allEvents().find(e => e.id === id);
const VIDEO_RE = /(https?:\/\/[^\s<>"]*(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com)[^\s<>"]*)/i;
const mapsUrl = l => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l);
const appleMaps = l => 'https://maps.apple.com/?q=' + encodeURIComponent(l);
const normT = s => cleanTitle(String(s || '')).toLowerCase().replace(/[^a-zåäö0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();

/** Öppnar mötessidan för en händelse. */
export function openMeeting(e) { go('mote/' + encodeURIComponent(e.id) + '/' + encodeURIComponent(e.start)); }

export function render(el, args) {
  const id = args[0], start = args[1] || '';
  const e = findEv(id, start);
  if (!e) {
    // Utanför laddat intervall: hämta veckan kring starten och försök igen.
    if (start) { const d = start.length === 10 ? parseYmd(start) : new Date(start); if (!isNaN(d)) ensureRange(ymd(addDays(d, -1)), ymd(addDays(d, 2))); }
    el.innerHTML = `<div class="crumb"><a href="#/kalender">Kalender</a></div><div class="vhead"><h1>Möte</h1></div>${empty(S.data ? 'Hämtar mötet…' : 'Ingen data än.')}`;
    return;
  }
  const key = eventKey(e);
  if (!DETAIL[key] && e.calId && !String(e.id).startsWith('tmp')) loadDetail(e, key);
  const det = DETAIL[key] && !DETAIL[key].error && !DETAIL[key].loading ? DETAIL[key] : null;
  const att = (det?.attendees || []).filter(a => a.email && !/resource\.calendar\.google\.com$/.test(a.email));
  const emails = att.map(a => a.email);
  if (det && !PAST[key]) loadPast(e, key, emails);

  const day = e.allDay ? e.start : ymd(new Date(e.start));
  const d = parseYmd(day);
  const when = e.allDay ? 'Heldag' : `${hhmm(e.start)}–${hhmm(e.end)}`;
  const desc = det?.description ?? e.description ?? '';
  const loc = det?.location ?? e.location ?? '';
  const video = (VIDEO_RE.exec(loc + ' ' + desc) || [])[1];
  const isPast = !e.allDay ? new Date(e.end) < new Date() : day < todayStr();
  const m = mode[key] || (isPast ? 'efter' : 'fore');
  const tag = (e.tags || []).find(t => !isDateTag(t) && t !== '#PRIVAT') || '';

  // Personer: deltagare matchade mot kontakterna
  const ppl = att.map(a => { const p = personByKey(a.email); return { email: a.email, name: p?.name || a.name || a.email, photo: p?.photo, title: [p?.title, p?.org].filter(Boolean).join(', '), status: a.status, known: !!p }; });
  const tasks = (S.data?.tasks || []).filter(t => { const c = contactOf(t); return c && emails.includes(c.email.toLowerCase()); });
  const nt = normT(e.title);
  const dtag = '#' + day.slice(2).replace(/-/g, '');
  const names = ppl.filter(p => p.name.includes(' ')).map(p => p.name.toLowerCase());
  const ns = notes().filter(n => {
    const T = normT(n.title), X = String(n.excerpt || '').toLowerCase();
    return (nt.length > 3 && T.includes(nt)) || ((n.tags || []).includes(dtag) && (!tag || (n.tags || []).includes(tag)))
      || emails.some(em => X.includes(em)) || names.some(nm => X.includes(nm));
  }).slice(0, 12);
  const beslut = (S.data?.collections || []).find(c => c.name === 'Beslut');
  const besRows = beslut ? beslut.rows.filter(r => r['Datum'] === day && (!tag || String(r['Projekt'] || '').toUpperCase().includes(tag))) : [];
  const past = PAST[key]?.events || [];

  const statusTxt = { accepted: 'kommer', yes: 'kommer', declined: 'kommer inte', no: 'kommer inte', tentative: 'kanske', maybe: 'kanske', invited: 'inbjuden', needs_action: 'har inte svarat', owner: 'arrangör' };
  const pplHtml = !det ? `<p class="empty">${DETAIL[key]?.error ? 'Deltagarna kunde inte hämtas: ' + esc(DETAIL[key].error) : 'Hämtar deltagare…'}</p>`
    : ppl.length ? ppl.map(p => `<a class="mt-p" href="#/person/${encodeURIComponent(p.email)}"><span class="avatar" style="width:30px;height:30px;font-size:11px">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name))}</span><span class="mt-pn"><b>${esc(p.name)}</b><small>${esc(p.title || p.email)}</small></span><span class="mt-st st-${esc(p.status)}">${esc(statusTxt[p.status] || p.status || '')}</span></a>`).join('')
    : `<p class="empty">Inga inbjudna deltagare.</p>`;

  el.innerHTML = `<div class="crumb"><a href="#/kalender/dag/${day}">Kalender · ${esc(DAYS[d.getDay()])} ${d.getDate()} ${esc(MONTHS[d.getMonth()])}</a></div>
  <header class="mt-head">
    <div class="mt-tt"><h1>${esc(cleanTitle(e.title))}</h1>
      <div class="mt-meta"><span>${esc(dayLabel(day))} · ${esc(when)}</span><span>${esc(e.cal || '')}</span>${tag ? `<span class="tags">${tagHtml([tag])}</span>` : ''}${e.recurring ? '<span>Återkommande</span>' : ''}</div>
      ${loc && !/^https?:/.test(loc) ? `<div class="mt-loc"><span>${esc(loc)}</span><a href="${esc(mapsUrl(loc))}" target="_blank" rel="noopener">Google Maps</a><a href="${esc(appleMaps(loc))}" target="_blank" rel="noopener">Apple Kartor</a></div>` : ''}
    </div>
    <div class="mt-act">
      ${video ? `<a class="btn solid" href="${esc(video)}" target="_blank" rel="noopener">Anslut</a>` : ''}
      <button class="btn" data-mt-note>Mötesanteckning</button>
      <button class="btn" data-mt-task>+ Uppgift</button>
      <button class="btn" data-mt-edit>Redigera</button>
      <a class="btn" href="${esc(claudeUrl(ctxText(e, ppl, tasks, desc)))}" target="_blank" rel="noopener">Fråga Claude</a>
    </div>
  </header>
  <div class="seg mt-seg" role="group"><button data-mt-mode="fore" class="${m === 'fore' ? 'on' : ''}">Inför och under</button><button data-mt-mode="efter" class="${m === 'efter' ? 'on' : ''}">Efter mötet</button></div>
  ${m === 'efter' ? afterHtml(key, e, ppl, tag) : ''}
  <div class="mt-grid"><div>
    ${section('mt_p', 'Deltagare', det ? ppl.length : null, pplHtml)}
    ${section('mt_b', 'Beslut', besRows.length, `${besRows.map(r => `<a class="item" href="#/samling/Beslut/${encodeURIComponent(r._id)}"><div class="glyph">◆</div><div class="main"><div class="title">${esc(r['Beslut'])}</div>${r['Varför'] ? `<div class="sub">${esc(String(r['Varför']).slice(0, 120))}</div>` : ''}</div></a>`).join('')}
      ${beslut ? `<form class="mt-qb" data-mt-beslut><input placeholder="Logga ett beslut – Enter sparar, skriv nästa direkt" autocomplete="off"></form>` : '<p class="empty">Samlingen Beslut finns inte än.</p>'}`)}
    ${section('mt_t', 'Öppna uppgifter med deltagarna', tasks.length, tasks.length ? tasks.map(t => taskRow(t)).join('') : empty(det ? 'Inga öppna uppgifter med deltagarna.' : '…'))}
    ${section('mt_past', 'Tidigare möten', PAST[key]?.events ? past.length : null, !PAST[key] ? '<p class="empty">Söker…</p>' : PAST[key].error ? empty('Kunde inte söka: ' + esc(PAST[key].error)) : past.length
      ? past.slice(0, 12).map(x => `<a class="item" href="#/mote/${encodeURIComponent(x.id)}/${encodeURIComponent(x.start)}"><div class="time"><small>${esc(shortDate(x.allDay ? x.start : ymd(new Date(x.start))))}</small>${x.allDay ? '' : hhmm(x.start)}</div><div class="main"><div class="title">${esc(cleanTitle(x.title))}</div><div class="sub">${esc(x.why)}<i class="sep">·</i>${esc(x.cal)}</div></div></a>`).join('')
      : empty('Inga tidigare möten med samma titel eller deltagare (senaste halvåret).'))}
  </div><div>
    ${desc ? section('mt_d', 'Agenda och beskrivning', null, `<div class="prose mt-desc">${richText(desc)}</div>`) : ''}
    ${section('mt_n', 'Anteckningar', ns.length, ns.length ? ns.map(noteRow).join('') : empty('Inga anteckningar hittades för mötet. Skapa en med Mötesanteckning.'))}
    ${relatedHtml('event', key, cleanTitle(e.title))}
    ${emails.length ? `<section class="sec" data-sec="mt_m"><h2><span class="h">Mejl med deltagarna</span></h2><div class="body"><div data-mailbox='${esc(JSON.stringify({ emails: emails.slice(0, 8), max: 8, none: 'Inga mejl med deltagarna.' }))}'></div></div></section>` : ''}
  </div></div>`;
  bind(el, e, key, ppl, tag, day, desc);
}

function ctxText(e, ppl, tasks, desc) {
  return [`Möte: ${cleanTitle(e.title)} (${e.allDay ? e.start : new Date(e.start).toLocaleString('sv-SE')})`, e.location ? 'Plats: ' + e.location : '',
    ppl.length ? 'Deltagare: ' + ppl.map(p => p.name).join(', ') : '', desc ? 'Agenda:\n' + String(desc).slice(0, 1500) : '',
    tasks.length ? 'Öppna uppgifter med deltagarna:\n' + tasks.map(t => '- ' + t.title).join('\n') : ''].filter(Boolean).join('\n');
}

// ---------- efter mötet ----------
function afterHtml(key, e, ppl, tag) {
  const dr = drafts[key] ||= { summary: '', beslut: [''], todo: [{ text: '', who: '', due: '' }] };
  const opts = sel => `<option value="" ${!sel ? 'selected' : ''}>Jag</option>${ppl.map(p => `<option value="${esc(p.email)}" ${sel === p.email ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  return `<section class="mt-after">
    <h3>Efter mötet</h3><p class="hint">Fyll i det som kom ut av mötet. Spara skapar en anteckning i Notes, beslut i samlingen Beslut och uppgifter${tag ? ' taggade ' + esc(tag) : ''} – delegerade uppgifter hamnar i väntelistan med kontaktrad.</p>
    <label class="lbl">Sammanfattning</label><textarea data-af="summary" rows="3" placeholder="Vad kom vi fram till?">${esc(dr.summary)}</textarea>
    <label class="lbl">Beslut</label>${dr.beslut.map((b, i) => `<input data-af="beslut" data-i="${i}" value="${esc(b)}" placeholder="Beslut ${i + 1}">`).join('')}
    <button class="addrow" data-af-add="beslut">+ Beslut</button>
    <label class="lbl">Vem gör vad</label>${dr.todo.map((t, i) => `<div class="mt-todo"><input data-af="todo-text" data-i="${i}" value="${esc(t.text)}" placeholder="Uppgift"><select data-af="todo-who" data-i="${i}">${opts(t.who)}</select><input type="date" data-af="todo-due" data-i="${i}" value="${esc(t.due)}"></div>`).join('')}
    <button class="addrow" data-af-add="todo">+ Uppgift</button>
    <div class="actions"><span class="spacer"></span><button class="ghost" data-af-clear>Töm</button><button data-af-save>Spara allt</button></div>
  </section>`;
}

async function saveAfter(e, key, ppl, tag, day) {
  const dr = drafts[key]; if (!dr) return;
  const beslut = dr.beslut.map(s => s.trim()).filter(Boolean);
  const todos = dr.todo.filter(t => t.text.trim());
  if (!dr.summary.trim() && !beslut.length && !todos.length) return toast('Inget att spara');
  const dtag = '#' + day.slice(2).replace(/-/g, '');
  const who = em => ppl.find(p => p.email === em);
  const lists = S.data?.taskLists || [];
  const inbox = lists.find(l => l._src === (e._src || 'jobb') && /INBOX/i.test(l.title));
  const wait = lists.find(l => l._src === (e._src || 'jobb') && /VÄNTAR|DELEGAT/i.test(l.title));
  const title = cleanTitle(e.title);
  let ok = 0;
  try {
    const text = [`${dtag}${tag ? ' ' + tag : ''}`, `${/^möte\b/i.test(title) ? '' : 'Möte '}${title} – ${dayLabel(day)}`, ppl.length ? 'Deltagare: ' + ppl.map(p => p.name).join(', ') : '',
      dr.summary.trim() ? '\nSammanfattning:\n' + dr.summary.trim() : '', beslut.length ? '\nBeslut:\n' + beslut.map(b => '- ' + b).join('\n') : '',
      todos.length ? '\nVem gör vad:\n' + todos.map(t => `- ${t.text.trim()} (${who(t.who)?.name || 'jag'}${t.due ? ', ' + t.due : ''})`).join('\n') : ''].filter(Boolean).join('\n');
    await api('addNote', { title: `Möte ${day.slice(2).replace(/-/g, '')} – ${title.replace(/^möte\s+/i, '')} (efter)`, text }, true); ok++;
    if (beslut.length && (S.data?.collections || []).some(c => c.name === 'Beslut')) {
      await api('saveRows', { collection: 'Beslut', rows: beslut.map(b => ({ values: { 'Beslut': b, 'Projekt': tag, 'Datum': day, 'Varför': `Möte: ${title}`, 'Status': 'Gäller' } })) }, true); ok++;
    }
    for (const t of todos) {
      const p = who(t.who);
      const notesTxt = [p ? contactLine({ name: p.name, email: p.email }) : '', `Från mötet ${title} ${day}`].filter(Boolean).join('\n');
      const r = await api('addTask', { title: [t.text.trim(), tag].filter(Boolean).join(' '), notes: notesTxt, due: t.due || '', listId: (p && wait ? wait.id : inbox?.id) || '' }, true, e._src || 'jobb');
      if (r.id) linkItems({ type: 'event', id: key, title }, { type: 'task', id: r.id, title: t.text.trim() });
      ok++;
    }
    delete drafts[key];
    toast(`Sparat: anteckning${beslut.length ? `, ${beslut.length} beslut` : ''}${todos.length ? `, ${todos.length} uppgifter` : ''}`);
    refresh();
  } catch (err) { toast(`Delvis sparat (${ok}) – ${err.message}`); emit('render'); }
}

// ---------- laddning ----------
async function loadDetail(e, key) {
  DETAIL[key] = { loading: true };
  try { const r = await api('eventDetail', { calendarId: e.calId, id: e.id, start: e.allDay ? '' : e.start }, false, e._src || 'jobb'); DETAIL[key] = r.event; }
  catch (err) { DETAIL[key] = { error: err.message, attendees: [] }; }
  emit('render');
}
async function loadPast(e, key, emails) {
  PAST[key] = { loading: true };
  try {
    const r = await api('pastEvents', { q: cleanTitle(e.title), emails: emails.slice(0, 15), days: 180 }, true, e._src || 'jobb');
    PAST[key] = { events: (r.events || []).filter(x => !(x.id === e.id && x.start === e.start)) };
  } catch (err) { PAST[key] = { error: err.message }; }
  emit('render');
}

// ---------- interaktion ----------
function bind(el, e, key, ppl, tag, day, desc) {
  el.querySelectorAll('[data-mt-mode]').forEach(b => b.onclick = () => { mode[key] = b.dataset.mtMode; emit('render'); });
  el.querySelector('[data-mt-edit]').onclick = () => openEvent(e.id, e.start);
  el.querySelector('[data-mt-task]').onclick = () => {
    const p = ppl.length === 1 ? ppl[0] : null;
    openTask(null, { tag: tag || undefined, contact: p ? { name: p.name, email: p.email } : null, title: '' });
  };
  el.querySelector('[data-mt-note]').onclick = async ev => {
    ev.currentTarget.disabled = true;
    const dtag = '#' + day.slice(2).replace(/-/g, '');
    const text = [`${dtag}${tag ? ' ' + tag : ''}`, `${dayLabel(day)}${e.allDay ? '' : ' ' + hhmm(e.start) + '–' + hhmm(e.end)}${e.location ? ' · ' + e.location : ''}`,
      ppl.length ? 'Deltagare: ' + ppl.map(p => p.name).join(', ') : '', '', 'Agenda:', desc ? String(desc).trim() : '- ', '', 'Anteckningar:', '', 'Beslut:', '', 'Vem gör vad:', ''].join('\n');
    try { await api('addNote', { title: `Möte ${day.slice(2).replace(/-/g, '')} – ${cleanTitle(e.title).replace(/^möte\s+/i, '')}`, text }, true); toast('Köad – skapas i Notes inom 5 min'); }
    catch (err) { toast('Kunde inte skapa – ' + err.message); }
  };
  // Snabba beslut under mötet
  const f = el.querySelector('[data-mt-beslut]');
  if (f) f.onsubmit = async ev => {
    ev.preventDefault();
    const inp = f.querySelector('input'), v = inp.value.trim(); if (!v) return;
    inp.value = '';
    const coll = S.data.collections.find(c => c.name === 'Beslut');
    const row = { _id: 'tmp' + Date.now(), 'Beslut': v, 'Projekt': tag, 'Datum': day, 'Varför': `Möte: ${cleanTitle(e.title)}`, 'Status': 'Gäller', _src: coll._src };
    coll.rows.push(row);
    try { const r = await api('saveRow', { collection: 'Beslut', values: { 'Beslut': v, 'Projekt': tag, 'Datum': day, 'Varför': row['Varför'], 'Status': 'Gäller' } }, true, coll._src || 'jobb'); row._id = r.id; toast('Beslut loggat'); }
    catch (err) { coll.rows = coll.rows.filter(x => x !== row); toast('Kunde inte spara – ' + err.message); }
    emit('render');
    setTimeout(() => el.querySelector('[data-mt-beslut] input')?.focus(), 0);
  };
  // Efter mötet: utkastet följer med när sidan ritas om
  const dr = drafts[key];
  el.querySelectorAll('[data-af]').forEach(i => i.addEventListener('input', () => {
    if (!dr) return;
    const k = i.dataset.af, n = Number(i.dataset.i);
    if (k === 'summary') dr.summary = i.value;
    if (k === 'beslut') dr.beslut[n] = i.value;
    if (k === 'todo-text') dr.todo[n].text = i.value;
    if (k === 'todo-due') dr.todo[n].due = i.value;
  }));
  el.querySelectorAll('select[data-af="todo-who"]').forEach(s => s.onchange = () => { dr.todo[Number(s.dataset.i)].who = s.value; });
  el.querySelectorAll('[data-af-add]').forEach(b => b.onclick = () => { if (b.dataset.afAdd === 'beslut') dr.beslut.push(''); else dr.todo.push({ text: '', who: '', due: '' }); emit('render'); });
  el.querySelector('[data-af-clear]')?.addEventListener('click', () => { delete drafts[key]; emit('render'); });
  el.querySelector('[data-af-save]')?.addEventListener('click', ev => { ev.currentTarget.disabled = true; saveAfter(e, key, ppl, tag, day); });
}

export function context(args) {
  const e = findEv(args[0], args[1]);
  return e ? `Möte: ${cleanTitle(e.title)} ${e.allDay ? e.start : new Date(e.start).toLocaleString('sv-SE')}` : 'Möte';
}
export function key(e, args) {
  if (e.key === 'e') { const ev = findEv(args[0], args[1]); if (ev) openEvent(ev.id, ev.start); }
  if (e.key === 'b') { e.preventDefault(); document.querySelector('[data-mt-beslut] input')?.focus(); }
  if (e.key === 'a') { const ev = findEv(args[0], args[1]); if (ev) { mode[eventKey(ev)] = 'efter'; emit('render'); } }
}
