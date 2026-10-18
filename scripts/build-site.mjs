import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const source = join(root, "website");
const out = join(root, ".site-dist");
for (const file of [
  "index.html",
  "styles.css",
  "site.js",
  "llms.txt",
  "agent-start.txt",
  "install.sh",
  "assets/workspace.jpg",
  "assets/agents.jpg",
  "assets/activity.jpg",
  "assets/verification.jpg",
])
  assert(existsSync(join(source, file)), `Website asset missing: ${file}`);
const html = readFileSync(join(source, "index.html"), "utf8");
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const value = match[1];
  if (value.startsWith("http") || value.startsWith("#") || value === "./")
    continue;
  assert(existsSync(join(source, value.split(/[?#]/)[0])), `Broken local link: ${value}`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync(source, out, { recursive: true });
console.log("Static website built and local links checked: .site-dist/");
