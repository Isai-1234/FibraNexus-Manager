import { db } from '../db/index.js';
import { equipment } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/** Encola un script Vyatta para el agente heartbeat del EdgeRouter */
export async function appendPendingCmd(routerId, cmd, extraCredFields = {}, audit = null) {
  const [current] = await db.select().from(equipment).where(eq(equipment.id, routerId)).limit(1);
  if (!current) throw new Error('Router no encontrado');
  const creds = current.credentials || {};
  const pending = [...(creds.pendingCmds || []), cmd];
  console.log(`[EdgeOS] CMD ENCOLADO router=${routerId} id=${cmd.id} type=${cmd.type} total_cola=${pending.length}`);
  await db.update(equipment).set({
    credentials: { ...creds, pendingCmds: pending, ...extraCredFields },
    updatedAt: new Date(),
  }).where(eq(equipment.id, routerId));

  if (audit?.organizationId && audit?.userId) {
    try {
      const { writeAuditLog } = await import('./auditLog.js');
      await writeAuditLog({
        organizationId: audit.organizationId,
        userId: audit.userId,
        action: 'edgeos.cmd_enqueue',
        entity: 'equipment',
        entityId: routerId,
        details: { cmdId: cmd.id, type: cmd.type, confirmed: Boolean(audit.confirmed) },
        ipAddress: audit.ipAddress || null,
      });
    } catch { /* non-fatal */ }
  }
  return cmd;
}
