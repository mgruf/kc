/* KC – Mejl: trådar per person och projekt, olästa idag och mejl som väntar på svar.
   Platshållare <div data-mailbox='{"emails":[…]}'> fylls i automatiskt när de dyker upp i sidan,
   så att vyer som bygger HTML-strängar kan bädda in mejl utan egen kod. */
import { S, api, esc, ymd, hhmm, dayLabel, shortDate, relTime } from './core.js';

const CACHE = {};            // nyckel → { t, threads, error, loading }
// Senaste svaren sparas i webbläsaren så mejlen syns direkt; färska hämtas i bakgrunden.
const LS = 'kc_mailcache';
try { Object.assign(CACHE, Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem(LS) || '{}')).map(([k, v]) => [k, { t: 0, threads: v }]))); } catch {}
let lsT = null;
const persist = () => { clearTimeout(lsT); lsT = setTimeout(() => { try { const o = {}; Object.entries(CACHE).filter(([, v]) => v.threads && !v.error).slice(-30).forEach(([k, v]) => o[k] = v.threads.slice(0, 25)); localStorage.setItem(LS, JSON.stringify(o)); } catch {} }, 500); };
const TTL = 10 * 60e3;

const keyOf = o => JSON.stringify(o);
function when(iso) {
  const d = new Date(iso), s = ymd(d);
  return s === ymd(new Date()) ? hhmm(iso) : dayLabel(s);
}

export function threadRow(t, opt = {}) {
  return `<div class="ml-row ${t.unread ? 'unread' : ''}">
    <a class="ml-main" href="${esc(t.url)}" title="Öppna i MailPro">
      <span class="ml-top"><b class="ml-from">${esc(opt.to ? 'Till ' + (t.to || t.from) : t.from)}</b><span class="ml-date">${esc(opt.days && t.days != null ? `${t.days} dagar` : when(t.date))}</span></span>
      <span class="ml-subj">${esc(t.subject)}${t.count > 1 ? `<i class="ml-n">${t.count}</i>` : ''}</span>
      <span class="ml-snip">${esc(t.snippet)}</span>
    </a>
    <a class="ml-web" href="${esc(t.web)}" target="_blank" rel="noopener" title="Öppna i Gmail">Gmail</a>
  </div>`;
}

async function load(action, params, force) {
  const k = action + keyOf(params);
  const c = CACHE[k];
  if (c && !force && (c.loading || Date.now() - c.t < TTL)) return c.loading || c;
  const entry = CACHE[k] = c || { t: 0, threads: null };
  entry.loading = api(action, params).then(r => { entry.threads = r.threads || []; entry.error = null; entry.t = Date.now(); persist(); return entry; })
    .catch(e => { if (!entry.threads) entry.error = e.message; entry.t = Date.now(); return entry; })
    .finally(() => { entry.loading = null; });
  return entry.loading;
}
const cached = (action, params) => CACHE[action + keyOf(params)];

function listHtml(entry, opt = {}) {
  if (!entry || (!entry.threads && !entry.error)) return `<p class="ml-empty">Hämtar mejl…</p>`;
  if (entry.error) return `<p class="ml-empty">Mejlen kunde inte hämtas (${esc(entry.error)}).${/okänd action|gmail|behörig/i.test(entry.error) ? ' Kör setup i Apps Script och godkänn Gmail.' : ''}</p>`;
  if (!entry.threads.length) return `<p class="ml-empty">${esc(opt.none || 'Inga mejl.')}</p>`;
  const max = opt.max || 12;
  return entry.threads.slice(0, max).map(t => threadRow(t, opt)).join('') + (entry.threads.length > max ? `<p class="ml-empty">${entry.threads.length - max} till…</p>` : '');
}

/** Laddar och visar mejl i el. o = { emails:[...] } eller { tag } (+ q, max, none). */
export async function mailBox(el, o = {}) {
  const action = o.tag ? 'mailProject' : 'mailFor';
  const params = o.tag ? { tag: o.tag, ...(o.q ? { q: o.q } : {}) } : { emails: (o.emails || []).filter(Boolean), ...(o.q ? { q: o.q } : {}), max: o.max || 15 };
  if (!o.tag && !params.emails.length) { el.innerHTML = `<p class="ml-empty">Ingen e-postadress.</p>`; return; }
  el.classList.add('ml');
  el.innerHTML = listHtml(cached(action, params), o);
  const entry = await load(action, params, o.force);
  if (el.isConnected) el.innerHTML = listHtml(entry, o);
}

/** Mejl du skickat utan svar i minst 7 dagar. */
export async function loadWaiting(force) { return load('mailWaiting', { days: 7 }, force); }
export const waitingThreads = () => cached('mailWaiting', { days: 7 })?.threads || [];

/** Platshållare för Det som brinner/dashboarden (fylls i automatiskt). */
export function mailWaitingHtml(opt = {}) {
  return `<div data-mailbox='${esc(JSON.stringify({ kind: 'waiting', max: opt.max || 6 }))}'>${listHtml(cached('mailWaiting', { days: 7 }), { to: true, days: true, none: 'Inga obesvarade mejl.' })}</div>`;
}

/** Saker till fireList: mejl som väntat på svar för länge. */
export function mailFireItems() {
  return waitingThreads().map(t => ({ kind: 'mail', t, ctx: `Inget svar${t.days != null ? ` på ${t.days} dagar` : ''}: ${t.subject} (till ${t.to || t.toEmail})` }));
}

/** Widget: olästa senaste dygnet + väntar på svar. */
export async function mailWidget(el) {
  el.classList.add('ml', 'ml-widget');
  const draw = () => {
    const a = cached('mailToday', {}), b = cached('mailWaiting', { days: 7 });
    const n = S.data?.mailWaitingCount;
    el.innerHTML = `<div class="ml-h">Olästa senaste dygnet${a?.threads ? `<span class="n">${a.threads.length}</span>` : ''}</div>${listHtml(a, { max: 5, none: 'Inget oläst.' })}
      <div class="ml-h">Väntar på svar${b?.threads ? `<span class="n">${b.threads.length}</span>` : n ? `<span class="n">${n}</span>` : ''}</div>${listHtml(b, { max: 5, to: true, days: true, none: 'Inga obesvarade mejl.' })}`;
  };
  draw();
  await Promise.all([load('mailToday', {}), load('mailWaiting', { days: 7 })]);
  if (el.isConnected) draw();
}

// ---------- platshållare fylls i automatiskt ----------
function fill(root) {
  (root.querySelectorAll ? root.querySelectorAll('[data-mailbox]:not([data-mlfilled])') : []).forEach(el => {
    el.dataset.mlfilled = '1';
    let o = {}; try { o = JSON.parse(el.dataset.mailbox); } catch {}
    if (o.kind === 'waiting') {
      const draw = e => { if (el.isConnected) el.innerHTML = listHtml(e, { to: true, days: true, max: o.max || 6, none: 'Inga obesvarade mejl.' }); };
      draw(cached('mailWaiting', { days: 7 }));
      loadWaiting().then(draw);
    } else if (o.kind === 'widget') mailWidget(el);
    else mailBox(el, o);
  });
}
if (typeof MutationObserver !== 'undefined' && document.body) {
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches?.('[data-mailbox]')) fill(n.parentNode || n); else fill(n); } }))).observe(document.body, { childList: true, subtree: true });
  fill(document.body);
}
