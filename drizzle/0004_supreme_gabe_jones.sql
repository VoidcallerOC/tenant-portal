CREATE TYPE "public"."charge_status" AS ENUM('DUE', 'OPEN', 'PAID', 'FAILED', 'VOID');--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" charge_status DEFAULT 'DUE' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_lease_period_unique" ON "charges" USING btree ("lease_id","period_start");--> statement-breakpoint
CREATE INDEX "charges_organization_id_idx" ON "charges" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "charges_tenant_id_idx" ON "charges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "charges_lease_id_idx" ON "charges" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "charges_status_idx" ON "charges" USING btree ("status");--> statement-breakpoint
