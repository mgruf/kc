/* PROJEKT – alla projekt och projektsidan: översikt med widgets, produktion, uppgifter, anteckningar, personer, filer, samlingar. */
import {
  S, api, emit, $, $$, esc, toast, ymd, parseYmd, addDays, todayStr, shortDate, dayLabel, MONTHS, DAYS, relTime,
  projects, cfgProject, visible, modeCls, tagHtml, tagColor, ctx, evDay, tagDate, isFire, people, initials, contactOf, claudeUrl, go,
} from '../core.js';
import { taskRow, eventRow, noteRow, section, empty, head, openTask, openEvent } from '../ui.js';
import { renderProduction, productionSummary } from './produktion.js';
import { renderCollectionView } from './samling.js';

const TABS = [['oversikt', 'Översikt'], ['produktion', 'Produktion'], ['uppgifter', 'Uppgifter'], ['kalender', 'Kalender'], ['anteckningar', 'Anteckningar'], ['personer', 'Personer'], ['filer', 'Filer'], ['samlingar', 'Samlingar']];
let editing = false;

export function render(el, args) {
  if (args[0]) {
    const tag = decodeURIComponent(args[0]).toUpperCase();
    const p = projects().find(x => x.tag === tag);
    if (!p) { el.innerHTML = head('Projektet finns inte') + empty(`Inget i KC har taggen ${esc(tag)} än.`); return; }
    ctx.hideTag = p.tag;
    try { return page(el, p, args[1] || 'oversikt', args.slice(2)); } finally { ctx.hideTag = null; }
  }
  overview(el);
}

// ---------- alla projekt ----------
function overview(el) {
  const all = projects().filter(visible);
  const main = all.filter(p => p.cfg || p.tasks.length), rest = all.filter(p => !p.cfg && !p.tasks.length);
  const card = p => {
    const open = p.tasks.filter(x => !S.done[x.id]).length;
    const sum = (S.data?.summaries?.[p.tag] || '').split('\n')[0];
    const sh = p.cfg?.shoot;
    const next = nextMilestone(p);
    return `<a class="pcard ${modeCls(p.mode)}" href="#/projekt/${encodeURIComponent(p.tag)}" style="--tc:${tagColor(p.tag)}">
      ${p.fire.length ? `<span class="fdot" title="${p.fire.length} brinner"></span>` : ''}
      <div class="pc-tag">${esc(p.tag.slice(1))}</div><h3>${esc(p.name)}</h3>
      <div class="pc-phase">${esc(sum || p.cfg?.phase || '')}</div>
      ${sh ? `<div class="bar"><i style="width:${Math.round(sh.doneDays / sh.totalDays * 100)}%"></i></div><div class="pc-small">Inspelning dag ${sh.doneDays} av ${sh.totalDays}</div>` : ''}
      ${next ? `<div class="pc-small">Nästa: ${esc(next.name)} · ${esc(dayLabel(next.date))}</div>` : ''}
      <div class="pc-stats"><span><b>${open}</b> uppgifter</span><span><b>${p.notes.length}</b> anteckningar</span>${p.rows.length ? `<span><b>${p.rows.length}</b> rader</span>` : ''}</div></a>`;
  };
  el.innerHTML = head('Projekt', `${main.length} aktiva`, `<a class="btn solid" href="#/samling/Projekt/ny">+ Nytt projekt</a><a class="btn" href="#/samling/Projekt">Projektregistret</a>`) +
    `<div class="pcards">${main.map(card).join('') || empty('Inga projekt än. Lägg till ett i projektregistret, eller tagga en uppgift med #NAMN.')}</div>` +
    (rest.length ? section('restproj', 'Övriga taggar', rest.length, `<div class="pcards small">${rest.map(card).join('')}</div>`) : '');
  if (S.closed.restproj === undefined) { S.closed.restproj = true; el.querySelector('[data-sec="restproj"]')?.classList.add('closed'); }
}

function nextMilestone(p) {
  const t = todayStr(), c = p.cfg || {};
  const items = [
    ...(c.deadlines || []).map(x => ({ date: x.date, name: x.name })),
    ...(c.phases || []).filter(x => x.milestone).map(x => ({ date: x.start, name: x.name })),
  ].filter(x => x.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  return items[0];
}

// ---------- projektsidan ----------
function page(el, p, tab, rest) {
  const c = p.cfg || {};
  const hasProd = !!(c.hasProduction || c.shoot || c.sceneSheetUrl);
  const tabs = TABS.filter(([k]) => k !== 'produktion' || hasProd);
  const counts = { uppgifter: p.tasks.length, anteckningar: p.notes.length, kalender: p.events.filter(e => evDay(e) >= todayStr()).length, samlingar: p.rows.length };
  el.innerHTML = `<div class="crumb"><a href="#/projekt">Projekt</a></div>` +
    head(`<span class="ptag" style="--tc:${tagColor(p.tag)}">${esc(p.tag.slice(1))}</span>${esc(p.name)}`, [c.phase, c.client].filter(Boolean).map(esc).join(' · '),
      `${tab === 'oversikt' ? `<button class="btn" data-pedit>${editing ? 'Klar' : 'Anpassa'}</button>` : ''}<button class="btn" data-ptask>+ Uppgift</button>${c.rowId ? `<a class="btn" href="#/samling/Projekt/${encodeURIComponent(c.rowId)}">Inställningar</a>` : ''}`) +
    `<nav class="ptabs">${tabs.map(([k, l]) => `<a href="#/projekt/${encodeURIComponent(p.tag)}/${k}" class="${k === tab ? 'on' : ''}">${l}${counts[k] ? `<span>${counts[k]}</span>` : ''}</a>`).join('')}</nav>
    <div class="ptab" id="ptab"></div>`;
  const box = $('#ptab', el);
  el.querySelector('[data-ptask]').onclick = () => openTask(null, { tag: p.tag });
  el.querySelector('[data-pedit]')?.addEventListener('click', () => { if (editing) saveLayout(p); editing = !editing; emit('render'); });
  switch (tab) {
    case 'produktion': return renderProduction(box, p, rest[0] || 'oversikt', rest.slice(1));
    case 'uppgifter': {
      const open = p.tasks.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      const g = { fire: open.filter(t => isFire(t)), soon: open.filter(t => !isFire(t) && t.due), wait: open.filter(t => !t.due && t.waiting), none: open.filter(t => !t.due && !t.waiting) };
      box.innerHTML = (g.fire.length ? section('pt_f', 'Förfallet', g.fire.length, g.fire.map(t => taskRow(t)).join(''), 'fire') : '') +
        section('pt_s', 'Med datum', g.soon.length, g.soon.map(t => taskRow(t)).join('') || empty('Inget med datum.')) +
        section('pt_w', 'Väntar på andra', g.wait.length, g.wait.map(t => taskRow(t)).join('') || empty('Du väntar inte på något här.')) +
        section('pt_n', 'Utan datum', g.none.length, g.none.map(t => taskRow(t)).join('') || empty('–'));
      return;
    }
    case 'kalender': {
      const t = todayStr();
      const up = p.events.filter(e => evDay(e) >= t).sort((a, b) => String(a.start).localeCompare(String(b.start)));
      const past = p.events.filter(e => evDay(e) < t).sort((a, b) => String(b.start).localeCompare(String(a.start))).slice(0, 15);
      box.innerHTML = `<div class="vact" style="margin:14px 0"><button class="btn" data-pev>+ Händelse</button></div>` + section('pk_u', 'Kommande', up.length, up.map(e => eventRow(e, { day: true })).join('') || empty('Inget inplanerat med taggen.')) + (past.length ? section('pk_p', 'Senaste', past.length, past.map(e => eventRow(e, { day: true })).join('')) : '');
      box.querySelector('[data-pev]').onclick = () => openEvent(null, null, { tag: p.tag });
      return;
    }
    case 'anteckningar': {
      const ns = p.notes.slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
      box.innerHTML = ns.length ? ns.map(noteRow).join('') : empty(`Inga anteckningar med ${esc(p.tag)}. Lägg en anteckning i Notes-mappen ${esc(p.tag)} eller skriv taggen i texten.`);
      return;
    }
    case 'personer': return personsTab(box, p);
    case 'filer': return filesTab(box, p);
    case 'samlingar': {
      const colls = (S.data?.collections || []).filter(cl => cl.name !== 'Projekt' && cl.fields.some(f => f.type === 'projekt'));
      box.innerHTML = colls.map((cl, i) => `<section class="sec"><h2><span class="h">${esc(cl.name)}</span><a class="act btn" href="#/samling/${encodeURIComponent(cl.name)}">Öppna</a></h2><div class="body" id="pc_${i}"></div></section>`).join('') || empty('Inga samlingar med projektfält.');
      colls.forEach((cl, i) => renderCollectionView($('#pc_' + i, box), cl, { filterTag: p.tag, compact: true }));
      return;
    }
    default: return widgets(box, p);
  }
}

function personsTab(box, p) {
  const tag = p.tag;
  const labeled = people().filter(x => (x.labels || []).some(l => l.toUpperCase().startsWith(tag)));
  const fromTasks = p.tasks.map(contactOf).filter(Boolean).map(c => people().find(x => x.email === c.email.toLowerCase()) || { name: c.name, email: c.email.toLowerCase(), key: c.email.toLowerCase(), labels: [] });
  const all = [...labeled, ...fromTasks].filter((x, i, a) => a.findIndex(y => y.key === x.key) === i);
  const roleOf = x => ((x.labels || []).find(l => l.toUpperCase().startsWith(tag)) || '').replace(/^#[^\s·]+\s*·?\s*/, '');
  const prod = S.prod[tag];
  box.innerHTML = `<p class="hint" style="margin:14px 0">Personer med etiketten ${esc(tag)} (t.ex. "${esc(tag)} · Foto") i Google Kontakter, och kontakter i projektets uppgifter.</p>` +
    (all.length ? `<div class="plist">${all.map(x => `<a class="prow" href="#/person/${encodeURIComponent(x.key)}"><span class="avatar" style="width:34px;height:34px;font-size:12px">${x.photo ? `<img src="${esc(x.photo)}" alt="">` : esc(initials(x.name))}</span><div class="main"><div class="title">${esc(x.name)}</div><div class="sub">${esc(roleOf(x) || [x.title, x.org].filter(Boolean).join(', ') || x.email || '')}</div></div></a>`).join('')}</div>` : empty('Inga personer kopplade än.')) +
    (prod?.roles?.length ? section('pp_roles', 'Rollista', prod.roles.length, `<div class="plist">${prod.roles.map(r => `<a class="prow" href="#/projekt/${encodeURIComponent(tag)}/produktion/roller"><span class="avatar" style="width:34px;height:34px;font-size:11px">${esc(r.code)}</span><div class="main"><div class="title">${esc(r.name)}</div><div class="sub">${esc(r.actor || 'Ej tillsatt')} · ${r.days} dagar</div></div></a>`).join('')}</div>`) : '');
}

async function filesTab(box, p) {
  const c = p.cfg || {};
  const links = [
    c.driveUrl && ['Projektmapp', c.driveUrl, 'Drive'],
    c.callsheet && ['Senaste callsheet', c.callsheet.url, c.callsheet.name],
    c.sceneSheetUrl && ['Scenarket', c.sceneSheetUrl, 'Google Kalkylark'],
    c.planSheetUrl && ['Produktionsplan', c.planSheetUrl, 'Produktionsplan'],
    c.crew && ['Crewlista', c.crew.url, c.crew.name],
    ...((S.data?.links || {})[p.tag] || []).map(l => [l.name, l.url, 'Egen länk']),
  ].filter(Boolean);
  const prod = S.prod[p.tag];
  box.innerHTML = `<div class="files">${links.map(([n, u, s]) => `<a class="file" href="${esc(u)}" target="_blank" rel="noopener"><span>${esc(n)}</span><small>${esc(s || '')}</small></a>`).join('')}</div>
    <button class="btn" data-addlink style="margin-top:10px">+ Länk</button>
    ${section('pf_recent', 'Senast ändrat i projektmappen', null, '<div id="pfr"><p class="empty">Hämtar…</p></div>')}`;
  box.querySelector('[data-addlink]').onclick = () => addLink(p.tag);
  if (!c.driveUrl) { $('#pfr', box).innerHTML = empty('Ingen projektmapp kopplad. Lägg till den i projektets inställningar.'); return; }
  let files = prod?.docs;
  if (!files) { try { files = (await api('files', { folder: c.driveUrl }, false, c._src || 'jobb')).files; } catch (e) { $('#pfr', box) && ($('#pfr', box).innerHTML = empty('Kunde inte hämta: ' + esc(e.message))); return; } }
  const el = $('#pfr', box); if (!el) return;
  el.innerHTML = files.length ? files.map(f => `<a class="item" href="${esc(f.url)}" target="_blank" rel="noopener"><div class="glyph">${/pdf/.test(f.mime) ? '▤' : /sheet|excel/.test(f.mime) ? '▦' : /image/.test(f.mime) ? '◩' : /video/.test(f.mime) ? '▶' : '≡'}</div><div class="main"><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.path || 'Projektmappen')}<i class="sep">·</i>${esc(relTime(f.updated))}</div></div></a>`).join('') : empty('Tom mapp.');
}

async function addLink(tag) {
  const url = prompt('Klistra in länken (Drive, ark, webbsida):'); if (!url) return;
  const name = prompt('Vad ska den heta?', ''); if (!name) return;
  const links = [...((S.data.links ||= {})[tag] || []), { name, url }];
  S.data.links[tag] = links; emit('render');
  try { await api('setLinks', { tag, links }, true); } catch { toast('Kunde inte spara'); }
}

// ---------- översikt: widgets ----------
const W = {
  summary:  { title: 'Sammanfattning', size: 'l' },
  shoot:    { title: 'Inspelning', size: 'm', when: p => p.cfg?.shoot || p.cfg?.hasProduction },
  upcoming: { title: 'Närmast', size: 'm' },
  tasks:    { title: 'Uppgifter', size: 'm' },
  waiting:  { title: 'Väntar på svar', size: 'm' },
  timeline: { title: 'Tidslinje', size: 'l', when: p => p.cfg?.phases?.length || p.cfg?.shootDays?.length },
  budget:   { title: 'Budget', size: 'm', when: p => p.cfg?.budget },
  files:    { title: 'Filer', size: 'm' },
  scripts:  { title: 'Manusversioner', size: 's', when: p => p.cfg?.scripts?.length },
  decisions:{ title: 'Beslut', size: 'm' },
  notes:    { title: 'Anteckningar', size: 'm' },
};
const DEFAULT_JOBB = ['summary', 'shoot', 'upcoming', 'tasks', 'waiting', 'timeline', 'budget', 'decisions', 'files', 'scripts', 'notes'];
const DEFAULT_PRIVAT = ['summary', 'upcoming', 'tasks', 'notes', 'files'];
function layoutFor(p) {
  const saved = (S.data?.layouts || {})[p.tag]; if (saved?.length) return saved.filter(w => W[w.id]);
  return (p.mode === 'privat' ? DEFAULT_PRIVAT : DEFAULT_JOBB).filter(id => !W[id].when || W[id].when(p)).map(id => ({ id, size: W[id].size }));
}
async function saveLayout(p) {
  try { await api('setLayout', { tag: p.tag, layout: layoutFor(p) }, true); toast('Sparat'); } catch { toast('Kunde inte spara'); }
}

function widgets(box, p) {
  const layout = layoutFor(p);
  const used = new Set(layout.map(w => w.id));
  const free = Object.keys(W).filter(id => !used.has(id));
  box.innerHTML = `<div class="grid ${editing ? 'editing' : ''}">
    ${layout.map((w, i) => `<div class="w size-${w.size}" data-w="${i}" draggable="${editing}">
      <div class="wtools"><button data-wmove="-1" aria-label="Flytta bakåt">‹</button><button data-wsize aria-label="Storlek">${w.size.toUpperCase()}</button><button data-wmove="1" aria-label="Flytta framåt">›</button><button data-wremove aria-label="Ta bort">×</button></div>
      <h4>${esc(W[w.id].title)}</h4>${widget(w.id, p)}</div>`).join('')}
    ${editing && free.length ? `<div class="w size-s addw"><h4>Lägg till</h4><div class="chips">${free.map(id => `<button class="chip" data-wadd="${id}">${esc(W[id].title)}</button>`).join('')}</div></div>` : ''}
  </div>`;
  const setL = l => { (S.data.layouts ||= {})[p.tag] = l; emit('render'); };
  box.querySelectorAll('[data-wmove],[data-wsize],[data-wremove],[data-wadd]').forEach(b => b.onclick = () => {
    const l = layoutFor(p).map(x => ({ ...x })), i = Number(b.closest('[data-w]')?.dataset.w);
    if (b.dataset.wadd) l.push({ id: b.dataset.wadd, size: W[b.dataset.wadd].size });
    else if (b.hasAttribute('data-wremove')) l.splice(i, 1);
    else if (b.hasAttribute('data-wsize')) l[i].size = { s: 'm', m: 'l', l: 's' }[l[i].size] || 'm';
    else { const j = i + Number(b.dataset.wmove); if (j >= 0 && j < l.length) [l[i], l[j]] = [l[j], l[i]]; }
    setL(l);
  });
  let from = null;
  box.querySelectorAll('.editing [data-w]').forEach(w => {
    w.addEventListener('dragstart', () => from = Number(w.dataset.w));
    w.addEventListener('dragover', e => { if (from != null) e.preventDefault(); });
    w.addEventListener('drop', e => { e.preventDefault(); const l = layoutFor(p).map(x => ({ ...x })); const [m] = l.splice(from, 1); l.splice(Number(w.dataset.w), 0, m); from = null; setL(l); });
  });
  const ta = box.querySelector('[data-summary]');
  if (ta) ta.addEventListener('blur', async () => {
    if ((S.data.summaries?.[p.tag] || '') === ta.value) return;
    (S.data.summaries ||= {})[p.tag] = ta.value;
    try { await api('setSummary', { tag: p.tag, text: ta.value }, true); toast('Sparat'); } catch { toast('Kunde inte spara'); }
  });
}

function widget(id, p) {
  const t = todayStr(), c = p.cfg || {};
  switch (id) {
    case 'summary': return `<textarea data-summary placeholder="Var står projektet? Första raden syns på projektkortet.">${esc(S.data?.summaries?.[p.tag] || '')}</textarea>`;
    case 'shoot': return productionSummary(p) + `<a class="more-link" href="#/projekt/${encodeURIComponent(p.tag)}/produktion">Produktion →</a>`;
    case 'upcoming': {
      const items = [
        ...p.events.filter(e => evDay(e) >= t).map(e => ({ d: evDay(e), html: eventRow(e, { day: true }) })),
        ...p.notes.flatMap(n => (n.tags || []).map(tagDate).filter(d => d && d >= t).map(d => ({ d, html: noteRow(n) }))),
        ...(c.deadlines || []).filter(x => x.date >= t).map(x => ({ d: x.date, html: planRow(x) })),
        ...(c.phases || []).filter(x => x.milestone && x.start >= t).map(x => ({ d: x.start, html: planRow({ date: x.start, name: x.name, text: 'Milstolpe' }) })),
        ...(c.shootDays || []).filter(x => x.date >= t).slice(0, 3).map(x => ({ d: x.date, html: `<a class="item" href="#/projekt/${encodeURIComponent(p.tag)}/produktion/dagar/${x.date}"><div class="time"><small>${esc(dayLabel(x.date))}</small>Dag ${x.day}</div><div class="main"><div class="title">${esc(x.note || 'Inspelning')}</div><div class="sub">${esc(x.hours || '')}</div></div></a>` })),
      ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 8);
      return items.length ? items.map(u => u.html).join('') : empty('Inget inplanerat.');
    }
    case 'tasks': { const ts = p.tasks.filter(x => !x.waiting).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')); return (ts.slice(0, 10).map(x => taskRow(x)).join('') || empty('Inga öppna uppgifter.')) + (ts.length > 10 ? `<a class="more-link" href="#/projekt/${encodeURIComponent(p.tag)}/uppgifter">Alla ${ts.length}</a>` : ''); }
    case 'waiting': { const ts = p.tasks.filter(x => x.waiting); return ts.length ? ts.map(x => taskRow(x)).join('') : empty('Du väntar inte på något här.'); }
    case 'notes': return p.notes.length ? p.notes.slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified))).slice(0, 8).map(noteRow).join('') : empty('Inga anteckningar med taggen.');
    case 'decisions': {
      const coll = (S.data?.collections || []).find(x => x.name === 'Beslut');
      const rows = coll ? coll.rows.filter(r => String(r['Projekt'] || '').toUpperCase().includes(p.tag)).sort((a, b) => String(b['Datum']).localeCompare(String(a['Datum']))).slice(0, 6) : [];
      return (rows.map(r => `<a class="item" href="#/samling/Beslut/${encodeURIComponent(r._id)}"><div class="glyph">◆</div><div class="main"><div class="title">${esc(r['Beslut'])}</div><div class="sub">${esc(shortDate(r['Datum']))}${r['Status'] && r['Status'] !== 'Gäller' ? '<i class="sep">·</i>' + esc(r['Status']) : ''}</div></div></a>`).join('') || empty('Inga beslut loggade.'))
        + `<a class="more-link" href="#/samling/Beslut/ny/${encodeURIComponent(p.tag)}">+ Logga beslut</a>`;
    }
    case 'files': {
      const links = [c.driveUrl && ['Projektmapp', c.driveUrl], c.callsheet && ['Senaste callsheet', c.callsheet.url, c.callsheet.name], c.sceneSheetUrl && ['Scenarket', c.sceneSheetUrl], c.planSheetUrl && ['Produktionsplan', c.planSheetUrl], ...((S.data?.links || {})[p.tag] || []).map(l => [l.name, l.url])].filter(Boolean);
      return `<div class="files">${links.map(([n, u, s]) => `<a class="file" href="${esc(u)}" target="_blank" rel="noopener"><span>${esc(n)}</span>${s ? `<small>${esc(s)}</small>` : ''}</a>`).join('') || empty('Inga filer kopplade.')}</div><a class="more-link" href="#/projekt/${encodeURIComponent(p.tag)}/filer">Alla filer</a>`;
    }
    case 'scripts': return (c.scripts || []).map(s => { const m = /^(\d{6})_?(.*)$/.exec(s.version) || []; return `<div class="kv"><span>${esc(s.film)}</span><b>${esc(m[2] || s.version)}${m[1] ? ` · ${shortDate('20' + m[1].slice(0, 2) + '-' + m[1].slice(2, 4) + '-' + m[1].slice(4))}` : ''}</b></div>`; }).join('') || empty('Inga manusversioner.');
    case 'budget': return budgetHtml(c.budget);
    case 'timeline': return timelineHtml(p);
  }
  return '';
}

const kr = n => (Math.round(n / 1000)).toLocaleString('sv-SE') + ' tkr';
const mkr = n => (n / 1e6).toLocaleString('sv-SE', { maximumFractionDigits: 1 }) + ' Mkr';
function budgetHtml(b) {
  if (!b) return empty('Ingen budget inläst än.');
  const prev = {}; (b.prev?.rows || []).forEach(([acc, amt]) => prev[acc] = amt);
  const changed = (b.rows || []).filter(([acc, , amt]) => prev[acc] !== undefined && prev[acc] !== amt).map(([acc, name, amt]) => ({ acc, name, d: amt - prev[acc] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const dTot = b.prev ? b.total - b.prev.total : 0;
  return `<div class="big"><span class="num">${esc(mkr(b.total))}</span><span class="of">totalt</span></div>
    ${(b.groups || []).map(g => `<div class="kv"><span>${esc(g.name.toLowerCase().replace(/^./, c => c.toUpperCase()))}</span><b>${esc(mkr(g.amount))}</b></div>`).join('')}
    <div class="sub2">Version ${esc(shortDate(b.date))}${b.prev ? ` · jämfört med ${esc(shortDate(b.prev.date))}` : ''}</div>
    ${b.prev ? (changed.length ? `<div class="sub2">Omfördelat${dTot ? ` · totalen ${dTot > 0 ? '+' : ''}${esc(kr(dTot))}` : ''}</div>` + changed.slice(0, 6).map(r => `<div class="kv"><span>${esc(r.acc)} ${esc(r.name.toLowerCase())}</span><b>${r.d > 0 ? '+' : ''}${esc(kr(r.d))}</b></div>`).join('') : '<div class="sub2">Inga omfördelningar sedan förra versionen.</div>') : ''}`;
}
function planRow(x) {
  return `<div class="item"><div class="glyph">◆</div><div class="main"><div class="title">${esc(x.name)}</div><div class="sub">${esc(dayLabel(x.date))}${x.text ? '<i class="sep">·</i>' + esc(x.text) : ''}${x.to ? '<i class="sep">·</i>' + esc(x.to) : ''}</div></div></div>`;
}
function timelineHtml(p) {
  const c = p.cfg || {}, weeks = 16;
  const from = addDays(new Date(), -7), to = addDays(from, weeks * 7);
  const span = to - from, pos = s => Math.max(0, Math.min(100, (parseYmd(s) - from) / span * 100));
  const rows = [];
  const sd = c.shootDays || [];
  if (sd.length) rows.push({ name: 'Inspelning', start: sd[0].date, end: sd[sd.length - 1].date });
  (c.phases || []).filter(x => !x.background && !x.milestone && x.end >= ymd(from) && x.start <= ymd(to)).slice(0, 8).forEach(x => rows.push({ name: (x.film ? x.film + ' ' : '') + x.name, start: x.start, end: x.end }));
  const ms = (c.phases || []).filter(x => x.milestone && x.start >= ymd(from) && x.start <= ymd(to));
  const dl = (c.deadlines || []).filter(x => x.date >= ymd(from) && x.date <= ymd(to));
  if (!rows.length && !ms.length && !dl.length) return empty('Inget de närmaste veckorna.');
  const months = []; for (let d = new Date(from.getFullYear(), from.getMonth() + 1, 1); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  return `<div class="tl"><div class="tlhead">${months.map(m => `<span style="left:${pos(ymd(m))}%">${MONTHS[m.getMonth()].slice(0, 3)}</span>`).join('')}</div>
    ${rows.map(r => `<div class="tlrow"><span class="tlname">${esc(r.name)}</span><div class="tltrack"><i style="left:${pos(r.start)}%;width:${Math.max(1, pos(r.end) - pos(r.start))}%;--tc:${tagColor(p.tag)}"></i></div></div>`).join('')}
    ${ms.length || dl.length ? `<div class="tlrow"><span class="tlname">Milstolpar</span><div class="tltrack">${[...ms.map(x => [x.start, x.name]), ...dl.map(x => [x.date, x.name])].map(([d, n]) => `<b class="ms" style="left:${pos(d)}%" title="${esc(n)} · ${esc(shortDate(d))}"></b>`).join('')}</div></div>` : ''}
    <div class="tlnow" style="--p:${pos(todayStr())}"></div></div>
    ${c.planSheetUrl ? `<a class="more-link" href="${esc(c.planSheetUrl)}" target="_blank" rel="noopener">Öppna hela planen</a>` : ''}`;
}

export function context(args) {
  if (!args[0]) return 'Mina projekt: ' + projects().filter(p => p.cfg).map(p => `${p.name} (${p.tag}, ${p.cfg.phase || ''})`).join(', ');
  const p = projects().find(x => x.tag === decodeURIComponent(args[0]).toUpperCase()); if (!p) return '';
  const lines = [`Projekt ${p.name} (${p.tag}).`];
  if (p.cfg?.shoot) lines.push(`Inspelning: dag ${p.cfg.shoot.doneDays} av ${p.cfg.shoot.totalDays}, ${p.cfg.shoot.filmed}/${p.cfg.shoot.scenes} scener filmade.`);
  if (S.data.summaries?.[p.tag]) lines.push('Sammanfattning: ' + S.data.summaries[p.tag]);
  p.tasks.slice(0, 20).forEach(x => lines.push(`- Uppgift: ${x.title}${x.due ? ' (' + x.due + ')' : ''}`));
  return lines.join('\n');
}
