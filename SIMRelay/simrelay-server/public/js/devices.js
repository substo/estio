const API_BASE = '/simrelay/api'; // Adjust if needed based on routing

// State
let installationId = 'demo-installation-id'; // In real app, get from context or query param

// DOM Elements
const deviceList = document.getElementById('deviceList');
const addDeviceBtn = document.getElementById('addDeviceBtn');
const addDeviceModal = document.getElementById('addDeviceModal');
const closeModal = document.querySelector('.close');
const generatePairCodeBtn = document.getElementById('generatePairCodeBtn');
const pairingInfo = document.getElementById('pairingInfo');
const pairCodeDisplay = document.getElementById('pairCodeDisplay');
const qrCanvas = document.getElementById('qrCanvas');
const deviceLabelInput = document.getElementById('deviceLabel');

// Init
document.addEventListener('DOMContentLoaded', () => {
    // Check for installation_id in URL params (GHL passes this usually)
    const urlParams = new URLSearchParams(window.location.search);
    // installationId = urlParams.get('installation_id') || installationId;

    fetchDevices();
});

// Functions
async function fetchDevices() {
    // Mocking the fetch for now as we don't have a public endpoint for listing devices yet
    // We need to add GET /api/devices to our backend

    // TODO: Implement GET /api/devices endpoint
    // const response = await axios.get(`${API_BASE}/devices?installation_id=${installationId}`);
    // renderDevices(response.data);

    // Mock data
    renderDevices([]);
}

function renderDevices(devices) {
    if (devices.length === 0) {
        deviceList.innerHTML = '<div class="empty-state">No devices paired yet.</div>';
        return;
    }

    deviceList.innerHTML = devices.map(device => `
        <div class="device-card">
            <div class="device-info">
                <h3>${device.label}</h3>
                <div class="device-status">
                    <span class="status-badge status-${device.status}"></span>
                    ${device.status}
                </div>
            </div>
            <div class="device-meta">
                Last seen: ${new Date(device.last_seen_at).toLocaleString()}
            </div>
        </div>
    `).join('');
}

// Event Listeners
addDeviceBtn.onclick = () => {
    addDeviceModal.classList.remove('hidden');
    pairingInfo.classList.add('hidden');
    generatePairCodeBtn.classList.remove('hidden');
    deviceLabelInput.value = '';
};

closeModal.onclick = () => {
    addDeviceModal.classList.add('hidden');
};

window.onclick = (event) => {
    if (event.target == addDeviceModal) {
        addDeviceModal.classList.add('hidden');
    }
};

generatePairCodeBtn.onclick = async () => {
    const label = deviceLabelInput.value;
    if (!label) {
        alert('Please enter a device label');
        return;
    }

    try {
        const response = await axios.post(`${API_BASE}/devices/initiate-pairing`, {
            installation_id: installationId,
            label: label
        });

        const { pairCode, qrPayload } = response.data;

        // Show pairing info
        generatePairCodeBtn.classList.add('hidden');
        pairingInfo.classList.remove('hidden');

        pairCodeDisplay.textContent = pairCode;

        // Generate QR
        QRCode.toCanvas(qrCanvas, qrPayload, function (error) {
            if (error) console.error(error);
        });

    } catch (error) {
        console.error(error);
        alert('Failed to initiate pairing');
    }
};
