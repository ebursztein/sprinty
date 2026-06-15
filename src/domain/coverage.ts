import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const CoverageMetric = z.object({
  covered: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percent: z.number().nonnegative(),
});
export type CoverageMetric = z.infer<typeof CoverageMetric>;

export const CoverageSummary = z.object({
  path: z.string(),
  format: z.literal("lcov"),
  command: z.string().optional(),
  lines: CoverageMetric,
  branches: CoverageMetric,
  functions: CoverageMetric,
});
export type CoverageSummary = z.infer<typeof CoverageSummary>;

export const CoverageState = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_configured") }),
  z.object({ status: z.literal("not_applicable"), reason: z.string().min(1) }),
  z.object({ status: z.literal("reported"), summary: CoverageSummary }),
]);
export type CoverageState = z.infer<typeof CoverageState>;

export interface CoverageInput {
  path: string;
  format: "lcov";
  command?: string | undefined;
}

export function parseCoverageReport(repoDir: string, input: CoverageInput): CoverageSummary {
  const absolute = resolve(repoDir, input.path);
  if (!existsSync(absolute)) throw new Error(`Coverage report not found: ${input.path}`);
  return parseLcovFile(absolute, input.command);
}

export function parseLcovFile(path: string, command?: string): CoverageSummary {
  const text = readFileSync(path, "utf8");
  let linesTotal = 0;
  let linesCovered = 0;
  let branchesTotal = 0;
  let branchesCovered = 0;
  let functionsTotal = 0;
  let functionsCovered = 0;

  for (const line of text.split(/\r?\n/)) {
    const [key, rawValue] = line.split(":", 2);
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    if (key === "LF") linesTotal += value;
    if (key === "LH") linesCovered += value;
    if (key === "BRF") branchesTotal += value;
    if (key === "BRH") branchesCovered += value;
    if (key === "FNF") functionsTotal += value;
    if (key === "FNH") functionsCovered += value;
  }

  if (linesTotal === 0) throw new Error(`Coverage report has no line totals: ${path}`);
  return {
    path,
    format: "lcov",
    ...(command ? { command } : {}),
    lines: metric(linesCovered, linesTotal),
    branches: metric(branchesCovered, branchesTotal),
    functions: metric(functionsCovered, functionsTotal),
  };
}

function metric(covered: number, total: number): CoverageMetric {
  return { covered, total, percent: total === 0 ? 0 : round((covered / total) * 100) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
