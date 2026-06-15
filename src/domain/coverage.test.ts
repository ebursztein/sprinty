import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLcovFile } from "./coverage.js";

describe("coverage", () => {
  it("summarizes an lcov report from a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "sprinty-coverage-"));
    const path = join(dir, "coverage", "lcov.info");
    mkdirSync(join(dir, "coverage"), { recursive: true });
    writeFileSync(path, [
      "TN:",
      "SF:src/a.ts",
      "FNF:2",
      "FNH:1",
      "BRF:4",
      "BRH:3",
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:src/b.ts",
      "FNF:1",
      "FNH:1",
      "BRF:0",
      "BRH:0",
      "LF:5",
      "LH:5",
      "end_of_record",
      "",
    ].join("\n"));

    expect(parseLcovFile(path, "npm run test:coverage")).toEqual({
      path,
      format: "lcov",
      command: "npm run test:coverage",
      lines: { covered: 13, total: 15, percent: 86.67 },
      branches: { covered: 3, total: 4, percent: 75 },
      functions: { covered: 2, total: 3, percent: 66.67 },
    });
  });
});
