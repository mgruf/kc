/* KC – samlingar: Notion-lika databaser i KC_Databas-arket.
   Vyer: tabell, tavla, lista, kalender. Radsida med alla fält. */
import {
  S, api, refresh, emit, go, $, $$, esc, toast, ymd, parseYmd, addDays, todayStr, shortDate, MONTHS,
  tagColor, tagHtml, personIn, initials, firstName, people, knownTags,
} from '../core.js';
import { head, pref, setPref, empty } from '../ui.js';
import { relatedHtml as _rel } from '../kopplat.js';
const relRow = (c, r, t) => { try { return _rel('row', c.name + ':' + r._id, t || ''); } catch { return ''; } };

// ---------- typer ----------
const TYPES = [['text', 'Text'], ['lång', 'Lång text'], ['datum', 'Datum'], ['val', 'Val'], ['flerval', 'Flerval'], ['tal', 'Tal'], ['kryss', 'Kryss'], ['länk', 'Länk'], ['person', 'Person'], ['projekt', 'Projekt']];
const TEMPLATES = {
  Platser: [['Namn', 'text'], ['Projekt', 'projekt'], ['Status', 'val', 'Förslag,Rekad,Vald,Bokad,Avbokad'], ['Adress', 'text'], ['Kontakt', 'person'], ['Rekdatum', 'datum'], ['Länk', 'länk'], ['Anteckning', 'lång']],
  Leverantörer: [['Namn', 'text'], ['Typ', 'val', 'Postproduktion,Utrustning,Transport,Catering,Studio,VFX,Ljud,Övrigt'], ['Projekt', 'projekt'], ['Kontakt', 'person'], ['Telefon', 'text'], ['Avtal', 'länk'], ['Anteckning', 'lång']],
  Beslut: [['Beslut', 'text'], ['Projekt', 'projekt'], ['Datum', 'datum'], ['Varför', 'lång'], ['Vem', 'person'], ['Status', 'val', 'Gäller,Ändrat,Upphävt']],
  Utrustning: [['Namn', 'text'], ['Projekt', 'projekt'], ['Typ', 'val', 'Kamera,Ljus,Grip,Ljud,Fordon,Övrigt'], ['Leverantör', 'text'], ['Från', 'datum'], ['Till', 'datum'], ['Kostnad', 'tal'], ['Bokad', 'kryss'], ['Anteckning', 'lång']],
  Tom: [['Namn', 'text'], ['Projekt', 'projekt'], ['Anteckning', 'lång']],
};
const VIEWS = [['tabell', 'Tabell'], ['tavla', 'Tavla'], ['lista', 'Lista'], ['kalender', 'Kalender']];

const getColl = name => (S.data?.collections || []).find(c => c.name === name);
const titleField = c => (c.fields.find(f => f.type === 'text' && /^(namn|titel|beslut|rubrik)$/i.test(f.name)) || c.fields.find(f => f.type === 'text') || c.fields[0] || { name: '_id' }).name;
const isTrue = v => v === true || String(v).toUpperCase() === 'TRUE';
const normTag = t => { t = String(t || '').trim().toUpperCase(); return t ? (t.startsWith('#') ? t : '#' + t) : ''; };
const tagsOf = v => String(v || '').split(/[\s,]+/).map(normTag).filter(Boolean);
const optsOf = f => (f.options || []).map(String);
const multi = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const hasTag = (c, r, tag) => c.fields.some(f => f.type === 'projekt' && tagsOf(r[f.name]).includes(normTag(tag)));
const keyOf = (c, opts) => c.name + (opts?.filterTag ? '@' + opts.filterTag : '');
const cfg = (c, opts) => {
  const d = { view: 'tabell', q: '', tag: '', flt: '', sort: '', dir: 'asc', group: '', datef: '', month: '' };
  return Object.assign(d, pref('coll_' + keyOf(c, opts), {}));
};
const setCfg = (c, opts, patch) => setPref('coll_' + keyOf(c, opts), Object.assign(cfg(c, opts), patch));
const viewsFor = c => VIEWS.filter(([v]) => v === 'tavla' ? c.fields.some(f => f.type === 'val') : v === 'kalender' ? c.fields.some(f => f.type === 'datum') : true);

// ---------- värden ----------
function show(f, v, opt = {}) {
  if (v === '' || v == null) return '';
  switch (f.type) {
    case 'val': return pill(v);
    case 'flerval': return multi(v).map(pill).join(' ');
    case 'datum': return `<span class="tnum">${esc(shortDate(String(v).slice(0, 10)))}</span>`;
    case 'kryss': return isTrue(v) ? '<span class="coll-check on">✓</span>' : '';
    case 'tal': return `<span class="tnum">${esc(Number(v).toLocaleString('sv-SE'))}</span>`;
    case 'länk': { let h = String(v); try { h = new URL(v).hostname.replace(/^www\./, ''); } catch {} return `<a class="coll-link" href="${esc(v)}" target="_blank" rel="noopener">${esc(h)}</a>`; }
    case 'person': { const p = personIn(v) || { name: String(v), email: '' }; return p.email ? `<a class="pchip" href="#/person/${encodeURIComponent(p.email.toLowerCase())}"><i>${esc(initials(p.name))}</i>${esc(opt.full ? p.name : firstName(p.name))}</a>` : esc(v); }
    case 'projekt': return `<span class="tags">${tagHtml(tagsOf(v))}</span>`;
    case 'lång': return `<span class="coll-long">${esc(String(v).split('\n')[0].slice(0, 120))}</span>`;
    default: return esc(v);
  }
}
const pill = v => `<span class="coll-pill" style="--tc:${tagColor(v)}">${esc(v)}</span>`;
function toStore(f, v) {
  if (f.type === 'kryss') return isTrue(v) ? 'TRUE' : 'FALSE';
  if (f.type === 'tal') { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return v === '' || isNaN(n) ? '' : n; }
  if (f.type === 'projekt') return tagsOf(v).join(' ');
  return v;
}

// ---------- urval ----------
function rowsFor(c, opts) {
  const o = cfg(c, opts);
  let rows = c.rows.slice();
  if (opts?.filterTag) rows = rows.filter(r => hasTag(c, r, opts.filterTag));
  if (o.tag && !opts?.filterTag) rows = rows.filter(r => hasTag(c, r, o.tag));
  if (o.flt) { const [fn, val] = o.flt.split('='); const f = c.fields.find(x => x.name === fn); if (f) rows = rows.filter(r => f.type === 'flerval' ? multi(r[fn]).includes(val) : String(r[fn]) === val); }
  if (o.q) { const q = o.q.toLowerCase(); rows = rows.filter(r => c.fields.some(f => String(r[f.name] ?? '').toLowerCase().includes(q))); }
  const sf = c.fields.find(f => f.name === o.sort);
  if (sf) {
    const k = r => { const v = r[sf.name]; return sf.type === 'tal' ? Number(v) || 0 : sf.type === 'val' ? optsOf(sf).indexOf(String(v)) : String(v ?? '').toLowerCase(); };
    rows.sort((a, b) => { const x = k(a), y = k(b); const r = x < y ? -1 : x > y ? 1 : 0; return o.dir === 'desc' ? -r : r; });
  }
  return rows;
}

// ---------- sparande ----------
async function saveValue(c, r, f, raw) {
  const v = toStore(f, raw);
  if (String(r[f.name] ?? '') === String(v ?? '')) return;
  const before = r[f.name];
  r[f.name] = v; r._pending = true; emit('render');
  try {
    await api('saveRow', { collection: c.name, id: r._id, values: { [f.name]: v } }, true, c._src);
    r._pending = false;
    if (c.name === 'Projekt') refresh(); else emit('render');
  } catch (e) { r[f.name] = before; r._pending = false; emit('render'); toast('Kunde inte spara – ' + e.message); }
}
async function createRow(c, values = {}) {
  const r = { _id: 'tmp' + Date.now(), _src: c._src, _pending: true };
  c.fields.forEach(f => r[f.name] = values[f.name] ?? '');
  c.rows.push(r); emit('render');
  const vals = {}; Object.keys(values).forEach(k => { const f = c.fields.find(x => x.name === k); if (f && values[k] !== '') vals[k] = toStore(f, values[k]); });
  try {
    const res = await api('saveRow', { collection: c.name, values: vals }, true, c._src);
    r._id = res.id; r._pending = false;
    if (c.name === 'Projekt') refresh(); else emit('render');
    return r;
  } catch (e) { c.rows = c.rows.filter(x => x !== r); emit('render'); toast('Kunde inte skapa – ' + e.message); return null; }
}
async function deleteRow(c, r) {
  if (!confirm(`Ta bort "${r[titleField(c)] || 'raden'}"?`)) return false;
  const i = c.rows.indexOf(r); c.rows.splice(i, 1); emit('render');
  try { await api('deleteRow', { collection: c.name, id: r._id }, true, c._src); toast('Borttagen'); if (c.name === 'Projekt') refresh(); return true; }
  catch (e) { c.rows.splice(i, 0, r); emit('render'); toast('Kunde inte ta bort – ' + e.message); return false; }
}
const presetFor = (c, opts) => { const v = {}; if (opts?.filterTag) { const f = c.fields.find(x => x.type === 'projekt'); if (f) v[f.name] = opts.filterTag; } return v; };

// ---------- redigering i cell ----------
let EDIT = null;   // { coll, id, field, draft }
function editorHtml(c, r, f, val, cls = 'coll-ed') {
  const v = val ?? '';
  const a = `class="${cls}" data-ef="${esc(f.name)}"`;
  switch (f.type) {
    case 'val': return `<select ${a}><option value=""></option>${optsOf(f).map(o => `<option ${o === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'datum': return `<input type="date" ${a} value="${esc(String(v).slice(0, 10))}">`;
    case 'tal': return `<input inputmode="decimal" ${a} value="${esc(v)}">`;
    case 'kryss': return `<input type="checkbox" ${a} ${isTrue(v) ? 'checked' : ''}>`;
    case 'lång': return `<textarea ${a} rows="${cls === 'coll-ed' ? 3 : 6}">${esc(v)}</textarea>`;
    case 'person': return `<input ${a} value="${esc(v)}" list="collPeople" placeholder="Namn <adress>" autocomplete="off">`;
    case 'projekt': return `<input ${a} value="${esc(v)}" list="collTags" placeholder="#PROJEKT" autocomplete="off">`;
    case 'flerval': return `<input ${a} value="${esc(v)}" list="collOpt_${esc(f.name)}" placeholder="${esc(optsOf(f).join(', '))}" autocomplete="off">`;
    case 'länk': return `<input type="url" ${a} value="${esc(v)}" placeholder="https://">`;
    default: return `<input ${a} value="${esc(v)}" autocomplete="off">`;
  }
}
function datalists(c) {
  return `<datalist id="collPeople">${people().filter(p => p.email).slice(0, 800).map(p => `<option value="${esc(p.name !== p.email ? `${p.name} <${p.email}>` : p.email)}">`).join('')}</datalist>
    <datalist id="collTags">${knownTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    ${c.fields.filter(f => f.type === 'flerval').map(f => `<datalist id="collOpt_${esc(f.name)}">${optsOf(f).map(o => `<option value="${esc(o)}">`).join('')}</datalist>`).join('')}`;
}

// ---------- vyer ----------
function tableHtml(c, rows, opts) {
  const tf = titleField(c);
  const cols = c.fields;
  const cell = (r, f) => {
    if (EDIT && EDIT.coll === c.name && EDIT.id === r._id && EDIT.field === f.name) return `<td class="ed">${editorHtml(c, r, f, EDIT.draft)}</td>`;
    if (f.type === 'kryss') return `<td data-cell="${esc(f.name)}" class="t-kryss"><input type="checkbox" class="coll-tick" ${isTrue(r[f.name]) ? 'checked' : ''}></td>`;
    if (f.name === tf) return `<td data-cell="${esc(f.name)}" class="t-title"><a class="coll-open" href="#/samling/${encodeURIComponent(c.name)}/${encodeURIComponent(r._id)}" title="Öppna">↗</a><span>${esc(r[f.name]) || '<span class="ph">Utan namn</span>'}</span></td>`;
    return `<td data-cell="${esc(f.name)}" class="t-${f.type}">${show(f, r[f.name])}</td>`;
  };
  return `<div class="coll-scroll"><table class="coll-table">
    <thead><tr>${cols.map(f => `<th data-sortf="${esc(f.name)}" class="t-${f.type}"><span class="ty">${typeGlyph(f.type)}</span>${esc(f.name)}</th>`).join('')}<th class="addf"><button data-addfield title="Lägg till fält">+</button></th></tr></thead>
    <tbody>${rows.map(r => `<tr data-row="${esc(r._id)}" class="${r._pending ? 'pending' : ''}">${cols.map(f => cell(r, f)).join('')}<td class="rowx"><button data-delrow title="Ta bort">×</button></td></tr>`).join('')}
    <tr class="addrow"><td colspan="${cols.length + 1}"><button data-addrow>+ Ny rad</button></td></tr></tbody></table></div>`;
}
const typeGlyph = t => ({ text: 'Aa', 'lång': '¶', datum: '◷', val: '◉', flerval: '☰', tal: '#', kryss: '☑', 'länk': '↗', person: '◎', projekt: '▣' }[t] || 'Aa');

function boardHtml(c, rows, opts) {
  const o = cfg(c, opts);
  const vf = c.fields.filter(f => f.type === 'val');
  const g = vf.find(f => f.name === o.group) || vf[0];
  const tf = titleField(c);
  const groups = [...optsOf(g), ''];
  const extra = c.fields.filter(f => f !== g && f.name !== tf && ['datum', 'person', 'projekt', 'val', 'tal'].includes(f.type)).slice(0, 3);
  return `<div class="coll-board" data-group="${esc(g.name)}">${groups.map(gv => {
    const rs = rows.filter(r => String(r[g.name] || '') === gv);
    if (gv === '' && !rs.length) return '';
    return `<div class="coll-col" data-gv="${esc(gv)}"><div class="coll-colh">${gv ? pill(gv) : '<span class="ph">Inget värde</span>'}<span class="n">${rs.length}</span></div>
      ${rs.map(r => `<div class="coll-card ${r._pending ? 'pending' : ''}" draggable="true" data-crow="${esc(r._id)}" data-href="samling/${encodeURIComponent(c.name)}/${encodeURIComponent(r._id)}">
        <div class="ct">${esc(r[tf]) || '<span class="ph">Utan namn</span>'}</div>
        ${extra.map(f => r[f.name] !== '' && r[f.name] != null ? `<div class="cp">${show(f, r[f.name])}</div>` : '').join('')}</div>`).join('')}
      <button class="coll-cadd" data-addrow data-gv="${esc(gv)}">+ Ny</button></div>`;
  }).join('')}</div>`;
}

function listHtml(c, rows) {
  const tf = titleField(c);
  const props = c.fields.filter(f => f.name !== tf && !['lång'].includes(f.type)).slice(0, 5);
  if (!rows.length) return empty('Inga rader.') + `<button class="coll-addline" data-addrow>+ Ny rad</button>`;
  return `<div class="coll-list">${rows.map(r => `<div class="coll-li ${r._pending ? 'pending' : ''}" data-href="samling/${encodeURIComponent(c.name)}/${encodeURIComponent(r._id)}">
    <span class="lt">${esc(r[tf]) || '<span class="ph">Utan namn</span>'}</span>
    <span class="lp">${props.map(f => show(f, r[f.name])).filter(Boolean).join('<i class="sep">·</i>')}</span></div>`).join('')}</div>
    <button class="coll-addline" data-addrow>+ Ny rad</button>`;
}

function calHtml(c, rows, opts) {
  const o = cfg(c, opts);
  const df = c.fields.filter(f => f.type === 'datum');
  const f = df.find(x => x.name === o.datef) || df[0];
  const tf = titleField(c);
  const m0 = o.month ? parseYmd(o.month + '-01') : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const first = new Date(m0.getFullYear(), m0.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const t = todayStr();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), s = ymd(d);
    if (i >= 35 && d.getMonth() !== m0.getMonth()) break;
    const rs = rows.filter(r => String(r[f.name] || '').slice(0, 10) === s);
    cells += `<div class="coll-day ${d.getMonth() !== m0.getMonth() ? 'out' : ''} ${s === t ? 'today' : ''}" data-day="${s}">
      <div class="coll-dn">${d.getDate()}</div>${rs.map(r => `<a class="coll-ev" href="#/samling/${encodeURIComponent(c.name)}/${encodeURIComponent(r._id)}">${esc(r[tf]) || 'Utan namn'}</a>`).join('')}</div>`;
  }
  const undated = rows.filter(r => !r[f.name]).length;
  return `<div class="coll-calh"><button class="btn" data-month="-1">‹</button><b>${MONTHS[m0.getMonth()]} ${m0.getFullYear()}</b><button class="btn" data-month="1">›</button><button class="btn" data-month="0">Idag</button>
      ${undated ? `<span class="ph">${undated} utan ${esc(f.name.toLowerCase())}</span>` : ''}</div>
    <div class="coll-cal"><div class="wd">mån</div><div class="wd">tis</div><div class="wd">ons</div><div class="wd">tor</div><div class="wd">fre</div><div class="wd">lör</div><div class="wd">sön</div>${cells}</div>`;
}

function toolbarHtml(c, opts) {
  const o = cfg(c, opts);
  const vs = viewsFor(c);
  const view = vs.some(([v]) => v === o.view) ? o.view : 'tabell';
  const vf = c.fields.filter(f => f.type === 'val');
  const df = c.fields.filter(f => f.type === 'datum');
  const hasProj = c.fields.some(f => f.type === 'projekt');
  const fltOpts = c.fields.filter(f => f.type === 'val' || f.type === 'flerval').flatMap(f => optsOf(f).map(v => [`${f.name}=${v}`, `${f.name}: ${v}`]));
  return `<div class="coll-bar">
    <div class="seg small">${vs.map(([v, l]) => `<button type="button" data-cview="${v}" class="${v === view ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${opts?.compact ? '' : `<input class="coll-search" placeholder="Sök" value="${esc(o.q)}">`}
    ${hasProj && !opts?.filterTag ? `<select data-cset="tag"><option value="">Alla projekt</option>${knownTags().map(t => `<option ${o.tag === t ? 'selected' : ''} value="${esc(t)}">${esc(t.slice(1))}</option>`).join('')}</select>` : ''}
    ${fltOpts.length ? `<select data-cset="flt"><option value="">Alla</option>${fltOpts.map(([v, l]) => `<option ${o.flt === v ? 'selected' : ''} value="${esc(v)}">${esc(l)}</option>`).join('')}</select>` : ''}
    ${view === 'tavla' && vf.length > 1 ? `<select data-cset="group">${vf.map(f => `<option ${o.group === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}
    ${view === 'kalender' && df.length > 1 ? `<select data-cset="datef">${df.map(f => `<option ${o.datef === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}
    ${opts?.compact ? '' : `<select data-cset="sort"><option value="">Ingen sortering</option>${c.fields.map(f => `<option ${o.sort === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
    ${o.sort ? `<button class="btn" data-cdir title="Byt riktning">${o.dir === 'desc' ? '↓' : '↑'}</button>` : ''}`}
    <span class="coll-count"></span>
    <button class="btn solid" data-addrow>+ Ny</button>
  </div>`;
}

function bodyHtml(c, opts) {
  const o = cfg(c, opts);
  const vs = viewsFor(c);
  const view = vs.some(([v]) => v === o.view) ? o.view : 'tabell';
  const rows = rowsFor(c, opts);
  const html = view === 'tavla' ? boardHtml(c, rows, opts) : view === 'lista' ? listHtml(c, rows) : view === 'kalender' ? calHtml(c, rows, opts) : tableHtml(c, rows, opts);
  return { html, count: rows.length };
}

/** Bäddas in i projektvyn: opts = { filterTag, compact }. */
export function renderCollectionView(el, coll, opts = {}) {
  const c = typeof coll === 'string' ? getColl(coll) : coll;
  if (!c) { el.innerHTML = empty('Samlingen finns inte.'); return; }
  if (keepFocus(el)) return;
  const b = bodyHtml(c, opts);
  el.innerHTML = `<div class="coll ${opts.compact ? 'compact' : ''}" data-coll="${esc(c.name)}" data-ftag="${esc(opts.filterTag || '')}" data-compact="${opts.compact ? 1 : ''}">
    ${toolbarHtml(c, opts)}<div class="coll-body">${b.html}</div>${datalists(c)}</div>`;
  const n = el.querySelector('.coll-count'); if (n) n.textContent = b.count + (b.count === 1 ? ' rad' : ' rader');
  focusEditor(el);
}

function redrawBody(root) {
  const c = getColl(root.dataset.coll); if (!c) return;
  const opts = optsOfRoot(root);
  const b = bodyHtml(c, opts);
  root.querySelector('.coll-body').innerHTML = b.html;
  const n = root.querySelector('.coll-count'); if (n) n.textContent = b.count + (b.count === 1 ? ' rad' : ' rader');
}
const optsOfRoot = root => ({ filterTag: root.dataset.ftag || '', compact: !!root.dataset.compact });

// Ritas inte om medan man skriver i ett fält – annars försvinner markören.
function keepFocus(el) {
  const a = document.activeElement;
  return a && el.contains(a) && a.matches('.coll-ed, .coll-search, .coll-page input, .coll-page textarea, .coll-page select, .coll-new input, .coll-new select');
}
function focusEditor(el) {
  const ed = el.querySelector('.coll-table .coll-ed');
  if (ed && document.activeElement !== ed) { ed.focus(); if (ed.setSelectionRange && ed.type !== 'date' && ed.type !== 'url' && ed.type !== 'checkbox') { try { ed.setSelectionRange(ed.value.length, ed.value.length); } catch {} } }
}

// ---------- radsida ----------
let NEWPRESET = {};
function rowPage(el, c, r, isNew) {
  const tf = titleField(c);
  const titleF = c.fields.find(f => f.name === tf);
  const props = c.fields.filter(f => f.name !== tf && f.type !== 'lång');
  const longs = c.fields.filter(f => f.name !== tf && f.type === 'lång');
  const val = f => isNew ? (NEWPRESET[f.name] ?? '') : r[f.name];
  const after = f => {
    if (isNew) return '';
    const v = r[f.name]; if (v === '' || v == null) return '';
    if (f.type === 'person' || f.type === 'projekt' || f.type === 'länk') return `<span class="pv">${show(f, v, { full: true })}</span>`;
    return '';
  };
  el.innerHTML = `<div class="coll-page" data-coll="${esc(c.name)}" data-rid="${esc(isNew ? '' : r._id)}">
    <div class="crumb"><a href="#/samling/${encodeURIComponent(c.name)}">${esc(c.name)}</a></div>
    ${titleF ? `<input class="coll-ptitle" data-ef="${esc(tf)}" value="${esc(val(titleF) || '')}" placeholder="Utan namn" autocomplete="off">` : ''}
    <div class="coll-props">${props.map(f => `<div class="coll-prop"><label><span class="ty">${typeGlyph(f.type)}</span>${esc(f.name)}</label><div class="pvw">${editorHtml(c, r, f, val(f), 'coll-pe')}${after(f)}</div></div>`).join('')}</div>
    ${longs.map(f => `<div class="coll-longf"><label>${esc(f.name)}</label>${editorHtml(c, r, f, val(f), 'coll-pe')}</div>`).join('')}
    <div class="actions">${isNew ? '' : '<button type="button" class="ghost danger" data-pdel>Ta bort</button>'}<span class="spacer"></span>
      ${S.data?.dbUrl && !isNew ? `<a class="ghost" href="${esc(S.data.dbUrl)}" target="_blank" rel="noopener" style="font-size:13px;color:var(--ink-3)">Öppna arket</a>` : ''}
      ${isNew ? `<a class="ghost" href="#/samling/${encodeURIComponent(c.name)}">Avbryt</a><button type="button" data-pcreate>Skapa</button>` : ''}</div>
    ${c.name === 'Projekt' && isNew ? '<p class="hint">Taggen (t.ex. #VER2) kopplar ihop uppgifter, anteckningar och händelser med projektet. Länkar till Drive-mapp, scenark och produktionsplan gör att KC läser in dem.</p>' : ''}
    ${isNew ? '' : `<div class="coll-rel">${relRow(c, r, val(titleF))}</div>`}
    ${datalists(c)}</div>`;
  if (isNew) setTimeout(() => el.querySelector('.coll-ptitle')?.focus(), 30);
}

// ---------- ny samling ----------
let NEWC = { name: '', tpl: 'Platser', fields: null };
function newCollPage(el) {
  if (keepFocus(el)) return;
  if (!NEWC.fields) NEWC.fields = TEMPLATES[NEWC.tpl].map(([name, type, options]) => ({ name, type, options: options || '' }));
  el.innerHTML = head('Ny samling', 'En samling är en egen databas i KC – platser, leverantörer, beslut, utrustning eller vad du vill.') + `
  <div class="coll-new">
    <input class="coll-ptitle" data-nc="name" placeholder="Namn, t.ex. Platser" value="${esc(NEWC.name)}" autocomplete="off">
    <div class="chips">${Object.keys(TEMPLATES).map(t => `<button type="button" class="chip ${NEWC.tpl === t ? 'on' : ''}" data-tpl="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div class="coll-nf">${NEWC.fields.map((f, i) => `<div class="coll-nfr" data-i="${i}">
      <input data-nf="name" value="${esc(f.name)}" placeholder="Fältnamn">
      <select data-nf="type">${TYPES.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input data-nf="options" value="${esc(f.options)}" placeholder="Val, separerade med komma" ${f.type === 'val' || f.type === 'flerval' ? '' : 'hidden'}>
      <button type="button" class="btn" data-nfdel title="Ta bort fält">×</button></div>`).join('')}</div>
    <button type="button" class="btn" data-nfadd>+ Fält</button>
    <div class="actions"><span class="spacer"></span><button type="button" data-nccreate>Skapa samling</button></div>
  </div>`;
}

// ---------- huvudvy ----------
export function render(el, args) {
  const name = args[0];
  if (!S.data) { el.innerHTML = head('Samlingar') + empty('Hämtar…'); return; }
  if (name === '_ny') return newCollPage(el);
  const c = getColl(name);
  if (!c) {
    const list = (S.data.collections || []);
    el.innerHTML = head('Samlingar', '', '<a class="btn solid" href="#/samling/_ny">+ Ny samling</a>') +
      (list.length ? `<div class="coll-list">${list.map(x => `<a class="coll-li" href="#/samling/${encodeURIComponent(x.name)}"><span class="lt">${esc(x.name)}</span><span class="lp">${x.rows.length} rader · ${x.fields.length} fält</span></a>`).join('')}</div>`
        : empty(name ? `Samlingen "${esc(name)}" finns inte än. Databas-arket skapas när den nya Code.gs har körts.` : 'Inga samlingar än.'));
    return;
  }
  const sub = args[1];
  if (sub) {
    const key = c.name + '/' + sub;
    if (el.dataset.collKey === key && keepFocus(el)) return;
    el.dataset.collKey = key;
    if (sub === 'ny') { if (args[2]) NEWPRESET = { ...NEWPRESET, ...presetFor(c, { filterTag: decodeURIComponent(args[2]) }) }; return rowPage(el, c, {}, true); }
    const r = c.rows.find(x => x._id === sub);
    if (!r) { el.innerHTML = `<div class="crumb"><a href="#/samling/${encodeURIComponent(c.name)}">${esc(c.name)}</a></div>` + empty('Raden finns inte längre.'); return; }
    return rowPage(el, c, r, false);
  }
  if (el.dataset.collKey === c.name && keepFocus(el)) return;
  el.dataset.collKey = c.name;
  const sub2 = c.name === 'Projekt' ? 'Projektregistret styr vilka projekt KC känner till.' : `${c.fields.length} fält`;
  el.innerHTML = head(esc(c.name), sub2, S.data.dbUrl ? `<a class="btn" href="${esc(S.data.dbUrl)}" target="_blank" rel="noopener">Öppna arket</a>` : '') + '<div class="coll-host"></div>';
  renderCollectionView(el.querySelector('.coll-host'), c, {});
}

export function context(args) {
  const c = getColl(args?.[0]); if (!c) return 'Samlingar i KC.';
  const tf = titleField(c);
  return `Samlingen ${c.name} (${c.rows.length} rader). Fält: ${c.fields.map(f => f.name + ' (' + f.type + ')').join(', ')}.\n` + c.rows.slice(0, 30).map(r => '- ' + (r[tf] || '')).join('\n');
}

// ---------- händelser (delegerade, en gång) ----------
const rootOf = t => t.closest('.coll');
const rowOf = (c, t) => { const id = t.closest('[data-row]')?.dataset.row || t.closest('[data-crow]')?.dataset.crow; return c.rows.find(r => r._id === id); };

document.addEventListener('click', async e => {
  const t = e.target;
  const dh = t.closest('.coll-card[data-href], .coll-li[data-href]');
  if (dh && !t.closest('a, button')) return go(dh.dataset.href);
  // ny samling
  if (t.closest('.coll-new')) {
    const tp = t.closest('[data-tpl]');
    if (tp) { NEWC.tpl = tp.dataset.tpl; NEWC.fields = null; return emit('render'); }
    if (t.closest('[data-nfadd]')) { NEWC.fields.push({ name: '', type: 'text', options: '' }); return emit('render'); }
    if (t.closest('[data-nfdel]')) { NEWC.fields.splice(Number(t.closest('[data-i]').dataset.i), 1); return emit('render'); }
    if (t.closest('[data-nccreate]')) {
      const name = NEWC.name.trim();
      if (!name) return toast('Ge samlingen ett namn');
      if ((S.data.collections || []).some(c => c.name.toLowerCase() === name.toLowerCase())) return toast('Det finns redan en samling med det namnet');
      const fields = NEWC.fields.filter(f => f.name.trim()).map(f => ({ name: f.name.trim(), type: f.type, options: f.options }));
      if (!fields.length) return toast('Lägg till minst ett fält');
      try { await api('addCollection', { name, fields }, true); toast('Samlingen är skapad'); NEWC = { name: '', tpl: 'Platser', fields: null }; await refresh(); go('samling/' + encodeURIComponent(name)); }
      catch (err) { toast('Kunde inte skapa – ' + err.message); }
    }
    return;
  }
  // radsida
  const page = t.closest('.coll-page');
  if (page) {
    const c = getColl(page.dataset.coll); if (!c) return;
    if (t.closest('[data-pdel]')) { const r = c.rows.find(x => x._id === page.dataset.rid); if (r && await deleteRow(c, r)) go('samling/' + encodeURIComponent(c.name)); return; }
    if (t.closest('[data-pcreate]')) {
      const vals = {};
      $$('[data-ef]', page).forEach(i => { const v = i.type === 'checkbox' ? (i.checked ? 'TRUE' : '') : i.value; if (v !== '') vals[i.dataset.ef] = v; });
      if (!Object.keys(vals).length) return toast('Fyll i något först');
      NEWPRESET = {};
      const r = await createRow(c, vals);
      if (r) go('samling/' + encodeURIComponent(c.name) + '/' + encodeURIComponent(r._id));
    }
    return;
  }
  const root = rootOf(t); if (!root) return;
  const c = getColl(root.dataset.coll); if (!c) return;
  const opts = optsOfRoot(root);
  const vb = t.closest('[data-cview]');
  if (vb) { setCfg(c, opts, { view: vb.dataset.cview }); EDIT = null; return emit('render'); }
  if (t.closest('[data-cdir]')) { const o = cfg(c, opts); setCfg(c, opts, { dir: o.dir === 'desc' ? 'asc' : 'desc' }); return emit('render'); }
  const mb = t.closest('[data-month]');
  if (mb) {
    const o = cfg(c, opts); const n = Number(mb.dataset.month);
    const m0 = o.month && n ? parseYmd(o.month + '-01') : new Date();
    const m = n ? new Date(m0.getFullYear(), m0.getMonth() + n, 1) : new Date();
    setCfg(c, opts, { month: n ? `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}` : '' }); return emit('render');
  }
  if (t.closest('[data-addfield]')) return addFieldDialog(c);
  if (t.closest('[data-addrow]')) {
    const v = presetFor(c, opts);
    const gv = t.closest('[data-addrow]').dataset.gv;
    const o = cfg(c, opts);
    if (gv != null && gv !== '') { const g = c.fields.find(f => f.name === o.group) || c.fields.find(f => f.type === 'val'); if (g) v[g.name] = gv; }
    const view = o.view;
    if (view === 'tabell') {
      const r = await createRow(c, v);
      if (r) { document.activeElement?.blur?.(); EDIT = { coll: c.name, id: r._id, field: titleField(c), draft: '' }; emit('render'); }
    } else { NEWPRESET = v; go('samling/' + encodeURIComponent(c.name) + '/ny'); }
    return;
  }
  if (t.closest('[data-delrow]')) { const r = rowOf(c, t); if (r) deleteRow(c, r); return; }
  const day = t.closest('.coll-day');
  if (day && !t.closest('a')) {
    const o = cfg(c, opts); const df = c.fields.filter(f => f.type === 'datum'); const f = df.find(x => x.name === o.datef) || df[0];
    NEWPRESET = { ...presetFor(c, opts), [f.name]: day.dataset.day }; return go('samling/' + encodeURIComponent(c.name) + '/ny');
  }
  const th = t.closest('th[data-sortf]');
  if (th) { const o = cfg(c, opts); const f = th.dataset.sortf; setCfg(c, opts, o.sort === f ? { dir: o.dir === 'asc' ? 'desc' : 'asc' } : { sort: f, dir: 'asc' }); return emit('render'); }
  const tick = t.closest('.coll-tick');
  if (tick) { const r = rowOf(c, t); const f = c.fields.find(x => x.name === t.closest('[data-cell]').dataset.cell); if (r && f) saveValue(c, r, f, tick.checked ? 'TRUE' : 'FALSE'); return; }
  const td = t.closest('td[data-cell]');
  if (td && !t.closest('a')) {
    const r = rowOf(c, t); const f = c.fields.find(x => x.name === td.dataset.cell);
    if (!r || !f || r._pending) return;
    commitEdit();
    document.activeElement?.blur?.();
    EDIT = { coll: c.name, id: r._id, field: f.name, draft: r[f.name] ?? '' };
    emit('render');
  }
});

// Klick utanför en cell sparar.
document.addEventListener('mousedown', e => { if (EDIT && !e.target.closest('td.ed') && !e.target.closest('.coll-table td[data-cell]')) setTimeout(() => commitEdit(), 0); }, true);

function commitEdit(cancel) {
  if (!EDIT) return;
  const ed = EDIT; EDIT = null;
  if (document.activeElement?.matches?.('.coll-ed')) document.activeElement.blur();
  const c = getColl(ed.coll); const r = c?.rows.find(x => x._id === ed.id); const f = c?.fields.find(x => x.name === ed.field);
  if (!cancel && c && r && f) saveValue(c, r, f, ed.draft); else emit('render');
}

document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('.coll-search')) { const root = rootOf(t); const c = getColl(root.dataset.coll); setCfg(c, optsOfRoot(root), { q: t.value }); return redrawBody(root); }
  if (t.matches('.coll-table .coll-ed') && EDIT) EDIT.draft = t.type === 'checkbox' ? (t.checked ? 'TRUE' : 'FALSE') : t.value;
  if (t.closest('.coll-new')) {
    if (t.dataset.nc === 'name') NEWC.name = t.value;
    const row = t.closest('[data-i]'); if (row && t.dataset.nf) NEWC.fields[Number(row.dataset.i)][t.dataset.nf] = t.value;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-cset]')) { const root = rootOf(t); const c = getColl(root.dataset.coll); setCfg(c, optsOfRoot(root), { [t.dataset.cset]: t.value }); return emit('render'); }
  if (t.closest('.coll-new') && t.dataset.nf === 'type') { const row = t.closest('[data-i]'); NEWC.fields[Number(row.dataset.i)].type = t.value; row.querySelector('[data-nf="options"]').hidden = !(t.value === 'val' || t.value === 'flerval'); return; }
  if (t.matches('.coll-table .coll-ed') && EDIT && (t.tagName === 'SELECT' || t.type === 'date' || t.type === 'checkbox')) { EDIT.draft = t.type === 'checkbox' ? (t.checked ? 'TRUE' : 'FALSE') : t.value; t.blur(); return commitEdit(); }
  // radsidan sparar varje fält när det ändras
  const page = t.closest('.coll-page');
  if (page && page.dataset.rid && t.dataset.ef) {
    const c = getColl(page.dataset.coll); const r = c?.rows.find(x => x._id === page.dataset.rid); const f = c?.fields.find(x => x.name === t.dataset.ef);
    if (r && f) { t.blur(); saveValue(c, r, f, t.type === 'checkbox' ? (t.checked ? 'TRUE' : 'FALSE') : t.value); }
  }
});

document.addEventListener('keydown', e => {
  const t = e.target;
  if (t.matches('.coll-table .coll-ed')) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return commitEdit(true); }
    if (e.key === 'Enter' && !(t.tagName === 'TEXTAREA' && e.shiftKey)) { e.preventDefault(); EDIT.draft = t.value; return commitEdit(); }
    if (e.key === 'Tab' && EDIT) {
      e.preventDefault(); EDIT.draft = t.value;
      const c = getColl(EDIT.coll); const i = c.fields.findIndex(f => f.name === EDIT.field); const id = EDIT.id;
      commitEdit();
      const nf = c.fields[i + (e.shiftKey ? -1 : 1)];
      if (nf && nf.type !== 'kryss') { const r = c.rows.find(x => x._id === id); EDIT = { coll: c.name, id, field: nf.name, draft: r?.[nf.name] ?? '' }; emit('render'); }
    }
  }
  if (t.matches('.coll-page input:not([type=checkbox])') && e.key === 'Enter' && t.closest('.coll-page').dataset.rid) { e.preventDefault(); t.blur(); }
  if (t.matches('.coll-page [data-ef]') && e.key === 'Escape') t.blur();
}, true);

// radsidan: textfält sparas när man lämnar dem
document.addEventListener('focusout', e => {
  const t = e.target;
  const page = t.closest?.('.coll-page');
  if (!page || !page.dataset.rid || !t.dataset?.ef || t.type === 'date' || t.type === 'checkbox' || t.tagName === 'SELECT') return;
  const c = getColl(page.dataset.coll); const r = c?.rows.find(x => x._id === page.dataset.rid); const f = c?.fields.find(x => x.name === t.dataset.ef);
  if (r && f) saveValue(c, r, f, t.value);
});

// tavla: dra kort mellan kolumner
let dragRow = null;
document.addEventListener('dragstart', e => { const k = e.target.closest?.('.coll-card'); if (k) { dragRow = k.dataset.crow; e.dataTransfer.setData('text/kc-row', dragRow); e.dataTransfer.effectAllowed = 'move'; k.classList.add('dragging'); } });
document.addEventListener('dragend', e => { e.target.closest?.('.coll-card')?.classList.remove('dragging'); $$('.coll-col.dropzone').forEach(x => x.classList.remove('dropzone')); dragRow = null; });
document.addEventListener('dragover', e => { const col = e.target.closest?.('.coll-col'); if (col && dragRow) { e.preventDefault(); $$('.coll-col.dropzone').forEach(x => x !== col && x.classList.remove('dropzone')); col.classList.add('dropzone'); } });
document.addEventListener('drop', e => {
  const col = e.target.closest?.('.coll-col'); if (!col || !dragRow) return;
  e.preventDefault();
  const root = rootOf(col); const c = getColl(root.dataset.coll); const r = c.rows.find(x => x._id === dragRow);
  const f = c.fields.find(x => x.name === col.closest('.coll-board').dataset.group);
  dragRow = null; col.classList.remove('dropzone');
  if (r && f) saveValue(c, r, f, col.dataset.gv);
});

// ---------- nytt fält ----------
function addFieldDialog(c) {
  let d = $('#collFieldDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="collFieldDlg" class="sheet"><form id="collFieldForm"><h2>Nytt fält</h2>
      <input id="cfName" placeholder="Fältnamn" required autocomplete="off">
      <select id="cfType">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <input id="cfOpts" placeholder="Val, separerade med komma" hidden>
      <div class="actions"><span class="spacer"></span><button type="button" class="ghost" id="cfCancel">Avbryt</button><button type="submit">Lägg till</button></div></form></dialog>`);
    d = $('#collFieldDlg');
    $('#cfType').addEventListener('change', () => { $('#cfOpts').hidden = !['val', 'flerval'].includes($('#cfType').value); });
    $('#cfCancel').addEventListener('click', () => d.close());
    $('#collFieldForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const coll = getColl(d.dataset.coll); if (!coll) return d.close();
      const field = { name: $('#cfName').value.trim(), type: $('#cfType').value, options: $('#cfOpts').value.trim() };
      if (!field.name) return;
      if (coll.fields.some(f => f.name.toLowerCase() === field.name.toLowerCase())) return toast('Fältet finns redan');
      d.close();
      coll.fields.push({ name: field.name, type: field.type, options: field.options.split(',').map(s => s.trim()).filter(Boolean) });
      coll.rows.forEach(r => r[field.name] = '');
      emit('render');
      try { await api('addField', { collection: coll.name, field }, true, coll._src); toast('Fältet är tillagt'); }
      catch (err) { coll.fields = coll.fields.filter(f => f.name !== field.name); emit('render'); toast('Kunde inte lägga till – ' + err.message); }
    });
  }
  d.dataset.coll = c.name;
  $('#collFieldForm').reset(); $('#cfOpts').hidden = true;
  d.showModal(); setTimeout(() => $('#cfName').focus(), 30);
}
