import test from "node:test";
import assert from "node:assert/strict";

import {
    canOpenDirectChatForParticipant,
    extractGroupParticipantIdentity,
    formatGroupParticipantIdentitySummary,
} from "./group-participants";

test("extractGroupParticipantIdentity prefers verified phone jid", () => {
    const result = extractGroupParticipantIdentity({
        participantJid: "12345@lid",
        senderPhoneJid: "35799111222@s.whatsapp.net",
        pushName: "Savvas",
    });

    assert.equal(result.identityKey, "phone:35799111222@s.whatsapp.net");
    assert.equal(result.phoneDigits, "35799111222");
    assert.equal(result.lidJid, "12345@lid");
    assert.equal(result.displayName, "Savvas");
    assert.equal(result.resolutionConfidence, "verified_phone_jid");
    assert.equal(canOpenDirectChatForParticipant(result), true);
});

test("extractGroupParticipantIdentity keeps lid-only participants unresolved", () => {
    const result = extractGroupParticipantIdentity({
        participantJid: "987654321@lid",
        pushName: "Unknown",
    });

    assert.equal(result.identityKey, "lid:987654321@lid");
    assert.equal(result.phoneJid, null);
    assert.equal(result.phoneDigits, null);
    assert.equal(result.resolutionConfidence, "lid_only");
    assert.equal(canOpenDirectChatForParticipant(result), false);
    assert.equal(formatGroupParticipantIdentitySummary(result), "987654321@lid");
});
