// Allegro Lokalnie listing parser. Pure JS, no deps.
// Lokalnie exposes offers as JSON-LD <script type="application/ld+json">ItemList</script>.
//
// Exports:
//   parseLokalnie(html)            -> Offer[]
//   parseLokalnieOffers(input, keyword) -> n8n-item[]   (outer loop wrapper; keyword is per-call)

function parseLokalnie(html) {
  const offers = [];
  const seen = new Set();
  if (!html || typeof html !== 'string') return offers;

  // Find all JSON-LD blocks; pick the first parseable ItemList.
  const reScript = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let itemList = null;
  while ((m = reScript.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { continue; }
    if (data && data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
      itemList = data.itemListElement;
      break;
    }
  }
  if (!itemList) return offers;

  function lastSlug(url) {
    if (!url) return '';
    const u = String(url).split(/[?#]/)[0].replace(/\/$/, '');
    const segs = u.split('/');
    return segs[segs.length - 1] || '';
  }
  function allegroNumIdFromUrl(url) {
    const m = /allegro\.pl\/oferta\/[^?#]+?-(\d{5,})\b/i.exec(String(url || ''));
    return m ? m[1] : '';
  }

  for (const li of itemList) {
    const item = li && li.item ? li.item : null;
    if (!item || typeof item !== 'object') continue;

    const name = item.name || 'No title';
    const url = item.url || '';
    const priceRaw = item.offers && typeof item.offers.price !== 'undefined'
      ? String(item.offers.price)
      : 'N/A';
    const img = (item.image && (item.image.contentUrl || item.image.url)) || '';
    const condition = item.itemCondition && /\/UsedCondition$/.test(item.itemCondition)
      ? 'used' : 'new';

    const allegroNum = allegroNumIdFromUrl(url);
    let id, source;
    if (allegroNum) {
      id = 'allegro:' + allegroNum;
      source = 'allegro-via-lokalnie';
    } else {
      const slug = lastSlug(url);
      if (!slug) continue; // skip items with no usable id
      id = 'lokalnie:' + slug;
      source = 'lokalnie';
    }
    if (seen.has(id)) continue;
    seen.add(id);
    offers.push({ id, source, title: name, url, price: priceRaw, img, condition });
  }
  return offers;
}

function parseLokalnieOffers(input, keyword) {
  // `input` is the n8n Code node's `$input.all()` array (array of {json:{...}}).
  // `keyword` is provided by the Split Keywords item via `$('Split Keywords').item.json.keyword`
  // in n8n, but for standalone use we accept it as a parameter.
  const items = [];
  const seenIds = new Set();
  const kw = keyword || 'unknown';
  for (const entry of (Array.isArray(input) ? input : [])) {
    const j = entry && entry.json ? entry.json : {};
    // If Continue On Fail produced an error marker, emit a warning.
    if (j.error || (j.__error && j.__error === true)) {
      items.push({ json: { id: 'lokalnie:skip:' + kw, source: 'lokalnie', title: '⚠ Lokalnie scrape failed for keyword: ' + kw, url: '', price: '', img: '', warning: true } });
      continue;
    }
    const raw = j.data != null ? j.data : (j.body != null ? j.body : '');
    const html = typeof raw === 'string' ? raw : (raw === '' ? '' : JSON.stringify(raw));
    if (looksLikeEmptyHtml(html)) {
      // Server returned an empty/blank page; treat as a soft warning.
      items.push({ json: { id: 'lokalnie:skip:' + kw, source: 'lokalnie', title: '⚠ Lokalnie returned empty HTML for keyword: ' + kw, url: '', price: '', img: '', warning: true } });
      continue;
    }
    for (const o of parseLokalnie(html)) {
      if (seenIds.has(o.id)) continue;
      seenIds.add(o.id);
      items.push({ json: o });
    }
  }
  return items;
}

function looksLikeEmptyHtml(html) {
  // Truly empty or just a skeleton with no ItemList вообще.
  return !html || html.trim().length < 200 || /<title>\s*<\/title>/i.test(html);
}

module.exports = { parseLokalnie, parseLokalnieOffers };