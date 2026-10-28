#!/usr/bin/env python3
"""Build the Prisma migration that puts Studio into the CRM database.

Input: `pg_dump --schema-only --schema=public --no-owner` of a database built from
the Location-keyed Studio history (studio/supabase/migrations, applied after
studio/tests/bootstrap.sql). Output: one SQL migration that

  * creates every Studio table, index, constraint, function, trigger, view, grant
    and RLS setting in the `studio` schema (Prisma manages only `public`);
  * keys Studio data by the CRM Location: foreign keys reference
    public."Location"(id), and there is no Studio location or membership table;
  * reads the Location and its team through two views over the CRM tables,
    `studio.studio_locations` and `studio.studio_location_members`, so the
    existing SQL checks keep their meaning without a stored mirror;
  * drops Studio-side Location provisioning (`studio_create_substo_location`).

Usage: studio-merge-schema.py <dump.sql> <migration.sql>
"""
import re
import sys

DROP_TABLES = {"studio_locations", "studio_location_memberships"}
DROP_FUNCTIONS = {"studio_create_substo_location"}

HEADER = re.compile(r"^--\n-- Name: (?P<name>[^;]+); Type: (?P<type>[A-Z ]+); Schema: (?P<schema>[^;]+);", re.M)


def blocks(text):
    starts = [m.start() for m in HEADER.finditer(text)]
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        yield text[start:end]


def keep(block):
    m = HEADER.match(block)
    name, kind = m.group("name").strip(), m.group("type").strip()
    if kind == "SCHEMA" or name.startswith("SCHEMA "):
        return False
    parts = name.split()
    owner = parts[1] if kind in {"ACL", "COMMENT"} and len(parts) > 1 else parts[0]
    owner = owner.split("(")[0].split(".")[0]
    if kind == "INDEX":
        owner = (re.search(r" ON public\.([a-z_0-9]+) ", block) or [None, None])[1]
    # Constraints of *other* tables that reference these are kept and retargeted.
    if owner in DROP_TABLES and kind in {"TABLE", "CONSTRAINT", "FK CONSTRAINT", "INDEX", "TRIGGER", "ROW SECURITY", "POLICY", "ACL", "COMMENT", "DEFAULT"}:
        return False
    if kind in {"FUNCTION", "ACL", "COMMENT"} and owner in DROP_FUNCTIONS:
        return False
    return True


def transform(block):
    # Retarget Location foreign keys to the CRM Location before the schema rename.
    block = re.sub(r"REFERENCES public\.studio_locations\(location_id\)", 'REFERENCES public."Location"(id)', block)
    block = block.replace("public.", "studio.")
    block = block.replace('studio."Location"', 'public."Location"')
    block = re.sub(r"\bstudio\.studio_location_memberships\b", "studio.studio_location_members", block)
    # Schema 29: Studio in the CRM database. Code for it refuses the old Studio project (27).
    block = block.replace("jsonb_build_object('schema',28,", "jsonb_build_object('schema',29,")
    return block


VIEWS = """
--
-- The Location as Studio sees it: one row per CRM Location, `app` is its realm.
--
CREATE VIEW studio.studio_locations AS
 SELECT l.id AS location_id,
    (l."authRealm")::text AS app,
    COALESCE(NULLIF(btrim(l.name), ''), 'Untitled'::text) AS name,
    NULL::text AS created_by_clerk_user_id,
    (l."createdAt" AT TIME ZONE 'UTC') AS created_at,
    (l."updatedAt" AT TIME ZONE 'UTC') AS updated_at
   FROM public."Location" l;

--
-- The Location team as Studio's SQL checks read it: connected members holding a role
-- (`UserLocationRole`), in the Location's own realm. A Location ADMIN is Studio's
-- `owner` (every manager check accepts owner or admin; owner-only calls are the legacy
-- imports), MEMBER is `member`.
--
CREATE VIEW studio.studio_location_members AS
 SELECT r.id,
    r."locationId" AS location_id,
    (l."authRealm")::text AS location_app,
    u."clerkId" AS clerk_user_id,
    CASE r.role WHEN 'ADMIN'::public."UserRole" THEN 'owner'::text ELSE 'member'::text END AS role,
    (r."createdAt" AT TIME ZONE 'UTC') AS created_at,
    (r."updatedAt" AT TIME ZONE 'UTC') AS updated_at
   FROM public."UserLocationRole" r
     JOIN public."User" u ON u.id = r."userId"
     JOIN public."Location" l ON l.id = r."locationId" AND l."authRealm" = u."authRealm"
     JOIN public."_LocationToUser" lu ON lu."A" = l.id AND lu."B" = u.id
  WHERE u."clerkId" IS NOT NULL;

REVOKE ALL ON TABLE studio.studio_locations, studio.studio_location_members FROM PUBLIC;
"""


def main(src, dst):
    text = open(src, encoding="utf-8").read()
    text = "\n".join(line for line in text.split("\n") if not line.startswith("\\"))  # pg_dump \restrict guards
    body = [transform(b) for b in blocks(text) if keep(b)]
    out = "".join(body)
    out = re.sub(r"\n{3,}", "\n\n", out)
    leftovers = re.findall(r"studio\.studio_location_memberships|public\.studio_|studio_create_substo_location|REFERENCES studio\.studio_locations", out)
    if leftovers:
        raise SystemExit(f"unexpected leftovers: {sorted(set(leftovers))}")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("-- Studio moves into the CRM database (generated by scripts/codemods/studio-merge-schema.py,\n")
        f.write("-- then reviewed). Studio data is keyed by the CRM Location; Prisma manages only `public`.\n")
        f.write("BEGIN;\nSET LOCAL check_function_bodies = false;\nCREATE SCHEMA studio;\nREVOKE ALL ON SCHEMA studio FROM PUBLIC;\n\n")
        f.write(out.strip() + "\n")
        f.write(VIEWS)
        f.write("\nCOMMIT;\n")


if __name__ == "__main__":
    main(*sys.argv[1:3])
