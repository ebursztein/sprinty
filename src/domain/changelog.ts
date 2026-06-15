import type { SprintView } from "./projection.js";
import type { ChangeFileRow, ChangeMap } from "./change-map.js";
import type { CoverageState } from "./coverage.js";

const VERB_TITLES: Record<string, string> = {
  added: "Added",
  fixed: "Fixed",
  changed: "Changed",
  removed: "Removed",
  deprecated: "Deprecated",
  security: "Security",
};

export function renderChangelogMarkdown(sprint: SprintView): string {
  const lines: string[] = [`# Changelog: ${sprint.goal}`, ""];
  for (const verb of Object.keys(VERB_TITLES)) {
    const entries = sprint.changelog.filter((entry) => entry.verb === verb);
    if (entries.length === 0) continue;
    lines.push(`## ${VERB_TITLES[verb]}`, "");
    for (const entry of entries) {
      lines.push(`- ${entry.line} (\`${entry.item}\`)`);
    }
    lines.push("");
  }

  const coverageState = coverageStateFor(sprint);
  if (coverageState.status === "reported") {
    const coverage = coverageState.summary;
    lines.push("## Coverage", "");
    lines.push("| Metric | Covered/Total | Percent |");
    lines.push("|---|---:|---:|");
    lines.push(coverageRow("Lines", coverage.lines));
    lines.push(coverageRow("Branches", coverage.branches));
    lines.push(coverageRow("Functions", coverage.functions));
    lines.push("");
  } else if (coverageState.status === "not_applicable") {
    lines.push("## Coverage", "");
    lines.push(`Not applicable: ${coverageState.reason}`, "");
  }

  lines.push("## Change Map", "");
  appendChangeMap(lines, sprint.change_map);

  for (const sub of sprint.subsprints.filter((s) => s.kind !== "spike")) {
    lines.push("", `### Subsprint ${sub.id}: ${sub.description}`, "");
    appendChangeMap(lines, sub.change_map);
  }

  return `${lines.join("\n").trim()}\n`;
}

function coverageStateFor(sprint: SprintView): CoverageState {
  if (sprint.coverage_state) return sprint.coverage_state;
  if (sprint.coverage) return { status: "reported", summary: sprint.coverage };
  return { status: "not_configured" };
}

function appendChangeMap(lines: string[], map: ChangeMap): void {
  lines.push("| File | Language | Directory | Items | Commits | + | - | Net | Churn |");
  lines.push("|---|---|---|---|---|---:|---:|---:|---:|");
  if (map.by_file.length === 0) {
    lines.push("| _(none)_ |  |  |  |  | 0 | 0 | 0 | 0 |");
    return;
  }
  for (const row of map.by_file) lines.push(changeRow(row));
}

function changeRow(row: ChangeFileRow): string {
  return `| ${row.file} | ${row.language} | ${row.directory} | ${row.items.join(", ")} | ${row.commits.join(", ")} | ${row.additions} | ${row.deletions} | ${row.net} | ${row.churn} |`;
}

function coverageRow(label: string, metric: { covered: number; total: number; percent: number }): string {
  return `| ${label} | ${metric.covered}/${metric.total} | ${metric.percent}% |`;
}
