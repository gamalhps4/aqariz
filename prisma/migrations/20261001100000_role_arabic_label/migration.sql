-- A permission group's Arabic name.
--
-- The client's permission page has two name fields, English and Arabic, and
-- every screen should call a group by the name in its own language. A group
-- had one label, in whichever language was typed into it.
--
-- Nullable and additive: existing groups keep their label, which every
-- screen still falls back to, and code that does not know the column keeps
-- working. The built-in roles' names come from the translation catalogue,
-- not from this table.

ALTER TABLE "roles" ADD COLUMN "labelAr" TEXT;
