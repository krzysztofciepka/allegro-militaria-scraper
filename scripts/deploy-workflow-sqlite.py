#!/usr/bin/env python3
"""One-shot: load workflow.json (committed to the repo) and UPDATE the n8n
workflow_entity row for the Allegro Militaria Monitor so the new nodes and
connections replace the old ones. Keeps the same workflow id so the existing
shared_workflow link, dataTable id, and any executions history stay attached.

Leaves the workflow inactive; activate via the n8n UI after wiring the
Scrape.do credential. n8n caches workflow definitions in memory, so a
container restart is required after this update:

    docker restart n8n

Run on the SERVER (must have SSH access + read/write on the n8n sqlite DB):

    scp scripts/deploy-workflow-sqlite.py root@89.167.71.120:/root/
    scp workflow.json root@89.167.71.120:/root/allegro-militaria-scraper-workflow.json
    ssh root@89.167.71.120 'python3 /root/deploy-workflow-sqlite.py && docker restart n8n'
"""
import json
import sqlite3
import uuid
from pathlib import Path

WORKFLOW_JSON = Path("/root/allegro-militaria-scraper-workflow.json")
WORKFLOW_ID = "M3Jd5kQncmSO27Li"
DB = "/var/lib/docker/volumes/n8n_data/_data/database.sqlite"

wf = json.loads(WORKFLOW_JSON.read_text(encoding="utf-8"))
nodes = json.dumps(wf["nodes"], ensure_ascii=False)
connections = json.dumps(wf["connections"], ensure_ascii=False)
settings = json.dumps(wf.get("settings") or {}, ensure_ascii=False)
version_id = str(uuid.uuid4())

con = sqlite3.connect(DB)
AUTHOR = "kc@opencode"
try:
    cur = con.cursor()
    cur.execute(
        """UPDATE workflow_entity
              SET nodes = ?,
                  connections = ?,
                  settings = ?,
                  active = 0,
                  versionId = ?,
                  activeVersionId = ?,
                  versionCounter = versionCounter + 1,
                  updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?""",
        (nodes, connections, settings, version_id, version_id, WORKFLOW_ID),
    )
    print(f"rows updated: {cur.rowcount}")

    # Insert into workflow_history so n8n can activate/publish the workflow.
    # Without this, activation fails with "Version not found".
    cur.execute(
        """INSERT OR REPLACE INTO workflow_history
           (versionId, workflowId, authors, nodes, connections, name, autosaved)
           VALUES (?, ?, ?, ?, ?, ?, 0)""",
        (version_id, WORKFLOW_ID, AUTHOR, nodes, connections, wf.get("name", "")),
    )

    con.commit()
    cur.execute(
        "SELECT id, name, active, versionId, activeVersionId, versionCounter FROM workflow_entity WHERE id = ?",
        (WORKFLOW_ID,),
    )
    print("post-update row:", cur.fetchone())
finally:
    con.close()

print(f"new versionId: {version_id}")
print("Next: docker restart n8n so it reloads from disk.")