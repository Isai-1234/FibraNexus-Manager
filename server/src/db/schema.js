import { pgTable, serial, varchar, text, timestamp, boolean, integer, decimal, pgEnum, json, jsonb, date, index } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['admin', 'technician', 'client']);
export const clientTypeEnum = pgEnum('client_type', ['individual', 'business']);
export const serviceTypeEnum = pgEnum('service_type', ['fiber', 'wisp', 'copper', 'wireless']);
export const serviceStatusEnum = pgEnum('service_status', ['active', 'suspended', 'cancelled', 'pending', 'cut']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['pending', 'paid', 'overdue', 'cancelled']);
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'transfer', 'card', 'flow', 'other']);
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'in_progress', 'waiting_client', 'resolved', 'closed']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'critical']);
export const equipmentTypeEnum = pgEnum('equipment_type', ['router', 'switch', 'olt', 'ont', 'ap', 'cpe', 'server', 'other']);
export const equipmentStatusEnum = pgEnum('equipment_status', ['online', 'offline', 'maintenance', 'error', 'installing']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
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
  status: serviceStatusEnum('status').notNull().default('active'),
  ipAddress: varchar('ip_address', { length: 45 }),
  macAddress: varchar('mac_address', { length: 17 }),
  installationDate: date('installation_date'),
  nextBillingDate: date('next_billing_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const equipment = pgTable('equipment', {
  id: serial('id').primaryKey(),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
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
  address: varchar('address', { length: 45 }).notNull().unique(),
  subnet: varchar('subnet', { length: 45 }),
  gateway: varchar('gateway', { length: 45 }),
  vlan: integer('vlan'),
  status: varchar('status', { length: 20 }).notNull().default('available'),
  assignedTo: integer('assigned_to').references(() => clients.id),
  equipmentId: integer('equipment_id').references(() => equipment.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const activityLog = pgTable('activity_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  action: varchar('action', { length: 255 }).notNull(),
  entity: varchar('entity', { length: 100 }).notNull(),
  entityId: integer('entity_id'),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
