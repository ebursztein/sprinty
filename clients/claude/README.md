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

## Automatic subagent identity (0.2.1)

The plugin bundles `hooks/hooks.json` and `hooks/sprinty-identity.cjs`. Its PreToolUse hook injects Claude's native session and subagent IDs into Sprinty calls; agents do not need to remember tokens. Update/reload the plugin after upgrading. MCP-only installs do not install this hook. Existing stdio connections still identify one caller automatically.
