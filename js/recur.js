/* Återkommande uppgifter (som TasksPro). Regeln ligger som raden "Upprepa: veckovis" i uppgiftens anteckning,
   så den följer med till Google Tasks och telefonen. När en återkommande uppgift bockas av skapas nästa instans. */
import { api, ymd, parseYmd, addDays, todayStr, toast, refresh } from './core.js';

export const RULES = [
  ['dagligen', 'Varje dag'],
  ['veckodagar', 'Veckodagar (mån–fre)'],
  ['veckovis', 'Varje vecka'],
  ['varannan vecka', 'Varannan vecka'],
  ['månadsvis', 'Varje månad'],
  ['årligen', 'Varje år'],
];
const ALIASES = { 'varje dag': 'dagligen', daglig: 'dagligen', vardagar: 'veckodagar', 'varje vardag': 'veckodagar', 'varje vecka': 'veckovis', veckovis: 'veckovis', 'varannan vecka': 'varannan vecka', 'varje månad': 'månadsvis', månatligen: 'månadsvis', 'varje år': 'årligen', årsvis: 'årligen' };
export const normRule = r => { const s = String(r || '').trim().toLowerCase(); return RULES.some(([k]) => k === s) ? s : ALIASES[s] || null; };

/** Regeln ur anteckningen, eller null. */
export function recurOf(t) {
  const l = String(t?.notes || '').split('\n').map(x => x.trim()).find(x => /^Upprepa:/i.test(x));
  return l ? normRule(l.replace(/^Upprepa:\s*/i, '')) : null;
}
/** Anteckningen med regeln satt (eller borttagen om rule är tom). Raden läggs efter ev. Kontakt-rad. */
export function withRule(notes, rule) {
  const lines = String(notes || '').split('\n').filter(l => !/^\s*Upprepa:/i.test(l));
  if (!rule) return lines.join('\n').replace(/^\n+|\s+$/g, '');
  const i = /^\s*Kontakt:/.test(lines[0] || '') ? 1 : 0;
  lines.splice(i, 0, 'Upprepa: ' + rule);
  return lines.join('\n').replace(/\s+$/, '');
}

/** Nästa datum efter `from` (ÅÅÅÅ-MM-DD). */
export function nextDate(from, rule) {
  const d = parseYmd(from || todayStr());
  switch (rule) {
    case 'dagligen': return ymd(addDays(d, 1));
    case 'veckodagar': { let x = addDays(d, 1); while (x.getDay() === 0 || x.getDay() === 6) x = addDays(x, 1); return ymd(x); }
    case 'veckovis': return ymd(addDays(d, 7));
    case 'varannan vecka': return ymd(addDays(d, 14));
    case 'månadsvis': { const x = new Date(d.getFullYear(), d.getMonth() + 1, 1); x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return ymd(x); }
    case 'årligen': { const x = new Date(d.getFullYear() + 1, d.getMonth(), 1); x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return ymd(x); }
  }
  return null;
}

/** Anropas efter att en uppgift bockats av. Skapar nästa instans om uppgiften är återkommande. Returnerar nästa datum eller null.
    Nästa datum räknas från förfallodatumet; ligger det i det förflutna räknas det fram tills det är idag eller senare. */
export async function afterComplete(t) {
  const rule = recurOf(t);
  if (!rule) return null;
  let next = nextDate(t.due || todayStr(), rule);
  let guard = 0;
  while (next < todayStr() && guard++ < 400) next = nextDate(next, rule);
  try {
    await api('addTask', { title: t.title, notes: t.notes || '', due: next, listId: t.listId }, true, t._src || 'jobb');
    toast('Nästa: ' + next);
    refresh();
  } catch (e) { toast('Kunde inte skapa nästa – ' + e.message); }
  return next;
}
