import { Router } from 'express';
import { db } from '../db/index.js';
import { clients, clientServices, invoices, tickets, users, plans, organizations, paymentIntents } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import {
  fetchClientTicketDetail,
  addTicketMessage,
  updateTicketRecord,
  getTicketForClient,
} from '../lib/ticketService.js';
import { mergeOrgSettings } from '../lib/orgSettings.js';
import { sumPaymentsForInvoice } from '../lib/paymentService.js';
import { writeAuditLog, clientIp } from '../lib/auditLog.js';
import { listClientEquipment } from '../lib/equipmentClientLink.js';
import { attachSnmpDisplay } from '../lib/equipmentStatus.js';
export const portalRouter = Router();

/** Vista segura del enlace radio para el abonado (sin secretos SNMP/credenciales). */
function publicLinkStatus(rows) {
  return (rows || []).map((raw) => {
    const g = attachSnmpDisplay(raw);
    return {
      id: g.id,
      name: g.name,
      model: [g.brand, g.model].filter(Boolean).join(' ').trim() || null,
      macAddress: g.macAddress || null,
      status: g.status,
      statusLabel: g.status === 'online' && !g.linkDown
        ? 'En línea'
        : (g.statusLabel === 'Sin monitoreo' ? 'Sin monitoreo de radio' : 'Sin señal'),
      online: g.status === 'online' && !g.linkDown,
      signalDbm: g.wirelessSignal ?? null,
      ccqPercent: g.wirelessCcq ?? null,
      snrDb: g.wirelessSnr ?? null,
      linkQuality: g.linkQuality ?? null,
      displayIp: g.displayIp || null,
      lastSeen: g.lastSeen || g.snmpPolledAt || null,
    };
  });
}

async function getClientAccount(userId) {
  return db.query.clients.findFirst({ where: eq(clients.userId, userId) });
}

portalRouter.use(authenticateToken, requireRole('client'));

portalRouter.get('/dashboard', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta de abonado no encontrada' });

    const services = await db.select({
      id: clientServices.id,
      status: clientServices.status,
      ipAddress: clientServices.ipAddress,
      macAddress: clientServices.macAddress,
      installationDate: clientServices.installationDate,
      nextBillingDate: clientServices.nextBillingDate,
      customPrice: clientServices.customPrice,
      plan: {
        name: plans.name,
        downloadSpeed: plans.downloadSpeed,
        uploadSpeed: plans.uploadSpeed,
        price: plans.price,
      },
    })
      .from(clientServices)
      .leftJoin(plans, eq(clientServices.planId, plans.id))
      .where(eq(clientServices.clientId, client.id));

    const servicesOut = services.map((s) => ({
      ...s,
      plan: s.plan ? {
        ...s.plan,
        // Precio mostrado al abonado = efectivo si existe
        price: s.customPrice != null && s.customPrice !== '' ? s.customPrice : s.plan.price,
      } : s.plan,
    }));

    const clientInvoices = await db.select()
      .from(invoices)
      .where(eq(invoices.clientId, client.id))
      .orderBy(invoices.createdAt)
      .limit(20);

    const clientTickets = await db.select()
      .from(tickets)
      .where(eq(tickets.clientId, client.id))
      .orderBy(tickets.createdAt)
      .limit(20);

    const user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });

    let pendingAmount = 0;
    const documents = [];
    for (const inv of clientInvoices) {
      const paidSum = await sumPaymentsForInvoice(inv.id);
      const balance = Math.max(0, Number(inv.total || 0) - paidSum);
      const payable = ['pending', 'overdue', 'partial'].includes(inv.status) && balance > 0;
      if (payable) pendingAmount += balance;
      documents.push({
        id: inv.id,
        type: 'invoice',
        title: inv.invoiceNumber || `Factura #${inv.id}`,
        status: inv.status,
        amount: Number(inv.total || 0),
        balance,
        dueDate: inv.dueDate,
        issuedAt: inv.createdAt,
        payable,
      });
    }

    const daysAsClient = Math.max(0, Math.floor(
      (Date.now() - new Date(client.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    ));

    const [org] = await db.select({
      name: organizations.name,
      slug: organizations.slug,
      email: organizations.email,
      settings: organizations.settings,
    }).from(organizations).where(eq(organizations.id, client.organizationId)).limit(1);
    const settings = mergeOrgSettings(org?.settings);
    const branding = {
      orgName: org?.name || 'Mi ISP',
      slug: org?.slug || null,
      supportEmail: org?.email || null,
      logoUrl: settings.brandLogoUrl || '',
      primaryColor: settings.brandPrimaryColor,
      accentColor: settings.brandAccentColor,
      portalTitle: settings.brandPortalTitle || 'Mi cuenta',
    };

    let linkStatus = [];
    try {
      const gear = await listClientEquipment(client.id, client.organizationId);
      linkStatus = publicLinkStatus(gear);
    } catch (err) {
      console.warn('Portal linkStatus:', err.message);
    }

    const servicesWithLink = servicesOut.map((s) => {
      const mac = String(s.macAddress || '').toLowerCase();
      const byMac = mac
        ? linkStatus.find((g) => String(g.macAddress || '').toLowerCase() === mac)
        : null;
      const link = byMac || linkStatus[0] || null;
      return {
        ...s,
        link: link ? {
          online: link.online,
          statusLabel: link.statusLabel,
          signalDbm: link.signalDbm,
          ccqPercent: link.ccqPercent,
          displayIp: link.displayIp || s.ipAddress || null,
          lastSeen: link.lastSeen,
        } : {
          online: null,
          statusLabel: s.ipAddress ? 'Servicio activo' : 'Sin monitoreo de radio',
          signalDbm: null,
          ccqPercent: null,
          displayIp: s.ipAddress || null,
          lastSeen: null,
        },
      };
    });

    res.json({
      client: { ...client, user: { fullName: user?.fullName, email: user?.email, phone: user?.phone } },
      daysAsClient,
      services: servicesWithLink,
      linkStatus,
      invoices: clientInvoices,
      tickets: clientTickets,
      documents,
      branding,
      pendingAmount,
      openTickets: clientTickets.filter((t) => ['open', 'in_progress', 'waiting_client'].includes(t.status)).length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

/** Checkout online del abonado (stub o pasarela) */
portalRouter.post('/checkout', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta de abonado no encontrada' });

    const invoiceId = parseInt(req.body.invoiceId, 10);
    if (!invoiceId) return res.status(400).json({ error: 'invoiceId requerido' });

    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, client.id)))
      .limit(1);
    if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
    if (inv.status === 'cancelled' || inv.status === 'paid') {
      return res.status(400).json({ error: 'La factura no admite cobro online' });
    }

    const paidSum = await sumPaymentsForInvoice(invoiceId);
    const balance = Math.max(0, Number(inv.total) - paidSum);
    if (balance <= 0) return res.status(400).json({ error: 'Saldo en cero' });

    const { createOrgPaymentGateway } = await import('../lib/orgPayment.js');
    const gateway = await createOrgPaymentGateway(client.organizationId);
    const returnUrl = req.body.returnUrl
      || process.env.FRONTEND_URL
      || '';
    const checkout = await gateway.createCheckout({
      organizationId: client.organizationId,
      invoiceId,
      amount: balance,
      currency: 'CLP',
      returnUrl,
      customerEmail: req.user.email,
    });

    const [intent] = await db.insert(paymentIntents).values({
      organizationId: client.organizationId,
      invoiceId,
      clientId: client.id,
      provider: String(checkout.provider).includes('stub') ? 'stub' : checkout.provider,
      externalId: checkout.externalId,
      amount: String(balance.toFixed(2)),
      currency: 'CLP',
      status: 'pending',
      checkoutUrl: checkout.checkoutUrl,
      metadata: { ...(checkout.metadata || {}), source: 'portal' },
      expiresAt: checkout.expiresAt,
    }).returning();

    await writeAuditLog({
      organizationId: client.organizationId,
      userId: req.user.id,
      action: 'portal.checkout_create',
      entity: 'payment_intent',
      entityId: intent.id,
      details: { invoiceId, amount: balance, provider: intent.provider },
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      intentId: intent.id,
      provider: intent.provider,
      externalId: intent.externalId,
      amount: balance,
      checkoutUrl: intent.checkoutUrl,
      expiresAt: intent.expiresAt,
      mode: intent.provider === 'stub' ? 'stub' : 'live',
    });
  } catch (error) {
    console.error('Portal checkout error:', error.message);
    res.status(500).json({ error: error.message || 'Error al crear checkout' });
  }
});

portalRouter.post('/tickets', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const { subject, description, priority, category } = req.body;
    const ticketNumber = 'TKT-' + Date.now();
    const [ticket] = await db.insert(tickets).values({
      organizationId: client.organizationId,
      ticketNumber,
      clientId: client.id,
      subject,
      description,
      priority: priority || 'medium',
      category: category || 'technical',
    }).returning();

    if (description?.trim()) {
      await addTicketMessage({
        ticketId: ticket.id,
        userId: req.user.id,
        message: description.trim(),
        isInternal: false,
      });
    }

    res.status(201).json(ticket);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear ticket: ' + error.message });
  }
});

portalRouter.get('/tickets/:id', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const ticketId = parseInt(req.params.id, 10);
    const detail = await fetchClientTicketDetail(ticketId, client.id);
    if (!detail) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener ticket' });
  }
});

portalRouter.post('/tickets/:id/messages', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const ticketId = parseInt(req.params.id, 10);
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });

    const ticket = await getTicketForClient(ticketId, client.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
    if (['closed', 'resolved'].includes(ticket.status)) {
      return res.status(400).json({ error: 'Este ticket ya está cerrado' });
    }

    await addTicketMessage({
      ticketId,
      userId: req.user.id,
      message: message.trim(),
      isInternal: false,
    });

    if (ticket.status === 'waiting_client' || ticket.status === 'resolved') {
      await updateTicketRecord(ticketId, client.organizationId, { status: 'open' });
    }

    const detail = await fetchClientTicketDetail(ticketId, client.id);
    res.status(201).json(detail);
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

portalRouter.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const client = await getClientAccount(req.user.id);
    if (!client) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const invoiceId = parseInt(req.params.id, 10);
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, client.id)))
      .limit(1);
    if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });

    const user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });
    const paidSum = await sumPaymentsForInvoice(invoiceId);
    const balance = Math.max(0, Number(inv.total) - paidSum);
    const [org] = await db.select({ name: organizations.name }).from(organizations)
      .where(eq(organizations.id, client.organizationId)).limit(1);
    const { buildInvoicePdfBuffer } = await import('../lib/invoicePdf.js');
    const buf = await buildInvoicePdfBuffer({
      invoice: inv,
      client: {
        fullName: user?.fullName,
        email: user?.email,
        rut: client.rut,
        address: client.address,
      },
      org,
      paidSum,
      balance,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber || `factura-${invoiceId}`}.pdf"`);
    res.send(buf);
  } catch (error) {
    console.error('Portal PDF error:', error.message);
    res.status(500).json({ error: error.message || 'Error al generar PDF' });
  }
});
