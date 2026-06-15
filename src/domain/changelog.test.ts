import { describe, it, expect } from "vitest";
import { renderChangelogMarkdown } from "./changelog.js";
import { aggregateChangeMaps, buildItemChangeMap } from "./change-map.js";
import type { SprintView } from "./projection.js";

describe("changelog markdown", () => {
  it("renders semver sections with sprint and subsprint change-map tables", () => {
    const itemMap = buildItemChangeMap("S01-001", "abc123", [
      { file: "src/bookshop/catalog.ts", additions: 10, deletions: 2 },
    ]);
    const sprint: SprintView = {
      goal: "Bookshop",
      worktree: "/repo",
      branch: "main",
      dir: "/repo", data_dir: "/repo/.sprinty",
      context_notes: [],
      created_at: "2026-06-14T00:00:00.000Z",
      closed_at: null,
      status: "active",
      timeline: [],
      graph: { nodes: [], edges: [], blocked_by: {}, unblocks: {}, topological_order: [], cycles: [] },
      coverage: {
        path: "coverage/lcov.info",
        format: "lcov",
        command: "npm run test:coverage",
        lines: { covered: 8, total: 10, percent: 80 },
        branches: { covered: 3, total: 4, percent: 75 },
        functions: { covered: 2, total: 2, percent: 100 },
      },
      change_map: aggregateChangeMaps([itemMap]),
      subsprints: [{
        id: "S01",
        description: "Catalog",
        created_at: "2026-06-14T00:01:00.000Z",
        closed_at: "2026-06-14T00:02:00.000Z",
        goals: ["Search"],
        gates: [],
        status: "closed",
        spawned_from_item: null,
        dependencies: [],
        notes: [],
        change_map: aggregateChangeMaps([itemMap]),
        changelog: [{ item: "S01-001", verb: "added", line: "Added searchable catalog." }],
        items: [{
          id: "S01-001",
          subsprint_id: "S01",
          description: "Catalog item",
          created_at: "2026-06-14T00:01:00.000Z",
          resolved_at: "2026-06-14T00:02:00.000Z",
          code_locations: ["src/bookshop/catalog.ts"],
          gates: [],
          status: "completed",
          disposition: "completed",
          dependencies: [],
          commit_id: "abc123",
          gate_results: [],
          reason: null,
          spawned_subsprint: null,
          changelog: { verb: "added", line: "Added searchable catalog." },
          change_map: itemMap,
          updates: [],
          notes: [],
        }],
      }],
      changelog: [{ item: "S01-001", subsprint: "S01", verb: "added", line: "Added searchable catalog." }],
    };

    const md = renderChangelogMarkdown(sprint);
    expect(md).toContain("# Changelog: Bookshop");
    expect(md).toContain("## Added");
    expect(md).toContain("- Added searchable catalog. (`S01-001`)");
    expect(md).toContain("| File | Language | Directory | Items | Commits | + | - | Net | Churn |");
    expect(md).toContain("| src/bookshop/catalog.ts | TypeScript | src/bookshop | S01-001 | abc123 | 10 | 2 | 8 | 12 |");
    expect(md).toContain("## Coverage");
    expect(md).toContain("| Lines | 8/10 | 80% |");
    expect(md).toContain("### Subsprint S01: Catalog");
  });
});
