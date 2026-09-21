CREATE TABLE "vault_entity" (
	"vault_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb,
	"revision" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_entity_vault_id_kind_entity_id_pk" PRIMARY KEY("vault_id","kind","entity_id")
);
--> statement-breakpoint
ALTER TABLE "vault_entity" ADD CONSTRAINT "vault_entity_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_entity_delta_idx" ON "vault_entity" USING btree ("vault_id","revision");