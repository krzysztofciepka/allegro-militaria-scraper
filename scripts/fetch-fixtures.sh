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