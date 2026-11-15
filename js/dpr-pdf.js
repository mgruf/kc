/* KC – läser dagrapporter (DPR) som kommer som PDF-bilaga. Scriptans blankett har kolumner:
   "Scenes today", "Uncomplete scenes today", "Uncompleted scenes Total", "Dropped scenes", och under ACTORS
   en tabell med Scene/Slate/TC/Take. Texten läses med pdf.js och placeras i kolumn efter x-läge.
   Ungefärligt: Mathias godkänner allt innan något skrivs i scenarket. */
let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  const v = '4.10.38';
  pdfjs = await import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;
  return pdfjs;
}
export async function pdfItems(bytes, lib0) {
  const L = lib0 || await lib();
  const doc = await L.getDocument({ data: bytes }).promise;
  const pg = await doc.getPage(1);
  const tc = await pg.getTextContent();
  return tc.items.filter(t => String(t.str).trim()).map(t => ({ x: t.transform[4], y: t.transform[5], w: t.width, s: String(t.str).trim() }));
}
const SCENE = /(?<!\d)(\d{3,4})([A-Za-z](?![A-Za-z]))?(?!\d)((?:\s*,?\s*(?:[Pp][Tt]|[Pp]art|[Dd]el)\.?\s*\d(?:\s*,\s*\d(?!\d))*)*)/g;
function scenesIn(str) {
  const out = []; let m; SCENE.lastIndex = 0;
  while ((m = SCENE.exec(str))) {
    if (/^\d{1,2}[,.:]\d{2}$/.test(str.trim())) break;          // klockslag
    const parts = (m[3] || '').match(/\d/g) || [];
    const sc = (m[1] + (m[2] || '')).toUpperCase();
    const rest = str.replace(m[0], '').replace(/^[\s,.:;–-]+|[\s,.:;–-]+$/g, '').replace(/\s{2,}/g, ' ');
    if (parts.length) parts.forEach(p => out.push({ scene: sc, part: p, note: rest }));
    else out.push({ scene: sc, part: '', note: rest });
  }
  return out;
}
const near = (a, b, d = 4) => Math.abs(a - b) <= d;

/** items från pdfItems(). year = rapportens år (från mejlets datum). Returnerar null om blanketten inte känns igen. */
export function parseDprItems(items, year) {
  const find = re => items.find(i => re.test(i.s));
  const H = {
    today: find(/^scenes? today$|^scener idag$/i),
    uncToday: find(/^uncomplete(?:d)? scenes? today/i),
    uncTotal: find(/^uncomplete(?:d)? scenes?$|^uncompleted scenes total/i),
    dropped: find(/^dropped scenes?/i),
  };
  if (!H.today) return null;
  const actors = find(/^actors$/i);
  const hy = H.today.y, bottom = actors ? actors.y : hy - 200;
  const cols = Object.entries(H).filter(([, v]) => v).map(([k, v]) => ({ k, x: v.x })).sort((a, b) => a.x - b.x);
  const colOf = it => { let c = null; cols.forEach(cc => { if (it.x >= cc.x - 3) c = cc.k; }); return c; };
  const isHead = it => Object.values(H).includes(it) || /^total\.?$/i.test(it.s);
  const res = { today: [], uncToday: [], uncTotal: [], dropped: [] };
  items.filter(it => it.y <= hy + 3 && it.y > bottom + 3 && !isHead(it)).forEach(it => {
    if (near(it.y, hy, 3) && !/\d{3,4}/.test(it.s)) return;
    const c = colOf(it); if (!c) return;
    scenesIn(it.s).forEach(sc => res[c].push(sc));
  });
  // Slate-tabellen: kolumnen Scene under ACTORS
  const slateHead = actors && items.find(i => /^scene$/i.test(i.s) && near(i.y, actors.y, 4));
  const slate = [];
  if (slateHead) items.filter(i => i.y < actors.y - 3 && i.x >= slateHead.x - 12 && i.x <= slateHead.x + slateHead.w + 30).forEach(i => scenesIn(i.s).forEach(sc => slate.push(sc)));
  // Dag, datum, tider
  const dayH = find(/^day$/i);
  const dayV = dayH && items.find(i => /^\d{1,3}$/.test(i.s) && i.y < dayH.y && i.y > dayH.y - 70 && Math.abs(i.x - dayH.x) < 40);
  const dateH = find(/^date$/i);
  const dateV = dateH && items.find(i => near(i.y, dateH.y, 4) && i.x > dateH.x + 10 && /^\d{1,2}[\/.]\d{1,2}/.test(i.s));
  let reportDate = null;
  if (dateV) { const m = /^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/.exec(dateV.s); const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(year || new Date().getFullYear()); reportDate = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const timeUnder = re => {
    const h = find(re); if (!h) return '';
    const v = items.filter(i => i.y < h.y - 3 && i.y > h.y - 40 && i.x >= h.x - 25 && i.x <= h.x + Math.max(h.w, 40) + 50 && /^\d{1,2}\s*[,.:]\s*\d{2}$/.test(i.s)).sort((a, b) => b.y - a.y)[0];
    return v ? v.s.replace(/\s/g, '').replace(/[,.]/, ':').padStart(5, '0') : '';
  };
  const key = s => s.scene + '|' + s.part;
  const unc = new Set(res.uncToday.map(key)), uncScene = new Set(res.uncToday.filter(s => !s.part).map(s => s.scene));
  const seen = new Set(), filmed = [];
  [...res.today, ...slate].forEach(s => { const k = key(s); if (seen.has(k) || unc.has(k) || (!s.part && uncScene.has(s.scene))) return; seen.add(k); filmed.push({ film: '', scene: s.scene, part: s.part }); });
  // en scen som finns både med och utan del räknas med delarna
  const withParts = new Set(filmed.filter(s => s.part).map(s => s.scene));
  return {
    day: dayV ? Number(dayV.s) : null, reportDate,
    start: timeUnder(/^1st shoot$/i), wrap: timeUnder(/^wrap$/i),
    filmed: filmed.filter(s => s.part || !withParts.has(s.scene)),
    notFilmed: res.uncToday.map(s => ({ film: '', scene: s.scene, part: s.part, reason: s.note || 'Ej klar idag' })),
    openTotal: res.uncTotal, dropped: res.dropped, fromPdf: true,
  };
}
const b64 = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export async function parseDprPdf(base64, year) { return parseDprItems(await pdfItems(b64(base64)), year); }
