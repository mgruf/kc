/* KC – callsheet ur KC: ett utkast per inspelningsdag byggt ur scenarket, Team och kontakterna.
   Tider och noter sparas i samlingen 'Callsheets'. Export: utskrift (A4) och Google-dokument i callsheetmappen. */
import { S, api, emit, esc, toast, todayStr, parseYmd, shortDate, DAYS, MONTHS, personIn } from '../core.js';
import { teamFor } from './team.js';

const up = s => String(s || '').toUpperCase();
const cap = s => String(s || '').toLowerCase().replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase());
const base = p => '#/projekt/' + encodeURIComponent(p.tag) + '/produktion';
const fullDate = s => { const d = parseYmd(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const tagsOf = v => String(v || '').split(/[\s,]+/).filter(Boolean).map(t => up(t.startsWith('#') ? t : '#' + t));
const FIELDS = [['Crew call', 'crewCall', 'tid'], ['Lunch', 'lunch', 'tid'], ['Wrap', 'wrap', 'tid'], ['Bas', 'base', ''], ['Parkering', 'parking', ''], ['Sjukhus', 'hospital', '']];

function coll() { return (S.data?.collections || []).find(c => c.name === 'Callsheets'); }
function rowFor(tag, date) { const c = coll(); return c ? c.rows.find(r => tagsOf(r['Projekt']).includes(up(tag)) && String(r['Datum']) === date) : null; }
const phoneOf = email => { const c = (S.contacts?.list || []).find(x => (x.emails || []).some(e => e.toLowerCase() === String(email || '').toLowerCase())); return (c?.phones || [])[0] || ''; };

/** Allt som behövs för en dag, ur produktionsdata + Team. */
export function callsheetData(p, pr, date) {
  const d = (pr.days || []).find(x => x.date === date) || null;
  const strips = (pr.strips || []).filter(s => s.date === date);
  const roles = Object.fromEntries((pr.roles || []).map(r => [up(r.code), r]));
  const team = teamFor(p.tag);
  const actors = team.filter(r => /skådespel/i.test(r['Typ'] || ''));
  const castCodes = [...new Set(strips.flatMap(s => (s.cast || []).map(up)))];
  const cast = castCodes.map(code => {
    const r = roles[code] || { code, name: code };
    const t = actors.find(x => up(String(x['Roll'] || '').trim()) === up(String(r.name || '').trim()) || up(String(x['Roll'] || '').trim()) === code);
    const pp = t ? (personIn(t['Person']) || { name: t['Person'], email: '' }) : null;
    return { code, role: cap(r.name || ''), actor: pp ? pp.name : (r.actor || ''), phone: pp ? phoneOf(pp.email) : '', email: pp?.email || '', scenes: strips.filter(s => (s.cast || []).map(up).includes(code)).map(s => s.scene) };
  }).sort((a, b) => (roles[b.code]?.days || 0) - (roles[a.code]?.days || 0));
  const crew = team.filter(r => !/skådespel|beställare|finansiär/i.test(r['Typ'] || '') && !/avböjd/i.test(r['Status'] || ''))
    .filter(r => !r['Från'] || !r['Till'] || (r['Från'] <= date && r['Till'] >= date))
    .map(r => { const pp = personIn(r['Person']) || { name: r['Person'], email: '' }; return { dept: r['Avdelning'] || r['Typ'] || 'Övrigt', name: pp.name, role: r['Roll'] || '', phone: phoneOf(pp.email), email: pp.email }; })
    .sort((a, b) => a.dept.localeCompare(b.dept, 'sv') || a.name.localeCompare(b.name, 'sv'));
  const locations = [...new Map(strips.filter(s => s.place).map(s => [s.place + '|' + (s.address || ''), { place: s.place, address: s.address || '' }])).values()];
  const [h0, h1] = String(d?.hours || '').split(/\s*[-–]\s*/);
  return { d, strips, cast, crew, locations, defaults: { crewCall: h0 || '', wrap: h1 || '' } };
}

// ---------- sol upp/ned (NOAA:s förenklade algoritm) ----------
function sunTimes(date, lat, lon) {
  const d = parseYmd(date), rad = Math.PI / 180;
  const n = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH > 1 || cosH < -1) return null;
  const ha = Math.acos(cosH) / rad;
  const tz = -new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTimezoneOffset();
  const fmt = m => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0').replace('60', '59')}`; };
  return { rise: fmt(720 - 4 * (lon + ha) - eqt + tz), set: fmt(720 - 4 * (lon - ha) - eqt + tz) };
}

// ---------- väder för dagen ----------
const WX = c => c === 0 ? 'Klart' : c <= 2 ? 'Lätt molnigt' : c === 3 ? 'Mulet' : c <= 48 ? 'Dimma' : c <= 57 ? 'Duggregn' : c <= 67 ? 'Regn' : c <= 77 ? 'Snö' : c <= 82 ? 'Regnskurar' : c <= 86 ? 'Snöbyar' : 'Åska';
const WXC = {};
function weatherFor(date, loc) {
  const key = date + '|' + (loc?.lat || '') + ',' + (loc?.lon || '');
  if (WXC[key]) return WXC[key];
  WXC[key] = { loading: true };
  const days = Math.round((parseYmd(date) - parseYmd(todayStr())) / 864e5);
  if (!loc?.lat || days < 0 || days > 15) { WXC[key] = { none: days > 15 ? 'Prognos finns 16 dagar före' : days < 0 ? '' : 'Ingen plats för väder' }; return WXC[key]; }
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,wind_speed_10m_max&timezone=Europe%2FStockholm&start_date=${date}&end_date=${date}`)
    .then(r => r.json()).then(j => {
      const dd = j.daily || {};
      WXC[key] = { text: `${WX(dd.weather_code?.[0])}, ${Math.round(dd.temperature_2m_min?.[0])}°/${Math.round(dd.temperature_2m_max?.[0])}°${dd.precipitation_probability_max?.[0] != null ? `, ${dd.precipitation_probability_max[0]} % nederbörd` : ''}${dd.wind_speed_10m_max?.[0] != null ? `, vind ${Math.round(dd.wind_speed_10m_max[0] / 3.6)} m/s` : ''}` };
      emit('render');
    }).catch(() => { WXC[key] = { none: 'Vädret kunde inte hämtas' }; emit('render'); });
  return WXC[key];
}
const GEO = {};
/** Ort för vädret: sista delen av första adressen (efter komma), geokodad via open-meteo. Annars KC:s hemort. */
function placeLoc(addr) {
  const home = S.data?.weather ? { lat: S.data.weather.lat, lon: S.data.weather.lon, name: S.data.weather.name } : null;
  const city = String(addr || '').split(',').map(s => s.trim()).filter(Boolean).pop()?.replace(/^\d{3}\s?\d{2}\s+/, '');
  if (!city || /\d/.test(city) && !/,/.test(addr)) return home;
  if (GEO[city] === undefined) {
    GEO[city] = null;
    fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=sv`).then(r => r.json())
      .then(j => { const g = j.results?.[0]; GEO[city] = g ? { lat: g.latitude, lon: g.longitude, name: g.name } : false; emit('render'); })
      .catch(() => { GEO[city] = false; });
  }
  return GEO[city] || home;
}

// ---------- vyn ----------
export function callsheetHtml(p, pr, args) {
  const days = pr.days || [];
  if (!days.length) return '<p class="empty">Inga inspelningsdagar i scenarket – callsheet byggs per inspelningsdag.</p>';
  const t = todayStr();
  const date = args[0] && days.some(d => d.date === args[0]) ? args[0] : (days.find(d => d.date >= t) || days[days.length - 1]).date;
  const ix = days.findIndex(d => d.date === date), prev = days[ix - 1], next = days[ix + 1];
  const cd = callsheetData(p, pr, date);
  const row = rowFor(p.tag, date) || {};
  const val = (field, key) => row[field] != null && row[field] !== '' ? String(row[field]) : (cd.defaults[key] || '');
  const status = row['Status'] || 'Utkast';
  const loc = placeLoc(cd.locations[0]?.address);
  const wx = weatherFor(date, loc);
  const sun = loc?.lat ? sunTimes(date, loc.lat, loc.lon) : null;
  const pdf = (pr.callsheets || []).find(c => c.date === date);
  const pages = cd.strips.reduce((a, s) => a + pg(s.pages), 0);
  const crewByDept = {}; cd.crew.forEach(c => (crewByDept[c.dept] ||= []).push(c));
  const field = (label, key) => `<label class="cs-f"><span>${label}</span><input data-csf="${esc(label)}" value="${esc(val(label, key))}" ${key && FIELDS.find(f => f[1] === key)?.[2] === 'tid' ? 'inputmode="numeric" placeholder="00:00"' : ''}></label>`;
  return `<div class="cs-bar">
      <div class="cs-nav">${prev ? `<a class="btn" href="${base(p)}/callsheet/${prev.date}">‹ Dag ${prev.day}</a>` : ''}
        <select data-csday>${days.map(d => `<option value="${d.date}" ${d.date === date ? 'selected' : ''}>Dag ${d.day} · ${esc(shortDate(d.date))}</option>`).join('')}</select>
        ${next ? `<a class="btn" href="${base(p)}/callsheet/${next.date}">Dag ${next.day} ›</a>` : ''}</div>
      <div class="cs-act">
        <label class="cs-status"><span>Status</span><select data-csf="Status"><option ${status !== 'Klar' ? 'selected' : ''}>Utkast</option><option ${status === 'Klar' ? 'selected' : ''}>Klar</option></select></label>
        ${pdf ? `<a class="btn" href="${esc(pdf.url)}" target="_blank" rel="noopener">Callsheet-PDF</a>` : ''}
        ${row['Dokument'] ? `<a class="btn" href="${esc(row['Dokument'])}" target="_blank" rel="noopener">Dokumentet ↗</a>` : ''}
        <button class="btn" data-csprint>Skriv ut</button>
        <button class="btn solid" data-csdoc>Skapa Google-dokument</button>
      </div>
    </div>
    <article class="cs-sheet ${status === 'Klar' ? 'klar' : 'utkast'}" data-cstag="${esc(p.tag)}" data-csdate="${esc(date)}" data-csrow="${esc(row._id || '')}">
      ${status !== 'Klar' ? '<div class="cs-draft">UTKAST</div>' : ''}
      <header class="cs-head">
        <div><div class="cs-k">${esc(p.name || p.tag)}</div><h2>Callsheet · Dag ${cd.d?.day ?? '–'} av ${days.length}</h2><div class="cs-date">${esc(fullDate(date))}</div></div>
        <div class="cs-times">${field('Crew call', 'crewCall')}${field('Lunch', 'lunch')}${field('Wrap', 'wrap')}</div>
      </header>
      <section class="cs-grid">
        <div class="cs-box"><div class="cs-k">Väder${loc?.name ? ' · ' + esc(loc.name) : ''}</div><p>${esc(wx.text || wx.none || 'Hämtar…')}</p>
          ${sun ? `<p class="cs-sun">Sol upp <b>${sun.rise}</b> · ned <b>${sun.set}</b></p>` : ''}</div>
        <div class="cs-box">${field('Bas', '')}${field('Parkering', '')}${field('Sjukhus', '')}</div>
        <div class="cs-box"><div class="cs-k">Dagen</div><p>${esc(cd.d?.hours || '')}${cd.d?.hours ? ' · ' : ''}${cd.strips.length} stripar · ${pgStr(pages)} sidor</p>${cd.d?.info ? `<p class="cs-info">${esc(cd.d.info)}</p>` : ''}</div>
      </section>
      <section><div class="cs-k">Platser</div>
        ${cd.locations.length ? `<table class="cs-t"><tbody>${cd.locations.map(l => `<tr><td><b>${esc(l.place)}</b></td><td>${l.address ? `<a href="https://maps.google.com/?q=${encodeURIComponent(l.address)}" target="_blank" rel="noopener">${esc(l.address)}</a>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Inga platser.</p>'}
      </section>
      <section><div class="cs-k">Scener</div>
        <table class="cs-t cs-scenes"><thead><tr><th>Scen</th><th>I/E</th><th>Plats</th><th>Tid</th><th class="r">Sidor</th><th>Roller</th><th>Beskrivning</th></tr></thead><tbody>
        ${cd.strips.map(s => `<tr><td class="tnum"><b>${esc(s.scene)}</b>${s.part ? ` <small>del ${esc(s.part)}</small>` : ''}<small>${esc(s.film || '')}</small></td><td>${esc(up(s.ie).replace('INT/EXT', 'I/E'))}</td><td>${esc(s.place || '')}</td><td>${esc(cap(s.tod || ''))}</td><td class="r tnum">${esc(s.pages || '')}</td><td>${esc((s.cast || []).join(', '))}</td><td class="cs-desc">${esc(s.desc || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Inga stripar.</td></tr>'}
        </tbody></table>
      </section>
      <section class="cs-two">
        <div><div class="cs-k">Skådespelare · ${cd.cast.length}</div>
          <table class="cs-t"><tbody>${cd.cast.map(c => `<tr><td class="tnum"><b>${esc(c.code)}</b></td><td>${esc(c.role)}</td><td>${c.actor ? esc(c.actor) : `<button class="btn cs-mini" data-team-add='${esc(JSON.stringify({ tag: p.tag, typ: 'Skådespelare', roll: c.role || c.code }))}'>Tillsätt</button>`}</td><td class="tnum">${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>` : ''}</td><td class="tnum muted">${esc(c.scenes.join(', '))}</td></tr>`).join('') || '<tr><td class="empty">Inga roller.</td></tr>'}</tbody></table></div>
        <div><div class="cs-k">Team · ${cd.crew.length}</div>
          ${cd.crew.length ? `<table class="cs-t"><tbody>${Object.entries(crewByDept).map(([dep, list]) => `<tr class="cs-dept"><td colspan="3">${esc(dep)}</td></tr>` + list.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.role)}</td><td class="tnum">${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>` : ''}</td></tr>`).join('')).join('')}</tbody></table>`
            : `<p class="empty">Ingen i projektets team än. <button class="btn cs-mini" data-team-add='${esc(JSON.stringify({ tag: p.tag }))}'>+ Person</button></p>`}</div>
      </section>
      <section><div class="cs-k">Noter</div><textarea data-csf="Noter" rows="4" placeholder="Säkerhet, transport, specialutrustning, kontaktperson på plats…">${esc(row['Noter'] || '')}</textarea></section>
      <footer class="cs-foot">Genererat ur KC ${esc(shortDate(todayStr()))}${status !== 'Klar' ? ' · UTKAST' : ''}</footer>
    </article>`;
}
function pg(s) { const m = String(s || '').trim().match(/^(?:(\d+)\s+)?(?:(\d+)\/8)?$|^(\d+)$/); if (!m) return 0; if (m[3]) return Number(m[3]); return Number(m[1] || 0) + Number(m[2] || 0) / 8; }
function pgStr(n) { const w = Math.floor(n + 1e-9), e = Math.round((n - w) * 8); return (w ? w + (e ? ' ' : '') : '') + (e ? e + '/8' : (w ? '' : '0')); }

// ---------- sparande ----------
const pending = {};
async function saveField(sheet, field, value) {
  const tag = sheet.dataset.cstag, date = sheet.dataset.csdate;
  const c = coll();
  if (!c) return toast('Samlingen Callsheets finns inte än – kör setup / ny version av Apps Script');
  let row = rowFor(tag, date);
  const d = (S.prod[tag]?.days || []).find(x => x.date === date);
  const values = { [field]: value };
  if (!row) {
    row = { _id: 'tmp' + Date.now(), Projekt: tag, Datum: date, Dag: d ? String(d.day) : '', Status: 'Utkast', _src: c._src };
    Object.assign(values, { Projekt: tag, Datum: date, Dag: row.Dag, Status: row.Status });
    c.rows.push(row);
  }
  const before = row[field];
  if (row._id && !String(row._id).startsWith('tmp') && String(before ?? '') === String(value)) return;
  row[field] = value;
  const key = tag + date;
  // Vänta in en ny rad innan nästa fält sparas så att det inte blir två rader.
  await (pending[key] || Promise.resolve());
  const p = (async () => {
    try {
      const r = await api('saveRow', { collection: 'Callsheets', id: String(row._id).startsWith('tmp') ? '' : row._id, values }, true, c._src || 'jobb');
      if (String(row._id).startsWith('tmp')) row._id = r.id;
    } catch (e) { row[field] = before; toast('Kunde inte spara – ' + e.message); emit('render'); }
  })();
  pending[key] = p;
  return p;
}

function collect(sheet, p) {
  const tag = sheet.dataset.cstag, date = sheet.dataset.csdate;
  const pr = S.prod[tag];
  const cd = callsheetData(p, pr, date);
  const v = n => sheet.querySelector(`[data-csf="${n}"]`)?.value || '';
  const loc = placeLoc(cd.locations[0]?.address), wx = weatherFor(date, loc), sun = loc?.lat ? sunTimes(date, loc.lat, loc.lon) : null;
  return {
    title: `${p.name || tag} – Callsheet`, day: cd.d?.day || '', dateLabel: fullDate(date), status: document.querySelector('[data-csf="Status"]')?.value || 'Utkast',
    crewCall: v('Crew call'), lunch: v('Lunch'), wrap: v('Wrap'), base: v('Bas'), parking: v('Parkering'), hospital: v('Sjukhus'), notes: v('Noter'),
    weather: wx.text || '', sun: sun ? `upp ${sun.rise}, ned ${sun.set}` : '',
    scenes: cd.strips.map(s => ({ scene: s.scene + (s.part ? ' del ' + s.part : ''), film: s.film, ie: s.ie, place: s.place, tod: cap(s.tod || ''), pages: s.pages, cast: (s.cast || []).join(', '), desc: s.desc, est: s.est })),
    cast: cd.cast.map(c => ({ code: c.code, role: c.role, actor: c.actor, phone: c.phone })),
    crew: cd.crew.map(c => ({ dept: c.dept, name: c.name, role: c.role, phone: c.phone })),
    locations: cd.locations,
  };
}

let bound = false;
export function bindCallsheet(getProject) {
  if (bound) return; bound = true;
  document.addEventListener('change', e => {
    const sel = e.target.closest('.prod [data-csday]');
    if (sel) { const sheet = document.querySelector('.cs-sheet'); location.hash = '#/projekt/' + encodeURIComponent(sheet.dataset.cstag) + '/produktion/callsheet/' + sel.value; return; }
    const f = e.target.closest('.prod [data-csf]'); if (!f) return;
    const sheet = document.querySelector('.cs-sheet'); if (!sheet) return;
    saveField(sheet, f.dataset.csf, f.value).then(() => { if (f.dataset.csf === 'Status') emit('render'); });
  });
  document.addEventListener('click', async e => {
    if (e.target.closest('.prod [data-csprint]')) { window.print(); return; }
    const b = e.target.closest('.prod [data-csdoc]'); if (!b) return;
    const sheet = document.querySelector('.cs-sheet'); if (!sheet) return;
    const p = getProject(sheet.dataset.cstag); if (!p) return;
    b.disabled = true; b.textContent = 'Skapar…';
    try {
      const data = collect(sheet, p);
      const r = await api('callsheetDoc', { tag: p.tag, date: sheet.dataset.csdate, data }, true, p.cfg?._src || 'jobb');
      await saveField(sheet, 'Dokument', r.url);
      toast('Dokumentet ligger i callsheetmappen');
      window.open(r.url, '_blank', 'noopener');
    } catch (err) { toast('Kunde inte skapa – ' + err.message); }
    b.disabled = false; b.textContent = 'Skapa Google-dokument';
    emit('render');
  });
}
