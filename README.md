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

## Spec & plan

- Design: [`docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md`](docs/superpowers/specs/2026-06-28-lokalnie-and-scrapedo-design.md)
- Plan: [`docs/superpowers/plans/2026-06-28-lokalnie-and-scrapedo-implementation.md`](docs/superpowers/plans/2026-06-28-lokalnie-and-scrapedo-implementation.md)