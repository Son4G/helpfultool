// Offerte della settimana di Lidl e Aldi Svizzera → deals.json (letto dallo strumento Offerte, src/tools/offerte.js).
// Gira ogni giorno su GitHub (tools/phone.mjs lo copia in phone/.github/ con il suo workflow): il telefono
// non può leggere i siti dei negozi (CORS), legge solo questo file dal sito dell'app.
// Uso locale: node tools/deals.mjs [file di uscita, predefinito deals.json]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const OUT = process.argv[2] || 'deals.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'it-CH,it;q=0.9', accept: 'text/html' } });
      if (r.ok) return await r.text();
      if (r.status === 404) return '';
      throw new Error('HTTP ' + r.status);
    } catch (e) {
      if (i === 2) throw new Error(`${url}: ${e.message}`);
      await wait(2000 * (i + 1));
    }
  }
}
const ent = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
  .replace(/&agrave;/g, 'à').replace(/&egrave;/g, 'è').replace(/&eacute;/g, 'é').replace(/&igrave;/g, 'ì').replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const text = (s) => ent(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
/* giorno svizzero AAAA-MM-GG di un istante (secondi Unix) */
const day = (sec) => new Date(sec * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
const today = day(Date.now() / 1000);
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/* ----------------------------- Lidl ----------------------------- */
// Ogni pagina di campagna (link /c/it-CH/…/aNNN dalla home) ha i prodotti come JSON in data-grid-data.
const LIDL = 'https://www.lidl.ch';
async function lidl() {
  const home = await get(LIDL + '/it');
  const pages = [...new Set([...home.matchAll(/href="(?:https:\/\/www\.lidl\.ch)?(\/c\/it-CH\/[a-z0-9-]+\/a\d+)"/g)].map((m) => m[1]))]
    .filter((p) => !/coupon|prepagat|lidl-plus|buoni/.test(p));
  const items = new Map();
  for (const p of pages) {
    const html = await get(LIDL + p).catch((e) => { console.warn('Lidl', e.message); return ''; });
    const title = text((html.match(/<title>([^<]*)/) || [])[1]).replace(/\s*–\s*www\.lidl\.ch$/, '');
    for (const m of html.matchAll(/data-grid-data="([^"]*)"/g)) {
      let d;
      try { d = JSON.parse(ent(m[1])); } catch (e) { continue; }
      if (!d.storeStartDate || !d.fullTitle) continue;
      const plus = Array.isArray(d.lidlPlus) && d.lidlPlus[0] && d.lidlPlus[0].price;
      const pr = (d.price && d.price.price != null) ? d.price : plus;
      if (!pr || pr.price == null) continue;
      const to = d.storeEndDate ? day(d.storeEndDate) : null;
      if (to && to < today) continue;
      const disc = pr.discount || {};
      const facts = [...ent((d.keyfacts && d.keyfacts.description) || '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => text(x[1]));
      const brand = d.brand && d.brand.name ? text(d.brand.name) : '';
      let name = text(d.fullTitle);
      if (brand && name.toUpperCase().startsWith(brand.toUpperCase() + ' ')) name = name.slice(brand.length + 1);
      const id = 'lidl-' + d.productId;
      if (items.has(id)) continue;
      items.set(id, {
        id, brand, name,
        size: facts.find((f) => /^\d[\d.,]*\s*(x\s*\d[\d.,]*\s*)?(k?g|m?l|cl|dl|pezz[io]|paia|rotoli|capsule|bustine)\b/i.test(f)) || '',
        unit: (facts.find((f) => /^\d+\s*(k?g|m?l|cl|pezzo)\s*=/.test(f)) || '').replace(/\s*=\s*/, ' = fr. '),
        price: round(pr.price),
        old: round(disc.deletedPrice) || null,
        pct: disc.percentageDiscount ? Math.round(disc.percentageDiscount) : null,
        plus: !d.price || d.price.price == null ? true : undefined,
        food: (d.category || (d.keyfacts && d.keyfacts.analyticsCategory)) === 'Food',
        from: day(d.storeStartDate), to,
        group: title,
        url: LIDL + (d.canonicalUrl || d.canonicalPath || p)
      });
    }
    await wait(700);
  }
  return [...items.values()];
}

/* ----------------------------- Aldi ----------------------------- */
// Una pagina per giorno d'inizio (/it/promozioni/AAAA-MM-GG, a pagine ?page=N), riquadri product-tile.
const ALDI = 'https://www.aldi-suisse.ch';
const chf = (s) => { const m = String(s).match(/(\d+(?:[.,]\d{1,2})?)/); return m ? round(parseFloat(m[1].replace(',', '.'))) : null; };
function aldiTiles(html, date) {
  const out = [];
  const parts = html.split(/<div id="product-tile-/).slice(1);
  for (const t of parts) {
    const id = (t.match(/^0*(\d+)/) || [])[1];
    const cls = (c) => { const m = t.match(new RegExp(`class="${c}"[^>]*>([\\s\\S]*?)</div>`)); return m ? text(m[1]) : ''; };
    const name = cls('product-tile__name');
    const priceBlock = (t.match(/class="base-price base-price--product-tile"[\s\S]*?<\/a>/) || [''])[0];
    const reg = (priceBlock.match(/base-price__regular"><span>([^<]*)/) || [])[1];
    const price = chf(reg);
    if (!id || !name || price == null) continue;
    /* prezzo barrato e percentuale, quando Aldi li mostra */
    const was = priceBlock.match(/base-price__(?:was|strike|old|previous|crossed)[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const tag = text((priceBlock.match(/base-price__discount-tag[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
    const pct = tag.match(/-?\s*(\d{1,2})\s*%/);
    const interval = text((priceBlock.match(/base-price__interval">([^<]*)/) || [])[1]);
    const from = (t.match(/Disponibile dal (\d{2})\.(\d{2})\.(\d{4})/) || []);
    const href = (t.match(/href="(\/it\/prodotto\/[^"]+)"/) || [])[1];
    out.push({
      id: 'aldi-' + id,
      brand: cls('product-tile__brandname'),
      name,
      size: cls('product-tile__unit-of-measurement'),
      unit: cls('product-tile__comparison-price').replace(/^\((.*)\)$/, '$1'),
      price, per: interval || undefined,
      old: was ? chf(text(was[1])) : null,
      pct: pct ? +pct[1] : null,
      from: from[3] ? `${from[3]}-${from[2]}-${from[1]}` : date,
      to: null,
      url: href ? ALDI + href : `${ALDI}/it/promozioni/${date}`
    });
  }
  return out;
}
async function aldi() {
  const home = await get(ALDI + '/it/promozioni');
  /* dai giorni elencati: quelli dell'ultima settimana (si trovano finché ci sono scorte) e quelli in arrivo */
  const dates = [...new Set([...home.matchAll(/\/it\/promozioni\/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]))]
    .filter((d) => d >= addDays(today, -7)).sort();
  const items = new Map();
  for (const d of dates) {
    for (let page = 1; page <= 10; page++) {
      const html = await get(`${ALDI}/it/promozioni/${d}${page > 1 ? '?page=' + page : ''}`).catch((e) => { console.warn('Aldi', e.message); return ''; });
      const tiles = aldiTiles(html, d);
      for (const it of tiles) if (!items.has(it.id)) items.set(it.id, { ...it, group: 'Promozioni dal ' + d.split('-').reverse().join('.') });
      await wait(700);
      if (!html.includes(`/it/promozioni/${d}?page=${page + 1}"`)) break;
    }
  }
  return [...items.values()];
}

/* ----------------------------- file ----------------------------- */
// Se un negozio non risponde si tengono le sue offerte di ieri (con la data vecchia): meglio che niente.
const prev = existsSync(OUT) ? (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) { return null; } })() : null;
const stores = {};
for (const [id, name, url, fn] of [['lidl', 'Lidl', LIDL + '/it', lidl], ['aldi', 'Aldi', ALDI + '/it/promozioni', aldi]]) {
  try {
    const items = await fn();
    if (!items.length) throw new Error('nessuna offerta trovata (la pagina è cambiata?)');
    /* offerte uguali all'ultima volta: stessa data e stesso file, così su GitHub non nasce un salvataggio inutile */
    const old = prev && prev.stores && prev.stores[id];
    const same = old && !old.error && JSON.stringify(old.items) === JSON.stringify(items);
    stores[id] = { name, url, updated: same ? old.updated : new Date().toISOString(), items };
    console.log(`${name}: ${items.length} offerte`);
  } catch (e) {
    console.error(`${name}: ${e.message}`);
    const old = prev && prev.stores && prev.stores[id];
    stores[id] = old ? { ...old, error: true } : { name, url, updated: null, error: true, items: [] };
  }
}
const updated = Object.values(stores).map((s) => s.updated || '').sort().pop() || new Date().toISOString();
writeFileSync(OUT, JSON.stringify({ version: 1, updated, stores }) + '\n');
if (Object.values(stores).every((s) => !s.items.length)) process.exit(1);
