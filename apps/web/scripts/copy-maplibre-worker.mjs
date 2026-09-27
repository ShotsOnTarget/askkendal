// MapLibre 6 resolves its worker from a runtime URL that bundlers cannot follow, so the worker and
// the shared module it imports are served as static files from /maplibre/.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist");
const out = resolve(here, "../public/maplibre");
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(resolve(dist, f), resolve(out, f));
console.log("MapLibre worker copied to public/maplibre");
