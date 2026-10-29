-- The activity log: who did what, readable in the reader's language, and
-- impossible to edit after the fact.
--
-- 1. audit_logs keeps a snapshot of the actor's NAME (it already kept their
--    email and role). userId is a foreign key that goes NULL when the user is
--    deleted, so until now such an entry could no longer say who acted.
-- 2. audit_logs stores a catalogue key and its parameters for the sentence
--    (messageKey, messageParams), rendered in the reader's language when it
--    is read; `description` stays as the English fallback, which is all the
--    entries written before this carry.
-- 3. platform_audit_logs keeps the operator's name and where they acted from.
-- 4. Indexes for the screens' queries: the platform console reads every
--    organization's entries newest-first and by action; both screens filter by
--    employee within an organization.
-- 5. Both tables become append-only: a trigger refuses every UPDATE and
--    DELETE except
--      - the retention cleanup, which sets `app.audit_retention = on` for its
--        own transaction and may only delete ORGANIZATION entries whose
--        `retentionDate` has passed (a day's grace for the app server's clock
--        running ahead of the database's). Platform entries are never deleted;
--      - a deleted user or organization, whose foreign key the database
--        empties (ON DELETE SET NULL) — the entry keeps its snapshot. Only the
--        database's own referential action may do this: it runs one trigger
--        level down (pg_trigger_depth() > 1), where an UPDATE the application
--        sends runs at level 1, so the application cannot blank a reference;
--      - the actor-name backfill (src/scripts/backfill-audit-actor-names.ts),
--        which sets `app.audit_backfill = on` and may only fill a name that
--        is still empty.
--    What still cannot pass, on purpose: hard-deleting an organization that
--    has entries (audit_logs.organizationId is ON DELETE RESTRICT; the
--    product closes organizations instead), and changing a user's or an
--    organization's id (ON UPDATE CASCADE would rewrite the entries).
--    TRUNCATE is a table owner's operation (pnpm db:reset) and is untouched.
--
-- Additive and nullable throughout: code that does not know the new columns
-- keeps working, and the writer falls back to the old columns on a database
-- this migration has not reached yet.

ALTER TABLE "audit_logs"
  ADD COLUMN "userName" TEXT,
  ADD COLUMN "messageKey" TEXT,
  ADD COLUMN "messageParams" JSONB;

ALTER TABLE "platform_audit_logs"
  ADD COLUMN "actorName" TEXT,
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;

CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp" DESC);
CREATE INDEX "audit_logs_organizationId_userId_timestamp_idx" ON "audit_logs"("organizationId", "userId", "timestamp" DESC);

CREATE OR REPLACE FUNCTION audit_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  col text;
  due text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The retention cleanup: an organization entry whose retention date has
    -- passed. retentionDate is a UTC timestamp without a zone; read through
    -- JSON because platform_audit_logs has no such column.
    IF TG_TABLE_NAME = 'audit_logs'
       AND current_setting('app.audit_retention', true) = 'on' THEN
      due := to_jsonb(OLD) ->> 'retentionDate';
      IF due IS NOT NULL
         AND due::timestamp <= (now() AT TIME ZONE 'UTC') + interval '1 day' THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'activity log entries cannot be deleted (%)', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only the retention cleanup deletes activity entries, and only organization entries past their retention date.';
  END IF;

  -- Compared as JSON so one function serves both tables.
  before_row := to_jsonb(OLD) - 'updatedAt';
  after_row := to_jsonb(NEW) - 'updatedAt';

  -- A deleted user or organization: the foreign key empties its reference
  -- and nothing else changes. The referential action runs inside the
  -- foreign key's own trigger, so this trigger fires one level down; an
  -- UPDATE sent by the application fires it at level 1 and is refused.
  IF pg_trigger_depth() > 1 THEN
    FOREACH col IN ARRAY ARRAY['userId', 'organizationId'] LOOP
      IF before_row ->> col IS NOT NULL
         AND after_row ->> col IS NULL
         AND (before_row - col) = (after_row - col) THEN
        RETURN NEW;
      END IF;
    END LOOP;
  END IF;

  -- The actor-name backfill fills a name that is still empty, and only that.
  IF current_setting('app.audit_backfill', true) = 'on' THEN
    FOREACH col IN ARRAY ARRAY['userName', 'actorName'] LOOP
      IF (before_row ? col)
         AND before_row ->> col IS NULL
         AND (before_row - col) = (after_row - col) THEN
        RETURN NEW;
      END IF;
    END LOOP;
  END IF;

  RAISE EXCEPTION 'activity log entries cannot be changed (%)', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Activity entries are append-only.';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();

CREATE TRIGGER platform_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "platform_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();
