/* KC – manus (Yamdu-läget): läs in Final Draft (.fdx), Fountain och PDF i webbläsaren,
   förhandsvisa, jämför med förra versionen (scen för scen, med avdelningar) och spara som JSON i Drive.
   Breakdown per scen sparas i samlingen 'Breakdown'. */
import { S, api, emit, $, esc, toast, todayStr, shortDate, relTime, refresh, personIn, initials } from '../core.js';
import { teamFor } from './team.js';

// ---------- tillstånd ----------
const M = {};                 // per tagg: { list, loading, error, scripts: {id: script}, imp, cmp, q, fRole, fPlace, fIe, fTod }
const st = tag => (M[tag] ||= { list: null, scripts: {}, q: '', fRole: '', fPlace: '', fIe: '', fTod: '' });
const base = p => '#/projekt/' + encodeURIComponent(p.tag) + '/manus';
const up = s => String(s || '').toUpperCase();

// ---------- sidor i åttondelar ----------
export const eighthsStr = n => { n = Math.max(0, Math.round(n || 0)); const w = Math.floor(n / 8), e = n % 8; return (w ? String(w) : '') + (w && e ? ' ' : '') + (e ? e + '/8' : (w ? '' : '0')); };
const parseEighths = s => { const m = String(s || '').trim().match(/^(?:(\d+)\s*)?(?:(\d+)\/8)?$/); return m ? Number(m[1] || 0) * 8 + Number(m[2] || 0) : 0; };
const hash = s => { let h = 5381; const t = String(s).replace(/\s+/g, ' ').trim(); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };

// ---------- scenrubrik ----------
const HEAD_RE = /^\s*(?:\d+[A-Z]?\s+)?(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.|EXT\.|INT\s|EXT\s|EST\.|INNE\.|UTE\.)/i;
const TOD_WORDS = /^(DAG|NATT|KVÄLL|MORGON|GRYNING|SKYMNING|EFTERMIDDAG|FÖRMIDDAG|LUNCH|SENARE|SAMMA|KONTINUERLIGT|DAY|NIGHT|EVENING|MORNING|DAWN|DUSK|LATER|CONTINUOUS|MOMENTS LATER)/i;
export function parseHeading(raw) {
  let h = String(raw || '').replace(/\s+/g, ' ').trim();
  let num = '';
  const mn = h.match(/^(\d+[A-Z]?)\s+(.*?)(?:\s+\1)?$/); if (mn && HEAD_RE.test(mn[2])) { num = mn[1]; h = mn[2]; }
  const mt = h.match(/\s(\d+[A-Z]?)$/); if (!num && mt && /\s-\s|–|—/.test(h) && !TOD_WORDS.test(mt[1])) { /* scenummer i slutet */ }
  const ie0 = (h.match(/^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?|INNE\.?|UTE\.?)/i) || [''])[0];
  const ie = /\//.test(ie0) || /I\/E/i.test(ie0) ? 'INT/EXT' : /^EXT|^UTE/i.test(ie0) ? 'EXT' : /^EST/i.test(ie0) ? 'EXT' : 'INT';
  let rest = h.slice(ie0.length).replace(/^[\s.]+/, '');
  let tod = '';
  const parts = rest.split(/\s+[-–—]\s+/);
  if (parts.length > 1 && TOD_WORDS.test(parts[parts.length - 1].trim())) { tod = parts.pop().trim(); rest = parts.join(' - '); }
  return { num, heading: h, ie, place: rest.trim().replace(/[.\s]+$/, ''), tod: up(tod) };
}
const isCue = l => { const t = l.trim(); if (!t || t.length > 40 || /[a-zåäö]/.test(t.replace(/\((?:[^)]*)\)/g, ''))) return false; if (HEAD_RE.test(t) || /^(CUT TO|FADE|KLIPP|TONAR|SLUT|THE END|OMITTED|FORTS|CONT)/i.test(t)) return false; return /[A-ZÅÄÖ]{2}/.test(t); };
const cueName = l => l.replace(/\((?:[^)]*)\)/g, '').replace(/\^/g, '').replace(/[:.]+$/, '').trim().replace(/\s+/g, ' ');

/** Gemensamt: lista med scener {num, heading, ie, place, tod, lines:[{t,type}], page, eighths?, rev} → manusobjekt. */
function finish(scenes, meta) {
  const LINES_PER_PAGE = 55;
  let auto = 0;
  const out = scenes.map(s => {
    auto++;
    const chars = [...new Set(s.lines.filter(l => l.type === 'char').map(l => cueName(l.t)).filter(Boolean))];
    const action = s.lines.find(l => l.type === 'action' && l.t.trim().length > 3);
    const text = s.lines.map(l => l.type === 'char' ? '\n' + l.t.trim() : l.t).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const omitted = /^\s*(OMITTED|STRUKEN|UTGÅR)/i.test(s.heading) || (/OMITTED/i.test(text) && text.length < 40);
    const eighths = s.eighths != null ? s.eighths : Math.max(1, Math.round(s.lineCount / LINES_PER_PAGE * 8));
    return { n: s.num || String(auto), heading: s.heading, ie: s.ie, place: s.place, tod: s.tod, page: s.page || '', eighths: omitted ? 0 : eighths, chars, summary: action ? action.t.trim().slice(0, 220) : '', text, hash: hash(text + '|' + s.heading), rev: !!s.rev, omitted };
  });
  const roles = {}, locs = {};
  out.forEach((s, i) => {
    if (s.omitted) return;
    s.chars.forEach(c => { const r = roles[c] ||= { name: c, scenes: 0, eighths: 0, first: s.n, last: s.n }; r.scenes++; r.eighths += s.eighths; r.last = s.n; });
    const k = up(s.place) || '(UTAN PLATS)'; const l = locs[k] ||= { place: s.place || '(utan plats)', ie: [], scenes: 0, eighths: 0, tods: [] }; l.scenes++; l.eighths += s.eighths; if (!l.ie.includes(s.ie)) l.ie.push(s.ie); if (s.tod && !l.tods.includes(s.tod)) l.tods.push(s.tod);
  });
  return { ...meta, parsed: new Date().toISOString(), scenes: out,
    roles: Object.values(roles).sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name, 'sv')),
    locations: Object.values(locs).sort((a, b) => b.scenes - a.scenes),
    eighths: out.reduce((a, s) => a + s.eighths, 0), pages: meta.pages || 0 };
}

// ---------- Final Draft ----------
export function parseFdx(xml, meta = {}) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Filen gick inte att läsa som Final Draft (.fdx)');
  const paras = [...doc.querySelectorAll('Content > Paragraph')];
  const scenes = []; let cur = null, pre = null, maxPage = 0;
  const txt = p => [...p.querySelectorAll(':scope > Text')].map(t => t.textContent).join('');
  paras.forEach(p => {
    const type = p.getAttribute('Type') || '', t = txt(p);
    const revised = !!p.querySelector('Text[Revision], Text[RevisionID]') || p.hasAttribute('Revision') || p.hasAttribute('RevisionID');
    if (type === 'Scene Heading') {
      const h = parseHeading(t), sp = p.querySelector('SceneProperties');
      const len = sp?.getAttribute('Length'), page = sp?.getAttribute('Page') || '';
      if (page) maxPage = Math.max(maxPage, parseInt(page) || 0);
      cur = { ...h, num: p.getAttribute('Number') || h.num, page, eighths: len != null && len !== '' ? parseEighths(len) : null, lines: [], lineCount: 1, rev: revised };
      if ((/omitted/i.test(t) || p.getAttribute('Omitted') === 'Yes') && !/^\s*OMITTED/i.test(cur.heading)) cur.heading = 'OMITTED ' + cur.heading;
      scenes.push(cur); return;
    }
    if (!cur) { pre = pre || []; return; }
    if (revised) cur.rev = true;
    const kind = type === 'Character' ? 'char' : type === 'Dialogue' ? 'dial' : type === 'Parenthetical' ? 'paren' : type === 'Transition' ? 'trans' : 'action';
    cur.lines.push({ t, type: kind });
    cur.lineCount += Math.max(1, Math.ceil(t.length / (kind === 'dial' ? 35 : 60))) + (kind === 'char' ? 1 : 0);
  });
  if (!scenes.length) throw new Error('Hittade inga scenrubriker i filen');
  return finish(scenes, { format: 'fdx', pages: maxPage, ...meta });
}

// ---------- Fountain ----------
export function parseFountain(src, meta = {}) {
  const lines = String(src).replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '').split('\n');
  let i = 0;
  if (/^\s*[A-Za-z ]+:/.test(lines[0] || '')) { while (i < lines.length && lines[i].trim() !== '') i++; }   // titelsida
  const scenes = []; let cur = null;
  for (; i < lines.length; i++) {
    const raw = lines[i], t = raw.trim(), prevBlank = i === 0 || lines[i - 1].trim() === '', nextBlank = i + 1 >= lines.length || lines[i + 1].trim() === '';
    if (!t) { if (cur) cur.lineCount++; continue; }
    const forced = /^\.[^.]/.test(t);
    if (prevBlank && (forced || (HEAD_RE.test(t) && nextBlank))) {
      let h = forced ? t.slice(1) : t, num = '';
      const mn = h.match(/#([^#]+)#\s*$/); if (mn) { num = mn[1].trim(); h = h.replace(/#[^#]+#\s*$/, '').trim(); }
      const ph = parseHeading(h);
      cur = { ...ph, num: num || ph.num, page: '', eighths: null, lines: [], lineCount: 1 };
      scenes.push(cur); continue;
    }
    if (!cur) continue;
    if (/^={3,}$/.test(t)) continue;
    let type = 'action';
    if (prevBlank && !nextBlank && (t.startsWith('@') || isCue(t))) type = 'char';
    else if (cur.lines.length && ['char', 'dial', 'paren'].includes(cur.lines[cur.lines.length - 1].type) && !prevBlank) type = /^\(.*\)$/.test(t) ? 'paren' : 'dial';
    else if (/^>.*[^<]$/.test(t) || /TO:$/.test(t)) type = 'trans';
    cur.lines.push({ t: t.replace(/^[@!]/, ''), type });
    cur.lineCount += type === 'dial' ? Math.ceil(t.length / 35) : Math.ceil(t.length / 60);
  }
  if (!scenes.length) throw new Error('Hittade inga scenrubriker (INT./EXT.) i filen');
  return finish(scenes, { format: 'fountain', ...meta });
}

// ---------- PDF ----------
let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  const v = '4.10.38';
  pdfjs = await import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;
  return pdfjs;
}
/** Sidor → rader med x-position. Används av parsePdfLines (testbar utan pdf.js). */
export async function pdfToLines(buf) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n), tc = await pg.getTextContent();
    const rows = {};
    tc.items.forEach(it => { if (!it.str || !it.str.trim()) return; const y = Math.round(it.transform[5] / 3) * 3; (rows[y] ||= []).push({ x: it.transform[4], s: it.str }); });
    const lines = Object.keys(rows).map(Number).sort((a, b) => b - a).map(y => { const r = rows[y].sort((a, b) => a.x - b.x); return { x: r[0].x, t: r.map(z => z.s).join(' ').replace(/\s+/g, ' ').trim() }; });
    pages.push(lines);
  }
  return pages;
}
export function parsePdfLines(pages, meta = {}) {
  const xs = pages.flat().map(l => Math.round(l.x / 10) * 10);
  const freq = {}; xs.forEach(x => freq[x] = (freq[x] || 0) + 1);
  const left = Math.min(...Object.keys(freq).map(Number).filter(x => freq[x] > xs.length * 0.05)) || 0;
  const scenes = []; let cur = null, prevType = '';
  pages.forEach((lines, pi) => {
    const pageNo = pi + 1, perPage = Math.max(40, lines.length);
    lines.forEach((l, li) => {
      const t = l.t;
      if (/^\d+\.?$/.test(t) || /^\(?(FORTS|FORTSÄTTER|CONT'?D|CONTINUED|MORE|MER)\)?\.?$/i.test(t) || /^(FORTS\.|CONTINUED:)/i.test(t)) return;     // sidnummer, fortsättningar
      if (li < 2 && /^\d+[A-Z]?\.?\s*$/.test(t)) return;
      const tt = t.replace(/^\d+[A-Z]?\s+/, '').replace(/\s+\d+[A-Z]?$/, '');
      if (HEAD_RE.test(t) && l.x <= left + 40 && t === up(t)) {
        const mn = t.match(/^(\d+[A-Z]?)\s/);
        cur = { ...parseHeading(tt), num: mn ? mn[1] : '', page: String(pageNo), eighths: null, lines: [], lineCount: 1, perPage };
        scenes.push(cur); prevType = 'head'; return;
      }
      if (!cur) return;
      let type = 'action';
      if (l.x > left + 120 && isCue(t)) type = 'char';
      else if (l.x > left + 60 && (prevType === 'char' || prevType === 'dial' || prevType === 'paren')) type = /^\(.*\)$/.test(t) ? 'paren' : 'dial';
      cur.lines.push({ t, type }); cur.lineCount += 1; cur._pp = perPage; prevType = type;
    });
  });
  scenes.forEach(s => { s.eighths = Math.max(1, Math.round(s.lineCount / (s._pp || 55) * 8)); });
  if (!scenes.length) throw new Error('Hittade inga scenrubriker i PDF:en. Är den inskannad?');
  return finish(scenes, { format: 'pdf', pages: pages.length, ...meta });
}

export async function parseFile(file) {
  const name = file.name, ext = (name.split('.').pop() || '').toLowerCase();
  const meta = { file: name, ...guessFromName(name) };
  if (ext === 'fdx') return parseFdx(await file.text(), meta);
  if (ext === 'pdf') return parsePdfLines(await pdfToLines(await file.arrayBuffer()), meta);
  return parseFountain(await file.text(), meta);
}
/** "JF4_F2_261001_PINK.fdx" → film F2, version 261001_PINK */
export function guessFromName(name) {
  const b = name.replace(/\.[^.]+$/, '');
  const ver = (b.match(/(\d{6}(?:[_ -][A-Za-zÅÄÖåäö]+)?)/) || [])[1] || '';
  const film = (b.match(/(?:^|[_ -])((?:F|FILM\s?|AVSNITT\s?|EP\s?|E)\d{1,2})(?:[_ -]|$)/i) || [])[1] || '';
  const f = film ? (/^(F|FILM)/i.test(film) ? 'F' + film.replace(/\D/g, '') : /^(AVSNITT|EP|E)/i.test(film) ? 'Avsnitt ' + film.replace(/\D/g, '') : film) : '';
  return { film: f, version: ver.replace(/\s|-/g, '_').toUpperCase() };
}

// ---------- jämförelse (ändringslista B: scen för scen, med avdelningar) ----------
const DEPTS = [
  ['Scenografi', /\b(rum|möbl|tapet|skylt|dekor|scenograf|interiör|fönster|dörr|vägg|bord|soffa|säng)/i],
  ['Kostym', /\b(kläder|jacka|klänning|kostym|uniform|skjorta|byxor|skor|rock|hatt|keps|väst|tröja|klädd|byter om)/i],
  ['Rekvisita', /\b(pistol|vapen|kniv|telefon|mobil|väska|nyckel|papper|mapp|dator|glas|flaska|cigarett|kamera|pengar|kuvert|bil(?!d))/i],
  ['Mask och hår', /\b(blod|sår|blåmärke|smink|hår|skägg|svett|tårar|ärr|blek)/i],
  ['Statister', /\b(statist|folk|publik|gäster|kunder|poliser|människor|folkmassa|förbipasserande|passagerare)/i],
];
function words(s) { return String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); }
/** Ordvis diff (LCS), begränsad storlek. Returnerar [{t:'=',w},{t:'+',w},{t:'-',w}] */
export function wordDiff(a, b) {
  const A = words(a), B = words(b);
  if (A.length * B.length > 4e6) return [{ t: '-', w: A.join(' ') }, { t: '+', w: B.join(' ') }];
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (t, w) => { const l = out[out.length - 1]; if (l && l.t === t) l.w += ' ' + w; else out.push({ t, w }); };
  while (i < n && j < m) { if (A[i] === B[j]) { push('=', A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) push('-', A[i++]); else push('+', B[j++]); }
  while (i < n) push('-', A[i++]); while (j < m) push('+', B[j++]);
  return out;
}
export function compare(oldS, newS) {
  const key = s => String(s.n).toUpperCase();
  const om = new Map(oldS.scenes.map(s => [key(s), s])), nm = new Map(newS.scenes.map(s => [key(s), s]));
  const changes = [];
  newS.scenes.forEach(s => {
    const o = om.get(key(s));
    if (!o) { if (!s.omitted) changes.push({ kind: 'ny', s, depts: deptsFor(s.text, s, null) }); return; }
    if (s.omitted && !o.omitted) { changes.push({ kind: 'utgår', s, o, depts: ['AD'] }); return; }
    if (o.hash === s.hash) return;
    const addC = s.chars.filter(c => !o.chars.includes(c)), remC = o.chars.filter(c => !s.chars.includes(c));
    const diff = wordDiff(o.text, s.text);
    const added = diff.filter(d => d.t === '+').map(d => d.w).join(' '), removed = diff.filter(d => d.t === '-').map(d => d.w).join(' ');
    const headCh = up(o.heading) !== up(s.heading);
    const depts = new Set(deptsFor(added + ' ' + removed, s, o));
    if (addC.length || remC.length) depts.add('AD');
    if (headCh) { depts.add('Scenografi'); depts.add('AD'); }
    changes.push({ kind: 'ändrad', s, o, addC, remC, headCh, dPages: s.eighths - o.eighths, diff, added, removed, depts: [...depts] });
  });
  oldS.scenes.forEach(o => { if (!nm.has(key(o)) && !o.omitted) changes.push({ kind: 'borttagen', s: o, o, depts: ['AD'] }); });
  const order = s => { const m = String(s.n).match(/^(\d+)(.*)$/); return m ? Number(m[1]) * 100 + (m[2] ? m[2].charCodeAt(0) : 0) : 1e9; };
  changes.sort((a, b) => order(a.s) - order(b.s));
  const rolesNew = newS.roles.map(r => r.name).filter(r => !oldS.roles.some(x => x.name === r));
  const rolesGone = oldS.roles.map(r => r.name).filter(r => !newS.roles.some(x => x.name === r));
  return { changes, rolesNew, rolesGone, dPages: newS.eighths - oldS.eighths };
}
function deptsFor(text, s, o) {
  const out = DEPTS.filter(([, re]) => re.test(text)).map(([d]) => d);
  if (!o && s.chars.length) out.push('AD');
  return [...new Set(out)];
}
const cmpText = (c, film, oldV, newV) => {
  const head = `ÄNDRINGAR ${film ? film + ' ' : ''}${oldV} → ${newV}\n${c.changes.length} scener berörs. Sidor: ${c.dPages >= 0 ? '+' : '−'}${eighthsStr(Math.abs(c.dPages))}.\n` +
    (c.rolesNew.length ? `Nya roller: ${c.rolesNew.join(', ')}\n` : '') + (c.rolesGone.length ? `Roller som försvunnit: ${c.rolesGone.join(', ')}\n` : '');
  return head + '\n' + c.changes.map(x => {
    const lines = [`SC ${x.s.n} – ${x.s.heading}  [${{ ny: 'NY', utgår: 'UTGÅR', borttagen: 'BORTTAGEN', ändrad: 'ÄNDRAD' }[x.kind]}]`];
    if (x.headCh) lines.push(`  Rubrik: ${x.o.heading} → ${x.s.heading}`);
    if (x.addC?.length) lines.push(`  AD: nya i scenen – ${x.addC.join(', ')}`);
    if (x.remC?.length) lines.push(`  AD: ut ur scenen – ${x.remC.join(', ')}`);
    if (x.dPages) lines.push(`  Sidor: ${x.dPages > 0 ? '+' : '−'}${eighthsStr(Math.abs(x.dPages))}`);
    if (x.depts?.length) lines.push(`  Berör: ${x.depts.join(', ')}`);
    if (x.added) lines.push(`  Ny text: ”${x.added.slice(0, 240)}${x.added.length > 240 ? '…' : ''}”`);
    if (x.kind === 'ny') lines.push(`  ${x.s.chars.length ? 'Roller: ' + x.s.chars.join(', ') + '. ' : ''}${eighthsStr(x.s.eighths)} sidor. ${x.s.summary.slice(0, 200)}`);
    return lines.join('\n');
  }).join('\n\n');
};

// ---------- data ----------
async function loadList(p, force) {
  const s = st(p.tag);
  if (s.loading || (s.list && !force)) return;
  s.loading = true;
  try { s.list = (await api('scripts', { tag: p.tag }, false, p.cfg?._src || 'jobb')).scripts; s.error = null; }
  catch (e) { s.error = e.message; s.list = s.list || []; }
  s.loading = false; emit('render');
}
async function loadScript(p, id) {
  const s = st(p.tag);
  if (s.scripts[id]) return s.scripts[id];
  if (s['l_' + id]) return null; s['l_' + id] = true;
  try { s.scripts[id] = (await api('script', { id }, false, p.cfg?._src || 'jobb')).script; }
  catch (e) { toast('Kunde inte läsa manuset – ' + e.message); }
  delete s['l_' + id]; emit('render');
  return s.scripts[id];
}
const versionsByFilm = list => { const g = {}; (list || []).forEach(x => (g[x.film || 'Manus'] ||= []).push(x)); Object.values(g).forEach(v => v.sort((a, b) => a.updated < b.updated ? 1 : -1)); return g; };

/** Senaste versionen per film (för produktionsvyn när scenark saknas). */
export async function loadLatestScripts(tag, src) {
  const p = { tag, cfg: { _src: src } };
  const s = st(tag);
  if (!s.list) { try { s.list = (await api('scripts', { tag }, false, src || 'jobb')).scripts; } catch { s.list = []; } }
  const latest = Object.values(versionsByFilm(s.list)).map(v => v[0]);
  const out = [];
  for (const v of latest) { const sc = s.scripts[v.id] || await (async () => { try { return s.scripts[v.id] = (await api('script', { id: v.id }, false, src || 'jobb')).script; } catch { return null; } })(); if (sc) out.push(sc); }
  return out;
}

// ---------- ingång ----------
export function renderScript(el, p, args = []) {
  const s = st(p.tag);
  if (!s.list && !s.loading) loadList(p);
  let body;
  if (s.imp) body = importView(p, s);
  else if (args[0] === 'v' && args[1]) body = versionView(p, s, decodeURIComponent(args[1]), args.slice(2));
  else if (args[0] === 'jamfor' && args[1] && args[2]) body = compareView(p, s, decodeURIComponent(args[1]), decodeURIComponent(args[2]));
  else body = overview(p, s);
  const keep = el.querySelector('.mn [data-mf="q"]') === document.activeElement;
  el.innerHTML = `<div class="mn" data-mtag="${esc(p.tag)}">${body}</div>`;
  if (keep) { const i = el.querySelector('.mn [data-mf="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  bindOnce();
  CURP = p;
}
let CURP = null;

function overview(p, s) {
  const g = versionsByFilm(s.list);
  const films = Object.keys(g).sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
  const top = `<div class="mn-top"><div><h3>Manus</h3><p class="hint">Läs in Final Draft (.fdx), Fountain eller PDF. KC hittar scener, roller, platser och sidor och jämför med förra versionen.</p></div>
    <label class="btn solid mn-file">Läs in manus<input type="file" accept=".fdx,.fountain,.spmd,.txt,.pdf" data-mfile hidden></label></div>`;
  if (!s.list) return top + `<div class="mn-loading"><span class="spin"></span>Hämtar sparade versioner…</div>`;
  if (s.error && !films.length) return top + `<div class="notice">Kunde inte hämta manus: ${esc(s.error)}</div>`;
  if (!films.length) return top + `<div class="mn-empty card"><b>Inga manus inlästa än.</b><span>Dra en fil hit eller använd knappen.</span></div>`;
  return top + `<div class="mn-films">${films.map(f => {
    const v = g[f];
    return `<div class="mn-film card"><div class="mn-film-h"><b>${esc(f)}</b><span class="hint">${v.length} version${v.length > 1 ? 'er' : ''}</span></div>
      ${v.map((x, i) => `<div class="mn-ver"><a href="${base(p)}/v/${encodeURIComponent(x.id)}"><b>${esc(x.version || x.name)}</b><small>${esc(relTime(x.updated))}${i === 0 ? ' · senaste' : ''}</small></a>
        ${v[i + 1] ? `<a class="mn-cmp" href="${base(p)}/jamfor/${encodeURIComponent(v[i + 1].id)}/${encodeURIComponent(x.id)}">Ändringar mot ${esc(v[i + 1].version)}</a>` : ''}</div>`).join('')}
    </div>`; }).join('')}</div>`;
}

// ---------- import ----------
function importView(p, s) {
  const I = s.imp;
  if (I.error) return `<div class="mn-top"><h3>Läs in manus</h3><button class="btn" data-mcancel>Stäng</button></div><div class="notice">${esc(I.error)}</div>`;
  if (!I.script) return `<div class="mn-loading"><span class="spin"></span>Läser ${esc(I.file)}…</div>`;
  const sc = I.script;
  const g = versionsByFilm(s.list);
  const films = Object.keys(g);
  const prev = I.film && g[I.film] ? g[I.film][0] : null;
  const prevScript = prev ? s.scripts[prev.id] : null;
  if (prev && !prevScript) loadScript(p, prev.id);
  const c = prevScript ? compare(prevScript, sc) : null;
  return `<div class="mn-top"><div><h3>Förhandsvisning</h3><p class="hint">${esc(I.file)} · ${esc(sc.format.toUpperCase())}</p></div>
      <div class="vact"><button class="btn" data-mcancel>Avbryt</button><button class="btn solid" data-msave>Spara version</button></div></div>
    <div class="mn-form card">
      <label>Film / avsnitt<input data-mi="film" list="mnFilms" value="${esc(I.film)}" placeholder="F1, Avsnitt 1…"><datalist id="mnFilms">${films.map(f => `<option value="${esc(f)}">`).join('')}</datalist></label>
      <label>Version<input data-mi="version" value="${esc(I.version)}" placeholder="261001_PINK"></label>
    </div>
    ${statsHtml(sc)}
    ${c ? `<section class="sec"><h2><span class="h">Ändringar mot ${esc(prev.version)}</span><span class="n">${c.changes.length}</span></h2><div class="body">${cmpHtml(c, I.film, prev.version, I.version)}</div></section>`
      : prev ? `<div class="mn-loading"><span class="spin"></span>Hämtar ${esc(prev.version)} för jämförelse…</div>` : `<p class="hint" style="margin-top:16px">${I.film ? 'Första versionen av ' + esc(I.film) + ' – inget att jämföra med.' : 'Välj film för att jämföra med förra versionen.'}</p>`}
    <section class="sec"><h2><span class="h">Scener</span><span class="n">${sc.scenes.length}</span></h2><div class="body">${sceneTable(sc, null)}</div></section>
    <div class="mn-two"><section class="sec"><h2><span class="h">Roller</span><span class="n">${sc.roles.length}</span></h2><div class="body">${rolesTable(sc, p)}</div></section>
      <section class="sec"><h2><span class="h">Platser</span><span class="n">${sc.locations.length}</span></h2><div class="body">${locTable(sc)}</div></section></div>`;
}
function statsHtml(sc) {
  const live = sc.scenes.filter(s => !s.omitted);
  const n = x => live.filter(s => s.ie === x).length;
  const night = live.filter(s => /NATT|NIGHT/.test(s.tod)).length;
  return `<div class="mn-stats">
    <div><b>${live.length}</b><span>scener</span></div><div><b>${esc(eighthsStr(sc.eighths))}</b><span>sidor${sc.pages ? ` (${sc.pages} s i filen)` : ''}</span></div>
    <div><b>${sc.roles.length}</b><span>roller</span></div><div><b>${sc.locations.length}</b><span>platser</span></div>
    <div><b>${n('INT')}/${n('EXT')}${n('INT/EXT') ? '/' + n('INT/EXT') : ''}</b><span>INT/EXT${n('INT/EXT') ? '/båda' : ''}</span></div><div><b>${night}</b><span>nattscener</span></div>
  </div>`;
}

function cmpHtml(c, film, oldV, newV) {
  if (!c.changes.length) return '<p class="empty">Inga ändringar i scenerna.</p>';
  const kindTag = k => `<span class="mn-k mn-k-${k}">${{ ny: 'Ny', utgår: 'Utgår', borttagen: 'Borttagen', ändrad: 'Ändrad' }[k]}</span>`;
  const txt = cmpText(c, film, oldV, newV);
  return `<div class="mn-cmp-sum">
      <span><b>${c.changes.filter(x => x.kind === 'ändrad').length}</b> ändrade</span><span><b>${c.changes.filter(x => x.kind === 'ny').length}</b> nya</span><span><b>${c.changes.filter(x => x.kind === 'utgår' || x.kind === 'borttagen').length}</b> utgår</span>
      <span>Sidor <b>${c.dPages >= 0 ? '+' : '−'}${esc(eighthsStr(Math.abs(c.dPages)))}</b></span>
      <button class="btn" data-mcopy>Kopiera ändringslistan</button><textarea data-mcopytext hidden>${esc(txt)}</textarea></div>
    ${c.rolesNew.length || c.rolesGone.length ? `<div class="mn-roles-ch">${c.rolesNew.length ? `<span><b>AD</b> Nya roller: ${esc(c.rolesNew.join(', '))}</span>` : ''}${c.rolesGone.length ? `<span><b>AD</b> Försvunna roller: ${esc(c.rolesGone.join(', '))}</span>` : ''}</div>` : ''}
    <div class="mn-changes">${c.changes.map(x => `<details class="mn-ch">
      <summary><span class="mn-sn">${esc(x.s.n)}</span><span class="mn-sh">${esc(x.s.heading)}</span>${kindTag(x.kind)}${x.dPages ? `<span class="mn-dp">${x.dPages > 0 ? '+' : '−'}${esc(eighthsStr(Math.abs(x.dPages)))}</span>` : ''}</summary>
      <div class="mn-ch-b">
        ${x.headCh ? `<p><b>Rubrik</b> ${esc(x.o.heading)} → ${esc(x.s.heading)}</p>` : ''}
        ${x.addC?.length ? `<p><b>AD</b> Nya i scenen: ${esc(x.addC.join(', '))}</p>` : ''}${x.remC?.length ? `<p><b>AD</b> Ut ur scenen: ${esc(x.remC.join(', '))}</p>` : ''}
        ${x.depts?.length ? `<p class="mn-depts">${x.depts.map(d => `<b>${esc(d)}</b>`).join(' ')}<small>– förslag utifrån orden som ändrats</small></p>` : ''}
        ${x.diff ? `<div class="mn-diff">${x.diff.map(d => d.t === '=' ? esc(d.w.length > 400 ? d.w.slice(0, 120) + ' … ' + d.w.slice(-120) : d.w) : `<${d.t === '+' ? 'ins' : 'del'}>${esc(d.w)}</${d.t === '+' ? 'ins' : 'del'}>`).join(' ')}</div>` : x.s.text ? `<div class="mn-diff">${esc(x.s.text.slice(0, 1200))}</div>` : ''}
      </div></details>`).join('')}</div>`;
}

function sceneTable(sc, p, filt) {
  let list = sc.scenes;
  if (filt) {
    const q = filt.q.trim().toLowerCase();
    list = list.filter(s => (!filt.fRole || s.chars.includes(filt.fRole)) && (!filt.fPlace || s.place === filt.fPlace) && (!filt.fIe || s.ie === filt.fIe) && (!filt.fTod || s.tod === filt.fTod)
      && (!q || [s.n, s.heading, s.summary, s.chars.join(' ')].join(' ').toLowerCase().includes(q)));
  }
  const link = s => p ? `${base(p)}/v/${encodeURIComponent(filt.id)}/scen/${encodeURIComponent(s.n)}` : null;
  return `<div class="mn-count">${list.length} scener · ${esc(eighthsStr(list.reduce((a, s) => a + s.eighths, 0)))} sidor</div>
    <div class="mn-tablewrap"><table class="mn-table"><thead><tr><th>Sc</th><th>I/E</th><th>Plats</th><th>Tid</th><th class="r">Sidor</th><th class="r">Sida</th><th>Roller</th></tr></thead><tbody>
    ${list.map(s => `<tr class="${s.omitted ? 'om' : ''} ${s.rev ? 'rev' : ''}" ${link(s) ? `data-mhref="${esc(link(s))}"` : ''}>
      <td class="tnum"><b>${esc(s.n)}</b>${s.rev ? '<i class="mn-rev" title="Reviderad i filen">*</i>' : ''}</td><td>${esc(s.ie.replace('INT/EXT', 'I/E'))}</td>
      <td>${esc(s.place)}${s.summary ? `<small>${esc(s.summary.slice(0, 90))}</small>` : ''}</td><td>${esc(s.tod.toLowerCase())}</td>
      <td class="r tnum">${s.omitted ? '' : esc(eighthsStr(s.eighths))}</td><td class="r tnum">${esc(s.page)}</td><td class="mn-cast">${esc(s.chars.join(', '))}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function actorFor(p, role) {
  const t = p ? teamFor(p.tag).find(r => /skådespel/i.test(r['Typ'] || '') && up(r['Roll']) === up(role)) : null;
  return t ? personIn(t['Person']) || { name: t['Person'], email: '' } : null;
}
function rolesTable(sc, p) {
  return `<div class="mn-list">${sc.roles.map(r => { const a = actorFor(p, r.name); return `<div class="mn-row"><b>${esc(r.name)}</b>
    <span class="hint">${r.scenes} scener · ${esc(eighthsStr(r.eighths))} s · sc ${esc(r.first)}–${esc(r.last)}</span>
    ${a ? `<a class="pchip" href="#/person/${encodeURIComponent((a.email || '').toLowerCase())}"><i>${esc(initials(a.name))}</i>${esc(a.name)}</a>` : p ? `<button class="btn mn-cast-btn" data-team-add='${esc(JSON.stringify({ tag: p.tag, typ: 'Skådespelare', roll: r.name }))}'>Tillsätt</button>` : ''}</div>`; }).join('')}</div>`;
}
function locTable(sc) {
  return `<div class="mn-list">${sc.locations.map(l => `<div class="mn-row"><b>${esc(l.place)}</b><span class="hint">${esc(l.ie.join('/'))} · ${l.scenes} scener · ${esc(eighthsStr(l.eighths))} s${l.tods.length ? ' · ' + esc(l.tods.join(', ').toLowerCase()) : ''}</span></div>`).join('')}</div>`;
}

// ---------- sparad version ----------
function versionView(p, s, id, rest) {
  const meta = (s.list || []).find(x => x.id === id);
  const sc = s.scripts[id];
  if (!sc) { loadScript(p, id); return `<div class="mn-loading"><span class="spin"></span>Hämtar manuset…</div>`; }
  const tabs = [['scener', 'Scener'], ['roller', 'Roller'], ['platser', 'Platser']];
  const tab = tabs.some(t => t[0] === rest[0]) ? rest[0] : rest[0] === 'scen' ? 'scen' : 'scener';
  const vb = `${base(p)}/v/${encodeURIComponent(id)}`;
  const g = versionsByFilm(s.list), vers = g[sc.film || 'Manus'] || [];
  const ix = vers.findIndex(x => x.id === id), older = vers[ix + 1];
  let body;
  if (tab === 'scen') body = scenePage(p, sc, decodeURIComponent(rest[1] || ''), vb);
  else if (tab === 'roller') body = rolesTable(sc, p);
  else if (tab === 'platser') body = locTable(sc);
  else {
    const roles = sc.roles.map(r => r.name), places = sc.locations.map(l => l.place), tods = [...new Set(sc.scenes.map(x => x.tod).filter(Boolean))];
    const opt = (k, list, label) => `<select data-mf="${k}"><option value="">${label}</option>${list.map(x => `<option ${s[k] === x ? 'selected' : ''} value="${esc(x)}">${esc(x)}</option>`).join('')}</select>`;
    body = `<div class="mn-filters"><input type="search" data-mf="q" value="${esc(s.q)}" placeholder="Sök scen, roll, handling…">${opt('fRole', roles, 'Alla roller')}${opt('fPlace', places, 'Alla platser')}${opt('fIe', ['INT', 'EXT', 'INT/EXT'], 'INT/EXT')}${opt('fTod', tods, 'Alla tider')}</div>
      <div id="mnSceneTable">${sceneTable(sc, p, { ...s, id })}</div>`;
  }
  return `<div class="mn-top"><div><div class="crumb" style="padding:0"><a href="${base(p)}">Manus</a></div><h3>${esc(sc.film || 'Manus')} · ${esc(sc.version || meta?.version || '')}</h3><p class="hint">${esc(sc.file || '')}${meta ? ' · sparad ' + esc(relTime(meta.updated)) : ''}</p></div>
      <div class="vact">${older ? `<a class="btn" href="${base(p)}/jamfor/${encodeURIComponent(older.id)}/${encodeURIComponent(id)}">Ändringar mot ${esc(older.version)}</a>` : ''}<label class="btn mn-file">Ny version<input type="file" accept=".fdx,.fountain,.spmd,.txt,.pdf" data-mfile data-mfilm="${esc(sc.film || '')}" hidden></label></div></div>
    ${statsHtml(sc)}
    ${tab !== 'scen' ? `<nav class="mn-tabs">${tabs.map(([k, l]) => `<a href="${vb}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>` : ''}
    ${body}`;
}

function bdRow(p, film, n) {
  const c = (S.data?.collections || []).find(x => x.name === 'Breakdown');
  return c ? c.rows.find(r => String(r['Scen']) === String(n) && String(r['Film'] || '') === String(film || '') && String(r['Projekt'] || '').toUpperCase().includes(p.tag)) : null;
}
const BD = ['Rekvisita', 'Kostym', 'Mask', 'Fordon', 'Statister', 'Stunt', 'SFX', 'VFX', 'Djur', 'Anteckning'];
function scenePage(p, sc, n, vb) {
  const i = sc.scenes.findIndex(x => String(x.n) === n), s = sc.scenes[i];
  if (!s) return '<p class="empty">Scenen finns inte i versionen.</p>';
  const prev = sc.scenes[i - 1], next = sc.scenes[i + 1], row = bdRow(p, sc.film, s.n) || {};
  const hasBd = (S.data?.collections || []).some(x => x.name === 'Breakdown');
  return `<div class="mn-scene">
    <div class="mn-scene-nav"><a class="btn" href="${vb}/scener">← Alla scener</a><span>${prev ? `<a class="btn" href="${vb}/scen/${encodeURIComponent(prev.n)}">‹ ${esc(prev.n)}</a>` : ''}${next ? `<a class="btn" href="${vb}/scen/${encodeURIComponent(next.n)}">${esc(next.n)} ›</a>` : ''}</span></div>
    <div class="mn-scene-grid"><article class="card mn-script"><div class="mn-sh-big"><span>${esc(s.n)}</span>${esc(s.heading)}</div>
      <div class="mn-meta">${esc(eighthsStr(s.eighths))} sidor${s.page ? ' · sida ' + esc(s.page) : ''}${s.rev ? ' · reviderad' : ''}</div>
      <div class="mn-text">${scriptHtml(s.text)}</div></article>
      <aside class="mn-bd">
        <div class="mn-k">Roller</div><div class="chips">${s.chars.map(c => { const a = actorFor(p, c); return `<span class="chip">${esc(c)}${a ? ' · ' + esc(a.name) : ''}</span>`; }).join('') || '<span class="hint">Inga repliker</span>'}</div>
        <div class="mn-k" style="margin-top:18px">Breakdown</div>
        ${hasBd ? BD.map(f => `<label class="mn-bdf"><span>${f}</span><textarea rows="1" data-bd="${esc(f)}" data-bdscene="${esc(s.n)}" data-bdfilm="${esc(sc.film || '')}" placeholder="–">${esc(row[f] || '')}</textarea></label>`).join('') : '<p class="hint">Samlingen Breakdown saknas. Kör setup i Apps Script.</p>'}
      </aside></div></div>`;
}
function scriptHtml(text) {
  return String(text || '').split('\n').map(l => {
    const t = l.trim();
    if (!t) return '<br>';
    if (isCue(t)) return `<div class="mn-cue">${esc(t)}</div>`;
    return `<div>${esc(t)}</div>`;
  }).join('');
}

// ---------- jämför två sparade ----------
function compareView(p, s, idA, idB) {
  const a = s.scripts[idA], b = s.scripts[idB];
  if (!a) loadScript(p, idA); if (!b) loadScript(p, idB);
  if (!a || !b) return `<div class="mn-loading"><span class="spin"></span>Hämtar versionerna…</div>`;
  const c = compare(a, b);
  return `<div class="mn-top"><div><div class="crumb" style="padding:0"><a href="${base(p)}">Manus</a></div><h3>${esc(b.film || 'Manus')}: ${esc(a.version)} → ${esc(b.version)}</h3><p class="hint">Ändringslista scen för scen. Avdelningar är förslag utifrån orden som ändrats.</p></div>
    <div class="vact"><a class="btn" href="${base(p)}/v/${encodeURIComponent(idB)}">Öppna ${esc(b.version)}</a></div></div>${cmpHtml(c, b.film, a.version, b.version)}`;
}

// ---------- händelser ----------
async function startImport(file, film) {
  const p = CURP; if (!p) return;
  const s = st(p.tag);
  s.imp = { file: file.name, film: film || '', version: '' };
  emit('render');
  try {
    const sc = await parseFile(file);
    s.imp.script = sc;
    s.imp.film = film || sc.film || (Object.keys(versionsByFilm(s.list))[0] && !sc.film ? '' : sc.film) || '';
    s.imp.version = sc.version || todayStr().slice(2).replace(/-/g, '');
  } catch (e) { s.imp.error = e.message || String(e); }
  emit('render');
}
async function saveImport() {
  const p = CURP, s = st(p.tag), I = s.imp; if (!I?.script) return;
  if (!I.film.trim()) return toast('Ange film eller avsnitt');
  if (!I.version.trim()) return toast('Ange version');
  const data = { ...I.script, tag: p.tag, film: I.film.trim(), version: I.version.trim() };
  const btn = document.querySelector('[data-msave]'); if (btn) { btn.disabled = true; btn.textContent = 'Sparar…'; }
  try {
    const r = await api('saveScript', { tag: p.tag, film: data.film, version: data.version, data }, true, p.cfg?._src || 'jobb');
    s.scripts[r.id] = data; s.imp = null;
    await loadList(p, true);
    toast('Manuset är sparat');
    location.hash = `${base(p)}/v/${encodeURIComponent(r.id)}`;
  } catch (e) { toast('Kunde inte spara – ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Spara version'; } }
}
let bdTimer = {};
async function saveBd(ta) {
  const p = CURP; const film = ta.dataset.bdfilm, n = ta.dataset.bdscene, f = ta.dataset.bd, v = ta.value;
  const c = (S.data?.collections || []).find(x => x.name === 'Breakdown'); if (!c) return;
  let row = bdRow(p, film, n);
  if (row && String(row[f] || '') === v) return;
  const values = { [f]: v };
  if (!row) { Object.assign(values, { Scen: n, Film: film, Projekt: p.tag }); row = { _id: 'tmp' + Date.now(), Scen: n, Film: film, Projekt: p.tag, _src: c._src }; c.rows.push(row); }
  row[f] = v;
  try { const r = await api('saveRow', { collection: 'Breakdown', id: String(row._id).startsWith('tmp') ? '' : row._id, values }, true, c._src || 'jobb'); row._id = r.id; ta.classList.add('saved'); setTimeout(() => ta.classList.remove('saved'), 900); }
  catch (e) { toast('Kunde inte spara – ' + e.message); }
}

let bound = false;
function bindOnce() {
  if (bound) return; bound = true;
  document.addEventListener('change', e => {
    const f = e.target.closest('.mn [data-mfile]');
    if (f && f.files[0]) { startImport(f.files[0], f.dataset.mfilm); f.value = ''; return; }
    const sel = e.target.closest('.mn select[data-mf]');
    if (sel && CURP) { st(CURP.tag)[sel.dataset.mf] = sel.value; emit('render'); }
  });
  document.addEventListener('input', e => {
    const i = e.target.closest('.mn [data-mi]');
    if (i && CURP) { st(CURP.tag).imp[i.dataset.mi] = i.value; clearTimeout(i._t); if (i.dataset.mi === 'film') i._t = setTimeout(() => emit('render'), 500); return; }
    const q = e.target.closest('.mn input[data-mf="q"]');
    if (q && CURP) { const s = st(CURP.tag); s.q = q.value; const box = $('#mnSceneTable'); const id = decodeURIComponent((location.hash.match(/\/v\/([^/]+)/) || [])[1] || ''); if (box && s.scripts[id]) box.innerHTML = sceneTable(s.scripts[id], CURP, { ...s, id }); return; }
    const ta = e.target.closest('.mn textarea[data-bd]');
    if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; clearTimeout(bdTimer[ta.dataset.bd]); bdTimer[ta.dataset.bd] = setTimeout(() => saveBd(ta), 900); }
  });
  document.addEventListener('focusout', e => { const ta = e.target.closest?.('.mn textarea[data-bd]'); if (ta) { clearTimeout(bdTimer[ta.dataset.bd]); saveBd(ta); } });
  document.addEventListener('click', e => {
    if (!CURP) return;
    if (e.target.closest('.mn [data-mcancel]')) { st(CURP.tag).imp = null; return emit('render'); }
    if (e.target.closest('.mn [data-msave]')) return saveImport();
    const cp = e.target.closest('.mn [data-mcopy]');
    if (cp) { const t = cp.parentElement.querySelector('[data-mcopytext]').value; navigator.clipboard?.writeText(t).then(() => toast('Ändringslistan är kopierad'), () => toast('Kunde inte kopiera')); return; }
    const tr = e.target.closest('.mn [data-mhref]');
    if (tr && !e.target.closest('a,button')) location.hash = tr.dataset.mhref;
  });
  // Dra och släpp en fil på manusfliken
  document.addEventListener('dragover', e => { if (e.target.closest?.('.mn') && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.target.closest('.mn').classList.add('mn-drop'); } });
  document.addEventListener('dragleave', e => e.target.closest?.('.mn')?.classList.remove('mn-drop'));
  document.addEventListener('drop', e => { const m = e.target.closest?.('.mn'); if (!m || !e.dataTransfer?.files?.[0]) return; e.preventDefault(); m.classList.remove('mn-drop'); startImport(e.dataTransfer.files[0], ''); });
}
