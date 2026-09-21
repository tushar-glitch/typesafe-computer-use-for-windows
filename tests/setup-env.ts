/**
 * Loads .env into the process before tests run.
 *
 * Integration tests that reach a live API need credentials, and those live in
 * .env rather than the shell so the same file serves the demo scripts. Values
 * already set in the environment win, so CI can override without editing files.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), ".env");

if (existsSync(path)) {
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const at = line.indexOf("=");
    if (at <= 0) continue;

    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}
