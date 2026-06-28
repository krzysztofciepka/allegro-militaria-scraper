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