# Work with several agents

Coordinate a small team on a website launch pack: design direction, homepage copy, and a review. Sprinty records the work and its ownership; your agent client runs the subagents.

## Before starting

Use the same canonical repository and gitignored data directory for the collaborating sessions. Each agent needs a distinct identity. Ordinary separate MCP connections identify themselves automatically; shared Claude subagents need the Sprinty plugin identity hook, which the shell skills/MCP installer alone does not install. Other shared-client setups need documented caller identity support or explicit per-agent tokens. Separate worktrees retain separate sprint bindings.

## Paste into the lead agent

```text
Use Sprinty to coordinate up to three agents on a website launch pack. If this client supports delegation, you may create subagents for the roles below. Otherwise prepare the assignments so I can open separate sessions.

Project and audience: [describe them]
Shared canonical repository: [absolute path]
Shared gitignored Sprinty data directory: [absolute path]

Read the project instructions and Sprinty skills, call info, and resume or create the appropriate sprint. Share the dashboard URL. Establish that every collaborating agent has its own identity before parallel writes; do not invent native IDs or share an identity/token between agents. If the client cannot isolate callers, keep one writer until setup is corrected.

Create a common brief and focused tasks before delegating:
- Design agent: write design/direction.md and design/layouts.md.
- Content agent: write content/homepage.md against the shared brief.
- Review agent: review the design and copy together after both are ready; record findings and follow-up tasks.

Give each worker a bounded assignment, separate files, the shared sprint binding, and the task IDs minted by Sprinty. Each worker must resume the shared sprint and claim its task before editing. A suggestion from next is not ownership; respect claim rejections rather than writing anyway.

Keep decisions, meaningful progress, and artifacts on the relevant tasks. Use heartbeats during active stretches between tool calls. Release work when handing it back. If a session is interrupted, inspect the installed tool contract and record an explicit handover explanation before reassignment; do not infer that a stall warning released the claim.

Each agent should finish its deliverable with an appropriate resolving commit and check evidence. Coordinate Git operations in this shared checkout; do not stage or commit another agent's unfinished files. The review waits on both design and content, then records what was inspected and what still needs work. The lead agent integrates the results and closes the sprint only after required work and gates are resolved.

Do not deploy the site, contact anyone, or purchase services. Finish with the deliverables, review results, and outstanding decisions.
```

## What to look for

The agent roster shows distinct callers working on different tasks. Claims prevent overlapping ownership. Dependencies keep the review from starting too early. Progress and handover explanations stay visible after a session ends. Sprinty coordinates task ownership; it does not serialize Git operations or provide file isolation between agents.
