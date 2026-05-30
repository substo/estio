-- Fast exact phone-number search for conversation/contact lookup.
-- The query path normalizes user input to digits, so index the same expression on Contact.phone.
CREATE INDEX IF NOT EXISTS "Contact_locationId_phoneDigits_expr_idx"
ON "Contact" (
    "locationId",
    (regexp_replace(COALESCE("phone", ''), '\D', '', 'g'))
);
