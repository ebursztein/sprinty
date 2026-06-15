# Sprinty for Codex CLI

The supported command-line Codex plugin lives at `plugins/sprinty/`, with the repository-local
marketplace at `.agents/plugins/marketplace.json`. This directory is documentation only.

Install from a repository checkout:

```bash
codex plugin marketplace add .
codex plugin add sprinty@sprinty-local
```

Then start a new Codex CLI thread so the plugin skills and MCP server are loaded.

This marketplace layout is for Git/repo installs, not the npm tarball. The npm package provides the
MCP server used by the plugin (`npx -y sprinty-mcp`).

The installed plugin provides:

- Sprinty MCP tools through `npx -y sprinty-mcp`
- shared Sprinty skills from the canonical repository `skills/` directory

The npm package includes the top-level `skills/` directory for MCP resource serving. Client
directories may contain symlinks to that canonical directory in a Git checkout; npm tarballs do not
need per-client skill copies.

MCP-only setup without plugin skills:

```bash
codex mcp add sprinty -- npx -y sprinty-mcp
```

Sprinty chooses its repository from explicit config first (`--repo-dir`, `SPRINTY_REPO_DIR`, or
`SPRINTY_WORKTREE`), then MCP workspace roots when Codex exposes them, then the MCP process cwd when
it is already a git worktree. If Codex launches the MCP process from a temp directory and roots are
unavailable, configure the server with `SPRINTY_REPO_DIR=/absolute/path/to/your/repo` or pass
`--repo-dir /absolute/path/to/your/repo` so Sprinty writes `.sprinty/` and validates commits against
the intended repository. Sprinty refuses to start against a non-git launch directory, which keeps
accidental `/private/tmp` bindings from becoming real sprint ledgers.

Do not copy skill files into client directories; keep them in the top-level `skills/` directory.

For human visibility during a sprint, ask Codex to call `dashboard()` and open the returned
`http://127.0.0.1:<port>` URL in a browser.
