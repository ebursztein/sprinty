import type { SprintView } from "./projection.js";
import type { ChangeFileRow, ChangeMap } from "./change-map.js";

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

  if (sprint.coverage) {
    lines.push("## Coverage", "");
    lines.push("| Metric | Covered/Total | Percent |");
    lines.push("|---|---:|---:|");
    lines.push(coverageRow("Lines", sprint.coverage.lines));
    lines.push(coverageRow("Branches", sprint.coverage.branches));
    lines.push(coverageRow("Functions", sprint.coverage.functions));
    lines.push("");
  }

  lines.push("## Change Map", "");
  appendChangeMap(lines, sprint.change_map);

  for (const sub of sprint.subsprints) {
    lines.push("", `### Subsprint ${sub.id}: ${sub.description}`, "");
    appendChangeMap(lines, sub.change_map);
  }

  return `${lines.join("\n").trim()}\n`;
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
