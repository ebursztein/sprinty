# Sprinty for Codex

This directory is the Codex-facing Sprinty plugin bundle.

It contains:

- `.codex-plugin/plugin.json` - plugin metadata
- `.mcp.json` - MCP server definition using `npx -y sprinty-mcp`
- `AGENTS.md` - agent instructions
- `../../skills` - shared Sprinty skills used by the plugin manifest
- `marketplace.json` - local marketplace entry for this plugin directory

The simplest setup is still MCP-only:

```toml
[mcp_servers.sprinty]
command = "npx"
args = ["-y", "sprinty-mcp"]
```

Use the plugin path when you want Codex to load the bundled AGENTS instructions and skills as well
as the MCP server.

For human visibility during a sprint, ask Codex to call `dashboard()` and open the returned
`http://127.0.0.1:<port>` URL in a browser.
