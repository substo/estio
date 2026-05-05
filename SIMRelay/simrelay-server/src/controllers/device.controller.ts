import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export class DeviceController {
    // Web-side: Initiate pairing
    static async initiatePairing(req: Request, res: Response) {
        const { installation_id, label } = req.body;

        if (!installation_id || !label) {
            return res.status(400).json({ error: 'Missing installation_id or label' });
        }

        // Generate a random 6-digit pair code (or alphanumeric)
        const pairCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
        const pairTokenHash = crypto.createHash('sha256').update(pairCode).digest('hex');

        try {
            await prisma.device.create({
                data: {
                    installation_id,
                    label,
                    pair_token_hash: pairTokenHash,
                    status: 'offline',
                },
            });

            const qrPayload = JSON.stringify({
                baseUrl: process.env.SIMRELAY_APP_BASE_URL,
                pairCode: pairCode,
            });

            res.json({
                pairCode,
                qrPayload,
            });
        } catch (error) {
            console.error('Initiate Pairing Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // iOS-side: Complete pairing
    static async pairDevice(req: Request, res: Response) {
        const { pair_token, device_push_token, device_label } = req.body;

        if (!pair_token) {
            return res.status(400).json({ error: 'Missing pair_token' });
        }

        const pairTokenHash = crypto.createHash('sha256').update(pair_token).digest('hex');

        try {
            const device = await prisma.device.findFirst({
                where: {
                    pair_token_hash: pairTokenHash,
                    paired: false,
                },
            });

            if (!device) {
                return res.status(401).json({ error: 'Invalid or expired pair token' });
            }

            // Update device
            await prisma.device.update({
                where: { id: device.id },
                data: {
                    paired: true,
                    pair_token_hash: null, // Clear it
                    device_push_token: device_push_token || null,
                    label: device_label || device.label,
                    status: 'online',
                    last_seen_at: new Date(),
                },
            });

            // Generate Device JWT
            const token = jwt.sign(
                { device_id: device.id, installation_id: device.installation_id },
                process.env.SIMRELAY_JWT_SECRET!,
                { expiresIn: '1y' } // Long lived for device
            );

            res.json({
                device_api_token: token,
                installation_id: device.installation_id,
            });
        } catch (error) {
            console.error('Pair Device Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // iOS-side: Fetch jobs
    static async getJobs(req: Request, res: Response) {
        // @ts-ignore - user attached by middleware
        const { device_id, installation_id } = req.user;

        try {
            // Update last seen
            await prisma.device.update({
                where: { id: device_id },
                data: { last_seen_at: new Date(), status: 'online' },
            });

            const jobs = await prisma.message.findMany({
                where: {
                    device_id,
                    status: 'queued',
                },
            });

            // Mark as pushed
            if (jobs.length > 0) {
                await prisma.message.updateMany({
                    where: {
                        id: { in: jobs.map((j) => j.id) },
                    },
                    data: { status: 'pushed_to_device' },
                });
            }

            const formattedJobs = jobs.map((job) => ({
                job_id: job.id,
                to: job.to_number,
                body: job.body,
                sub_account_id: job.sub_account_id,
                hl_message_id: job.hl_message_id,
            }));

            res.json(formattedJobs);
        } catch (error) {
            console.error('Get Jobs Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // iOS-side: Report job result
    static async reportJobResult(req: Request, res: Response) {
        // @ts-ignore
        const { device_id } = req.user;
        const { job_id, result, error_message } = req.body;

        if (!job_id || !result) {
            return res.status(400).json({ error: 'Missing job_id or result' });
        }

        try {
            await prisma.message.update({
                where: { id: job_id, device_id }, // Ensure ownership
                data: {
                    status: result,
                    error_message: error_message || null,
                },
            });

            // TODO: Callback to GHL to update status if possible

            res.json({ status: 'ok' });
        } catch (error) {
            console.error('Report Result Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}
