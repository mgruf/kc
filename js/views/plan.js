/* KC – Produktionsplanen. #/plan = alla projekt (portfölj och krockar), #/plan/<tagg> = projektets Gantt.
   Själva planeringsytan är plan.html (port av den tidigare planeringssidan) i en iframe på samma ursprung:
   den läser KC:s källor ur localStorage och pratar med Apps Script via planRead/planWrite.
   planTimelineHtml() är en liten tidslinje för projektsidan/översikten, ritad ur projektets faser i action=data. */
import { S, esc, go, toast, refresh, cfgProjects, cfgProject, tagColor, ymd, parseYmd, addDays, monday, week, shortDate, todayStr, MONTHS } from '../core.js';
import { head } from '../ui.js';

const planProjects = () => cfgProjects().filter(p => p.planSheetUrl || (p.phases || []).length);
const nameOf = tag => (cfgProject(tag) || {}).name || tag.replace(/^#/, '');

// ---------- vyn ----------
export function render(el, args) {
  const tag = args[0] || '';
  const key = tag ? 'plan/' + tag : 'plan';
  const frame = el.querySelector('iframe.v-plan-frame');
  if (frame && frame.dataset.key === key) { el.querySelector('.v-plan-tabs')?.replaceWith(tabsEl(tag)); return; }
  const c = tag ? cfgProject(tag) : null;
  const src = (c && c._src) || 'jobb';
  const title = tag ? `Produktionsplan · ${esc(nameOf(tag))}` : 'Produktionsplan';
  const act = c?.planSheetUrl ? `<a class="v-plan-link" href="${esc(c.planSheetUrl)}" target="_blank" rel="noopener">Öppna arket</a>` : '';
  el.innerHTML = `<div class="v-plan-host">${head(title, '', act)}<div class="v-plan-tabs"></div>
    <iframe class="v-plan-frame" data-key="${esc(key)}" title="${esc(title)}" src="plan.html?src=${encodeURIComponent(src)}#${encodeURIComponent(tag || 'pf')}"></iframe></div>`;
  el.querySelector('.v-plan-tabs').replaceWith(tabsEl(tag));
}

function tabsEl(tag) {
  const d = document.createElement('nav'); d.className = 'v-plan-tabs';
  const ps = planProjects();
  d.innerHTML = [`<a href="#/plan" class="${tag ? '' : 'on'}">Alla projekt</a>`]
    .concat(ps.map(p => `<a href="#/plan/${encodeURIComponent(p.tag)}" class="${p.tag === tag ? 'on' : ''}"><i style="--tc:${tagColor(p.tag)}"></i>${esc(p.name)}</a>`)).join('');
  return d;
}

export function context(args) {
  const tag = args?.[0];
  const ps = tag ? [cfgProject(tag)].filter(Boolean) : planProjects();
  const t = todayStr();
  const lines = ps.map(p => {
    const ms = (p.phases || []).filter(x => x.milestone && x.start >= t).slice(0, 6).map(x => `${x.start} ${x.film ? 'F' + x.film + ' ' : ''}${x.name}`);
    const w = (p.warnings || []).slice(0, 4).map(x => `varning: ${x.name} – ${x.text}`);
    return `${p.name}: ${ms.join('; ') || 'inga kommande milstolpar'}${w.length ? ' · ' + w.join('; ') : ''}`;
  });
  return `Produktionsplanering${tag ? ' för ' + nameOf(tag) : ''}.\n${lines.join('\n')}`;
}

export function key(e, args) {
  const k = e.key.toLowerCase();
  if (k === 'a') { e.preventDefault(); return go('plan'); }
  if (k === 'g') { e.preventDefault(); const f = document.querySelector('iframe.v-plan-frame'); f?.focus(); }
}

// Planen i iframen meddelar när den sparat → KC hämtar om (deadlines/varningar ur Status och faserna)
let refT = null;
window.addEventListener('message', ev => {
  if (ev.origin !== location.origin || !ev.data || !ev.data.kcPlan) return;
  if (ev.data.kcPlan === 'saved') { clearTimeout(refT); refT = setTimeout(() => refresh(), 4000); }
  if (ev.data.kcPlan === 'unsaved') toast('Kunde inte spara planen');
});

// ---------- liten tidslinje för projektsidan / översikten ----------
/** p = projekt ur cfgProjects() (eller projects()-post med .cfg). opts.weeks = antal veckor framåt (standard 12).
 *  Returnerar HTML: en rad per avdelning med faserna som staplar, milstolpar som romber, idag-linje.
 *  Hela rutan länkar till #/plan/<tagg>. Inget data-tag används (det är för projektnavigering). */
export function planTimelineHtml(p, opts = {}) {
  const c = p?.cfg || p; if (!c) return '';
  const weeks = Math.max(2, Math.min(104, opts.weeks || 12));
  const from = monday(addDays(new Date(), -7)), to = addDays(from, weeks * 7);
  const fs = ymd(from), ts = ymd(to), span = (to - from) / 864e5;
  const X = s => Math.max(0, Math.min(100, ((parseYmd(s) - from) / 864e5) / span * 100));
  const ph = (c.phases || []).filter(x => x.end >= fs && x.start <= ts);
  if (!ph.length) return `<div class="v-plan-tl empty"><p>Inga faser i planen de närmaste ${weeks} veckorna.</p>${c.tag ? `<a href="#/plan/${encodeURIComponent(c.tag)}">Öppna planen</a>` : ''}</div>`;
  const groups = [];
  ph.forEach(x => { let g = groups.find(y => y.name === (x.group || 'Övrigt')); if (!g) groups.push(g = { name: x.group || 'Övrigt', bars: [], ms: [] }); (x.milestone ? g.ms : g.bars).push(x); });
  const grid = [];
  for (let d = new Date(from); d < to; d = addDays(d, 7)) {
    const l = X(ymd(d));
    const first = d.getDate() <= 7;
    grid.push(`<span class="v-plan-tl-w${first ? ' m' : ''}" style="left:${l}%">${first ? esc(MONTHS[d.getMonth()].slice(0, 3)) : 'v' + week(d)}</span>`);
  }
  const today = X(todayStr());
  const rows = groups.map(g => {
    const bars = g.bars.map(x => {
      const l = X(x.start), r = X(ymd(addDays(parseYmd(x.end), 1)));
      const nm = (x.film ? 'F' + x.film + ' ' : '') + x.name;
      return `<i class="b${x.background ? ' bg' : ''}" style="left:${l}%;width:${Math.max(r - l, .6)}%" title="${esc(nm)} · ${esc(shortDate(x.start))}–${esc(shortDate(x.end))}"><span>${esc(nm)}</span></i>`;
    }).join('');
    const ms = g.ms.filter(x => x.start >= fs && x.start <= ts).map(x => `<i class="d" style="left:${X(x.start)}%" title="${esc((x.film ? 'F' + x.film + ' ' : '') + x.name)} · ${esc(shortDate(x.start))}"></i>`).join('');
    return `<div class="v-plan-tl-r"><span class="n">${esc(g.name)}</span><span class="l">${bars}${ms}<b class="t" style="left:${today}%"></b></span></div>`;
  }).join('');
  const href = c.tag ? `#/plan/${encodeURIComponent(c.tag)}` : '#/plan';
  return `<a class="v-plan-tl" href="${href}" style="--tc:${tagColor(c.tag || '')}">
    <div class="v-plan-tl-h"><span class="n"></span><span class="l">${grid.join('')}<b class="t" style="left:${today}%"></b></span></div>${rows}</a>`;
}
