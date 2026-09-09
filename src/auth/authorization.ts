import type { User } from '../db/schema.js';

export type AppRole = 'ADMIN' | 'MANAGER' | 'TENANT';

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403 | 404, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function requireAuthenticated(user: User | null): User {
  if (!user) throw new AuthError(401, 'Authentication required.');
  return user;
}

export function requireRole(user: User | null, ...roles: AppRole[]): User {
  const authenticated = requireAuthenticated(user);
  if (!roles.includes(authenticated.role)) throw new AuthError(403, 'You do not have permission to access this resource.');
  return authenticated;
}

export function requireSameTenantUser(user: User | null, tenantUserId: string): User {
  const authenticated = requireAuthenticated(user);
  if (authenticated.role !== 'TENANT' || authenticated.id !== tenantUserId) {
    throw new AuthError(404, 'Resource not found.');
  }
  return authenticated;
}
