import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
// Remove obsolete framework outputs as well as stale chunks before packaging.
rmSync(resolve(root, "dist"), { recursive: true, force: true });
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build:dashboard"],
  { cwd: root, stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
  { cwd: root, stdio: "inherit" },
);
