import { Router } from 'express';
import { DeviceController } from '../controllers/device.controller';
import { authenticateDevice } from '../middleware/auth.middleware';

const router = Router();

// Web-side (protected by GHL session ideally, but public for now with installation_id)
router.post('/api/devices/initiate-pairing', DeviceController.initiatePairing);

// iOS-side (public for pairing)
router.post('/gateway/ios/pair', DeviceController.pairDevice);

// iOS-side (protected by Device JWT)
router.get('/gateway/ios/jobs', authenticateDevice, DeviceController.getJobs);
router.post('/gateway/ios/job-result', authenticateDevice, DeviceController.reportJobResult);

export default router;
