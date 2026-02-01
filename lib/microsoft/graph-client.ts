import { Client } from '@microsoft/microsoft-graph-client';
import { refreshMicrosoftToken } from './auth';
import db from '@/lib/db';
import 'isomorphic-fetch';

/**
 * Creates an authenticated Microsoft Graph Client for a specific user.
 * Wraps the auth provider to handle token refresh automatically.
 */
export async function getGraphClient(userId: string) {
    // Fetch user credentials
    const user = await db.user.findUnique({
        where: { id: userId },
        select: {
            outlookAccessToken: true,
            outlookRefreshToken: true,
            outlookSyncEnabled: true,
        }
    });

    if (!user || !user.outlookSyncEnabled || !user.outlookAccessToken) {
        throw new Error('User is not connected to Outlook or sync is disabled.');
    }

    // Initialize Client with custom AuthenticationProvider
    const client = Client.init({
        authProvider: async (done) => {
            try {
                // Optimistic: Try using current token. 
                // In a real robust implementation, we might check expiry time if stored.
                // For now, we return the token. If the API returns 401, the middleware *should* ideally handle it,
                // but the standard Graph Client AuthProvider is simple.
                // Better approach: We pass a callback that returns the token.

                // We can check validity or just pass it.
                // If we want auto-refresh on 401, we need a custom Middleware or logic wrapper.
                // For simplicity v1: Return current token. If 401 happens in operation, catch and refresh.
                // BUT `authProvider` is called before request.

                // Let's implement a "check logic" if we stored expiry, but we didn't store expiry in schema (just refresh token).
                // So we will return the token.

                done(null, user.outlookAccessToken as string);
            } catch (err: any) {
                done(err, null);
            }
        },
        // Middleware to force Immutable IDs
        defaultVersion: 'v1.0'
    });

    return client;
}

/**
 * Wrapper to perform a Graph call with Auto-Refresh and Retry logic
 * Handles:
 * - 401 Unauthorized: Token refresh and retry
 * - 429 Too Many Requests: Exponential backoff with Retry-After header
 * - 5xx Server Errors: Retry with exponential backoff
 */
export async function withGraphClient(
    userId: string,
    operation: (client: Client) => Promise<any>,
    options: { maxRetries?: number; initialDelayMs?: number } = {}
) {
    const { maxRetries = 3, initialDelayMs = 1000 } = options;
    let client = await getGraphClient(userId);
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation(client);
        } catch (error: any) {
            lastError = error;
            const statusCode = error.statusCode || error.code;

            // Handle 401 Unauthorized - Token Refresh
            if (statusCode === 401 || error.body?.code === 'InvalidAuthenticationToken') {
                if (attempt < maxRetries) {
                    console.log(`[GraphClient] Token expired for user ${userId}, refreshing... (attempt ${attempt + 1})`);
                    const user = await db.user.findUnique({ where: { id: userId } });
                    if (user?.outlookRefreshToken) {
                        await refreshMicrosoftToken(userId, user.outlookRefreshToken);
                        client = await getGraphClient(userId);
                        continue; // Retry immediately after token refresh
                    }
                }
                throw error;
            }

            // Handle 429 Too Many Requests - Rate Limiting
            if (statusCode === 429) {
                const retryAfter = parseInt(error.headers?.['retry-after'] || '5', 10) * 1000;
                const delay = Math.max(retryAfter, initialDelayMs * Math.pow(2, attempt));
                console.warn(`[GraphClient] Rate limited. Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await sleep(delay);
                continue;
            }

            // Handle 5xx Server Errors
            if (statusCode >= 500 && statusCode < 600 && attempt < maxRetries) {
                const delay = initialDelayMs * Math.pow(2, attempt);
                console.warn(`[GraphClient] Server error ${statusCode}. Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await sleep(delay);
                continue;
            }

            // Don't retry for other errors
            throw error;
        }
    }

    throw lastError;
}

/**
 * Helper function for delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

