import { Router } from 'express';
import { db } from '../db/index.js';
import { organizations, users, clients, equipment } from '../db/schema.js';
import { eq, sql, and } from 'drizzle-orm';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { trialDaysLeft } from '../lib/tenant.js';

export const platformRouter = Router();

platformRouter.use(authenticateToken, requireRole('superadmin'));

platformRouter.get('/dashboard', async (req, res) => {
  try {
    const orgs = await db.select().from(organizations).orderBy(organizations.createdAt);

    const enriched = await Promise.all(orgs.map(async (org) => {
      const [{ count: clientCount }] = await db.select({ count: sql`count(*)` })
        .from(clients).where(eq(clients.organizationId, org.id));
      const [{ count: staffCount }] = await db.select({ count: sql`count(*)` })
        .from(users).where(and(eq(users.organizationId, org.id), sql`role IN ('admin', 'technician')`));
      const [{ count: routerCount }] = await db.select({ count: sql`count(*)` })
        .from(equipment).where(and(eq(equipment.organizationId, org.id), eq(equipment.type, 'router')));

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        email: org.email,
        plan: org.plan,
        isActive: org.isActive,
        trialDaysLeft: trialDaysLeft(org),
        trialEndsAt: org.trialEndsAt,
        clientCount: Number(clientCount),
        staffCount: Number(staffCount),
        routerCount: Number(routerCount),
        createdAt: org.createdAt,
      };
    }));

    res.json({
      stats: {
        totalOrganizations: enriched.length,
        activeTrials: enriched.filter((o) => o.plan === 'trial' && o.isActive).length,
        totalClients: enriched.reduce((s, o) => s + o.clientCount, 0),
        totalRouters: enriched.reduce((s, o) => s + o.routerCount, 0),
      },
      organizations: enriched,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});
