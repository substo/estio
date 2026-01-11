const fs = require('fs');

const ACCOUNT_ID = 'a5d668404eee09103a32d81b8b7dc172';
const API_TOKEN = 'vxJZ3Ak6GzINeUpX_v845PeB84H0ThzLa-RSrD8H';
const IMAGES = [
    '/Users/martingreen/Documents/GitHub/IDX/public/images/estio logo/estio logo dark mode 1K.png',
    '/Users/martingreen/Documents/GitHub/IDX/public/images/estio logo/estio logo light mode 1K.png'
];

async function uploadImage(path) {
    console.log(`Uploading ${path}...`);

    // Create payload
    const buffer = fs.readFileSync(path);
    const blob = new Blob([buffer]);
    const formData = new FormData();
    formData.append('file', blob, path.split('/').pop());

    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_TOKEN}` // Bearer token usually
        },
        body: formData
    });

    const data = await response.json();
    console.log(`Response status: ${response.status}`);
    return data;
}

(async () => {
    for (const img of IMAGES) {
        try {
            const result = await uploadImage(img);
            console.log('Result for ' + img + ':', JSON.stringify(result, null, 2));
        } catch (e) {
            console.error('Error uploading ' + img, e);
        }
    }
})();
