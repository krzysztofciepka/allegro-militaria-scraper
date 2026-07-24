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
  deploy.sh         — deactivate, migrate seen-ids, copy workflow.json, print manual steps
  dump-existing-workflow.sh
  fetch-fixtures.sh
  migrate-existing-seen-ids.sql
tests/              — fixture-driven unit tests (no deps)
  fixtures/         — real/synthetic HTML snapshots
docs/superpowers/
  specs/            — design spec
  plans/            — implementation plan
```

## Local dev

```
node tests/test-parsers.js
```

All tests use `node:assert/strict`. No dependencies, no `npm install`.

CI runs the same command on push and PR via `.github/workflows/ci.yml`.

## Deploy to server (n8n on root@89.167.71.120)

```
bash scripts/deploy.sh
```

`deploy.sh`:
1. Deactivates the existing `Allegro Militaria Monitor` workflow via direct sqlite update.
2. Runs `scripts/migrate-existing-seen-ids.sql` to prefix existing seen-ids with `allegro:`.
3. Copies `workflow.json` to `~/allegro-militaria-scraper-workflow.json` on the server.
4. Prints manual n8n UI steps (import JSON, create `Scrape.do` credential, activate, smoke test).

## Gmail OAuth: stop the 7-day re-auth

The `Send Email` node uses a Gmail API OAuth2 credential (`Gmail Send OAuth2`).
If the GCP OAuth app is left in **Testing** publishing status, Google expires
refresh tokens after 7 days — n8n then fails to send until you re-authenticate.

One-time fix:

1. Open [GCP Console](https://console.cloud.google.com/) → the project that owns
   the OAuth client → **APIs & Services → OAuth consent screen** (Audience page).
2. Click **Publish app** (Testing → In production). With only the `gmail.send`
   scope no Google verification is required; the consent screen will just show
   an "unverified app" warning.
3. In n8n (http://89.167.71.120:5678) → Credentials → `Gmail Send OAuth2` →
   **Reconnect**. Sign in once more, click *Advanced → Go to … (unsafe)* past
   the unverified-app warning.
4. Done — refresh tokens issued by a production app do not expire on a timer,
   so no more weekly re-auth.

## Spec & plan

- Design: [`docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md`](docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md)
- Plan: [`docs/superpowers/plans/2026-06-28-lokalnie-and-scrapedo-implementation.md`](docs/superpowers/plans/2026-06-28-lokalnie-and-scrapedo-implementation.md)