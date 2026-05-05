import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GHL_API_DOMAIN = process.env.SIMRELAY_GHL_API_DOMAIN || 'https://services.leadconnectorhq.com';

export class GHLService {
    static async exchangeCodeForToken(code: string) {
        const data = new URLSearchParams({
            client_id: process.env.SIMRELAY_GHL_CLIENT_ID!,
            client_secret: process.env.SIMRELAY_GHL_CLIENT_SECRET!,
            grant_type: 'authorization_code',
            code: code,
            user_type: 'Location', // or 'Agency' depending on app type, usually Location for marketplace apps
            redirect_uri: `${process.env.SIMRELAY_APP_BASE_URL}/simrelay/oauth/callback`,
        });

        const response = await axios.post(`${GHL_API_DOMAIN}/oauth/token`, data.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        return response.data;
    }

    static async refreshAccessToken(refreshToken: string) {
        const data = new URLSearchParams({
            client_id: process.env.SIMRELAY_GHL_CLIENT_ID!,
            client_secret: process.env.SIMRELAY_GHL_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            user_type: 'Location',
        });

        const response = await axios.post(`${GHL_API_DOMAIN}/oauth/token`, data.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        return response.data;
    }

    static async getLocation(accessToken: string, locationId: string) {
        const response = await axios.get(`${GHL_API_DOMAIN}/locations/${locationId}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Version: '2021-07-28',
            },
        });
        return response.data;
    }
}
