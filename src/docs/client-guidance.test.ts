import { lstatSync, readFileSync } from "node:fs";
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
  it("documents dashboard-at-start, compact artifacts, and canonical item tools", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("dashboard");
    }

    const gemini = readFileSync("clients/gemini/GEMINI.md", "utf8");
    expect(gemini).toContain("artifact");
    expect(gemini).toContain("item");
    expect(gemini).toContain("recent activity");

    const codex = readFileSync("clients/codex/README.md", "utf8");
    expect(codex).toContain("plugin bundle contains its own `skills/` directory");
    expect(codex).toContain("codex plugin marketplace add ebursztein/sprinty");

    const plugin = JSON.parse(readFileSync("plugins/sprinty/.codex-plugin/plugin.json", "utf8")) as {
      description?: string;
      interface?: { longDescription?: string; defaultPrompt?: string[] };
    };
    const pluginText = [
      plugin.description,
      plugin.interface?.longDescription,
      ...(plugin.interface?.defaultPrompt ?? []),
    ].join("\n");
    expect(pluginText).toContain("dashboard");
    expect(pluginText).toContain("artifact");
    expect(pluginText).toContain("item");

    for (const manifestPath of ["clients/claude/.claude-plugin/plugin.json", "clients/gemini/gemini-extension.json"]) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { description?: string };
      expect(manifest.description, manifestPath).toContain("dashboard-at-start");
      expect(manifest.description, manifestPath).toContain("artifacts");
      expect(manifest.description, manifestPath).toContain("gates");
    }
  });

  it("builds generated dist before npm packaging", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string>; files?: string[] };
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toEqual(expect.arrayContaining(["clients", "plugins", ".agents", ".claude-plugin", "docs/sprinty-dashboard.png"]));
    expect(pkg.scripts?.prepack).toBe("npm run build");
  });

  it("documents explicit git/data binding for temp-launched MCP hosts", () => {
    for (const file of ["README.md", "clients/codex/README.md", "plugins/sprinty/README.md"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("git_dir");
      expect(text, file).toContain("data_dir");
      expect(text, file).toContain("MCP");
    }
    for (const file of ["clients/codex/README.md", "plugins/sprinty/README.md"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("SPRINTY_GIT_DIR");
      expect(text, file).toContain("SPRINTY_DATA_DIR");
    }
  });

  it("describes the current workflow in npm package metadata", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { description?: string; keywords?: string[] };
    expect(pkg.description).toContain("dashboard");
    expect(pkg.description).toContain("artifacts");
    expect(pkg.description).toContain("gates");
    expect(pkg.keywords).toEqual(expect.arrayContaining([
      "mcp",
      "dashboard",
      "artifacts",
      "gates",
      "ledger",
    ]));
  });

  it("keeps client and plugin manifest versions aligned with the package", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    for (const manifestPath of [
      "plugins/sprinty/.codex-plugin/plugin.json",
      "clients/claude/.claude-plugin/plugin.json",
      "clients/gemini/gemini-extension.json",
    ]) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
      expect(manifest.version, manifestPath).toBe(pkg.version);
    }
  });

  it("ships every client bundle the canonical skill text", () => {
    // Each bundle carries its own copy so plugin installs are self-contained; nothing else
    // stops those copies from going stale against skills/, which is what agents actually read.
    for (const skill of ["how-to-run-a-sprint", "using-sprinty"]) {
      const canonical = readFileSync(`skills/${skill}/SKILL.md`, "utf8");
      for (const bundle of ["clients/claude", "clients/gemini", "plugins/sprinty"]) {
        const copy = `${bundle}/skills/${skill}/SKILL.md`;
        expect(readFileSync(copy, "utf8"), `${copy} is stale against skills/${skill}/SKILL.md. Run: npm run sync:skills`).toBe(canonical);
      }
    }
  });

  it("ships a conformant Agent Plugins package at the repo root", () => {
    // Cursor, VS Code, Kiro, Copilot and Codex load this portable format; Claude Code does not,
    // which is why clients/claude stays. skills/ is already where the standard wants it, so the
    // root package adds two manifests rather than a fourth copy of the skills.
    const plugin = JSON.parse(readFileSync("plugin.json", "utf8")) as Record<string, unknown>;
    const mcp = JSON.parse(readFileSync("mcp.json", "utf8")) as {
      $schema: string;
      mcpServers: Record<string, { type: string; command: string; args: string[] }>;
    };
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

    expect(plugin.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(plugin.name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    expect(plugin.version).toBe(pkg.version);

    expect(mcp.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    expect(Object.keys(mcp)).toEqual(["$schema", "mcpServers"]);
    const server = mcp.mcpServers.sprinty!;
    expect(server.type).toBe("stdio");
    // The spec requires one executable token here, not a shell command line.
    expect(server.command).not.toMatch(/[\s&|;]/);

    expect(lstatSync("skills").isDirectory()).toBe(true);
  });

  it("packages Claude and Codex plugin skills as real directories", () => {
    for (const path of ["clients/claude/skills", "plugins/sprinty/skills"]) {
      expect(lstatSync(path).isSymbolicLink(), path).toBe(false);
    }
    const claudeMarketplace = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8")) as {
      name: string;
      plugins: Array<{ name: string; source: string }>;
    };
    expect(claudeMarketplace.name).toBe("sprinty");
    expect(claudeMarketplace.plugins[0]).toMatchObject({ name: "sprinty", source: "./clients/claude" });

    const codexMarketplace = JSON.parse(readFileSync(".agents/plugins/marketplace.json", "utf8")) as {
      name: string;
      plugins: Array<{ name: string }>;
    };
    expect(codexMarketplace.name).toBe("sprinty");
    expect(codexMarketplace.plugins[0]?.name).toBe("sprinty");
  });
});
