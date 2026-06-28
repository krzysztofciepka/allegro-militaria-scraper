#!/usr/bin/env python3
"""Fix the workflow_history + activeVersionId after direct sqlite updates.
Inserts the current nodes/connections into workflow_history under the current
versionId, then sets activeVersionId = versionId so n8n can activate the workflow.
"""
import json
import sqlite3
from pathlib import Path

DB = "/var/lib/docker/volumes/n8n_data/_data/database.sqlite"
WORKFLOW_ID = "M3Jd5kQncmSO27Li"
AUTHOR = "kc@opencode"

con = sqlite3.connect(DB)
try:
    cur = con.cursor()
    row = cur.execute(
        "SELECT versionId, nodes, connections, name FROM workflow_entity WHERE id = ?",
        (WORKFLOW_ID,),
    ).fetchone()
    version_id, nodes, connections, name = row

    # Insert into workflow_history (replace if exists)
    cur.execute(
        """INSERT OR REPLACE INTO workflow_history
           (versionId, workflowId, authors, nodes, connections, name, autosaved)
           VALUES (?, ?, ?, ?, ?, ?, 0)""",
        (version_id, WORKFLOW_ID, AUTHOR, nodes, connections, name),
    )

    # Set activeVersionId to current versionId
    cur.execute(
        "UPDATE workflow_entity SET activeVersionId = ? WHERE id = ?",
        (version_id, WORKFLOW_ID),
    )
    con.commit()

    # Verify
    row = cur.execute(
        "SELECT id, active, versionId, activeVersionId, versionCounter FROM workflow_entity WHERE id = ?",
        (WORKFLOW_ID,),
    ).fetchone()
    print("post-fix row:", row)
    print(f"workflow_history rows for this workflow:",
          cur.execute("SELECT COUNT(*) FROM workflow_history WHERE workflowId = ?", (WORKFLOW_ID,)).fetchone()[0])
finally:
    con.close()