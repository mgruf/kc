/* KC – skal: navigering, rendering, globala klick, kortkommandon, drag. */
import {
  S, store, refresh, weather, on, emit, go, parseRoute, $, $$, esc, toast, sources, merge,
  fireCount, projects, tagColor, isFire, isWaitingLong, claudeUrl, visible, loadContacts,
} from './core.js';
import { initDialogs, openTask, openEvent, openAdd, openSetup, toggleDone } from './ui.js';
import { openPalette } from './search.js';
import * as idag from './views/idag.js';
import * as kalender from './views/kalender.js';
import * as uppgifter from './views/uppgifter.js';
import * as anteckningar from './views/anteckningar.js';
import * as personer from './views/personer.js';
import * as projekt from './views/projekt.js';
import * as samling from './views/samling.js';
import * as horisont from './views/horisont.js';
import * as mote from './views/mote.js';
import * as vecka from './views/vecka.js';
import * as mall from './views/mall.js';
import * as plan from './views/plan.js';
import { contractFire } from './views/team.js';
import { delegationFire } from './plan.js';
import { mailFireItems, loadWaiting } from './mejl.js';
import './kopplat.js';
import { FIRE_EXTRA } from './core.js';
FIRE_EXTRA.push(mailFireItems);
FIRE_EXTRA.push(() => contractFire().map(x => ({ kind: 'warn', w: { name: x.text || x.name || 'Avtal saknas', text: 'Avtal', url: x.url || ('#/projekt/' + encodeURIComponent(x.tag || '') + '/team') }, p: { name: x.projectName || x.tag || '', tag: x.tag || '', mode: 'jobb' }, ctx: x.text || '' })));
FIRE_EXTRA.push(() => delegationFire().map(t => ({ kind: 'task', t, ctx: `Stäm av: ${t.title}` })));

const VIEWS = {
  idag, kalender, uppgifter, horisont,
  anteckningar, anteckning: anteckningar,
  personer, person: personer,
  projekt, samling, mote, vecka, mall, plan,
};

// ---------- navigering ----------
function navHtml() {
  const r = S.route, v = r.view;
  const n = S.data ? fireCount() : 0;
  const link = (href, label, ic, on, extra = '') => `<a href="#/${href}" class="${on ? 'on' : ''}"><span class="ic">${ic}</span>${esc(label)}${extra}</a>`;
  const ps = S.data ? projects().filter(visible).filter(p => p.cfg || p.tasks.length) : [];
  const colls = (S.data?.collections || []).filter(c => c.name !== 'Projekt');
  return [
    link('idag', 'Idag', '◐', v === 'idag', n ? `<span class="cnt" style="color:var(--fire)">${n}</span>` : ''),
    link('kalender', 'Kalender', '▦', v === 'kalender'),
    link('uppgifter', 'Uppgifter', '○', v === 'uppgifter', S.data ? `<span class="cnt">${(S.data.tasks || []).filter(visible).length}</span>` : ''),
    link('anteckningar', 'Anteckningar', '≡', v === 'anteckningar' || v === 'anteckning'),
    link('personer', 'Personer', '◎', v === 'personer' || v === 'person'),
    link('horisont', 'Horisont', '→', v === 'horisont'),
    link('plan', 'Produktionsplan', '▭', v === 'plan'),
    link('vecka', 'Veckan', '◇', v === 'vecka'),
    link('mall', 'Mallar', '⧉', v === 'mall'),
    `<div class="grp"><span>Projekt</span><button data-newproject title="Nytt projekt">+</button></div>`,
    ...ps.map(p => link('projekt/' + encodeURIComponent(p.tag), p.name, `<i class="sw" style="--tc:${tagColor(p.tag)}"></i>`, v === 'projekt' && r.args[0] === p.tag, p.fire.length ? '<span class="dot"></span>' : '')),
    link('projekt', 'Alla projekt', '', v === 'projekt' && !r.args[0]),
    `<div class="grp"><span>Samlingar</span><button data-newcoll title="Ny samling">+</button></div>`,
    ...colls.map(c => link('samling/' + encodeURIComponent(c.name), c.name, '▤', v === 'samling' && r.args[0] === c.name, `<span class="cnt">${c.rows.length}</span>`)),
    link('samling/Projekt', 'Projektregister', '▤', v === 'samling' && r.args[0] === 'Projekt'),
  ].join('');
}

let lastView = null;
function render() {
  const r = S.route;
  $$('.mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  $('#otherToggle').textContent = S.other === 'dolj' ? 'Dolt' : 'Tonat';
  $('#otherToggle').title = `${S.mode === 'jobb' ? 'Privat' : 'Jobb'} visas ${S.other === 'dolj' ? 'inte alls' : 'nedtonat'} (D)`;
  $('#nav').innerHTML = navHtml();
  const mobileMap = { anteckning: 'mer', anteckningar: 'mer', personer: 'mer', person: 'mer', samling: 'mer', horisont: 'mer' };
  $$('#tabs [data-v]').forEach(a => a.classList.toggle('on', a.dataset.v === (mobileMap[r.view] || r.view)));
  const n = S.data ? fireCount() : 0;
  const badge = $('#fireBadge'); badge.hidden = !n; badge.textContent = n;
  const view = VIEWS[r.view] || idag;
  const el = $('#view');
  if (lastView !== r.view + '/' + r.args.join('/')) { el.className = 'view v-' + r.view; lastView = r.view + '/' + r.args.join('/'); }
  // Skriver man i en textruta i vyn ritas den inte om (bakgrundshämtningar skulle annars sudda texten).
  const ae = document.activeElement;
  if (ae && ae.tagName === 'TEXTAREA' && el.contains(ae) && lastView === r.view + '/' + r.args.join('/') && el.dataset.drawn === lastView) return;
  el.dataset.drawn = lastView;
  try { view.render(el, r.args, r.view); }
  catch (e) { console.error(e); el.innerHTML = `<div class="vhead"><h1>Något gick fel</h1></div><p class="empty">${esc(e.message)}</p>`; }
  $('#claudeBtn').href = claudeUrl(view.context ? view.context(r.args) : idag.context());
}
on('render', render);
on('route', () => { parseRoute(); render(); window.scrollTo(0, 0); });
on('setup', () => openSetup());
window.addEventListener('hashchange', () => emit('route'));

// ---------- globala klick ----------
document.addEventListener('click', async ev => {
  const t = ev.target;
  const tg = t.closest('[data-tag]');
  if (tg && !t.closest('dialog')) { ev.preventDefault(); ev.stopPropagation(); return go('projekt/' + encodeURIComponent(tg.dataset.tag)); }
  const b = t.closest('button, a, h2, .item, [data-open]');
  if (!b) return;
  if (b.matches('.mode button')) { S.mode = b.dataset.mode; store.set('mode', S.mode); return render(); }
  if (b.id === 'otherToggle') { S.other = S.other === 'dolj' ? 'ton' : 'dolj'; store.set('other', S.other); return render(); }
  if (b.id === 'addBtn') return openAdd(S.route.view === 'kalender' ? 'event' : 'task');
  if (b.id === 'searchBtn') return openPalette();
  if (b.id === 'moreBtn') return openMore();
  if (b.matches('[data-newproject]')) return mall.openNewProject();
  if (b.matches('[data-newcoll]')) return go('samling/_ny');
  if (b.matches('.sec > h2') && !t.closest('.act')) { const s = b.parentElement, id = s.dataset.sec; S.closed[id] = !s.classList.contains('closed'); store.set('closed', S.closed); s.classList.toggle('closed'); return; }
  if (b.matches('.check')) { ev.preventDefault(); return toggleDone(b.closest('[data-task]').dataset.task); }
  if (b.matches('.item[data-task]') && !t.closest('a')) return openTask(b.dataset.task);
  if (b.matches('.item[data-ev]') && !t.closest('a')) return openEvent(b.dataset.ev, b.dataset.evs);
  if (b.matches('a') && b.closest('.moresheet')) $('#moreDlg')?.close();
});

// Synktiden: håll inne för att koppla källor
let pressT;
document.addEventListener('pointerdown', e => { if (e.target.closest('#sync')) pressT = setTimeout(openSetup, 700); });
document.addEventListener('pointerup', () => clearTimeout(pressT));

// ---------- drag: uppgifter kan dras till kalendern ----------
document.addEventListener('dragstart', e => {
  const r = e.target.closest?.('[data-task]');
  if (r) { e.dataTransfer.setData('text/kc-task', r.dataset.task); e.dataTransfer.effectAllowed = 'copyMove'; r.classList.add('dragging'); }
});
document.addEventListener('dragend', e => e.target.closest?.('[data-task]')?.classList.remove('dragging'));

// ---------- kortkommandon ----------
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, dialog, [contenteditable]') || !$('#palette').hidden) return;
  const k = e.key.toLowerCase();
  const nav = { '1': 'idag', '2': 'kalender', '3': 'uppgifter', '4': 'anteckningar', '5': 'personer', '6': 'projekt', '7': 'horisont' }[k];
  if (nav) return go(nav);
  if (k === '/' ) { e.preventDefault(); return openPalette(); }
  if (k === 'n') { e.preventDefault(); return openAdd(S.route.view === 'kalender' ? 'event' : 'task'); }
  if (k === 'j' || k === 'p') { S.mode = k === 'j' ? 'jobb' : 'privat'; store.set('mode', S.mode); return render(); }
  if (k === 'd') { S.other = S.other === 'dolj' ? 'ton' : 'dolj'; store.set('other', S.other); return render(); }
  if (k === 'r') return refresh();
  if (k === 'c') return window.open($('#claudeBtn').href, '_blank');
  const view = VIEWS[S.route.view]; if (view?.key) view.key(e, S.route.args);
});

// ---------- Mer (mobil) ----------
function openMore() {
  let d = $('#moreDlg');
  if (!d) { document.body.insertAdjacentHTML('beforeend', '<dialog id="moreDlg" class="sheet moresheet"><div class="modebar" id="moreMode"></div><button class="search" data-close>Sök och hoppa</button><nav class="nav" id="moreNav"></nav><div class="actions"><button class="ghost" data-setup>Koppla källor</button><span class="spacer"></span><button class="ghost" data-close>Stäng</button></div></dialog>'); d = $('#moreDlg');
    d.addEventListener('click', e => { if (e.target.closest('[data-close]')) { d.close(); if (e.target.closest('.search')) openPalette(); } if (e.target.closest('[data-setup]')) { d.close(); openSetup(); } if (e.target === d) d.close(); });
  }
  $('#moreMode').innerHTML = $('.side .modebar').innerHTML;
  $('#moreNav').innerHTML = navHtml();
  d.showModal();
}

// ---------- start ----------
initDialogs();
parseRoute();
merge();
render();
weather();
refresh().then(() => { weather(); try { loadWaiting(); } catch {} });
loadContacts();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); weather(); } });
setInterval(() => { if (!document.hidden) refresh(); }, 5 * 60e3);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
