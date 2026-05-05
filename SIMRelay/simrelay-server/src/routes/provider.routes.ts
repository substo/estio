import { Router } from 'express';
import { ProviderController } from '../controllers/provider.controller';

const router = Router();

// Middleware to verify GHL signature could be added here
router.post('/sms/send', ProviderController.sendSms);

export default router;
