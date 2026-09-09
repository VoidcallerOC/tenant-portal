import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { documents, properties, tenants, users } from './schema.js';

/**
 * Organization-scoped query helpers. Callers must provide the authenticated
 * organization id; no helper accepts an unscoped tenant-portal query.
 */
export function organizationAccess(db: Db, organizationId: string) {
  if (!organizationId) throw new Error('organizationId is required for organization-scoped access.');

  return {
    listProperties: () => db.select().from(properties).where(eq(properties.organizationId, organizationId)),
    listUsers: () => db.select().from(users).where(eq(users.organizationId, organizationId)),
    listTenants: () => db.select().from(tenants).where(eq(tenants.organizationId, organizationId)),
    listDocuments: () => db.select().from(documents).where(eq(documents.organizationId, organizationId)),
    getDocument: (documentId: string) => db.select().from(documents).where(and(
      eq(documents.id, documentId),
      eq(documents.organizationId, organizationId),
    )),
  };
}
