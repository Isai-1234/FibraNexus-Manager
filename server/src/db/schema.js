import { pgTable, serial, varchar, text, timestamp, boolean, integer, decimal, pgEnum, json, jsonb, date, index, unique } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['superadmin', 'admin', 'office', 'technician', 'client']);
export const clientTypeEnum = pgEnum('client_type', ['individual', 'business']);
export const serviceTypeEnum = pgEnum('service_type', ['fiber', 'wisp', 'copper', 'wireless']);
export const serviceStatusEnum = pgEnum('service_status', ['active', 'suspended', 'cancelled', 'pending', 'cut']);
export const clientLifecycleEnum = pgEnum('client_lifecycle', [
  'prospect', 'pending_install', 'active', 'suspended', 'cut', 'cancelled',
]);
export const workOrderStatusEnum = pgEnum('work_order_status', [
  'open', 'in_progress', 'done', 'cancelled',
]);
export const workOrderTypeEnum = pgEnum('work_order_type', [
  'install', 'visit', 'support', 'disconnect', 'other',
]);
export const paymentIntentStatusEnum = pgEnum('payment_intent_status', [
  'pending', 'completed', 'failed', 'expired', 'cancelled',
]);
export const invoiceAdjustmentTypeEnum = pgEnum('invoice_adjustment_type', [
  'credit', 'debit', 'void',
]);
export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'warning', 'critical']);
export const alertStatusEnum = pgEnum('alert_status', ['open', 'acked', 'resolved']);
export const expenseCategoryEnum = pgEnum('expense_category', [
  'equipment', 'services', 'rent', 'salary', 'taxes', 'other',
]);
export const invoiceStatusEnum = pgEnum('invoice_status', ['pending', 'partial', 'paid', 'overdue', 'cancelled']);
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'transfer', 'card', 'flow', 'other']);
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'in_progress', 'waiting_client', 'resolved', 'closed']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'critical']);
export const equipmentTypeEnum = pgEnum('equipment_type', ['router', 'switch', 'olt', 'ont', 'ap', 'cpe', 'server', 'other']);
export const equipmentStatusEnum = pgEnum('equipment_status', ['online', 'offline', 'maintenance', 'error', 'installing']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trial', 'active', 'past_due', 'suspended', 'cancelled',
]);

export const saasInvoiceStatusEnum = pgEnum('saas_invoice_status', [
  'pending', 'paid', 'overdue', 'cancelled',
]);

/** Catálogo de planes SaaS (FibraNexus → ISP) */
export const saasPlans = pgTable('saas_plans', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  priceMonthly: decimal('price_monthly', { precision: 12, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 3 }).notNull().default('CLP'),
  maxClients: integer('max_clients').notNull().default(100),
  maxUsers: integer('max_users').notNull().default(5),
  maxRouters: integer('max_routers').notNull().default(5),
  maxEquipment: integer('max_equipment').notNull().default(500),
  metricsRetentionDays: integer('metrics_retention_days').notNull().default(7),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  email: varchar('email', { length: 255 }),
  plan: varchar('plan', { length: 50 }).notNull().default('trial'),
  saasPlanId: integer('saas_plan_id').references(() => saasPlans.id),
  subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('trial'),
  subscriptionEndsAt: timestamp('subscription_ends_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  isActive: boolean('is_active').default(true).notNull(),
  suspendedAt: timestamp('suspended_at'),
  suspendedReason: text('suspended_reason'),
  lastActivityAt: timestamp('last_activity_at'),
  maxRouters: integer('max_routers').default(5),
  maxClients: integer('max_clients').default(100),
  maxUsers: integer('max_users').default(5),
  maxEquipment: integer('max_equipment').default(500),
  metricsRetentionDays: integer('metrics_retention_days').default(7),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Facturas SaaS FibraNexus → ISP (cobro manual por ahora; gateway después) */
export const saasInvoices = pgTable('saas_invoices', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id).notNull(),
  saasPlanId: integer('saas_plan_id').references(() => saasPlans.id),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull().unique(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('CLP'),
  status: saasInvoiceStatusEnum('status').notNull().default('pending'),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  dueDate: date('due_date').notNull(),
  paidAt: timestamp('paid_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull().default('client'),
  phone: varchar('phone', { length: 20 }),
  isActive: boolean('is_active').default(true).notNull(),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  clientType: clientTypeEnum('client_type').notNull().default('individual'),
  rut: varchar('rut', { length: 20 }),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  region: varchar('region', { length: 100 }),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  notes: text('notes'),
  tags: jsonb('tags'),
  /** Pilotaje DTE: habilitar SimpleFactura cliente a cliente (default off). */
  dteHabilitado: boolean('dte_habilitado').default(false).notNull(),
  /** id_servicio de WispHub — reconciliación de importaciones (unique por org). */
  wisphubId: varchar('wisphub_id', { length: 64 }),
  lifecycleStatus: clientLifecycleEnum('lifecycle_status').notNull().default('prospect'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  type: serviceTypeEnum('type').notNull(),
  downloadSpeed: integer('download_speed').notNull(),
  uploadSpeed: integer('upload_speed').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  setupPrice: decimal('setup_price', { precision: 10, scale: 2 }).default('0'),
  isActive: boolean('is_active').default(true).notNull(),
  features: jsonb('features'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const clientServices = pgTable('client_services', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  planId: integer('plan_id').references(() => plans.id).notNull(),
  routerId: integer('router_id'),
  siteId: integer('site_id'),
  status: serviceStatusEnum('status').notNull().default('active'),
  ipAddress: varchar('ip_address', { length: 45 }),
  macAddress: varchar('mac_address', { length: 17 }),
  pppoeUsername: varchar('pppoe_username', { length: 64 }),
  pppoePassword: varchar('pppoe_password', { length: 64 }),
  pppProfile: varchar('ppp_profile', { length: 64 }).default('default'),
  queueName: varchar('queue_name', { length: 64 }),
  networkMeta: jsonb('network_meta'),
  installationDate: date('installation_date'),
  nextBillingDate: date('next_billing_date'),
  billingCycleType: varchar('billing_cycle_type', { length: 32 }).default('anniversary'),
  billingDay: integer('billing_day'),
  billingDueDay: integer('billing_due_day').default(5),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sites = pgTable('sites', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id).notNull(),
  parentId: integer('parent_id'),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull().default('node'),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const equipment = pgTable('equipment', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  siteId: integer('site_id'),
  name: varchar('name', { length: 255 }).notNull(),
  type: equipmentTypeEnum('type').notNull(),
  brand: varchar('brand', { length: 100 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  serialNumber: varchar('serial_number', { length: 100 }).unique(),
  macAddress: varchar('mac_address', { length: 17 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  firmware: varchar('firmware', { length: 50 }),
  status: equipmentStatusEnum('status').notNull().default('offline'),
  location: text('location'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  clientId: integer('client_id').references(() => clients.id),
  parentId: integer('parent_id'),
  credentials: jsonb('credentials'),
  snmpCommunity: varchar('snmp_community', { length: 100 }),
  notes: text('notes'),
  lastSeen: timestamp('last_seen'),
  detectedDeviceId: integer('detected_device_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull().unique(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  clientServiceId: integer('client_service_id').references(() => clientServices.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 10, scale: 2 }).default('0'),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  status: invoiceStatusEnum('status').notNull().default('pending'),
  dueDate: date('due_date').notNull(),
  paidDate: timestamp('paid_date'),
  paymentMethod: paymentMethodEnum('payment_method'),
  billingPeriod: varchar('billing_period', { length: 50 }),
  notes: text('notes'),
  /** Quién emitió boleta/DTE: 'flow' | 'simplefactura' | null */
  dteEmitidoPor: varchar('dte_emitido_por', { length: 32 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').references(() => invoices.id).notNull(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  method: paymentMethodEnum('method').notNull(),
  reference: varchar('reference', { length: 255 }),
  paymentDate: timestamp('payment_date').defaultNow().notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tickets = pgTable('tickets', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  ticketNumber: varchar('ticket_number', { length: 50 }).notNull().unique(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  assignedTo: integer('assigned_to').references(() => users.id),
  subject: varchar('subject', { length: 255 }).notNull(),
  description: text('description'),
  status: ticketStatusEnum('status').notNull().default('open'),
  priority: ticketPriorityEnum('priority').notNull().default('medium'),
  category: varchar('category', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

export const ticketMessages = pgTable('ticket_messages', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }).notNull(),
  userId: integer('user_id').references(() => users.id).notNull(),
  message: text('message').notNull(),
  isInternal: boolean('is_internal').default(false),
  attachments: jsonb('attachments'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ipAddresses = pgTable('ip_addresses', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  address: varchar('address', { length: 45 }).notNull(),
  subnet: varchar('subnet', { length: 45 }),
  gateway: varchar('gateway', { length: 45 }),
  vlan: integer('vlan'),
  status: varchar('status', { length: 20 }).notNull().default('available'),
  assignedTo: integer('assigned_to').references(() => clients.id),
  equipmentId: integer('equipment_id').references(() => equipment.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqOrgAddress: unique('uq_ip_addresses_org_address').on(table.organizationId, table.address),
}));

export const detectedDevices = pgTable('detected_devices', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  equipmentId: integer('equipment_id').references(() => equipment.id, { onDelete: 'cascade' }).notNull(),
  macAddress: varchar('mac_address', { length: 17 }).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  hostname: varchar('hostname', { length: 255 }),
  interfaceName: varchar('interface_name', { length: 64 }),
  source: varchar('source', { length: 16 }).notNull().default('dhcp'),
  firstSeen: timestamp('first_seen').defaultNow().notNull(),
  lastSeen: timestamp('last_seen').defaultNow().notNull(),
  status: varchar('status', { length: 16 }).notNull().default('detected'),
  adoptedAsClientServiceId: integer('adopted_as_client_service_id').references(() => clientServices.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqEquipmentMac: unique('uq_detected_equipment_mac').on(table.equipmentId, table.macAddress),
}));

export const deviceMetrics = pgTable('device_metrics', {
  id: serial('id').primaryKey(),
  equipmentId: integer('equipment_id').references(() => equipment.id, { onDelete: 'cascade' }).notNull(),
  sampledAt: timestamp('sampled_at').defaultNow().notNull(),
  signal: integer('signal'),
  noise: integer('noise'),
  cinr: integer('cinr'),
  txCcq: integer('tx_ccq'),
  txRate: integer('tx_rate'),
  rxRate: integer('rx_rate'),
  source: varchar('source', { length: 20 }).notNull().default('heartbeat'),
}, (table) => ({
  idxEquipTime: index('idx_device_metrics_equip_time').on(table.equipmentId, table.sampledAt),
}));

export const activityLog = pgTable('activity_log', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  userId: integer('user_id').references(() => users.id),
  action: varchar('action', { length: 255 }).notNull(),
  entity: varchar('entity', { length: 100 }).notNull(),
  entityId: integer('entity_id'),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Órdenes de trabajo (instalación, visita, soporte) — historial inmutable vía baja lógica */
export const workOrders = pgTable('work_orders', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id).notNull(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  serviceId: integer('service_id').references(() => clientServices.id),
  assignedTo: integer('assigned_to').references(() => users.id),
  createdBy: integer('created_by').references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  type: workOrderTypeEnum('type').notNull().default('visit'),
  status: workOrderStatusEnum('status').notNull().default('open'),
  checklist: jsonb('checklist').default([]),
  attachments: jsonb('attachments').default([]),
  notes: text('notes'),
  completionNotes: text('completion_notes'),
  scheduledAt: timestamp('scheduled_at'),
  completedAt: timestamp('completed_at'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  idxWoOrg: index('idx_work_orders_org').on(table.organizationId),
  idxWoClient: index('idx_work_orders_client').on(table.clientId),
  idxWoStatus: index('idx_work_orders_status').on(table.status),
}));

/** Checkout / cobro online (stub o pasarela real con credenciales) */
export const paymentIntents = pgTable('payment_intents', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id).notNull(),
  invoiceId: integer('invoice_id').references(() => invoices.id).notNull(),
  clientId: integer('client_id').references(() => clients.id).notNull(),
  provider: varchar('provider', { length: 40 }).notNull().default('stub'),
  externalId: varchar('external_id', { length: 120 }).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('CLP'),
  status: paymentIntentStatusEnum('status').notNull().default('pending'),
  checkoutUrl: text('checkout_url'),
  metadata: jsonb('metadata').default({}),
  expiresAt: timestamp('expires_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqProviderExternal: unique('payment_intents_provider_external_uidx').on(table.provider, table.externalId),
  idxPiOrg: index('idx_payment_intents_org').on(table.organizationId),
  idxPiInvoice: index('idx_payment_intents_invoice').on(table.invoiceId),
}));

/** Eventos de webhook procesados (idempotencia) */
export const paymentWebhookEvents = pgTable('payment_webhook_events', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id),
  provider: varchar('provider', { length: 40 }).notNull(),
  eventId: varchar('event_id', { length: 160 }).notNull(),
  invoiceId: integer('invoice_id').references(() => invoices.id),
  paymentIntentId: integer('payment_intent_id').references(() => paymentIntents.id),
  payload: jsonb('payload').notNull().default({}),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
}, (table) => ({
  uniqProviderEvent: unique('payment_webhook_events_provider_event_uidx').on(table.provider, table.eventId),
  idxPweOrg: index('idx_payment_webhook_events_org').on(table.organizationId),
}));

/** Ajustes / anulación de facturas internas (no DTE) */
export const invoiceAdjustments = pgTable('invoice_adjustments', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id).notNull(),
  invoiceId: integer('invoice_id').references(() => invoices.id).notNull(),
  type: invoiceAdjustmentTypeEnum('type').notNull(),
  amountDelta: decimal('amount_delta', { precision: 10, scale: 2 }).notNull().default('0'),
  reason: text('reason').notNull(),
  createdBy: integer('created_by').references(() => users.id),
  previousTotal: decimal('previous_total', { precision: 10, scale: 2 }),
  newTotal: decimal('new_total', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  idxAdjInvoice: index('idx_invoice_adjustments_invoice').on(table.invoiceId),
}));

/** Egresos del ISP (módulo Finanzas) */
export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  date: date('date').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  category: expenseCategoryEnum('category').notNull().default('other'),
  description: text('description'),
  provider: varchar('provider', { length: 255 }),
  invoiceNumber: varchar('invoice_number', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  idxExpensesOrgDate: index('idx_expenses_org_date').on(table.organizationId, table.date),
  idxExpensesOrgCategory: index('idx_expenses_org_category').on(table.organizationId, table.category),
}));

/** Alertas operativas ISP (Fase 4) — sin canal push externo */
export const orgAlerts = pgTable('org_alerts', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  severity: alertSeverityEnum('severity').notNull().default('warning'),
  status: alertStatusEnum('status').notNull().default('open'),
  kind: varchar('kind', { length: 64 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message'),
  entityType: varchar('entity_type', { length: 40 }),
  entityId: integer('entity_id'),
  dedupeKey: varchar('dedupe_key', { length: 160 }).notNull(),
  metadata: jsonb('metadata').default({}),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  ackedAt: timestamp('acked_at'),
  ackedBy: integer('acked_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqOrgDedupe: unique('org_alerts_org_dedupe_uidx').on(table.organizationId, table.dedupeKey),
  idxAlertsOrgStatus: index('idx_org_alerts_org_status').on(table.organizationId, table.status),
  idxAlertsLastSeen: index('idx_org_alerts_last_seen').on(table.lastSeenAt),
}));
