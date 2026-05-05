import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

const router = Router();

router.get('/authorize', AuthController.authorize);
router.get('/oauth/callback', AuthController.callback);

export default router;
