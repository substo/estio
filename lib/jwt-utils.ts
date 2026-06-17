import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;
const EXPIRY_MINUTES = parseInt(process.env.SSO_TOKEN_EXPIRY_MINUTES || '5');

export interface SSOTokenPayload {
    userId: string;
    locationId: string;
    userEmail: string;
    iat: number;
    exp: number;
}

/**
 * Generates an HMAC-signed JWT token for SSO authentication
 * @param userId - The GHL user ID from {{user.id}}
 * @param locationId - The GHL location ID from {{location.id}}
 * @param userEmail - The GHL user email from {{user.email}}
 * @returns HMAC-signed JWT token string
 */
export function generateSSOToken(userId: string, locationId: string, userEmail: string): string {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    const payload: Omit<SSOTokenPayload, 'iat' | 'exp'> = {
        userId,
        locationId,
        userEmail,
    };

    return jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: `${EXPIRY_MINUTES}m`,
    });
}

/**
 * Verifies and decodes an HMAC-signed JWT token
 * @param token - The JWT token to verify
 * @returns Decoded token payload
 * @throws {jwt.JsonWebTokenError} If token is invalid
 * @throws {jwt.TokenExpiredError} If token has expired
 */
export function verifySSOToken(token: string): SSOTokenPayload {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    return jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
    }) as SSOTokenPayload;
}

export interface ClerkSignInHandoffTokenPayload {
    clerkUserId: string;
    purpose: 'clerk_sign_in_handoff';
    iat: number;
    exp: number;
}

export function generateClerkSignInHandoffToken(clerkUserId: string): string {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    return jwt.sign(
        {
            clerkUserId,
            purpose: 'clerk_sign_in_handoff',
        },
        JWT_SECRET,
        {
            algorithm: 'HS256',
            expiresIn: '2m',
        }
    );
}

export function verifyClerkSignInHandoffToken(token: string): ClerkSignInHandoffTokenPayload {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
    }) as ClerkSignInHandoffTokenPayload;

    if (payload.purpose !== 'clerk_sign_in_handoff' || !payload.clerkUserId) {
        throw new Error('Invalid Clerk sign-in handoff token');
    }

    return payload;
}

export interface OAuthStatePayload {
    locationId?: string | null;
    agencyId?: string | null;
    internalLocationId?: string | null;
    purpose: 'ghl_oauth_state';
    iat: number;
    exp: number;
}

export function generateOAuthState(input: {
    locationId?: string | null;
    agencyId?: string | null;
    internalLocationId?: string | null;
}): string {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    return jwt.sign(
        {
            locationId: input.locationId || null,
            agencyId: input.agencyId || null,
            internalLocationId: input.internalLocationId || null,
            purpose: 'ghl_oauth_state',
        },
        JWT_SECRET,
        {
            algorithm: 'HS256',
            expiresIn: '15m',
        }
    );
}

export function verifyOAuthState(token: string): OAuthStatePayload {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
    }) as OAuthStatePayload;

    if (payload.purpose !== 'ghl_oauth_state') {
        throw new Error('Invalid OAuth state token');
    }

    return payload;
}

export interface PublicSignupLocationTokenPayload {
    locationId: string;
    purpose: 'public_signup_location';
    iat: number;
    exp: number;
}

export function generatePublicSignupLocationToken(locationId: string): string {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    return jwt.sign(
        {
            locationId,
            purpose: 'public_signup_location',
        },
        JWT_SECRET,
        {
            algorithm: 'HS256',
            expiresIn: '30m',
        }
    );
}

export function verifyPublicSignupLocationToken(token: string): PublicSignupLocationTokenPayload {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
    }) as PublicSignupLocationTokenPayload;

    if (payload.purpose !== 'public_signup_location' || !payload.locationId) {
        throw new Error('Invalid public signup location token');
    }

    return payload;
}

export interface PreviewTokenPayload {
    locationId: string;
    purpose: 'property_preview';
    iat: number;
    exp: number;
}

export function generatePreviewToken(locationId: string): string {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    const payload: Omit<PreviewTokenPayload, 'iat' | 'exp'> = {
        locationId,
        purpose: 'property_preview',
    };

    return jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: `1h`,
    });
}

export function verifyPreviewToken(token: string): PreviewTokenPayload {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
    }) as PreviewTokenPayload;

    if (payload.purpose !== 'property_preview') {
        throw new Error('Invalid token purpose');
    }

    return payload;
}
