# Sprinty for Claude Code

Install the MCP server directly:

```bash
claude mcp add sprinty -- npx -y sprinty-mcp
```

Install the full plugin from the Sprinty marketplace:

```bash
claude plugin marketplace add ebursztein/sprinty
claude plugin install sprinty@sprinty
```

This plugin contains:

- `.claude-plugin/plugin.json`
- `.mcp.json`, which launches `npx -y sprinty-mcp`
- `skills/how-to-run-a-sprint`
- `skills/using-sprinty`

Validate before release:

```bash
claude plugin validate clients/claude --strict
claude plugin validate . --strict
```
