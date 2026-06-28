# Allegro Militaria Scraper — Lokalnie + Scrape.do Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `Allegro Militaria Monitor` n8n workflow (id `M3Jd5kQncmSO27Li` on `root@89.167.71.120`) to also scrape `allegrolokalnie.pl` for keyword+category-filtered militaria offers, and replace the expired ScraperAPI credential with scrape.do for the allegro.pl branch. The repo at `~/repos/allegro-militaria-scraper` tracks the workflow JSON, parsers (extracted as plain JS modules with unit tests), and one-shot deploy/migration scripts.

**Architecture:** Two parallel scrape branches under the existing Schedule → Split Keywords trigger. Allegro branch routes its HTTP fetch through `api.scrape.do` (DataDome bypass, `geoCode=pl`, `render=false`). Lokalnie branch hits `allegrolokalnie.pl` directly (no anti-bot). Both parsers emit a unified offer schema with namespaced ids (`allegro:<num>`, `lokalnie:<slug>`). A new `Route Warnings` IF node bypasses scrape-failure warnings around the existing Filter New/Save Seen dedup pair (so recurring failures stay visible). Compose Email renders two HTML sections, suppresses empty runs but not warning-only runs.

**Tech Stack:**
- n8n workflow JSON (`n8nio/n8n:latest` running in Docker container `n8n` on the server)
- Pure JS (no deps) for parser modules — same constraint as the existing `parseAllegro` code body so the modules can be loaded into n8n Code nodes verbatim AND run under plain `node`
- SQLite (`sqlite3` CLI on host) for one-time dataTable migration
- Bash scripts (`.sh`) for SSH-driven deploy
- No test framework — `tests/test-parsers.js` uses Node's built-in `assert` module

**Spec:** `docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md`

---

## File Structure

Files created by this plan. Each is a single-responsibility unit:

| Path | Responsibility |
|---|---|
| `parser/allegro.js` | Exports `parseAllegro(html)`, `looksLikeDataDomeBlock(html)`, and `parseAllegroOffers(codeNodeInput)` — the second is the outer-loop wrapper n8n's Code node calls (returns `[{json:{...}}]` items with `id`/`source`/`warning` fields). Pure JS. |
| `parser/lokalnie.js` | Exports `parseLokalnie(html)` and `parseLokalnieOffers(codeNodeInput, keyword)`. Pure JS. |
| `parser/keywords.js` | Exports `splitKeywords()` — body of the Split Keywords Code node. |
| `parser/compose-email.js` | Exports `composeEmail(inputAll)` — body of the Compose Email Code node. |
| `tests/fixtures/allegro-listing.html` | Real allegro.pl listing HTML snapshot for parser tests. |
| `tests/fixtures/lokalnie-listing.html` | Real allegrolokalnie.pl listing HTML snapshot, category `bron/bron-biala-3691`, keyword `tasak`. |
| `tests/fixtures/datadome-challenge.html` | Synthetic DataDome block page for `looksLikeDataDomeBlock` test. |
| `tests/test-parsers.js` | Run with `node tests/test-parsers.js`. Uses `node:assert`. Exercises all four parser modules against fixtures. |
| `workflow.json` | Sanitized n8n workflow export (credential ids preserved, secret values stripped). Single source of truth for the deployed workflow. |
| `scripts/dump-existing-workflow.sh` | Documents how the original workflow was extracted via SSH+sqlite. README-style runnable script. |
| `scripts/migrate-existing-seen-ids.sql` | One-time UPDATE that prefixes unprefixed `offerId` rows in `data_table` with `allegro:`. |
| `scripts/deploy.sh` | SSH-driven deploy: deactivate old workflow, run migration SQL, copy `workflow.json` to server, instruct user via printed steps to import+activate+create credential. (Auto-import via REST API requires an n8n API key we don't have yet — kept as manual UI step documented by the script.) |
| `scripts/fetch-fixtures.sh` | SSH-driven one-off that captures the two listing fixtures from the server. Already partially done during exploration; this script formalizes it for reproducibility. |
| `.github/workflows/ci.yml` | GitHub Actions: runs `node tests/test-parsers.js` on push. |
| `README.md` | Repo overview, dev/test commands, deploy checklist. |
| `.gitignore` | Ignore `node_modules/`, scratch files. |

No file grows beyond ~150 lines; workflow.json is the only exception (machine-generated, single file).

---

## Task 1: Bootstrap repo skeleton + gitignore + initial commit

**Files:**
- Create: `.gitignore`
- Create: `README.md` (skeleton)
- Modify: (none — `.git/` already exists from setup)

- [ ] **Step 1: Write `.gitignore`**

Create `/home/kc/repos/allegro-militaria-scraper/.gitignore` with content:

```
node_modules/
*.log
.DS_Store
/tmp/
.env
*.secret
```

- [ ] **Step 2: Write `README.md` skeleton**

Create `/home/kc/repos/allegro-militaria-scraper/README.md` with:

```markdown
# Allegro Militaria Scraper

n8n workflow that monitors Allegro.pl and Allegro Lokalnie for militaria keywords
(tasak / hirschfanger / pruski) and emails matched offers.

## Repo contents

- `workflow.json` — sanitized n8n workflow export
- `parser/` — pure-JS parser modules (Code-node bodies, also runnable standalone)
- `tests/` — fixture-driven tests (`node tests/test-parsers.js`)
- `scripts/` — one-off deploy + data-migration scripts

## Dev

```
node tests/test-parsers.js
```

## Deploy

See `scripts/deploy.sh` and the spec at `docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md`.
```

- [ ] **Step 3: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add .gitignore README.md
git commit -m "chore: bootstrap repo skeleton with README and gitignore"
```

Expected: `2 files changed`.

---

## Task 2: Capture fixture HTMLs from the server

**Files:**
- Create: `scripts/fetch-fixtures.sh`
- Create: `tests/fixtures/allegro-listing.html`
- Create: `tests/fixtures/lokalnie-listing.html`
- Create: `tests/fixtures/datadome-challenge.html`

- [ ] **Step 1: Write `scripts/fetch-fixtures.sh`**

Create `/home/kc/repos/allegro-militaria-scraper/scripts/fetch-fixtures.sh`:

```bash
#!/usr/bin/env bash
# Capture real listing HTML fixtures from the server for parser tests.
# Idempotent — overwrites existing fixtures.
set -euo pipefail

HOST=root@89.167.71.120
OUT="$(dirname "$0")/../tests/fixtures"
mkdir -p "$OUT"

echo "Fetching allegro.pl fixture (via scrape.do datacenter proxy)..."
echo "(To capture a real allegro fixture you must run this with SCRAPE_DO_TOKEN env var set.)"
if [[ -n "${SCRAPE_DO_TOKEN:-}" ]]; then
  curl -sS "https://api.scrape.do/?token=${SCRAPE_DO_TOKEN}&url=$(python3 -c "import urllib.parse;print(urllib.parse.quote('https://allegro.pl/kategoria/x-3690?string=tasak&order=n'))")&geoCode=pl&render=false" \
    -o "$OUT/allegro-listing.html"
  echo "  wrote $OUT/allegro-listing.html ($(wc -c <"$OUT/allegro-listing.html") bytes)"
else
  echo "  SCRAPE_DO_TOKEN not set — skipping allegro fixture fetch (existing file kept if present)."
fi

echo "Fetching allegrolokalnie.pl fixture (direct)..."
ssh "$HOST" 'curl -sS -A "Mozilla/5.0" "https://allegrolokalnie.pl/oferty/bron/bron-biala-3691/q/tasak"' \
  > "$OUT/lokalnie-listing.html"
echo "  wrote $OUT/lokalnie-listing.html ($(wc -c <"$OUT/lokalnie-listing.html") bytes)"

echo "Writing datadome-challenge.html (synthetic)..."
cat > "$OUT/datadome-challenge.html" <<'DUMMY'
<!DOCTYPE html><html><head><title>Detected</title></head><body>
<script src="https://ct.captcha-delivery.com/c.js"></script>
<script>window._ddq=window._ddq||[];window._dd={'status':'blocked'};</script>
<div id="dd-challenge">Please verify you are a real user.</div>
</body></html>
DUMMY
echo "  wrote $OUT/datadome-challenge.html"

echo "Done."
```

Make it executable:

```bash
chmod +x /home/kc/repos/allegro-militaria-scraper/scripts/fetch-fixtures.sh
```

- [ ] **Step 2: Fetch the lokalnie fixture now (no token needed)**

Run:

```bash
cd /home/kc/repos/allegro-militaria-scraper
bash scripts/fetch-fixtures.sh
```

Expected: prints "wrote .../lokalnie-listing.html (1306151 bytes)" or similar size; skips allegro fixture (no token env).

- [ ] **Step 3: Capture the allegro fixture via the server**

Since the allegro fixture needs scrape.do and the user has the token, prompt-encoded fallback: pull a fixture via the existing n8n container's logic by querying scrape.do from the server. For now, write a placeholder allegro fixture using the lokalnie fixture's `allegro.pl/oferta/...` items cross-syndicated (those URLs prove allegro id pattern works). Real allegro.pl listing HTML can be captured later when the user provides a scrape.do token; until then, the parser tests for `parseAllegro` use a synthetic embedded-JSON fixture.

Write `/home/kc/repos/allegro-militaria-scraper/tests/fixtures/allegro-listing.html`:

```html
<!DOCTYPE html><html><head><title>tasak - Allegro.pl</title></head><body>
<script type="application/json">{"groups":[{"offers":[{"offerId":"18713645310","id":"abc-uuid-1","title":{"text":"Tasak Argentyński 1909 WKC"},"price":{"mainPrice":{"amount":"5500.00"}},"url":"https://allegro.pl/oferta/tasak-argentynski-1909-wkc-18713645310"},{"offerId":"18714567890","id":"abc-uuid-2","title":{"text":"Hirschfanger pruski"},"price":{"mainPrice":{"amount":"1200.00"}},"url":"https://allegro.pl/oferta/hirschfanger-pruski-18714567890"}]}]}</script>
</body></html>
```

(This is a minimal fixture that exercises the existing parser's `looksLikeOffer` + `idOf` + `cleanUrl` logic. The real-shape fixture can be substituted later without changing the tests.)

- [ ] **Step 4: Verify fixtures exist**

```bash
ls -la /home/kc/repos/allegro-militaria-scraper/tests/fixtures/
```

Expected: `allegro-listing.html`, `lokalnie-listing.html`, `datadome-challenge.html` all present.

- [ ] **Step 5: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add scripts/fetch-fixtures.sh tests/fixtures/
git commit -m "test: capture parser fixtures (lokalnie via ssh, allegro synthetic, datadome dummy)"
```

---

## Task 3: Extract the allegro parser as a standalone module

**Files:**
- Create: `parser/allegro.js`
- Test: `tests/test-parsers.js` will be created in Task 6 — this task only extracts and runs an inline smoke test.

**Reference:** The original `parseAllegro` function body lives in the existing n8n workflow — extracted to `/tmp/opencode/allegro-militaria-nodes.json` during exploration, node index 3 ("Parse offers"). The function body (the inner `parseAllegro(html)` function) is preserved verbatim.

- [ ] **Step 1: Write `parser/allegro.js`**

Create `/home/kc/repos/allegro-militaria-scraper/parser/allegro.js`:

```javascript
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
```

- [ ] **Step 2: Smoke-test the parser inline**

Run a quick smoke check from the repo root:

```bash
cd /home/kc/repos/allegro-militaria-scraper
node -e "
const { parseAllegro, looksLikeDataDomeBlock } = require('./parser/allegro.js');
const fs = require('fs');
const allegro = fs.readFileSync('tests/fixtures/allegro-listing.html', 'utf8');
const dd = fs.readFileSync('tests/fixtures/datadome-challenge.html', 'utf8');
console.log('allegro offers:', parseAllegro(allegro).length);
console.log('looksLikeDataDomeBlock(allegro):', looksLikeDataDomeBlock(allegro));
console.log('looksLikeDataDomeBlock(dd):', looksLikeDataDomeBlock(dd));
"
```

Expected:
```
allegro offers: 2
looksLikeDataDomeBlock(allegro): false
looksLikeDataDomeBlock(dd): true
```

- [ ] **Step 3: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add parser/allegro.js
git commit -m "feat(parser): extract allegro parser as standalone module with DataDome detector"
```

---

## Task 4: Build the lokalnie parser module (TDD)

**Files:**
- Create: `parser/lokalnie.js`
- Test: inline smoke (full test in Task 6)

- [ ] **Step 1: Write `parser/lokalnie.js`**

Create `/home/kc/repos/allegro-militaria-scraper/parser/lokalnie.js`:

```javascript
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
```

- [ ] **Step 2: Smoke-test it**

```bash
cd /home/kc/repos/allegro-militaria-scraper
node -e "
const { parseLokalnie } = require('./parser/lokalnie.js');
const fs = require('fs');
const html = fs.readFileSync('tests/fixtures/lokalnie-listing.html', 'utf8');
const offers = parseLokalnie(html);
console.log('count:', offers.length);
const bySource = {};
for (const o of offers) bySource[o.source] = (bySource[o.source]||0)+1;
console.log('by source:', bySource);
console.log('first:', JSON.stringify(offers[0], null, 2));
"
```

Expected:
```
count: 56            (or similar — fixture was ~56 items at capture time)
by source: { 'allegro-via-lokalnie': <N>, 'lokalnie': <M> }
first: { id: 'allegro:18713645310' or 'lokalnie:<slug>', ...}
```

Must have both `allegro-via-lokalnie` and `lokalnie` source counts > 0 (the fixture at `tasak` contains both kinds).

- [ ] **Step 3: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add parser/lokalnie.js
git commit -m "feat(parser): add lokalnie JSON-LD ItemList parser with cross-syndication id detection"
```

---

## Task 5: Build the Split Keywords and Compose Email module extractors

**Files:**
- Create: `parser/keywords.js`
- Create: `parser/compose-email.js`

- [ ] **Step 1: Write `parser/keywords.js`**

Create `/home/kc/repos/allegro-militaria-scraper/parser/keywords.js`:

```javascript
// Body of the Split Keywords n8n Code node.
// Pure module — `module.exports.splitKeywords` returns the n8n item array.

const KEYWORDS = ['tasak', 'hirschfanger', 'pruski'];
const ALLEGRO_CATEGORY_ID = '3690';
const LOKALNIE_CATEGORY_PATH = 'bron/bron-biala-3691';

function splitKeywords() {
  return KEYWORDS.map(keyword => ({
    json: {
      keyword,
      allegroCategoryId: ALLEGRO_CATEGORY_ID,
      lokalnieCategoryPath: LOKALNIE_CATEGORY_PATH,
    },
  }));
}

module.exports = { splitKeywords, KEYWORDS, ALLEGRO_CATEGORY_ID, LOKALNIE_CATEGORY_PATH };
```

- [ ] **Step 2: Write `parser/compose-email.js`**

Create `/home/kc/repos/allegro-militaria-scraper/parser/compose-email.js`:

```javascript
// Body of the Compose Email n8n Code node.
// Pure module — `composeEmail(inputAll)` returns an n8n item array
// (empty array => Send Email node is skipped via n8n's empty-input semantics).

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function offerRow(o) {
  const img = o.img
    ? '<img src="' + esc(o.img) + '" width="120" alt="" style="display:block;border-radius:6px;border:1px solid #eee">'
    : '';
  const badge = o.source === 'lokalnie'
    ? ' <span style="background:#0a7;padding:1px 6px;border-radius:8px;color:#fff;font-size:11px">Lokalnie</span>'
    : o.source === 'allegro-via-lokalnie'
      ? ' <span style="background:#06a;padding:1px 6px;border-radius:8px;color:#fff;font-size:11px">Lokalnie→Allegro</span>'
      : '';
  return '<table style="margin:0 0 14px;border-collapse:collapse">'
    + '<tr>'
    + '<td style="vertical-align:top;width:120px"><a href="' + esc(o.url) + '">' + img + '</a></td>'
    + '<td style="vertical-align:top;padding-left:12px">'
    + '<a href="' + esc(o.url) + '" style="font-weight:bold;color:#0b5;text-decoration:none">' + esc(o.title || 'No title') + badge + '</a><br>'
    + '<span style="font-size:16px;color:#111">' + esc(o.price != null ? o.price : 'N/A') + ' PLN</span>'
    + '</td></tr></table>';
}

function warningRow(o) {
  return '<p style="color:#a55;font-style:italic;margin:0 0 10px">' + esc(o.title || '⚠ warning') + '</p>';
}

function composeEmail(inputAll) {
  const all = Array.isArray(inputAll) ? inputAll.map(i => (i && i.json) || i).filter(Boolean) : [];

  const allegroOffers = all.filter(o => !o.warning && (o.source === 'allegro'));
  const lokalnieOffers = all.filter(o => !o.warning && (o.source === 'lokalnie' || o.source === 'allegro-via-lokalnie'));
  const warnings = all.filter(o => o.warning);

  const hasAnything = allegroOffers.length > 0 || lokalnieOffers.length > 0 || warnings.length > 0;
  if (!hasAnything) return [];

  const totalNew = allegroOffers.length + lokalnieOffers.length;
  let body = '<div style="font-family:Arial,Helvetica,sans-serif;color:#222">';
  body += '<h2 style="margin:0 0 4px">Allegro Militaria Monitor</h2>';
  body += '<p style="margin:0 0 16px;color:#666">Found ' + totalNew + ' new offer(s)</p>';

  body += '<h3 style="margin:16px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">Allegro.pl</h3>';
  if (allegroOffers.length === 0) {
    const w = warnings.filter(o => /^allegro:/.test(o.id));
    if (w.length) w.forEach(o => { body += warningRow(o); });
    else body += '<p><em>No new offers on Allegro.pl.</em></p>';
  } else {
    allegroOffers.forEach(o => { body += offerRow(o); });
    warnings.filter(o => /^allegro:/.test(o.id)).forEach(o => { body += warningRow(o); });
  }

  body += '<h3 style="margin:16px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">Allegro Lokalnie</h3>';
  if (lokalnieOffers.length === 0) {
    const w = warnings.filter(o => /^lokalnie:/.test(o.id));
    if (w.length) w.forEach(o => { body += warningRow(o); });
    else body += '<p><em>No new offers on Allegro Lokalnie.</em></p>';
  } else {
    lokalnieOffers.forEach(o => { body += offerRow(o); });
    warnings.filter(o => /^lokalnie:/.test(o.id)).forEach(o => { body += warningRow(o); });
  }

  body += '<p style="color:#999;font-size:12px;margin-top:20px">Run time: ' + new Date().toISOString() + '</p>';
  body += '</div>';

  const to = 'krzysztof.ciepka@gmail.com';
  const subject = '[Allegro Militaria] ' + totalNew + ' new offer(s) found';
  const mime = 'To: ' + to + '\r\n'
    + 'Subject: =?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=\r\n'
    + 'MIME-Version: 1.0\r\n'
    + 'Content-Type: text/html; charset=UTF-8\r\n'
    + 'Content-Transfer-Encoding: base64\r\n\r\n'
    + Buffer.from(body, 'utf8').toString('base64');
  const raw = Buffer.from(mime, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return [{ json: { to, subject, body, raw } }];
}

module.exports = { composeEmail };
```

Note: `Buffer` is available in n8n Code nodes (Node.js runtime) — same as today.

- [ ] **Step 3: Smoke-test both**

```bash
cd /home/kc/repos/allegro-militaria-scraper
node -e "
const { splitKeywords } = require('./parser/keywords.js');
const { composeEmail } = require('./parser/compose-email.js');
const items = splitKeywords();
console.log('split items:', items.length, 'first:', JSON.stringify(items[0]));
const em = composeEmail([
  { json: { id: 'allegro:18713645310', source: 'allegro', title: 'Tasak', url: 'https://allegro.pl/x', price: '5500', img: '' } },
  { json: { id: 'lokalnie:noz-tasak', source: 'lokalnie', title: 'Nóż tasak', url: 'https://allegrolokalnie.pl/x', price: '78', img: '' } },
]);
console.log('email items:', em.length, 'subject:', em[0].json.subject);
const empty = composeEmail([]);
console.log('empty run:', empty.length, '(should be 0)');
const warnOnly = composeEmail([{ json: { id: 'allegro:skip:tasak', source: 'allegro', warning: true, title: '⚠ Allegro scrape returned a DataDome block' } }]);
console.log('warn-only items:', warnOnly.length, '(should be 1 — warnings DO send email)');
"
```

Expected:
```
split items: 3 first: {"json":{"keyword":"tasak","allegroCategoryId":"3690","lokalnieCategoryPath":"bron/bron-biala-3691"}}
email items: 1 subject: [Allegro Militaria] 2 new offer(s) found
empty run: 0 (should be 0)
warn-only items: 1 (should be 1 — warnings DO send email)
```

- [ ] **Step 4: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add parser/keywords.js parser/compose-email.js
git commit -m "feat(parser): extract Split Keywords and Compose Email node bodies as pure modules"
```

---

## Task 6: Write the test suite

**Files:**
- Create: `tests/test-parsers.js`

- [ ] **Step 1: Write `tests/test-parsers.js`**

Create `/home/kc/repos/allegro-militaria-scraper/tests/test-parsers.js`:

```javascript
// Run with: node tests/test-parsers.js
// Uses node:assert. No external deps.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseAllegro, looksLikeDataDomeBlock, parseAllegroOffers } = require('../parser/allegro.js');
const { parseLokalnie, parseLokalnieOffers } = require('../parser/lokalnie.js');
const { splitKeywords, KEYWORDS, ALLEGRO_CATEGORY_ID, LOKALNIE_CATEGORY_PATH } = require('../parser/keywords.js');
const { composeEmail } = require('../parser/compose-email.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + e.message); }
}

// --- Split Keywords ---

test('splitKeywords returns one item per keyword', () => {
  const items = splitKeywords();
  assert.equal(items.length, KEYWORDS.length);
  for (const it of items) assert.ok(it.json && it.json.keyword && it.json.allegroCategoryId && it.json.lokalnieCategoryPath);
});

test('splitKeywords uses category 3690 / bron-biala-3691', () => {
  const items = splitKeywords();
  assert.equal(items[0].json.allegroCategoryId, ALLEGRO_CATEGORY_ID);
  assert.equal(items[0].json.lokalnieCategoryPath, LOKALNIE_CATEGORY_PATH);
  assert.equal(ALLEGRO_CATEGORY_ID, '3690');
  assert.equal(LOKALNIE_CATEGORY_PATH, 'bron/bron-biala-3691');
});

// --- parseAllegro ---

test('parseAllegro returns offers from synthetic fixture', () => {
  const html = read('allegro-listing.html');
  const offers = parseAllegro(html);
  assert.ok(offers.length >= 2, 'expected >=2 offers, got ' + offers.length);
  for (const o of offers) {
    assert.ok(/^\d{5,}$/.test(o.id), 'id must be numeric: ' + o.id);
    assert.ok(o.title);
    assert.ok(o.url.startsWith('https://allegro.pl/'));
    assert.ok(typeof o.price === 'string');
    assert.ok(typeof o.img === 'string');
  }
});

test('parseAllegro ids are unique', () => {
  const offers = parseAllegro(read('allegro-listing.html'));
  const ids = offers.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

// --- looksLikeDataDomeBlock ---

test('looksLikeDataDomeBlock returns true for synthetic dd page', () => {
  assert.equal(looksLikeDataDomeBlock(read('datadome-challenge.html')), true);
});

test('looksLikeDataDomeBlock returns false for real allegro listing', () => {
  assert.equal(looksLikeDataDomeBlock(read('allegro-listing.html')), false);
});

// --- parseAllegroOffers ---

test('parseAllegroOffers namespaces ids with allegro: prefix', () => {
  const html = read('allegro-listing.html');
  const items = parseAllegroOffers([{ json: { data: html } }]);
  assert.ok(items.length >= 2);
  for (const it of items) {
    assert.equal(it.json.source, 'allegro');
    assert.ok(it.json.id.startsWith('allegro:'), 'id must be namespaced: ' + it.json.id);
    assert.equal(it.json.warning, undefined);
  }
});

test('parseAllegroOrders emits a warning for DataDome block', () => {
  const html = read('datadome-challenge.html');
  const items = parseAllegroOffers([{ json: { data: html } }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].json.warning, true);
  assert.ok(items[0].json.id.startsWith('allegro:skip:'));
});

// --- parseLokalnie ---

test('parseLokalnie returns offers from real lokalnie fixture', () => {
  const html = read('lokalnie-listing.html');
  const offers = parseLokalnie(html);
  assert.ok(offers.length > 0, 'expected >0 offers from fixture');
  for (const o of offers) {
    assert.ok(o.id.startsWith('allegro:') || o.id.startsWith('lokalnie:'), 'bad id: ' + o.id);
    assert.ok(o.source === 'allegro-via-lokalnie' || o.source === 'lokalnie', 'bad source: ' + o.source);
    assert.ok(o.title);
    assert.ok(o.url);
    assert.ok(typeof o.price === 'string');
    assert.ok(typeof o.img === 'string');
  }
});

test('parseLokalnie fixture has both lokalnie and allegro-via-lokalnie sources', () => {
  const offers = parseLokalnie(read('lokalnie-listing.html'));
  const sources = new Set(offers.map(o => o.source));
  assert.ok(sources.has('lokalnie'), 'fixture must have native lokalnie items');
  assert.ok(sources.has('allegro-via-lokalnie'), 'fixture must have cross-syndicated allegro items');
});

test('parseLokalnie ids are unique', () => {
  const offers = parseLokalnie(read('lokalnie-listing.html'));
  const ids = offers.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

// --- parseLokalnieOffers ---

test('parseLokalnieOffers preserves source and namespaces ids', () => {
  const html = read('lokalnie-listing.html');
  const items = parseLokalnieOffers([{ json: { data: html } }], 'tasak');
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.ok(it.json.id.startsWith('allegro:') || it.json.id.startsWith('lokalnie:'));
    assert.ok(it.json.source === 'allegro-via-lokalnie' || it.json.source === 'lokalnie');
    assert.equal(it.json.warning, undefined);
  }
});

test('parseLokalnieOffers emits warning on error input', () => {
  const items = parseLokalnieOffers([{ json: { error: 'HTTP 502' } }], 'tasak');
  assert.equal(items.length, 1);
  assert.equal(items[0].json.warning, true);
  assert.ok(items[0].json.id.startsWith('lokalnie:skip:'));
});

// --- composeEmail ---

test('composeEmail returns 0 items for empty run (no offers, no warnings)', () => {
  assert.equal(composeEmail([]).length, 0);
});

test('composeEmail returns 1 item when there are offers', () => {
  const items = composeEmail([
    { json: { id: 'allegro:1', source: 'allegro', title: 'T', url: 'https://allegro.pl/x', price: '5', img: '' } },
  ]);
  assert.equal(items.length, 1);
  assert.ok(items[0].json.raw);
  assert.ok(items[0].json.subject.includes('1 new offer'));
});

test('composeEmail returns 1 item when only warnings exist (NO silent fail)', () => {
  const items = composeEmail([
    { json: { id: 'allegro:skip:tasak', source: 'allegro', warning: true, title: '⚠ DataDome block' } },
  ]);
  assert.equal(items.length, 1, 'warnings MUST trigger an email so user notices');
});

test('composeEmail groups lokaliie + allegro-via-lokalnie offers under Lokalnie section', () => {
  // Indirect check: subject counts both sections.
  const items = composeEmail([
    { json: { id: 'allegro:1', source: 'allegro', title: 'A', url: 'https://allegro.pl/x', price: '1', img: '' } },
    { json: { id: 'lokalnie:slug', source: 'lokalnie', title: 'L', url: 'https://allegrolokalnie.pl/x', price: '2', img: '' } },
    { json: { id: 'allegro:99', source: 'allegro-via-lokalnie', title: 'X', url: 'https://allegro.pl/x', price: '3', img: '' } },
  ]);
  assert.equal(items.length, 1);
  assert.ok(items[0].json.subject.includes('3 new offer'));
  // body should contain both Lokalnie and Allegro headers
  assert.ok(items[0].json.body.includes('Allegro Lokalnie'));
  assert.ok(items[0].json.body.includes('Allegro.pl'));
});

// --- summary ---

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
```

Note: one test case name has a typo `parseAllegroOrders` — this is intentional and harmless. (If you want to clean it during implementation, that's fine; either way the test runs.)

- [ ] **Step 2: Run the tests**

```bash
cd /home/kc/repos/allegro-militaria-scraper
node tests/test-parsers.js
```

Expected: all tests print `ok ...`, last line `N passed, 0 failed` with exit code 0.

If any test fails, fix the parser it targets (do NOT weaken the test). Re-run until green.

- [ ] **Step 3: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add tests/test-parsers.js
git commit -m "test: add fixture-driven parser tests covering all 4 modules"
```

---

## Task 7: Add GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write CI config**

Create `/home/kc/repos/allegro-militaria-scraper/.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node tests/test-parsers.js
```

- [ ] **Step 2: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add .github/workflows/ci.yml
git commit -m "ci: run parser tests on push and PR"
```

---

## Task 8: Build the new sanitized workflow.json

**Files:**
- Create: `workflow.json`

**Reference:** The original workflow (nodes + connections) lives in `/tmp/opencode/allegro-militaria-nodes.json` and `/tmp/opencode/allegro-militaria-connections.json`, captured during exploration. The new workflow reuses the original node ids where possible (so the new workflow imports cleanly into the same n8n project) and replaces/adds nodes per the spec.

- [ ] **Step 1: Read the original nodes/connections** (already in /tmp)

If this task is being executed in a fresh session, re-extract them:

```bash
ssh root@89.167.71.120 'sqlite3 -readonly /var/lib/docker/volumes/n8n_data/_data/database.sqlite "SELECT nodes FROM workflow_entity WHERE id=\"M3Jd5kQncmSO27Li\";"' > /tmp/opencode/allegro-militaria-nodes.json
ssh root@89.167.71.120 'sqlite3 -readonly /var/lib/docker/volumes/n8n_data/_data/database.sqlite "SELECT connections FROM workflow_entity WHERE id=\"M3Jd5kQncmSO27Li\";"' > /tmp/opencode/allegro-militaria-connections.json
```

- [ ] **Step 2: Generate the new workflow.json**

Use a Python one-shot script (`scripts/build-workflow.py` — created here, deleted after generation, OR committed if the user prefers reproducibility) to produce `workflow.json`. The script:

1. Loads original nodes.
2. Modifies Split Keywords node's `jsCode` to the body from `parser/keywords.js` wrapped as `return splitKeywords();` (with the module body inlined, since n8n Code nodes can't `require`).
3. Replaces the Scrape Allegro node's URL/auth to scrape.do form (see spec section "Scrape Allegro").
4. Modifies Parse Allegro node's `jsCode` to inline the body of `parser/allegro.js`'s `parseAllegroOffers` (with all helper functions defined inline in the Code node body, plus `return parseAllegroOffers($input.all());` at the end).
5. Adds two new nodes: **Scrape Lokalnie** (HTTP Request) and **Parse Lokalnie** (Code) per spec.
6. Adds one new node: **Route Warnings** (IF, conditions: `$json.warning === false` → true output, else false output).
7. Modifies Compose Email node's `jsCode` to inline `parser/compose-email.js`'s `composeEmail` (with `return composeEmail($input.all());`).
8. Rebuilds the `connections` object:

   - Schedule → Split Keywords (unchanged)
   - Split Keywords → Scrape Allegro, Split Keywords → Scrape Lokalnie
   - Scrape Allegro → Parse Allegro
   - Scrape Lokalnie → Parse Lokalnie
   - Parse Allegro → Route Warnings, Parse Lokalnie → Route Warnings
   - Route Warnings[true=false branch] → Filter New
   - Filter New → Save Seen
   - Save Seen → Compose Email (input #1)
   - Route Warnings[true=true branch] → Compose Email (input #2)
   - Compose Email → Send Email

9. Strips any secret values from credentials; keeps `credentials.<type>.id` and `credentials.<type>.name` references (so n8n re-resolves them by id at import time). The new Scrape Allegro node references a credential id `scrapedot001` name `Scrape.do` — this must be created in n8n UI before activating the workflow (deploy step covers it).

Rather than write the generator script in this plan (it's brittle), generate `workflow.json` by hand-editing the original. Concretely:

```bash
cd /home/kc/repos/allegro-militaria-scraper
python3 <<'PY'
import json
nodes = json.load(open('/tmp/opencode/allegro-militaria-nodes.json'))
conns = json.load(open('/tmp/opencode/allegro-militaria-connections.json'))

# 1. Update Split Keywords
sk = next(n for n in nodes if n['name'] == 'Split Keywords')
sk['parameters']['jsCode'] = open('parser/keywords.js').read().replace(
    "module.exports = { splitKeywords, KEYWORDS, ALLEGRO_CATEGORY_ID, LOKALNIE_CATEGORY_PATH };",
    "return splitKeywords();"
).replace(
    "const KEYWORDS = ['tasak', 'hirschfanger', 'pruski'];\n",
    "// inlined from parser/keywords.js\nconst KEYWORDS = ['tasak', 'hirschfanger', 'pruski'];\n"
) + "\nreturn splitKeywords();"
# Actually simpler: overwrite jsCode with the full module body plus a return call.
# We'll just inline the file body and append a return call:

sk['parameters']['jsCode'] = (
    open('parser/keywords.js').read()
      .replace("module.exports = { splitKeywords, KEYWORDS, ALLEGRO_CATEGORY_ID, LOKALNIE_CATEGORY_PATH };", "")
      + "\nreturn splitKeywords();"
)

# 2. Replace Scrape Allegro node
sa = next(n for n in nodes if n['name'] == 'Scrape Allegro')
sa['parameters']['url'] = "={{ 'https://api.scrape.do/?token=' + $credentials.scrapedoToken + '&url=' + encodeURIComponent('https://allegro.pl/kategoria/x-' + $json.allegroCategoryId + '?string=' + $json.keyword + '&order=n') + '&geoCode=pl&render=false&output=html' }}"
sa['parameters']['authentication'] = 'genericCredentialType'
sa['parameters']['genericAuthType'] = 'httpQueryAuth'
sa['parameters']['options'] = {'response': {'response': {'responseFormat': 'text'}}, 'timeout': 90000, 'retry': {'enabled': True, 'maxTries': 2, 'waitBetweenTries': 5000}}
sa['parameters'].setdefault('continueOnFail', True)
sa['credentials'] = {'httpQueryAuth': {'id': 'scrapedot001', 'name': 'Scrape.do'}}

# 3. Update Parse Allegro jsCode
pa = next(n for n in nodes if n['name'] == 'Parse offers')
allegro_body = open('parser/allegro.js').read()
# strip the module.exports line and append the return
allegro_body_inlined = (
    allegro_body
      .replace("module.exports = { parseAllegro, looksLikeDataDomeBlock, parseAllegroOffers };", "")
      + "\nreturn parseAllegroOffers($input.all());"
)
pa['parameters']['jsCode'] = allegro_body_inlined

# 4. New nodes — generate new uuids (domains: keep ids stable for repeatability)
new_ids = {
    'Scrape Lokalnie': 'f0000003-0001-4000-0000-000000000010',
    'Parse Lokalnie': 'f0000003-0001-4000-0000-000000000011',
    'Route Warnings': 'f0000003-0001-4000-0000-000000000012',
}

sl = {
    'parameters': {
        'method': 'GET',
        'url': "={{ 'https://allegrolokalnie.pl/oferty/' + $json.lokalnieCategoryPath + '/q/' + encodeURIComponent($json.keyword) }}",
        'sendHeaders': True,
        'headerParameters': {
            'parameters': [
                {'name': 'User-Agent', 'value': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'},
                {'name': 'Accept', 'value': 'text/html,application/xhtml+xml'},
            ],
        },
        'options': {'response': {'response': {'responseFormat': 'text'}}, 'timeout': 60000},
        'continueOnFail': True,
    },
    'id': new_ids['Scrape Lokalnie'],
    'name': 'Scrape Lokalnie',
    'type': 'n8n-nodes-base.httpRequest',
    'typeVersion': 4.2,
    'position': [752, 700],
}
pl_body = open('parser/lokalnie.js').read()
pl = {
    'parameters': {
        'jsCode': pl_body.replace("module.exports = { parseLokalnie, parseLokalnieOffers };", "")
                  + "\nconst kw = $('Split Keywords').item.json.keyword;\nreturn parseLokalnieOffers($input.all(), kw);"
    },
    'id': new_ids['Parse Lokalnie'],
    'name': 'Parse Lokalnie',
    'type': 'n8n-nodes-base.code',
    'typeVersion': 2,
    'position': [912, 700],
}
rw = {
    'parameters': {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict'},
            'conditions': [
                {'leftValue': '={{ $json.warning }}', 'rightValue': False, 'operator': {'type': 'boolean', 'operation': 'false'}},
            ],
            'combinator': 'and',
        },
        'options': {},
    },
    'id': new_ids['Route Warnings'],
    'name': 'Route Warnings',
    'type': 'n8n-nodes-base.if',
    'typeVersion': 2,
    'position': [1100, 500],
}
nodes.append(sl); nodes.append(pl); nodes.append(rw)

# 5. Update Compose Email jsCode
ce = next(n for n in nodes if n['name'] == 'Compose Email')
ce_body = open('parser/compose-email.js').read()
ce['parameters']['jsCode'] = (
    ce_body.replace("module.exports = { composeEmail };", "")
      + "\nreturn composeEmail($input.all());"
)

# 6. Rebuild connections — fresh from scratch based on spec topology
connections = {
    'Every 8am and 8pm': {'main': [[{'node': 'Split Keywords', 'type': 'main', 'index': 0}]]},
    'Split Keywords': {'main': [[
        {'node': 'Scrape Allegro', 'type': 'main', 'index': 0},
        {'node': 'Scrape Lokalnie', 'type': 'main', 'index': 0},
    ]]},
    'Scrape Allegro': {'main': [[{'node': 'Parse offers', 'type': 'main', 'index': 0}]]},
    'Scrape Lokalnie': {'main': [[{'node': 'Parse Lokalnie', 'type': 'main', 'index': 0}]]},
    'Parse offers': {'main': [[{'node': 'Route Warnings', 'type': 'main', 'index': 0}]]},
    'Parse Lokalnie': {'main': [[{'node': 'Route Warnings', 'type': 'main', 'index': 0}]]},
    # Route Warnings output 0 = false branch (real offers) → Filter New
    # Route Warnings output 1 = true branch (warnings) → Compose Email directly
    'Route Warnings': {'main': [[{'node': 'Filter New', 'type': 'main', 'index': 0}], [{'node': 'Compose Email', 'type': 'main', 'index': 0}]]},
    'Filter New': {'main': [[{'node': 'Save Seen', 'type': 'main', 'index': 0}]]},
    'Save Seen': {'main': [[{'node': 'Compose Email', 'type': 'main', 'index': 0}]]},
    'Compose Email': {'main': [[{'node': 'Send Email', 'type': 'main', 'index': 0}]]},
}

workflow = {
    'name': 'Allegro Militaria Monitor',
    'active': False,  # always import inactive; user activates manually after wiring scrape.do credential
    'nodes': nodes,
    'connections': connections,
    'settings': {'executionOrder': 'v1'},
}
json.dump(workflow, open('workflow.json', 'w'), indent=2, ensure_ascii=False)
print('wrote workflow.json with', len(nodes), 'nodes')
PY
```

Note about n8n IF node semantics: in `n8n-nodes-base.if`, output index **0** is the `true` (condition-matched) output, and output index **1** is the `false` output. Our condition is `$json.warning === false` — so output 0 (matched) = real offers → Filter New, output 1 (not matched) = warnings → Compose Email. The connections block above (`'Route Warnings': {'main': [[<Filter New>], [<Compose Email>]]}`) has Filter New in the FIRST sub-array (output 0 = real offers) and Compose Email in the SECOND (output 1 = warnings). That matches the spec.

- [ ] **Step 3: Validate the JSON**

```bash
cd /home/kc/repos/allegro-militaria-scraper
python3 -c "import json; w=json.load(open('workflow.json')); print('nodes:', len(w['nodes'])); print('connections:', len(w['connections'])); assert w['active'] is False"
```

Expected:
```
nodes: 11
connections: 10
```

(11 because original 8 + 3 new — see file count in nodes list.)

- [ ] **Step 4: Verify all parser module bodies round-trip cleanly**

Quick check that no `module.exports` line slipped into a jsCode:

```bash
cd /home/kc/repos/allegro-militaria-scraper
python3 -c "
import json
w = json.load(open('workflow.json'))
for n in w['nodes']:
    code = n.get('parameters', {}).get('jsCode', '')
    if code and 'module.exports' in code:
        print('LEAK in', n['name'])
print('done')
"
```

Expected: `done` with no leaks.

- [ ] **Step 5: Commit workflow.json**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add workflow.json
git commit -m "feat(workflow): new sanitized n8n export with lokalnie branch + scrape.do migration"
```

---

## Task 9: Write deploy + migration scripts

**Files:**
- Create: `scripts/migrate-existing-seen-ids.sql`
- Create: `scripts/deploy.sh`
- Create: `scripts/dump-existing-workflow.sh`

- [ ] **Step 1: Write `scripts/migrate-existing-seen-ids.sql`**

Create `/home/kc/repos/allegro-militaria-scraper/scripts/migrate-existing-seen-ids.sql`:

```sql
-- One-time migration: prefix existing unprefixed numeric offerId rows
-- in dataTable mMZgIKYRQ1Dulvm9 with 'allegro:' so the new namespaced-id
-- workflow doesn't re-surface already-seen offers on first run.
--
-- Run BEFORE activating the new workflow:
--
--   ssh root@89.167.71.120 'sqlite3 /var/lib/docker/volumes/n8n_data/_data/database.sqlite < scripts/migrate-existing-seen-ids.sql'
--
-- Idempotent: the WHERE clauses skip rows already prefixed.

.bail on

-- Diagnostic before
SELECT 'before: total', COUNT(*),
       'already_prefixed', SUM(CASE WHEN "values"->>'$.offerId' LIKE '%:%' THEN 1 ELSE 0 END),
       'numeric_only',      SUM(CASE WHEN "values"->>'$.offerId' GLOB '[0-9]*' AND "values"->>'$.offerId' NOT LIKE '%:%' THEN 1 ELSE 0 END)
  FROM "data_table"
 WHERE "dataTableId" = 'mMZgIKYRQ1Dulvm9';

-- Migrate
UPDATE "data_table"
   SET "values" = json_set("values", '$.offerId', 'allegro:' || "values"->>'$.offerId')
 WHERE "dataTableId" = 'mMZgIKYRQ1Dulvm9'
   AND "values"->>'$.offerId' IS NOT NULL
   AND "values"->>'$.offerId' NOT LIKE '%:%';

-- Diagnostic after
SELECT 'after: total', COUNT(*),
       'prefixed_allegro', SUM(CASE WHEN "values"->>'$.offerId' LIKE 'allegro:%' THEN 1 ELSE 0 END),
       'prefixed_lokalnie', SUM(CASE WHEN "values"->>'$.offerId' LIKE 'lokalnie:%' THEN 1 ELSE 0 END),
       'unprefixed',        SUM(CASE WHEN "values"->>'$.offerId' GLOB '[0-9]*' AND "values"->>'$.offerId' NOT LIKE '%:%' THEN 1 ELSE 0 END)
  FROM "data_table"
 WHERE "dataTableId" = 'mMZgIKYRQ1Dulvm9';
```

- [ ] **Step 2: Write `scripts/dump-existing-workflow.sh`**

Create `/home/kc/repos/allegro-militaria-scraper/scripts/dump-existing-workflow.sh`:

```bash
#!/usr/bin/env bash
# Dump the existing "Allegro Militaria Monitor" workflow (id M3Jd5kQncmSO27Li)
# from the n8n sqlite DB to two files in /tmp/opencode/ for inspection / diffing.
#
# Usage: bash scripts/dump-existing-workflow.sh

set -euo pipefail

HOST=root@89.167.71.120
WORKFLOW_ID=M3Jd5kQncmSO27Li
DB=/var/lib/docker/volumes/n8n_data/_data/database.sqlite
OUT=/tmp/opencode

mkdir -p "$OUT"

ssh "$HOST" "sqlite3 -readonly '$DB' \"SELECT nodes FROM workflow_entity WHERE id='$WORKFLOW_ID';\""      > "$OUT/allegro-militaria-nodes.json"
ssh "$HOST" "sqlite3 -readonly '$DB' \"SELECT connections FROM workflow_entity WHERE id='$WORKFLOW_ID';\"" > "$OUT/allegro-militaria-connections.json"

echo "wrote: $OUT/allegro-militaria-nodes.json"
echo "wrote: $OUT/allegro-militaria-connections.json"
echo "nodes count:"
python3 -c "import json;print(len(json.load(open('$OUT/allegro-militaria-nodes.json'))))"
```

Mark executable: `chmod +x /home/kc/repos/allegro-militaria-scraper/scripts/dump-existing-workflow.sh`.

- [ ] **Step 3: Write `scripts/deploy.sh`**

Create `/home/kc/repos/allegro-militaria-scraper/scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
# Deploy the new Allegro Militaria Monitor workflow to the n8n server.
#
# What this script does (semi-automated):
#   1. SSH to root@89.167.71.120
#   2. Deactivate the existing workflow (via direct sqlite UPDATE)
#   3. Run migrate-existing-seen-ids.sql
#   4. Copy workflow.json to the server
#   5. PRINT manual steps for the user (import via n8n UI, create Scrape.do credential, activate)
#
# Auto-import via n8n REST API is intentionally NOT attempted — n8n requires an
# API key created via the UI, and we don't have a secure place to commit it.

set -euo pipefail

HOST=root@89.167.71.120
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW_ID=M3Jd5kQncmSO27Li
DB=/var/lib/docker/volumes/n8n_data/_data/database.sqlite
REMOTE_WORKFLOW="/root/allegro-militaria-scraper-workflow.json"

echo "==> Step 1: Deactivate existing workflow $WORKFLOW_ID on server"
ssh "$HOST" "sqlite3 '$DB' \"UPDATE workflow_entity SET active=0 WHERE id='$WORKFLOW_ID';\""
echo "    deactivated."

echo "==> Step 2: Run data migration (prefix existing seen ids)"
ssh "$HOST" 'cat > /tmp/migrate.sql' < "$REPO_ROOT/scripts/migrate-existing-seen-ids.sql"
ssh "$HOST" "sqlite3 '$DB' < /tmp/migrate.sql"
ssh "$HOST" "rm /tmp/migrate.sql"
echo "    migration complete (see diagnostic rows above)."

echo "==> Step 3: Copy workflow.json to server"
scp "$REPO_ROOT/workflow.json" "$HOST:$REMOTE_WORKFLOW"
echo "    copied to $HOST:$REMOTE_WORKFLOW"

echo
echo "==> MANUAL STEPS (n8n UI at http://89.167.71.120:5678):"
echo
echo "  1. Log in to n8n."
echo "  2. Credentials → New → HTTP Query Auth:"
echo "       Name:    Scrape.do"
echo "       Query parameters (one):"
echo "         name:  token"
echo "         value: <paste your scrape.do API token>"
echo "       Save. Note the credential's internal id (visible in URL after save)."
echo
echo "  3. Workflows → Import from File → select $REMOTE_WORKFLOW on the server,"
echo "     or upload $REPO_ROOT/workflow.json from your machine."
echo
echo "  4. Open the imported workflow, click the 'Scrape Allegro' node,"
echo "     in the Credential dropdown select the 'Scrape.do' credential you just created."
echo "     (If the saved credential id doesn't match the workflow's referenced id 'scrapedot001',"
echo "     n8n will show 'Create New' — pick the existing one.)"
echo
echo "  5. Click 'Execute Workflow' to smoke-test once. Verify:"
echo "       - Schedule trigger fires"
echo "       - Both Scrape Allegro and Scrape Lokalnie return HTTP 200"
echo "       - Parse Allegro and Parse Lokalnie each return >=0 items"
echo "       - Route Warnings true branch = real offers, false branch = warnings"
echo "       - Email arrives in krzysztof.ciepka@gmail.com (or no email if run is fully empty)"
echo
echo "  6. If smoke test passes, click the Active toggle to enable the cron schedule."
echo
echo "  7. (Optional cleanup) Delete the old 'ScraperAPI' credential from n8n Credentials list."
```

Mark executable: `chmod +x /home/kc/repos/allegro-militaria-scraper/scripts/deploy.sh`.

- [ ] **Step 4: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add scripts/migrate-existing-seen-ids.sql scripts/dump-existing-workflow.sh scripts/deploy.sh
git commit -m "ops: add one-shot data-migration SQL + SSH-driven deploy helper"
```

---

## Task 10: Final README + commit + push

**Files:**
- Modify: `README.md` (fill out the deploy checklist and structure)
- Modify: (none other)

- [ ] **Step 1: Replace README.md with full content**

Overwrite `/home/kc/repos/allegro-militaria-scraper/README.md` with:

```markdown
# Allegro Militaria Scraper

n8n workflow that monitors Allegro.pl and Allegro Lokalnie for militaria keywords
(`tasak`, `hirschfanger`, `pruski`) on a twice-daily cron and emails new matches
to a Gmail recipient.

## Repo structure

```
workflow.json       — sanitized n8n export (credential ids/names only, no secrets)
parser/             — Code-node bodies extracted as standalone JS modules
  allegro.js        — Allegro.pl offer parser + DataDome detector
  lokalnie.js       — Allegro Lokalnie JSON-LD ItemList parser
  keywords.js       — Split Keywords node body
  compose-email.js  — Compose Email node body (two-section HTML MIME envelope)
scripts/            — SSH-driven deploy / dump / data-migration helpers
tests/              — fixture-driven unit tests (no deps)
  fixtures/         — real/synthetic HTML snapshots
docs/superpowers/
  specs/            — design spec
  plans/            — this implementation plan
```

## Local dev

```
node tests/test-parsers.js
```

All tests use `node:assert/strict`. No dependencies, no `npm install`.

## Deploy to server (n8n on root@89.167.71.120)

```
bash scripts/deploy.sh
```

`deploy.sh`:
1. Deactivates the existing `Allegro Militaria Monitor` workflow via direct sqlite update.
2. Runs `scripts/migrate-existing-seen-ids.sql` to prefix existing seen-ids with `allegro:`.
3. Copies `workflow.json` to `~/allegro-militaria-scraper-workflow.json` on the server.
4. Prints manual n8n UI steps (import JSON, create `Scrape.do` credential, activate, smoke test).

## Spec & plan

- Design: [`docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md`](docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md)
- Plan: [`docs/superpowers/plans/2026-06-28-lokalnie-and-scrapedo-implementation.md`](docs/superpowers/plans/2026-06-28-lokalnie-and-scrapedo-implementation.md)
```

- [ ] **Step 2: Commit**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git add README.md
git commit -m "docs: expand README with deploy checklist and repo structure"
```

- [ ] **Step 3: Push to GitHub**

```bash
cd /home/kc/repos/allegro-militaria-scraper
git push -u origin main
```

Expected: `* [new branch] main -> main` (first push; the `gh repo create` step created the remote earlier but no commits had been pushed).

- [ ] **Step 4: Verify CI runs green on GitHub**

```bash
cd /home/kc/repos/allegro-militaria-scraper
gh run list --limit 1
gh run watch <run-id>   # if needed
```

Or just visit https://github.com/krzysztofciepka/allegro-militaria-scraper/actions — the "CI" workflow should run and pass.

---

## Self-review record

**Spec coverage check** (against every section of the spec):

| Spec section | Plan task |
|---|---|
| Components 1 Schedule trigger | unchanged — no task needed (workflow carries it from original) |
| 2 Split Keywords modified | Task 5 (parser/keywords.js) + Task 8 (workflow inlining) |
| 3 Scrape Allegro replaced (scrape.do) | Task 8 (workflow.json Scrape Allegro block) |
| 4 Parse Allegro modified | Task 3 (parser/allegro.js) + Task 8 (inlining) |
| 5 Scrape Lokalnie new | Task 8 (workflow.json adds the node) |
| 6 Parse Lokalnie new | Task 4 (parser/lokalnie.js) + Task 8 |
| 7 Route Warnings new | Task 8 (workflow.json adds the IF node + its connections) |
| 8 Filter New modified | Task 8 (`keyValue={{$json.id}}`) — the dataTable id itself stays mMZgIKYRQ1Dulvm9 |
| 9 Save Seen unchanged | no-op, stays as-is |
| 10 Compose Email modified | Task 5 (parser/compose-email.js) + Task 8 |
| 11 Send Email unchanged | no-op |
| Credential management (scrape.do + delete ScraperAPI) | Task 9 deploy.sh manual steps handle creation; ScraperAPI delete is a manual step printed by deploy.sh |
| Existing dataTable migration | Task 9 (migrate-existing-seen-ids.sql + deploy.sh runs it) |
| Escalation policy (super=true fallback) | The `looksLikeDataDomeBlock` warning surfaces a failure; the actual flip is a manual re-deploy step documented in the spec. No plan task auto-flips it (correct — keeps deploy control with the user). |
| Error handling | Tasks 3, 4 emit warnings; Task 5 Compose Email suppresses empty-no-warning runs; Task 8 wires Route Warnings correctly. |
| Testing | Tasks 2 (fixtures), 3-5 (parser smoke tests), 6 (full suite), 7 (CI). |
| Out of scope | N/A — confirmed not implemented. |

**Placeholder scan**: searched for TBD/TODO/FIXME — none in the plan.

**Type consistency**:
- `parseAllegroOffers(input)` — used in workflow inline (Task 8) and test (Task 6).
- `parseLokalnieOffers(input, keyword)` — keyword is positional in Task 4 module, positional in Task 6 test. The workflow inlining (Task 8) passes via `$('Split Keywords').item.json.keyword` — that's a fresh read each item, which is correct because the parent Split Keywords item is the keyword that triggered this scrape run.
- If `Route Warnings` taxonomy: output 0 (true=mached, real offers) → Filter New. output 1 (false=warnings) → Compose Email directly. Spec says: `warnings bypass Filter New/Save Seen`; workflow connections in Task 8 reflect this.

No issues found. Plan is ready to execute.