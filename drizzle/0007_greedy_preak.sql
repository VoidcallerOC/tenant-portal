CREATE TYPE "public"."usage_charge_status" AS ENUM('DUE', 'PAID', 'WAIVED');--> statement-breakpoint
CREATE TABLE "usage_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"category" text NOT NULL,
	"period_start" date NOT NULL,
	"allowance" numeric(12, 3) NOT NULL,
	"actual_usage" numeric(12, 3) NOT NULL,
	"unit_rate" numeric(12, 2) NOT NULL,
	"overage_amount" numeric(12, 2) NOT NULL,
	"status" "usage_charge_status" DEFAULT 'DUE' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_charges" ADD CONSTRAINT "usage_charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_charges" ADD CONSTRAINT "usage_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_charges" ADD CONSTRAINT "usage_charges_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_charges" ADD CONSTRAINT "usage_charges_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_charges" ADD CONSTRAINT "usage_charges_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_charges_lease_category_period_unique" ON "usage_charges" USING btree ("lease_id","category","period_start");--> statement-breakpoint
CREATE INDEX "usage_charges_organization_id_idx" ON "usage_charges" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "usage_charges_tenant_id_idx" ON "usage_charges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "usage_charges_status_idx" ON "usage_charges" USING btree ("status");