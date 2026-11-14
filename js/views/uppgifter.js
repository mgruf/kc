/* UPPGIFTER – Google Tasks som databas: lista, tavla och tabell, grupperat och filtrerat. */
import {
  S, api, emit, refresh, $, $$, esc, toast, ymd, addDays, todayStr, monday, dayLabel, shortDate,
  tasks, cleanTitle, tagHtml, contactOf, mailHref, initials, firstName, knownTags, tagColor, isFire, isWaitingLong, projects, go,
} from '../core.js';
import { taskRow, section, empty, head, seg, pref, setPref, openTask } from '../ui.js';

const GROUPS = [['datum', 'Datum'], ['lista', 'Lista'], ['projekt', 'Projekt'], ['person', 'Person']];

function dateBucket(t) {
  const today = todayStr();
  if (!t.due) return t.waiting ? ['9', 'Väntar på andra'] : ['8', 'Utan datum'];
  if (t.due < today) return ['0', 'Förfallet'];
  if (t.due === today) return ['1', 'Idag'];
  if (t.due === ymd(addDays(new Date(), 1))) return ['2', 'Imorgon'];
  if (t.due <= ymd(addDays(monday(new Date()), 6))) return ['3', 'Resten av veckan'];
  if (t.due <= ymd(addDays(monday(new Date()), 13))) return ['4', 'Nästa vecka'];
  return ['5', 'Senare'];
}
function groupOf(t, by) {
  if (by === 'datum') return [dateBucket(t)];
  if (by === 'lista') return [[t.list, t.list]];
  if (by === 'projekt') { const g = (t.tags || []).filter(x => !/^#\d{6}$/.test(x)); return g.length ? g.map(x => [x, projects().find(p => p.tag === x)?.name || x.slice(1)]) : [['~', 'Utan projekt']]; }
  if (by === 'person') { const c = contactOf(t); return [c ? [c.email.toLowerCase(), c.name] : ['~', 'Ingen kontakt']]; }
}

export function render(el) {
  const view = pref('t_view', 'lista'), by = pref('t_group', 'datum'), f = pref('t_filter', ''), q = pref('t_q', '');
  let list = tasks();
  if (f) list = list.filter(t => (t.tags || []).includes(f));
  if (q) { const s = q.toLowerCase(); list = list.filter(t => (t.title + ' ' + t.notes + ' ' + t.list).toLowerCase().includes(s)); }
  const tags = knownTags();
  const tools = `<div class="toolbar">
      ${seg('t_view', [['lista', 'Lista'], ['tavla', 'Tavla'], ['tabell', 'Tabell']], view)}
      ${view !== 'tavla' ? `<label class="tsel">Gruppera ${`<select data-pref="t_group">${GROUPS.map(([v, l]) => `<option value="${v}" ${v === by ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</label>` : ''}
      <input class="tsearch" data-pref="t_q" value="${esc(q)}" placeholder="Filtrera…">
    </div>
    <div class="chips filters"><button class="chip ${!f ? 'on' : ''}" data-tf="">Alla</button>${tags.map(g => `<button class="chip ${f === g ? 'on' : ''}" data-tf="${esc(g)}">${esc(projects().find(p => p.tag === g)?.name || g.slice(1))}</button>`).join('')}</div>`;
  let body = '';
  if (!S.data) body = empty('Ingen data än.');
  else if (view === 'tavla') body = board(list);
  else if (view === 'tabell') body = table(list);
  else body = grouped(list, by);
  el.innerHTML = head('Uppgifter', `${list.length} öppna${f ? ' i ' + esc(f.slice(1)) : ''}`, `<button class="btn solid" data-newtask>+ Ny uppgift</button>`) + tools + body;
  bind(el);
}

function grouped(list, by) {
  const g = {};
  list.forEach(t => groupOf(t, by).forEach(([k, label]) => (g[k] ||= { k, label, items: [] }).items.push(t)));
  const order = Object.values(g).sort((a, b) => by === 'datum' ? a.k.localeCompare(b.k) : a.k === '~' ? 1 : b.k === '~' ? -1 : a.label.localeCompare(b.label, 'sv'));
  if (!order.length) return empty('Inga uppgifter här.');
  return order.map(gr => {
    gr.items.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const fire = gr.label === 'Förfallet' ? 'fire' : '';
    return section('tg_' + by + '_' + gr.k, esc(gr.label), gr.items.length, gr.items.map(t => taskRow(t, { noList: by === 'lista' })).join(''), fire);
  }).join('');
}

function board(list) {
  const lists = (S.data.taskLists || []).filter(l => l.mode === S.mode || S.other !== 'dolj');
  return `<div class="board">${lists.map(l => {
    const items = list.filter(t => t.listId === l.id).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    return `<div class="kcol" data-list="${esc(l.id)}" data-src="${esc(l._src)}"><div class="kh"><span>${esc(l.title)}</span><span class="n">${items.length}</span></div>
      <div class="kbody">${items.map(card).join('')}<button class="kadd" data-newtask-list="${esc(l.id)}">+ Ny</button></div></div>`;
  }).join('')}</div>`;
}
function card(t) {
  const c = contactOf(t), mh = mailHref(t);
  return `<div class="kcard item task ${isFire(t) || isWaitingLong(t) ? 'fire' : ''} ${S.done[t.id] ? 'done' : ''}" data-task="${esc(t.id)}" draggable="true">
    <div class="ktop"><button class="check" aria-label="Bocka av"></button><div class="title">${esc(cleanTitle(t.title))}</div></div>
    <div class="sub">${t.due ? `<span class="due">${esc(dayLabel(t.due))}</span>` : ''}<span class="tags" style="margin-left:${t.due ? 7 : 0}px">${tagHtml(t.tags)}</span>${c ? `<a class="pchip" href="#/person/${encodeURIComponent(c.email.toLowerCase())}"><i>${esc(initials(c.name))}</i>${esc(firstName(c.name))}</a>` : ''}${mh ? `<a class="mchip" href="${esc(mh)}">Mailet</a>` : ''}</div>
  </div>`;
}

function table(list) {
  const rows = list.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  return `<div class="tscroll"><table class="ttable"><thead><tr><th></th><th>Uppgift</th><th>Datum</th><th>Lista</th><th>Projekt</th><th>Kontakt</th><th></th></tr></thead><tbody>
    ${rows.map(t => { const c = contactOf(t), mh = mailHref(t); return `<tr class="item task ${isFire(t) ? 'fire' : ''} ${S.done[t.id] ? 'done' : ''}" data-task="${esc(t.id)}" draggable="true">
      <td><button class="check"></button></td><td class="title">${esc(cleanTitle(t.title))}</td>
      <td class="tnum ${isFire(t) ? 'firetext' : ''}">${t.due ? esc(shortDate(t.due)) : ''}</td><td>${esc(t.list)}</td><td>${tagHtml(t.tags)}</td>
      <td>${c ? `<a class="pchip" style="margin:0" href="#/person/${encodeURIComponent(c.email.toLowerCase())}"><i>${esc(initials(c.name))}</i>${esc(c.name)}</a>` : ''}</td>
      <td>${mh ? `<a class="mchip" style="margin:0" href="${esc(mh)}">Mailet</a>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}

function bind(el) {
  el.querySelectorAll('[data-segname="t_view"] [data-seg]').forEach(b => b.onclick = () => { setPref('t_view', b.dataset.seg); emit('render'); });
  el.querySelectorAll('[data-tf]').forEach(b => b.onclick = () => { setPref('t_filter', b.dataset.tf); emit('render'); });
  el.querySelector('[data-pref="t_group"]')?.addEventListener('change', e => { setPref('t_group', e.target.value); emit('render'); });
  const s = el.querySelector('[data-pref="t_q"]');
  if (s) { s.oninput = () => { setPref('t_q', s.value); clearTimeout(s._t); s._t = setTimeout(() => { const pos = s.selectionStart; emit('render'); const n = el.querySelector('[data-pref="t_q"]'); n.focus(); n.setSelectionRange(pos, pos); }, 250); }; }
  el.querySelector('[data-newtask]')?.addEventListener('click', () => openTask(null, { tag: pref('t_filter', '') || undefined }));
  el.querySelectorAll('[data-newtask-list]').forEach(b => b.onclick = () => openTask(null, { listId: b.dataset.newtaskList, tag: pref('t_filter', '') || undefined }));
  // Tavla: dra kort mellan listor
  el.querySelectorAll('.kcol').forEach(col => {
    col.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/kc-task')) { e.preventDefault(); col.classList.add('dropzone'); } });
    col.addEventListener('dragleave', () => col.classList.remove('dropzone'));
    col.addEventListener('drop', async e => {
      e.preventDefault(); col.classList.remove('dropzone');
      const id = e.dataTransfer.getData('text/kc-task'); const t = (S.data.tasks || []).find(x => x.id === id);
      if (!t || t.listId === col.dataset.list) return;
      if (t._src !== col.dataset.src) return toast('Kan inte flytta mellan jobb och privat');
      const before = { listId: t.listId, list: t.list };
      const l = S.data.taskLists.find(x => x.id === col.dataset.list);
      Object.assign(t, { listId: l.id, list: l.title, pending: true }); emit('render');
      try { await api('updateTask', { listId: before.listId, taskId: t.id, newListId: l.id }, true, t._src); t.pending = false; toast('Flyttad till ' + l.title); refresh(); }
      catch (err) { Object.assign(t, before, { pending: false }); emit('render'); toast('Kunde inte flytta – ' + err.message); }
    });
  });
}

export function context() {
  const f = pref('t_filter', '');
  const list = tasks().filter(t => !f || (t.tags || []).includes(f)).slice(0, 40);
  return `Mina öppna uppgifter${f ? ' i ' + f : ''}:\n` + list.map(t => `- ${t.title}${t.due ? ' (' + t.due + ')' : ''} [${t.list}]`).join('\n');
}
export function key(e) {
  if (e.key === 'l') { setPref('t_view', 'lista'); emit('render'); }
  if (e.key === 't') { setPref('t_view', 'tavla'); emit('render'); }
}
