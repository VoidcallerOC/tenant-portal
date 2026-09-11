# Tenant Portal Foundation

This repository contains a small production-oriented **TypeScript + Express 5 + Drizzle ORM + PostgreSQL** MVP for a multi-tenant property-management platform. The management console and tenant portal are static HTML/CSS/JavaScript frontends served by Express; authentication uses database-backed opaque sessions.

## Setup

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL in .env
pnpm db:generate   # regenerate SQL after schema changes
pnpm db:migrate    # apply checked-in migrations
pnpm db:seed       # insert development/demo data
pnpm typecheck
pnpm test
pnpm build
```

Never commit `.env` or credentials. The seed command is intended for a development database only.

## Architecture

The schema is in `src/db/schema.ts`. It defines organizations, users, properties, units, tenants, leases, maintenance requests, maintenance comments, and documents. PostgreSQL enums constrain roles, unit states, lease states, maintenance priorities, and maintenance states. Foreign keys use restrictive deletion for operational records and cascading or nulling behavior where the parent-child relationship is appropriate.

`src/db/access.ts` exposes organization-scoped query helpers. Every helper requires an explicit `organizationId` and adds that predicate to the query, providing a narrow data-access boundary for future authenticated procedures. Future write helpers should follow the same pattern and verify that related records belong to the same organization before inserting cross-entity records.

`src/validation.ts` contains Zod schemas for application-boundary validation. Database migrations are checked into `drizzle/` and should be generated with Drizzle Kit rather than editing production data manually.

## Assumptions and deferred decisions

The requested model says `users.email` is unique globally, so the schema implements a global unique index rather than an organization-scoped email index. Row-level security is not enabled because the application connection strategy and authenticated database role are not yet defined; the organization-aware access layer is the enforceable boundary for this MVP, and database RLS should be added once that deployment model is chosen.

Documents store a file URL and metadata only. Actual object storage, authorization checks for downloads, and document-type taxonomy are deferred. The seed includes two properties, three units, two tenants, two active leases, and two maintenance requests.

## Phase 2 authentication and authorization

Phase 2 adds a small Express server in `src/server.ts`. Authentication uses database-backed opaque session identifiers stored in an HTTP-only, SameSite cookie. Sessions expire after eight hours, can be revoked by logout, and are rejected when expired, revoked, malformed, or missing. Passwords use Node's built-in `scrypt` with a random salt and constant-time verification.

The server has explicit middleware for authenticated users, management roles (`ADMIN` and `MANAGER`), and tenants. Authorization is enforced on the server for every protected route. Management queries are scoped to `req.authUser.organizationId`. Tenant queries first resolve the tenant record from `req.authUser.id`, then constrain maintenance, lease, document, and unit operations to that tenant. Cross-tenant resource misses return the same generic 404 response as any other missing resource.

The route layer covers the static `/login` page and login API, `/logout`, all requested `/admin/*` paths, and all requested `/tenant/*` paths. The management and resident consoles are intentionally small static HTML/CSS/JavaScript interfaces.

Running `pnpm db:seed` creates or updates these development accounts:

| Role | Email | Password |
| --- | --- | --- |
| ADMIN | `admin@test.example` | `AdminDemoPassword!2026` |
| MANAGER | `manager@test.example` | `ManagerDemoPassword!2026` |
| TENANT | `jamie@example.test` | `TenantDemoPassword!2026` |
| TENANT | `riley@example.test` | `TenantTwoDemoPassword!2026` |

These credentials are for local development only and must not be used in production.

## Phase 3 management dashboard

Phase 3 adds the authenticated `/admin` management console. Because the repository did not contain a React or component layer, the UI is a small responsive server-served HTML/CSS/JavaScript shell under `client/`, while all data operations remain database-backed Express endpoints. The dashboard includes portfolio metrics, recent maintenance, recent tenants, and property overview cards. Property management includes validated property creation, property detail, unit creation, unit editing, and unit status changes. Tenant management includes an organization-scoped directory and tenant detail payloads with leases and maintenance requests.

The dashboard API endpoints are `/admin/dashboard`, `/admin/payments`, `/admin/properties`, `/admin/properties/:id`, `/admin/properties/:id/units`, `/admin/properties/:propertyId/units/:id`, `/admin/tenants`, and `/admin/tenants/:id`. Management can also create a tenant account through `POST /admin/tenants`; the server assigns the authenticated manager's organization and creates the user and tenant records in one transaction. Each endpoint uses management-role middleware and organization predicates. Empty, loading, validation, and error states are represented in the dashboard UI.

## Phase 4 tenant portal

Phase 4 adds the resident-facing `/tenant` portal with a separate visual language and navigation model from the management console. The portal provides a home dashboard, lease details, maintenance list, document list, and editable contact/emergency information. The dashboard shows the resident name, property, unit, lease status and end date, monthly rent, and open maintenance count.

Tenant APIs never accept a tenant ID from the client. They derive the tenant record from the authenticated session user ID, then constrain lease, unit, property, maintenance, document, and profile queries to that tenant. Documents must match both the tenant and one of that tenant's leases. Profile updates only accept phone and emergency-contact fields. If no documents are associated with the tenant's leases, the portal displays a safe empty state; file upload and object-storage infrastructure have not been invented.

Management can assign a tenant to an organization-owned unit and create an active or pending lease from the tenant directory. The server verifies both tenant and unit ownership, rejects conflicting active leases, and marks an actively leased unit occupied.

## Live rent payments

The tenant portal exposes `GET /tenant/payments` and `POST /tenant/payments/checkout`. Checkout creates exactly one current-calendar-month charge per active lease, keyed by `(leaseId, periodStart)`, and sends the resident to Stripe Checkout with card and US bank-account payment methods. The client never marks a charge paid. The signed `POST /stripe/webhook` endpoint is the only path that transitions a charge to `PAID`, including asynchronous ACH success; failed and expired Checkout sessions are recorded as `FAILED` and `VOID` respectively. The manager console reads organization-scoped charges through `GET /admin/payments`.

Configure `DATABASE_URL`, `PUBLIC_APP_URL`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` in the deployment environment. Optional `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` values override the default resident return URLs. Register the deployed `/stripe/webhook` URL in Stripe for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, and `payment_intent.payment_failed` events. No Stripe secrets are stored in the repository.

## Phase 1 status

**Complete:** schema, migration, seed system, authenticated management and tenant portals, role model, tenant account creation, organization-aware access controls, validation, and verification tests.
