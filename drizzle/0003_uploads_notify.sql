CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"kind" text NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "uploads_organization_id_idx" ON "uploads" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "uploads_tenant_id_idx" ON "uploads" USING btree ("tenant_id");
