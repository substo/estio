// Test script to send a WhatsApp message
// Usage: Run on server with: node scripts/test-whatsapp-send.js

const https = require('https');

// Your WhatsApp credentials (from the connected settings)
const PHONE_NUMBER_ID = '1005136779342660';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN; // Pass as env var for security

// Recipient
const TO_PHONE = '35796407286'; // Without the +

async function sendTestMessage() {
    const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: TO_PHONE,
        type: 'template',
        template: {
            name: 'hello_world',  // Default Meta test template
            language: { code: 'en_US' }
        }
    };

    console.log('Sending WhatsApp message to:', TO_PHONE);
    console.log('Using Phone ID:', PHONE_NUMBER_ID);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ Message sent successfully!');
            console.log('Response:', JSON.stringify(data, null, 2));
        } else {
            console.log('❌ Failed to send message');
            console.log('Error:', JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

if (!ACCESS_TOKEN) {
    console.log('ERROR: WHATSAPP_ACCESS_TOKEN environment variable not set');
    console.log('Get token from: https://estio.co/admin/settings/integrations/whatsapp (Advanced Options)');
    process.exit(1);
}

sendTestMessage();
