import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "README.md",
  "clients/gemini/GEMINI.md",
  "clients/codex/README.md",
  "skills/how-to-run-a-sprint/SKILL.md",
  "skills/using-sprinty/SKILL.md",
  "plugins/sprinty/README.md",
];

describe("client guidance", () => {
  it("documents dashboard-at-start, artifacts, follow-ups, and spikes", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("dashboard()");
    }

    const gemini = readFileSync("clients/gemini/GEMINI.md", "utf8");
    expect(gemini).toContain("artifact_add/list/amend/deprecate");
    expect(gemini).toContain("follow_up");
    expect(gemini).toContain("spike_conclude");
    expect(gemini).toContain("recent activity");

    const codex = readFileSync("clients/codex/README.md", "utf8");
    expect(codex).toContain("top-level `skills/` directory");

    const plugin = JSON.parse(readFileSync("plugins/sprinty/.codex-plugin/plugin.json", "utf8")) as {
      description?: string;
      interface?: { longDescription?: string; defaultPrompt?: string[] };
    };
    const pluginText = [
      plugin.description,
      plugin.interface?.longDescription,
      ...(plugin.interface?.defaultPrompt ?? []),
    ].join("\n");
    expect(pluginText).toContain("dashboard()");
    expect(pluginText).toContain("artifact_add/list/amend/deprecate");
    expect(pluginText).toContain("follow_up");
    expect(pluginText).toContain("spike_conclude");
  });

  it("builds generated dist before npm packaging", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string>; files?: string[] };
    expect(pkg.files).toContain("dist");
    expect(pkg.scripts?.prepack).toBe("npm run build");
  });
});
