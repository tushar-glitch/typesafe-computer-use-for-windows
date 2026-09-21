/**
 * Locating and starting the sidecar executable.
 *
 * Kept apart from `SidecarClient` so the client stays free of filesystem and
 * process concerns, and so tests can build a client over any transport.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SidecarClient, type SidecarClientOptions } from "./sidecar-client.js";
import { ChildProcessTransport } from "./transport.js";

const EXECUTABLE_NAME = "jev-sidecar.exe";
const TARGET_FRAMEWORK = "net8.0-windows";

/** Repository root, derived from this module rather than the working directory. */
function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * Where the built sidecar lives.
 *
 * `JEV_SIDECAR_PATH` wins when set, then a Release build, then Debug. Release
 * first so a published binary is preferred over a stale development build.
 */
export function resolveSidecarPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env["JEV_SIDECAR_PATH"];
  if (override !== undefined && override.length > 0) {
    return existsSync(override) ? override : null;
  }
  const root = projectRoot();
  for (const configuration of ["Release", "Debug"] as const) {
    const candidate = join(root, "sidecar", "bin", configuration, TARGET_FRAMEWORK, EXECUTABLE_NAME);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export class SidecarNotBuiltError extends Error {
  constructor() {
    super(
      `${EXECUTABLE_NAME} not found. Build it with: dotnet build sidecar/Sidecar.csproj ` +
        `(or set JEV_SIDECAR_PATH to an existing binary).`,
    );
    this.name = "SidecarNotBuiltError";
  }
}

/** Starts the sidecar and returns a client speaking to it. */
export function startSidecar(options: SidecarClientOptions = {}): SidecarClient {
  const executable = resolveSidecarPath();
  if (executable === null) throw new SidecarNotBuiltError();
  return new SidecarClient(new ChildProcessTransport(executable), options);
}
