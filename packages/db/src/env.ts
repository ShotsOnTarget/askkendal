import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Load the repo-root .env into process.env for CLI scripts.
 * Variables already set in the shell win, so keys kept in the system environment are never overridden.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      const file = resolve(dir, ".env");
      if (existsSync(file)) {
        process.loadEnvFile(file);
        return file;
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
