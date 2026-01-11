import { NextRequest, NextResponse } from 'next/server';
import { upsertProject } from '@/lib/projects/repository';
import { syncMessageFromWebhook } from '@/lib/ghl/sync';
import crypto from 'crypto';

// This should be stored in environment variables or fetched from GHL config
// For now, we'll assume it's available or we might need to fetch the public key dynamically
// GHL documentation says they provide a public key for verification.
// For this implementation, we will focus on the logic structure.
// TODO: Add GHL_PUBLIC_KEY to .env

const OBJECT_KEY = 'custom_objects.project';

export async function POST(req: NextRequest) {
    try {
        const bodyText = await req.text();
        const signature = req.headers.get('x-wh-signature');

        // 1. Verify Signature (Placeholder logic - requires actual Public Key)
        // const isValid = verifySignature(bodyText, signature);
        // if (!isValid) {
        //     return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        // }

        const payload = JSON.parse(bodyText);
        console.log('Received GHL Webhook:', payload.type);

        // 2. Branch Logic based on Event Type
        if (payload.type === 'InboundMessage' || payload.type === 'OutboundMessage') {
            await syncMessageFromWebhook(payload);
            return NextResponse.json({ message: 'Message synced' }, { status: 200 });
        }

        // 3. Handle Custom Object Events (Projects)
        if (payload.type !== 'CustomObjectCreated' && payload.type !== 'CustomObjectUpdated') {
            return NextResponse.json({ message: 'Ignored event type' }, { status: 200 });
        }

        // 4. Check if it's OUR Custom Object (Project)
        // Payload structure varies, need to check documentation or inspect payload
        // Assuming payload contains objectKey or similar identifier
        const record = payload.data || payload; // Adjust based on actual payload structure

        if (record.objectKey !== OBJECT_KEY) {
            return NextResponse.json({ message: 'Ignored object type' }, { status: 200 });
        }

        const locationId = record.locationId;
        if (!locationId) {
            return NextResponse.json({ error: 'Missing locationId' }, { status: 400 });
        }

        // 5. Map Payload to Project Data
        const props = record.properties || {};
        const projectData = {
            name: props[`name`] || props[`${OBJECT_KEY}.name`] || 'Untitled Project',
            description: props[`description`] || props[`${OBJECT_KEY}.description`],
            developer: props[`developer`] || props[`${OBJECT_KEY}.developer`],
            completionDate: (props[`completion_date`] || props[`${OBJECT_KEY}.completion_date`]) ? new Date(props[`completion_date`] || props[`${OBJECT_KEY}.completion_date`]) : undefined,
            totalUnits: (props[`total_units`] || props[`${OBJECT_KEY}.total_units`]) ? parseInt(props[`total_units`] || props[`${OBJECT_KEY}.total_units`]) : undefined,
            features: props[`features`] || props[`${OBJECT_KEY}.features`] || [],
            projectLocation: props[`location`] || props[`${OBJECT_KEY}.location`],
            website: props[`website`] || props[`${OBJECT_KEY}.website`],
            brochure: (props[`brochure`] || props[`${OBJECT_KEY}.brochure`]) ? (typeof (props[`brochure`] || props[`${OBJECT_KEY}.brochure`]) === 'string' ? (props[`brochure`] || props[`${OBJECT_KEY}.brochure`]) : (props[`brochure`] || props[`${OBJECT_KEY}.brochure`])[0]) : undefined,
            source: 'GHL_WEBHOOK' // Critical for Loop Prevention
        };

        // 6. Upsert to Local DB
        await upsertProject(locationId, projectData, record.id);

        return NextResponse.json({ message: 'Sync successful' }, { status: 200 });

    } catch (error: any) {
        console.error('Webhook Error:', error.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
