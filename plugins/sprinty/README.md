# Sprinty Codex CLI Plugin

This is the Codex CLI plugin bundle for Sprinty. `skills` is a symlink to the repository's
canonical `skills/` directory, so skill content is not duplicated while the manifest still satisfies
Codex CLI's `./skills/` path rule.

Install from a repository checkout:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty-local
```

Then start a new Codex CLI thread. The plugin provides:

- Sprinty MCP tools through `npx -y sprinty-mcp`
- `skills/how-to-run-a-sprint`
- `skills/using-sprinty`

For MCP-only setup without plugin skills:

```bash
codex mcp add sprinty -- npx -y sprinty-mcp
```
