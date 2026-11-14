/* HORISONT – dag för dag framåt: händelser, uppgifter, inspelningsdagar, deadlines, milstolpar och datumtaggade anteckningar. */
import {
  S, esc, ymd, parseYmd, addDays, week, DAYS, MONTHS, events, tasks, notes, tagDate, cfgProjects, visible, projects, evOnDay, ensureRange, tagHtml, emit,
} from '../core.js';
import { taskRow, eventRow, noteRow, head, pref, setPref } from '../ui.js';

let weeks = 4;
export function render(el) {
  const f = pref('h_filter', '');
  const from = addDays(new Date(), 1), to = addDays(from, weeks * 7);
  ensureRange(ymd(addDays(new Date(), 15)), ymd(to));
  const match = x => !f || (x.tags || []).includes(f);
  const evs = events().filter(match), ts = tasks().filter(match), ns = notes().filter(match);
  const cps = cfgProjects().filter(visible).filter(p => !f || p.tag === f);
  const tagset = projects().filter(visible).filter(p => p.cfg || p.tasks.length).map(p => p.tag);
  let html = head('Horisont', `${weeks} veckor framåt`) + `<div class="chips filters"><button class="chip ${!f ? 'on' : ''}" data-hf="">Allt</button>${tagset.map(g => `<button class="chip ${f === g ? 'on' : ''}" data-hf="${esc(g)}">${esc(projects().find(p => p.tag === g)?.name || g.slice(1))}</button>`).join('')}</div>`;
  let emptyRun = [];
  const flush = () => { if (emptyRun.length) { html += `<div class="hempty">${emptyRun.length === 1 ? emptyRun[0] : emptyRun[0] + ' – ' + emptyRun[emptyRun.length - 1]}</div>`; emptyRun = []; } };
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    const s = ymd(d);
    if (d.getDay() === 1) { flush(); html += `<div class="weekmark">Vecka ${week(d)}</div>`; }
    const de = evs.filter(e => evOnDay(e, s)), dt = ts.filter(x => x.due === s), dn = ns.filter(n => (n.tags || []).some(g => tagDate(g) === s));
    const dp = cps.flatMap(p => [
      ...(p.shootDays || []).filter(x => x.date === s).map(x => `<a class="item" href="#/projekt/${encodeURIComponent(p.tag)}/produktion/dagar/${s}"><div class="time">Dag ${x.day}</div><div class="main"><div class="title">${esc(x.note || 'Inspelning')}<span class="tags">${tagHtml([p.tag])}</span></div><div class="sub">${esc(x.hours || '')}${x.strips ? '<i class="sep">·</i>' + x.strips + ' scener' : ''}</div></div></a>`),
      ...(p.deadlines || []).filter(x => x.date === s).map(x => `<div class="item"><div class="glyph">◆</div><div class="main"><div class="title">${esc(x.name)}<span class="tags">${tagHtml([p.tag])}</span></div><div class="sub">${esc(x.text || 'Deadline')}</div></div></div>`),
      ...(p.phases || []).filter(x => x.milestone && x.start === s).map(x => `<div class="item"><div class="glyph">◆</div><div class="main"><div class="title">${esc(x.name)}<span class="tags">${tagHtml([p.tag])}</span></div><div class="sub">Milstolpe</div></div></div>`),
    ]);
    const label = `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}/${d.getMonth() + 1}`;
    if (!de.length && !dt.length && !dn.length && !dp.length) { emptyRun.push(label); continue; }
    flush();
    html += `<div class="hday"><a class="dayh" href="#/kalender/dag/${s}"><span class="d">${d.getDate()} ${MONTHS[d.getMonth()]}</span><span class="w2">${DAYS[d.getDay()]}</span></a>${dp.join('')}${de.map(e => eventRow(e)).join('')}${dt.map(x => taskRow(x)).join('')}${dn.map(noteRow).join('')}</div>`;
  }
  flush();
  html += `<button class="btn more" data-hmore>Visa fyra veckor till</button>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-hf]').forEach(b => b.onclick = () => { setPref('h_filter', b.dataset.hf); emit('render'); });
  el.querySelector('[data-hmore]').onclick = () => { weeks += 4; emit('render'); };
}
export function context() { return 'Min horisont de kommande veckorna.'; }
