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