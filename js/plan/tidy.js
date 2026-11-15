/* KC: städar planens verktygsrad. Sällan använda verktyg flyttas in i en "Mer"-meny (knapparna flyttas, så
   deras lyssnare följer med). Syns bara inbäddad i KC. */
const $ = s => document.querySelector(s);
function tidy() {
  const bar = $('#planview .toolbar'); if (!bar || $('#kcMore')) return;
  const wrap = document.createElement('span'); wrap.className = 'kc-more';
  wrap.innerHTML = '<button class="btn small" id="kcMore" type="button" aria-haspopup="menu" aria-expanded="false">Mer ▾</button><div class="kc-menu" id="kcMenu" role="menu" hidden></div>';
  bar.appendChild(wrap);
  const menu = wrap.querySelector('#kcMenu');
  const sec = (title, ids) => {
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    const h = document.createElement('div'); h.className = 'kc-mh'; h.textContent = title; menu.appendChild(h);
    const g = document.createElement('div'); g.className = 'kc-mg'; els.forEach(e => g.appendChild(e)); menu.appendChild(g);
  };
  const grp = id => document.getElementById(id)?.closest('.tgroup');
  sec('Lägg till', ['btnRow', 'btnTpl', 'btnImp']);
  sec('Planera', ['btnRes', 'btnCal', 'btnSec', 'btnVar', 'btnBud', 'btnLog']);
  const view = document.createElement('div'); view.className = 'kc-mg kc-mv';
  ['groupwrap', 'arrowmode', 'rulesSel'].map(id => id === 'groupwrap' ? document.getElementById(id) : grp(id)).filter(Boolean).forEach(g => view.appendChild(g));
  const fs = $('#fwhen'), st = $('#fstatus'), hide = $('#fhide')?.closest('label');
  const filt = document.createElement('div'); filt.className = 'kc-mg kc-mv';
  [fs, st, hide].filter(Boolean).forEach(e => filt.appendChild(e));
  const hv = document.createElement('div'); hv.className = 'kc-mh'; hv.textContent = 'Visning'; menu.appendChild(hv); menu.appendChild(view);
  const hf = document.createElement('div'); hf.className = 'kc-mh'; hf.textContent = 'Filter'; menu.appendChild(hf); menu.appendChild(filt);
  sec('Arket', ['btnLoad', 'btnSave', 'btnRedo']);
  const auto = $('#autosave')?.closest('label'); if (auto) menu.lastElementChild.appendChild(auto);
  const btn = wrap.querySelector('#kcMore');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  menu.addEventListener('click', e => { if (e.target.closest('button.btn')) close(); });
}
if (document.body.classList.contains('embedded') || window.parent !== window) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tidy); else tidy(); }
