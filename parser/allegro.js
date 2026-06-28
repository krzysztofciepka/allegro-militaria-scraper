// Allegro.pl listing parser. Pure JS, no dependencies.
// Same constraint as the original n8n Code node — runs under plain node AND inside n8n.
//
// Exports:
//   parseAllegro(html)          -> Offer[]   (core algorithm, preserved from existing workflow)
//   looksLikeDataDomeBlock(html) -> boolean  (true if response is a DataDome challenge page)
//   parseAllegroOffers(input)  -> n8n-item[] (outer loop wrapper used by Code node)

function parseAllegro(html) {
  const offers = [];
  const seen = new Set();

  function textOf(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (typeof t === 'object' && typeof t.text === 'string') return t.text;
    return '';
  }
  function numId(x) {
    return (x != null && /^\d{5,}$/.test(String(x))) ? String(x) : '';
  }
  function idOf(node) {
    return numId(node.offerId) || numId(node.id);
  }
  function priceOf(node) {
    const p = node.price || {};
    const cand =
      (p.mainPrice && p.mainPrice.amount) ||
      (p.normal && p.normal.amount) ||
      (p.buyNow && p.buyNow.amount) ||
      p.amount ||
      (typeof p === 'string' ? p : null);
    return cand || 'N/A';
  }
  function cleanUrl(node, id) {
    let u = typeof node.url === 'string' ? node.url : '';
    const rm = u.match(/[?&]redirect=([^&]+)/);
    if (rm) { try { u = decodeURIComponent(rm[1]); } catch (e) { /* keep u */ } }
    const om = u.match(/https?:\/\/[a-z.]*allegro[a-z.]*\/oferta\/[^?&"'<> ]+/i);
    if (om) return om[0];
    return id ? ('https://allegro.pl/oferta/' + id) : u;
  }
  function imgOf(node) {
    if (typeof node.mainThumbnail === 'string' && node.mainThumbnail) return node.mainThumbnail;
    const p = node.photos && node.photos[0];
    if (p) return p.small || p.medium || '';
    return '';
  }
  function looksLikeOffer(node) {
    return idOf(node) !== '' && textOf(node.title).length > 0 &&
      node.price && typeof node.price === 'object' && node.price.mainPrice;
  }
  function pushOffer(node) {
    const id = idOf(node);
    if (!id || seen.has(id)) return;
    seen.add(id);
    offers.push({
      id,
      title: (textOf(node.title) || node.alt || 'No title').trim(),
      url: cleanUrl(node, id),
      price: priceOf(node),
      img: imgOf(node),
    });
  }
  function walk(node, depth) {
    if (depth > 50 || node == null) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    if (typeof node === 'object') {
      if (looksLikeOffer(node)) pushOffer(node);
      for (const k in node) walk(node[k], depth + 1);
    }
  }

  // Strategy A: embedded JSON blocks (primary).
  const reScript = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = reScript.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { continue; }
    walk(data, 0);
  }

  // Strategy B: regex fallback over offer links (only if JSON yielded nothing).
  if (offers.length === 0) {
    const re = /https?:\/\/[a-z.]*allegro[a-z.]*\/oferta\/[^"'\\ <>]+/gi;
    while ((m = re.exec(html)) !== null) {
      const url = m[0];
      const rep = url.match(/[?&]rep=(\d+)/);
      const tail = url.match(/-(\d{5,})(?:[?#]|$)/);
      const id = rep ? rep[1] : (tail ? tail[1] : '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      offers.push({ id, title: 'No title', url: url.split('?')[0], price: 'N/A', img: '' });
    }
  }

  return offers;
}

function looksLikeDataDomeBlock(html) {
  if (!html || typeof html !== 'string') return false;
  // Real DataDome challenge pages contain captcha-delivery.com and a dd-challenge marker.
  return /captcha-delivery\.com/i.test(html)
      && /datadome/i.test(html)
      || /\/challenge\.[a-z]+\?/i.test(html)
      && /id="dd-challenge"/i.test(html);
}

function parseAllegroOffers(input) {
  // `input` is the n8n Code node's `$input.all()` array — but in n8n Code v2 we have
  // `$input.all()` directly; for standalone tests we accept a plain array.
  // Returns [{json: {...}}] items with namespaced id + source + (optional) warning.
  const items = [];
  const seenIds = new Set();
  let keywordForWarning = 'unknown';
  for (const entry of (Array.isArray(input) ? input : [])) {
    const raw = entry && entry.json ? (entry.json.data != null ? entry.json.data : (entry.json.body != null ? entry.json.body : '')) : '';
    const html = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // Try to recover the keyword from the entry (n8n doesn't always pass it through HTTP nodes).
    // We emit a single warning if the HTML looks like a DataDome block.
    if (looksLikeDataDomeBlock(html)) {
      items.push({ json: { id: 'allegro:skip:' + keywordForWarning, source: 'allegro', title: '⚠ Allegro scrape returned a DataDome block', url: '', price: '', img: '', warning: true } });
      continue;
    }
    for (const o of parseAllegro(html)) {
      if (seenIds.has(o.id)) continue;
      seenIds.add(o.id);
      items.push({ json: { id: 'allegro:' + o.id, source: 'allegro', title: o.title, url: o.url, price: o.price, img: o.img } });
    }
  }
  return items;
}

module.exports = { parseAllegro, looksLikeDataDomeBlock, parseAllegroOffers };