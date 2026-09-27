CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"doc_type" text NOT NULL,
	"body" text NOT NULL,
	"summary" text,
	"content_hash" text NOT NULL,
	"theme" text,
	"theme_confidence" real,
	"kendal_relevance" real,
	"is_decision" real,
	"names_private" real,
	"urgency" real,
	"urgency_label" text,
	"location_name" text,
	"lat" double precision,
	"lng" double precision,
	"judged_at" timestamp with time zone,
	"judge_model" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judgments" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"request" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judgments_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "river_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"station" text NOT NULL,
	"label" text NOT NULL,
	"river" text,
	"value" real NOT NULL,
	"measured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"status" text DEFAULT 'never-run' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_http_status" integer,
	"last_message" text,
	"documents_seen" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'officer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_source_external_idx" ON "documents" USING btree ("source_key","external_id");--> statement-breakpoint
CREATE INDEX "documents_published_idx" ON "documents" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "documents" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "river_readings_station_time_idx" ON "river_readings" USING btree ("station","measured_at");