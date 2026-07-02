import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { plansRouter } from './routes/plans.js';
import { servicesRouter } from './routes/services.js';
import { equipmentRouter } from './routes/equipment.js';
import { invoicesRouter } from './routes/invoices.js';
import { paymentsRouter } from './routes/payments.js';
import { ticketsRouter } from './routes/tickets.js';
import { dashboardRouter } from './routes/dashboard.js';
import { portalRouter } from './routes/portal.js';
import { platformRouter } from './routes/platform.js';
import { ipManagementRouter } from './routes/ipManagement.js';
import { sitesRouter } from './routes/sites.js';
import { routersRouter, agentHeartbeatHandler, agentCmdResultHandler, buildEdgeosHeartbeatScript } from './routes/routers.js';
import { edgeosRouter } from './routes/edgeos.js';
import { devicesRouter } from './routes/devices.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticateToken } from './middleware/auth.js';
import { requireActiveOrg } from './lib/tenant.js';
import { runMigrations } from './db/migrate.js';
import { settingsRouter } from './routes/settings.js';
import { networkRouter } from './routes/network.js';
import { config, runsApi } from './lib/config.js';
import { getHealthPayload } from './lib/healthCheck.js';
import { startScheduler } from './lib/scheduler.js';
import { db } from './db/index.js';
import { equipment } from './db/schema.js';
import { eq } from 'drizzle-orm';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '10000');

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/clients', authenticateToken, requireActiveOrg, clientsRouter);
app.use('/api/plans', authenticateToken, requireActiveOrg, plansRouter);
app.use('/api/services', authenticateToken, requireActiveOrg, servicesRouter);
app.use('/api/equipment', authenticateToken, requireActiveOrg, equipmentRouter);
app.use('/api/invoices', authenticateToken, requireActiveOrg, invoicesRouter);
app.use('/api/payments', authenticateToken, requireActiveOrg, paymentsRouter);
app.use('/api/tickets', authenticateToken, requireActiveOrg, ticketsRouter);
app.use('/api/dashboard', authenticateToken, requireActiveOrg, dashboardRouter);
app.use('/api/portal', portalRouter);
app.use('/api/platform', platformRouter);
app.use('/api/ip-management', authenticateToken, requireActiveOrg, ipManagementRouter);
app.post('/api/routers/agent/heartbeat', agentHeartbeatHandler);
app.post('/api/routers/agent/cmd-result', agentCmdResultHandler);
// Ruta corta sin query params para descargar heartbeat.sh desde EdgeRouter (evita autocorrect mobile)
// Uso: curl https://app.fibranexus.cl/hs/TOKEN | sudo tee /config/scripts/fibranexus/heartbeat.sh
app.get('/hs/:token', async (req, res) => {
  try {
    const allRouters = await db.select().from(equipment).where(eq(equipment.type, 'router'));
    const router = allRouters.find(r => r.credentials?.agentToken === req.params.token);
    if (!router) return res.status(403).send('token invalido');
    const serverUrl = (process.env.PUBLIC_URL || process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || 'https://app.fibranexus.cl') + '/api/routers/agent/heartbeat';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(buildEdgeosHeartbeatScript(router.credentials.agentToken, serverUrl));
  } catch (err) {
    res.status(500).send(err.message);
  }
});
app.use('/api/routers', authenticateToken, requireActiveOrg, routersRouter);
app.use('/api/edgeos', authenticateToken, requireActiveOrg, edgeosRouter);
app.use('/api/sites', authenticateToken, requireActiveOrg, sitesRouter);
app.use('/api/settings', authenticateToken, requireActiveOrg, settingsRouter);
app.use('/api/network', authenticateToken, requireActiveOrg, networkRouter);
app.use('/api/devices', authenticateToken, requireActiveOrg, devicesRouter);

app.get('/api/health', async (req, res) => {
  const payload = await getHealthPayload();
  res.status(payload.status === 'ok' ? 200 : 503).json(payload);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticCandidates = [
  path.join(__dirname, '../public'),
  path.join(__dirname, '../../client/dist'),
];
const clientDist = staticCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));

if (clientDist) {
  console.log('Serving frontend from', clientDist);
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  console.warn('Frontend build not found — run: pnpm run build from repo root');
}

app.use(errorHandler);

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations(process.env.DATABASE_URL);
    } catch (err) {
      console.error('Migration error:', err);
    }
  }

  startScheduler();

  if (!runsApi()) {
    console.log('HTTP API disabled (PROCESS_ROLE=%s). Use pnpm run worker or set PROCESS_ROLE=all|api', config.processRole);
    return;
  }

  app.listen(PORT, () => {
    console.log('🚀 FibraNexus Manager API on port', PORT, `(role=${config.processRole})`);
  });
}

start();

export default app;