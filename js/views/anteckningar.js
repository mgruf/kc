/* ANTECKNINGAR – Apple Notes som sidor: mappar, sökning, hela texten, länkar, bakåtlänkar och en liten graf. */
import {
  S, emit, $, esc, ymd, shortDate, relTime, notes, tagHtml, tagDate, isDateTag, noteByTitle, backlinks, richText,
  loadNoteText, notesUrl, claudeUrl, tagColor, people, modeCls, projects,
} from '../core.js';
import { noteRow, section, empty, head, pref, setPref, openTask } from '../ui.js';
import { relatedHtml } from '../kopplat.js';

export function render(el, args, view) {
  if (view === 'anteckning' && args[0]) return page(el, decodeURIComponent(args[0]));
  list(el);
}

function list(el) {
  const folder = pref('n_folder', ''), q = pref('n_q', '');
  const all = notes();
  const folders = {};
  all.forEach(n => folders[n.folder] = (folders[n.folder] || 0) + 1);
  let ns = all;
  if (folder) ns = ns.filter(n => n.folder === folder);
  if (q) { const s = q.toLowerCase(); ns = ns.filter(n => (n.title + ' ' + n.excerpt + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(s)); }
  ns = ns.slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  const fl = Object.keys(folders).sort((a, b) => a.localeCompare(b, 'sv'));
  el.innerHTML = head('Anteckningar', `${all.length} i Notes · skrivs i Notes, kopplas här`, `<button class="btn" data-newnote>+ Ny anteckning</button>`) +
    `<div class="notes-wrap">
      <aside class="folders"><button class="${!folder ? 'on' : ''}" data-folder="">Alla <span>${all.length}</span></button>${fl.map(f => `<button class="${f === folder ? 'on' : ''}" data-folder="${esc(f)}">${esc(f)} <span>${folders[f]}</span></button>`).join('')}</aside>
      <div class="nlist">
        <input class="tsearch wide" data-nq value="${esc(q)}" placeholder="Sök i titlar och text…">
        ${ns.length ? ns.slice(0, 200).map(n => `<a class="ncard ${modeCls(n.mode)}" href="#/anteckning/${encodeURIComponent(n.id)}">
            <div class="nt">${esc(n.title)}<span class="tags">${tagHtml(n.tags)}</span></div>
            ${n.excerpt ? `<div class="nx">${esc(n.excerpt.replace(/^.*\n/, '').slice(0, 180))}</div>` : ''}
            <div class="sub"><span>${esc(n.folder)}</span><i class="sep">·</i><span>${n.modified ? esc(relTime(n.modified)) : ''}</span>${(n.links || []).length ? `<i class="sep">·</i><span>${n.links.length} länkar</span>` : ''}${backlinks(n).length ? `<i class="sep">·</i><span>${backlinks(n).length} bakåt</span>` : ''}</div></a>`).join('') : empty('Inga anteckningar här.')}
        ${ns.length > 200 ? `<p class="empty">Visar 200 av ${ns.length}. Sök för att hitta fler.</p>` : ''}
      </div></div>`;
  el.querySelectorAll('[data-folder]').forEach(b => b.onclick = () => { setPref('n_folder', b.dataset.folder); emit('render'); });
  const s = el.querySelector('[data-nq]');
  s.oninput = () => { setPref('n_q', s.value); clearTimeout(s._t); s._t = setTimeout(() => { const p = s.selectionStart; emit('render'); const n = el.querySelector('[data-nq]'); n.focus(); n.setSelectionRange(p, p); }, 200); };
  el.querySelector('[data-newnote]').onclick = () => import('../ui.js').then(m => m.openAdd('note'));
}

function page(el, id) {
  const n = (S.data?.notes || []).find(x => x.id === id);
  if (!n) { el.innerHTML = head('Anteckningen finns inte') + empty('Den kan ha tagits bort eller flyttats till en 🔒-mapp.'); return; }
  const text = S.noteText[n.id];
  if (text === undefined) loadNoteText(n);
  const priv = n.mode === 'privat' && !n.excerpt;
  const out = (n.links || []).map(t => ({ t, n: noteByTitle(t) }));
  const back = backlinks(n);
  const sameTag = (n.tags || []).filter(t => !isDateTag(t)).flatMap(t => notes().filter(x => x !== n && (x.tags || []).includes(t))).filter((x, i, a) => a.indexOf(x) === i).slice(0, 12);
  const dates = (n.tags || []).map(tagDate).filter(Boolean);
  const body = priv ? '<p class="empty">Privat anteckning – texten lämnar aldrig Macen. Öppna den i Notes.</p>'
    : text === undefined ? `<div class="prose">${richText(n.excerpt || '')}</div><p class="empty">Hämtar hela texten…</p>`
    : `<div class="prose">${richText(text || n.excerpt || '')}</div>`;
  const firstTag = (n.tags || []).find(t => !isDateTag(t));
  el.innerHTML = `<div class="crumb"><a href="#/anteckningar">Anteckningar</a> / ${esc(n.folder)}</div>` +
    head(esc(n.title), `${n.modified ? 'Ändrad ' + esc(relTime(n.modified)) : ''}<span class="tags">${tagHtml(n.tags)}</span>`,
      `<a class="btn solid" href="${esc(notesUrl(n))}">Öppna i Notes</a><button class="btn" data-ntask>+ Uppgift</button><a class="btn" href="${claudeUrl('Anteckning "' + n.title + '" (' + n.folder + '):\n' + (text || n.excerpt || '').slice(0, 3000))}" target="_blank" rel="noopener">Fråga Claude</a>`) +
    `<div class="npage"><article>${body}</article>
      <aside class="nside">
        ${graph(n, out, back)}
        ${section('nlinks', 'Länkar härifrån', out.length, out.length ? out.map(o => o.n ? noteRow(o.n) : `<div class="item"><div class="glyph">≡</div><div class="main"><div class="title missing">${esc(o.t)}</div><div class="sub">Finns inte än</div></div></div>`).join('') : '<p class="empty">Skriv [[Titel]] i Notes för att länka.</p>')}
        ${section('nback', 'Bakåtlänkar', back.length, back.length ? back.map(noteRow).join('') : '<p class="empty">Inga anteckningar länkar hit.</p>')}
        ${dates.length ? section('ndates', 'Datum', dates.length, dates.map(d => `<a class="item" href="#/kalender/dag/${d}"><div class="glyph">▦</div><div class="main"><div class="title">${esc(shortDate(d))}</div></div></a>`).join('')) : ''}
        ${sameTag.length ? section('ntag', 'Samma projekt', sameTag.length, sameTag.map(noteRow).join('')) : ''}
        ${relatedHtml('note', n.id, n.title)}
      </aside></div>`;
  el.querySelector('[data-ntask]').onclick = () => openTask(null, { title: '', tag: firstTag });
}

/** Liten lokal graf: anteckningen i mitten, länkar ut till höger, bakåtlänkar till vänster. */
function graph(n, out, back) {
  const L = back.slice(0, 7), R = out.filter(o => o.n).map(o => o.n).slice(0, 7);
  if (!L.length && !R.length) return '';
  const W = 300, H = Math.max(L.length, R.length, 1) * 30 + 30, cy = H / 2;
  const y = (i, n) => n === 1 ? cy : 20 + i * (H - 40) / (n - 1);
  const node = (x, yy, nn, anchor) => `<a href="#/anteckning/${encodeURIComponent(nn.id)}"><circle cx="${x}" cy="${yy}" r="4" class="gn"/><text x="${anchor === 'end' ? x - 9 : x + 9}" y="${yy + 4}" text-anchor="${anchor}">${esc(nn.title.length > 18 ? nn.title.slice(0, 17) + '…' : nn.title)}</text></a>`;
  return `<svg class="ngraph" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Länkgraf">
    ${L.map((x, i) => `<line x1="${W / 2}" y1="${cy}" x2="${W / 2 - 60}" y2="${y(i, L.length)}"/>`).join('')}
    ${R.map((x, i) => `<line x1="${W / 2}" y1="${cy}" x2="${W / 2 + 60}" y2="${y(i, R.length)}"/>`).join('')}
    ${L.map((x, i) => node(W / 2 - 60, y(i, L.length), x, 'end')).join('')}
    ${R.map((x, i) => node(W / 2 + 60, y(i, R.length), x, 'start')).join('')}
    <circle cx="${W / 2}" cy="${cy}" r="6" class="gc"/></svg>`;
}

export function context(args) {
  const n = args[0] && (S.data?.notes || []).find(x => x.id === decodeURIComponent(args[0]));
  return n ? `Anteckning "${n.title}" (${n.folder}):\n${(S.noteText[n.id] || n.excerpt || '').slice(0, 3000)}` : 'Mina anteckningar i Apple Notes.';
}
