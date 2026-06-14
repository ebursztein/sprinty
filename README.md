# sprinty

A disciplined-sprint MCP server for AI coding agents — **Claude Code, Codex, and Gemini**.

Sprinty gives an agent first-class tools to run a sprint with structure that can't silently rot:
structured **sprint → subsprint → item** objects, an **immutable append-only ledger** anchored to
real git commits, **programmatic close-gates** that re-run your tests before a sprint can close, a
**regex search** over the record, and a **live follow-along dashboard**.

The point: the agent doesn't drift, and the record doesn't lie. IDs are minted server-side, items
can't exist without gates, `done` rejects a commit that doesn't exist, and `sprint_close` refuses
to close while anything is unresolved or a gate fails.

## Install

Sprinty ships as a native plugin for each agent. The MCP server itself runs via `npx -y sprinty-mcp`
(the npm package is `sprinty-mcp`; the server, tools, and plugins are all named `sprinty`).

**Claude Code** — `clients/claude/` is a plugin (`.claude-plugin/plugin.json`) bundling the MCP
server and skills. Add the MCP directly:

```bash
claude mcp add sprinty -- npx -y sprinty-mcp
```

**Codex** — `clients/codex/` is a plugin (`.codex-plugin/plugin.json` + `.mcp.json` + skills),
installed through a marketplace (`clients/codex/marketplace.json`). Or add the server to
`~/.codex/config.toml`:

```toml
[mcp_servers.sprinty]
command = "npx"
args = ["-y", "sprinty-mcp"]
```

**Gemini CLI** — `clients/gemini/` is an extension (`gemini-extension.json` + `GEMINI.md` + skills):

```bash
gemini extensions install ./clients/gemini
```

The skills are authored once in `skills/` and symlinked into each client, so all three share one
body of guidance.

## The loop

```
sprint_new(goal)
  -> subsprint_new(description, goals[], gates[])
  -> add(subsprint, description, code_locations[], gates[])
  -> done(commit_id, gate_results[]) | split(...) | deprecate(reason)
  -> sprint_close()
```

Full tool reference: [`skills/using-sprinty/SKILL.md`](skills/using-sprinty/SKILL.md).
How to run a sprint: [`skills/how-to-run-a-sprint/SKILL.md`](skills/how-to-run-a-sprint/SKILL.md).

## Storage

One append-only JSONL ledger file per sprint under `.sprinty/` in the repo you're working on, with a
`.sprinty/current` pointer naming the active sprint (this enforces one-open-sprint unicity).
`.sprinty/` is per working tree, so git worktrees run independent sprints. It is local state — keep
it gitignored.

## Develop

```bash
npm install
npm test            # builds, then runs unit + e2e tests
npm run test:coverage
npm run build
```

## License

Apache-2.0 © Elie Bursztein
