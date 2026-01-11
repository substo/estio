#!/usr/bin/env python3
"""
Cyprus Real Estate XML Feed Discovery Script

This script systematically discovers and validates publicly accessible XML property feeds
from Cyprus real estate agencies and developers.

Tracks:
1. Seed target list (predefined Cyprus agencies)
2. Endpoint pattern probing (common feed paths)
3. Sitemap pivot (discover feeds via sitemaps)
4. Validation (verify feeds contain property listings)
"""

import requests
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse
from typing import List, Dict, Optional, Tuple
import time
from dataclasses import dataclass, field
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configuration
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
REQUEST_TIMEOUT = 10
RATE_LIMIT_DELAY = 0.5  # seconds between requests to same domain
MAX_WORKERS = 5

# Cyprus real estate domains (from initial research)
CYPRUS_DOMAINS = [
    "pafilia.com",
    "imperioproperties.com",
    "cyprusestateagency.com",
    "cyprusestateagents.com",
    "cyprus101.com",
    "galaxiaestates.com",
    "mresidence.com",
    "livadhiotisdevelopers.com",
    "cyprusproperties.com.cy",
    "gplazarou.com",
    "mayfaircyprus.com",
    "giovani.cy",
    "oikos-cy.com",
    "photiouestates.com",
    "karmadevelopers.com.cy",
    "chris-michael.com.cy",
    "home.cy",
]

# Common feed endpoint patterns to test
FEED_PATTERNS = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/feed.xml",
    "/feeds.xml",
    "/feeds/properties.xml",
    "/properties.xml",
    "/listings.xml",
    "/export.xml",
    "/xml",
    "/xml/",
    "/property-feed.xml",
    "/api/feed",
    "/api/feed.xml",
    "/api/xml",
    "/wp-sitemap.xml",
    "/feed/",
    "/?feed=rss",
    "/?feed=xml",
    "/?feed=properties",
    "/?format=xml",
    "/?output=xml",
]

# XML tags that indicate property listings
LISTING_TAGS = [
    "property", "listing", "item", "offer", "unit", 
    "estate", "accommodation", "ad", "advert"
]

# Fields that indicate property data
PROPERTY_FIELDS = [
    "price", "currency", "bedrooms", "bathrooms", "area", 
    "location", "reference", "ref", "id", "description", 
    "image", "images", "photo", "photos", "latitude", 
    "longitude", "coordinates", "address", "title", "type"
]


@dataclass
class FeedCandidate:
    """Represents a potential XML feed"""
    url: str
    domain: str
    status_code: Optional[int] = None
    content_type: Optional[str] = None
    root_tag: Optional[str] = None
    is_valid_xml: bool = False
    feed_type: str = "Unknown"  # "Listings XML feed", "Sitemap", "Blog RSS", "Unknown XML"
    listing_count: int = 0
    sample_fields: List[str] = field(default_factory=list)
    error: Optional[str] = None
    confidence_score: int = 0  # 0-100


class FeedDiscovery:
    """Main feed discovery engine"""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self.results: List[FeedCandidate] = []
        
    def fetch_url(self, url: str) -> Tuple[Optional[requests.Response], Optional[str]]:
        """Fetch a URL and return response or error"""
        try:
            response = self.session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            time.sleep(RATE_LIMIT_DELAY)
            return response, None
        except requests.exceptions.RequestException as e:
            return None, str(e)
    
    def parse_xml(self, content: str) -> Optional[ET.Element]:
        """Parse XML content and return root element"""
        try:
            return ET.fromstring(content)
        except ET.ParseError:
            return None
    
    def extract_all_tags(self, root: ET.Element, max_depth: int = 5) -> set:
        """Extract all unique tag names from XML tree"""
        tags = set()
        
        def traverse(element, depth=0):
            if depth > max_depth:
                return
            # Remove namespace if present
            tag = element.tag.split('}')[-1] if '}' in element.tag else element.tag
            tags.add(tag.lower())
            for child in element:
                traverse(child, depth + 1)
        
        traverse(root)
        return tags
    
    def count_listing_nodes(self, root: ET.Element) -> int:
        """Count nodes that look like property listings"""
        count = 0
        for tag in LISTING_TAGS:
            # Try with and without namespace
            count += len(root.findall(f".//{tag}"))
            count += len(root.findall(f".//{{*}}{tag}"))
        return count
    
    def extract_sample_fields(self, root: ET.Element, limit: int = 10) -> List[str]:
        """Extract sample field names that match property semantics"""
        all_tags = self.extract_all_tags(root)
        property_tags = [tag for tag in all_tags if any(field in tag for field in PROPERTY_FIELDS)]
        return sorted(list(set(property_tags)))[:limit]
    
    def classify_feed(self, root: ET.Element, url: str) -> Tuple[str, int]:
        """
        Classify the XML feed type and assign confidence score
        Returns: (feed_type, confidence_score)
        """
        root_tag = root.tag.split('}')[-1].lower() if '}' in root.tag else root.tag.lower()
        all_tags = self.extract_all_tags(root)
        listing_count = self.count_listing_nodes(root)
        sample_fields = self.extract_sample_fields(root)
        
        # Check for sitemap
        if root_tag in ['urlset', 'sitemapindex'] or 'sitemap' in url.lower():
            # Check if sitemap contains property data (rare but possible)
            if len(sample_fields) >= 2 and listing_count > 0:
                return "Sitemap with property data", 60
            return "Sitemap", 20
        
        # Check for RSS/blog feed
        if root_tag in ['rss', 'feed'] and 'blog' in url.lower():
            return "Blog RSS", 10
        
        # Check for property listings feed
        if listing_count >= 3 and len(sample_fields) >= 2:
            # High confidence - has listing nodes and property fields
            confidence = min(100, 70 + (listing_count * 2) + (len(sample_fields) * 3))
            return "Listings XML feed", confidence
        elif listing_count >= 1 and len(sample_fields) >= 1:
            # Medium confidence
            return "Possible listings feed", 50
        elif len(sample_fields) >= 3:
            # Has property fields but no clear listing structure
            return "Property data XML", 40
        
        return "Unknown XML", 20
    
    def validate_candidate(self, candidate: FeedCandidate, response: requests.Response) -> None:
        """Validate and classify a feed candidate"""
        candidate.status_code = response.status_code
        candidate.content_type = response.headers.get('Content-Type', '')
        
        # Check if response is XML
        if response.status_code != 200:
            candidate.error = f"HTTP {response.status_code}"
            return
        
        # Parse XML
        root = self.parse_xml(response.text)
        if root is None:
            candidate.error = "Invalid XML"
            return
        
        candidate.is_valid_xml = True
        candidate.root_tag = root.tag.split('}')[-1] if '}' in root.tag else root.tag
        candidate.listing_count = self.count_listing_nodes(root)
        candidate.sample_fields = self.extract_sample_fields(root)
        candidate.feed_type, candidate.confidence_score = self.classify_feed(root, candidate.url)
    
    def discover_from_sitemap(self, sitemap_url: str, domain: str) -> List[str]:
        """Extract potential feed URLs from sitemap"""
        response, error = self.fetch_url(sitemap_url)
        if error or not response or response.status_code != 200:
            return []
        
        root = self.parse_xml(response.text)
        if root is None:
            return []
        
        feed_urls = []
        # Look for <loc> tags containing feed-like patterns
        for loc in root.findall('.//{*}loc'):
            url = loc.text
            if url and any(pattern in url.lower() for pattern in ['feed', 'export', 'api', 'xml', 'properties', 'listings']):
                if url.endswith('.xml') or '/feed' in url or '/api' in url:
                    feed_urls.append(url)
        
        return feed_urls
    
    def test_domain(self, domain: str) -> List[FeedCandidate]:
        """Test all feed patterns for a single domain"""
        domain_results = []
        base_url = f"https://{domain}"
        
        print(f"\n🔍 Testing domain: {domain}")
        
        # Track 2: Test common feed patterns
        for pattern in FEED_PATTERNS:
            url = urljoin(base_url, pattern)
            candidate = FeedCandidate(url=url, domain=domain)
            
            response, error = self.fetch_url(url)
            if error:
                candidate.error = error
                continue
            
            if response and response.status_code == 200:
                self.validate_candidate(candidate, response)
                
                if candidate.is_valid_xml:
                    domain_results.append(candidate)
                    print(f"  ✓ Found XML: {url} ({candidate.feed_type}, score: {candidate.confidence_score})")
                    
                    # If we found a high-confidence listings feed, we can stop for this domain
                    if candidate.confidence_score >= 70:
                        print(f"  🎯 High-confidence feed found, stopping domain scan")
                        break
        
        # Track 3: Sitemap pivot
        sitemap_urls = [
            f"https://{domain}/sitemap.xml",
            f"https://{domain}/sitemap_index.xml"
        ]
        
        for sitemap_url in sitemap_urls:
            discovered_urls = self.discover_from_sitemap(sitemap_url, domain)
            for url in discovered_urls:
                # Skip if we already tested this URL
                if any(c.url == url for c in domain_results):
                    continue
                
                candidate = FeedCandidate(url=url, domain=domain)
                response, error = self.fetch_url(url)
                
                if response and response.status_code == 200:
                    self.validate_candidate(candidate, response)
                    if candidate.is_valid_xml and candidate.confidence_score >= 40:
                        domain_results.append(candidate)
                        print(f"  ✓ Found via sitemap: {url} ({candidate.feed_type}, score: {candidate.confidence_score})")
        
        return domain_results
    
    def run_discovery(self, domains: List[str]) -> List[FeedCandidate]:
        """Run discovery across all domains"""
        print("=" * 80)
        print("🚀 Starting Cyprus Real Estate XML Feed Discovery")
        print("=" * 80)
        print(f"📋 Testing {len(domains)} domains")
        print(f"🔧 Testing {len(FEED_PATTERNS)} endpoint patterns per domain")
        print()
        
        all_results = []
        
        # Process domains sequentially to respect rate limits
        for domain in domains:
            try:
                results = self.test_domain(domain)
                all_results.extend(results)
            except Exception as e:
                print(f"  ❌ Error testing {domain}: {e}")
        
        self.results = all_results
        return all_results
    
    def print_report(self):
        """Print formatted discovery report"""
        print("\n" + "=" * 80)
        print("📊 DISCOVERY REPORT")
        print("=" * 80)
        
        # Sort by confidence score (highest first)
        sorted_results = sorted(self.results, key=lambda x: x.confidence_score, reverse=True)
        
        # Group by feed type
        listings_feeds = [r for r in sorted_results if "Listings" in r.feed_type]
        sitemaps = [r for r in sorted_results if "Sitemap" in r.feed_type]
        other_xml = [r for r in sorted_results if r not in listings_feeds and r not in sitemaps]
        
        print(f"\n✅ CONFIRMED LISTINGS FEEDS: {len(listings_feeds)}")
        print("-" * 80)
        for i, result in enumerate(listings_feeds, 1):
            print(f"\n{i}. {result.domain}")
            print(f"   URL: {result.url}")
            print(f"   Type: {result.feed_type}")
            print(f"   Confidence: {result.confidence_score}/100")
            print(f"   Status: {result.status_code}")
            print(f"   Root tag: <{result.root_tag}>")
            print(f"   Listing nodes: {result.listing_count}")
            print(f"   Sample fields: {', '.join(result.sample_fields[:5])}")
        
        if not listings_feeds:
            print("   No confirmed listings feeds found.")
        
        print(f"\n📄 SITEMAPS FOUND: {len(sitemaps)}")
        print("-" * 80)
        for result in sitemaps[:5]:  # Show first 5
            print(f"   • {result.url} (score: {result.confidence_score})")
        
        print(f"\n❓ OTHER XML FOUND: {len(other_xml)}")
        print("-" * 80)
        for result in other_xml[:5]:  # Show first 5
            print(f"   • {result.url} - {result.feed_type} (score: {result.confidence_score})")
        
        print("\n" + "=" * 80)
        print(f"📈 SUMMARY")
        print("=" * 80)
        print(f"Total domains tested: {len(CYPRUS_DOMAINS)}")
        print(f"Total XML endpoints found: {len(self.results)}")
        print(f"Confirmed listings feeds: {len(listings_feeds)}")
        print(f"High-confidence feeds (≥70): {len([r for r in listings_feeds if r.confidence_score >= 70])}")
        print("=" * 80)
    
    def export_json(self, filename: str = "cyprus_feeds_results.json"):
        """Export results to JSON file"""
        data = {
            "discovery_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "domains_tested": len(CYPRUS_DOMAINS),
            "total_feeds_found": len(self.results),
            "results": [
                {
                    "url": r.url,
                    "domain": r.domain,
                    "feed_type": r.feed_type,
                    "confidence_score": r.confidence_score,
                    "status_code": r.status_code,
                    "root_tag": r.root_tag,
                    "listing_count": r.listing_count,
                    "sample_fields": r.sample_fields,
                    "error": r.error
                }
                for r in sorted(self.results, key=lambda x: x.confidence_score, reverse=True)
            ]
        }
        
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"\n💾 Results exported to: {filename}")


def main():
    """Main entry point"""
    discovery = FeedDiscovery()
    
    # Run discovery
    results = discovery.run_discovery(CYPRUS_DOMAINS)
    
    # Print report
    discovery.print_report()
    
    # Export to JSON
    discovery.export_json()
    
    # Return exit code based on success
    listings_feeds = [r for r in results if "Listings" in r.feed_type and r.confidence_score >= 70]
    if listings_feeds:
        print(f"\n🎉 SUCCESS: Found {len(listings_feeds)} high-confidence listings feed(s)!")
        return 0
    else:
        print(f"\n⚠️  No high-confidence listings feeds found. Found {len(results)} XML endpoints total.")
        return 1


if __name__ == "__main__":
    exit(main())
