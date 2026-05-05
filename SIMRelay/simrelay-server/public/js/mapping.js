const API_BASE = '/simrelay/api';

// State
// In a real GHL app, we get locationId from the context or query params
const urlParams = new URLSearchParams(window.location.search);
const locationId = urlParams.get('location_id') || 'demo-location-id';
const installationId = urlParams.get('installation_id') || 'demo-installation-id';

// DOM
const deviceSelect = document.getElementById('deviceSelect');
const saveBtn = document.getElementById('saveBtn');
const messageDiv = document.getElementById('message');

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await loadDevices();
    await loadCurrentMapping();
});

async function loadDevices() {
    try {
        // Mock fetch devices
        // const response = await axios.get(`${API_BASE}/devices?installation_id=${installationId}`);
        // const devices = response.data;

        // Mock data
        const devices = [
            { id: 'dev_1', label: 'Martin\'s iPhone' },
            { id: 'dev_2', label: 'Office iPhone' }
        ];

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = device.label;
            deviceSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load devices', error);
    }
}

async function loadCurrentMapping() {
    try {
        // TODO: Implement GET /api/mappings endpoint
        // const response = await axios.get(`${API_BASE}/mappings?location_id=${locationId}`);
        // if (response.data.device_id) {
        //     deviceSelect.value = response.data.device_id;
        // }
    } catch (error) {
        console.error('Failed to load mapping', error);
    }
}

saveBtn.onclick = async () => {
    const deviceId = deviceSelect.value;
    if (!deviceId) {
        showMessage('Please select a device', 'error');
        return;
    }

    try {
        // TODO: Implement POST /api/mappings endpoint
        await axios.post(`${API_BASE}/mappings`, {
            location_id: locationId,
            device_id: deviceId,
            installation_id: installationId
        });

        showMessage('Mapping saved successfully!', 'success');
    } catch (error) {
        console.error(error);
        showMessage('Failed to save mapping', 'error');
    }
};

function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.classList.remove('hidden');
    setTimeout(() => {
        messageDiv.classList.add('hidden');
    }, 3000);
}
