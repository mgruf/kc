/* KC – Kopplat: allt kan länkas till allt (uppgift, händelse, anteckning, person, projekt, rad, scen, dokument).
   Manuella kopplingar sparas i samlingen "Kopplingar" (S.data.relations). Automatiska kopplingar räknas fram
   ur taggar, kontaktrader, [[länkar]], datumtaggar och mailtrådar. */
import {
  S, api, emit, $, esc, toast, ymd, shortDate, dayLabel, hhmm, cleanTitle, tagColor, isDateTag, tagDate,
  contactOf, mailHref, threadOf, personByKey, people, projects, notes, noteByTitle, backlinks, initials,
} from './core.js';

// ---------- referenser ----------
const TYPE_LABEL = { task: 'Uppgift', event: 'Händelse', note: 'Anteckning', person: 'Person', project: 'Projekt', row: 'Rad', scene: 'Scen', doc: 'Dokument', mail: 'Mejl' };
const allEvents = () => [...(S.data?.events || []), ...(S.extraEvents || [])];
/** Nyckel för en händelse: id + start (återkommande förekomster har samma id). */
export const eventKey = e => e.id + '|' + e.start;

/** Slår upp en referens till något klickbart. Returnerar { title, sub, href?, attrs?, kind }. */
export function resolve(ref) {
  const { type, id } = ref;
  const t0 = ref.title || '';
  switch (type) {
    case 'task': {
      const t = (S.data?.tasks || []).find(x => x.id === id);
      return { kind: TYPE_LABEL.task, title: t ? cleanTitle(t.title) : t0, sub: t ? [t.due ? dayLabel(t.due) : '', t.list].filter(Boolean).join(' · ') : 'Klar eller borttagen', attrs: t ? `data-task="${esc(t.id)}"` : '', gone: !t };
    }
    case 'event': {
      const [eid, start] = String(id).split('|');
      const e = allEvents().find(x => x.id === eid && (!start || x.start === start)) || allEvents().find(x => x.id === eid);
      const s = e ? e.start : start;
      const when = s ? (String(s).length === 10 ? shortDate(s) : `${dayLabel(ymd(new Date(s)))} ${hhmm(s)}`) : '';
      return { kind: TYPE_LABEL.event, title: e ? cleanTitle(e.title) : t0, sub: when, href: `#/mote/${encodeURIComponent(eid)}/${encodeURIComponent(s || '')}` };
    }
    case 'note': {
      const n = (S.data?.notes || []).find(x => x.id === id);
      return { kind: TYPE_LABEL.note, title: n ? n.title : t0, sub: n ? n.folder : '', href: `#/anteckning/${encodeURIComponent(id)}` };
    }
    case 'person': {
      const p = personByKey(id);
      return { kind: TYPE_LABEL.person, title: p?.name || t0 || id, sub: p ? [p.title, p.org].filter(Boolean).join(', ') || id : id, href: `#/person/${encodeURIComponent(String(id).toLowerCase())}` };
    }
    case 'project': {
      const p = projects().find(x => x.tag === id);
      return { kind: TYPE_LABEL.project, title: p?.name || t0 || id, sub: id, href: `#/projekt/${encodeURIComponent(id)}` };
    }
    case 'row': {
      const [coll, rid] = String(id).split(':');
      const c = (S.data?.collections || []).find(x => x.name === coll);
      const r = c?.rows.find(x => x._id === rid);
      return { kind: coll || TYPE_LABEL.row, title: r ? String(r[c.fields[0]?.name] || '(utan namn)') : t0, sub: coll, href: `#/samling/${encodeURIComponent(coll)}/${encodeURIComponent(rid)}` };
    }
    case 'scene': {
      const [tag, film, sc] = String(id).split('|');
      return { kind: TYPE_LABEL.scene, title: t0 || `${film} ${sc}`, sub: tag, href: `#/projekt/${encodeURIComponent(tag)}/produktion/scener/${encodeURIComponent(film + '-' + sc)}` };
    }
    case 'mail': return { kind: TYPE_LABEL.mail, title: t0 || 'Mejltråd', sub: '', href: 'mailpro://thread/' + id };
    case 'doc': return { kind: TYPE_LABEL.doc, title: t0 || id, sub: (/^https?:\/\/([^/]+)/.exec(id) || [])[1] || '', href: id, ext: true };
  }
  return { kind: type, title: t0 || id, sub: '' };
}

/** Manuella kopplingar för en sak: [{ relId, ref }] (den andra sidan). */
export function relationsFor(type, id) {
  const k = type + '|' + id;
  return (S.data?.relations || []).flatMap(r => {
    if (r.a.type + '|' + r.a.id === k) return [{ relId: r.id, ref: r.b }];
    if (r.b.type + '|' + r.b.id === k) return [{ relId: r.id, ref: r.a }];
    return [];
  });
}

/** Automatiska kopplingar: [{ ref, why }]. */
function autoFor(type, id) {
  const out = [];
  const add = (ref, why) => out.push({ ref, why });
  const tagsOf = list => (list || []).filter(t => !isDateTag(t) && t !== '#PRIVAT');
  if (type === 'task') {
    const t = (S.data?.tasks || []).find(x => x.id === id); if (!t) return out;
    tagsOf(t.tags).forEach(g => add({ type: 'project', id: g }, 'tagg'));
    const c = contactOf(t); if (c) add({ type: 'person', id: c.email.toLowerCase(), title: c.name }, 'kontakt');
    const th = threadOf(t); if (th) add({ type: 'mail', id: th, title: 'Mailet' }, 'mailtråd');
    (t.links || []).filter(l => l.type !== 'email' && l.link).forEach(l => add({ type: 'doc', id: l.link, title: l.description || 'Länk' }, 'länk'));
  }
  if (type === 'event') {
    const [eid, start] = String(id).split('|');
    const e = allEvents().find(x => x.id === eid && x.start === start) || allEvents().find(x => x.id === eid); if (!e) return out;
    tagsOf(e.tags).forEach(g => add({ type: 'project', id: g }, 'tagg'));
    const day = e.allDay ? e.start : ymd(new Date(e.start));
    const dtag = '#' + day.slice(2).replace(/-/g, '');
    const nt = normT(e.title);
    notes().filter(n => (n.tags || []).includes(dtag) && (nt.length > 3 && normT(n.title).includes(nt) || tagsOf(n.tags).some(g => (e.tags || []).includes(g))))
      .forEach(n => add({ type: 'note', id: n.id }, 'samma dag'));
  }
  if (type === 'note') {
    const n = (S.data?.notes || []).find(x => x.id === id); if (!n) return out;
    tagsOf(n.tags).forEach(g => add({ type: 'project', id: g }, 'tagg'));
    (n.links || []).forEach(l => { const m = noteByTitle(l); if (m) add({ type: 'note', id: m.id }, 'länkar hit'); });
    backlinks(n).forEach(m => add({ type: 'note', id: m.id }, 'bakåtlänk'));
    (n.tags || []).map(tagDate).filter(Boolean).forEach(d => allEvents().filter(e => (e.allDay ? e.start : ymd(new Date(e.start))) === d && (e.tags || []).some(g => (n.tags || []).includes(g)))
      .forEach(e => add({ type: 'event', id: eventKey(e) }, 'samma dag')));
  }
  if (type === 'person') {
    const em = String(id).toLowerCase();
    (S.data?.tasks || []).filter(t => contactOf(t)?.email.toLowerCase() === em).forEach(t => add({ type: 'task', id: t.id }, 'kontakt'));
  }
  return out;
}
const normT = s => cleanTitle(String(s || '')).toLowerCase().replace(/[^a-zåäö0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();

function itemHtml(ref, opt = {}) {
  const r = resolve(ref);
  const tag = r.attrs ? 'div' : 'a';
  const href = r.href ? ` href="${esc(r.href)}"${r.ext ? ' target="_blank" rel="noopener"' : ''}` : '';
  const sw = ref.type === 'project' ? `<i class="kp-sw" style="--tc:${tagColor(ref.id)}"></i>` : ref.type === 'person' ? `<i class="kp-av">${esc(initials(r.title))}</i>` : `<i class="kp-k">${esc(r.kind.slice(0, 1))}</i>`;
  return `<${tag} class="kp-it ${r.gone ? 'gone' : ''} ${r.attrs ? 'item' : ''}"${href} ${r.attrs || ''}>${sw}<span class="kp-t"><b>${esc(r.title)}</b><small>${esc([r.kind, r.sub, opt.why].filter(Boolean).join(' · '))}</small></span>${opt.relId ? `<button class="kp-x" data-unlink="${esc(opt.relId)}" title="Ta bort kopplingen" aria-label="Ta bort kopplingen">×</button>` : ''}</${tag}>`;
}

/** Sektionen "Kopplat" för en sak. title = sakens titel (sparas i kopplingen). */
export function relatedHtml(type, id, title = '', opt = {}) {
  const man = relationsFor(type, id);
  const seen = new Set(man.map(m => m.ref.type + '|' + m.ref.id));
  const auto = autoFor(type, id).filter(a => { const k = a.ref.type + '|' + a.ref.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const add = esc(JSON.stringify({ type, id, title: String(title).slice(0, 200) }));
  const body = (man.length || auto.length)
    ? `${man.map(m => itemHtml(m.ref, { relId: m.relId })).join('')}${auto.length ? `${man.length ? '<div class="kp-sep">Automatiskt</div>' : ''}${auto.map(a => itemHtml(a.ref, { why: a.why })).join('')}` : ''}`
    : `<p class="kp-empty">Inget kopplat än.</p>`;
  return `<section class="kp ${opt.compact ? 'compact' : ''}"><div class="kp-h"><span>Kopplat</span>${man.length + auto.length ? `<span class="n">${man.length + auto.length}</span>` : ''}<button class="kp-add" data-link-add="${add}">+ Koppla</button></div><div class="kp-b">${body}</div></section>`;
}

// ---------- väljaren ----------
function index() {
  const out = [];
  const push = (ref, title, sub, w) => out.push({ ref, t: title, s: sub, w });
  projects().filter(p => p.cfg || p.tasks.length).forEach(p => push({ type: 'project', id: p.tag, title: p.name }, p.name, p.tag, 6));
  people().forEach(p => p.email && push({ type: 'person', id: p.email.toLowerCase(), title: p.name }, p.name || p.email, [p.title, p.org].filter(Boolean).join(', ') || p.email, 5));
  (S.data?.tasks || []).forEach(t => push({ type: 'task', id: t.id, title: cleanTitle(t.title) }, cleanTitle(t.title), (t.due ? dayLabel(t.due) + ' · ' : '') + t.list, 4));
  allEvents().forEach(e => push({ type: 'event', id: eventKey(e), title: cleanTitle(e.title) }, cleanTitle(e.title), e.allDay ? shortDate(e.start) : `${dayLabel(ymd(new Date(e.start)))} ${hhmm(e.start)}`, 3));
  (S.data?.notes || []).forEach(n => push({ type: 'note', id: n.id, title: n.title }, n.title, n.folder, 3));
  (S.data?.collections || []).forEach(c => c.rows.forEach(r => { const t = String(r[c.fields[0]?.name] || '(utan namn)'); push({ type: 'row', id: c.name + ':' + r._id, title: t }, t, c.name, 3); }));
  Object.entries(S.prod || {}).forEach(([tag, pr]) => (pr.scenes || []).forEach(s => push({ type: 'scene', id: `${tag}|${s.film}|${s.scene}`, title: `${s.film} ${s.scene} ${s.heading || s.place || ''}`.trim() }, `${s.film} ${s.scene} · ${s.heading || s.place || ''}`, tag, 2)));
  return out;
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

let PICK = null, items = [], sel = 0, idx = null;
export function openLinkPicker(type, id, title = '') {
  PICK = { type, id, title };
  let d = $('#kpDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="kpDlg" class="sheet kp-dlg"><h2>Koppla till …</h2><p class="hint" id="kpWhat"></p>
      <input id="kpIn" placeholder="Sök uppgift, möte, anteckning, person, projekt, rad, scen – eller klistra in en länk" autocomplete="off">
      <div class="kp-res" id="kpRes"></div><div class="actions"><span class="spacer"></span><button class="ghost" id="kpClose">Stäng</button></div></dialog>`);
    d = $('#kpDlg');
    $('#kpClose').onclick = () => d.close();
    $('#kpIn').addEventListener('input', () => { sel = 0; draw(); });
    $('#kpIn').addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    });
    $('#kpRes').addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) choose(Number(r.dataset.i)); });
  }
  idx = null;
  $('#kpWhat').textContent = title ? `Från: ${title}` : '';
  $('#kpIn').value = ''; sel = 0; draw();
  if (!d.open) d.showModal();
  setTimeout(() => $('#kpIn').focus(), 30);
}
function draw() {
  const q = $('#kpIn').value.trim();
  if (/^https?:\/\//.test(q)) items = [{ ref: { type: 'doc', id: q, title: q.replace(/^https?:\/\//, '').slice(0, 60) }, t: q, s: 'Länk' }];
  else if (!q) items = [];
  else {
    idx ||= index();
    const w = norm(q).split(/\s+/).filter(Boolean), self = PICK.type + '|' + PICK.id;
    items = idx.filter(x => x.ref.type + '|' + x.ref.id !== self).map(x => {
      const T = norm(x.t), B = norm(x.s);
      if (!w.every(v => T.includes(v) || B.includes(v))) return null;
      return { ...x, sc: x.w + (T.startsWith(w[0]) ? 10 : T.includes(' ' + w[0]) ? 6 : 3) };
    }).filter(Boolean).sort((a, b) => b.sc - a.sc).slice(0, 30);
  }
  sel = Math.min(sel, Math.max(0, items.length - 1));
  $('#kpRes').innerHTML = items.map((x, i) => `<div class="pres ${i === sel ? 'on' : ''}" data-i="${i}"><span class="k">${esc(TYPE_LABEL[x.ref.type] || x.ref.type)}</span><span class="t">${esc(x.t)}</span><span class="s">${esc(x.s || '')}</span></div>`).join('')
    || `<p class="empty" style="padding:10px 4px">${q ? 'Inget hittades.' : 'Skriv för att söka.'}</p>`;
  $('#kpRes').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
async function choose(i) {
  const x = items[i]; if (!x || !PICK) return;
  const a = { type: PICK.type, id: String(PICK.id), title: PICK.title }, b = { type: x.ref.type, id: String(x.ref.id), title: x.ref.title || x.t };
  $('#kpDlg').close();
  const tmp = { id: 'tmp' + Date.now(), a, b };
  (S.data.relations ||= []).push(tmp); emit('render');
  try { const r = await api('link', { a, b }, true); tmp.id = r.id; toast('Kopplat'); emit('render'); }
  catch (e) { S.data.relations = S.data.relations.filter(r => r !== tmp); emit('render'); toast('Kunde inte koppla – ' + e.message); }
}

/** Koppla programmatiskt (t.ex. uppgifter som skapas från ett möte). */
export async function linkItems(a, b) {
  const tmp = { id: 'tmp' + Date.now() + Math.random(), a, b };
  (S.data.relations ||= []).push(tmp);
  try { const r = await api('link', { a, b }, true); tmp.id = r.id; } catch { S.data.relations = S.data.relations.filter(r => r !== tmp); }
}

// ---------- klick (en gång, fungerar var som helst) ----------
let bound = false;
function bindOnce() {
  if (bound) return; bound = true;
  document.addEventListener('click', async e => {
    const add = e.target.closest('[data-link-add]');
    if (add) { e.preventDefault(); e.stopPropagation(); try { const o = JSON.parse(add.dataset.linkAdd); openLinkPicker(o.type, o.id, o.title); } catch {} return; }
    const x = e.target.closest('[data-unlink]');
    if (x) {
      e.preventDefault(); e.stopPropagation();
      const id = x.dataset.unlink, keep = S.data.relations || [];
      if (id.startsWith('tmp')) return toast('Sparar fortfarande – försök igen om en sekund');
      S.data.relations = keep.filter(r => r.id !== id); emit('render');
      try { await api('unlink', { id }, true); toast('Kopplingen borttagen'); }
      catch (err) { S.data.relations = keep; emit('render'); toast('Kunde inte ta bort – ' + err.message); }
    }
  }, true);
}
bindOnce();
