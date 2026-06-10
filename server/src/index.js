import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { plansRouter } from './routes/plans.js';
import { servicesRouter } from './routes/services.js';
import { equipmentRouter } from './routes/equipment.js';
import { invoicesRouter } from './routes/invoices.js';
import { paymentsRouter } from './routes/payments.js';
import { ticketsRouter } from './routes/tickets.js';
import { dashboardRouter } from './routes/dashboard.js';
import { ipManagementRouter } from './routes/ipManagement.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticateToken } from './middleware/auth.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '10000');

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/clients', authenticateToken, clientsRouter);
app.use('/api/plans', authenticateToken, plansRouter);
app.use('/api/services', authenticateToken, servicesRouter);
app.use('/api/equipment', authenticateToken, equipmentRouter);
app.use('/api/invoices', authenticateToken, invoicesRouter);
app.use('/api/payments', authenticateToken, paymentsRouter);
app.use('/api/tickets', authenticateToken, ticketsRouter);
app.use('/api/dashboard', authenticateToken, dashboardRouter);
app.use('/api/ip-management', authenticateToken, ipManagementRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'FibraNexus Manager', version: '1.0.0' });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log('🚀 FibraNexus Manager running on port', PORT);
});

export default app;
