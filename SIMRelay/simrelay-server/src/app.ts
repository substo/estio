import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import authRoutes from './routes/auth.routes';
import providerRoutes from './routes/provider.routes';
import deviceRoutes from './routes/device.routes';

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use('/simrelay', authRoutes);
app.use('/simrelay/provider', providerRoutes);
app.use('/simrelay', deviceRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});

export default app;
