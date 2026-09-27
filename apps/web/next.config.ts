import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

// One .env at the repository root serves the web app and the command-line tools.
// Values already in the environment (for example API keys set system-wide) take precedence.
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));

const nextConfig: NextConfig = {
  transpilePackages: ["@askkendal/ai", "@askkendal/db", "@askkendal/ingest", "@askkendal/voxel"],
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Voxel grids change only when the town is rebuilt; the manifest is revalidated.
        source: "/voxel/:dir(d|f)/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        source: "/voxel/lod.bin",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;
