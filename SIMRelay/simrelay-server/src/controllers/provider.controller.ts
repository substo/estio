import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ProviderController {
    static async sendSms(req: Request, res: Response) {
        // This endpoint is called by GoHighLevel when an SMS is sent via the custom provider
        // Payload usually contains: type, locationId, messageId, contactId, conversationId, phone, body, etc.

        // Note: The exact payload structure depends on GHL Custom Provider spec.
        // For this V1, we assume a standard structure or the one we define in the manifest.

        try {
            const {
                locationId, // or sub_account_id
                phone,      // recipient
                body,
                messageId,
                // other metadata
            } = req.body;

            if (!locationId || !phone || !body) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            // Find the device bound to this location
            const binding = await prisma.locationDeviceBinding.findFirst({
                where: { sub_account_id: locationId },
                include: { device: true },
            });

            if (!binding || !binding.device) {
                return res.status(400).json({
                    error: 'No SIMRelay device paired for this location. Please pair a device in SIMRelay settings.'
                });
            }

            if (binding.device.status === 'offline') {
                // Optionally we can still queue it, but let's warn
                console.warn(`Device ${binding.device.label} is offline. Queuing anyway.`);
            }

            // Create the Message job
            const message = await prisma.message.create({
                data: {
                    installation_id: binding.installation_id,
                    sub_account_id: locationId,
                    device_id: binding.device_id,
                    hl_message_id: messageId,
                    direction: 'outbound',
                    to_number: phone,
                    body: body,
                    status: 'queued',
                },
            });

            // TODO: Send Push Notification to the device here
            // await PushService.notifyDevice(binding.device.device_push_token, { type: 'new_job', jobId: message.id });

            // Return success to GHL
            // GHL expects a specific response format for custom providers
            res.json({
                messageId: message.id,
                status: 'queued',
            });

        } catch (error) {
            console.error('Provider Send Error:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}
