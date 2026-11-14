/* KC – team: koppla personer (crew, skådespelare, leverantörer…) till projekt på några sekunder.
   Sparas som rad i samlingen 'Team' och som kontaktetikett "<TAGG> · <roll>" i Google Kontakter. */
import { S, api, emit, $, $$, esc, toast, people, personIn, initials, firstName, tagColor, tagHtml, loadContacts, shortDate, projects, knownTags } from '../core.js';

export const TYPES = ['Crew', 'Skådespelare', 'Leverantör', 'Manus', 'Regi', 'Producent', 'Beställare', 'Finansiär', 'Övrigt'];
export const DEPTS = ['Produktion', 'Regi', 'Foto', 'Ljus', 'Grip', 'Ljud', 'Scenografi', 'Rekvisita', 'Kostym', 'Mask', 'Location', 'Casting', 'Stunt', 'SFX', 'VFX', 'Klipp', 'Ljudpost', 'Musik', 'Post', 'Transport', 'Catering', 'Övrigt'];
const STATUS = ['Förfrågad', 'Intresserad', 'Bekräftad', 'Kontrakterad', 'Avböjd'];
const up = s => String(s || '').toUpperCase();
const coll = () => (S.data?.collections || []).find(c => c.name === 'Team');
const normTag = t => { t = up(String(t || '').trim()); return t ? (t.startsWith('#') ? t : '#' + t) : ''; };
const tagsOf = v => String(v || '').split(/[\s,]+/).map(normTag).filter(Boolean);

/** Teamrader för ett projekt. */
export function teamFor(tag) { const c = coll(); return c ? c.rows.filter(r => tagsOf(r['Projekt']).includes(normTag(tag))) : []; }
const personOf = r => personIn(r['Person']) || { name: String(r['Person'] || ''), email: '' };
const contactFor = email => (S.contacts?.list || []).find(c => (c.emails || []).some(e => e.toLowerCase() === String(email || '').toLowerCase()));
const labelFor = (tag, v) => `${normTag(tag)} · ${v['Roll'] || v['Avdelning'] || v['Typ'] || 'Team'}`;
const av = (name, photo, size = 34) => `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .36)}px">${photo ? `<img src="${esc(photo)}" alt="">` : esc(initials(name))}</span>`;

/** Rollförslag ur produktionen och manuset. */
function roleSuggestions(tag) {
  const pr = S.prod[tag] || {};
  const a = (pr.roles || []).map(r => r.name).filter(Boolean);
  (pr.manus || []).forEach(sc => (sc.roles || []).forEach(r => a.push(r.name)));
  return [...new Set(a.map(x => String(x).trim()).filter(Boolean))].slice(0, 300);
}

// ---------- sök person ----------
function matchPeople(q, limit = 8) {
  const s = q.trim().toLowerCase(); if (s.length < 2) return [];
  const words = s.split(/\s+/);
  const out = [];
  for (const p of people()) {
    const hay = [p.name, p.email, p.org, p.title, ...(p.phones || [])].join(' ').toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    const n = String(p.name || '').toLowerCase();
    out.push({ p, sc: n.startsWith(s) ? 3 : n.split(' ').some(x => x.startsWith(words[0])) ? 2 : 1 });
    if (out.length > 200) break;
  }
  return out.sort((a, b) => b.sc - a.sc).slice(0, limit).map(x => x.p);
}

// ---------- formulär (inline och i dialog) ----------
const F = {};   // formtillstånd per formid
function formHtml(id, tag, preset = {}) {
  const f = F[id] ||= { q: '', person: null, typ: preset.typ || 'Crew', avd: preset.avd || '', roll: preset.roll || '', status: preset.status || 'Bekräftad', newp: null, row: preset.row || null, tag: tag || preset.tag || '' };
  const tags = knownTags();
  const sugg = f.typ === 'Skådespelare' ? roleSuggestions(f.tag) : [];
  return `<div class="tm-form" data-tmform="${id}">
    ${tag ? '' : `<label class="tm-l">Projekt<select data-tmf="tag">${['', ...tags].map(t => `<option value="${esc(t)}" ${t === f.tag ? 'selected' : ''}>${t ? esc(projects().find(p => p.tag === t)?.name || t) : 'Välj projekt…'}</option>`).join('')}</select></label>`}
    ${f.person ? `<div class="tm-picked">${av(f.person.name, f.person.photo)}<div><b>${esc(f.person.name)}</b><small>${esc([f.person.title, f.person.org].filter(Boolean).join(', ') || f.person.email || '')}</small></div>${f.row ? '' : '<button type="button" class="btn" data-tmclear>Byt</button>'}</div>`
      : f.newp ? `<div class="tm-new"><input data-tmf="nname" value="${esc(f.newp.name)}" placeholder="Namn"><input data-tmf="nemail" value="${esc(f.newp.email)}" placeholder="E-post" type="email"><input data-tmf="nphone" value="${esc(f.newp.phone)}" placeholder="Telefon"><button type="button" class="btn" data-tmclear>Avbryt</button></div>`
      : `<div class="tm-search"><input data-tmq value="${esc(f.q)}" placeholder="Lägg till person – skriv namn, e-post eller telefon…" autocomplete="off"><div class="tm-sugg" data-tmsugg></div></div>`}
    ${f.person || f.newp ? `<div class="tm-chips">${TYPES.map(t => `<button type="button" class="chip ${t === f.typ ? 'on' : ''}" data-tmtyp="${t}">${t}</button>`).join('')}</div>
      <div class="tm-row">
        ${f.typ === 'Crew' ? `<select data-tmf="avd"><option value="">Avdelning…</option>${DEPTS.map(d => `<option ${d === f.avd ? 'selected' : ''}>${d}</option>`).join('')}</select>` : ''}
        <input data-tmf="roll" value="${esc(f.roll)}" placeholder="${f.typ === 'Skådespelare' ? 'Roll i manuset' : f.typ === 'Leverantör' ? 'Vad levererar de?' : 'Roll / titel'}" list="tmRoles_${id}" autocomplete="off">
        <datalist id="tmRoles_${id}">${sugg.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
        <select data-tmf="status">${STATUS.map(s => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button type="button" class="btn solid" data-tmsave>${f.row ? 'Spara' : 'Lägg till'}</button>
      </div>` : ''}
  </div>`;
}
function drawSugg(id) {
  const f = F[id], box = document.querySelector(`[data-tmform="${id}"] [data-tmsugg]`); if (!box) return;
  const list = matchPeople(f.q);
  f._list = list; f._sel = Math.min(f._sel || 0, list.length);
  box.innerHTML = f.q.trim().length < 2 ? '' : list.map((p, i) => `<button type="button" class="tm-opt ${i === f._sel ? 'on' : ''}" data-tmpick="${i}">${av(p.name, p.photo, 26)}<span><b>${esc(p.name)}</b><small>${esc([p.title, p.org].filter(Boolean).join(', ') || p.email || (p.phones || [])[0] || '')}</small></span></button>`).join('')
    + `<button type="button" class="tm-opt ${f._sel === list.length ? 'on' : ''}" data-tmnew><span class="avatar" style="width:26px;height:26px;font-size:14px">+</span><span><b>Ny kontakt: ${esc(f.q.trim())}</b><small>Skapas i Google Kontakter</small></span></button>`;
}
const redrawForm = id => { const el = document.querySelector(`[data-tmform="${id}"]`); if (!el) return; const tag = F[id].tag; el.outerHTML = formHtml(id, el.closest('dialog') ? '' : tag); const i = document.querySelector(`[data-tmform="${id}"] [data-tmq], [data-tmform="${id}"] [data-tmf="roll"]`); i?.focus(); };

async function saveForm(id) {
  const f = F[id]; const tag = normTag(f.tag);
  if (!tag) return toast('Välj projekt');
  let person = f.person;
  try {
    if (!person && f.newp) {
      if (!f.newp.name.trim()) return toast('Skriv ett namn');
      const r = await api('saveContact', { contact: { name: f.newp.name.trim(), emails: [f.newp.email.trim()].filter(Boolean), phones: [f.newp.phone.trim()].filter(Boolean) } }, true);
      person = { ...r.contact, email: (r.contact.emails[0] || '').toLowerCase() };
      (S.contacts ||= { list: [] }).list.push(r.contact);
    }
    if (!person) return toast('Välj en person');
    if (!person.id && person.email) {   // person från en uppgift: blir kontakt så att etiketten kan sättas
      const c = contactFor(person.email);
      if (c) person = { ...person, id: c.id };
      else { const r = await api('saveContact', { contact: { name: person.name, emails: [person.email] } }, true); person = { ...person, id: r.contact.id }; S.contacts?.list?.push(r.contact); }
    }
    const values = { Person: person.email && person.name !== person.email ? `${person.name} <${person.email}>` : (person.email || person.name), Projekt: tag, Typ: f.typ, Avdelning: f.typ === 'Crew' ? f.avd : '', Roll: f.roll.trim(), Status: f.status };
    const c = coll(); if (!c) return toast('Samlingen Team saknas – kör setup i Apps Script');
    const old = f.row;
    let row = old || { _id: 'tmp' + Date.now(), _src: c._src };
    Object.assign(row, values, { pending: true }); if (!old) c.rows.push(row);
    delete F[id]; emit('render');
    $('#teamDlg')?.open && $('#teamDlg').close();
    const r = await api('saveRow', { collection: 'Team', id: old ? old._id : '', values }, true, c._src || 'jobb');
    row._id = r.id; row.pending = false;
    if (person.id) {
      const nl = labelFor(tag, values), ol = old ? labelFor(tag, old._prev || {}) : null;
      if (ol && ol !== nl) api('labelContact', { id: person.id, label: ol, on: false }, true).catch(() => {});
      await api('labelContact', { id: person.id, label: nl, on: true }, true);
      const cc = (S.contacts?.list || []).find(x => x.id === person.id); if (cc && !cc.labels.includes(nl)) cc.labels.push(nl);
    }
    toast(`${firstName(person.name)} är tillagd i ${tag.slice(1)}`); emit('render');
  } catch (e) { toast('Kunde inte spara – ' + e.message); }
}

// ---------- dialog ----------
export function openTeamAdd(preset = {}) {
  let d = $('#teamDlg');
  if (!d) { document.body.insertAdjacentHTML('beforeend', `<dialog id="teamDlg" class="sheet tm-dlg"><h2 id="tmDlgT">Lägg till i projekt</h2><div id="tmDlgB"></div><div class="actions"><span class="spacer"></span><button class="ghost" data-tmclose>Stäng</button></div></dialog>`); d = $('#teamDlg'); d.addEventListener('click', e => { if (e.target.closest('[data-tmclose]')) d.close(); }); }
  if (!S.contacts) loadContacts();
  const id = 'dlg';
  delete F[id];
  F[id] = { q: '', person: null, typ: preset.typ || 'Crew', avd: preset.avd || '', roll: preset.roll || '', status: preset.status || 'Bekräftad', newp: null, row: null, tag: preset.tag || '' };
  if (preset.person) F[id].person = preset.person;
  if (preset.row) {
    const r = preset.row, p = personOf(r), c = contactFor(p.email);
    Object.assign(F[id], { row: r, person: { ...(c || {}), name: p.name, email: p.email.toLowerCase(), id: c?.id || null }, typ: r['Typ'] || 'Crew', avd: r['Avdelning'] || '', roll: r['Roll'] || '', status: r['Status'] || 'Bekräftad', tag: tagsOf(r['Projekt'])[0] || preset.tag });
    r._prev = { ...r };
  }
  $('#tmDlgT').textContent = preset.row ? 'Ändra i teamet' : preset.tag ? `Lägg till i ${projects().find(p => p.tag === preset.tag)?.name || preset.tag}` : 'Lägg till i projekt';
  $('#tmDlgB').innerHTML = formHtml(id, '', {});
  d.showModal();
  setTimeout(() => $('#tmDlgB [data-tmq], #tmDlgB [data-tmf="roll"]')?.focus(), 40);
}

// ---------- projektfliken Team ----------
const V = { q: '', typ: '', paste: false, pasteText: '', pasteRows: null };
export function renderTeam(el, p, args = []) {
  if (!S.contacts) loadContacts();
  const tag = p.tag;
  const rows = teamFor(tag);
  const q = V.q.toLowerCase();
  const list = rows.filter(r => (!V.typ || r['Typ'] === V.typ) && (!q || [r['Person'], r['Roll'], r['Avdelning'], r['Typ']].join(' ').toLowerCase().includes(q)));
  const id = 'tab_' + tag;
  if (!F[id] || F[id].tag !== tag) F[id] = { q: '', person: null, typ: 'Crew', avd: '', roll: '', status: 'Bekräftad', newp: null, row: null, tag };
  const groups = {};
  list.forEach(r => { const k = r['Typ'] === 'Crew' ? 'Crew · ' + (r['Avdelning'] || 'Övrigt') : (r['Typ'] || 'Övrigt'); (groups[k] ||= []).push(r); });
  const order = k => { const t = k.split(' · ')[0]; const i = TYPES.indexOf(t); const d = DEPTS.indexOf(k.split(' · ')[1]); return (i < 0 ? 99 : i) * 100 + (d < 0 ? 0 : d); };
  const counts = TYPES.map(t => [t, rows.filter(r => r['Typ'] === t).length]).filter(x => x[1]);
  const keep = document.activeElement?.matches?.('[data-tmq], [data-tmsearch]') ? document.activeElement.matches('[data-tmq]') ? 'q' : 's' : null;
  el.innerHTML = `<div class="tm" data-tmtag="${esc(tag)}">
    ${coll() ? '' : '<div class="notice">Samlingen Team finns inte än. Kör <b>setup</b> i Apps Script och gör en ny version, så skapas den.</div>'}
    ${formHtml(id, tag)}
    <div class="tm-tools">
      <div class="chips"><button class="chip ${!V.typ ? 'on' : ''}" data-tmfilter="">Alla <span>${rows.length}</span></button>${counts.map(([t, n]) => `<button class="chip ${V.typ === t ? 'on' : ''}" data-tmfilter="${t}">${t} <span>${n}</span></button>`).join('')}</div>
      <div class="tm-acts"><input class="tsearch" data-tmsearch value="${esc(V.q)}" placeholder="Filtrera…"><button class="btn" data-tmpaste>Klistra in lista</button><button class="btn" data-tmcopy>Kopiera kontaktlista</button><button class="btn" data-tmcsv>CSV</button></div>
    </div>
    ${V.paste ? pasteHtml(tag) : ''}
    ${list.length ? Object.keys(groups).sort((a, b) => order(a) - order(b)).map(k => `<section class="tm-grp"><h4>${esc(k)}<span>${groups[k].length}</span></h4>${groups[k].map(r => rowHtml(r)).join('')}</section>`).join('')
      : `<p class="empty">${rows.length ? 'Ingen matchar filtret.' : 'Ingen kopplad än. Skriv ett namn i fältet ovan – det tar fem sekunder.'}</p>`}
  </div>`;
  if (keep === 'q') { const i = el.querySelector('[data-tmq]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); drawSugg(id); } }
  if (keep === 's') { const i = el.querySelector('[data-tmsearch]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
  bindOnce();
}
function rowHtml(r) {
  const p = personOf(r), c = contactFor(p.email);
  const phone = (c?.phones || [])[0];
  return `<div class="tm-r ${r.pending ? 'pending' : ''}">${av(p.name, c?.photo)}
    <div class="main"><a class="title" href="#/person/${encodeURIComponent((p.email || p.name).toLowerCase())}">${esc(p.name)}</a>
      <div class="sub">${esc([r['Roll'], r['Typ'] !== 'Crew' ? '' : r['Avdelning']].filter(Boolean).join(' · ') || r['Typ'] || '')}${r['Status'] ? `<span class="tm-st tm-st-${esc(String(r['Status']).toLowerCase())}">${esc(r['Status'])}</span>` : ''}${r['Från'] ? `<span class="hint">${esc(shortDate(r['Från']))}${r['Till'] ? '–' + esc(shortDate(r['Till'])) : ''}</span>` : ''}</div></div>
    <div class="tm-ra">${phone ? `<a class="btn" href="tel:${esc(phone.replace(/\s/g, ''))}" title="${esc(phone)}">Ring</a>` : ''}${p.email ? `<a class="btn" href="mailto:${esc(p.email)}">Mejla</a>` : ''}<button class="btn" data-tmedit="${esc(r._id)}">Ändra</button><button class="btn tm-x" data-tmdel="${esc(r._id)}" title="Ta bort ur teamet">×</button></div></div>`;
}

// ---------- klistra in lista ----------
function pasteHtml(tag) {
  const rows = V.pasteRows;
  return `<div class="card tm-paste">
    <p class="hint">En person per rad: <b>Namn, roll, e-post, telefon</b> – kommaseparerat eller kopierat direkt från ett kalkylark. Typ och avdelning gissas från rollen; ändra i förhandsvisningen.</p>
    <textarea data-tmpastetext rows="6" placeholder="Anna Andersson, Fotograf, anna@exempel.se, 070-000 00 00">${esc(V.pasteText)}</textarea>
    <div class="actions"><button class="ghost" data-tmpasteclose>Stäng</button><span class="spacer"></span><button class="btn" data-tmpasteparse>Förhandsvisa</button></div>
    ${rows ? `<div class="mn-tablewrap"><table class="mn-table tm-ptable"><thead><tr><th>Namn</th><th>Kontakt</th><th>Typ</th><th>Avdelning</th><th>Roll</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td><b>${esc(r.name)}</b><small>${esc(r.email || '')}${r.phone ? ' · ' + esc(r.phone) : ''}</small></td>
        <td>${r.match ? `<span class="tm-st tm-st-bekräftad">Finns</span>` : '<span class="tm-st">Ny</span>'}</td>
        <td><select data-tmprow="${i}" data-k="typ">${TYPES.map(t => `<option ${t === r.typ ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><select data-tmprow="${i}" data-k="avd"><option value=""></option>${DEPTS.map(d => `<option ${d === r.avd ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
        <td><input data-tmprow="${i}" data-k="roll" value="${esc(r.roll)}"></td></tr>`).join('')}
      </tbody></table></div><div class="actions"><span class="spacer"></span><button class="btn solid" data-tmpastesave>Lägg till ${rows.length} i ${esc(tag.slice(1))}</button></div>` : ''}
  </div>`;
}
const DEPT_HINT = [[/foto|kamera|dop|focus|fokus|b-?foto|c-?foto|dit|video ?ass/i, 'Foto'], [/gaffer|ljus|el(?:ektriker)?|best boy/i, 'Ljus'], [/grip|dolly/i, 'Grip'], [/ljud|boom|sound/i, 'Ljud'], [/scenograf|scenbyg|art dir|propsmaker|set dec/i, 'Scenografi'], [/rekvisit|props/i, 'Rekvisita'], [/kostym|costume|wardrobe|påklädare/i, 'Kostym'], [/mask|smink|hår|make.?up|hair/i, 'Mask'], [/location|inspelningsplats/i, 'Location'], [/casting|rollsätt/i, 'Casting'], [/stunt/i, 'Stunt'], [/sfx|specialeffekt|pyro/i, 'SFX'], [/vfx/i, 'VFX'], [/klipp|editor/i, 'Klipp'], [/regiass|ad\b|1st|2nd|script|skript|regi/i, 'Regi'], [/produktionsled|prod\.?ass|runner|koordinator|line prod|produktion/i, 'Produktion'], [/transport|chaufför|förare/i, 'Transport'], [/catering|kock/i, 'Catering']];
function parsePaste(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const parts = (l.includes('\t') ? l.split('\t') : l.split(/\s*[,;]\s*/)).map(x => x.trim());
    const email = parts.find(x => /@/.test(x)) || '';
    const phone = parts.find(x => /^[+\d][\d\s-]{6,}$/.test(x)) || '';
    const rest = parts.filter(x => x && x !== email && x !== phone);
    const name = rest[0] || email, roll = rest[1] || '';
    const m = (email && contactFor(email)) || people().find(p => String(p.name).toLowerCase() === name.toLowerCase());
    const dept = (DEPT_HINT.find(([re]) => re.test(roll)) || [])[1] || '';
    const typ = /skådespel|actor|roll:/i.test(roll) ? 'Skådespelare' : /leverant|ab\b|hyr/i.test(roll) ? 'Leverantör' : 'Crew';
    return { name, email: email || (m?.emails || [m?.email])[0] || '', phone, roll, match: m || null, typ, avd: typ === 'Crew' ? dept : '' };
  });
}
async function savePaste(tag) {
  const rows = V.pasteRows || []; const c = coll(); if (!c || !rows.length) return;
  const btn = $('[data-tmpastesave]'); if (btn) { btn.disabled = true; btn.textContent = 'Sparar…'; }
  try {
    for (const r of rows) {        // nya kontakter först
      if (!r.match || !r.match.id) {
        const ex = r.email && contactFor(r.email);
        if (ex) r.match = ex;
        else { const x = await api('saveContact', { contact: { name: r.name, emails: [r.email].filter(Boolean), phones: [r.phone].filter(Boolean) } }, true); r.match = x.contact; S.contacts?.list?.push(x.contact); }
      }
    }
    const payload = rows.map(r => ({ values: { Person: r.email ? `${r.name} <${r.email}>` : r.name, Projekt: tag, Typ: r.typ, Avdelning: r.avd, Roll: r.roll, Status: 'Bekräftad' } }));
    const res = await api('saveRows', { collection: 'Team', rows: payload }, true, c._src || 'jobb');
    payload.forEach((x, i) => c.rows.push({ _id: res.ids?.[i] || 'tmp' + i, _src: c._src, ...x.values }));
    await Promise.all(rows.map(r => r.match?.id ? api('labelContact', { id: r.match.id, label: labelFor(tag, { Roll: r.roll, Avdelning: r.avd, Typ: r.typ }), on: true }, true).catch(() => {}) : null));
    toast(`${rows.length} personer tillagda`); V.paste = false; V.pasteRows = null; V.pasteText = ''; emit('render');
  } catch (e) { toast('Kunde inte spara – ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Försök igen'; } }
}

function csv(tag) {
  const rows = teamFor(tag);
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Namn', 'E-post', 'Telefon', 'Typ', 'Avdelning', 'Roll', 'Status'].map(q).join(',')];
  rows.forEach(r => { const p = personOf(r), c = contactFor(p.email); lines.push([p.name, p.email, (c?.phones || [])[0] || '', r['Typ'], r['Avdelning'], r['Roll'], r['Status']].map(q).join(',')); });
  return lines.join('\n');
}

// ---------- personsidan ----------
/** HTML-sektion för personsidan: projekt personen är kopplad till + knapp. */
export function personProjects(person) {
  const c = coll();
  const emails = (person.emails || [person.email]).filter(Boolean).map(e => String(e).toLowerCase());
  const rows = c ? c.rows.filter(r => { const p = personOf(r); return emails.includes(String(p.email || '').toLowerCase()) || (!p.email && p.name && p.name === person.name); }) : [];
  const preset = { person: { id: person.id || null, name: person.name, email: (emails[0] || ''), photo: person.photo || '', title: person.title, org: person.org } };
  return `<section class="sec tm-pp" data-sec="pteam"><h2><span class="h">Projekt och roller</span><span class="n">${rows.length}</span><button class="act btn" data-team-add='${esc(JSON.stringify(preset))}'>+ Lägg till i projekt</button></h2><div class="body">
    ${rows.length ? rows.map(r => `<div class="item"><div class="glyph">◆</div><div class="main"><div class="title">${esc(r['Roll'] || r['Avdelning'] || r['Typ'] || '')}<span class="tags">${tagHtml(tagsOf(r['Projekt']))}</span></div>
      <div class="sub">${esc(r['Typ'] || '')}${r['Avdelning'] ? ' · ' + esc(r['Avdelning']) : ''}${r['Status'] ? `<span class="tm-st tm-st-${esc(String(r['Status']).toLowerCase())}">${esc(r['Status'])}</span>` : ''}</div></div></div>`).join('') : '<p class="empty">Inte kopplad till något projekt än.</p>'}
  </div></section>`;
}

// ---------- händelser ----------
let bound = false;
function formId(el) { return el.closest('[data-tmform]')?.dataset.tmform; }
function bindOnce() {
  if (bound) return; bound = true;
  document.addEventListener('input', e => {
    const t = e.target;
    const id = formId(t);
    if (id && t.matches('[data-tmq]')) { F[id].q = t.value; F[id]._sel = 0; drawSugg(id); return; }
    if (id && t.matches('[data-tmf]')) { const k = t.dataset.tmf, f = F[id]; if (k === 'nname' || k === 'nemail' || k === 'nphone') f.newp[k.slice(1)] = t.value; else if (k === 'tag') { f.tag = t.value; } else f[k] = t.value; return; }
    if (t.matches('.tm [data-tmsearch]')) { V.q = t.value; clearTimeout(t._t); t._t = setTimeout(() => emit('render'), 200); return; }
    if (t.matches('[data-tmpastetext]')) { V.pasteText = t.value; return; }
    if (t.matches('[data-tmprow]')) { V.pasteRows[t.dataset.tmprow][t.dataset.k] = t.value; }
  });
  document.addEventListener('change', e => { const t = e.target; if (t.matches('[data-tmprow]')) V.pasteRows[t.dataset.tmprow][t.dataset.k] = t.value; const id = formId(t); if (id && t.matches('select[data-tmf]')) { F[id][t.dataset.tmf] = t.value; if (t.dataset.tmf === 'tag') redrawForm(id); } });
  document.addEventListener('keydown', e => {
    const t = e.target, id = formId(t); if (!id) return;
    const f = F[id];
    if (t.matches('[data-tmq]')) {
      const n = (f._list || []).length;
      if (e.key === 'ArrowDown') { e.preventDefault(); f._sel = Math.min(n, (f._sel || 0) + 1); drawSugg(id); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); f._sel = Math.max(0, (f._sel || 0) - 1); drawSugg(id); }
      else if (e.key === 'Enter') { e.preventDefault(); if (f.q.trim().length < 2) return; pick(id, f._sel || 0); }
      else if (e.key === 'Escape') { f.q = ''; t.value = ''; drawSugg(id); }
      return;
    }
    if (e.key === 'Enter' && t.matches('[data-tmf]') && !t.matches('textarea')) { e.preventDefault(); saveForm(id); }
  });
  document.addEventListener('click', e => {
    const t = e.target;
    const ta = t.closest('[data-team-add]');
    if (ta) { e.preventDefault(); e.stopPropagation(); let pr = {}; try { pr = JSON.parse(ta.dataset.teamAdd); } catch {} return openTeamAdd(pr); }
    const id = formId(t);
    if (id) {
      const f = F[id];
      const pk = t.closest('[data-tmpick]'); if (pk) return pick(id, Number(pk.dataset.tmpick));
      if (t.closest('[data-tmnew]')) return pick(id, (f._list || []).length);
      if (t.closest('[data-tmclear]')) { Object.assign(f, { person: null, newp: null, q: '' }); return redrawForm(id); }
      const ty = t.closest('[data-tmtyp]'); if (ty) { f.typ = ty.dataset.tmtyp; return redrawForm(id); }
      if (t.closest('[data-tmsave]')) return saveForm(id);
    }
    const tm = t.closest('.tm'); if (!tm) return;
    const tag = tm.dataset.tmtag;
    const fl = t.closest('[data-tmfilter]'); if (fl) { V.typ = fl.dataset.tmfilter; return emit('render'); }
    if (t.closest('[data-tmpaste]')) { V.paste = !V.paste; return emit('render'); }
    if (t.closest('[data-tmpasteclose]')) { V.paste = false; V.pasteRows = null; return emit('render'); }
    if (t.closest('[data-tmpasteparse]')) { V.pasteRows = parsePaste(V.pasteText); return emit('render'); }
    if (t.closest('[data-tmpastesave]')) return savePaste(tag);
    if (t.closest('[data-tmcopy]')) {
      const txt = teamFor(tag).map(r => { const p = personOf(r), c = contactFor(p.email); return [p.name, r['Roll'] || r['Avdelning'] || r['Typ'], (c?.phones || [])[0], p.email].filter(Boolean).join('\t'); }).join('\n');
      return navigator.clipboard?.writeText(txt).then(() => toast('Kontaktlistan är kopierad'), () => toast('Kunde inte kopiera'));
    }
    if (t.closest('[data-tmcsv]')) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv(tag)], { type: 'text/csv' })); a.download = `Team_${tag.slice(1)}.csv`; a.click(); return; }
    const ed = t.closest('[data-tmedit]'); if (ed) { const r = coll()?.rows.find(x => String(x._id) === ed.dataset.tmedit); if (r) openTeamAdd({ row: r, tag }); return; }
    const del = t.closest('[data-tmdel]');
    if (del) {
      const c = coll(), r = c?.rows.find(x => String(x._id) === del.dataset.tmdel); if (!r) return;
      const p = personOf(r); if (!confirm(`Ta bort ${p.name} ur teamet?`)) return;
      const i = c.rows.indexOf(r); c.rows.splice(i, 1); emit('render');
      api('deleteRow', { collection: 'Team', id: r._id }, true, c._src || 'jobb').then(() => {
        const cc = contactFor(p.email); if (cc) api('labelContact', { id: cc.id, label: labelFor(tag, r), on: false }, true).catch(() => {});
        toast('Borttagen ur teamet');
      }).catch(err => { c.rows.splice(i, 0, r); emit('render'); toast('Kunde inte ta bort – ' + err.message); });
    }
  });
}
bindOnce();   // knappar med data-team-add finns på flera sidor (produktion, manus, personer)

function pick(id, i) {
  const f = F[id]; const list = f._list || [];
  if (i < list.length) f.person = list[i];
  else { const q = f.q.trim(); f.newp = { name: /@/.test(q) ? '' : q, email: /@/.test(q) ? q : '', phone: '' }; }
  redrawForm(id);
  setTimeout(() => document.querySelector(`[data-tmform="${id}"] ${f.newp ? '[data-tmf="nname"]' : '[data-tmf="roll"]'}`)?.focus(), 20);
}
