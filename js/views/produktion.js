/* KC – produktion (Yamdu-läget): dagar/stripboard, scener, roller, platser, callsheets, dokument.
   All data kommer från scenarket och projektmappen via Apps Script (action 'production'). */
import {
  S, $, esc, ymd, parseYmd, addDays, todayStr, shortDate, dayLabel, week, relTime, DAYS, MONTHS,
  loadProduction, emit,
} from '../core.js';

const SUBS = [['oversikt', 'Översikt'], ['dagar', 'Dagar'], ['scener', 'Scener'], ['roller', 'Roller'], ['platser', 'Platser'], ['callsheets', 'Callsheets'], ['dokument', 'Dokument']];
const base = p => '#/projekt/' + encodeURIComponent(p.tag) + '/produktion';
const mapUrl = (place, addr) => 'https://maps.google.com/?q=' + encodeURIComponent(addr || place);
const STATE = { film: '', status: '', place: '', q: '', sort: 'scene', dir: 1, scene: null };

// ---------- hjälp ----------
const up = s => String(s || '').toUpperCase();
const statusOf = sc => up(sc.status || sc.dpr || '');
function statusTag(st) {
  const s = up(st);
  if (!s) return '';
  const cls = /RESTAD/.test(s) ? 'st-fire' : /DELVIS/.test(s) ? 'st-part' : /FILMAD/.test(s) ? 'st-done' : /EJ SCHEMA/.test(s) ? 'st-none' : 'st-plan';
  const label = s.charAt(0) + s.slice(1).toLowerCase();
  return `<span class="st ${cls}">${esc(label)}</span>`;
}
const dn = tod => { const t = up(tod); return /NATT/.test(t) ? 'N' : /KVÄLL|SKYMNING/.test(t) ? 'K' : /MORGON|GRYNING/.test(t) ? 'M' : t ? 'D' : ''; };
/** "1 2/8" → 1.25 */
function pagesNum(s) {
  const m = String(s || '').trim().match(/^(?:(\d+)\s+)?(?:(\d+)\/8)?$|^(\d+)$/);
  if (!m) return 0;
  if (m[3]) return Number(m[3]);
  return Number(m[1] || 0) + Number(m[2] || 0) / 8;
}
function pagesStr(n) {
  const w = Math.floor(n + 1e-9), e = Math.round((n - w) * 8);
  return (w ? w + (e ? ' ' : '') : '') + (e ? e + '/8' : (w ? '' : '0'));
}
const minutes = s => { const m = /^(\d+):(\d{2})$/.exec(String(s || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const hm = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
const roleMap = pr => Object.fromEntries((pr.roles || []).map(r => [up(r.code), r]));
const csByDate = pr => { const m = {}; (pr.callsheets || []).forEach(c => { if (c.date && !m[c.date]) m[c.date] = c; }); return m; };
const fullDate = s => { const d = parseYmd(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

// ---------- ingång ----------
export function renderProduction(el, p, sub, args = []) {
  sub = SUBS.some(s => s[0] === sub) ? sub : 'oversikt';
  const pr = S.prod[p.tag];
  if (!pr) loadProduction(p.tag);
  const tabs = `<nav class="prod-tabs">${SUBS.map(([k, l]) => `<a href="${base(p)}/${k}" class="${k === sub ? 'on' : ''}">${l}</a>`).join('')}
    <button class="btn prod-refresh" data-prod-refresh="${esc(p.tag)}">Uppdatera</button></nav>`;
  let body;
  if (!pr) body = `<div class="prod-loading"><span class="spin"></span>Läser scenarket och projektmappen…</div>`;
  else if (pr.error) body = `<div class="prod-err"><b>Kunde inte läsa produktionen.</b><br>${esc(pr.error)}${p.cfg?.sceneSheetUrl ? `<br><a href="${esc(p.cfg.sceneSheetUrl)}" target="_blank" rel="noopener">Öppna scenarket</a>` : ''}</div>`;
  else {
    const f = { oversikt, dagar, scener, roller, platser, callsheets, dokument }[sub];
    body = f(p, pr, args);
  }
  el.innerHTML = `<div class="prod">${tabs}<div class="prod-body">${body}</div></div>`;
  bindOnce();
}

// ---------- översikt ----------
function oversikt(p, pr) {
  const t = todayStr();
  const days = pr.days || [];
  const done = days.filter(d => d.date < t).length, cur = days.find(d => d.date === t), next = days.find(d => d.date > t);
  const total = days.length;
  const scenes = (pr.scenes || []).filter(s => !s.omitted);
  const filmed = scenes.filter(s => /FILMAD/.test(statusOf(s)) && !/DELVIS/.test(statusOf(s))).length;
  const confirmed = scenes.filter(s => /FILMAD/.test(up(s.dpr))).length;
  const restad = scenes.filter(s => /RESTAD/.test(statusOf(s)));
  const noDate = restad.filter(s => !s.newDate);
  const pct = total ? Math.round((done + (cur ? 1 : 0)) / total * 100) : 0;
  const nd = cur || next;
  const cs = csByDate(pr);
  const ndStrips = nd ? (pr.strips || []).filter(s => s.date === nd.date) : [];
  const ndPlaces = [...new Map(ndStrips.filter(s => s.place).map(s => [s.place, s])).values()];

  const stat = (n, l, cls = '') => `<div class="prod-stat ${cls}"><b class="tnum">${n}</b><span>${l}</span></div>`;
  let html = `<div class="prod-grid">
    <div class="card prod-state">
      <div class="prod-k">Inspelningsläge</div>
      ${total ? `<div class="prod-big"><b class="tnum">${done + (cur ? 1 : 0)}</b><span>/ ${total} dagar</span></div>
      <div class="prod-bar"><i style="width:${pct}%"></i></div>
      <div class="prod-stats">${stat(`${filmed}/${scenes.length}`, 'scener filmade')}${stat(confirmed, 'bekräftade i DPR')}${stat(restad.length, 'restade', restad.length ? 'fire' : '')}</div>
      <div class="prod-kv"><span>Första dag</span><b>${esc(shortDate(days[0].date))}</b></div>
      <div class="prod-kv"><span>Sista dag</span><b>${esc(shortDate(days[total - 1].date))}</b></div>` : '<p class="empty">Inga inspelningsdagar i scenarket.</p>'}
    </div>
    <div class="card prod-next">
      <div class="prod-k">${cur ? 'Idag' : 'Nästa inspelningsdag'}</div>
      ${nd ? `<a class="prod-nd" href="${base(p)}/dagar/${nd.date}">
          <div class="prod-nd-h"><b>Dag ${nd.day}</b><span>${esc(fullDate(nd.date))}</span></div>
          <div class="prod-nd-t">${esc(nd.note || ndPlaces.map(s => s.place).join(' · ') || 'Inspelning')}</div>
          <div class="sub">${esc(nd.hours || '')}${nd.pages ? '<i class="sep">·</i>' + esc(nd.pages) + ' sidor' : ''}${nd.strips ? '<i class="sep">·</i>' + nd.strips + ' stripar' : ''}</div>
        </a>
        ${ndPlaces.length ? `<div class="prod-places">${ndPlaces.slice(0, 4).map(s => `<a href="${mapUrl(s.place, s.address)}" target="_blank" rel="noopener">${esc(s.place)}${s.address ? `<small>${esc(s.address)}</small>` : ''}</a>`).join('')}</div>` : ''}
        ${cs[nd.date] ? `<a class="btn" href="${esc(cs[nd.date].url)}" target="_blank" rel="noopener">Callsheet</a>` : ''}`
        : '<p class="empty">Inga fler inspelningsdagar.</p>'}
    </div>
  </div>`;

  if (restad.length) {
    html += `<section class="sec fire prod-sec"><h2><span class="h">Det som brinner</span><span class="n">${restad.length}</span></h2><div class="body">
      ${noDate.length ? `<p class="prod-firenote">${noDate.length === 1 ? '1 restad scen saknar' : noDate.length + ' restade scener saknar'} nytt datum.</p>` : ''}
      ${restad.slice().sort((a, b) => (a.newDate ? 1 : 0) - (b.newDate ? 1 : 0)).map(s => sceneLine(p, s)).join('')}
    </div></section>`;
  }

  // veckans dagar
  const mon = (() => { const d = parseYmd(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  const wk = days.filter(d => d.date >= ymd(mon) && d.date <= ymd(addDays(mon, 6)));
  const upcoming = wk.length ? wk : days.filter(d => d.date >= t).slice(0, 5);
  if (upcoming.length) {
    html += `<section class="sec prod-sec"><h2><span class="h">${wk.length ? 'Veckans dagar · v. ' + week(mon) : 'Kommande dagar'}</span></h2><div class="body">
      ${upcoming.map(d => dayLine(p, pr, d)).join('')}
    </div></section>`;
  }
  return html;
}

function sceneLine(p, s) {
  return `<a class="prod-line ${s.omitted ? 'om' : ''}" href="${base(p)}/scener/${encodeURIComponent(s.film + '-' + s.scene)}">
    <span class="prod-sc tnum">${esc(s.film)} · ${esc(s.scene)}</span>
    <span class="prod-lt">${esc(s.heading || s.place || '')}</span>
    <span class="prod-lm">${s.reason ? esc(s.reason) + ' · ' : ''}${s.newDate ? 'nytt datum ' + esc(shortDate(s.newDate)) : '<b class="firetext">inget nytt datum</b>'}</span>
  </a>`;
}

function dayLine(p, pr, d) {
  const t = todayStr();
  const cls = d.date === t ? 'today' : d.date < t ? 'past' : '';
  const strips = (pr.strips || []).filter(s => s.date === d.date);
  const places = [...new Set(strips.map(s => s.place).filter(Boolean))];
  return `<a class="prod-day ${cls}" href="${base(p)}/dagar/${d.date}">
    <span class="prod-dn tnum"><b>${d.day}</b></span>
    <span class="prod-dd"><b>${esc(DAYS[parseYmd(d.date).getDay()].slice(0, 3))} ${esc(shortDate(d.date))}</b><small>${esc(d.hours || '')}</small></span>
    <span class="prod-dt">${esc(d.note || places.slice(0, 3).join(' · ') || 'Inspelning')}${d.info ? `<small>${esc(d.info)}</small>` : ''}</span>
    <span class="prod-dm tnum">${esc(d.pages || '')}${d.pages ? ' s' : ''}<small>${d.strips || strips.length} stripar</small></span>
  </a>`;
}

// ---------- dagar ----------
function dagar(p, pr, args) {
  if (args[0]) return dagDetalj(p, pr, args[0]);
  const days = pr.days || [];
  if (!days.length) return '<p class="empty">Inga inspelningsdagar i scenarket.</p>';
  const groups = [];
  days.forEach(d => {
    const w = week(parseYmd(d.date)), y = parseYmd(d.date).getFullYear();
    const key = y + '-' + w;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, w, period: d.period, days: [] }; groups.push(g); }
    g.days.push(d);
  });
  const t = todayStr();
  return groups.map(g => {
    const allPast = g.days.every(d => d.date < t);
    const pg = g.days.reduce((a, d) => a + pagesNum(d.pages), 0);
    return `<section class="sec prod-sec ${allPast ? 'closed' : ''}" data-sec="prodw-${esc(p.tag)}-${g.key}">
      <h2><span class="h">Vecka ${g.w}</span><span class="n">${g.days.length} dagar · ${pagesStr(pg)} s</span>${g.period ? `<span class="act prod-per">${esc(String(g.period).replace(/\s*--.*$/, ''))}</span>` : ''}</h2>
      <div class="body">${g.days.map(d => dayLine(p, pr, d)).join('')}</div></section>`;
  }).join('');
}

function stripRow(s, roles) {
  const n = dn(s.tod), ie = up(s.ie);
  const cls = ['strip', /EXT/.test(ie) && !/INT/.test(ie) ? 'ext' : /INT/.test(ie) && /EXT/.test(ie) ? 'intext' : 'int', n === 'N' ? 'night' : ''].join(' ');
  return `<div class="${cls}">
    <span class="s-sc tnum"><b>${esc(s.scene)}</b>${s.part ? `<small>del ${esc(s.part)}</small>` : ''}<small>${esc(s.film || '')}</small></span>
    <span class="s-ie">${esc(ie.replace('INT/EXT', 'I/E'))}<small>${n ? `<i class="dn dn-${n}">${n}</i>` : ''}${s.storyDay ? 'bd ' + esc(s.storyDay) : ''}</small></span>
    <span class="s-pl"><b>${esc(s.place || '')}</b>${s.desc ? `<small>${esc(s.desc)}</small>` : ''}</span>
    <span class="s-cast">${(s.cast || []).map(c => `<i title="${esc(roles[up(c)]?.name || '')}${roles[up(c)]?.actor ? ' – ' + esc(roles[up(c)].actor) : ''}">${esc(c)}</i>`).join('')}</span>
    <span class="s-pg tnum">${esc(s.pages || '')}<small>${esc(s.est || '')}</small></span>
  </div>`;
}

function dagDetalj(p, pr, date) {
  const d = (pr.days || []).find(x => x.date === date);
  const strips = (pr.strips || []).filter(s => s.date === date);
  const roles = roleMap(pr);
  const cs = csByDate(pr)[date];
  const ix = (pr.days || []).indexOf(d);
  const prev = (pr.days || [])[ix - 1], next = (pr.days || [])[ix + 1];
  const pages = strips.reduce((a, s) => a + pagesNum(s.pages), 0);
  const est = strips.reduce((a, s) => a + minutes(s.est), 0);
  const places = [...new Map(strips.filter(s => s.place).map(s => [s.place + '|' + (s.address || ''), s])).values()];
  const cast = {};
  strips.forEach(s => (s.cast || []).forEach(c => { const k = up(c); (cast[k] ||= { code: c, scenes: [] }).scenes.push(s.scene); }));
  const castList = Object.values(cast).sort((a, b) => (roles[up(b.code)]?.days || 0) - (roles[up(a.code)]?.days || 0));
  const t = todayStr();
  return `<div class="prod-dayhead">
      <a class="prod-back" href="${base(p)}/dagar">‹ Alla dagar</a>
      <div class="prod-dh">
        <div><div class="prod-k">${d ? 'Dag ' + d.day + ' av ' + pr.days.length : 'Inspelning'}${date === t ? ' · idag' : date < t ? ' · passerad' : ''}</div>
          <h2>${esc(fullDate(date))}</h2>
          <div class="sub">${esc(d?.hours || '')}${'<i class="sep">·</i>'}${pagesStr(pages)} sidor${est ? '<i class="sep">·</i>' + hm(est) + ' est.' : ''}<i class="sep">·</i>${strips.length} stripar</div></div>
        <div class="prod-dnav">${prev ? `<a class="btn" href="${base(p)}/dagar/${prev.date}">‹ Dag ${prev.day}</a>` : ''}${next ? `<a class="btn" href="${base(p)}/dagar/${next.date}">Dag ${next.day} ›</a>` : ''}${cs ? `<a class="btn solid" href="${esc(cs.url)}" target="_blank" rel="noopener">Callsheet</a>` : ''}</div>
      </div>
      ${d?.info ? `<p class="prod-info">${esc(d.info)}</p>` : ''}
    </div>
    <div class="prod-daygrid">
      <section class="prod-strips"><div class="prod-k">Stripboard</div>
        <div class="stripboard">${strips.length ? strips.map(s => stripRow(s, roles)).join('') : '<p class="empty">Inga stripar den här dagen.</p>'}</div>
      </section>
      <aside class="prod-side">
        <div class="card"><div class="prod-k">Platser</div>
          ${places.length ? places.map(s => `<a class="prod-pl" href="${mapUrl(s.place, s.address)}" target="_blank" rel="noopener"><b>${esc(s.place)}</b>${s.address ? `<small>${esc(s.address)} ↗</small>` : '<small>Sök på kartan ↗</small>'}</a>`).join('') : '<p class="empty">Inga platser.</p>'}
        </div>
        <div class="card"><div class="prod-k">Roller idag · ${castList.length}</div>
          ${castList.length ? castList.map(c => { const r = roles[up(c.code)] || {}; return `<div class="prod-cast"><span class="code">${esc(c.code)}</span><span class="nm">${esc(cap(r.name || ''))}${r.actor ? `<small>${esc(r.actor)}</small>` : ''}</span><span class="sc tnum">${c.scenes.length}</span></div>`; }).join('') : '<p class="empty">Inga roller.</p>'}
        </div>
      </aside>
    </div>`;
}
const cap = s => String(s).toLowerCase().replace(/(^|[\s-])\p{L}/gu, m => m.toUpperCase());

// ---------- scener ----------
function scener(p, pr, args) {
  const all = pr.scenes || [];
  const films = [...new Set(all.map(s => s.film).filter(Boolean))].sort();
  const statuses = [...new Set(all.map(statusOf).filter(Boolean))].sort();
  const places = [...new Set(all.map(s => s.place).filter(Boolean))].sort();
  const sel = args[0] ? all.find(s => s.film + '-' + s.scene === decodeURIComponent(args[0])) : null;
  const opt = (v, list, label) => `<option value="">${label}</option>` + list.map(x => `<option ${x === v ? 'selected' : ''} value="${esc(x)}">${esc(cap(x))}</option>`).join('');
  return `<div class="prod-filters">
      <input type="search" placeholder="Sök scen, rubrik, roll…" value="${esc(STATE.q)}" data-pf="q">
      <select data-pf="film">${opt(STATE.film, films, 'Alla filmer')}</select>
      <select data-pf="status">${opt(STATE.status, statuses, 'All status')}</select>
      <select data-pf="place">${opt(STATE.place, places, 'Alla platser')}</select>
    </div>
    <div class="prod-scenes ${sel ? 'has-sel' : ''}">
      <div class="prod-tablewrap" id="prodSceneTable" data-tag="${esc(p.tag)}">${sceneTable(p, pr)}</div>
      ${sel ? sceneDetail(p, pr, sel) : ''}
    </div>`;
}

function filteredScenes(pr) {
  const q = STATE.q.trim().toLowerCase();
  let list = (pr.scenes || []).filter(s =>
    (!STATE.film || s.film === STATE.film) &&
    (!STATE.status || statusOf(s) === STATE.status) &&
    (!STATE.place || s.place === STATE.place) &&
    (!q || [s.scene, s.heading, s.place, s.cast, s.film].join(' ').toLowerCase().includes(q)));
  const k = STATE.sort, dir = STATE.dir;
  const val = s => k === 'scene' ? (s.film + String(s.scene).padStart(6, '0')) : k === 'pages' ? pagesNum(s.pages) : k === 'first' ? (s.first || '9') : k === 'status' ? statusOf(s) : String(s[k] || '');
  list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  return list;
}

function sceneTable(p, pr) {
  const list = filteredScenes(pr);
  const th = (k, l, cls = '') => `<th class="${cls}" data-psort="${k}">${l}${STATE.sort === k ? (STATE.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  const pg = list.filter(s => !s.omitted).reduce((a, s) => a + pagesNum(s.pages), 0);
  return `<div class="prod-count">${list.length} scener · ${pagesStr(pg)} sidor</div>
    <table class="prod-table"><thead><tr>
      ${th('scene', 'Scen')}${th('ie', 'I/E', 'c-ie')}${th('heading', 'Plats')}${th('tod', 'Tid', 'c-tod')}${th('pages', 'Sidor', 'r')}${th('cast', 'Roller', 'c-cast')}${th('first', 'Inspelad', 'c-date')}${th('status', 'Status')}
    </tr></thead><tbody>
    ${list.map(s => `<tr class="${s.omitted ? 'om' : ''}" data-pscene="${esc(s.film + '-' + s.scene)}">
      <td class="tnum"><b>${esc(s.scene)}</b><small>${esc(s.film)}</small></td>
      <td class="c-ie">${esc(up(s.ie).replace('INT/EXT', 'I/E'))}</td>
      <td class="c-pl">${esc(s.place || s.heading || '')}${s.omitted ? ' <small>omitted</small>' : ''}</td>
      <td class="c-tod">${esc(cap(s.tod || ''))}</td>
      <td class="r tnum">${esc(s.pages || '')}</td>
      <td class="c-cast">${esc(s.cast || '')}</td>
      <td class="c-date tnum">${s.first ? esc(shortDate(s.first)) + (s.last && s.last !== s.first ? '–' + esc(shortDate(s.last)) : '') : ''}</td>
      <td>${s.omitted ? '' : statusTag(statusOf(s))}</td>
    </tr>`).join('')}
    </tbody></table>`;
}

function sceneDetail(p, pr, s) {
  const parts = (pr.strips || []).filter(x => String(x.scene) === String(s.scene) && (!x.film || x.film === s.film));
  const kv = (l, v) => v ? `<div class="prod-kv"><span>${l}</span><b>${v}</b></div>` : '';
  return `<aside class="card prod-detail">
    <div class="prod-dt-h"><div><div class="prod-k">${esc(s.film)} · scen ${esc(s.scene)}</div><h3>${esc(s.heading || s.place || '')}</h3></div>
      <a class="btn" href="${base(p)}/scener">Stäng</a></div>
    ${s.omitted ? '<p class="empty">Omitted.</p>' : statusTag(statusOf(s))}
    ${kv('Manusversion', esc(s.version))}${kv('Sida', esc(s.page))}${kv('Sidor', esc(s.pages))}${kv('Tid på dygnet', esc(cap(s.tod || '')))}${kv('Berättardag', esc(s.storyDay))}
    ${kv('Roller', esc(s.cast))}${kv('Statister', esc(s.extras))}${kv('Speltid', esc(s.runtime))}${kv('Kameraenhet', esc(s.unit))}${kv('Särskild utrustning', esc(s.equipment))}
    ${kv('Bekräftad (DPR)', esc(cap(s.dpr || '')))}${s.reason ? `<div class="prod-kv firetext"><span>Restorsak</span><b>${esc(s.reason)}</b></div>` : ''}${kv('Nytt datum', s.newDate ? esc(shortDate(s.newDate)) : '')}
    ${parts.length ? `<div class="prod-k" style="margin-top:14px">Inspelningsdelar · ${parts.length}</div>${parts.map(x => `<a class="prod-pl" href="${base(p)}/dagar/${x.date}"><b>Dag ${x.day} · ${esc(shortDate(x.date))}${x.part ? ' · del ' + esc(x.part) : ''}</b><small>${esc(x.place || '')}${x.est ? ' · ' + esc(x.est) : ''}</small></a>`).join('')}` : ''}
  </aside>`;
}

// ---------- roller ----------
function roller(p, pr) {
  const days = pr.days || [];
  const roles = pr.roles || [];
  if (!roles.length) return '<p class="empty">Inga roller i scenarket.</p>';
  const work = {};
  (pr.strips || []).forEach(s => (s.cast || []).forEach(c => (work[up(c)] ||= new Set()).add(s.date)));
  const t = todayStr();
  return `<div class="prod-tablewrap"><table class="prod-table prod-roles"><thead><tr><th>Kod</th><th>Roll</th><th>Skådespelare</th><th class="r">Dagar</th><th class="c-date">Period</th><th class="c-dots">Inspelningsdagar</th></tr></thead><tbody>
    ${roles.map(r => { const w = work[up(r.code)] || new Set(); return `<tr>
      <td><span class="code">${esc(r.code)}</span></td>
      <td>${esc(cap(r.name || ''))}${r.note ? `<small>${esc(r.note)}</small>` : ''}</td>
      <td>${r.actor ? esc(r.actor) : '<span class="muted">–</span>'}</td>
      <td class="r tnum">${r.days || w.size}</td>
      <td class="c-date tnum">${r.first ? esc(shortDate(r.first)) + '–' + esc(shortDate(r.last)) : ''}</td>
      <td class="c-dots"><span class="dots">${days.map(d => `<i class="${w.has(d.date) ? 'on' : ''} ${d.date < t ? 'past' : ''} ${d.date === t ? 'today' : ''}" title="Dag ${d.day} · ${esc(shortDate(d.date))}"></i>`).join('')}</span></td>
    </tr>`; }).join('')}
  </tbody></table></div>`;
}

// ---------- platser ----------
function platser(p, pr) {
  const locs = pr.locations || [];
  const coll = (S.data?.collections || []).find(c => c.name === 'Platser');
  const rek = coll ? coll.rows.filter(r => String(r['Projekt'] || '').toUpperCase().split(/[\s,]+/).some(x => (x.startsWith('#') ? x : '#' + x) === p.tag)) : [];
  const t = todayStr();
  let html = locs.length ? `<div class="prod-locs">${locs.map(l => `<div class="prod-loc">
      <div class="prod-loc-h"><b>${esc(l.place)}</b><span class="tnum">${l.strips} stripar</span></div>
      ${l.address ? `<a class="prod-addr" href="${mapUrl(l.place, l.address)}" target="_blank" rel="noopener">${esc(l.address)} ↗</a>` : `<a class="prod-addr" href="${mapUrl(l.place)}" target="_blank" rel="noopener">Sök på kartan ↗</a>`}
      <div class="prod-chips">${l.dates.slice().sort().map(d => `<a class="dchip ${d < t ? 'past' : ''} ${d === t ? 'today' : ''}" href="${base(p)}/dagar/${d}">${esc(shortDate(d))}</a>`).join('')}</div>
    </div>`).join('')}</div>` : '<p class="empty">Inga platser i planen.</p>';
  if (rek.length) {
    html += `<section class="sec prod-sec"><h2><span class="h">Rek och bokning</span><span class="n">${rek.length}</span><a class="act" href="#/samling/Platser">Öppna samlingen</a></h2><div class="body">
      ${rek.map(r => `<div class="prod-rek"><b>${esc(r['Namn'] || '')}</b><span class="st st-plan">${esc(r['Status'] || '')}</span><small>${esc(r['Adress'] || '')}${r['Rekdatum'] ? ' · rek ' + esc(shortDate(r['Rekdatum'])) : ''}</small></div>`).join('')}
    </div></section>`;
  }
  return html;
}

// ---------- callsheets ----------
function callsheets(p, pr) {
  const list = (pr.callsheets || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.name).localeCompare(String(a.name)));
  if (!list.length) return '<p class="empty">Inga callsheets i callsheetmappen.</p>';
  const dayOf = Object.fromEntries((pr.days || []).map(d => [d.date, d]));
  return `<div class="prod-list">${list.map(c => `<a class="prod-file" href="${esc(c.url)}" target="_blank" rel="noopener">
      <span class="fi">PDF</span><span class="fn"><b>${esc(dayLabel(c.date))}${dayOf[c.date] ? ' · dag ' + dayOf[c.date].day : ''}</b><small>${esc(c.name)}</small></span><span class="fm">${esc(shortDate(c.date))}</span></a>`).join('')}</div>`;
}

// ---------- dokument ----------
function mimeIcon(m) {
  m = String(m || '');
  if (/pdf/.test(m)) return 'PDF';
  if (/spreadsheet|excel|sheet/.test(m)) return 'ARK';
  if (/document|word|text/.test(m)) return 'DOK';
  if (/presentation|powerpoint/.test(m)) return 'PRES';
  if (/image/.test(m)) return 'BILD';
  if (/video/.test(m)) return 'FILM';
  if (/audio/.test(m)) return 'LJUD';
  if (/folder/.test(m)) return 'MAPP';
  return 'FIL';
}
function dokument(p, pr) {
  const docs = pr.docs || [];
  return `${p.cfg?.driveUrl ? `<div class="prod-docbar"><a class="btn" href="${esc(p.cfg.driveUrl)}" target="_blank" rel="noopener">Öppna projektmappen ↗</a><span class="muted">Senast ändrat i mappen och två nivåer ner</span></div>` : ''}
    ${docs.length ? `<div class="prod-list">${docs.map(d => `<a class="prod-file" href="${esc(d.url)}" target="_blank" rel="noopener">
      <span class="fi">${mimeIcon(d.mime)}</span><span class="fn"><b>${esc(d.name)}</b><small>${esc(d.path || 'Projektmappen')}</small></span><span class="fm">${esc(relTime(d.updated))}</span></a>`).join('')}</div>` : '<p class="empty">Inga dokument hittade.</p>'}`;
}

// ---------- sammanfattning för projektets översikt ----------
export function productionSummary(p) {
  const pr = S.prod[p.tag];
  const t = todayStr();
  if (pr && !pr.error && (pr.days || []).length) {
    const days = pr.days, done = days.filter(d => d.date < t).length, cur = days.find(d => d.date === t), next = days.find(d => d.date > t);
    const sc = (pr.scenes || []).filter(s => !s.omitted);
    const filmed = sc.filter(s => /FILMAD/.test(statusOf(s)) && !/DELVIS/.test(statusOf(s))).length;
    const restad = sc.filter(s => /RESTAD/.test(statusOf(s)) && !s.newDate).length;
    const nd = cur || next;
    return summaryHtml(p, done + (cur ? 1 : 0), days.length, filmed, sc.length, restad, nd ? { label: cur ? 'Idag' : 'Nästa', day: nd.day, date: nd.date, note: nd.note } : null);
  }
  const s = p.cfg?.shoot;
  if (!s) return '<p class="empty">Ingen inspelning kopplad.</p>';
  const nd = s.today || s.next;
  return summaryHtml(p, s.doneDays, s.totalDays, s.filmed, s.scenes, s.restadUtanDatum, nd ? { label: s.today ? 'Idag' : 'Nästa', day: nd.day, date: nd.date, note: nd.note } : null);
}
function summaryHtml(p, done, total, filmed, scenes, restadNoDate, nd) {
  const pct = total ? Math.round(done / total * 100) : 0;
  return `<div class="prod prod-sum">
    <div class="prod-big"><b class="tnum">${done}</b><span>/ ${total} dagar</span></div>
    <div class="prod-bar"><i style="width:${pct}%"></i></div>
    <div class="prod-kv"><span>Scener filmade</span><b class="tnum">${filmed} / ${scenes}</b></div>
    ${restadNoDate ? `<div class="prod-kv firetext"><span>Restade utan datum</span><b>${restadNoDate}</b></div>` : ''}
    ${nd ? `<a class="prod-kv" href="${base(p)}/dagar/${nd.date}"><span>${nd.label} · dag ${nd.day}</span><b>${esc(shortDate(nd.date))}</b></a>${nd.note ? `<div class="prod-sumnote">${esc(nd.note)}</div>` : ''}` : ''}
    <a class="more-link" href="${base(p)}/oversikt">Öppna produktionen</a>
  </div>`;
}

// ---------- händelser ----------
let bound = false;
function bindOnce() {
  if (bound) return; bound = true;
  document.addEventListener('click', e => {
    const r = e.target.closest('[data-prod-refresh]');
    if (r) { loadProduction(r.dataset.prodRefresh, true); return; }
    const th = e.target.closest('.prod [data-psort]');
    if (th) {
      const k = th.dataset.psort;
      if (STATE.sort === k) STATE.dir = -STATE.dir; else { STATE.sort = k; STATE.dir = 1; }
      return redrawTable();
    }
    const tr = e.target.closest('.prod [data-pscene]');
    if (tr) {
      const tag = tr.closest('[data-tag]')?.dataset.tag;
      if (tag) location.hash = '#/projekt/' + encodeURIComponent(tag) + '/produktion/scener/' + encodeURIComponent(tr.dataset.pscene);
    }
  });
  document.addEventListener('input', e => {
    const f = e.target.closest('.prod [data-pf]'); if (!f) return;
    STATE[f.dataset.pf] = f.value;
    redrawTable();
  });
}
function redrawTable() {
  const box = $('#prodSceneTable'); if (!box) return;
  const pr = S.prod[box.dataset.tag]; if (!pr) return;
  box.innerHTML = sceneTable({ tag: box.dataset.tag }, pr);
}
