import {
  customType,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const userRole = pgEnum('user_role', ['ADMIN', 'MANAGER', 'TENANT']);
export const unitStatus = pgEnum('unit_status', ['VACANT', 'OCCUPIED', 'MAINTENANCE']);
export const leaseStatus = pgEnum('lease_status', ['ACTIVE', 'EXPIRED', 'PENDING', 'TERMINATED']);
export const maintenancePriority = pgEnum('maintenance_priority', ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']);
export const maintenanceStatus = pgEnum('maintenance_status', ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
export const chargeStatus = pgEnum('charge_status', ['DUE', 'OPEN', 'PAID', 'FAILED', 'VOID']);

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  email: text('email'),
  phone: text('phone'),
  stripeAccountId: text('stripe_account_id'),
  ...timestamps,
}, (table) => [uniqueIndex('organizations_slug_unique').on(table.slug)]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  role: userRole('role').notNull().default('TENANT'),
  ...timestamps,
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
  index('users_organization_id_idx').on(table.organizationId),
]);

export const properties = pgTable('properties', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  addressLine1: text('address_line1').notNull(),
  addressLine2: text('address_line2'),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zip: text('zip').notNull(),
  ...timestamps,
}, (table) => [index('properties_organization_id_idx').on(table.organizationId)]);

export const units = pgTable('units', {
  id: uuid('id').defaultRandom().primaryKey(),
  propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  unitNumber: text('unit_number').notNull(),
  bedrooms: integer('bedrooms'),
  bathrooms: numeric('bathrooms', { precision: 4, scale: 2 }),
  status: unitStatus('status').notNull().default('VACANT'),
  ...timestamps,
}, (table) => [
  uniqueIndex('units_property_unit_number_unique').on(table.propertyId, table.unitNumber),
  index('units_property_id_idx').on(table.propertyId),
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  phone: text('phone'),
  emergencyName: text('emergency_name'),
  emergencyPhone: text('emergency_phone'),
  ...timestamps,
}, (table) => [
  uniqueIndex('tenants_user_unique').on(table.userId),
  index('tenants_organization_id_idx').on(table.organizationId),
]);

export const leases = pgTable('leases', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'restrict' }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  monthlyRent: numeric('monthly_rent', { precision: 12, scale: 2 }).notNull(),
  securityDeposit: numeric('security_deposit', { precision: 12, scale: 2 }),
  status: leaseStatus('status').notNull().default('PENDING'),
  ...timestamps,
}, (table) => [
  index('leases_tenant_id_idx').on(table.tenantId),
  index('leases_unit_id_idx').on(table.unitId),
  index('leases_status_idx').on(table.status),
]);

export const charges = pgTable('charges', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  leaseId: uuid('lease_id').notNull().references(() => leases.id, { onDelete: 'restrict' }),
  periodStart: date('period_start').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  status: chargeStatus('status').notNull().default('DUE'),
  stripeCheckoutSessionId: text('stripe_checkout_session_id'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex('charges_lease_period_unique').on(table.leaseId, table.periodStart),
  index('charges_organization_id_idx').on(table.organizationId),
  index('charges_tenant_id_idx').on(table.tenantId),
  index('charges_lease_id_idx').on(table.leaseId),
  index('charges_status_idx').on(table.status),
]);

export const maintenanceRequests = pgTable('maintenance_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  photoUrl: text('photo_url'),
  priority: maintenancePriority('priority').notNull().default('MEDIUM'),
  status: maintenanceStatus('status').notNull().default('OPEN'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index('maintenance_requests_tenant_id_idx').on(table.tenantId),
  index('maintenance_requests_unit_id_idx').on(table.unitId),
  index('maintenance_requests_status_idx').on(table.status),
]);

export const maintenanceComments = pgTable('maintenance_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  maintenanceRequestId: uuid('maintenance_request_id').notNull().references(() => maintenanceRequests.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('maintenance_comments_request_id_idx').on(table.maintenanceRequestId),
  index('maintenance_comments_user_id_idx').on(table.userId),
]);

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  leaseId: uuid('lease_id').references(() => leases.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  fileUrl: text('file_url').notNull(),
  documentType: text('document_type').notNull(),
  ...timestamps,
}, (table) => [
  index('documents_organization_id_idx').on(table.organizationId),
  index('documents_tenant_id_idx').on(table.tenantId),
  index('documents_lease_id_idx').on(table.leaseId),
]);

export const uploads = pgTable('uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  kind: text('kind').notNull(),
  bytes: bytea('bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('uploads_organization_id_idx').on(table.organizationId),
  index('uploads_tenant_id_idx').on(table.tenantId),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
  index('sessions_expires_at_idx').on(table.expiresAt),
]);

export const schema = {
  organizations,
  users,
  properties,
  units,
  tenants,
  leases,
  charges,
  maintenanceRequests,
  maintenanceComments,
  documents,
  uploads,
  sessions,
};

export type Upload = typeof uploads.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type Lease = typeof leases.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type MaintenanceRequest = typeof maintenanceRequests.$inferSelect;
export type MaintenanceComment = typeof maintenanceComments.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Session = typeof sessions.$inferSelect;
