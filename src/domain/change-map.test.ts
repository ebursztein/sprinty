import { describe, it, expect } from "vitest";
import { aggregateChangeMaps, buildItemChangeMap } from "./change-map.js";

describe("change maps", () => {
  it("builds file rows with language, directory, net, churn, and attribution", () => {
    const map = buildItemChangeMap("S01-001", "abc123", [
      { file: "src/bookshop/catalog.ts", additions: 10, deletions: 2 },
      { file: "README.md", additions: 3, deletions: 1 },
    ]);

    expect(map.by_file).toEqual([
      {
        file: "src/bookshop/catalog.ts",
        language: "TypeScript",
        directory: "src/bookshop",
        items: ["S01-001"],
        commits: ["abc123"],
        additions: 10,
        deletions: 2,
        net: 8,
        churn: 12,
      },
      {
        file: "README.md",
        language: "Markdown",
        directory: ".",
        items: ["S01-001"],
        commits: ["abc123"],
        additions: 3,
        deletions: 1,
        net: 2,
        churn: 4,
      },
    ]);
    expect(map.by_language).toContainEqual({ language: "TypeScript", files: 1, additions: 10, deletions: 2, net: 8, churn: 12 });
    expect(map.by_directory).toContainEqual({ directory: "src/bookshop", files: 1, additions: 10, deletions: 2, net: 8, churn: 12 });
  });

  it("aggregates duplicate files across items and ranks hotspots by churn", () => {
    const one = buildItemChangeMap("S01-001", "abc123", [{ file: "src/a.ts", additions: 3, deletions: 1 }]);
    const two = buildItemChangeMap("S01-002", "def456", [
      { file: "src/a.ts", additions: 2, deletions: 4 },
      { file: "docs/readme.md", additions: 8, deletions: 0 },
    ]);

    const map = aggregateChangeMaps([one, two]);
    expect(map.by_file[0]).toMatchObject({
      file: "src/a.ts",
      items: ["S01-001", "S01-002"],
      commits: ["abc123", "def456"],
      additions: 5,
      deletions: 5,
      net: 0,
      churn: 10,
    });
    expect(map.hotspots.map((row) => row.file)).toEqual(["src/a.ts", "docs/readme.md"]);
  });
});
