import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { saasPlans, organizations } from '../db/schema.js';

export async function getSaasPlanBySlug(slug) {
  const rows = await db.select().from(saasPlans).where(eq(saasPlans.slug, slug)).limit(1);
  return rows[0] || null;
}

export async function listActiveSaasPlans() {
  return db.select().from(saasPlans).where(eq(saasPlans.isActive, true)).orderBy(asc(saasPlans.sortOrder));
}

/** Aplica límites y plan string desde un saas_plan al org patch */
export function limitsFromSaasPlan(plan) {
  if (!plan) return {};
  return {
    plan: plan.slug,
    saasPlanId: plan.id,
    maxClients: plan.maxClients,
    maxUsers: plan.maxUsers,
    maxRouters: plan.maxRouters,
    maxEquipment: plan.maxEquipment,
    metricsRetentionDays: plan.metricsRetentionDays,
  };
}

export async function applySaasPlanToOrg(orgId, planSlug, extra = {}) {
  const plan = await getSaasPlanBySlug(planSlug);
  if (!plan) {
    const err = new Error(`Plan SaaS desconocido: ${planSlug}`);
    err.status = 400;
    throw err;
  }
  const [updated] = await db.update(organizations).set({
    ...limitsFromSaasPlan(plan),
    ...extra,
    updatedAt: new Date(),
  }).where(eq(organizations.id, orgId)).returning();
  return updated;
}

export async function touchOrgActivity(orgId) {
  if (!orgId) return;
  await db.update(organizations)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}
