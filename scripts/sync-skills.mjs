#!/usr/bin/env node
// Copies the canonical skills/ text into every client bundle that ships its own copy.
// Bundles are discovered from disk so a new client is picked up without editing this list.
// `--check` reports drift without writing, which is what CI and the guidance test rely on.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CANONICAL = "skills";

export function skillNames() {
  return readdirSync(join(root, CANONICAL), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Any other directory holding a skills/<name>/SKILL.md tree is a bundle that ships copies.
export function bundleDirs() {
  const candidates = ["clients/claude", "clients/gemini", "plugins/sprinty"];
  return candidates.filter((bundle) => {
    try {
      return readdirSync(join(root, bundle)).includes("skills");
    } catch {
      return false;
    }
  });
}

const check = process.argv.includes("--check");
const drifted = [];
let written = 0;

for (const skill of skillNames()) {
  const canonical = readFileSync(join(root, CANONICAL, skill, "SKILL.md"), "utf8");
  for (const bundle of bundleDirs()) {
    const target = join(bundle, "skills", skill, "SKILL.md");
    let current = null;
    try { current = readFileSync(join(root, target), "utf8"); } catch { /* missing counts as drift */ }
    if (current === canonical) continue;
    if (check) { drifted.push(target); continue; }
    writeFileSync(join(root, target), canonical, "utf8");
    written++;
    console.log(`synced ${target}`);
  }
}

if (check && drifted.length > 0) {
  console.error(`Client skill copies are stale:\n  ${drifted.join("\n  ")}\nRun: npm run sync:skills`);
  process.exit(1);
}
console.log(check ? "All client skill copies match skills/." : `Done: ${written} file(s) updated.`);
