# Allegro Militaria Scraper — Lokalnie Source + Scrape.do Migration

**Task:** P5 — Extend the Allegro Militaria n8n workflow to also scrape allegrolokalnie.pl and replace ScraperAPI with an alternative paid-per-use cheaper than $1/month.

**Spec date:** 2026-06-28
**Repo:** `krzysztofciepka/allegro-militaria-scraper`
**Remote target:** `root@89.167.71.120` — `n8n` container named `n8n` (image `n8nio/n8n:latest`), data volume `/var/lib/docker/volumes/n8n_data/_data`, workflow id `M3Jd5kQncmSO27Li` ("Allegro Militaria Monitor").

## Context

The existing n8n workflow scrapes allegro.pl for a hardcoded list of militaria keywords (`tasak`, `hirschfanger`, `pruski`) in category `3690` (Kolekcje > Militaria > Broń), parses offers from embedded `application/json` script blocks, dedups against an n8n `dataTable` (`mMZgIKYRQ1Dulvm9`) keyed by numeric allegro offer id, and emails new matches via Gmail API. It runs on a cron `0 2,14 * * *`.

Two changes required:

1. **Scraper replacement.** ScraperAPI trial has ended and the user wants to replace it. User-chosen replacement: **scrape.do** (user holds an API token). Scrape.do handles Allegro's DataDome anti-bot.
2. **New source.** Add allegrolokalnie.pl scraping. User-chosen category filter path: `bron/bron-biala-3691` (verified URL: `https://allegrolokalnie.pl/oferty/bron/bron-biala-3691`).

## Verified facts driving the design

- `curl` from the server to `https://allegrolokalnie.pl/oferty/bron/bron-biala-3691/q/<keyword>` returns HTTP 200 with ~1.3 MB HTML; no anti-bot (DataDome) protection observed.
- Offers on lokalnie listings are exposed as a standard **JSON-LD `ItemList`** inside a `<script type="application/ld+json">` block — typically one ItemList with ≤60 `ListItem` children, each `item` having shape `{name, url, offers:{price, priceCurrency}, image:{contentUrl, @type:ImageObject}, itemCondition, @type:Product}`.
- Some lokalnie `item.url` values point to `https://allegro.pl/oferta/<slug>-<numericId>` (cross-syndicated allegro offers); others point to `https://allegrolokalnie.pl/oferta/<slug>` (native lokalnie offers).
- Allegro.pl is fronted by DataDome; the existing embedded-JSON parser still works once a non-blocked HTML response is obtained, so no JS rendering is needed at scrape.do (saves credits).

## Decision summary

| Concern | Decision |
|---|---|
| Allegro.pl fetch | scrape.do HTTP, `render=false`, `geoCode=pl`. If datacenter proxies get blocked, escalate to `super=true` only as fallback. |
| Lokalnie fetch | Direct n8n HTTP Request from server. Zero scrape.do credits spent. |
| Lokalnie URL form | Path-based category + `/q/<keyword>` (NOT `?q=`), confirmed working. |
| Lokalnie keyword/category | Same KEYWORDS list as allegro branch; `bron/bron-biala-3691` hardcoded constant. |
| Offer id namespacing | `allegro:<numId>` for allegro items (also applied when parsing cross-syndicated lokalnie items whose `url` is an `allegro.pl/oferta/...-<num>`); `lokalnie:<slug>` for native lokalnie items (slug = last path segment of url). Namespaced ids are stored verbatim in the existing `offerId` column of the `dataTable` — no schema change. |
| Email layout | Single combined email per run with two HTML sections ("Allegro.pl", "Allegro Lokalnie"). Empty sections render "*No new offers on <source>.*". If both sections empty, no email is sent. |
| Existing dataTable migration | One-time SQL UPDATE prefixes every existing unprefixed numeric `offerId` cell in dataTable `mMZgIKYRQ1Dulvm9` with `allegro:` to prevent first-run email flood. |
| Current parser | Unchanged — only the outer loop adds `source` and prefixes `id`. The existing walk/parse algorithm is preserved verbatim. |
| Commit policy | The repo stores the **redacted** workflow JSON (credential ids/names kept for n8n references; secret values removed). Secrets live only in the n8n credential store. |

## Design

### Architecture

```
Schedule trigger (unchanged: 0 2,14 * * *)
   └── Split Keywords (Code, slightly modified)
         ├── [Allegro branch]
         │     • Scrape Allegro  (HTTP Request — NEW: scrape.do URL, httpQueryAuth ?token)
         │     • Parse Allegro   (Code — existing logic, adds source prefix)
         └── [Lokalnie branch]
               • Scrape Lokalnie (HTTP Request — NEW: direct GET to allegrolokalnie.pl)
               • Parse Lokalnie  (Code — NEW: JSON-LD ItemList parser)

   Route Warnings (IF node — NEW)
        ├─ $json.warning === false ─→ Filter New → Save Seen ─┐
        └─ $json.warning === true  ─────────────────────────────┤
                                                                  ▼
                                                       Compose Email (Code — MODIFIED)
                                                                 │
                                                                 ▼
                                                       Send Email (HTTP — Gmail API, unchanged)
```

n8n fans out Split Keywords output to both branches per keyword. Both parser nodes connect directly into the **Route Warnings** IF node — n8n accepts items from multiple predecessors sequentially, so an explicit Merge node is unnecessary. Route Warnings keeps warnings OUT of Filter New / Save Seen (otherwise their fixed `id` like `allegro:skip:tasak` would get saved by Save Seen and suppress the same warning on every subsequent run via Filter New's `rowNotExists`). Both outputs of Route Warnings reconnect into a single Compose Email input.

### Components

**1. Schedule trigger** — unchanged. Keeps `0 2,14 * * *` (twice daily at 02:00 and 14:00 container local time, Europe/Warsaw).

**2. Split Keywords (Code node, MODIFIED)** — current logic stays. Adds a new const:

```js
const KEYWORDS = ['tasak', 'hirschfanger', 'pruski'];
const ALLEGRO_CATEGORY_ID = '3690';
const LOKALNIE_CATEGORY_PATH = 'bron/bron-biala-3691'; // confirmed: https://allegrolokalnie.pl/oferty/bron/bron-biala-3691

return KEYWORDS.map(keyword => ({
  json: {
    keyword,
    allegroCategoryId: ALLEGRO_CATEGORY_ID,
    lokalnieCategoryPath: LOKALNIE_CATEGORY_PATH
  }
}));
```

**3. Scrape Allegro (HTTP Request, REPLACED)** — the existing ScraperAPI call is replaced by a scrape.do call:

- URL template:
  ```
  ={{ 'https://api.scrape.do/?token=' + $credentials.scrapedoToken + '&url=' + encodeURIComponent('https://allegro.pl/kategoria/x-' + $json.allegroCategoryId + '?string=' + $json.keyword + '&order=n') + '&geoCode=pl&render=false&output=html' }}
  ```
  `super` defaults to false. Fallback configuration (see "Escalation policy" below) flips it to `&super=true`.
- Auth: `genericCredentialType`/`httpQueryAuth` referring to a new n8n credential **Scrape.do** (named `scrapedoToken`) holding the user's scrape.do API token as the `token` query param.
- Response: `responseFormat: text`, `timeout: 90000`, `Retry On Fail: true`, `maxTries: 2`.
- `Continue On Fail: true` so a transient scrape.do failure for one keyword does not abort the run.

**4. Parse Allegro (Code node, MODIFIED)** — the inner `parseAllegro(html)` function body stays byte-for-byte identical (preserves years of edge-case handling). The only changes are in the outer loop:

- Each offer gets `source: 'allegro'`.
- `id` becomes `'allegro:' + o.id` (instead of bare `o.id`).
- If `o.url` ends up being an allegro.pl offer URL with a numeric suffix and `o.id` is empty, derive id from the URL's numeric suffix and prefix as `allegro:`.
- Failed-scrape rows (scrape.do error or DataDome block detected via `looksLikeDataDomeBlock(html)`) emit one synthetic warning item `{ id: 'allegro:skip:' + keyword, source: 'allegro', title: '⚠ Allegro scrape failed for keyword: ' + keyword, url: '', price: '', img: '', warning: true }` so the email surfaces the failure truthfully. The `warning: true` field marks the item for bypass routing (see **Route Warnings** below) — warnings never enter Filter New / Save Seen, so a recurring scrape failure re-surfaces in every run's email until the underlying cause is fixed.

**5. Scrape Lokalnie (HTTP Request, NEW)** — direct GET to lokalnie:

- URL: `{{ 'https://allegrolokalnie.pl/oferty/' + $json.lokalnieCategoryPath + '/q/' + encodeURIComponent($json.keyword) }}`
- Headers: `User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36`, `Accept: text/html,application/xhtml+xml`.
- Response: `responseFormat: text`, `timeout: 60000`, no auth, `Continue On Fail: true`.

**6. Parse Lokalnie (Code node, NEW)** — pure-JS dependency-free, mirrors the allegro parser constraints. Algorithm:

1. Regex `<script type="application/ld+json"[^>]*>([\s\S]*?)</script>` over the HTML; the first parseable JSON with `@type === 'ItemList'` and a non-empty `itemListElement` array is used.
2. For each `ListItem.item`:
   - `name` = `item.name`
   - `url` = `item.url` (may be allegro.pl or allegrolokalnie.pl)
   - `price` = `String(item.offers.price)` (raw string like `"2"` or `"78.99"`)
   - `img` = `item.image.contentUrl` (fallback `item.image.url`)
   - `condition` = `item.itemCondition.endsWith('/UsedCondition') ? 'used' : 'new'`
   - **id determination:**
     - If `item.url` matches `/^https?:\/\/[a-z.]*allegro\.pl\/oferta\/[^?#]+?-(\d{5,})\b/i` → `id = 'allegro:' + <num>`, `source = 'allegro-via-lokalnie'`.
     - Else extract last path segment of `item.url` → `id = 'lokalnie:' + <slug>`, `source = 'lokalnie'`.
   - Within-list dedup: drop duplicates by `id` using a `Set`.
3. Output `[{ json: { id, source, title, url, price, img, condition } }]`.
4. If the HTTP fetch failed (item has `error` field from Continue On Fail), emit a single warning `{ id: 'lokalnie:skip:' + keyword, source: 'lokalnie', title: '⚠ Lokalnie scrape failed for keyword: ' + keyword, ... warning: true }`.

**7. Route Warnings (IF node, NEW)** — receives inputs from both Parse Allegro and Parse Lokalnie (n8n accepts items from multiple predecessors sequentially, so no Merge node is needed). IF condition: `{{ $json.warning }}`.

- **False branch** (real offers) → Filter New → Save Seen → Compose Email input #1.
- **True branch** (warnings) → bypasses the dedup pair entirely, connects directly into Compose Email input #2 (or merges back into input #1 — n8n routes both to the same downstream node input).

The bypass is required because warnings have static ids like `allegro:skip:tasak`. If they went through Save Seen, the next run's Filter New would `rowNotExists`-match the saved row and silently drop the warning — hiding persistent scrape failures from the user.

**8. Filter New (DataTable, MODIFIED)** — only the filter `keyValue` expression changes:

```
keyValue: ={{ $json.id }}
```

DataTable id `mMZgIKYRQ1Dulvm9` and `rowNotExists` operation stay. Because the stored `offerId` values will all be namespaced after the migration SQL (see "Migration"), comparisons against the new prefixed ids work uniformly.

**9. Save Seen (DataTable, UNCHANGED)** — insert `offerId = {{ $json.id }}` for every surviving row. Existing behavior; the only implicit change is the value now carries the namespace prefix.

**10. Compose Email (Code node, MODIFIED)** — same MIME/base64url Gmail raw envelope is produced; only the body HTML builder changes:

- Inputs: all surviving items (new offers + any warning items) from `$input.all()`.
- Bucket items by source:
  - `allegro` and `allegro-via-lokalnie` → "Allegro.pl" section. (Treating cross-syndicated allegro offers as part of the Allegro section is intentional — they ARE allegro offers, just surfaced via lokalnie's index.)
  - `lokalnie` → "Allegro Lokalnie" section.
  - Warnings render inline in their respective section with a dimmed italic style.
- If **both** sections have zero real offers **and** zero warnings → `return [];` (skips Send Email — prevents empty emails on a fully successful but eventless run). Warnings DO trigger an email so the user can react to scrape failures.
- HTML structure:

```html
<div style="font-family:Arial,Helvetica,sans-serif;color:#222">
  <h2 style="margin:0 0 4px">Allegro Militaria Monitor</h2>
  <p style="margin:0 0 16px;color:#666">Found N new offer(s)</p>

  <h3 style="...">Allegro.pl</h3>
  <p><em>No new offers on Allegro.pl.</em></p>      <!-- if empty -->
  <!-- else: per-offer <table> with thumb/title/price/link -->

  <h3 style="...">Allegro Lokalnie</h3>
  <p><em>No new offers on Allegro Lokalnie.</em></p>  <!-- if empty -->
  <!-- else: per-offer <table> -->

  <p style="color:#999;font-size:12px">Run time: <ISO timestamp></p>
</div>
```

- Per-offer row layout unchanged: thumbnail (120px) left, title + price + "source" badge right. Native lokalnie offers get a `Lokalnie` badge; cross-syndicated get `Lokalnie→Allegro`; pure allegro offers get no badge.
- Subject line: `[Allegro Militaria] N new offer(s) found` (unchanged).
- Recipient `krzysztof.ciepka@gmail.com` (unchanged).

**11. Send Email (HTTP Request, UNCHANGED)** — Gmail API send with the existing `Gmail Send OAuth2` credential.

### Credential management

| Credential | n8n type | Status |
|---|---|---|
| `Scrape.do` | `httpQueryAuth` (token query param) | NEW. Created in n8n UI; value: user's scrape.do API key. Referenced by id from `Scrape Allegro` node. |
| `Gmail Send OAuth2` | `oAuth2Api` | Existing, reused unchanged. |
| `ScraperAPI` | `httpQueryAuth` | DELETED after migration — no longer referenced. |

Secret values never appear in the workflow JSON committed to the repo — n8n stores them in its encrypted settings; the JSON only keeps credential `id`/`name` references.

### Migration of existing seen-ids

The existing `dataTable` (`mMZgIKYRQ1Dulvm9`) currently stores numeric allegro ids in `offerId` (unprefixed, e.g. `"18713645310"`). After deploy, the workflow writes `allegro:18713645310`. If undealt, every existing allegro offer would resurface as "new" on the next run, flooding the inbox.

Migration:

1. Stop the workflow (`active=false`) in n8n UI or via SQL update.
2. Run against `/var/lib/docker/volumes/n8n_data/_data/database.sqlite` on the host:

   ```sql
   UPDATE "data_table"
      SET "values" = json_set("values", '$.offerId', 'allegro:' || "values"->>'$.offerId')
    WHERE "dataTableId" = 'mMZgIKYRQ1Dulvm9'
      AND "values"->>'$.offerId' IS NOT NULL
      AND "values"->>'$.offerId' NOT LIKE '%:%';
   ```
   ("values" stores a JSON object with `offerId` as a top-level key — confirmed during exploration.)

3. Verify counts before/after:

   ```sql
   SELECT COUNT(*),
          SUM(CASE WHEN "values"->>'$.offerId' LIKE 'allegro:%' THEN 1 ELSE 0 END) AS prefixed
     FROM "data_table"
    WHERE "dataTableId" = 'mMZgIKYRQ1Dulvm9';
   ```

4. Import the new sanitized workflow JSON into n8n (via the Import UI flow, or the n8n REST API at `POST /rest/workflows` using an existing n8n API key — see deploy script).
5. Activate the new workflow (`active=true`).

These steps are encoded in `scripts/migrate-existing-seen-ids.sql` and `scripts/deploy.sh`.

### Escalation policy for scrape.do

Allegro.pl sits behind DataDome which blocks datacenter IPs to varying degrees. Scrape.do cost gradient (relevant numbers from scrape.do's docs and pricing page):

- Plain datacenter request (`super=false`, `render=false`): **1 credit / request**.
- Residential/mobile (`super=true`, `render=false`): **~10 credits / request**.
- With JS rendering (`render=true`): higher still (managed headless browser).

Workflow runs twice per day × 3 keywords × 2 sources = **180 scrape.do requests/month** for the allegro branch alone (lokalnie branch uses direct HTTP, no scrape.do).

- Default config uses datacenter (`super=false`). If 1 credit/req holds, that's ~180 credits/month — well under scrape.do's free-entry 1000-credit allowance and any paid tier costs.
- If during production runs scrape.do's response status indicates DataDome block (examine returned HTML for `datadome` markers — sample fixture in tests), flip the workflow's `Scrape Allegro` node to `super=true` and re-import. This pushes cost to ~1800 credits/mo. The user's budget (cheaper than $1/month) cannot accommodate this — in that case the user must escalate to a paid scrape.do plan OR switch to the official Allegro REST API (out of scope for this task). The decision is the user's.

Detection: the test suite's `parser/allegro.js` exports a helper `looksLikeDataDomeBlock(html)` returning true if the response is a DataDome challenge page; `Parse Allegro` calls it on the raw response and, if true, emits the warning item described above (allowing the user to notice and trigger the escalation). Implementation alone does NOT auto-escalate (no automatic config changes via workflow JSON); the flip is a manual deploy step.

### Error handling

- Every scrape HTTP node has `Continue On Fail: true`. A failure becomes a `warning` row in the email rather than a silent omission.
- `Parse Allegro` and `Parse Lokalnie` both emit a real offer list when the response is parseable, even if empty — empty sections render "*No new offers.*".
- `Compose Email` suppresses the entire email when both sections are empty AND no warnings exist (i.e. a fully successful run with nothing to report stays silent). With at least one warning, the email is sent so the user is notified about the failure.
- A scrape.do HTTP 402/429 (quota exhausted / rate limit) propagates as a warning row with the status code in the title.

### Testing

**Repo layout** (under `allegro-militaria-scraper/`):

```
README.md
workflow.json                              # sanitized n8n export (credential ids, no secret values)
docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md
parser/
  allegro.js                                # exports parseAllegro(html), looksLikeDataDomeBlock(html)
  lokalnie.js                               # exports parseLokalnie(html)
  keywords.js                               # the Split Keywords code body
scripts/
  dump-existing-workflow.sh                 # how the original was extracted via SSH
  migrate-existing-seen-ids.sql             # the UPDATE/SELECT above
  deploy.sh                                 # one-off deploy: activate/deactivate + SQL + import new workflow
tests/
  fixtures/allegro-listing.html             # real allegro.pl listing snapshot
  fixtures/lokalnie-listing.html            # real allegrolokalnie.pl listing snapshot
  fixtures/datadome-challenge.html          # a typical DataDome block page for looksLikeDataDomeBlock tests
  test-parsers.js                          # runs parseAllegro & parseLokalnie against fixtures
```

**Tests** — `node tests/test-parsers.js`, no dependencies (mirrors the existing parser's "no deps" constraint). Assertions:
- `parseAllegro(fixture)` returns N offers of expected shape for the allegro fixture.
- `parseLokalnie(fixture)` returns N offers, with at least one `source: 'allegro-via-lokalnie'` and at least one `source: 'lokalnie'` for the captured fixture.
- `looksLikeDataDomeBlock(datadome fixture) === true`; `looksLikeDataDomeBlock(allegro fixture) === false`.
- All ids are correctly namespaced (`allegro:` for allegro items including cross-syndicated, `lokalnie:` for native).
- id uniqueness within a list.

A GitHub Actions CI job runs `node tests/test-parsers.js` on push.

**Live smoke test** — after deploy:
1. Manually trigger "Execute workflow" in the n8n UI once.
2. Inspect each node's output in the run details UI.
3. Confirm the email arrives (or is intentionally not sent for all-empty case).
4. Verify the existing dataTable migration by spot-checking the `data_table` values in sqlite: all rows should have `allegro:` prefix after migration.

### Out of scope (YAGNI)

- Pagination of either source. Current workflow scans only page 1 of each listing; this is adequate for monitoring fresh postings twice daily.
- A second lokalnie category beyond `bron-biala-3691`.
- Refactoring the `dataTable` schema (adding source / condition columns); we keep the single `offerId` column.
- Replacing the Gmail raw MIME builder — it works, leave it.
- Auto-escalation of scrape.do config (`super=false` → `super=true`); manual decision per escalation policy.
- Migrating to the official Allegro REST API as the primary path. Considered, rejected for this iteration in favor of scrape.do (user-provided). A future task can revisit if scraping costs escalate.

### Deploy steps (executed manually by user with operational docs in scripts/)

1. SSH into `root@89.167.71.120`.
2. Deactivate the existing "Allegro Militaria Monitor" workflow (n8n UI: toggle off `active`).
3. Run `scripts/migrate-existing-seen-ids.sql` against `/var/lib/docker/volumes/n8n_data/_data/database.sqlite`.
4. Import the new `workflow.json` via n8n UI Import (or via `POST /rest/workflows`).
5. In the imported workflow's `Scrape Allegro` node, select the freshly created `Scrape.do` credential (created once via n8n credentials UI with the user's API token).
6. Activate the workflow.
7. Click Execute Workflow once to smoke test.
8. Delete the old `ScraperAPI` n8n credential.