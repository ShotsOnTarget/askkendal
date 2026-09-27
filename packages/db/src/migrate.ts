import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadRootEnv } from "./env";
import { closeDb, getDb } from "./index";

loadRootEnv();
const here = dirname(fileURLToPath(import.meta.url));

const db = getDb();
await migrate(db, { migrationsFolder: resolve(here, "../drizzle") });
console.log("Migrations applied.");
await closeDb();
