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