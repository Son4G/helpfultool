// Eventi in Ticino dei prossimi 60 giorni → events.json (letto dallo strumento Eventi, src/tools/eventi.js).
// Fonte: l'elenco ufficiale di Ticino Turismo (lo stesso che usa ticino.ch/it/explore/events/all-events.html).
// Gira ogni giorno su GitHub insieme alle offerte (tools/phone.mjs lo copia in phone/.github/ con il workflow).
// Uso locale: node tools/events.mjs [file di uscita, predefinito events.json]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const OUT = process.argv[2] || 'events.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DAYS = 60;
const day = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
const today = day(Date.now());
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const CATS = {
  'events-event-cat-musicals': 'musica', 'events-event-cat-cultural': 'cultura', 'events-event-cat-art-exhibitions': 'mostre',
  'events-event-cat-traditional': 'tradizioni', 'events-event-cat-markets': 'mercati', 'events-event-cat-food-and-wine': 'gastronomia',
  'events-event-cat-sports': 'sport', 'events-event-cat-nature': 'natura', 'events-event-cat-guided-tours': 'visite',
  'events-event-cat-open-air-festival': 'festival'
};
const ZONES = {
  'tourist-region-region-lugano': 'lugano', 'tourist-region-region-ascona-locarno': 'locarno',
  'tourist-region-region-bellinzona-valli': 'bellinzona', 'tourist-region-region-mendrisiotto': 'mendrisio'
};

async function get() {
  const url = `https://api.ticino.ch/fileadmin/api/events/?lang=it&dateFrom=${today}&dateTo=${addDays(today, DAYS)}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

function parse(j) {
  const groups = (j && j.content && j.content[0] && j.content[0].data && j.content[0].data.items) || [];
  const items = new Map();
  for (const e of groups.flat()) {
    if (!e || !e.itemId || !e.denomination || !e.validFromDate) continue;
    const from = day(e.validFromDate), to = day(e.validUntilDate || e.validFromDate);
    if (to < today) continue;
    const slug = String(e.slug || '').split('/').pop();
    const id = String(e.itemId);
    if (items.has(id)) continue;
    items.set(id, {
      id,
      title: clean(e.denomination),
      from, to: to < from ? from : to,
      city: clean(e.city),
      place: clean(e.place || e.placeNameFromSuperItem),
      zone: (e.listFacetIdAttributeTouristRegion || []).map((x) => ZONES[x]).find(Boolean) || '',
      cats: [...new Set((e.listFacetIdAttributeEvent || []).map((x) => CATS[x]).filter(Boolean))],
      top: e.isTopEvent === true || undefined,
      off: e.isCancelled === true ? clean(e.cancelledText) || 'Annullato' : undefined,
      img: /^https:\/\/cdn\.sanity\.io\//.test(e.imageName || '') ? e.imageName : '',
      url: `https://www.ticino.ch/it/events/details/${slug && /^[\w-]+$/.test(slug) ? slug : 'evento'}/${id}.html`
    });
  }
  return [...items.values()].sort((a, b) => a.from.localeCompare(b.from) || a.title.localeCompare(b.title, 'it'));
}

// Se la fonte non risponde si tiene l'elenco di ieri: meglio che niente.
const prev = existsSync(OUT) ? (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) { return null; } })() : null;
let items, error = false;
try {
  items = parse(await get());
  if (!items.length) throw new Error('nessun evento trovato (la fonte è cambiata?)');
  console.log(`Eventi: ${items.length}`);
} catch (e) {
  console.error('Eventi:', e.message);
  if (!prev) process.exit(1);
  items = prev.items; error = true;
}
/* eventi uguali all'ultima volta: stessa data e stesso file, così su GitHub non nasce un salvataggio inutile */
const same = prev && !error && JSON.stringify(prev.items) === JSON.stringify(items);
const out = { version: 1, updated: same || error ? prev.updated : new Date().toISOString(), source: 'https://www.ticino.ch/it/explore/events.html', error: error || undefined, items };
writeFileSync(OUT, JSON.stringify(out) + '\n');
