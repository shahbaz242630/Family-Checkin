-- CB-075: language codes were stored as CHAR(5), which Postgres pads with
-- spaces to the full width. Prisma returned the padded value verbatim, so
-- POST /auth/sync-user answered preferredLanguage "en   ", POST /receivers
-- answered language "en   ", and the WhatsApp Content-SID lookup keyed
-- "templateKey:language" missed (CB-020). BCP-47 base or region tags fit in
-- eight characters ("en", "en-GB", "pt-BR"); VARCHAR never pads.
--
-- The USING clause trims the existing values while the type changes; the
-- unique index channel_templates_templateKey_language_channel_key is rebuilt
-- by Postgres as part of the ALTER.
ALTER TABLE "users"
  ALTER COLUMN "preferredLanguage" TYPE VARCHAR(8) USING rtrim("preferredLanguage");

ALTER TABLE "receivers"
  ALTER COLUMN "language" TYPE VARCHAR(8) USING rtrim("language");

ALTER TABLE "channel_templates"
  ALTER COLUMN "language" TYPE VARCHAR(8) USING rtrim("language");
