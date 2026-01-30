import urllib.request
import urllib.error
import ssl

# Ignore SSL certificate errors
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

base_urls = ["https://altia.com.cy", "https://www.altia.com.cy", "https://marketplace.altia.com.cy"]
paths = [
    "/feed.xml", "/feed", "/rss.xml", "/rss",
    "/xml", "/xml-feed", "/xmlfeed", "/xml/export", "/xml/properties",
    "/properties.xml", "/propertyfeed.xml", "/property-feed.xml",
    "/listings.xml", "/listings-feed.xml", "/feeds/properties.xml",
    "/data/properties.xml", "/xml/listings.xml",
    "/export.xml", "/export/feed.xml", "/export/properties.xml",
    "/export/property-feed.xml", "/import/xml",
    "/api/xml", "/api/feed/xml", "/api/properties.xml",
    "/sitemap.xml", "/sitemap_index.xml", "/sitemap-properties.xml", "/sitemap-listings.xml"
]

all_urls = []
for base in base_urls:
    for path in paths:
        all_urls.append(base + path)

print(f"Checking {len(all_urls)} URLs...")

found = []

for url in all_urls:
    try:
        # Switch to GET to inspect content
        req = urllib.request.Request(url, method='GET')
        req.add_header('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36')
        
        with urllib.request.urlopen(req, timeout=5, context=ctx) as response:
            code = response.getcode()
            ctype = response.headers.get('Content-Type', '').lower()
            content = response.read(500).decode('utf-8', errors='ignore')
            
            is_xml_content = '<?xml' in content or '<rss' in content or '<feed' in content or '<urlset' in content
            
            if code == 200:
                if is_xml_content:
                     print(f"[FOUND XML] {url} - {ctype}")
                     found.append((url, ctype))
                else:
                     # It is likely a soft 404 html page
                     pass
            elif code == 301 or code == 302:
                 print(f"[{code}] {url} -> {response.headers.get('Location')}")
    except urllib.error.HTTPError as e:
        # print(f"[{e.code}] {url}")
        pass
    except Exception as e:
        # print(f"[ERR] {url} - {e}")
        pass

print("\n--- Summary of Potential XML Feeds ---")
for f in found:
    print(f"FOUND: {f[0]} ({f[1]})")
