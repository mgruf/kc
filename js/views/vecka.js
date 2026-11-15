/* VECKA – veckostart och veckoavslut. Stegvis genomgång, ett kort i taget (går att läsa upp i bilen).
   Söndag/måndag = Veckostart, torsdag/fredag = Veckoavslut, övriga dagar väljer man själv. */
import {
  S, api, emit, refresh, ensureRange, $, esc, toast, ymd, parseYmd, addDays, todayStr, monday, week, hhmm, DAYS, MONTHS, shortDate, dayLabel,
  tasks, events, cfgProjects, visible, fireList, cleanTitle, tagHtml, tagColor, claudeUrl, evOnDay,
} from '../core.js';
import { taskRow, eventRow, empty, pref, setPref, timeBlock } from '../ui.js';
import { delegationsHtml, delegationFire, delegated, delegationOf, capacityWeekHtml, capacity } from '../plan.js';

const STEPS = [
  ['tillbaka', 'Förra veckan'], ['brinner', 'Det som brinner'], ['vantar', 'Väntar på och delegerat'], ['kommande', 'Kommande vecka'],
  ['fokus', 'Tre fokus'], ['block', 'Tidsblock'], ['reflektion', 'Reflektion'],
];
const QUESTIONS = ['Vad gick annorlunda än planerat?', 'Vad lärde du dig?', 'Vad släpper du?'];

// ---------- vilken vecka gäller ----------
function frame() {
  const now = new Date(), d = now.getDay();
  const auto = d === 0 || d === 1 ? 'start' : d === 4 || d === 5 ? 'avslut' : null;
  const mode = pref('v_mode_override', null) || auto || pref('v_mode', 'start');
  const mon = monday(now);
  let upcoming, last;
  if (mode === 'start') { upcoming = d === 1 ? mon : addDays(mon, 7); last = addDays(upcoming, -7); }
  else { last = mon; upcoming = addDays(mon, 7); }
  const key = ymd(upcoming) + '_' + mode;
  return { mode, auto, last: ymd(last), lastEnd: ymd(addDays(last, 6)), up: ymd(upcoming), upEnd: ymd(addDays(upcoming, 6)), key,
    reviewWeek: week(last), upWeek: week(upcoming) };
}
const st = f => pref('v_state_' + f.key, { step: 0, focus: null, answers: ['', '', ''], notes: true, saved: false });
const setSt = (f, s) => setPref('v_state_' + f.key, s);

// ---------- data per steg ----------
function lastWeek(f) {
  const end = f.mode === 'avslut' ? todayStr() : f.lastEnd;
  const done = (S.data?.doneTasks || []).filter(visible).filter(x => x.completed && ymd(new Date(x.completed)) >= f.last && ymd(new Date(x.completed)) <= end);
  const missed = tasks().filter(x => x.due && x.due >= f.last && x.due <= end && x.due < todayStr() && !S.done[x.id]);
  const meets = events().filter(e => !e.allDay && ymd(new Date(e.start)) >= f.last && ymd(new Date(e.start)) <= end);
  const hours = meets.reduce((a, e) => a + (new Date(e.end) - new Date(e.start)) / 36e5, 0);
  return { done, missed, meets, hours, end };
}
function milestones(from, to) {
  return cfgProjects().filter(visible).flatMap(p => [
    ...(p.deadlines || []).map(x => ({ d: x.date, n: x.name, p })), ...(p.phases || []).filter(x => x.milestone).map(x => ({ d: x.start, n: x.name, p })),
  ]).filter(x => x.d >= from && x.d <= to).sort((a, b) => a.d.localeCompare(b.d));
}
const focusList = src => (S.data?.taskLists || []).find(l => l._src === src && /FOKUS/i.test(l.title));
const isFocus = t => /FOKUS/i.test(t.list || '') || (t.tags || []).includes('#FOKUS');
function focusCandidates(f) {
  const t = todayStr();
  const list = tasks().filter(x => !S.done[x.id] && !x.waiting && !delegationOf(x) && (isFocus(x) || (x.due && x.due <= f.upEnd) || (x.due && x.due < t)));
  return list.sort((a, b) => (isFocus(b) - isFocus(a)) || String(a.due || '9').localeCompare(String(b.due || '9'))).slice(0, 30);
}

// ---------- rendering ----------
export function render(el) {
  const f = frame(), s = st(f);
  if (S.data) ensureRange(f.last, ymd(addDays(parseYmd(f.up), 7)));
  const step = Math.max(0, Math.min(STEPS.length, s.step));
  const title = f.mode === 'start' ? `Veckostart · vecka ${f.upWeek}` : `Veckoavslut · vecka ${f.reviewWeek}`;
  const sub = f.mode === 'start' ? `Planera ${shortDate(f.up)}–${shortDate(f.upEnd)}` : `Summera veckan och förbered ${shortDate(f.up)}–${shortDate(f.upEnd)}`;
  el.innerHTML = `<div class="vk">
    <header class="vhead"><div><h1>${esc(title)}</h1><div class="vsub">${esc(sub)}</div></div>
      <div class="vact">
        <div class="seg small"><button data-vmode="start" class="${f.mode === 'start' ? 'on' : ''}">Veckostart</button><button data-vmode="avslut" class="${f.mode === 'avslut' ? 'on' : ''}">Veckoavslut</button></div>
        <button class="btn" data-vread title="Läs upp steget (u)">Läs upp</button>
        <a class="btn" href="${esc(claudeUrl(context()))}" target="_blank" rel="noopener">Fråga Claude</a>
      </div></header>
    <nav class="vk-steps">${STEPS.map(([k, l], i) => `<button data-vstep="${i}" class="${i === step ? 'on' : ''} ${i < step ? 'done' : ''}"><i>${i + 1}</i><span>${esc(l)}</span></button>`).join('')}</nav>
    ${!S.data ? empty('Ingen data än.') : `<section class="vk-card" data-vcard="${step}">${step >= STEPS.length ? finished(f, s) : stepHtml(STEPS[step][0], f, s)}</section>
    <div class="vk-nav"><button class="btn" data-vprev ${step === 0 ? 'disabled' : ''}>← Tillbaka</button><span class="vk-pos">${Math.min(step + 1, STEPS.length)} av ${STEPS.length}</span>${step < STEPS.length ? `<button class="btn solid" data-vnext>${step === STEPS.length - 1 ? 'Klar' : 'Nästa →'}</button>` : `<button class="btn" data-vrestart>Börja om</button>`}</div>`}
  </div>`;
  bind(el, f);
}

function stepHtml(k, f, s) {
  const t = todayStr();
  switch (k) {
    case 'tillbaka': {
      const w = lastWeek(f);
      return `<h2>${f.mode === 'start' ? 'Förra veckan' : 'Veckan som gått'}</h2>
        <div class="vk-stats"><div><b class="num">${w.done.length}</b><span>klara</span></div><div><b class="num ${w.missed.length ? 'firetext' : ''}">${w.missed.length}</b><span>missade</span></div><div><b class="num">${w.meets.length}</b><span>möten</span></div><div><b class="num">${Math.round(w.hours)}</b><span>timmar i möten</span></div></div>
        ${w.done.length ? `<h3>Klart</h3><ul class="vk-done">${w.done.slice(0, 14).map(x => `<li>${esc(cleanTitle(x.title))}<span class="tags">${tagHtml(x.tags)}</span></li>`).join('')}${w.done.length > 14 ? `<li class="more">+ ${w.done.length - 14} till</li>` : ''}</ul>` : '<p class="empty">Inget avbockat i KC eller Google Tasks den här veckan.</p>'}
        ${w.missed.length ? `<h3>Missat – flytta, delegera eller släpp</h3>${w.missed.map(x => taskRow(x)).join('')}` : ''}`;
    }
    case 'brinner': {
      const fire = fireList(), dl = delegationFire().filter(x => !fire.some(y => y.t?.id === x.id));
      return `<h2>Det som brinner</h2>
        ${fire.length || dl.length ? fire.map(x => x.kind === 'task' ? taskRow(x.t) : `<a class="item fire" href="${esc(x.w.url || '#/projekt/' + encodeURIComponent(x.p.tag))}"><div class="glyph" style="color:var(--fire)">!</div><div class="main"><div class="title">${esc(x.w.name)}</div><div class="sub">${esc(x.p.name)}</div></div></a>`).join('')
          + (dl.length ? `<h3>Avstämning idag eller passerad</h3>${dl.map(x => taskRow(x)).join('')}` : '') : '<p class="calm">Inget brinner. Bra.</p>'}`;
    }
    case 'vantar': {
      const dl = delegated();
      const wait = tasks().filter(x => x.waiting && !delegationOf(x) && !S.done[x.id]);
      return `<h2>Väntar på och delegerat</h2>
        <h3>Delegerat</h3>${delegationsHtml(dl)}
        ${wait.length ? `<h3>Väntar på svar</h3>${wait.map(x => taskRow(x)).join('')}` : ''}`;
    }
    case 'kommande': {
      const ms = milestones(f.up, f.upEnd);
      const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(parseYmd(f.up), i)));
      const shoot = {};
      cfgProjects().filter(visible).forEach(p => (p.shootDays || []).forEach(d => { if (d.date >= f.up && d.date <= f.upEnd) (shoot[d.date] ||= []).push({ p, d }); }));
      return `<h2>Vecka ${f.upWeek}</h2>
        ${capacityWeekHtml(f.up)}
        <div class="vk-week">${days.map(d => {
          const evs = events().filter(e => evOnDay(e, d)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
          const ts = tasks().filter(x => x.due === d && !S.done[x.id]);
          const dd = parseYmd(d);
          if (!evs.length && !ts.length && !shoot[d] && !ms.some(m => m.d === d) && (dd.getDay() === 0 || dd.getDay() === 6)) return '';
          return `<div class="vk-day"><a class="vk-dh" href="#/kalender/dag/${d}"><b>${DAYS[dd.getDay()]}</b> ${dd.getDate()} ${MONTHS[dd.getMonth()].slice(0, 3)}</a>
            ${(shoot[d] || []).map(({ p, d: x }) => `<div class="vk-chip" style="--tc:${tagColor(p.tag)}">Inspelning dag ${x.day}${x.note ? ' · ' + esc(x.note) : ''}</div>`).join('')}
            ${ms.filter(m => m.d === d).map(m => `<div class="vk-chip ms" style="--tc:${tagColor(m.p.tag)}">◆ ${esc(m.n)} · ${esc(m.p.name)}</div>`).join('')}
            ${evs.map(e => `<div class="vk-ev item event" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}"><i>${e.allDay ? 'heldag' : hhmm(e.start)}</i>${esc(cleanTitle(e.title))}</div>`).join('') || ''}
            ${ts.length ? `<div class="vk-t">${ts.length} uppgift${ts.length > 1 ? 'er' : ''}: ${ts.slice(0, 3).map(x => esc(cleanTitle(x.title))).join(', ')}${ts.length > 3 ? ' …' : ''}</div>` : ''}
          </div>`;
        }).join('')}</div>`;
    }
    case 'fokus': {
      const c = focusCandidates(f);
      const sel = s.focus || c.filter(isFocus).slice(0, 3).map(x => x.id);
      return `<h2>Välj tre fokus</h2><p class="hint">Det som måste bli av ${f.mode === 'start' ? 'den här veckan' : 'nästa vecka'}. Valda hamnar i ${focusList('jobb') ? 'listan ' + esc(focusList('jobb').title) : 'taggen #FOKUS'} och syns överst på Idag.</p>
        <div class="vk-pick">${c.map(x => `<label class="vk-opt ${sel.includes(x.id) ? 'on' : ''}"><input type="checkbox" data-vfocus="${esc(x.id)}" ${sel.includes(x.id) ? 'checked' : ''}><span class="title">${esc(cleanTitle(x.title))}<span class="tags">${tagHtml(x.tags)}</span></span><span class="sub">${x.due ? `<span class="${x.due < t ? 'firetext' : ''}">${esc(dayLabel(x.due))}</span>` : ''}${isFocus(x) ? ' · fokus nu' : ''}</span></label>`).join('') || '<p class="empty">Inga uppgifter att välja bland.</p>'}</div>
        <div class="vk-row"><span class="vk-count"><b>${sel.length}</b> av 3 valda</span><button class="btn solid" data-vsavefocus ${sel.length ? '' : 'disabled'}>Spara fokus</button></div>`;
    }
    case 'block': return blockHtml(f, s);
    case 'reflektion': return `<h2>Reflektion</h2><p class="hint">Tre korta svar räcker. De sparas i samlingen Veckologg.</p>
      ${QUESTIONS.map((q, i) => `<label class="vk-q"><span>${esc(q)}</span><textarea rows="3" data-vans="${i}" placeholder="…">${esc(s.answers[i] || '')}</textarea></label>`).join('')}
      <label class="inline vk-inline"><input type="checkbox" data-vnotes ${s.notes ? 'checked' : ''}> Spara även som anteckning i Notes</label>
      <div class="vk-row"><span class="vk-count">${s.saved ? 'Sparat ✓' : ''}</span><button class="btn solid" data-vsavelog>Spara</button></div>`;
  }
  return '';
}

function blockHtml(f, s) {
  const H0 = 8, H1 = 18, ROW = 30;
  const days = Array.from({ length: 5 }, (_, i) => ymd(addDays(parseYmd(f.up), i))).filter(d => d >= todayStr() || f.mode === 'avslut');
  const show = days.length ? days : Array.from({ length: 5 }, (_, i) => ymd(addDays(parseYmd(f.up), i)));
  const focus = tasks().filter(x => !S.done[x.id] && (isFocus(x) || (s.focus || []).includes(x.id)));
  const more = tasks().filter(x => !S.done[x.id] && x.due && x.due >= f.up && x.due <= f.upEnd && !focus.includes(x)).slice(0, 10);
  const cands = [...focus, ...more];
  const times = Array.from({ length: (H1 - H0) * 2 }, (_, i) => `${String(H0 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  return `<h2>Lägg in tidsblock</h2><p class="hint">Dra en uppgift till en tid i veckan, eller välj dag och tid och tryck Boka. Uppgiften får då även datumet.</p>
    <div class="vk-block">
      <div class="vk-cands">${cands.map(x => `<div class="vk-cand">${taskRow(x)}<div class="vk-book"><select data-vbday>${show.map(d => `<option value="${d}">${DAYS[parseYmd(d).getDay()].slice(0, 3)} ${parseYmd(d).getDate()}/${parseYmd(d).getMonth() + 1}</option>`).join('')}</select><select data-vbtime>${times.map(t => `<option ${t === '09:00' ? 'selected' : ''}>${t}</option>`).join('')}</select><select data-vblen><option value="60">1 h</option><option value="90">1½ h</option><option value="120" selected>2 h</option><option value="180">3 h</option></select><button class="btn" data-vbook="${esc(x.id)}">Boka</button></div></div>`).join('') || '<p class="empty">Välj fokus först, eller ge uppgifter datum den här veckan.</p>'}</div>
      <div class="vk-grid" style="--rows:${H1 - H0};--row:${ROW}px">
        <div class="vk-hours">${Array.from({ length: H1 - H0 }, (_, i) => `<span>${String(H0 + i).padStart(2, '0')}</span>`).join('')}</div>
        ${show.map(d => {
          const dd = parseYmd(d);
          const evs = events().filter(e => !e.allDay && ymd(new Date(e.start)) === d);
          return `<div class="vk-col" data-vday="${d}"><div class="vk-colh">${DAYS[dd.getDay()].slice(0, 3)} ${dd.getDate()}</div><div class="vk-colb">
            ${Array.from({ length: H1 - H0 }, (_, i) => `<div class="vk-slot" data-vslot="${String(H0 + i).padStart(2, '0')}:00"></div>`).join('')}
            ${evs.map(e => { const a = new Date(e.start), b = new Date(e.end); const top = Math.max(0, (a.getHours() + a.getMinutes() / 60 - H0) * ROW); const h = Math.max(14, ((b - a) / 36e5) * ROW - 2);
              return top < (H1 - H0) * ROW ? `<div class="vk-blk item event" data-ev="${esc(e.id)}" data-evs="${esc(e.start)}" style="top:${top}px;height:${Math.min(h, (H1 - H0) * ROW - top)}px;--tc:${e.tags?.[0] ? tagColor(e.tags[0]) : 'var(--ink-3)'}">${esc(cleanTitle(e.title))}</div>` : ''; }).join('')}
          </div></div>`;
        }).join('')}
      </div>
    </div>`;
}

function finished(f, s) {
  const fokus = tasks().filter(isFocus);
  return `<h2>${f.mode === 'start' ? 'Veckan är planerad' : 'Veckan är avslutad'}</h2>
    ${fokus.length ? `<h3>Fokus</h3>${fokus.map(x => taskRow(x)).join('')}` : ''}
    ${capacityWeekHtml(f.up)}
    <p class="hint">${s.saved ? 'Reflektionen är sparad i Veckologg.' : 'Reflektionen är inte sparad – gå tillbaka ett steg om du vill spara den.'}</p>`;
}

// ---------- interaktion ----------
function bind(el, f) {
  const s = () => st(f);
  const go = n => { const x = s(); x.step = n; setSt(f, x); emit('render'); window.scrollTo(0, 0); };
  el.querySelectorAll('[data-vmode]').forEach(b => b.onclick = () => { setPref('v_mode_override', b.dataset.vmode === (frame().auto || '') ? null : b.dataset.vmode); setPref('v_mode', b.dataset.vmode); emit('render'); });
  el.querySelectorAll('[data-vstep]').forEach(b => b.onclick = () => go(Number(b.dataset.vstep)));
  el.querySelector('[data-vprev]')?.addEventListener('click', () => go(Math.max(0, s().step - 1)));
  el.querySelector('[data-vnext]')?.addEventListener('click', () => go(s().step + 1));
  el.querySelector('[data-vrestart]')?.addEventListener('click', () => go(0));
  el.querySelector('[data-vread]')?.addEventListener('click', () => readAloud(el));
  // fokus
  el.querySelectorAll('[data-vfocus]').forEach(c => c.onchange = () => {
    const x = s(); const cur = x.focus || focusCandidates(f).filter(isFocus).slice(0, 3).map(t => t.id);
    let sel = c.checked ? [...new Set([...cur, c.dataset.vfocus])] : cur.filter(i => i !== c.dataset.vfocus);
    if (sel.length > 3) { toast('Tre räcker – välj bort något först'); sel = cur; }
    x.focus = sel; setSt(f, x); emit('render');
  });
  el.querySelector('[data-vsavefocus]')?.addEventListener('click', () => saveFocus(f));
  // tidsblock
  el.querySelectorAll('[data-vbook]').forEach(b => b.onclick = () => {
    const row = b.closest('.vk-book'); const t = (S.data.tasks || []).find(x => x.id === b.dataset.vbook); if (!t) return;
    timeBlock(t, row.querySelector('[data-vbday]').value, row.querySelector('[data-vbtime]').value, Number(row.querySelector('[data-vblen]').value));
  });
  el.querySelectorAll('.vk-slot').forEach(slot => {
    slot.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/kc-task')) { e.preventDefault(); slot.classList.add('drop'); } });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop'));
    slot.addEventListener('drop', e => {
      e.preventDefault(); slot.classList.remove('drop');
      const id = e.dataTransfer.getData('text/kc-task'); const t = (S.data.tasks || []).find(x => x.id === id); if (!t) return;
      timeBlock(t, slot.closest('[data-vday]').dataset.vday, slot.dataset.vslot, 60);
    });
  });
  // reflektion
  el.querySelectorAll('[data-vans]').forEach(a => a.oninput = () => { const x = s(); x.answers[Number(a.dataset.vans)] = a.value; x.saved = false; setSt(f, x); });
  el.querySelector('[data-vnotes]')?.addEventListener('change', e => { const x = s(); x.notes = e.target.checked; setSt(f, x); });
  el.querySelector('[data-vsavelog]')?.addEventListener('click', () => saveLog(f));
}

async function saveFocus(f) {
  const x = st(f); const ids = x.focus || [];
  const all = S.data.tasks || [];
  let moved = 0;
  for (const id of ids) {
    const t = all.find(y => y.id === id); if (!t || isFocus(t)) continue;
    const fl = focusList(t._src || 'jobb');
    try {
      if (fl) {
        const before = t.listId; Object.assign(t, { listId: fl.id, list: fl.title });
        const r = await api('updateTask', { listId: before, taskId: t.id, newListId: fl.id }, true, t._src || 'jobb');
        if (r?.id) t.id = r.id;
      } else {
        const title = `${t.title} #FOKUS`; t.title = title; t.tags = [...(t.tags || []), '#FOKUS'];
        await api('updateTask', { listId: t.listId, taskId: t.id, title }, true, t._src || 'jobb');
      }
      moved++;
    } catch (e) { toast('Kunde inte flytta – ' + e.message); }
  }
  toast(moved ? `${moved} i fokus` : 'Fokus oförändrat');
  x.step = Math.max(x.step, STEPS.findIndex(s => s[0] === 'block')); setSt(f, x);
  refresh(); emit('render');
}

async function saveLog(f) {
  const x = st(f);
  const typ = f.mode === 'start' ? 'Veckostart' : 'Veckoavslut';
  const veckan = `v${f.mode === 'start' ? f.upWeek : f.reviewWeek} ${parseYmd(f.up).getFullYear()}`;
  const fokus = tasks().filter(isFocus).map(t => '- ' + cleanTitle(t.title)).join('\n');
  const values = { Vecka: veckan, Datum: todayStr(), Typ: typ, Fokus: fokus, Reflektion: `${QUESTIONS[0]}\n${x.answers[0] || '–'}\n\n${QUESTIONS[2]}\n${x.answers[2] || '–'}`, 'Lärdom': x.answers[1] || '' };
  try {
    await api('saveVeckologg', { values }, true);
    if (x.notes) {
      const text = `#${todayStr().slice(2).replace(/-/g, '')}\n\nFokus:\n${fokus || '–'}\n\n` + QUESTIONS.map((q, i) => `${q}\n${x.answers[i] || '–'}`).join('\n\n');
      await api('addNote', { title: `${typ} ${veckan}`, text }, true);
    }
    x.saved = true; setSt(f, x); toast(x.notes ? 'Sparat – anteckningen skapas i Notes inom 5 min' : 'Sparat i Veckologg'); emit('render');
  } catch (e) { toast('Kunde inte spara – ' + e.message); }
}

function readAloud(el) {
  if (!('speechSynthesis' in window)) return toast('Uppläsning stöds inte här');
  speechSynthesis.cancel();
  const card = el.querySelector('.vk-card'); if (!card) return;
  const clone = card.cloneNode(true); clone.querySelectorAll('select, button, .vk-grid').forEach(n => n.remove());
  const text = clone.innerText.replace(/\s*\n\s*/g, '. ').replace(/\.\s*\./g, '.').slice(0, 1800);
  const u = new SpeechSynthesisUtterance(text); u.lang = 'sv-SE'; u.rate = 1.02;
  speechSynthesis.speak(u);
}

export function context() {
  if (!S.data) return '';
  const f = frame(), w = lastWeek(f);
  const cap = capacity(f.up, f.upEnd); const tot = cap.reduce((a, d) => a + d.total, 0), av = cap.reduce((a, d) => a + d.avail, 0);
  const lines = [`${f.mode === 'start' ? 'Veckostart' : 'Veckoavslut'}. Förra/denna vecka: ${w.done.length} klara, ${w.missed.length} missade, ${w.meets.length} möten (${Math.round(w.hours)} h).`];
  w.missed.slice(0, 10).forEach(x => lines.push(`- Missat: ${x.title} (${x.due})`));
  fireList().forEach(x => lines.push(`- Brinner: ${x.ctx}`));
  delegated().forEach(x => { const d = delegationOf(x); lines.push(`- Delegerat till ${d.person?.name || '?'}: ${x.title}${d.check ? ' (stäm av ' + d.check + ')' : ''}`); });
  lines.push(`Kommande vecka ${f.up}–${f.upEnd}: ${Math.round(av ? tot / av * 100 : 0)} % beläggning (${Math.round(tot)} av ${Math.round(av)} h).`);
  milestones(f.up, f.upEnd).forEach(m => lines.push(`- Milstolpe ${m.d}: ${m.n} (${m.p.name})`));
  tasks().filter(isFocus).forEach(x => lines.push(`- Fokus: ${x.title}`));
  lines.push('Hjälp mig prioritera och säg ärligt om veckan är för full.');
  return lines.join('\n');
}

export function key(e) {
  const f = frame(), s = st(f);
  if (e.key === 'ArrowRight') { s.step = Math.min(STEPS.length, s.step + 1); setSt(f, s); emit('render'); }
  if (e.key === 'ArrowLeft') { s.step = Math.max(0, s.step - 1); setSt(f, s); emit('render'); }
  if (e.key === 'u') readAloud(document.querySelector('#view'));
}
