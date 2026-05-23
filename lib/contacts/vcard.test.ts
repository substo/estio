import assert from "node:assert/strict";
import test from "node:test";
import {
    getSharedContactReadableMessage,
    isVCardMedia,
    parseSharedContactsFromMessageBody,
    parseVCardContacts,
} from "./vcard";

test("parses vCard 3.0 contact fields", () => {
    const contacts = parseVCardContacts(`BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
N:Doe;Jane;;;
TEL;TYPE=CELL:+35799111222
EMAIL:jane@example.com
ORG:Estio
END:VCARD`);

    assert.deepEqual(contacts, [{
        displayName: "Jane Doe",
        phoneNumber: "+35799111222",
        email: "jane@example.com",
        organization: "Estio",
    }]);
});

test("parses folded vCard 4.0 values", () => {
    const contacts = parseVCardContacts(`BEGIN:VCARD\r
VERSION:4.0\r
FN:Very Long\r
  Contact\r
TEL;VALUE=uri:tel:+35799111222\r
END:VCARD`);

    assert.equal(contacts[0]?.displayName, "Very Long Contact");
    assert.equal(contacts[0]?.phoneNumber, "+35799111222");
});

test("falls back to structured name, phone, and email", () => {
    assert.equal(parseVCardContacts(`BEGIN:VCARD
VERSION:3.0
N:Doe;John;;;
END:VCARD`)[0]?.displayName, "John Doe");

    assert.equal(parseVCardContacts(`BEGIN:VCARD
VERSION:3.0
TEL:+35799111222
END:VCARD`)[0]?.displayName, "+35799111222");

    assert.equal(parseVCardContacts(`BEGIN:VCARD
VERSION:3.0
EMAIL:lead@example.com
END:VCARD`)[0]?.displayName, "lead@example.com");
});

test("parses multiple vCards from one payload", () => {
    const contacts = parseVCardContacts(`BEGIN:VCARD
VERSION:3.0
FN:One
TEL:+111
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Two
EMAIL:two@example.com
END:VCARD`);

    assert.equal(contacts.length, 2);
    assert.equal(contacts[0].displayName, "One");
    assert.equal(contacts[1].email, "two@example.com");
});

test("classifies vCard media by content type or filename", () => {
    assert.equal(isVCardMedia({ contentType: "text/vcard" }), true);
    assert.equal(isVCardMedia({ contentType: "text/x-vcard; charset=utf-8" }), true);
    assert.equal(isVCardMedia({ fileName: "contact.vcf" }), true);
    assert.equal(isVCardMedia({ url: "https://example.com/contact.vcard?x=1" }), true);
    assert.equal(isVCardMedia({ contentType: "image/png", fileName: "photo.png" }), false);
    assert.equal(isVCardMedia({ contentType: "application/pdf", fileName: "doc.pdf" }), false);
});

test("parses raw vCard message body into shared contacts", () => {
    const contacts = parseSharedContactsFromMessageBody(`BEGIN:VCARD
VERSION:3.0
N:;Savvas Down Town Cyprus Sales and Rentals.;;;
FN:Savvas Down Town Cyprus Sales and Rentals.
TEL;type=Mobile;waid=35799917191:+357 99 917191
X-WA-BIZ-DESCRIPTION:Your trusted real estate agent.
X-WA-BIZ-NAME:Savvas Down Town Cyprus Sales and Rentals.
END:VCARD`);

    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].displayName, "Savvas Down Town Cyprus Sales and Rentals.");
    assert.equal(contacts[0].phoneNumber, "+357 99 917191");
    assert.equal(getSharedContactReadableMessage(`BEGIN:VCARD
VERSION:3.0
FN:Savvas Down Town Cyprus Sales and Rentals.
END:VCARD`), "Savvas Down Town Cyprus Sales and Rentals.");
});

test("parses structured contact message body into shared contacts", () => {
    const contacts = parseSharedContactsFromMessageBody(`[Contact]
---CONTACTS_DATA---
[{"displayName":"Rolf","phoneNumber":"+35799111222","email":"rolf@example.com"}]`);

    assert.deepEqual(contacts, [{
        displayName: "Rolf",
        phoneNumber: "+35799111222",
        email: "rolf@example.com",
        organization: null,
    }]);
    assert.equal(getSharedContactReadableMessage(`[Contact]
---CONTACTS_DATA---
[]`), "[Contact]");
});
