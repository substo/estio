

import { XMLParser } from 'fast-xml-parser';
import { FeedItem, FeedParser } from './base-parser';
import { FeedMappingConfig } from '../ai-mapper';

export class GenericXmlParser implements FeedParser {
    private parser: XMLParser;
    private mappingConfig?: FeedMappingConfig;

    constructor(mappingConfig?: FeedMappingConfig) {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
        });
        this.mappingConfig = mappingConfig;
    }

    async parse(content: string): Promise<FeedItem[]> {
        const data = this.parser.parse(content);
        const items: FeedItem[] = [];

        let rawItems: any[] = [];

        if (this.mappingConfig && this.mappingConfig.rootPath) {
            console.log(`[GenericXmlParser] Using strict root path: ${this.mappingConfig.rootPath}`);
            // 1. Use configured path
            let rootProp = this.getValueByPath(data, this.mappingConfig.rootPath);

            // Fallback: If not found, try stripping the first part of the path OR checking inside the root key
            if (!rootProp) {
                const keys = Object.keys(data).filter(k => k !== '?xml');
                if (keys.length === 1) {
                    const rootKey = keys[0];
                    console.log(`[GenericXmlParser] Path not found at root, trying inside '${rootKey}'...`);
                    rootProp = this.getValueByPath(data[rootKey], this.mappingConfig.rootPath);
                }
            }

            if (Array.isArray(rootProp)) {
                rawItems = rootProp;
            } else if (rootProp) {
                rawItems = [rootProp];
            }
            console.log(`[GenericXmlParser] Found ${rawItems.length} items using root path.`);
        } else {
            console.log(`[GenericXmlParser] Using heuristics`);
            // 2. Fallback to Heuristic
            const rootKey = Object.keys(data)[0];
            if (!rootKey) {
                console.log(`[GenericXmlParser] No root key found in XML.`);
                return [];
            }
            console.log(`[GenericXmlParser] Root Key: ${rootKey}`);

            let nodes = data[rootKey];
            const potentialLists = ['property', 'listing', 'item', 'ad'];
            let allItems: any[] = [];

            // If root node itself is an array of items (unlikely in XML but possible if parser flattens)
            // Or if root node has direct children that are the items

            // Check keys
            for (const key of Object.keys(nodes)) {
                console.log(`[GenericXmlParser] Checking key: ${key}`);
                if (potentialLists.includes(key.toLowerCase()) || key.endsWith('s')) { // "properties", "listings"
                    // ... might need recursion or smarter check
                }

                if (potentialLists.includes(key.toLowerCase())) {
                    const val = nodes[key];
                    if (Array.isArray(val)) {
                        allItems = allItems.concat(val);
                    } else {
                        allItems.push(val);
                    }
                }
            }
            rawItems = allItems;
            console.log(`[GenericXmlParser] Found ${rawItems.length} items using heuristics.`);
        }

        if (rawItems.length === 0) {
            console.log(`[GenericXmlParser] Raw Data Keys:`, Object.keys(data));
            return [];
        }

        for (const raw of rawItems) {
            items.push(this.mapItem(raw));
        }

        return items;
    }

    private mapItem(raw: any): FeedItem {
        if (this.mappingConfig) {
            return this.mapItemWithConfig(raw, this.mappingConfig);
        }

        // Basic mapping heuristics
        return {
            externalId: raw.id || raw.reference || raw['@_id'] || 'unknown',
            title: raw.title || raw.name || raw.headline || '',
            description: raw.description || raw.desc || raw.summary || '',
            price: parseFloat(raw.price || raw.amount || '0'),
            currency: raw.currency || 'EUR',
            images: this.extractImages(raw),
            attributes: raw, // Store everything else as attributes
            location: {
                city: raw.city || raw.town,
                country: raw.country,
            }
        };
    }

    private mapItemWithConfig(raw: any, config: FeedMappingConfig): FeedItem {
        const get = (path: string) => {
            if (!path) return undefined;
            let val = this.getValueByPath(raw, path);
            if (val === undefined && path.includes('.')) {
                const parts = path.split('.');
                if (parts.length > 1) {
                    const shorterPath = parts.slice(1).join('.');
                    val = this.getValueByPath(raw, shorterPath);
                }
            }
            return val;
        };

        const getString = (path: string) => {
            if (!path) return '';
            const val = get(path);
            return typeof val === 'string' || typeof val === 'number' ? String(val) : '';
        };

        // 1. Get explicitly mapped values
        let externalId = getString(config.fields.externalId) || 'unknown';
        let title = getString(config.fields.title);
        let description = getString(config.fields.description);

        // Context for heuristic extraction: Title + Description + Content
        // We often find descriptions in 'content:encoded' even if not mapped
        const rawContent = JSON.stringify(raw).toLowerCase();
        const contextText = `${title} ${description} ${raw['content:encoded'] || ''} ${rawContent}`.toLowerCase(); // simplified access

        // 2. Heuristic: Price
        let price = parseFloat(getString(config.fields['price'] || '') || '0');
        if ((!price || price === 0) && !config.fields['price']) {
            // Try to find price in text: €100,000 or 100.000 EUR
            const priceMatch = contextText.match(/(?:€|eur|£)\s?([0-9,.]+)/i); // Simple regex for now
            if (priceMatch) {
                price = parseFloat(priceMatch[1].replace(/,/g, ''));
            }
        }

        // 3. Heuristic: Bedrooms
        let bedrooms = 0;
        if (config.fields.bedrooms) {
            bedrooms = parseFloat(getString(config.fields.bedrooms));
        } else {
            const bedMatch = contextText.match(/(\d+)\s*(?:bed|bd|bedroom)/i);
            if (bedMatch) bedrooms = parseInt(bedMatch[1]);
        }

        // 4. Heuristic: Bathrooms
        let bathrooms = 0;
        if (config.fields.bathrooms) {
            bathrooms = parseFloat(getString(config.fields.bathrooms));
        } else {
            const bathMatch = contextText.match(/(\d+)\s*(?:bath|bth|bathroom)/i);
            if (bathMatch) bathrooms = parseInt(bathMatch[1]);
        }

        // 5. Heuristic: Area
        let areaSqm = 0;
        if (config.fields.areaSqm) {
            areaSqm = parseFloat(getString(config.fields.areaSqm));
        } else {
            const areaMatch = contextText.match(/(\d+(?:[.,]\d+)?)\s*(?:sqm|m2|sq\s*m|square\s*meter)/i);
            if (areaMatch) areaSqm = parseFloat(areaMatch[1]);
        }

        // Images Logic
        let images: string[] = [];
        if (config.fields.images) {
            const imgVal = get(config.fields.images);
            if (Array.isArray(imgVal)) {
                images = imgVal.map(v => typeof v === 'object' ? (v['#text'] || v.url || '') : v).filter(Boolean);
            } else if (typeof imgVal === 'string') {
                images = [imgVal];
            } else if (imgVal && typeof imgVal === 'object') {
                if (imgVal.url) images = [imgVal.url];
                else if (imgVal['#text']) images = [imgVal['#text']];
            }
        }
        // Heuristic: Extract images from HTML description if none found
        if (images.length === 0) {
            const srcMatch = Array.from(contextText.matchAll(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/gi));
            for (const m of srcMatch) {
                if (m[1] && !images.includes(m[1])) images.push(m[1]);
            }
        }

        return {
            externalId,
            title,
            description,
            price: isNaN(price) ? 0 : price,
            currency: getString(config.fields.currency) || 'EUR',
            images,
            attributes: raw,
            location: {
                city: getString(config.fields.city || ''),
                country: getString(config.fields.country || ''),
            },
            bedrooms,
            bathrooms,
            areaSqm,
        };
    }

    private extractImages(raw: any): string[] {
        const images: string[] = [];
        // Look for <images><image>url</image></images> patterns
        if (raw.images) {
            if (Array.isArray(raw.images)) {
                // sometimes like <images>url</images><images>url</images> ?? unlikely
            } else if (typeof raw.images === 'object') {
                // Common: <images><image>...</image><image>...</image></images>
                // properties.images might be the container.
                const container = raw.images;
                // Try to find array children
                for (const k in container) {
                    if (Array.isArray(container[k])) {
                        container[k].forEach((img: any) => {
                            if (typeof img === 'string') images.push(img);
                            else if (img.url) images.push(img.url);
                        });
                    } else if (k === 'image' && typeof container[k] === 'object') {
                        const img = container[k];
                        if (img.url) images.push(img.url);
                    }
                }
            }
        }
        return images;
    }

    // Helper to access deep properties safely
    // path: "prop.details.price" or "images.image"
    // Note: arrays in XML parser are sometimes tricky. "images.image" might mean 
    // root['images']['image']. If 'image' is array, it returns that array.
    private getValueByPath(obj: any, path: string): any {
        if (!path) return undefined;
        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            // Handle array access specific if needed, but fast-xml-parser usually nests objects
            // The mapping should probably not include array indices for list extraction, 
            // but for "rootPath" it might be needed? 
            // Let's assume path nodes are object keys.
            current = current[part];
        }
        return current;
    }
    // Discovery: Scan XML content and return unique paths found in items
    public discoverPaths(content: string): string[] {
        try {
            const data = this.parser.parse(content);
            const paths = new Set<string>();

            // Brute force traversal to find all available paths
            const traverse = (obj: any, currentPath: string) => {
                if (!obj || typeof obj !== 'object') {
                    if (currentPath) paths.add(currentPath);
                    return;
                }

                if (Array.isArray(obj)) {
                    // It's a list. We want to traverse children to find their properties.
                    // We also add the list path itself as it might be a "images" list field.
                    if (currentPath) paths.add(currentPath);
                    obj.forEach(item => traverse(item, currentPath));
                    return;
                }

                for (const key of Object.keys(obj)) {
                    // Build path
                    const newPath = currentPath ? `${currentPath}.${key}` : key;
                    traverse(obj[key], newPath);
                }
            };

            traverse(data, '');

            return Array.from(paths).sort();
        } catch (e) {
            console.warn("[GenericXmlParser] Discovery failed:", e);
            return [];
        }
    }
}


