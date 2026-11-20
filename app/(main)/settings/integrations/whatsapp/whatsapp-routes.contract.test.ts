import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFriendlyLinkedPhoneStatus } from "./linked-phone-status";

const overview = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const linkedPhone = readFileSync(new URL("./linked-phone/linked-phone-client.tsx", import.meta.url), "utf8");
const meta = readFileSync(new URL("./meta/meta-settings-client.tsx", import.meta.url), "utf8");
const twilio = readFileSync(new URL("./twilio/page.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

test("overview presents the linked phone first and makes it the only recommended connection", () => {
    const linkedIndex = overview.indexOf("Connect your WhatsApp phone");
    const metaIndex = overview.indexOf("Meta business connection");
    const twilioIndex = overview.indexOf("<CardTitle>Twilio</CardTitle>");

    assert.ok(linkedIndex >= 0 && linkedIndex < metaIndex && metaIndex < twilioIndex);
    assert.match(overview, /Connect your WhatsApp phone[\s\S]*Recommended/);
    assert.doesNotMatch(overview.slice(metaIndex), /Meta business connection[\s\S]{0,500}Recommended/);
    assert.match(overview, /Advanced · Beta/);
    assert.match(overview, /<CardTitle>Twilio<\/CardTitle>/);
    assert.match(overview, /Not available/);
});

test("linked-phone status maps runtime state to plain language", () => {
    assert.equal(getFriendlyLinkedPhoneStatus({ webBridgeDiagnostics: { reachable: false } }).label, "Service unavailable");
    assert.equal(getFriendlyLinkedPhoneStatus({ webBridgeDiagnostics: { reachable: true, status: "qr_required" } }).label, "Scan required");
    assert.equal(getFriendlyLinkedPhoneStatus({ webBridgeDiagnostics: { reachable: true, status: "stale_worker" } }).label, "Reconnecting");
    assert.equal(getFriendlyLinkedPhoneStatus({ webBridgeSession: { status: "ready" }, webBridgeDiagnostics: { reachable: true, workerReady: true } }).label, "Connected");
    assert.equal(getFriendlyLinkedPhoneStatus({ webBridgeDiagnostics: { reachable: true } }).label, "Not connected");
});

test("novice and unavailable routes do not expose Twilio credential setup", () => {
    for (const source of [overview, twilio]) {
        assert.doesNotMatch(source, /Account SID|Auth Token|twilio-sid|twilio-token|Save Twilio Settings/);
    }
    assert.match(twilio, /Twilio is not currently available/);
    assert.match(twilio, /existing legacy configuration/i);
    assert.doesNotMatch(meta, /twilio-sid|twilio-token|Save Twilio Settings|Provider \(BYON\)/);
});

test("linked-phone route provides QR setup, plain-language actions, and collapsed diagnostics", () => {
    assert.match(linkedPhone, /Connect your WhatsApp phone/);
    assert.match(linkedPhone, /Open WhatsApp on the phone/);
    assert.match(linkedPhone, /Linked devices/);
    assert.match(linkedPhone, /Link a device/);
    assert.match(linkedPhone, /Connect with QR code/);
    assert.match(linkedPhone, /Try reconnecting/);
    assert.match(linkedPhone, /QR code for linking this WhatsApp phone/);
    assert.match(linkedPhone, /useState\(false\)[\s\S]*Technical details/);
});

test("forget-phone confirmation uses the accessible alert dialog contract", () => {
    assert.match(linkedPhone, /<AlertDialog>/);
    assert.match(linkedPhone, /<AlertDialogTitle>Forget this phone\?<\/AlertDialogTitle>/);
    assert.match(linkedPhone, /need to scan a new QR code/);
    assert.match(linkedPhone, /<AlertDialogCancel>Keep phone<\/AlertDialogCancel>/);
    assert.match(linkedPhone, /clearWhatsAppWebBridge/);
    assert.doesNotMatch(linkedPhone, /window\.confirm/);
});

test("Meta route contains advanced Cloud setup without recommending it as the normal connection", () => {
    assert.match(meta, /Meta business connection/);
    assert.match(meta, /Advanced setup/);
    assert.match(meta, /2\. Templates/);
    assert.match(meta, /3\. Calling/);
    assert.match(meta, /4\. Manual configuration/);
    assert.match(meta, /Embedded signup/);
    assert.doesNotMatch(meta, /Embedded Signup \(Recommended\)|Provider Mode/);
});

test("page loads remain read-only and provider changes require explicit trusted actions", () => {
    assert.match(overview, /await getWhatsAppSettings\(null\)/);
    assert.doesNotMatch(overview, /connectWhatsAppWebBridge|setWhatsAppWebBridgeDefault|updateWhatsAppSettings/);
    assert.match(twilio, /await getWhatsAppSettings\(null\)/);
    assert.doesNotMatch(twilio, /updateWhatsAppSettings|setWhatsAppWebBridgeDefault/);
    assert.match(linkedPhone, /useEffect\(\(\) => \{[\s\S]*loadSettings\(\)/);
    assert.match(meta, /formData\.append\("whatsappProviderMode", settings\.whatsappProviderMode\)/);
    assert.doesNotMatch(linkedPhone, /useEffect\([\s\S]{0,300}connectWhatsAppWebBridge/);
});

test("linked-phone connect/default actions still select web_bridge and authorization remains location-owned", () => {
    assert.match(actions, /async function resolveAdminContext[\s\S]*auth\(\)/);
    assert.match(actions, /verifyUserIsLocationAdmin\(userId, locationId\)/);
    assert.match(actions, /connectWhatsAppWebBridge[\s\S]*whatsappProviderMode: "web_bridge"/);
    assert.match(actions, /setWhatsAppWebBridgeDefault[\s\S]*whatsappProviderMode: "web_bridge"/);
    assert.match(actions, /getWhatsAppSettings[\s\S]*resolveAdminContext/);
});

test("new route UI introduces no Twilio activation path", () => {
    for (const source of [overview, linkedPhone, meta, twilio]) {
        assert.doesNotMatch(source, /twilio_fallback/);
    }
});
