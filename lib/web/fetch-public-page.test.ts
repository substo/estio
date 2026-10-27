import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import zlib from "node:zlib";
import {
    fetchPublicPage,
    isBlockedAddress,
    nodeTransport,
    PublicPageFetchError,
    type HostResolver,
    type PublicPageTransport,
    type PublicPageTransportRequest,
} from "./fetch-public-page";

type FakeReply = { status?: number; headers?: Record<string, string>; body?: string | Buffer };

function fakeTransport(replies: Record<string, FakeReply>, calls: PublicPageTransportRequest[] = []): PublicPageTransport {
    return async (request) => {
        calls.push(request);
        const reply = replies[request.url.toString()];
        if (!reply) throw new Error(`unexpected request ${request.url}`);
        const body = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body ?? "");
        return {
            status: reply.status ?? 200,
            headers: { "content-type": "text/html; charset=utf-8", ...reply.headers },
            body: (async function* () { yield body; })(),
            cancel: () => {},
        };
    };
}

function resolver(map: Record<string, string[]>): HostResolver {
    return async (host) => {
        const addresses = map[host];
        if (!addresses) throw new Error("ENOTFOUND");
        return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    };
}

const publicDns = resolver({ "example.com": ["93.184.215.14"], "www.example.com": ["93.184.215.14"] });

async function rejectsWith(promise: Promise<unknown>, code: string) {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof PublicPageFetchError, `expected PublicPageFetchError, got ${error}`);
        assert.equal(error.code, code);
        return true;
    });
}

const neverTransport: PublicPageTransport = async () => {
    throw new Error("transport must not be called");
};

test("classifies private, reserved and IPv6-equivalent addresses as blocked", () => {
    for (const ip of [
        "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
        "192.0.0.170", "192.0.2.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "239.255.255.250", "240.0.0.1",
        "255.255.255.255", "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1",
        "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::7f00:1",
        "2001:db8::1", "2002:7f00:1::", "2001::1", "fe80::1%en0", "not-an-ip",
    ]) {
        assert.equal(isBlockedAddress(ip), true, ip);
    }
    for (const ip of ["93.184.215.14", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::6810:85e5", "::ffff:8.8.8.8"]) {
        assert.equal(isBlockedAddress(ip), false, ip);
    }
});

test("rejects literal private IPs, including encoded and IPv6 forms, without connecting", async () => {
    for (const url of [
        "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://[::1]/",
        "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://2130706433/", "http://0x7f.1/",
        "http://100.64.1.1/",
    ]) {
        await rejectsWith(fetchPublicPage(url, { resolveHost: publicDns, transport: neverTransport }), "blocked_address");
    }
});

test("rejects other schemes, non-default ports, credentials and local hostnames", async () => {
    const opts = { resolveHost: publicDns, transport: neverTransport };
    await rejectsWith(fetchPublicPage("file:///etc/passwd", opts), "blocked_protocol");
    await rejectsWith(fetchPublicPage("ftp://example.com/", opts), "blocked_protocol");
    await rejectsWith(fetchPublicPage("http://example.com:8080/", opts), "blocked_port");
    await rejectsWith(fetchPublicPage("https://example.com:80/", opts), "blocked_port");
    await rejectsWith(fetchPublicPage("http://user:pass@example.com/", opts), "blocked_credentials");
    await rejectsWith(fetchPublicPage("http://localhost/", opts), "blocked_host");
    await rejectsWith(fetchPublicPage("http://foo.localhost/", opts), "blocked_host");
    await rejectsWith(fetchPublicPage("http://metadata.google.internal/", opts), "blocked_host");
    await rejectsWith(fetchPublicPage("not a url", opts), "invalid_url");
});

test("rejects a name whose DNS answers include a private address", async () => {
    const dns = resolver({
        "evil.example": ["10.0.0.7"],
        "metadata.example": ["169.254.169.254"],
        "mixed.example": ["93.184.215.14", "127.0.0.1"],
        "v6.example": ["fd00::7"],
        "mapped.example": ["::ffff:192.168.0.1"],
    });
    for (const host of ["evil.example", "metadata.example", "mixed.example", "v6.example", "mapped.example"]) {
        await rejectsWith(fetchPublicPage(`https://${host}/`, { resolveHost: dns, transport: neverTransport }), "blocked_address");
    }
    await rejectsWith(fetchPublicPage("https://missing.example/", { resolveHost: dns, transport: neverTransport }), "dns_failed");
});

test("re-checks redirect hops and blocks a redirect to a private address", async () => {
    const dns = resolver({ "example.com": ["93.184.215.14"], "internal.example": ["192.168.1.10"] });
    const calls: PublicPageTransportRequest[] = [];
    const transport = fakeTransport({
        "https://example.com/a": { status: 302, headers: { location: "http://internal.example/admin" } },
        "https://example.com/b": { status: 301, headers: { location: "http://169.254.169.254/latest/meta-data/" } },
        "https://example.com/c": { status: 307, headers: { location: "http://example.com:2375/" } },
    }, calls);

    await rejectsWith(fetchPublicPage("https://example.com/a", { resolveHost: dns, transport }), "blocked_address");
    await rejectsWith(fetchPublicPage("https://example.com/b", { resolveHost: dns, transport }), "blocked_address");
    await rejectsWith(fetchPublicPage("https://example.com/c", { resolveHost: dns, transport }), "blocked_port");
    assert.deepEqual(calls.map((c) => c.url.toString()), ["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
});

test("re-resolves each hop, so DNS rebinding on a redirect is caught", async () => {
    let lookups = 0;
    const rebinding: HostResolver = async () => {
        lookups += 1;
        return [{ address: lookups === 1 ? "93.184.215.14" : "127.0.0.1", family: 4 }];
    };
    const transport = fakeTransport({
        "https://rebind.example/": { status: 302, headers: { location: "/next" } },
    });
    await rejectsWith(fetchPublicPage("https://rebind.example/", { resolveHost: rebinding, transport }), "blocked_address");
    assert.equal(lookups, 2);
});

test("bounds the number of redirects", async () => {
    const replies: Record<string, FakeReply> = {};
    for (let i = 0; i < 10; i++) replies[`https://example.com/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    await rejectsWith(
        fetchPublicPage("https://example.com/0", { resolveHost: publicDns, transport: fakeTransport(replies), maxRedirects: 3 }),
        "too_many_redirects",
    );
});

test("rejects oversize bodies, declared or streamed, including after decompression", async () => {
    const big = "<p>" + "x".repeat(5000) + "</p>";
    const opts = (reply: FakeReply) => ({
        resolveHost: publicDns,
        transport: fakeTransport({ "https://example.com/": reply }),
        maxBytes: 1000,
    });
    await rejectsWith(fetchPublicPage("https://example.com/", opts({ body: big, headers: { "content-length": "5007" } })), "too_large");
    await rejectsWith(fetchPublicPage("https://example.com/", opts({ body: big })), "too_large");
    await rejectsWith(
        fetchPublicPage("https://example.com/", opts({ body: zlib.gzipSync(big), headers: { "content-encoding": "gzip" } })),
        "too_large",
    );
});

test("rejects disallowed content types and HTTP errors", async () => {
    const make = (reply: FakeReply) => fetchPublicPage("https://example.com/", {
        resolveHost: publicDns,
        transport: fakeTransport({ "https://example.com/": reply }),
    });
    await rejectsWith(make({ headers: { "content-type": "application/pdf" }, body: "%PDF" }), "unsupported_content_type");
    await rejectsWith(make({ headers: { "content-type": "image/png" }, body: "png" }), "unsupported_content_type");
    await rejectsWith(make({ headers: { "content-type": "" }, body: "?" }), "unsupported_content_type");
    await rejectsWith(make({ status: 404, body: "nope" }), "http_error");
});

test("times out a slow page", async () => {
    const slow: PublicPageTransport = (request) => new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    await rejectsWith(fetchPublicPage("https://example.com/", { resolveHost: publicDns, transport: slow, timeoutMs: 30 }), "timeout");
    const slowDns: HostResolver = () => new Promise(() => {});
    await rejectsWith(fetchPublicPage("https://example.com/", { resolveHost: slowDns, transport: neverTransport, timeoutMs: 30 }), "timeout");
});

test("fetches a public page via the vetted IP, follows a safe redirect and extracts metadata", async () => {
    const html = `<!doctype html><html><head>
        <title> Acme &amp; Co </title>
        <meta content="Hand-made widgets" name="description">
        <meta property="og:title" content="Acme OG">
        <meta property="og:description" content='Widgets &#8211; since 1990'>
        <meta property="og:image" content="/img/logo.png">
        <style>.x{}</style><script>alert(1)</script>
        </head><body><h1>Welcome</h1><p>We make widgets.</p></body></html>`;
    const calls: PublicPageTransportRequest[] = [];
    const transport = fakeTransport({
        "http://example.com/": { status: 301, headers: { location: "https://www.example.com/home" } },
        "https://www.example.com/home": { body: zlib.gzipSync(html), headers: { "content-encoding": "gzip" } },
    }, calls);

    const page = await fetchPublicPage("http://example.com/#frag", { resolveHost: publicDns, transport, maxTextChars: 15 });
    assert.equal(page.url, "http://example.com/");
    assert.equal(page.finalUrl, "https://www.example.com/home");
    assert.equal(page.title, "Acme & Co");
    assert.equal(page.description, "Hand-made widgets");
    assert.equal(page.ogTitle, "Acme OG");
    assert.equal(page.ogDescription, "Widgets – since 1990");
    assert.equal(page.ogImage, "https://www.example.com/img/logo.png");
    assert.equal(page.text, "Acme & Co Welco");
    assert.equal(page.truncated, true);
    assert.ok(!page.text.includes("alert"));
    assert.deepEqual(calls.map((c) => c.address.address), ["93.184.215.14", "93.184.215.14"]);
});

test("plain-text pages are returned as text", async () => {
    const page = await fetchPublicPage("https://example.com/robots.txt", {
        resolveHost: publicDns,
        transport: fakeTransport({ "https://example.com/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nAllow: /" } }),
    });
    assert.equal(page.text, "User-agent: * Allow: /");
    assert.equal(page.title, null);
});

test("node transport connects to the vetted address, not a fresh DNS answer", async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<title>${req.headers.host}</title>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
        // The hostname does not exist in DNS; the transport must use the pinned address only.
        const response = await nodeTransport({
            url: new URL(`http://pinned.invalid:${port}/`),
            address: { address: "127.0.0.1", family: 4 },
            headers: {},
            signal: new AbortController().signal,
        });
        assert.equal(response.status, 200);
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
        assert.equal(Buffer.concat(chunks).toString(), `<title>pinned.invalid:${port}</title>`);
    } finally {
        server.close();
    }
});
