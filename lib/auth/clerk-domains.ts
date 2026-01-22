import { auth } from "@clerk/nextjs/server";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

/**
 * Adds a domain to the Clerk Instance's "Allowed Origins" (CORS) list.
 * This is required for the Clerk Client SDK to function on custom domains.
 */
export async function whitelistClerkDomain(domain: string) {
    if (!domain) return;

    // Normalize domain (ensure https://)
    const origin = domain.startsWith("http") ? domain : `https://${domain}`;

    console.log(`[Clerk Whitelist] Attempting to whitelist: ${origin}`);

    try {
        // 1. Fetch current allowed_origins
        const settingsRes = await fetch("https://api.clerk.com/v1/instance", {
            headers: {
                "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
                "Content-Type": "application/json"
            }
        });

        if (!settingsRes.ok) {
            console.error(`[Clerk Whitelist] Failed to fetch instance settings: ${settingsRes.statusText}`);
            return false;
        }

        const settings = await settingsRes.json();
        const currentOrigins: string[] = settings.allowed_origins || [];

        // 2. Check if already exists
        if (currentOrigins.includes(origin)) {
            console.log(`[Clerk Whitelist] Domain already allowed: ${origin}`);
        } else {
            // 3. Update allowance
            const newOrigins = [...currentOrigins, origin];

            const updateRes = await fetch("https://api.clerk.com/v1/instance", {
                method: "PATCH",
                headers: {
                    "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    allowed_origins: newOrigins
                })
            });

            if (!updateRes.ok) {
                const err = await updateRes.text();
                console.error(`[Clerk Whitelist] Failed to update allowed_origins: ${err}`);
                return false;
            }

            console.log(`[Clerk Whitelist] Successfully added to allowed_origins: ${origin}`);
        }

        // 4. Also add to redirect_urls (required for handshake redirect_url validation)
        await whitelistClerkRedirectUrl(origin);
        await whitelistClerkRedirectUrl(`${origin}/sign-in`);
        await whitelistClerkRedirectUrl(`${origin}/sign-up`);

        return true;

    } catch (error) {
        console.error("[Clerk Whitelist] Error:", error);
        return false;
    }
}

/**
 * Adds a URL to Clerk's redirect_urls whitelist.
 * This is required for the Clerk handshake flow to accept redirect_url parameters.
 */
export async function whitelistClerkRedirectUrl(url: string) {
    if (!url) return false;

    // Normalize URL (ensure https:// and trailing slash for root)
    let normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    // Clerk expects the exact URL format - add trailing slash if it's a root domain
    if (!normalizedUrl.endsWith("/") && !normalizedUrl.includes("?")) {
        normalizedUrl = `${normalizedUrl}/`;
    }

    console.log(`[Clerk Redirect] Attempting to whitelist redirect URL: ${normalizedUrl}`);

    try {
        // Check if already exists by listing current redirect URLs
        const listRes = await fetch("https://api.clerk.com/v1/redirect_urls", {
            headers: {
                "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
                "Content-Type": "application/json"
            }
        });

        if (!listRes.ok) {
            console.error(`[Clerk Redirect] Failed to list redirect URLs: ${listRes.statusText}`);
            return false;
        }

        const redirectUrls = await listRes.json();
        const existingUrls = redirectUrls.data?.map((r: any) => r.url) || [];

        if (existingUrls.includes(normalizedUrl)) {
            console.log(`[Clerk Redirect] Redirect URL already exists: ${normalizedUrl}`);
            return true;
        }

        // Create new redirect URL
        const createRes = await fetch("https://api.clerk.com/v1/redirect_urls", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                url: normalizedUrl
            })
        });

        if (!createRes.ok) {
            const err = await createRes.text();
            console.error(`[Clerk Redirect] Failed to create redirect URL: ${err}`);
            return false;
        }

        console.log(`[Clerk Redirect] Successfully added redirect URL: ${normalizedUrl}`);
        return true;

    } catch (error) {
        console.error("[Clerk Redirect] Error:", error);
        return false;
    }
}


/**
 * Registers a domain as a Satellite Domain in Clerk via the Backend API.
 * This is required for proper multi-tenant authentication without redirects/custom proxies.
 */
export async function registerClerkDomain(domain: string) {
    if (!domain) return false;

    // Normalize domain (ensure https://)
    const name = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    console.log(`[Clerk Registration] Attempting to register domain: ${name}`);

    try {
        // 1. List domains to check if it exists
        const listRes = await fetch("https://api.clerk.com/v1/domains", {
            headers: {
                "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
                "Content-Type": "application/json"
            }
        });

        if (!listRes.ok) {
            console.error(`[Clerk Registration] Failed to list domains: ${listRes.statusText}`);
            return false;
        }

        const domainsData = await listRes.json();
        const existingDomain = domainsData.data?.find((d: any) => d.name === name);

        if (existingDomain) {
            console.log(`[Clerk Registration] Domain already exists: ${name} (ID: ${existingDomain.id})`);

            // If it exists but isn't a satellite, we might want to update it?
            // For now, assume if it exists, it's good or managed manually.
            return true;
        }

        // 2. Create the domain
        const createRes = await fetch("https://api.clerk.com/v1/domains", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: name,
                is_satellite: true,
                // Do NOT set proxy_url for the main domain (estio.co) as it creates a loop
                proxy_url: name === 'estio.co' ? undefined : `https://${name}/api/auth-proxy`
            })
        });

        if (!createRes.ok) {
            const err = await createRes.text();
            console.error(`[Clerk Registration] Failed to create domain: ${err}`);
            return false;
        }

        const newDomain = await createRes.json();
        console.log(`[Clerk Registration] Successfully registered domain: ${name} (ID: ${newDomain.id})`);

        // IMPORTANT: We also need to add it to allowed_origins and redirect_urls just in case
        await whitelistClerkDomain(name);

        return true;

    } catch (error) {
        console.error("[Clerk Registration] Error:", error);
        return false;
    }
}
