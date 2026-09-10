import assert from "node:assert/strict";
import test from "node:test";
import { handlePublicImageDirectUpload } from "./service";
import { resolvePublicSiteContactContext } from "@/lib/auth/public-site-contact-context";

function request(body: Record<string, unknown>) {
    return new Request("https://a.example.com/api/public/images/direct-upload", {
        method: "POST",
        headers: { "content-type": "application/json", host: "a.example.com" },
        body: JSON.stringify(body),
    });
}

test("upload rejects a forged tenant before Cloudflare URL creation", async () => {
    let cloudflareCalls = 0;
    const response = await handlePublicImageDirectUpload(
        request({ locationId: "location-b" }),
        {
            getUserId: async () => "clerk-a",
            resolveContext: async () => ({ ok: false, reason: "tenant_mismatch" }),
            createUploadUrl: async () => { cloudflareCalls += 1; return {}; },
        },
    );
    assert.equal(response.status, 403);
    assert.equal(cloudflareCalls, 0);
});

test("upload rejects a Contact from another tenant before Cloudflare URL creation", async () => {
    let cloudflareCalls = 0;
    const response = await handlePublicImageDirectUpload(
        request({ locationId: "location-a" }),
        {
            getUserId: async () => "clerk-b",
            resolveContext: async (options) => resolvePublicSiteContactContext(options, {
                getUserId: async () => "clerk-b",
                getRequestHeaders: async () => new Headers({ host: "a.example.com" }),
                resolveDomain: async (hostname) => hostname === "a.example.com"
                    ? { locationId: "location-a" }
                    : null,
                findContact: async () => ({ id: "contact-b", locationId: "location-b" }),
            }),
            createUploadUrl: async () => { cloudflareCalls += 1; return {}; },
        },
    );
    assert.equal(response.status, 403);
    assert.equal(cloudflareCalls, 0);
});

test("upload rejects unknown and unavailable domains without Cloudflare calls", async () => {
    for (const [reason, status] of [["unknown_domain", 404], ["domain_unavailable", 503]] as const) {
        let cloudflareCalls = 0;
        const response = await handlePublicImageDirectUpload(request({}), {
            getUserId: async () => "clerk-a",
            resolveContext: async () => ({ ok: false, reason }),
            createUploadUrl: async () => { cloudflareCalls += 1; return {}; },
        });
        assert.equal(response.status, status);
        assert.equal(cloudflareCalls, 0);
    }
});

test("valid upload overwrites caller metadata with authoritative reserved values", async () => {
    let metadata: Record<string, unknown> | undefined;
    const response = await handlePublicImageDirectUpload(
        request({
            metadata: {
                filename: "house.jpg",
                locationId: "location-b",
                uploadedBy: "attacker",
                source: "forged",
            },
        }),
        {
            getUserId: async () => "clerk-a",
            resolveContext: async () => ({
                ok: true,
                context: {
                    userId: "clerk-a",
                    hostname: "a.example.com",
                    locationId: "location-a",
                    contact: { id: "contact-a", locationId: "location-a" },
                },
            }),
            createUploadUrl: async (options) => {
                metadata = options.metadata;
                return { uploadURL: "https://upload.example.com", imageId: "image-a" };
            },
        },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(metadata, {
        filename: "house.jpg",
        locationId: "location-a",
        uploadedBy: "clerk-a",
        source: "public-submission",
    });
});
