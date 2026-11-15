/* PERSONER – Google Kontakter som persondatabas, med allt KC vet om varje person. */
import {
  S, api, emit, $, esc, toast, people, personByKey, tasksFor, initials, firstName, loadContacts, notes, events, tagHtml, tagColor,
  personIn, projects, cleanTitle, claudeUrl, relTime, shortDate, ymd,
} from '../core.js';
import { taskRow, eventRow, noteRow, section, empty, head, pref, setPref, openTask } from '../ui.js';
import { personProjects } from './team.js';
import { relatedHtml } from '../kopplat.js';

const av = (p, size = 36) => `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .36)}px">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name))}</span>`;

export function render(el, args, view) {
  if (!S.contacts) loadContacts();
  if (view === 'person' && args[0]) return page(el, decodeURIComponent(args[0]));
  list(el);
}

function list(el) {
  const q = pref('p_q', ''), lab = pref('p_label', '');
  let ps = people();
  const labels = [...new Set(ps.flatMap(p => p.labels || []))].sort((a, b) => a.localeCompare(b, 'sv'));
  if (lab) ps = ps.filter(p => (p.labels || []).includes(lab));
  if (q) { const s = q.toLowerCase(); ps = ps.filter(p => [p.name, p.email, p.org, p.title, ...(p.phones || []), ...(p.labels || [])].join(' ').toLowerCase().includes(s)); }
  const withTasks = new Set((S.data?.tasks || []).map(t => (/Kontakt:\s*.*<([^>]+)>/.exec(t.notes || '') || [])[1]).filter(Boolean).map(x => x.toLowerCase()));
  const groups = {};
  ps.forEach(p => { const L = (p.name || '?')[0].toUpperCase(); (groups[L] ||= []).push(p); });
  const err = S.contacts?.error;
  el.innerHTML = head('Personer', S.contacts ? `${people().length} personer${S.contacts.list?.length ? ' · Google Kontakter' : ''}` : 'Hämtar kontakter…', `<button class="btn solid" data-newperson>+ Ny kontakt</button>`) +
    (err ? `<div class="notice">Kontakterna kunde inte hämtas (${esc(err)}). Lägg till tjänsten <b>People API</b> i Apps Script, kör setup och gör en ny version. Personer från uppgifternas kontaktrader visas ändå.</div>` : '') +
    `<div class="toolbar"><input class="tsearch wide" data-pq value="${esc(q)}" placeholder="Sök namn, e-post, företag, roll…"></div>
     ${labels.length ? `<div class="chips filters"><button class="chip ${!lab ? 'on' : ''}" data-pl="">Alla</button>${labels.map(l => `<button class="chip ${l === lab ? 'on' : ''}" data-pl="${esc(l)}">${esc(l)}</button>`).join('')}</div>` : ''}
     <div class="plist">${Object.keys(groups).sort((a, b) => a.localeCompare(b, 'sv')).map(L => `<div class="pletter">${esc(L)}</div>` + groups[L].slice(0, 300).map(p => `
       <a class="prow" href="#/person/${encodeURIComponent(p.key)}">${av(p)}<div class="main"><div class="title">${esc(p.name || p.email)}${withTasks.has(p.email) ? '<span class="dotmark" title="Har öppna uppgifter"></span>' : ''}</div>
         <div class="sub">${[p.title, p.org].filter(Boolean).map(esc).join(', ') || esc(p.email || '')}${(p.labels || []).length ? `<span class="tags">${p.labels.slice(0, 4).map(l => `<span class="tag" style="--tc:${tagColor(l.split(' ')[0])}">${esc(l)}</span>`).join('')}</span>` : ''}</div></div></a>`).join('')).join('') || empty('Inga personer matchar.')}</div>`;
  const s = el.querySelector('[data-pq]');
  s.oninput = () => { setPref('p_q', s.value); clearTimeout(s._t); s._t = setTimeout(() => { const p = s.selectionStart; emit('render'); const n = el.querySelector('[data-pq]'); n.focus(); n.setSelectionRange(p, p); }, 200); };
  el.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { setPref('p_label', b.dataset.pl); emit('render'); });
  el.querySelector('[data-newperson]').onclick = () => editContact(null);
}

function page(el, key) {
  const p = personByKey(key) || (key.includes('@') ? { id: null, name: key, email: key, emails: [key], phones: [], labels: [], key } : null);
  if (!p) { el.innerHTML = head('Personen hittades inte') + (S.contacts ? '' : empty('Hämtar kontakter…')); return; }
  const em = (p.emails || [p.email]).map(x => String(x).toLowerCase());
  const ts = em.flatMap(e => tasksFor(e));
  const nameRe = p.name && p.name.includes(' ') ? new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const ns = notes().filter(n => em.some(e => (n.excerpt || '').toLowerCase().includes(e)) || (nameRe && (nameRe.test(n.title) || nameRe.test(n.excerpt || '')))).slice(0, 20);
  const evs = nameRe ? events().filter(e => nameRe.test(e.title) || nameRe.test(e.description || '')).slice(0, 20) : [];
  const roles = Object.entries(S.prod).flatMap(([tag, pr]) => (pr.roles || []).filter(r => r.actor && nameRe && nameRe.test(r.actor)).map(r => ({ tag, r })));
  const rows = (S.data?.collections || []).flatMap(c => c.fields.filter(f => f.type === 'person').flatMap(f => c.rows.filter(r => { const x = personIn(r[f.name]); return x && em.includes(x.email.toLowerCase()); }).map(r => ({ c, r, f }))));
  const projTags = [...new Set([...(p.labels || []).map(l => (l.match(/#[0-9A-Za-zÅÄÖåäö_-]+/) || [])[0]).filter(Boolean), ...ts.flatMap(t => t.tags || [])])].filter(t => !/^#\d{6}$/.test(t));
  el.innerHTML = `<div class="crumb"><a href="#/personer">Personer</a></div>
    <div class="phero">${av(p, 64)}<div><h1>${esc(p.name || p.email)}</h1><div class="vsub">${[p.title, p.org].filter(Boolean).map(esc).join(', ')}</div>
      <div class="pmeta">${(p.emails || []).map(e => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join('')}${(p.phones || []).map(t => `<a href="tel:${esc(t.replace(/\s/g, ''))}">${esc(t)}</a>`).join('')}</div>
      <div class="chips plabels">${(p.labels || []).map(l => `<span class="chip lab">${esc(l)}${p.id ? ` <button data-unlabel="${esc(l)}" title="Ta bort etiketten">×</button>` : ''}</span>`).join('')}${p.id ? `<button class="chip" data-addlabel>+ Etikett / roll</button>` : ''}</div>
    </div><div class="vact">${p.id ? '<button class="btn" data-edit>Redigera</button>' : '<button class="btn" data-save>Spara som kontakt</button>'}<button class="btn solid" data-ptask>+ Uppgift</button><a class="btn" href="${claudeUrl(`Person: ${p.name} <${p.email}>${p.org ? ', ' + p.org : ''}\nÖppna uppgifter:\n` + ts.map(t => '- ' + t.title).join('\n'))}" target="_blank" rel="noopener">Fråga Claude</a></div></div>
    ${p.notes ? `<div class="pnote">${esc(p.notes)}</div>` : ''}
    <div class="pgrid"><div>
      ${personProjects(p)}
      ${section('ptasks', 'Öppna uppgifter', ts.length, ts.length ? ts.map(t => taskRow(t)).join('') : empty('Inga öppna uppgifter.'))}
      ${roles.length ? section('proles', 'Roller i produktion', roles.length, roles.map(({ tag, r }) => `<a class="item" href="#/projekt/${encodeURIComponent(tag)}/produktion/roller"><div class="glyph">◆</div><div class="main"><div class="title">${esc(r.name)} <span class="tags">${tagHtml([tag])}</span></div><div class="sub">${r.days} dagar<i class="sep">·</i>${esc(shortDate(r.first))}–${esc(shortDate(r.last))}</div></div></a>`).join('')) : ''}
      ${rows.length ? section('prows', 'I samlingar', rows.length, rows.map(({ c, r }) => `<a class="item" href="#/samling/${encodeURIComponent(c.name)}/${encodeURIComponent(r._id)}"><div class="glyph">▤</div><div class="main"><div class="title">${esc(r[c.fields[0]?.name] || '(utan namn)')}</div><div class="sub">${esc(c.name)}</div></div></a>`).join('')) : ''}
    </div><div>
      ${projTags.length ? section('pproj', 'Projekt', projTags.length, `<div class="chips">${tagHtml(projTags)}</div>`) : ''}
      ${evs.length ? section('pevs', 'I kalendern', evs.length, evs.map(e => eventRow(e, { day: true })).join('')) : ''}
      ${section('pnotes', 'Anteckningar', ns.length, ns.length ? ns.map(noteRow).join('') : empty('Inga anteckningar nämner personen.'))}
      ${p.email ? section('pmail', 'Mejl', null, `<div data-mailbox='${esc(JSON.stringify({ emails: (p.emails || [p.email]).filter(Boolean) }))}'><p class="empty">Hämtar mejl…</p></div>`) : ''}
      ${relatedHtml('person', p.email || p.key, p.name)}
    </div></div>`;
  el.querySelector('[data-ptask]').onclick = () => openTask(null, { contact: { name: p.name, email: p.email } });
  el.querySelector('[data-edit]')?.addEventListener('click', () => editContact(p));
  el.querySelector('[data-save]')?.addEventListener('click', () => editContact({ ...p, id: null }));
  el.querySelector('[data-addlabel]')?.addEventListener('click', () => addLabel(p));
  el.querySelectorAll('[data-unlabel]').forEach(b => b.onclick = () => setLabel(p, b.dataset.unlabel, false));
}

async function addLabel(p) {
  const tags = projects().filter(x => x.cfg).map(x => x.tag);
  const l = prompt(`Etikett, t.ex. projekt och roll:\n${tags.map(t => t + ' · Foto').slice(0, 3).join('\n')}`, tags[0] ? tags[0] + ' · ' : '');
  if (l && l.trim()) setLabel(p, l.trim(), true);
}
async function setLabel(p, label, on) {
  const c = (S.contacts?.list || []).find(x => x.id === p.id);
  if (c) { c.labels = on ? [...new Set([...(c.labels || []), label])] : (c.labels || []).filter(x => x !== label); emit('render'); }
  try { await api('labelContact', { id: p.id, label, on }, true); toast(on ? 'Etikett tillagd' : 'Etikett borttagen'); }
  catch (e) { toast('Kunde inte ändra – ' + e.message); loadContacts(true); }
}

// ---------- redigera kontakt ----------
function editContact(p) {
  let d = $('#personDlg');
  if (!d) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="personDlg" class="sheet"><form id="personForm">
      <h2 id="pdTitle">Kontakt</h2>
      <input id="pdName" class="big-input" placeholder="Namn" required autocomplete="off">
      <input id="pdEmail" type="email" placeholder="E-post" autocomplete="off">
      <input id="pdPhone" placeholder="Telefon" autocomplete="off">
      <div class="row"><input id="pdTitleF" placeholder="Titel / roll"><input id="pdOrg" placeholder="Företag"></div>
      <textarea id="pdNotes" rows="4" placeholder="Anteckning"></textarea>
      <p class="hint">Sparas i Google Kontakter på jobbkontot och syns i MailPro och telefonen.</p>
      <div class="actions"><span class="spacer"></span><button type="button" class="ghost" id="pdCancel">Avbryt</button><button type="submit">Spara</button></div></form></dialog>`);
    d = $('#personDlg');
    $('#pdCancel').onclick = () => d.close();
    $('#personForm').onsubmit = async ev => {
      ev.preventDefault();
      const cur = d._p || {};
      const contact = { id: cur.id || null, name: $('#pdName').value.trim(), emails: [$('#pdEmail').value.trim(), ...(cur.emails || []).slice(1)].filter(Boolean), phones: [$('#pdPhone').value.trim(), ...(cur.phones || []).slice(1)].filter(Boolean), title: $('#pdTitleF').value.trim(), org: $('#pdOrg').value.trim(), notes: $('#pdNotes').value };
      d.close();
      try { const r = await api('saveContact', { contact }, true); toast('Sparat'); await loadContacts(true); location.hash = '#/person/' + encodeURIComponent((r.contact.emails[0] || r.contact.id).toLowerCase()); }
      catch (e) { toast('Kunde inte spara – ' + e.message); }
    };
  }
  d._p = p || {};
  $('#pdTitle').textContent = p?.id ? 'Redigera kontakt' : 'Ny kontakt';
  $('#pdName').value = p?.name || ''; $('#pdEmail').value = (p?.emails || [p?.email])[0] || ''; $('#pdPhone').value = (p?.phones || [])[0] || '';
  $('#pdTitleF').value = p?.title || ''; $('#pdOrg').value = p?.org || ''; $('#pdNotes').value = p?.notes || '';
  d.showModal();
}

export function context(args) {
  const p = args[0] && personByKey(decodeURIComponent(args[0]));
  if (!p) return 'Mina kontakter.';
  return `Person: ${p.name} <${p.email}>\n` + tasksFor(p.email).map(t => '- Uppgift: ' + t.title).join('\n');
}
