import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** One row per data source, with the result of its last ingestion run. */
export const sources = pgTable("sources", {
  key: text("key").primaryKey(), // council-news | town-council | moderngov | forward-plan | planning | ea-flood
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  status: text("status").notNull().default("never-run"), // ok | blocked | error | stub | never-run
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastHttpStatus: integer("last_http_status"),
  lastMessage: text("last_message"),
  documentsSeen: integer("documents_seen").notNull().default(0),
});

/**
 * Public documents about the council's work. Everything here came from a public web page.
 * Jev judgments are stored as columns so pages can filter and sort without further AI calls.
 */
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    sourceKey: text("source_key").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    docType: text("doc_type").notNull(), // news | minutes | agenda | report | forward-plan | planning-list | page
    body: text("body").notNull(),
    summary: text("summary"),
    contentHash: text("content_hash").notNull(),

    // Jev judgments (null until judged)
    theme: text("theme"),
    themeConfidence: real("theme_confidence"),
    kendalRelevance: real("kendal_relevance"), // noul: concerns Kendal
    isDecision: real("is_decision"), // noul: reports a council decision
    namesPrivate: real("names_private"), // noul: names private individuals
    urgency: real("urgency"), // score 0..3
    urgencyLabel: text("urgency_label"),
    locationName: text("location_name"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
    judgeModel: text("judge_model"),

    /** Shown on the public door. Computed from source type and the privacy judgment. */
    isPublic: boolean("is_public").notNull().default(false),

    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_source_external_idx").on(t.sourceKey, t.externalId),
    index("documents_published_idx").on(t.publishedAt),
    index("documents_search_idx").using("gin", t.search),
  ],
);

/** Cache of every Jev request, keyed by a hash of model + state + questions. Also the usage ledger. */
export const judgments = pgTable("judgments", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  purpose: text("purpose").notNull(),
  request: jsonb("request").notNull(),
  answers: jsonb("answers").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** River level snapshots from the Environment Agency, kept to build a history. */
export const riverReadings = pgTable(
  "river_readings",
  {
    id: serial("id").primaryKey(),
    station: text("station").notNull(),
    label: text("label").notNull(),
    river: text("river"),
    value: real("value").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("river_readings_station_time_idx").on(t.station, t.measuredAt)],
);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("officer"), // officer | admin
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Source = typeof sources.$inferSelect;
