/* UPPGIFTER – TasksPro i KC. Google Tasks med inre sidomeny (inbyggda vyer, listor, etiketter, smarta listor),
   sektioner per lista, återkommande, kanban, snabbtillägg och avklarade. */
import {
  S, api, emit, refresh, $, $$, esc, toast, ymd, addDays, todayStr, monday, dayLabel, shortDate, parseYmd, relTime,
  cleanTitle, tagHtml, contactOf, mailHref, initials, firstName, tagColor, isFire, isWaitingLong, projects, go, visible, TAG_RE, isDateTag,
} from '../core.js';
import { empty, head, seg, pref, setPref, openTask } from '../ui.js';
import { RULES, recurOf, withRule, afterComplete, normRule } from '../recur.js';

// ---------- data ----------
const today = () => todayStr();
const weekEnd = () => ymd(addDays(new Date(), 6));
const allOpen = () => (S.data?.tasks || []).filter(visible);
/** Avklarade senaste 14 dagarna. merge() i core tar inte med dem än – läs direkt ur källorna. */
function doneList() {
  const out = [];
  if (S.data?.doneTasks) S.data.doneTasks.forEach(t => out.push(t));
  else Object.entries(S.raw || {}).forEach(([src, d]) => (d.doneTasks || []).forEach(t => out.push({ ...t, _src: src })));
  const reopened = new Set(Object.keys(UNDONE));
  return out.filter(t => visible(t) && !reopened.has(t.id)).sort((a, b) => String(b.completed).localeCompare(String(a.completed)));
}
const UNDONE = {};                         // optimistiskt återöppnade
const lists = () => (S.data?.taskLists || []).filter(l => visible({ mode: l.mode }));
const listColor = l => tagColor('lista:' + (l?.title || l));
const allTags = () => {
  const c = {};
  allOpen().forEach(t => (t.tags || []).filter(g => !isDateTag(g)).forEach(g => c[g] = (c[g] || 0) + 1));
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
};
const hasLink = t => (t.links || []).some(l => l.type !== 'email') || /https?:\/\/(docs|drive)\.google\.com/.test(t.notes || '');
const snippet = t => String(t.notes || '').split('\n').map(x => x.trim()).filter(x => x && !/^(Kontakt|Från|Upprepa|Öppna mailet|Öppna i MailPro):/i.test(x) && !/^https?:\/\//.test(x)).join(' · ').slice(0, 140);

// ---------- konfiguration som följer med mellan enheter ----------
const cfg = () => (S.data?.layouts || {})._TASKS || { smart: [] };
async function saveCfg(c) {
  (S.data.layouts ||= {})._TASKS = c; emit('render');
  try { await api('setLayout', { tag: '_TASKS', layout: c }, true); } catch { toast('Kunde inte spara'); }
}
const secKey = listId => '_SEC_' + String(listId).slice(-12).toUpperCase();
const secCfg = listId => (S.data?.layouts || {})[secKey(listId)] || { sections: [], assign: {} };
async function saveSec(listId, c) {
  (S.data.layouts ||= {})[secKey(listId)] = c; emit('render');
  try { await api('setLayout', { tag: secKey(listId), layout: c }, true); } catch { toast('Kunde inte spara'); }
}
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------- vyer ----------
const BUILTIN = [
  ['idag', 'Idag', '◐'], ['vecka', 'Vecka', '▦'], ['forsenade', 'Försenade', '!'], ['alla', 'Alla', '○'],
  ['vantar', 'Väntar på', '⧗'], ['utandatum', 'Utan datum', '–'], ['klart', 'Avklarade', '✓'],
];
function parseView(arg) {
  const a = decodeURIComponent(arg || pref('t2_last', 'idag'));
  const i = a.indexOf(':');
  return i < 0 ? { kind: a, val: null, raw: a } : { kind: a.slice(0, i), val: a.slice(i + 1), raw: a };
}
function inBuiltin(kind, t) {
  const d = t.due, td = today();
  switch (kind) {
    case 'idag': return d && d <= td;
    case 'vecka': return d && d >= td && d <= weekEnd();
    case 'forsenade': return d && d < td;
    case 'vantar': return t.waiting;
    case 'utandatum': return !d;
    default: return true;
  }
}
function ruleMatch(r, t) {
  const d = t.due, td = today(), v = String(r.value || '');
  switch (r.kind) {
    case 'label': return (t.tags || []).includes(v.toUpperCase().replace(/^([^#])/, '#$1'));
    case 'list': return t.listId === v || t.list === v;
    case 'date':
      if (v === 'forsenad') return d && d < td;
      if (v === 'idag') return d === td;
      if (v === 'vecka') return d && d >= td && d <= weekEnd();
      if (v === 'utan') return !d;
      if (v.startsWith('fore:')) return d && d < v.slice(5);
      if (v.startsWith('efter:')) return d && d > v.slice(6);
      return true;
    case 'status': return v === 'vantar' ? !!t.waiting : v === 'aterkommande' ? !!recurOf(t) : !t.waiting;
    case 'kontakt': return v === 'ja' ? !!contactOf(t) : !contactOf(t);
    case 'mail': return v === 'ja' ? !!mailHref(t) : !mailHref(t);
  }
  return true;
}
function viewTasks(v) {
  const all = allOpen();
  if (v.kind === 'klart') return doneList();
  if (v.kind === 'lista') return all.filter(t => t.listId === v.val);
  if (v.kind === 'tagg') return all.filter(t => (t.tags || []).includes('#' + v.val));
  if (v.kind === 'smart') {
    const s = (cfg().smart || []).find(x => x.id === v.val); if (!s) return [];
    const rules = s.rules || []; if (!rules.length) return all;
    return all.filter(t => s.op === 'or' ? rules.some(r => ruleMatch(r, t)) : rules.every(r => ruleMatch(r, t)));
  }
  return all.filter(t => inBuiltin(v.kind, t));
}
function viewTitle(v) {
  if (v.kind === 'lista') return (S.data?.taskLists || []).find(l => l.id === v.val)?.title || 'Lista';
  if (v.kind === 'tagg') return '#' + v.val;
  if (v.kind === 'smart') return (cfg().smart || []).find(x => x.id === v.val)?.name || 'Smart lista';
  return (BUILTIN.find(b => b[0] === v.kind) || [, 'Uppgifter'])[1];
}

// ---------- tillstånd i vyn ----------
let SEL = null, CUR = null, ORDER = [];
const showDone = () => pref('t2_done', false);

// ---------- rendering ----------
export function render(el, args) {
  const v = parseView(args[0]);
  CUR = v; setPref('t2_last', v.raw);
  const layout = v.kind === 'klart' ? 'lista' : pref('t2_view', 'lista');
  const q = pref('t2_q', '');
  let items = viewTasks(v);
  if (q) { const s = q.toLowerCase(); items = items.filter(t => (t.title + ' ' + (t.notes || '') + ' ' + t.list).toLowerCase().includes(s)); }
  const totalOpen = allOpen().length;
  const sub = v.kind === 'klart' ? `${items.length} avklarade senaste 14 dagarna` : `${items.length} öppna av ${totalOpen}`;
  const acts = `${v.kind !== 'klart' ? seg('t2_view', [['lista', 'Lista'], ['tavla', 'Kanban']], layout) : ''}
    <button class="btn ${showDone() ? 'on' : ''}" data-tdone title="Visa/dölj avklarade (h)">${showDone() ? 'Dölj klara' : 'Visa klara'}</button>
    <button class="btn solid" data-tquick title="Snabbtillägg (a)">+ Ny</button>`;
  const body = !S.data ? empty('Ingen data än.') : layout === 'tavla' ? board(v, items) : listBody(v, items);
  el.innerHTML = `<div class="tp">
    <aside class="tpside">${sideHtml(v)}</aside>
    <div class="tpmain">
      <div class="tpmob">${mobSelect(v)}</div>
      ${head(esc(viewTitle(v)), sub, acts)}
      <div class="toolbar">
        <input class="tsearch" data-t2q value="${esc(q)}" placeholder="Sök…">
        ${layout === 'lista' && v.kind !== 'lista' && v.kind !== 'klart' ? `<label class="tsel">Gruppera <select data-t2group>${[['datum', 'Datum'], ['lista', 'Lista'], ['projekt', 'Projekt'], ['person', 'Person'], ['ingen', 'Ingen']].map(([k, l]) => `<option value="${k}" ${k === pref('t2_group', defGroup(v)) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${layout === 'lista' && v.kind !== 'klart' ? `<label class="tsel">Sortera <select data-t2sort>${[['datum', 'Datum'], ['titel', 'Titel'], ['andrad', 'Ändrad'], ['lista', 'Lista']].map(([k, l]) => `<option value="${k}" ${k === pref('t2_sort', 'datum') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${v.kind === 'lista' ? `<button class="btn" data-addsec>+ Sektion</button>` : ''}
        ${v.kind === 'smart' ? `<button class="btn" data-editsmart="${esc(v.val)}">Redigera smart lista</button>` : ''}
      </div>
      <div class="tpbody">${body}</div>
    </div></div>`;
  bind(el, v);
}

const defGroup = v => v.kind === 'alla' || v.kind === 'tagg' || v.kind === 'smart' ? 'datum' : 'ingen';

function sideHtml(v) {
  const all = allOpen();
  const cnt = k => k === 'klart' ? doneList().length : all.filter(t => inBuiltin(k, t)).length;
  const a = (raw, label, icon, n, extra = '') => `<a href="#/uppgifter/${encodeURIComponent(raw)}" class="${v.raw === raw ? 'on' : ''}" ${extra}><span class="ic">${icon}</span><span class="lb">${esc(label)}</span>${n ? `<span class="cnt ${raw === 'forsenade' ? 'red' : ''}">${n}</span>` : ''}</a>`;
  const ls = lists();
  const tags = allTags();
  const smart = cfg().smart || [];
  return `<nav class="tpnav">
    ${BUILTIN.map(([k, l, i]) => a(k, l, i, cnt(k))).join('')}
    <div class="grp"><span>Listor</span></div>
    ${ls.map(l => a('lista:' + l.id, l.title, `<i class="sw" style="--tc:${listColor(l)}"></i>`, all.filter(t => t.listId === l.id).length, `data-droplist="${esc(l.id)}" data-src="${esc(l._src)}"`)).join('')}
    ${tags.length ? `<div class="grp"><span>Etiketter</span></div>${tags.slice(0, 30).map(([g, n]) => a('tagg:' + g.slice(1), g.slice(1), `<i class="hash" style="--tc:${tagColor(g)}">#</i>`, n)).join('')}` : ''}
    <div class="grp"><span>Smarta listor</span><button data-newsmart title="Ny smart lista">+</button></div>
    ${smart.map(s => a('smart:' + s.id, s.name, '◇', viewTasks({ kind: 'smart', val: s.id }).length)).join('') || '<p class="tpempty">Bygg filter på etikett, lista, datum och status.</p>'}
  </nav>`;
}
function mobSelect(v) {
  const opt = (raw, label) => `<option value="${esc(raw)}" ${v.raw === raw ? 'selected' : ''}>${esc(label)}</option>`;
  return `<select class="tpviewsel" data-t2view>
    <optgroup label="Vyer">${BUILTIN.map(([k, l]) => opt(k, l)).join('')}</optgroup>
    <optgroup label="Listor">${lists().map(l => opt('lista:' + l.id, l.title)).join('')}</optgroup>
    ${allTags().length ? `<optgroup label="Etiketter">${allTags().slice(0, 30).map(([g]) => opt('tagg:' + g.slice(1), g)).join('')}</optgroup>` : ''}
    ${(cfg().smart || []).length ? `<optgroup label="Smarta listor">${cfg().smart.map(s => opt('smart:' + s.id, s.name)).join('')}</optgroup>` : ''}
  </select>`;
}

// ---------- rader ----------
function sortFn(by) {
  return {
    datum: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || String(a.position).localeCompare(String(b.position)),
    titel: (a, b) => cleanTitle(a.title).localeCompare(cleanTitle(b.title), 'sv'),
    andrad: (a, b) => String(b.updated).localeCompare(String(a.updated)),
    lista: (a, b) => String(a.list).localeCompare(String(b.list), 'sv') || (a.due || '9').localeCompare(b.due || '9'),
  }[by] || ((a, b) => 0);
}

function row(t, opt = {}) {
  const done = opt.done || S.done[t.id];
  const l = (S.data?.taskLists || []).find(x => x.id === t.listId);
  const p = contactOf(t), mh = mailHref(t), rec = recurOf(t), sn = snippet(t);
  const over = !done && t.due && t.due < today();
  const links = (t.links || []).filter(x => x.type !== 'email').slice(0, 2);
  const date = done ? (t.completed ? relTime(t.completed) : '') : t.due ? dayLabel(t.due) : isWaitingLong(t) ? `väntat ${Math.floor((Date.now() - new Date(t.updated)) / 864e5)} d` : '';
  return `<div class="tprow item task ${done ? 'done' : ''} ${t.pending ? 'pending' : ''} ${opt.child ? 'child' : ''} ${SEL === t.id ? 'sel' : ''} ${isWaitingLong(t) && !done ? 'fire' : ''}" data-task="${esc(t.id)}" ${opt.done ? 'data-isdone="1"' : ''} ${rec ? 'data-recur="1"' : ''} draggable="${opt.done ? 'false' : 'true'}" style="--lc:${listColor(l || t.list)}">
    <i class="rib"></i>
    <button class="check" aria-label="${done ? 'Återöppna' : 'Bocka av'}"></button>
    <div class="main">
      <div class="title">${esc(cleanTitle(t.title))}<span class="tags">${tagHtml(t.tags)}</span></div>
      ${sn || p || opt.showList ? `<div class="tsn">${opt.showList ? `<span class="tl">${esc(t.list)}</span>` : ''}${p ? `<a class="pchip" href="#/person/${encodeURIComponent(p.email.toLowerCase())}" title="${esc(p.name)}"><i>${esc(initials(p.name))}</i>${esc(firstName(p.name))}</a>` : ''}${sn ? `<span class="sn">${esc(sn)}</span>` : ''}</div>` : ''}
    </div>
    <div class="meta">
      ${rec ? `<span class="ico" title="Upprepas ${esc(rec)}">↻</span>` : ''}
      ${mh ? `<a class="ico" href="${esc(mh)}" title="Öppna mailet">✉︎</a>` : ''}
      ${links.map(x => `<a class="ico" href="${esc(x.link)}" target="_blank" rel="noopener" title="${esc(x.description || 'Länk')}">${/docs|drive/.test(x.link) ? '▤' : '↗'}</a>`).join('')}
      ${date ? `<span class="tdate ${over ? 'red' : ''}">${esc(date)}</span>` : ''}
      ${opt.done ? '' : `<button class="more" data-tmenu="${esc(t.id)}" aria-label="Mer">⋯</button>`}
    </div>
  </div>`;
}

/** Rader med deluppgifter indragna under sin förälder (om föräldern finns i urvalet). */
function rows(items, opt = {}) {
  const ids = new Set(items.map(t => t.id));
  const kids = {};
  items.filter(t => t.parent && ids.has(t.parent)).forEach(t => (kids[t.parent] ||= []).push(t));
  const out = [];
  items.filter(t => !(t.parent && ids.has(t.parent))).forEach(t => {
    out.push(row(t, opt)); ORDER.push(t.id);
    (kids[t.id] || []).sort((a, b) => String(a.position).localeCompare(String(b.position))).forEach(c => { out.push(row(c, { ...opt, child: true })); ORDER.push(c.id); });
  });
  return out.join('');
}

function groupKey(t, by) {
  const td = today();
  if (by === 'datum') {
    if (!t.due) return t.waiting ? ['9', 'Väntar på andra'] : ['8', 'Utan datum'];
    if (t.due < td) return ['0', 'Försenat'];
    if (t.due === td) return ['1', 'Idag'];
    if (t.due === ymd(addDays(new Date(), 1))) return ['2', 'Imorgon'];
    if (t.due <= ymd(addDays(monday(new Date()), 6))) return ['3', 'Resten av veckan'];
    if (t.due <= ymd(addDays(monday(new Date()), 13))) return ['4', 'Nästa vecka'];
    return ['5', 'Senare'];
  }
  if (by === 'lista') return [t.list, t.list];
  if (by === 'projekt') { const g = (t.tags || []).find(x => !isDateTag(x)); return g ? [g, projects().find(p => p.tag === g)?.name || g.slice(1)] : ['~', 'Utan projekt']; }
  if (by === 'person') { const c = contactOf(t); return c ? [c.email.toLowerCase(), c.name] : ['~', 'Ingen kontakt']; }
  return ['', ''];
}
const secHead = (id, label, n, extra = '', cls = '') => `<div class="tpsec ${cls}" ${extra}><span class="h">${esc(label)}</span><span class="n">${n}</span></div>`;

function listBody(v, items) {
  ORDER = [];
  const sortBy = pref('t2_sort', 'datum');
  items = items.slice().sort(sortFn(v.kind === 'klart' ? 'none' : sortBy));
  let html = '';
  if (v.kind === 'klart') {
    html = items.length ? rows(items, { done: true, showList: true }) : empty('Inget avklarat de senaste två veckorna.');
    return html;
  }
  if (v.kind === 'lista') {
    const sc = secCfg(v.val);
    const secIds = new Set(sc.sections.map(s => s.id));
    const inbox = items.filter(t => !secIds.has(sc.assign[t.id]));
    html += `<div class="tpgroup" data-dropsec="">${sc.sections.length ? secHead('', 'Utan sektion', inbox.length) : ''}${rows(inbox) || (sc.sections.length ? '' : empty('Listan är tom.'))}</div>`;
    sc.sections.forEach((s, i) => {
      const its = items.filter(t => sc.assign[t.id] === s.id);
      html += `<div class="tpgroup" data-dropsec="${esc(s.id)}">${secHead(s.id, s.name, its.length, `data-sec-id="${esc(s.id)}"`, 'named')}
        <div class="secmenu"><button data-secact="rename" data-sid="${esc(s.id)}">Byt namn</button><button data-secact="up" data-sid="${esc(s.id)}" ${i ? '' : 'disabled'}>↑</button><button data-secact="down" data-sid="${esc(s.id)}" ${i < sc.sections.length - 1 ? '' : 'disabled'}>↓</button><button data-secact="del" data-sid="${esc(s.id)}">Ta bort</button></div>
        ${rows(its) || '<p class="tpdrop">Dra uppgifter hit</p>'}</div>`;
    });
  } else {
    const by = pref('t2_group', defGroup(v));
    if (by === 'ingen') html = rows(items, { showList: true }) || empty(emptyText(v));
    else {
      const g = {};
      items.forEach(t => { const [k, l] = groupKey(t, by); (g[k] ||= { k, l, items: [] }).items.push(t); });
      const order = Object.values(g).sort((a, b) => by === 'datum' ? a.k.localeCompare(b.k) : a.k === '~' ? 1 : b.k === '~' ? -1 : a.l.localeCompare(b.l, 'sv'));
      html = order.map(gr => `<div class="tpgroup">${secHead(gr.k, gr.l, gr.items.length, '', gr.k === '0' ? 'red' : '')}${rows(gr.items, { showList: by !== 'lista' })}</div>`).join('') || empty(emptyText(v));
    }
  }
  if (showDone()) {
    const d = doneList().filter(t => v.kind === 'lista' ? t.listId === v.val : v.kind === 'tagg' ? (t.tags || []).includes('#' + v.val) : true).slice(0, 40);
    if (d.length) html += `<div class="tpgroup donegrp">${secHead('done', 'Avklarade', d.length)}${rows(d, { done: true, showList: v.kind !== 'lista' })}</div>`;
  }
  return html;
}
const emptyText = v => ({ idag: 'Inget för idag. Snyggt.', forsenade: 'Inget försenat.', vecka: 'Inget inplanerat i veckan.', vantar: 'Du väntar inte på någon.', utandatum: 'Allt har datum.' })[v.kind] || 'Inga uppgifter här.';

// ---------- kanban ----------
function board(v, items) {
  ORDER = [];
  items = items.slice().sort(sortFn('datum'));
  const card = t => { ORDER.push(t.id); return row(t, { showList: v.kind !== 'lista' }); };
  if (v.kind === 'lista') {
    const sc = secCfg(v.val), secIds = new Set(sc.sections.map(s => s.id));
    const cols = [{ id: '', name: 'Inkorg', items: items.filter(t => !secIds.has(sc.assign[t.id])) }, ...sc.sections.map(s => ({ id: s.id, name: s.name, items: items.filter(t => sc.assign[t.id] === s.id), sec: true }))];
    const done = doneList().filter(t => t.listId === v.val).slice(0, 30);
    return `<div class="board tpboard">${cols.map(c => `<div class="kcol" data-dropsec="${esc(c.id)}">
        <div class="kh" ${c.sec ? `draggable="true" data-colsec="${esc(c.id)}"` : ''}><span>${c.sec ? '<i class="grip">⋮⋮</i>' : ''}${esc(c.name)}</span><span class="n">${c.items.length}</span></div>
        <div class="kbody">${c.items.map(card).join('')}<button class="kadd" data-quickin="${esc(c.id)}">+ Ny</button></div></div>`).join('')}
      <div class="kcol donecol" data-dropdone="1"><div class="kh"><span>Klart</span><span class="n">${done.length}</span></div><div class="kbody">${done.map(t => row(t, { done: true })).join('') || '<p class="tpdrop">Dra hit för att bocka av</p>'}</div></div>
      <button class="kcol addcol" data-addsec>+ Sektion</button></div>`;
  }
  const ls = lists();
  return `<div class="board tpboard">${ls.map(l => {
    const its = items.filter(t => t.listId === l.id);
    return `<div class="kcol" data-droplist="${esc(l.id)}" data-src="${esc(l._src)}" style="--lc:${listColor(l)}"><div class="kh"><span><i class="sw" style="--tc:${listColor(l)}"></i>${esc(l.title)}</span><span class="n">${its.length}</span></div>
      <div class="kbody">${its.map(card).join('')}<button class="kadd" data-quickinlist="${esc(l.id)}">+ Ny</button></div></div>`;
  }).join('')}</div>`;
}

// ---------- händelser ----------
function bind(el, v) {
  el.querySelectorAll('[data-segname="t2_view"] [data-seg]').forEach(b => b.onclick = () => { setPref('t2_view', b.dataset.seg); emit('render'); });
  el.querySelector('[data-tdone]').onclick = () => { setPref('t2_done', !showDone()); emit('render'); };
  el.querySelector('[data-tquick]').onclick = () => openQuick();
  el.querySelector('[data-t2group]')?.addEventListener('change', e => { setPref('t2_group', e.target.value); emit('render'); });
  el.querySelector('[data-t2sort]')?.addEventListener('change', e => { setPref('t2_sort', e.target.value); emit('render'); });
  el.querySelector('[data-t2view]')?.addEventListener('change', e => go('uppgifter/' + encodeURIComponent(e.target.value)));
  const s = el.querySelector('[data-t2q]');
  s.oninput = () => { setPref('t2_q', s.value); clearTimeout(s._t); s._t = setTimeout(() => { const p = s.selectionStart; emit('render'); const n = el.querySelector('[data-t2q]'); n.focus(); n.setSelectionRange(p, p); }, 220); };
  el.querySelectorAll('[data-addsec]').forEach(b => b.onclick = () => addSection(v.val));
  el.querySelector('[data-newsmart]')?.addEventListener('click', () => editSmart(null));
  el.querySelector('[data-editsmart]')?.addEventListener('click', e => editSmart(e.target.dataset.editsmart));
  el.querySelectorAll('[data-secact]').forEach(b => b.onclick = () => sectionAction(v.val, b.dataset.secact, b.dataset.sid));
  el.querySelectorAll('[data-quickin]').forEach(b => b.onclick = () => openQuick({ listId: v.val, section: b.dataset.quickin }));
  el.querySelectorAll('[data-quickinlist]').forEach(b => b.onclick = () => openQuick({ listId: b.dataset.quickinlist }));
  el.querySelectorAll('[data-tmenu]').forEach(b => b.onclick = e => { e.stopPropagation(); rowMenu(b, b.dataset.tmenu, v); });

  // Bock på återkommande eller avklarade rader sköts här (capture, före den globala hanteraren i main.js).
  if (!el._tpcap) {
    el._tpcap = true;
    el.addEventListener('click', e => {
      const c = e.target.closest('.tprow .check'); if (!c) return;
      const r = c.closest('.tprow');
      if (r.dataset.isdone) { e.stopPropagation(); e.preventDefault(); return reopen(r.dataset.task); }
      if (r.dataset.recur) { e.stopPropagation(); e.preventDefault(); return completeRecurring(r.dataset.task); }
    }, true);
  }

  // Drag: till listor (sidomeny, kanbankolumner), sektioner, Klart-kolumnen, och sektionsordning.
  const drop = (zone, fn) => {
    zone.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/kc-task') || (zone.dataset.dropsec !== undefined && e.dataTransfer.types.includes('text/kc-sec'))) { e.preventDefault(); zone.classList.add('dropzone'); } });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dropzone'); });
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dropzone'); fn(e); });
  };
  el.querySelectorAll('[data-droplist]').forEach(z => drop(z, e => { const id = e.dataTransfer.getData('text/kc-task'); if (id) moveToList(id, z.dataset.droplist, z.dataset.src); }));
  el.querySelectorAll('[data-dropsec]').forEach(z => drop(z, e => {
    const sid = e.dataTransfer.getData('text/kc-sec');
    if (sid) return reorderSection(v.val, sid, z.dataset.dropsec);
    const id = e.dataTransfer.getData('text/kc-task'); if (id) assignSection(v.val, id, z.dataset.dropsec);
  }));
  el.querySelectorAll('[data-dropdone]').forEach(z => drop(z, e => { const id = e.dataTransfer.getData('text/kc-task'); if (id) completeAny(id); }));
  el.querySelectorAll('[data-colsec]').forEach(h => h.addEventListener('dragstart', e => { e.stopPropagation(); e.dataTransfer.setData('text/kc-sec', h.dataset.colsec); }));
}

const findOpen = id => (S.data?.tasks || []).find(t => t.id === id);

async function moveToList(id, listId, src) {
  const t = findOpen(id); if (!t || t.listId === listId) return;
  if (src && t._src !== src) return toast('Kan inte flytta mellan jobb och privat');
  const l = (S.data.taskLists || []).find(x => x.id === listId);
  const before = { listId: t.listId, list: t.list };
  Object.assign(t, { listId, list: l?.title || t.list, pending: true }); emit('render');
  try { const r = await api('updateTask', { listId: before.listId, taskId: t.id, newListId: listId }, true, t._src); if (r.id) t.id = r.id; t.pending = false; toast('Flyttad till ' + (l?.title || 'listan')); refresh(); }
  catch (e) { Object.assign(t, before, { pending: false }); emit('render'); toast('Kunde inte flytta – ' + e.message); }
}

async function completeAny(id) {
  const t = findOpen(id); if (!t) return;
  if (recurOf(t)) return completeRecurring(id);
  S.done[id] = true; emit('render');
  try { await api('complete', { listId: t.listId, taskId: id, done: true }, true, t._src); }
  catch { delete S.done[id]; emit('render'); toast('Kunde inte spara'); }
}
async function completeRecurring(id) {
  const t = findOpen(id); if (!t) return;
  if (S.done[id]) {   // ångra innan nästa skapats är inte möjligt – återöppna bara
    delete S.done[id]; emit('render');
    try { await api('complete', { listId: t.listId, taskId: id, done: false }, true, t._src); } catch {}
    return;
  }
  S.done[id] = true; emit('render');
  try { await api('complete', { listId: t.listId, taskId: id, done: true }, true, t._src); await afterComplete(t); }
  catch (e) { delete S.done[id]; emit('render'); toast('Kunde inte spara – ' + e.message); }
}
async function reopen(id) {
  const t = doneList().find(x => x.id === id); if (!t) return;
  UNDONE[id] = true; emit('render');
  try { await api('complete', { listId: t.listId, taskId: id, done: false }, true, t._src || 'jobb'); toast('Återöppnad'); await refresh(); delete UNDONE[id]; }
  catch (e) { delete UNDONE[id]; emit('render'); toast('Kunde inte återöppna – ' + e.message); }
}

// ---------- sektioner ----------
async function addSection(listId) {
  if (!listId) return;
  const name = prompt('Namn på sektionen:'); if (!name || !name.trim()) return;
  const c = structuredClone(secCfg(listId));
  c.sections.push({ id: uid(), name: name.trim() });
  saveSec(listId, c);
}
function sectionAction(listId, act, sid) {
  const c = structuredClone(secCfg(listId));
  const i = c.sections.findIndex(s => s.id === sid); if (i < 0) return;
  if (act === 'rename') { const n = prompt('Nytt namn:', c.sections[i].name); if (!n || !n.trim()) return; c.sections[i].name = n.trim(); }
  if (act === 'up' && i > 0) [c.sections[i - 1], c.sections[i]] = [c.sections[i], c.sections[i - 1]];
  if (act === 'down' && i < c.sections.length - 1) [c.sections[i + 1], c.sections[i]] = [c.sections[i], c.sections[i + 1]];
  if (act === 'del') { if (!confirm(`Ta bort sektionen "${c.sections[i].name}"? Uppgifterna ligger kvar i listan.`)) return; c.sections.splice(i, 1); Object.keys(c.assign).forEach(k => { if (c.assign[k] === sid) delete c.assign[k]; }); }
  saveSec(listId, c);
}
function reorderSection(listId, sid, targetSid) {
  if (!targetSid || sid === targetSid) return;
  const c = structuredClone(secCfg(listId));
  const from = c.sections.findIndex(s => s.id === sid), to = c.sections.findIndex(s => s.id === targetSid);
  if (from < 0 || to < 0) return;
  const [m] = c.sections.splice(from, 1); c.sections.splice(to, 0, m);
  saveSec(listId, c);
}
function assignSection(listId, taskId, sid) {
  const t = findOpen(taskId); if (!t || !listId) return;
  if (t.listId !== listId) return toast('Uppgiften ligger i en annan lista');
  const c = structuredClone(secCfg(listId));
  // städa bort tilldelningar för uppgifter som inte finns kvar
  const open = new Set((S.data.tasks || []).filter(x => x.listId === listId).map(x => x.id));
  Object.keys(c.assign).forEach(k => { if (!open.has(k)) delete c.assign[k]; });
  if (sid) c.assign[taskId] = sid; else delete c.assign[taskId];
  saveSec(listId, c);
}

// ---------- radmeny (upprepa, sektion, lista, ta bort) ----------
function rowMenu(btn, id, v) {
  closeMenu();
  const t = findOpen(id); if (!t) return;
  const rec = recurOf(t);
  const sc = secCfg(t.listId);
  const m = document.createElement('div');
  m.className = 'tpmenu';
  m.innerHTML = `<button data-m="open">Öppna</button>
    <div class="mh">Upprepa</div>${[['', 'Aldrig'], ...RULES].map(([k, l]) => `<button data-m="recur" data-v="${esc(k)}" class="${(rec || '') === k ? 'on' : ''}">${esc(l)}</button>`).join('')}
    ${sc.sections.length ? `<div class="mh">Sektion</div><button data-m="sec" data-v="" class="${!sc.assign[id] ? 'on' : ''}">Utan sektion</button>${sc.sections.map(s => `<button data-m="sec" data-v="${esc(s.id)}" class="${sc.assign[id] === s.id ? 'on' : ''}">${esc(s.name)}</button>`).join('')}` : ''}
    <div class="mh">Flytta till lista</div>${lists().filter(l => l._src === t._src && l.id !== t.listId).map(l => `<button data-m="list" data-v="${esc(l.id)}"><i class="sw" style="--tc:${listColor(l)}"></i>${esc(l.title)}</button>`).join('')}
    <div class="mh"></div><button data-m="del" class="danger">Ta bort</button>`;
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = Math.min(window.innerHeight - m.offsetHeight - 10, r.bottom + 4) + 'px';
  m.style.left = Math.max(10, Math.min(window.innerWidth - m.offsetWidth - 10, r.right - m.offsetWidth)) + 'px';
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    closeMenu();
    const a = b.dataset.m, val = b.dataset.v;
    if (a === 'open') return openTask(id);
    if (a === 'sec') return assignSection(t.listId, id, val);
    if (a === 'list') return moveToList(id, val, t._src);
    if (a === 'recur') return setRecur(t, val);
    if (a === 'del') {
      if (!confirm(`Ta bort "${cleanTitle(t.title)}"?`)) return;
      const i = S.data.tasks.indexOf(t); S.data.tasks.splice(i, 1); emit('render');
      try { await api('deleteTask', { listId: t.listId, taskId: t.id }, true, t._src); toast('Borttagen'); }
      catch (err) { S.data.tasks.splice(i, 0, t); emit('render'); toast('Kunde inte ta bort – ' + err.message); }
    }
  });
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}
function closeMenu() { $$('.tpmenu').forEach(x => x.remove()); }

async function setRecur(t, rule) {
  const before = t.notes;
  const notes = withRule(t.notes, normRule(rule));
  if (notes === (t.notes || '')) return;
  t.notes = notes; t.pending = true; emit('render');
  try {
    await api('updateTask', { listId: t.listId, taskId: t.id, notes, due: rule && !t.due ? today() : undefined }, true, t._src);
    if (rule && !t.due) t.due = today();
    t.pending = false; toast(rule ? 'Upprepas ' + rule : 'Upprepas inte'); emit('render');
  } catch (e) { t.notes = before; t.pending = false; emit('render'); toast('Kunde inte spara – ' + e.message); }
}

// ---------- smarta listor ----------
const RULE_KINDS = [['label', 'Etikett'], ['list', 'Lista'], ['date', 'Datum'], ['status', 'Status'], ['kontakt', 'Har kontakt'], ['mail', 'Har mail']];
function ruleValueInput(r, i) {
  const o = (v, l) => `<option value="${esc(v)}" ${String(r.value) === v ? 'selected' : ''}>${esc(l)}</option>`;
  if (r.kind === 'label') return `<select data-rv="${i}">${allTags().map(([g]) => o(g.slice(1), g)).join('')}</select>`;
  if (r.kind === 'list') return `<select data-rv="${i}">${lists().map(l => o(l.id, l.title)).join('')}</select>`;
  if (r.kind === 'date') {
    const pre = String(r.value).split(':')[0];
    return `<select data-rv="${i}" data-rdate>${[['forsenad', 'Försenad'], ['idag', 'Idag'], ['vecka', 'Kommande 7 dagar'], ['utan', 'Utan datum'], ['fore', 'Före…'], ['efter', 'Efter…']].map(([v, l]) => `<option value="${v}" ${pre === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${pre === 'fore' || pre === 'efter' ? `<input type="date" data-rd="${i}" value="${esc(String(r.value).split(':')[1] || today())}">` : ''}`;
  }
  if (r.kind === 'status') return `<select data-rv="${i}">${o('oppen', 'Öppen')}${o('vantar', 'Väntar på andra')}${o('aterkommande', 'Återkommande')}</select>`;
  return `<select data-rv="${i}">${o('ja', 'Ja')}${o('nej', 'Nej')}</select>`;
}
const defaultValue = k => k === 'label' ? (allTags()[0]?.[0] || '#').slice(1) : k === 'list' ? lists()[0]?.id || '' : k === 'date' ? 'forsenad' : k === 'status' ? 'oppen' : 'ja';
let SM = null;
function editSmart(id) {
  const ex = (cfg().smart || []).find(x => x.id === id);
  SM = ex ? structuredClone(ex) : { id: uid(), name: '', op: 'and', rules: [{ kind: 'label', value: defaultValue('label') }] };
  let d = $('#tpSmartDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="tpSmartDlg" class="sheet"><form id="tpSmartForm">
      <h2>Smart lista</h2>
      <input id="smName" class="big-input" placeholder="Namn, t.ex. Mejl att svara på" required autocomplete="off">
      <div class="row smop"><span>Visa uppgifter som matchar</span><select id="smOp"><option value="and">alla regler (OCH)</option><option value="or">någon regel (ELLER)</option></select></div>
      <div id="smRules" class="smrules"></div>
      <button type="button" class="btn" id="smAdd">+ Regel</button>
      <p class="hint" id="smCount"></p>
      <div class="actions"><button type="button" class="ghost danger" id="smDel">Ta bort</button><span class="spacer"></span><button type="button" class="ghost" id="smCancel">Avbryt</button><button type="submit">Spara</button></div>
    </form></dialog>`);
    d = $('#tpSmartDlg');
    $('#smCancel').onclick = () => d.close();
    $('#smAdd').onclick = () => { SM.rules.push({ kind: 'date', value: 'forsenad' }); drawRules(); };
    $('#smOp').onchange = e => { SM.op = e.target.value; drawRules(); };
    $('#smDel').onclick = () => { if (!confirm('Ta bort den smarta listan?')) return; d.close(); const c = structuredClone(cfg()); c.smart = (c.smart || []).filter(x => x.id !== SM.id); saveCfg(c); go('uppgifter/alla'); };
    $('#tpSmartForm').onsubmit = e => {
      e.preventDefault();
      SM.name = $('#smName').value.trim() || 'Smart lista';
      const c = structuredClone(cfg()); c.smart ||= [];
      const i = c.smart.findIndex(x => x.id === SM.id);
      if (i >= 0) c.smart[i] = SM; else c.smart.push(SM);
      d.close(); saveCfg(c); go('uppgifter/' + encodeURIComponent('smart:' + SM.id));
    };
    $('#smRules').addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.rk) { const i = +t.dataset.rk; SM.rules[i] = { kind: t.value, value: defaultValue(t.value) }; }
      else if (t.dataset.rv) { const i = +t.dataset.rv; SM.rules[i].value = t.hasAttribute('data-rdate') && (t.value === 'fore' || t.value === 'efter') ? t.value + ':' + today() : t.value; }
      else if (t.dataset.rd) { const i = +t.dataset.rd; SM.rules[i].value = String(SM.rules[i].value).split(':')[0] + ':' + t.value; }
      drawRules();
    });
    $('#smRules').addEventListener('click', e => { const b = e.target.closest('[data-rdel]'); if (b) { SM.rules.splice(+b.dataset.rdel, 1); drawRules(); } });
  }
  $('#smName').value = SM.name; $('#smOp').value = SM.op; $('#smDel').hidden = !ex;
  drawRules();
  d.showModal();
}
function drawRules() {
  $('#smRules').innerHTML = SM.rules.map((r, i) => `<div class="smrule"><select data-rk="${i}">${RULE_KINDS.map(([k, l]) => `<option value="${k}" ${r.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${ruleValueInput(r, i)}<button type="button" data-rdel="${i}" aria-label="Ta bort regel">×</button></div>`).join('') || '<p class="hint">Inga regler – listan visar allt.</p>';
  const n = allOpen().filter(t => !SM.rules.length || (SM.op === 'or' ? SM.rules.some(r => ruleMatch(r, t)) : SM.rules.every(r => ruleMatch(r, t)))).length;
  $('#smCount').textContent = `${n} uppgifter matchar just nu.`;
}

// ---------- snabbtillägg ----------
let QP = null;
async function parser() {
  if (QP) return QP;
  try { const m = await import('../quickparse.js'); QP = m.parseQuick; } catch { QP = localParse; }
  return QP;
}
/** Reserv om quickparse.js saknas: datum, #etiketter och upprepning på svenska. */
function localParse(text, { now = new Date() } = {}) {
  let s = ' ' + text + ' ';
  const out = { title: '', date: null, time: null, tags: [], recur: null, people: [] };
  const take = re => { const m = re.exec(s); if (m) s = s.replace(m[0], ' '); return m; };
  out.tags = (text.match(TAG_RE) || []).filter(t => !isDateTag(t)).map(t => t.toUpperCase());
  const rec = take(/\s(varje dag|dagligen|vardagar|varje vardag|veckodagar|varje vecka|veckovis|varannan vecka|varje månad|månadsvis|varje år|årligen)\s/i);
  if (rec) out.recur = normRule(rec[1]);
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m;
  if ((m = take(/\s(idag|i dag)\s/i))) out.date = ymd(d0);
  else if ((m = take(/\s(i övermorgon|övermorgon)\s/i))) out.date = ymd(addDays(d0, 2));
  else if ((m = take(/\s(imorgon|i morgon)\s/i))) out.date = ymd(addDays(d0, 1));
  else if ((m = take(/\snästa vecka\s/i))) out.date = ymd(addDays(monday(d0), 7));
  else if ((m = take(/\som (\d+) dagar?\s/i))) out.date = ymd(addDays(d0, +m[1]));
  else if ((m = take(/\s(\d{4}-\d{2}-\d{2})\s/))) out.date = m[1];
  else if ((m = take(/\s(\d{1,2})\/(\d{1,2})\s/))) { let d = new Date(d0.getFullYear(), +m[2] - 1, +m[1]); if (d < d0) d = new Date(d0.getFullYear() + 1, +m[2] - 1, +m[1]); out.date = ymd(d); }
  else if ((m = take(/\s(?:på\s)?(mån|tis|ons|tors|tor|fre|lör|sön)(dag|dagen)?\s/i))) {
    const idx = { mån: 1, tis: 2, ons: 3, tor: 4, tors: 4, fre: 5, lör: 6, sön: 0 }[m[1].toLowerCase()];
    let n = (idx - d0.getDay() + 7) % 7 || 7; out.date = ymd(addDays(d0, n));
  }
  if ((m = take(/\s(?:kl\.?\s?)(\d{1,2})(?:[:.](\d{2}))?\s/i))) out.time = `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
  out.title = s.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();
  return out;
}
let QPRESET = {};
async function openQuick(preset = {}) {
  QPRESET = preset;
  await parser();
  let d = $('#tpQuickDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="tpQuickDlg" class="sheet tpquick"><form id="tpQuickForm">
      <input id="tqText" class="big-input" placeholder="Ring Kim imorgon #PROJ varje vecka" autocomplete="off" required>
      <div class="tqprev" id="tqPrev"></div>
      <div class="row"><select id="tqList" aria-label="Lista"></select></div>
      <p class="hint">Datum (idag, imorgon, fre, 12/12, nästa vecka), #etiketter och upprepning (varje vecka) känns igen. ⏎ sparar.</p>
      <div class="actions"><span class="spacer"></span><button type="button" class="ghost" id="tqCancel">Avbryt</button><button type="submit">Lägg till</button></div>
    </form></dialog>`);
    d = $('#tpQuickDlg');
    $('#tqCancel').onclick = () => d.close();
    $('#tqText').oninput = drawPrev;
    $('#tpQuickForm').onsubmit = submitQuick;
  }
  $('#tqList').innerHTML = (S.data?.taskLists || []).map(l => `<option value="${esc(l.id)}" data-src="${esc(l._src)}">${esc(l.title)}</option>`).join('');
  const inbox = (S.data?.taskLists || []).find(l => /INBOX/i.test(l.title));
  $('#tqList').value = preset.listId || (CUR?.kind === 'lista' ? CUR.val : inbox?.id) || $('#tqList').value;
  $('#tqText').value = CUR?.kind === 'tagg' ? ' #' + CUR.val : '';
  drawPrev();
  d.showModal(); setTimeout(() => { const i = $('#tqText'); i.focus(); i.setSelectionRange(0, 0); }, 30);
}
function quickParse() {
  const r = QP($('#tqText').value, { kind: 'task', now: new Date() }) || {};
  if (!r.date && CUR?.kind === 'idag') r.date = today();
  r.title = String(r.title || '').replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();
  r.tags = [...new Set([...(r.tags || []), ...($('#tqText').value.match(TAG_RE) || []).filter(t => !isDateTag(t))].map(t => t.toUpperCase()))];
  return r;
}
function drawPrev() {
  const r = quickParse();
  $('#tqPrev').innerHTML = [
    r.title && `<span class="pv t">${esc(r.title)}</span>`,
    r.date && `<span class="pv">${esc(dayLabel(r.date))}${r.time ? ' ' + esc(r.time) : ''}</span>`,
    r.recur && `<span class="pv">↻ ${esc(r.recur)}</span>`,
    ...(r.tags || []).map(t => `<span class="tag" style="--tc:${tagColor(t)}">${esc(t.slice(1))}</span>`),
  ].filter(Boolean).join('');
}
async function submitQuick(e) {
  e.preventDefault();
  const r = quickParse();
  const tags = (r.tags || []).map(t => t.startsWith('#') ? t.toUpperCase() : '#' + t.toUpperCase());
  const title = [r.title || $('#tqText').value.trim(), ...tags].join(' ').trim();
  if (!title) return;
  const recur = r.recur ? normRule(r.recur) : null;
  const person = (r.people || [])[0];
  let notes = recur ? 'Upprepa: ' + recur : '';
  if (person && /@/.test(person.email || '')) notes = `Kontakt: ${person.name ? person.name + ' ' : ''}<${person.email}>` + (notes ? '\n' + notes : '');
  const opt = $('#tqList').selectedOptions[0];
  const listId = $('#tqList').value, src = opt?.dataset.src || 'jobb';
  const due = r.date || (recur ? today() : '');
  $('#tpQuickDlg').close();
  try {
    const res = await api('addTask', { title, notes, due, listId }, true, src);
    toast('Tillagd');
    if (QPRESET.section && res.id) { const c = structuredClone(secCfg(listId)); c.assign[res.id] = QPRESET.section; saveSec(listId, c); }
    refresh();
  } catch (err) { toast('Kunde inte spara – ' + err.message); }
}

// ---------- tangentbord ----------
export function key(e) {
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    if (!ORDER.length) return;
    const i = ORDER.indexOf(SEL);
    SEL = ORDER[k === 'ArrowDown' ? Math.min(ORDER.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)];
    emit('render');
    document.querySelector(`.tprow[data-task="${CSS.escape(SEL)}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (k === 'Escape') { SEL = null; emit('render'); return; }
  if (k === 'a' || k === 'i') { e.preventDefault(); return openQuick(); }
  if (k === 'h') { setPref('t2_done', !showDone()); return emit('render'); }
  if (k === 'l') { setPref('t2_view', 'lista'); return emit('render'); }
  if (k === 'b') { setPref('t2_view', 'tavla'); return emit('render'); }
  if (k === 's') { e.preventDefault(); return document.querySelector('[data-t2q]')?.focus(); }
  if (!SEL) return;
  const t = findOpen(SEL);
  if (k === ' ') { e.preventDefault(); if (!t) return reopen(SEL); return recurOf(t) ? completeRecurring(SEL) : import('../ui.js').then(m => m.toggleDone(SEL)); }
  if ((k === 'Enter' || k === 'e') && t) { e.preventDefault(); return openTask(SEL); }
  if ((k === 'x' || k === 'Backspace' || k === 'Delete') && t) {
    e.preventDefault();
    if (!confirm(`Ta bort "${cleanTitle(t.title)}"?`)) return;
    const i = S.data.tasks.indexOf(t); S.data.tasks.splice(i, 1); SEL = ORDER[ORDER.indexOf(t.id) + 1] || null; emit('render');
    api('deleteTask', { listId: t.listId, taskId: t.id }, true, t._src).then(() => toast('Borttagen')).catch(err => { S.data.tasks.splice(i, 0, t); emit('render'); toast('Kunde inte ta bort – ' + err.message); });
  }
}

export function context(args) {
  const v = parseView(args?.[0]);
  const list = viewTasks(v).slice(0, 40);
  return `Uppgifter – ${viewTitle(v)}:\n` + list.map(t => `- ${t.title}${t.due ? ' (' + t.due + ')' : ''} [${t.list}]${recurOf(t) ? ' ↻' + recurOf(t) : ''}`).join('\n');
}
