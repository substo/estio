import { Request, Response } from 'express';
import { GHLService } from '../services/ghl.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AuthController {
    static async authorize(req: Request, res: Response) {
        const scopes = [
            'conversations.readonly',
            'conversations.write',
            'contacts.readonly',
            'locations.readonly',
            // Add other necessary scopes
        ].join(' ');

        const redirectUri = `${process.env.SIMRELAY_APP_BASE_URL}/simrelay/oauth/callback`;
        const clientId = process.env.SIMRELAY_GHL_CLIENT_ID;

        const url = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=${redirectUri}&client_id=${clientId}&scope=${scopes}`;

        res.redirect(url);
    }

    static async callback(req: Request, res: Response) {
        const { code } = req.query;

        if (!code) {
            return res.status(400).send('No code provided');
        }

        try {
            const tokenData = await GHLService.exchangeCodeForToken(code as string);

            // tokenData contains: access_token, refresh_token, expires_in, userType, locationId (if location level)

            const locationId = tokenData.locationId;
            const installationId = locationId; // For location-level apps, usually 1-to-1

            // Upsert installation
            await prisma.installation.upsert({
                where: { ghl_installation_id: installationId },
                update: {
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000),
                    sub_account_id: locationId,
                },
                create: {
                    agency_id: 'unknown', // We might need another call to get agency ID or it comes in context
                    ghl_installation_id: installationId,
                    sub_account_id: locationId,
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000),
                },
            });

            res.send('Installation successful! You can close this window.');
        } catch (error) {
            console.error('OAuth Error:', error);
            res.status(500).send('Authentication failed');
        }
    }
}
