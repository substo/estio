import assert from "node:assert/strict";
import test from "node:test";
import {
    buildGoogleContactDirectoryEntry,
    getGoogleContactPhoneSuffix,
    isGoogleContactPhoneQuery,
    normalizeGoogleContactPhone,
    normalizeGoogleContactSearchText,
} from "./contact-directory-index";

test("normalizes names and emails for accent-insensitive directory search", () => {
    assert.equal(normalizeGoogleContactSearchText("  Élise   O'Connor  "), "elise o'connor");
    assert.equal(normalizeGoogleContactSearchText("USER@Example.COM"), "user@example.com");
});

test("normalizes phone numbers and uses the same seven-digit identity suffix as sync matching", () => {
    assert.equal(normalizeGoogleContactPhone("+357 (99) 123-456"), "35799123456");
    assert.equal(getGoogleContactPhoneSuffix("+357 (99) 123-456"), "9123456");
    assert.equal(isGoogleContactPhoneQuery("+357 (99) 123-456"), true);
    assert.equal(isGoogleContactPhoneQuery("Martin 123"), false);
});

test("builds a searchable directory row without persisting raw Google payloads", () => {
    const updatedAt = new Date("2026-07-24T09:00:00.000Z");
    const entry = buildGoogleContactDirectoryEntry("user-1", {
        resourceName: "people/c123",
        name: " Élise Example ",
        email: "ELISE@EXAMPLE.COM",
        phone: "+357 99 123456",
        photo: "https://example.test/photo",
        etag: "etag-1",
        updateTime: updatedAt,
        searchEmails: ["ELISE@EXAMPLE.COM", "other@example.com"],
        searchPhones: ["+357 99 123456", "+44 7700 900123"],
    });

    assert.deepEqual(entry, {
        userId: "user-1",
        resourceName: "people/c123",
        name: " Élise Example ",
        email: "ELISE@EXAMPLE.COM",
        phone: "+357 99 123456",
        photo: "https://example.test/photo",
        etag: "etag-1",
        googleUpdatedAt: updatedAt,
        normalizedName: "elise example",
        normalizedEmail: "elise@example.com",
        searchText: "elise example elise@example.com other@example.com 35799123456 447700900123",
        phoneDigits: "35799123456",
        phoneSuffix: "9123456",
        phoneKeys: ["35799123456", "9123456", "447700900123", "0900123"],
    });
});

test("skips Google directory records without a resource name", () => {
    assert.equal(buildGoogleContactDirectoryEntry("user-1", {
        resourceName: undefined,
        name: "No ID",
        email: undefined,
        phone: undefined,
        photo: undefined,
        etag: undefined,
        updateTime: undefined,
    }), null);
});
