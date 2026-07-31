import assert from "node:assert/strict";
import test from "node:test";

import {
    createSafeRemoteImageDownloader,
    SafeRemoteImageError,
} from "./safe-remote-image";

const publicAddress = { address: "93.184.216.34", family: 4 };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]);

function imageResponse(bytes: Uint8Array = jpeg, contentType = "image/jpeg", headers: Record<string, string> = {}) {
    return new Response(bytes, { headers: { "content-type": contentType, ...headers } });
}

async function expectCode(promise: Promise<unknown>, code: string) {
    await assert.rejects(promise, (error: unknown) => (
        error instanceof SafeRemoteImageError && error.code === code
    ));
}

for (const destination of [
    "http://localhost/image.jpg",
    "http://127.0.0.1/image.jpg",
    "http://[::1]/image.jpg",
    "http://[fe80::1]/image.jpg",
    "http://[fc00::1]/image.jpg",
    "http://[ff02::1]/image.jpg",
    "http://10.0.0.1/image.jpg",
    "http://172.16.0.1/image.jpg",
    "http://192.168.1.1/image.jpg",
    "http://169.254.169.254/latest/meta-data",
    "http://192.0.2.1/image.jpg",
    "http://224.0.0.1/image.jpg",
]) {
    test(`blocks unsafe destination ${destination}`, async () => {
        const download = createSafeRemoteImageDownloader({
            lookupHost: async () => publicAddress ? [publicAddress] : [],
            requestHop: async () => imageResponse(),
        });
        await expectCode(download(destination), "unsafe_destination");
    });
}

test("blocks DNS answers containing private addresses", async () => {
    const download = createSafeRemoteImageDownloader({
        lookupHost: async () => [publicAddress, { address: "10.0.0.2", family: 4 }],
        requestHop: async () => imageResponse(),
    });
    await expectCode(download("https://example.com/image.jpg"), "unsafe_destination");
});

test("validates every redirect and blocks public-to-private redirects", async () => {
    const download = createSafeRemoteImageDownloader({
        lookupHost: async () => [publicAddress],
        requestHop: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/image.jpg" } }),
    });
    await expectCode(download("https://example.com/image.jpg"), "unsafe_destination");
});

test("returns terminal-dot Cloudflare redirects for ownership authorization without downloading", async () => {
    const download = createSafeRemoteImageDownloader({
        lookupHost: async () => [publicAddress],
        requestHop: async () => new Response(null, {
            status: 302,
            headers: { location: "https://imagedelivery.net./account/image/public" },
        }),
    });
    assert.deepEqual(await download("https://example.com/image.jpg"), {
        kind: "cloudflare",
        url: "https://imagedelivery.net./account/image/public",
    });
});

test("pins the validated DNS address into the request hop", async () => {
    let lookups = 0;
    let requestedAddress = "";
    const download = createSafeRemoteImageDownloader({
        lookupHost: async () => {
            lookups += 1;
            return [publicAddress];
        },
        requestHop: async (_url, pinned) => {
            requestedAddress = pinned.address;
            return imageResponse();
        },
    });
    await download("https://example.com/image.jpg");
    assert.equal(lookups, 1);
    assert.equal(requestedAddress, publicAddress.address);
});

for (const url of ["file:///etc/passwd", "data:image/png;base64,AA==", "https://user:pass@example.com/image.jpg"]) {
    test(`rejects non-web or credential URL ${url}`, async () => {
        const download = createSafeRemoteImageDownloader();
        await assert.rejects(download(url), SafeRemoteImageError);
    });
}

test("rejects non-image MIME types and misleading image MIME signatures", async () => {
    const base = { lookupHost: async () => [publicAddress] };
    await expectCode(createSafeRemoteImageDownloader({
        ...base,
        requestHop: async () => imageResponse(jpeg, "text/html"),
    })("https://example.com/image"), "unsupported_mime_type");
    await expectCode(createSafeRemoteImageDownloader({
        ...base,
        requestHop: async () => imageResponse(new TextEncoder().encode("not an image"), "image/jpeg"),
    })("https://example.com/image"), "invalid_image_signature");
});

test("enforces the streamed byte limit before creating a Blob", async () => {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(jpeg);
            controller.enqueue(new Uint8Array(20));
            controller.close();
        },
    });
    const download = createSafeRemoteImageDownloader({
        maxBytes: 8,
        lookupHost: async () => [publicAddress],
        requestHop: async () => new Response(stream, { headers: { "content-type": "image/jpeg" } }),
    });
    await expectCode(download("https://example.com/image.jpg"), "response_too_large");
});

test("aborts slow responses at the hard timeout", async () => {
    const download = createSafeRemoteImageDownloader({
        timeoutMs: 5,
        lookupHost: async () => [publicAddress],
        requestHop: async (_url, _address, signal) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    });
    await expectCode(download("https://example.com/image.jpg"), "timeout");
});
