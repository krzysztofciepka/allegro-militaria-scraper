-- One-time migration: prefix existing unprefixed numeric offerId rows
-- in dataTable mMZgIKYRQ1Dulvm9 with 'allegro:' so the new namespaced-id
-- workflow doesn't re-surface already-seen offers on first run.
--
-- Run BEFORE activating the new workflow:
--
--   ssh root@89.167.71.120 'sqlite3 /var/lib/docker/volumes/n8n_data/_data/database.sqlite < scripts/migrate-existing-seen-ids.sql'
--
-- Idempotent: the WHERE clause skips rows already prefixed.
--
-- NOTE: n8n's DataTable feature stores rows in a per-table table named
-- `data_table_user_<dataTableId>`. The `offerId` is a plain top-level
-- TEXT column (NOT a JSON blob inside a `values` column).

.bail on

-- Diagnostic before
SELECT 'before: total', COUNT(*),
       'already_prefixed', SUM(CASE WHEN "offerId" LIKE '%:%' THEN 1 ELSE 0 END),
       'numeric_only',     SUM(CASE WHEN "offerId" GLOB '[0-9]*'
                                     AND "offerId" NOT LIKE '%:%' THEN 1 ELSE 0 END)
  FROM "data_table_user_mMZgIKYRQ1Dulvm9";

-- Migrate: prefix unprefixed numeric ids with 'allegro:'
UPDATE "data_table_user_mMZgIKYRQ1Dulvm9"
   SET "offerId" = 'allegro:' || "offerId"
 WHERE "offerId" IS NOT NULL
   AND "offerId" NOT LIKE '%:%'
   AND "offerId" GLOB '[0-9]*';

-- Diagnostic after
SELECT 'after: total', COUNT(*),
       'prefixed_allegro',  SUM(CASE WHEN "offerId" LIKE 'allegro:%' THEN 1 ELSE 0 END),
       'prefixed_lokalnie', SUM(CASE WHEN "offerId" LIKE 'lokalnie:%' THEN 1 ELSE 0 END),
       'unprefixed',        SUM(CASE WHEN "offerId" GLOB '[0-9]*'
                                     AND "offerId" NOT LIKE '%:%' THEN 1 ELSE 0 END)
  FROM "data_table_user_mMZgIKYRQ1Dulvm9";