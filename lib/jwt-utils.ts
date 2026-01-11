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
