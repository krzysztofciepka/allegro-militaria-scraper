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
echo "  2. Credentials -> New -> HTTP Query Auth:"
echo "       Name:    Scrape.do"
echo "       Query parameters (one):"
echo "         name:  token"
echo "         value: <paste your scrape.do API token>"
echo "       Save. Note the credential's internal id (visible in URL after save)."
echo
echo "  3. Workflows -> Import from File -> select $REMOTE_WORKFLOW on the server,"
echo "     or upload $REPO_ROOT/workflow.json from your machine."
echo
echo "  4. Open the imported workflow, click the 'Scrape Allegro' node,"
echo "     in the Credential dropdown select the 'Scrape.do' credential you just created."
echo "     (If the saved credential id doesn't match the workflow's referenced id 'scrapedot001',"
echo "     n8n will show 'Create New' - pick the existing one.)"
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