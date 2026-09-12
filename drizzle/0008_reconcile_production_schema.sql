-- Production reconciliation for schema objects that were recorded as migrated but are
-- absent in the live database. This migration is additive and never deletes rows.

ALTER TABLE "maintenance_requests"
  ADD COLUMN IF NOT EXISTS "photo_url" text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'charge_status'
  ) THEN
    CREATE TYPE "public"."charge_status" AS ENUM ('DUE', 'OPEN', 'PAID', 'FAILED', 'VOID');
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "lease_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "status" "public"."charge_status" DEFAULT 'DUE' NOT NULL,
  "stripe_checkout_session_id" text,
  "stripe_payment_intent_id" text,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "charges"
  ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "organization_id" uuid,
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
  ADD COLUMN IF NOT EXISTS "lease_id" uuid,
  ADD COLUMN IF NOT EXISTS "period_start" date,
  ADD COLUMN IF NOT EXISTS "amount" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "status" "public"."charge_status" DEFAULT 'DUE',
  ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text,
  ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" text,
  ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charges_pkey'
      AND conrelid = 'public.charges'::regclass
  ) THEN
    ALTER TABLE "charges" ADD CONSTRAINT "charges_pkey" PRIMARY KEY ("id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charges_organization_id_organizations_id_fk'
      AND conrelid = 'public.charges'::regclass
  ) THEN
    ALTER TABLE "charges"
      ADD CONSTRAINT "charges_organization_id_organizations_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charges_tenant_id_tenants_id_fk'
      AND conrelid = 'public.charges'::regclass
  ) THEN
    ALTER TABLE "charges"
      ADD CONSTRAINT "charges_tenant_id_tenants_id_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charges_lease_id_leases_id_fk'
      AND conrelid = 'public.charges'::regclass
  ) THEN
    ALTER TABLE "charges"
      ADD CONSTRAINT "charges_lease_id_leases_id_fk"
      FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "charges_lease_period_unique"
  ON "charges" USING btree ("lease_id", "period_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charges_organization_id_idx"
  ON "charges" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charges_tenant_id_idx"
  ON "charges" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charges_lease_id_idx"
  ON "charges" USING btree ("lease_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charges_status_idx"
  ON "charges" USING btree ("status");
