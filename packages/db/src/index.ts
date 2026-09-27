import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __askkendalSql?: postgres.Sql; __askkendalDb?: DB };

/** Shared connection. Reused across Next.js hot reloads so dev does not leak connections. */
export function getDb(): DB {
  if (globalForDb.__askkendalDb) return globalForDb.__askkendalDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
  }
  // prepare: false keeps it compatible with poolers and the embedded dev server's connection multiplexer.
  // DATABASE_POOL_MAX=1 for the embedded dev server, which cannot interleave queries from parallel connections.
  const max = Number(process.env.DATABASE_POOL_MAX ?? 5) || 5;
  const client = postgres(url, { max, idle_timeout: 20, connect_timeout: 5, prepare: false, onnotice: () => {} });
  globalForDb.__askkendalSql = client;
  globalForDb.__askkendalDb = drizzle(client, { schema });
  return globalForDb.__askkendalDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__askkendalSql?.end({ timeout: 5 });
  globalForDb.__askkendalSql = undefined;
  globalForDb.__askkendalDb = undefined;
}
