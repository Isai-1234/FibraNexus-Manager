import './loadEnv.js';
import express from 'express';
import cors from 'cors';
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
import { staffRouter } from './routes/staff.js';
import { workOrdersRouter } from './routes/workOrders.js';
import { webhooksRouter } from './routes/webhooks.js';
import { alertsRouter } from './routes/alerts.js';
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
import { rateLimit } from './lib/rateLimit.js';

const app = express();
const PORT = parseInt(process.env.PORT || '10000');

console.log(
  '[boot] DATABASE_URL:',
  config.databaseUrl ? `present (len=${config.databaseUrl.length})` : 'MISSING — set it in Render → Environment',
);

// Guardrail: cola Redis no implementada
if (process.env.USE_JOB_QUEUE === 'true') {
  console.error('FATAL: USE_JOB_QUEUE=true pero la cola Redis es un stub. Desactiva la flag o implementa bullmq.');
  process.exit(1);
}

// CORS estricto: solo FRONTEND_URL (lista separada por comas) o localhost en desarrollo
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!allowedOrigins.length && process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
}
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin / curl / agent
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// Webhooks de pago (públicos, firmados) — antes de auth
app.use('/api/webhooks', webhooksRouter);

// Cabeceras de seguridad básicas
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/clients', authenticateToken, requireActiveOrg, clientsRouter);
app.use('/api/plans', authenticateToken, requireActiveOrg, plansRouter);
app.use('/api/services', authenticateToken, requireActiveOrg, servicesRouter);
app.use('/api/equipment', authenticateToken, requireActiveOrg, equipmentRouter);
app.use('/api/invoices', authenticateToken, requireActiveOrg, invoicesRouter);
app.use('/api/payments', authenticateToken, requireActiveOrg, paymentsRouter);
app.use('/api/tickets', authenticateToken, requireActiveOrg, ticketsRouter);
app.use('/api/dashboard', authenticateToken, requireActiveOrg, dashboardRouter);
app.use('/api/portal', rateLimit({ name: 'portal', windowMs: 60_000, max: 120 }), portalRouter);
app.use('/api/platform', platformRouter);
app.use('/api/ip-management', authenticateToken, requireActiveOrg, ipManagementRouter);
app.post(
  '/api/routers/agent/heartbeat',
  rateLimit({ name: 'agent_hb', windowMs: 60_000, max: 180 }),
  agentHeartbeatHandler,
);
app.post(
  '/api/routers/agent/cmd-result',
  rateLimit({ name: 'agent_cmd', windowMs: 60_000, max: 120 }),
  agentCmdResultHandler,
);
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
app.use('/api/staff', authenticateToken, requireActiveOrg, staffRouter);
app.use('/api/work-orders', authenticateToken, requireActiveOrg, workOrdersRouter);
app.use('/api/alerts', authenticateToken, requireActiveOrg, alertsRouter);
app.use('/api/network', authenticateToken, requireActiveOrg, networkRouter);
app.use('/api/devices', authenticateToken, requireActiveOrg, devicesRouter);

app.get('/api/health', async (req, res) => {
  const payload = await getHealthPayload();
  res.status(payload.status === 'ok' ? 200 : 503).json(payload);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { ensureUploadRoot } = await import('./lib/uploads.js');
const uploadRoot = ensureUploadRoot();
app.use('/uploads', express.static(uploadRoot));

const staticCandidates = [
  path.join(__dirname, '../public'),
  path.join(__dirname, '../../client/dist'),
];
const clientDist = staticCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));

if (clientDist) {
  console.log('Serving frontend from', clientDist);
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  console.warn('Frontend build not found — run: pnpm run build from repo root');
}

app.use(errorHandler);

async function start() {
  if (config.databaseUrl) {
    try {
      await runMigrations(config.databaseUrl);
    } catch (err) {
      console.error('Migration error:', err.message || err);
    }
    try {
      const { runVersionedMigrations } = await import('./db/runVersionedMigrations.js');
      await runVersionedMigrations(config.databaseUrl);
    } catch (err) {
      console.error('Versioned migration error:', err.message || err);
    }
  } else {
    console.warn('[boot] Sin DATABASE_URL — se omiten migraciones');
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