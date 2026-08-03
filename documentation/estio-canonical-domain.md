# Estio Canonical Domain Runbook

## Policy

- Canonical application origin: `https://estio.co`
- `www.estio.co` is a redirect-only hostname.
- Redirect status: `308 Permanent Redirect`.
- Preserve the complete path and query string.
- Namecheap is the registrar only. Cloudflare's nameservers are authoritative,
  so web-routing changes belong in Cloudflare DNS/Rules and in Caddy.

## Cloudflare configuration

### DNS

Keep one proxied record for `www` that routes to the Estio origin:

```text
Type: CNAME
Name: www
Target: estio.co
Proxy status: Proxied
TTL: Auto
```

Remove or replace any `www` record whose target is a Namecheap parking host or
parking IP. Do not configure Namecheap URL forwarding while Cloudflare remains
authoritative for the zone.

### Redirect Rule

Create a Cloudflare Single Redirect named `Canonicalize www.estio.co`:

```text
When: Hostname equals www.estio.co
Target: https://estio.co${uri}
Status: 308
Preserve query string: Yes
```

Use the dashboard's wildcard/dynamic URL builder so the original path is
inserted once. Do not append the query manually when `Preserve query string` is
enabled.

The edge rule is the primary redirect. Caddy and Next.js middleware implement
the same policy as defense in depth and for requests that bypass the edge.

### TLS

Use Cloudflare `Full (strict)` after the origin presents a valid certificate for
both `estio.co` and `www.estio.co`. The source-controlled `Caddyfile` lists both
hosts explicitly, so Caddy automatically obtains and renews those certificates.

## Verification

Run after every DNS, edge-rule, or Caddy change:

```bash
curl -sS -o /dev/null -D - http://estio.co/test?source=domain-check
curl -sS -o /dev/null -D - https://estio.co/test?source=domain-check
curl -sS -o /dev/null -D - http://www.estio.co/test?source=domain-check
curl -sS -o /dev/null -D - https://www.estio.co/test?source=domain-check
```

Expected results:

- `https://estio.co/...` reaches the application.
- Every other scheme/host variant reaches `https://estio.co/...` in no more
  than one redirect where Cloudflare rules apply.
- The `www` redirect retains `/test?source=domain-check`.
- No response contains Namecheap parking content or a Cloudflare `525`/`526`.

Also verify the origin certificate and application health:

```bash
openssl s_client -connect 138.199.214.117:443 -servername www.estio.co </dev/null \
  | openssl x509 -noout -ext subjectAltName
curl -fsS https://estio.co/api/health
```
