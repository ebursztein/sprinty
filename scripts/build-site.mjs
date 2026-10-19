import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const source = join(root, "website");
const out = join(root, ".site-dist");
for (const file of [
  "index.html",
  "demo.html",
  "assets/sprinty-demo.mp4",
  "assets/sprinty-demo.vtt",
  "styles.css",
  "site.js",
  "llms.txt",
  "agent-start.txt",
  "install.sh",
  "assets/launch-overview.png",
  "assets/launch-plan.png",
  "assets/launch-agents.png",
  "assets/launch-history.png",
  "assets/launch-checks.png",
])
  assert(existsSync(join(source, file)), `Website asset missing: ${file}`);
for (const page of ["index.html", "demo.html"]) {
const html = readFileSync(join(source, page), "utf8");
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const value = match[1];
  if (value.startsWith("http") || value.startsWith("#") || value === "./")
    continue;
  assert(existsSync(join(source, value.split(/[?#]/)[0])), `Broken local link: ${value}`);
}
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync(source, out, { recursive: true });
console.log("Static website built and local links checked: .site-dist/");
