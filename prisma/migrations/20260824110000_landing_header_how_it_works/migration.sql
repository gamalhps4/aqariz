-- The landing CMS gains two more managed blocks: the top navigation (`header`,
-- which renders on every public route rather than as a body section) and the
-- animated "How it works" band (`howItWorks`, previously hardcoded and bolted
-- onto the Features section).
--
-- Both default to '{}', which the read path merges over DEFAULT_LANDING — so an
-- existing document keeps rendering the shipped copy until an admin edits it.
-- New columns inherit the table's existing RLS policies (world-readable,
-- platform-writable), so nothing else needs granting here.

ALTER TABLE "landing_pages"
  ADD COLUMN "header"     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "howItWorks" JSONB NOT NULL DEFAULT '{}';
