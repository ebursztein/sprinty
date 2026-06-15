# Sprinty Dashboard UI Design

## Goal

Upgrade the Sprinty dashboard from a single inline status page into a focused local tool UI for reading and steering an active sprint. The dashboard should keep Sprinty's launch simplicity: the MCP server starts a local dashboard, serves the current sprint state from `/state`, and serves a compiled static UI bundle.

## Stack

- Use Svelte for dashboard components.
- Use Vite for the frontend build and static asset output.
- Use Tailwind CSS for styling.
- Use a lightweight Svelte-friendly charting layer for progress visualizations.
- Use `marked` for Markdown parsing and `dompurify` for sanitizing rendered item content before insertion into the DOM.
- Do not use SvelteKit. Sprinty does not need a routed application framework or a second runtime server.

## Information Architecture

The dashboard has one main content flow and one details surface.

The top summary band shows:

- Sprint name or goal.
- Sprint status.
- Branch and worktree metadata.
- Overall item completion.
- Subsprint progress.
- Gate result distribution.
- Coverage when available.

The main view shows:

- The sprint tree.
- A timeline below the tree.
- The ledger below the timeline.

The right side is a sliding detail panel. It is closed by default and opens when the user selects a subsprint, item, timeline event, or ledger event.

## Sprint Tree

The tree is the primary working view.

- Subsprints are folded by default.
- The active subsprint opens automatically.
- Completed subsprints are muted gray.
- The current item is highlighted blue.
- The next item is rendered in bright white.
- Completed, split, and deprecated items are muted and keep compact status chips.
- Each subsprint row includes a mini progress bar.
- Goals are folded under each subsprint and can be expanded inline.
- Items show concise metadata in the tree: id, status, gate summary, and dependency markers when present.

The tree should not require editing state. It derives display state from the current `SprintView` plus local UI selection and disclosure state.

## Detail Panel

The sliding detail panel shows formatted content for the selected entity.

For items, it shows:

- Markdown-rendered description.
- Code locations.
- Gates and gate results.
- Notes.
- Updates.
- Dependencies.
- Changelog line.
- Commit id.
- Change-map summary when available.

For subsprints, it shows:

- Description.
- Folded goals.
- Gates.
- Notes.
- Item progress.
- Changelog summary.
- Change-map summary.

For timeline and ledger events, it shows:

- Event type.
- Target id.
- Timestamp.
- Rendered event text.
- Raw event data when useful for debugging.

Markdown rendering is sanitized before display. Raw HTML from Markdown is not trusted.

## Timeline And Ledger

The timeline sits below the tree and presents recent sprint activity in reverse chronological order. It should be readable as a narrative: created, added, updated, resolved, dependencies added, notes added, and sprint closed.

The ledger sits below the timeline and exposes the underlying event stream for debugging and audit. It can be denser than the timeline. Each ledger row opens the detail panel.

## State Model

The server continues to expose the raw `SprintView` at `/state`.

The frontend adds a dashboard view-model layer:

```text
SprintView -> DashboardModel -> Svelte components
```

The view-model computes:

- Active subsprint.
- Current item.
- Next item.
- Per-subsprint item totals.
- Per-subsprint gate totals.
- Overall completion metrics.
- Coverage metric.
- Tree node display state.
- Timeline rows.
- Ledger rows.
- Chart datasets.

Components should consume the dashboard model, not recompute sprint semantics independently.

## Component Map

- `App.svelte`: owns polling, loading/error states, selected entity, and top-level layout.
- `SummaryBand.svelte`: renders sprint metadata and charts.
- `ProgressChart.svelte`: renders compact completion visuals.
- `SprintTree.svelte`: renders subsprints, items, folded goals, and selection.
- `Timeline.svelte`: renders human-readable activity.
- `Ledger.svelte`: renders audit/debug rows.
- `DetailPanel.svelte`: renders selected entity details.
- `Markdown.svelte`: renders sanitized Markdown.
- `model.ts`: derives `DashboardModel` from `SprintView`.
- `types.ts`: defines dashboard-specific view types.

## Server And Build

Keep `src/dashboard/server.ts` as the launch path.

The dashboard server should:

- Serve `/state` as JSON.
- Serve the dashboard HTML.
- Serve compiled static assets under a stable path such as `/assets/...`.
- Fall back to an embedded minimal page or a clear build error only if assets are missing in development.

The package build should compile TypeScript and build the dashboard assets. The published package should include the compiled dashboard assets.

## Error And Loading States

The app shows a focused loading state until the first `/state` response arrives.

If polling fails after a prior successful state, keep showing the last known dashboard and mark the connection as stale.

If the first load fails, show a disconnected state with the fetch error.

If no sprint exists, show an empty dashboard with a clear "No sprint" state and no broken charts.

## Verification

Automated verification should cover:

- Dashboard model derivation for active subsprint, current item, next item, progress totals, timeline rows, and ledger rows.
- Dashboard server asset serving.
- Existing `npm run build`.
- Existing `npm test`.

Manual verification should cover:

- Active subsprint opens automatically.
- Goals are folded by default.
- Current item is blue.
- Next item is white.
- Completed content is muted.
- Detail panel opens and closes.
- Markdown item content renders formatted and sanitized.
- Timeline and ledger rows open the detail panel.
