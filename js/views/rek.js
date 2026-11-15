/* KC – rek: platsförslag per behov ur samlingen Platser (+ scenarkets platser som behov).
   Kort med bilder ur platsens Drive-mapp, karta, kontakt och status. Jämför 2–4 platser för samma behov och välj. */
import { S, api, emit, esc, toast, shortDate, todayStr, personIn, refresh } from '../core.js';

const STATUS = ['Förslag', 'Rekad', 'Vald', 'Bokad', 'Avbokad'];
const NEEDS = ['Behov', 'Bilder', 'För', 'Emot', 'Kostnad'];
const up = s => String(s || '').toUpperCase();
const cap = s => String(s || '').toLowerCase().replace(/(^|[\s/-])\p{L}/gu, m => m.toUpperCase());
const tagsOf = v => String(v || '').split(/[\s,]+/).filter(Boolean).map(t => up(t.startsWith('#') ? t : '#' + t));
const base = tag => '#/projekt/' + encodeURIComponent(tag) + '/produktion/rek';
const R = { behov: '', pick: new Set(), open: null, map: {} };
const IMG = {}, GEO = {};

const coll = () => (S.data?.collections || []).find(c => c.name === 'Platser');
const rowsFor = tag => (coll()?.rows || []).filter(r => tagsOf(r['Projekt']).includes(up(tag)));
const stCls = s => ({ Förslag: 'st-plan', Rekad: 'st-part', Vald: 'st-done', Bokad: 'st-done', Avbokad: 'st-none' }[s] || 'st-plan');
const behovOf = r => String(r['Behov'] || '').trim() || 'Utan behov';
const mapsUrl = r => 'https://maps.google.com/?q=' + encodeURIComponent(r['Adress'] || r['Namn'] || '');

/** Behov = scenarkets platser + behov som bara finns på rader. */
function needs(pr, rows) {
  const m = new Map();
  (pr.locations || []).forEach(l => m.set(up(l.place), { name: cap(l.place), key: up(l.place), strips: l.strips, dates: l.dates || [], rows: [] }));
  rows.forEach(r => { const b = behovOf(r), k = up(b); (m.get(k) || m.set(k, { name: b, key: k, strips: 0, dates: [], rows: [] }).get(k)).rows.push(r); });
  return [...m.values()].sort((a, b) => (b.rows.length ? 1 : 0) - (a.rows.length ? 1 : 0) || b.strips - a.strips || a.name.localeCompare(b.name, 'sv'));
}
const chosen = n => n.rows.find(r => r['Status'] === 'Bokad') || n.rows.find(r => r['Status'] === 'Vald');

function images(folder) {
  if (!folder) return null;
  if (IMG[folder]) return IMG[folder];
  IMG[folder] = { loading: true, list: [] };
  api('placeImages', { folder }).then(r => { IMG[folder] = { list: r.images || [] }; }).catch(() => { IMG[folder] = { list: [], error: true }; }).finally(() => emit('render'));
  return IMG[folder];
}
function geo(addr) {
  if (!addr) return null;
  if (GEO[addr] !== undefined) return GEO[addr];
  GEO[addr] = null;
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=se&q=' + encodeURIComponent(addr), { headers: { 'Accept-Language': 'sv' } })
    .then(r => r.json()).then(j => { GEO[addr] = j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon) } : false; })
    .catch(() => { GEO[addr] = false; }).finally(() => emit('render'));
  return null;
}
function mapHtml(r) {
  const addr = String(r['Adress'] || '').trim();
  if (!addr) return '<p class="muted rek-mapnote">Ingen adress.</p>';
  const g = geo(addr);
  if (g === null) return '<div class="rek-map rek-mapload"><span class="spin"></span></div>';
  if (!g) return `<p class="muted rek-mapnote">Hittade inte adressen på kartan. <a href="${esc(mapsUrl(r))}" target="_blank" rel="noopener">Google Maps ↗</a></p>`;
  const d = 0.006;
  return `<iframe class="rek-map" loading="lazy" title="Karta" src="https://www.openstreetmap.org/export/embed.html?bbox=${g.lon - d * 1.8},${g.lat - d},${g.lon + d * 1.8},${g.lat + d}&layer=mapnik&marker=${g.lat},${g.lon}"></iframe>`;
}
function pics(r, max = 6) {
  const im = images(r['Bilder']);
  if (!im) return '';
  if (im.loading) return '<div class="rek-pics"><i class="rek-ph"></i><i class="rek-ph"></i><i class="rek-ph"></i></div>';
  if (!im.list.length) return `<div class="rek-pics"><a class="rek-ph empty" href="${esc(r['Bilder'])}" target="_blank" rel="noopener">${im.error ? 'Mappen gick inte att läsa' : 'Inga bilder i mappen'}</a></div>`;
  const n = im.list.length > max ? max - 1 : max;
  return `<div class="rek-pics">${im.list.slice(0, n).map(i => `<a href="${esc(i.url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(i.thumb)}" alt="${esc(i.name)}"></a>`).join('')}${im.list.length > n ? `<a class="rek-more" href="${esc(r['Bilder'])}" target="_blank" rel="noopener">+${im.list.length - n}</a>` : ''}</div>`;
}
function contact(r) {
  const c = personIn(r['Kontakt']) || (r['Kontakt'] ? { name: r['Kontakt'], email: '' } : null);
  if (!c) return '';
  return c.email ? `<a href="#/person/${encodeURIComponent(c.email.toLowerCase())}">${esc(c.name)}</a>` : esc(c.name);
}
const statusSel = r => `<select class="rek-st ${stCls(r['Status'])}" data-rek-status="${esc(r._id)}">${STATUS.map(s => `<option ${s === (r['Status'] || 'Förslag') ? 'selected' : ''}>${s}</option>`).join('')}</select>`;

function card(r, tag) {
  const open = R.open === r._id;
  const f = (label, name, type = 'text', ph = '') => `<label class="rek-f"><span>${label}</span>${type === 'area' ? `<textarea data-rek-f="${name}" rows="2" placeholder="${esc(ph)}">${esc(r[name] || '')}</textarea>` : `<input type="${type}" data-rek-f="${name}" value="${esc(r[name] || '')}" placeholder="${esc(ph)}">`}</label>`;
  return `<article class="rek-card ${R.pick.has(r._id) ? 'picked' : ''} ${/Vald|Bokad/.test(r['Status'] || '') ? 'chosen' : ''}" data-rek-id="${esc(r._id)}">
    ${pics(r, 3)}
    <div class="rek-cb">
      <div class="rek-ch"><b>${esc(r['Namn'] || 'Namnlös plats')}</b>${statusSel(r)}</div>
      ${r['Adress'] ? `<a class="rek-addr" href="${esc(mapsUrl(r))}" target="_blank" rel="noopener">${esc(r['Adress'])} ↗</a>` : '<span class="muted">Ingen adress</span>'}
      <div class="rek-meta">${r['Rekdatum'] ? `<span>Rek ${esc(shortDate(r['Rekdatum']))}</span>` : ''}${r['Kostnad'] ? `<span>${esc(r['Kostnad'])}</span>` : ''}${r['Kontakt'] ? `<span>${contact(r)}</span>` : ''}</div>
      ${r['För'] || r['Emot'] ? `<div class="rek-pc">${r['För'] ? `<p><i>+</i>${esc(r['För'])}</p>` : ''}${r['Emot'] ? `<p><i>−</i>${esc(r['Emot'])}</p>` : ''}</div>` : ''}
      ${R.map[r._id] ? mapHtml(r) : ''}
      <div class="rek-ca">
        <label class="rek-pick"><input type="checkbox" data-rek-pick="${esc(r._id)}" ${R.pick.has(r._id) ? 'checked' : ''}> Jämför</label>
        <button class="btn" data-rek-map="${esc(r._id)}">${R.map[r._id] ? 'Dölj karta' : 'Karta'}</button>
        <button class="btn" data-rek-open="${esc(r._id)}">${open ? 'Stäng' : 'Redigera'}</button>
      </div>
      ${open ? `<div class="rek-edit">${f('Namn', 'Namn')}${f('Adress', 'Adress')}${f('Behov', 'Behov', 'text', 'Scenarkets plats, t.ex. Lägenheten')}${f('Bilder', 'Bilder', 'url', 'Länk till Drive-mappen')}${f('Kontakt', 'Kontakt', 'text', 'Namn <e-post>')}${f('Rekdatum', 'Rekdatum', 'date')}${f('Kostnad', 'Kostnad')}${f('För', 'För', 'area')}${f('Emot', 'Emot', 'area')}${f('Anteckning', 'Anteckning', 'area')}</div>` : ''}
    </div>
  </article>`;
}

function compare(rows, tag) {
  const sameNeed = new Set(rows.map(behovOf)).size === 1;
  const row = (label, fn) => `<tr><th>${label}</th>${rows.map(r => `<td>${fn(r)}</td>`).join('')}</tr>`;
  const ta = (r, n) => `<textarea data-rek-f="${n}" data-rek-row="${esc(r._id)}" rows="4" placeholder="${n === 'För' ? 'Det som talar för' : 'Det som talar emot'}">${esc(r[n] || '')}</textarea>`;
  return `<div class="rek-cmp-h"><a class="prod-back" href="${base(tag)}">‹ Alla platser</a><h2>Jämför · ${esc(behovOf(rows[0]))}</h2>${sameNeed ? '' : '<p class="firetext">Platserna har olika behov – Välj påverkar bara platser med samma behov.</p>'}</div>
  <div class="prod-tablewrap"><table class="rek-cmp" style="--n:${rows.length}"><tbody>
    <tr><th></th>${rows.map(r => `<td><b class="rek-cn">${esc(r['Namn'] || '')}</b>${statusSel(r)}</td>`).join('')}</tr>
    <tr class="rek-cimg"><th>Bilder</th>${rows.map(r => `<td>${pics(r, 4) || '<span class="muted">Ingen bildmapp</span>'}</td>`).join('')}</tr>
    ${row('Adress', r => r['Adress'] ? `<a href="${esc(mapsUrl(r))}" target="_blank" rel="noopener">${esc(r['Adress'])} ↗</a>` : '–')}
    <tr><th>Karta</th>${rows.map(r => `<td>${r['Adress'] ? mapHtml(r) : '–'}</td>`).join('')}</tr>
    ${row('Kostnad', r => esc(r['Kostnad'] || '–'))}
    ${row('Rekad', r => r['Rekdatum'] ? esc(shortDate(r['Rekdatum'])) : '–')}
    ${row('Kontakt', r => contact(r) || '–')}
    ${row('För', r => ta(r, 'För'))}
    ${row('Emot', r => ta(r, 'Emot'))}
    ${row('Anteckning', r => esc(r['Anteckning'] || ''))}
    <tr><th></th>${rows.map(r => `<td>${/Vald|Bokad/.test(r['Status'] || '') ? `<span class="st st-done">${esc(r['Status'])}</span>` : `<button class="btn solid" data-rek-choose="${esc(r._id)}">Välj</button>`}</td>`).join('')}</tr>
  </tbody></table></div>`;
}

export function rekHtml(p, pr, args = []) {
  const c = coll();
  if (!c) return '<p class="empty">Samlingen Platser finns inte än. Skapa den under Samlingar.</p>';
  const missing = NEEDS.filter(n => !(c.fields || []).some(f => f.name === n));
  const fix = missing.length ? `<p class="hint">Platser saknar fälten ${missing.join(', ')}. <button class="btn" data-rek-ensure>Lägg till fälten</button></p>` : '';
  const rows = rowsFor(p.tag);
  if (args[0] === 'jamfor') {
    const ids = String(args[1] || '').split(',');
    const sel = ids.map(id => rows.find(r => r._id === id)).filter(Boolean);
    if (sel.length >= 2) return `<div class="rek" data-rek-tag="${esc(p.tag)}">${compare(sel, p.tag)}</div>`;
  }
  const all = needs(pr, rows);
  const t = todayStr();
  const scope = R.scope || 'kommande';
  const isNext = n => n.rows.length || n.dates.some(d => d >= t);
  const list = scope === 'alla' ? all : all.filter(isNext);
  const cur = R.behov && all.some(n => n.key === R.behov) ? R.behov : '';
  const pick = [...R.pick].map(id => rows.find(r => r._id === id)).filter(Boolean);
  const pickbar = pick.length ? `<div class="rek-pickbar"><span>${pick.length} valda för jämförelse</span>${pick.length >= 2 && pick.length <= 4 ? `<a class="btn solid" href="${base(p.tag)}/jamfor/${pick.map(r => encodeURIComponent(r._id)).join(',')}">Jämför</a>` : `<span class="muted">${pick.length < 2 ? 'Välj minst två' : 'Högst fyra'}</span>`}<button class="btn" data-rek-clear>Rensa</button></div>` : '';
  const first = n => n.dates.filter(d => d >= t).sort()[0] || n.dates.slice().sort()[0] || '';
  if (cur) {
    const n = all.find(x => x.key === cur), ch = chosen(n);
    return `<div class="rek" data-rek-tag="${esc(p.tag)}">${fix}
      <div class="rek-bar"><button class="btn" data-rek-behov="">‹ Alla behov</button>${pickbar}</div>
      <section class="rek-need">
      <h3><span>${esc(n.name)}</span>${n.strips ? `<small>${n.strips} stripar${first(n) ? ' · ' + (first(n) >= t ? 'nästa ' : 'första ') + esc(shortDate(first(n))) : ''}</small>` : ''}${ch ? `<span class="st st-done">${esc(ch['Status'])}: ${esc(ch['Namn'] || '')}</span>` : n.dates.some(d => d >= t) ? '<span class="st st-plan">Inget valt</span>' : ''}
        <button class="btn rek-add" data-rek-add="${esc(n.key === 'UTAN BEHOV' ? '' : n.name)}">+ Förslag</button></h3>
      ${n.rows.length ? `<div class="rek-grid">${n.rows.slice().sort((a, b) => STATUS.indexOf(b['Status']) % 4 - STATUS.indexOf(a['Status']) % 4).map(r => card(r, p.tag)).join('')}</div>` : '<p class="empty">Inga förslag än. Lägg till ett med + Förslag.</p>'}
      </section></div>`;
  }
  const sorted = list.slice().sort((a, b) => (first(a) >= t ? 0 : 1) - (first(b) >= t ? 0 : 1) || String(first(a)).localeCompare(String(first(b))) || a.name.localeCompare(b.name, 'sv'));
  return `<div class="rek" data-rek-tag="${esc(p.tag)}">${fix}
    <div class="rek-bar"><span class="seg"><button class="${scope === 'kommande' ? 'on' : ''}" data-rek-scope="kommande">Kommande ${all.filter(isNext).length}</button><button class="${scope === 'alla' ? 'on' : ''}" data-rek-scope="alla">Alla ${all.length}</button></span>
      <button class="btn" data-rek-add="">+ Förslag</button>${pickbar}</div>
    ${sorted.length ? `<div class="rek-list">${sorted.map(n => { const ch = chosen(n), f = first(n); return `<button class="rek-row" data-rek-behov="${esc(n.key)}">
      <span class="rek-n"><b>${esc(n.name)}</b><small>${n.strips ? n.strips + ' stripar' : 'Eget behov'}${f ? ' · ' + (f >= t ? 'nästa ' : 'senast ') + esc(shortDate(f)) : ''}</small></span>
      <span class="rek-s">${ch ? `<span class="st st-done">${esc(ch['Status'])}: ${esc(ch['Namn'] || '')}</span>` : n.rows.length ? `<span class="st st-part">${n.rows.length} förslag</span>` : ''}</span>
      <span class="rek-go">›</span></button>`; }).join('')}</div>` : `<p class="empty">${scope === 'kommande' ? 'Inget kommande att reka. Visa Alla för hela listan.' : 'Inga platser i scenarket och inga rader i Platser för projektet.'}</p>`}
  </div>`;
}

// ---------- sparande ----------
async function save(id, values) {
  const c = coll(); const r = c?.rows.find(x => x._id === id); if (!r) return;
  const before = Object.fromEntries(Object.keys(values).map(k => [k, r[k]]));
  Object.assign(r, values);
  try { await api('saveRow', { collection: 'Platser', id, values }, true, r._src || c._src || 'jobb'); }
  catch (e) { Object.assign(r, before); toast('Kunde inte spara – ' + e.message); }
  emit('render');
}
async function choose(id, tag) {
  const c = coll(); const r = c?.rows.find(x => x._id === id); if (!r) return;
  const others = rowsFor(tag).filter(x => x !== r && up(behovOf(x)) === up(behovOf(r)) && /Vald/.test(x['Status'] || ''));
  const cmp = [...document.querySelectorAll('.rek-cmp [data-rek-choose], .rek-cmp [data-rek-status]')].map(b => b.dataset.rekChoose || b.dataset.rekStatus);
  const rest = rowsFor(tag).filter(x => x !== r && cmp.includes(x._id) && up(behovOf(x)) === up(behovOf(r)) && !/Avbokad|Bokad|Förslag/.test(x['Status'] || ''));
  const set = [...new Set([...others, ...rest])];
  const before = [r, ...set].map(x => [x, x['Status']]);
  r['Status'] = 'Vald'; set.forEach(x => x['Status'] = 'Förslag');
  emit('render');
  try { await api('saveRows', { collection: 'Platser', rows: [{ id: r._id, values: { Status: 'Vald' } }, ...set.map(x => ({ id: x._id, values: { Status: 'Förslag' } }))] }, true, r._src || c._src || 'jobb'); toast(`${r['Namn'] || 'Platsen'} vald${set.length ? ' · ' + set.length + ' till Förslag' : ''}`); }
  catch (e) { before.forEach(([x, s]) => x['Status'] = s); toast('Kunde inte spara – ' + e.message); emit('render'); }
}
async function add(tag, behov) {
  const c = coll(); if (!c) return;
  const values = { Namn: 'Ny plats', Projekt: tag, Status: 'Förslag', Behov: behov };
  try {
    const r = await api('saveRow', { collection: 'Platser', id: '', values }, true, c._src || 'jobb');
    c.rows.push({ _id: r.id, _src: c._src, ...values });
    R.open = r.id; emit('render');
  } catch (e) { toast('Kunde inte skapa – ' + e.message); }
}

let bound = false;
export function bindRek() {
  if (bound) return; bound = true;
  document.addEventListener('click', e => {
    const root = e.target.closest('.rek'); if (!root) return;
    const tag = root.dataset.rekTag, d = x => e.target.closest(x);
    let b;
    if ((b = d('[data-rek-behov]'))) { R.behov = b.dataset.rekBehov; emit('render'); window.scrollTo(0, 0); }
    else if ((b = d('[data-rek-scope]'))) { R.scope = b.dataset.rekScope; emit('render'); }
    else if ((b = d('[data-rek-map]'))) { R.map[b.dataset.rekMap] = !R.map[b.dataset.rekMap]; emit('render'); }
    else if ((b = d('[data-rek-open]'))) { R.open = R.open === b.dataset.rekOpen ? null : b.dataset.rekOpen; emit('render'); }
    else if (d('[data-rek-clear]')) { R.pick.clear(); emit('render'); }
    else if ((b = d('[data-rek-add]'))) add(tag, b.dataset.rekAdd);
    else if ((b = d('[data-rek-choose]'))) choose(b.dataset.rekChoose, tag);
    else if ((b = d('[data-rek-ensure]'))) { b.disabled = true; api('prodEnsure', {}, true).then(() => refresh()).then(() => toast('Fälten finns nu')).catch(err => toast('Gick inte – ' + err.message)); }
  });
  document.addEventListener('change', e => {
    if (!e.target.closest('.rek')) return;
    const pk = e.target.closest('[data-rek-pick]');
    if (pk) { pk.checked ? R.pick.add(pk.dataset.rekPick) : R.pick.delete(pk.dataset.rekPick); emit('render'); return; }
    const st = e.target.closest('[data-rek-status]');
    if (st) { save(st.dataset.rekStatus, { Status: st.value }); return; }
    const f = e.target.closest('[data-rek-f]');
    if (f) { const id = f.dataset.rekRow || f.closest('[data-rek-id]')?.dataset.rekId; if (id) save(id, { [f.dataset.rekF]: f.value }); }
  });
}
