/* MALLAR – nytt projekt från mall (mappar, team, uppgifter, milstolpar) och dokumentmallar som blir anteckningar i Notes.
   Mallarna sparas i Apps Script (action templates) och följer med mellan enheter. */
import { S, api, refresh, emit, $, esc, toast, ymd, todayStr, addDays, parseYmd, week, projects } from '../core.js';
import { head } from '../ui.js';

let TPL = null, ROOT = null, loading = false, err = '';
const NP = { name: '', tag: '', client: '', type: 'Serie', phase: 'Utveckling', start: todayStr(), count: '', root: '', listId: '', calendarId: '',
  makeFolders: true, makeTeam: true, makeTasks: true, makeMilestones: false, step: 'form', result: null };
let editProject = false, editDoc = null, useDoc = null;
const USE = { tag: '', film: '', version: '', date: todayStr() };
const TYPES = ['Serie', 'Film', 'Dokumentär', 'Utveckling'];
const PHASES = ['Utveckling', 'Finansiering', 'Förproduktion', 'Inspelning', 'Postproduktion', 'Leverans'];

async function load(force) {
  if ((TPL && ROOT && !force) || loading) return;
  loading = true; err = '';
  try {
    const [t, r] = await Promise.all([api('templates', {}, true), api('projectRoot')]);
    if (!t.project) throw new Error('mallarna saknas i svaret');
    TPL = { project: t.project, docs: t.docs || [] }; ROOT = r;
    if (!NP.root && r.root) NP.root = r.root.url;
    if (!NP.calendarId && r.calendars?.length) NP.calendarId = r.calendars[0].id;
  } catch (e) { err = e.message; }
  loading = false; emit('render');
}

// ---------- vyn #/mall ----------
export function render(el) {
  load();
  el.innerHTML = head('Mallar', 'Nya projekt och återkommande dokument') + (err ? `<div class="notice">Kunde inte hämta mallarna (${esc(err)}). Lägg in senaste Code.gs i Apps Script och gör en ny version.</div>` : '')
    + (!TPL ? '<p class="empty">Hämtar mallar…</p>' : `
    <section class="sec" data-sec="m_np"><h2><span class="h">Nytt projekt</span></h2><div class="body"><div class="mall-np" data-npbox></div></div></section>
    <section class="sec" data-sec="m_pt"><h2><span class="h">Projektmallen</span><button class="act btn" data-mpedit>${editProject ? 'Klar' : 'Ändra'}</button></h2><div class="body">${projectTplHtml()}</div></section>
    <section class="sec" data-sec="m_dt"><h2><span class="h">Dokumentmallar</span><span class="n">${TPL.docs.length}</span><button class="act btn" data-mdnew>+ Ny mall</button></h2><div class="body">${docsHtml()}</div></section>`);
  const box = el.querySelector('[data-npbox]'); if (box) drawNP(box);
  bind(el);
}

// ---------- nytt projekt ----------
const tagOf = s => ('#' + String(s || '').trim().replace(/^#/, '')).toUpperCase();
const taken = t => projects().some(p => p.tag === t);
const dayOf = n => ymd(addDays(parseYmd(NP.start || todayStr()), Number(n || 0)));
function npValid() {
  const t = tagOf(NP.tag);
  if (!NP.name.trim()) return 'Skriv ett namn.';
  if (!/^#[0-9A-ZÅÄÖ_-]{2,}$/.test(t)) return 'Taggen ska vara minst två tecken, t.ex. #VER3.';
  if (taken(t)) return `${t} finns redan.`;
  return '';
}
function drawNP(box) {
  if (!TPL) { box.innerHTML = '<p class="empty">Hämtar mallen…</p>'; return; }
  const P = TPL.project, t = tagOf(NP.tag), T = t.slice(1) || 'TAGG';
  if (NP.step === 'done') {
    const r = NP.result;
    box.innerHTML = `<div class="np-done"><b>${esc(r.tag)} är skapat.</b><p class="hint">${r.done.folders.length} mappar · ${r.done.team} platser i Team · ${r.done.tasks} uppgifter · ${r.done.milestones} milstolpar</p>
      <div class="vact">${r.folderUrl ? `<a class="btn" href="${esc(r.folderUrl)}" target="_blank" rel="noopener">Projektmappen ↗</a>` : ''}<a class="btn solid" href="#/projekt/${encodeURIComponent(r.tag)}">Öppna projektet</a><button class="btn" data-npreset>Skapa ett till</button></div></div>`;
    return;
  }
  if (NP.step === 'preview') {
    const v = npValid();
    box.innerHTML = `<div class="np-prev">
      <h3>${esc(NP.name)} <span class="ptag">${esc(t)}</span></h3>
      <p class="hint">${esc([NP.type, NP.phase, NP.client, NP.count ? NP.count + ' filmer/avsnitt' : ''].filter(Boolean).join(' · '))} · start ${esc(NP.start)}</p>
      ${NP.makeFolders ? `<div class="np-grp"><h4>Drive</h4><div class="np-tree"><div>${esc(ROOT?.root?.name && NP.root === ROOT.root.url ? ROOT.root.name : 'Vald rotmapp')} /</div><div class="np-l1">${esc(t)} /</div>${P.folders.map(f => `<div class="np-l2">${esc(f.replace(/\{T\}/g, T))}</div>`).join('')}</div></div>` : ''}
      <div class="np-grp"><h4>Projektregistret</h4><p>En rad i Projekt: ${esc(t)}, ${esc(NP.name)}, ${esc(NP.phase)}${NP.makeFolders ? ', med länk till mappen' : ''}.</p></div>
      ${NP.makeTeam ? `<div class="np-grp"><h4>Team – ${P.team.length} platser att tillsätta</h4><div class="chips">${P.team.map(x => `<span class="chip">${esc(x.roll || x.avd || x.typ)}</span>`).join('')}</div></div>` : ''}
      ${NP.makeTasks ? `<div class="np-grp"><h4>Uppgifter – ${P.tasks.length} st</h4>${P.tasks.map(x => `<div class="kv"><span>${esc(x.title)} ${esc(t)}</span><b>${x.days === '' || x.days == null ? 'utan datum' : esc(dayOf(x.days))}</b></div>`).join('')}</div>` : ''}
      ${NP.makeMilestones ? `<div class="np-grp"><h4>Milstolpar i kalendern</h4>${P.milestones.map(x => `<div class="kv"><span>${esc(x.name)} ${esc(t)}</span><b>${esc(dayOf(x.days))}</b></div>`).join('')}</div>` : ''}
      ${v ? `<p class="np-err">${esc(v)}</p>` : ''}
      <div class="actions"><button class="ghost" data-npback>Tillbaka</button><span class="spacer"></span><button data-npcreate ${v ? 'disabled' : ''}>Skapa allt</button></div></div>`;
    return;
  }
  const lists = ROOT?.lists || [], cals = ROOT?.calendars || [];
  const v = NP.tag ? npValid() : '';
  box.innerHTML = `<form class="np-form" data-npform>
    <div class="np-row"><label>Namn<input data-np="name" value="${esc(NP.name)}" placeholder="Seriens arbetsnamn" required></label>
      <label class="np-tag">Tagg<input data-np="tag" value="${esc(NP.tag)}" placeholder="#XXX" autocomplete="off"></label></div>
    <div class="np-row"><label>Beställare<input data-np="client" value="${esc(NP.client)}" placeholder="Kanal / beställare"></label>
      <label>Typ<select data-np="type">${TYPES.map(x => `<option ${x === NP.type ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Fas<select data-np="phase">${PHASES.map(x => `<option ${x === NP.phase ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <div class="np-row"><label>Start<input type="date" data-np="start" value="${esc(NP.start)}"></label>
      <label>Antal filmer/avsnitt<input type="number" min="0" data-np="count" value="${esc(NP.count)}"></label>
      <label>Uppgifterna i<select data-np="listId"><option value="">Inkorgen</option>${lists.map(l => `<option value="${esc(l.id)}" ${l.id === NP.listId ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select></label></div>
    <label>Rotmapp i Drive<input data-np="root" value="${esc(NP.root)}" placeholder="Klistra in länk till mappen där projektet ska ligga"></label>
    <div class="np-checks">
      <label class="inline"><input type="checkbox" data-npc="makeFolders" ${NP.makeFolders ? 'checked' : ''}> Mappar i Drive</label>
      <label class="inline"><input type="checkbox" data-npc="makeTeam" ${NP.makeTeam ? 'checked' : ''}> Platser i Team</label>
      <label class="inline"><input type="checkbox" data-npc="makeTasks" ${NP.makeTasks ? 'checked' : ''}> Uppgifter</label>
      <label class="inline"><input type="checkbox" data-npc="makeMilestones" ${NP.makeMilestones ? 'checked' : ''}> Milstolpar i kalendern</label>
      ${NP.makeMilestones && cals.length ? `<select data-np="calendarId">${cals.map(c => `<option value="${esc(c.id)}" ${c.id === NP.calendarId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
    </div>
    <p class="np-err" data-nperr>${esc(v)}</p>
    <div class="actions"><span class="spacer"></span><button type="submit">Förhandsvisa</button></div></form>`;
}
async function createNP(box) {
  const P = TPL.project;
  box.querySelector('[data-npcreate]').disabled = true;
  box.querySelector('[data-npcreate]').textContent = 'Skapar…';
  try {
    const r = await api('createProject', { name: NP.name.trim(), tag: tagOf(NP.tag), client: NP.client, type: NP.type, phase: NP.phase, start: NP.start, count: NP.count,
      root: NP.root, listId: NP.listId, calendarId: NP.calendarId, makeFolders: NP.makeFolders, makeTeam: NP.makeTeam, makeTasks: NP.makeTasks, makeMilestones: NP.makeMilestones,
      folders: P.folders, team: P.team, tasks: P.tasks, milestones: P.milestones }, true);
    NP.result = r; NP.step = 'done'; toast(`${r.tag} är skapat`); refresh();
  } catch (e) { toast('Kunde inte skapa – ' + e.message); NP.step = 'preview'; }
  drawNP(box);
}

// ---------- projektmallen ----------
const lines = (arr, f) => arr.map(f).join('\n');
function projectTplHtml() {
  const P = TPL.project;
  if (!editProject) return `<div class="mall-pt">
    <div><h4>Mappar</h4>${P.folders.map(f => `<div class="mall-li">${esc(f)}</div>`).join('')}</div>
    <div><h4>Team</h4>${P.team.map(x => `<div class="mall-li">${esc(x.roll || x.avd)} <small>${esc([x.typ, x.avd].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>
    <div><h4>Uppgifter</h4>${P.tasks.map(x => `<div class="mall-li">${esc(x.title)} <small>${x.days === '' || x.days == null ? 'utan datum' : '+' + esc(x.days) + ' d'}</small></div>`).join('')}</div>
    <div><h4>Milstolpar</h4>${P.milestones.map(x => `<div class="mall-li">${esc(x.name)} <small>+${esc(x.days)} d</small></div>`).join('')}</div></div>`;
  return `<div class="mall-edit">
    <label>Mappar <small>en per rad · {T} = taggen utan #</small><textarea rows="9" data-mp="folders">${esc(P.folders.join('\n'))}</textarea></label>
    <label>Team <small>Typ | Avdelning | Roll</small><textarea rows="9" data-mp="team">${esc(lines(P.team, x => [x.typ, x.avd, x.roll].join(' | ')))}</textarea></label>
    <label>Uppgifter <small>Titel | dagar från start (tomt = utan datum)</small><textarea rows="7" data-mp="tasks">${esc(lines(P.tasks, x => [x.title, x.days ?? ''].join(' | ')))}</textarea></label>
    <label>Milstolpar <small>Namn | dagar från start</small><textarea rows="4" data-mp="milestones">${esc(lines(P.milestones, x => [x.name, x.days].join(' | ')))}</textarea></label>
    <div class="actions"><button class="ghost" data-mpreset>Återställ standard</button><span class="spacer"></span><button data-mpsave>Spara mallen</button></div></div>`;
}
function readProjectTpl(el) {
  const v = k => el.querySelector(`[data-mp="${k}"]`).value.split('\n').map(s => s.trim()).filter(Boolean);
  const cells = s => s.split('|').map(x => x.trim());
  return {
    folders: v('folders'),
    team: v('team').map(s => { const [typ, avd, roll] = cells(s); return { typ: typ || 'Crew', avd: avd || '', roll: roll || '' }; }),
    tasks: v('tasks').map(s => { const [title, days] = cells(s); return { title, days: days === '' || days == null ? '' : Number(days) || 0, list: '' }; }),
    milestones: v('milestones').map(s => { const [name, days] = cells(s); return { name, days: Number(days) || 0 }; }),
  };
}

// ---------- dokumentmallar ----------
function fillDoc(tpl) {
  const p = projects().find(x => x.tag === USE.tag);
  const d = parseYmd(USE.date || todayStr());
  const vals = { Projekt: (USE.tag || '').replace('#', ''), Projektnamn: p?.name || '', Datum: USE.date || todayStr(), Datumtagg: ymd(d).slice(2).replace(/-/g, ''),
    Film: USE.film, Version: USE.version, Vecka: String(week(d)) };
  const f = s => String(s || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => vals[k] != null ? vals[k] : m).replace(/\s+–\s+$/, '').replace(/ {2,}/g, ' ').trim();
  return { title: f(tpl.title), text: f(tpl.text).replace(/(^|\s)#(?=\s|$)/g, '$1') };
}
function docsHtml() {
  const tags = projects().filter(p => p.cfg).map(p => p.tag);
  return `<div class="mall-docs">${TPL.docs.map((d, i) => {
    if (editDoc === i) return `<div class="mall-doc card editing"><input data-md="name" value="${esc(d.name)}" placeholder="Mallens namn"><input data-md="title" value="${esc(d.title)}" placeholder="Titel i Notes"><textarea rows="10" data-md="text">${esc(d.text)}</textarea>
      <p class="hint">Platshållare: {{Projekt}} {{Projektnamn}} {{Datum}} {{Datumtagg}} {{Film}} {{Version}} {{Vecka}}</p>
      <div class="actions"><button class="ghost danger" data-mddel="${i}">Ta bort</button><span class="spacer"></span><button class="ghost" data-mdcancel>Avbryt</button><button data-mdsave="${i}">Spara</button></div></div>`;
    if (useDoc === i) { const out = fillDoc(d); return `<div class="mall-doc card using"><h4>${esc(d.name)}</h4>
      <div class="np-row"><label>Projekt<select data-mu="tag"><option value="">–</option>${tags.map(t => `<option ${t === USE.tag ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Film/avsnitt<input data-mu="film" value="${esc(USE.film)}" placeholder="F1, Avsnitt 2…"></label><label>Version<input data-mu="version" value="${esc(USE.version)}" placeholder="261001_PINK"></label><label>Datum<input type="date" data-mu="date" value="${esc(USE.date)}"></label></div>
      <div class="mall-out"><b data-muout="title">${esc(out.title)}</b><pre data-muout="text">${esc(out.text)}</pre></div>
      <div class="actions"><span class="spacer"></span><button class="ghost" data-mdcancel>Avbryt</button><button data-mdmake="${i}">Skapa i Notes</button></div></div>`; }
    return `<div class="mall-doc card"><div class="mall-dh"><b>${esc(d.name)}</b><span><button class="btn" data-mdedit="${i}">Ändra</button><button class="btn solid" data-mduse="${i}">Använd</button></span></div><pre>${esc(d.text.slice(0, 220))}${d.text.length > 220 ? '…' : ''}</pre></div>`;
  }).join('')}</div>`;
}
async function saveDocs(docs) {
  try { const r = await api('templates', { docs }, true); TPL.docs = r.docs; toast('Mallen är sparad'); } catch (e) { toast('Kunde inte spara – ' + e.message); }
  editDoc = null; emit('render');
}

// ---------- händelser ----------
function bindNP(box) {
  box.oninput = e => {
    const t = e.target;
    if (t.dataset.np) { NP[t.dataset.np] = t.value; if (t.dataset.np === 'tag' || t.dataset.np === 'name') { const er = box.querySelector('[data-nperr]'); if (er) er.textContent = NP.tag ? npValid() : ''; } }
  };
  box.onchange = e => { const t = e.target; if (t.dataset.npc) { NP[t.dataset.npc] = t.checked; drawNP(box); } else if (t.tagName === 'SELECT' && t.dataset.np) NP[t.dataset.np] = t.value; };
  box.onsubmit = e => { e.preventDefault(); const v = npValid(); if (v) { box.querySelector('[data-nperr]').textContent = v; return; } NP.step = 'preview'; drawNP(box); };
  box.onclick = e => {
    const t = e.target;
    if (t.closest('[data-npback]')) { NP.step = 'form'; drawNP(box); }
    if (t.closest('[data-npcreate]')) createNP(box);
    if (t.closest('[data-npreset]')) { Object.assign(NP, { name: '', tag: '', client: '', count: '', step: 'form', result: null }); drawNP(box); }
  };
}
function bind(el) {
  const box = el.querySelector('[data-npbox]'); if (box) bindNP(box);
  el.querySelector('[data-mpedit]')?.addEventListener('click', e => { e.stopPropagation(); editProject = !editProject; emit('render'); });
  el.querySelector('[data-mpsave]')?.addEventListener('click', async () => {
    const project = readProjectTpl(el);
    try { const r = await api('templates', { project }, true); TPL.project = r.project; editProject = false; toast('Projektmallen är sparad'); } catch (e) { toast('Kunde inte spara – ' + e.message); }
    emit('render');
  });
  el.querySelector('[data-mpreset]')?.addEventListener('click', async () => {
    if (!confirm('Återställa projektmallen till standard?')) return;
    try { const r = await api('templates', { reset: 'project' }, true); TPL.project = r.project; editProject = false; } catch (e) { toast(e.message); }
    emit('render');
  });
  el.querySelector('[data-mdnew]')?.addEventListener('click', e => { e.stopPropagation(); TPL.docs.push({ id: 'm' + Date.now(), name: 'Ny mall', title: '{{Projekt}} – {{Datum}}', text: '#{{Projekt}} #{{Datumtagg}}\n\n' }); editDoc = TPL.docs.length - 1; useDoc = null; emit('render'); });
  el.querySelectorAll('[data-mdedit]').forEach(b => b.onclick = () => { editDoc = Number(b.dataset.mdedit); useDoc = null; emit('render'); });
  el.querySelectorAll('[data-mduse]').forEach(b => b.onclick = () => { useDoc = Number(b.dataset.mduse); editDoc = null; if (!USE.tag) USE.tag = projects().find(p => p.cfg)?.tag || ''; emit('render'); });
  el.querySelectorAll('[data-mdcancel]').forEach(b => b.onclick = () => { if (editDoc != null && !TPL.docs[editDoc].text.trim()) TPL.docs.splice(editDoc, 1); editDoc = null; useDoc = null; emit('render'); });
  el.querySelectorAll('[data-mdsave]').forEach(b => b.onclick = () => {
    const c = b.closest('.mall-doc'), i = Number(b.dataset.mdsave);
    TPL.docs[i] = { ...TPL.docs[i], name: c.querySelector('[data-md="name"]').value.trim() || 'Mall', title: c.querySelector('[data-md="title"]').value, text: c.querySelector('[data-md="text"]').value };
    saveDocs(TPL.docs);
  });
  el.querySelectorAll('[data-mddel]').forEach(b => b.onclick = () => { if (!confirm('Ta bort mallen?')) return; TPL.docs.splice(Number(b.dataset.mddel), 1); saveDocs(TPL.docs); });
  const using = el.querySelector('.mall-doc.using');
  if (using) {
    const upd = () => { const o = fillDoc(TPL.docs[useDoc]); using.querySelector('[data-muout="title"]').textContent = o.title; using.querySelector('[data-muout="text"]').textContent = o.text; };
    using.oninput = e => { const k = e.target.dataset.mu; if (k) { USE[k] = e.target.value; upd(); } };
    using.onchange = using.oninput;
    using.querySelector('[data-mdmake]').onclick = async () => {
      const o = fillDoc(TPL.docs[useDoc]);
      try { await api('addNote', { title: o.title, text: o.text }, true); toast('Köad – syns i Notes inom 5 min'); useDoc = null; emit('render'); }
      catch (e) { toast('Kunde inte skapa – ' + e.message); }
    };
  }
}

// ---------- dialog: nytt projekt var som helst ----------
export function openNewProject() {
  let d = $('#npDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="npDlg" class="sheet mall-dlg"><div class="np-dh"><h2>Nytt projekt</h2><a class="btn" href="#/mall" data-npclose>Ändra mallen</a></div><div class="mall-np" id="npDlgB"></div><div class="actions"><span class="spacer"></span><button class="ghost" data-npclose>Stäng</button></div></dialog>`);
    d = $('#npDlg');
    d.addEventListener('click', e => { if (e.target.closest('[data-npclose]')) d.close(); });
    bindNP($('#npDlgB'));
  }
  if (NP.step === 'done') Object.assign(NP, { name: '', tag: '', client: '', count: '', step: 'form', result: null });
  d.showModal();
  const box = $('#npDlgB');
  drawNP(box);
  if (!TPL) load().then(() => drawNP(box));
}

export function context() { return 'Mina mallar för nya projekt och dokument (manusnoter, klippnoter, mötesanteckning, veckorapport).'; }
