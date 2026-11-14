/* KC – snabbinmatning på svenska (port av Sikts QuickParser).
   "lunch med Richard tis 12 på Urban Deli" → Lunch med Richard, tisdag 12–13, Urban Deli.
   Används av kalendern (kind: 'event') och uppgifterna (kind: 'task'). Inget nätverk, ingen AI.

   parseQuick(text, { kind, now }) → {
     title, date ('ÅÅÅÅ-MM-DD' | null), time ('HH:MM' | null), endTime, endDate, allDay,
     location, people: [..], tags: ['#JF5'], recur: null | 'dagligen' | 'veckodagar' | 'veckovis' | 'varannan vecka' | 'månadsvis' | 'årligen',
     calendarHint, hasExplicitDate
   } */

const PH = '\u0001';                                  // platshållare där datumet stod
const B = '(?<![\\p{L}\\d])', E = '(?![\\p{L}\\d])';   // ordgränser som klarar å/ä/ö
const WEEKDAYS = [                                    // längst först; värde = JS getDay (sön = 0)
  ['måndag', 1], ['tisdag', 2], ['onsdag', 3], ['torsdag', 4], ['fredag', 5], ['lördag', 6], ['söndag', 0],
  ['tors', 4], ['mån', 1], ['tis', 2], ['ons', 3], ['tor', 4], ['fre', 5], ['lör', 6], ['sön', 0],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MON_RE = '(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\\p{L}*\\.?';

const re = (src, flags = 'iu') => new RegExp(src, flags);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

function cut(text, m, repl = ' ') { return text.slice(0, m.index) + ' ' + repl + ' ' + text.slice(m.index + m[0].length); }
function minutes(h, m) {
  const H = Number(h), M = Number(m || 0);
  if (!Number.isInteger(H) || H < 0 || H > 24 || M < 0 || M > 59 || H * 60 + M > 24 * 60) return null;
  return H * 60 + M;
}
/** Dag/månad utan år: i år, eller nästa år om datumet redan passerat. */
function dayMonth(day, month, today) {
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) return null;
  let d = new Date(today.getFullYear(), month - 1, day);
  if (d.getMonth() !== month - 1) return null;
  if (d < today) d = new Date(today.getFullYear() + 1, month - 1, day);
  return d;
}
/** Måndagen i ISO-vecka w (i år, eller nästa år om veckan passerat). */
function isoWeekMonday(w, today) {
  const mon = y => { const j4 = new Date(y, 0, 4); const m1 = addDays(j4, -((j4.getDay() + 6) % 7)); return addDays(m1, (w - 1) * 7); };
  let d = mon(today.getFullYear());
  if (addDays(d, 6) < today) d = mon(today.getFullYear() + 1);
  return d;
}

export function parseQuick(input, { kind = 'event', now = new Date() } = {}) {
  let text = ' ' + String(input || '').trim() + ' ';
  const empty = { title: '', date: null, time: null, endTime: null, endDate: null, allDay: false, location: null, people: [], tags: [], recur: null, calendarHint: null, hasExplicitDate: false };
  if (!text.trim()) return empty;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let day = null, endDay = null, startMin = null, endMin = null, duration = null, allDay = false, recur = null, calendarHint = null, evening = false, m;

  // Taggar stannar i titeln (KC kopplar projekt via #TAGG i titeln) men listas också.
  const tags = [...new Set((text.match(/#[0-9A-Za-zÅÄÖåäö_-]+/g) || []).map(t => t.toUpperCase()))];

  // 1. Kalender: "/jobb"
  if ((m = re('\\s/([^\\s/]+)').exec(text))) { calendarHint = m[1]; text = cut(text, m); }

  // 2. Upprepning
  const REC = [['varannan\\s+vecka', 'varannan vecka'], ['varje\\s+vardag', 'veckodagar'], ['vardagar', 'veckodagar'], ['varje\\s+dag', 'dagligen'], ['dagligen', 'dagligen'],
    ['varje\\s+vecka', 'veckovis'], ['veckovis', 'veckovis'], ['varje\\s+månad', 'månadsvis'], ['månadsvis', 'månadsvis'], ['varje\\s+år', 'årligen'], ['årligen', 'årligen']];
  for (const [p, name] of REC) if ((m = re(B + p + E).exec(text))) { recur = name; text = cut(text, m); break; }
  // "varje tisdag" = veckovis med tisdag som dag
  if (!recur && (m = re(B + 'varje(?=\\s+(?:mån|tis|ons|tor|fre|lör|sön))').exec(text))) { recur = 'veckovis'; text = cut(text, m); }

  // 3. Heldag
  if ((m = re(B + 'heldag(?:en)?' + E).exec(text))) { allDay = true; text = cut(text, m); }

  // 4. Längd: "30 min", "i 1,5 h", "2 timmar"
  if ((m = re('(?:' + B + 'i\\s+)?(?<![\\p{L}\\d:.,/-])(\\d+(?:[.,]\\d+)?)\\s*(minuter|min|timmar|timme|tim|h)' + E).exec(text))) {
    const v = Number(m[1].replace(',', '.')), mins = Math.round(/^min/i.test(m[2]) ? v : v * 60);
    if (mins > 0 && mins <= 24 * 60) { duration = mins; text = cut(text, m); }
  }

  // 5. Datum
  if ((m = re('(?<!\\d)(\\d{4})-(\\d{2})-(\\d{2})(?!\\d)').exec(text))) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]); if (d.getMonth() === +m[2] - 1) { day = d; text = cut(text, m, PH); }
  } else if ((m = re('(?:' + B + 'den\\s+)?(?<![\\p{L}\\d:.,/-])(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+' + MON_RE).exec(text))) {
    // "4-5 dec" → heldag(ar) 4–5 december
    const mi = MONTHS.indexOf(m[3].toLowerCase()) + 1;
    const a = dayMonth(+m[1], mi, today), b = a && new Date(a.getFullYear(), mi - 1, +m[2]);
    if (a && b && b >= a) { day = a; endDay = b; allDay = true; text = cut(text, m, PH); }
  } else if ((m = re('(?:' + B + 'den\\s+)?(?<![\\p{L}\\d:.,/-])(\\d{1,2})/(\\d{1,2})(?![\\d/])').exec(text))) {
    const d = dayMonth(+m[1], +m[2], today); if (d) { day = d; text = cut(text, m, PH); }
  } else if ((m = re('(?:' + B + 'den\\s+)?(?<![\\p{L}\\d:.,/-])(\\d{1,2})\\s+' + MON_RE).exec(text))) {
    const d = dayMonth(+m[1], MONTHS.indexOf(m[2].toLowerCase()) + 1, today); if (d) { day = d; text = cut(text, m, PH); }
  } else if ((m = re(B + '(?:v\\.?|vecka)\\s*(\\d{1,2})' + E).exec(text))) {
    const w = +m[1]; if (w >= 1 && w <= 53) { day = isoWeekMonday(w, today); text = cut(text, m, PH); }
  } else if ((m = re(B + '(?:i\\s+)?övermorgon' + E).exec(text))) { day = addDays(today, 2); text = cut(text, m, PH); }
  else if ((m = re(B + '(?:i\\s+morgon|imorgon|imorn|i\\s+morn)' + E).exec(text))) { day = addDays(today, 1); text = cut(text, m, PH); }
  else if ((m = re(B + '(?:i\\s+kväll|ikväll)' + E).exec(text))) { day = today; evening = true; text = cut(text, m, PH); }
  else if ((m = re(B + '(?:i\\s+dag|idag)' + E).exec(text))) { day = today; text = cut(text, m, PH); }
  else if ((m = re(B + 'nästa\\s+vecka' + E).exec(text))) { day = addDays(today, 7 - ((today.getDay() + 6) % 7)); text = cut(text, m, PH); }
  else {
    for (const [name, wd] of WEEKDAYS) {
      if (!(m = re(B + '(?:på\\s+)?(nästa\\s+)?' + name + '(?:en|ar|dag|dagen|dagar)?\\.?' + E).exec(text))) continue;
      if (!m[1]) day = addDays(today, (wd - today.getDay() + 7) % 7);
      else { const nextMon = addDays(today, 7 - ((today.getDay() + 6) % 7)); day = addDays(nextMon, (wd + 6) % 7); }
      text = cut(text, m, PH);
      break;
    }
  }

  // 6. Klockslag – intervall först: "10-11:30", "kl 9.30–11"
  if ((m = re('(?:' + B + 'kl(?:ockan)?\\.?\\s*)?(?<![\\p{L}\\d:.,/-])(\\d{1,2})(?:[:.](\\d{2}))?\\s*[-–]\\s*(\\d{1,2})(?:[:.](\\d{2}))?(?![\\d/:.-])').exec(text))
      && minutes(m[1], m[2]) != null && minutes(m[3], m[4]) != null) {
    startMin = minutes(m[1], m[2]); endMin = minutes(m[3], m[4]); text = cut(text, m);
  } else if ((m = re(B + 'kl(?:ockan)?\\.?\\s*(\\d{1,2})(?:[:.]?(\\d{2}))?(?!\\d)').exec(text)) && minutes(m[1], m[2]) != null) {
    startMin = minutes(m[1], m[2]); text = cut(text, m);
  } else if ((m = re('(?<![\\p{L}\\d:.,/-])(\\d{1,2})[:.](\\d{2})(?![\\d/:.-])').exec(text)) && minutes(m[1], m[2]) != null) {
    startMin = minutes(m[1], m[2]); text = cut(text, m);
  } else if ((m = re(PH + '\\s*(\\d{1,2})(?![\\d/:.-])').exec(text)) && minutes(m[1]) != null) {
    startMin = minutes(m[1]); text = cut(text, m, PH);            // "tis 12"
  }
  text = text.split(PH).join(' ');

  // 7. Plats: "på X", "hos X", "@X", "i X" (X med versal)
  let location = null;
  if ((m = re('\\s(?:på|hos)\\s+(.+)$|\\s@\\s*(.+)$').exec(text))) {
    const place = (m[1] || m[2] || '').trim();
    if (place && !/^#/.test(place)) { location = place; text = cut(text, m); }
  } else if ((m = re('\\si\\s+(\\p{Lu}[\\p{L}\\d .\'-]*)\\s*$', 'u').exec(text))) {
    location = m[1].trim(); text = cut(text, m);
  }
  // Taggar i platsen hör till titeln
  if (location) {
    const lt = location.match(/#[0-9A-Za-zÅÄÖåäö_-]+/g);
    if (lt) { location = location.replace(/\s*#[0-9A-Za-zÅÄÖåäö_-]+/g, '').trim() || null; text += ' ' + lt.join(' '); }
  }

  // 8. Personer: "med X (och Y)" – stannar i titeln
  const people = [];
  if ((m = re(B + 'med\\s+((?:\\p{Lu}[\\p{L}-]*)(?:\\s+\\p{Lu}[\\p{L}-]*)?(?:\\s*(?:,|och)\\s*\\p{Lu}[\\p{L}-]*(?:\\s+\\p{Lu}[\\p{L}-]*)?)*)', 'u').exec(text))) {
    m[1].split(/\s*(?:,|\boch\b)\s*/).map(s => s.trim()).filter(Boolean).forEach(p => people.push(p));
  }

  // 9. Titel
  let title = text.split(/\s+/).filter(Boolean).join(' ').replace(/^[\s,;–-]+|[\s,;–-]+$/g, '');
  for (const t of [' kl', ' på', ' i', ' den', ' hos']) if (title.toLowerCase().endsWith(t)) title = title.slice(0, -t.length).trim();
  if (!title) title = kind === 'task' ? 'Ny uppgift' : 'Ny händelse';
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // 10. Sätt ihop
  if (startMin == null && evening && !allDay) startMin = 19 * 60;
  const out = { ...empty, title, location, people, tags, recur, calendarHint, hasExplicitDate: !!day || startMin != null };
  if (kind === 'task') {
    // En uppgift har bara datum (Google Tasks saknar klockslag); tiden följer med för den som vill blocka.
    out.date = day ? ymd(day) : (startMin != null ? ymd(today) : null);
    if (recur && !out.date) out.date = ymd(today);
    out.time = startMin != null ? hm(startMin) : null;
    out.endTime = endMin != null ? hm(endMin) : null;
    out.allDay = startMin == null;
    return out;
  }
  if (startMin == null || allDay) {
    const d = day || today;
    return { ...out, allDay: true, date: ymd(d), endDate: endDay ? ymd(endDay) : null, time: null, endTime: null };
  }
  let base = day || today;
  if (!day && new Date(base.getTime() + startMin * 60000) < now) base = addDays(base, 1);   // klockslaget har passerat → imorgon
  let endTotal = endMin != null ? endMin : startMin + (duration || 60);
  let endBase = base;
  if (endMin != null && endMin <= startMin) endTotal += 24 * 60;
  if (endTotal >= 24 * 60) { endBase = addDays(base, Math.floor(endTotal / (24 * 60))); endTotal %= 24 * 60; }
  return { ...out, allDay: false, date: ymd(base), time: hm(startMin), endTime: hm(endTotal), endDate: ymd(endBase) !== ymd(base) ? ymd(endBase) : null };
}
