import { dirname, extname } from "node:path";
import { z } from "zod";

export const ChangeFileRow = z.object({
  file: z.string(),
  language: z.string(),
  directory: z.string(),
  items: z.array(z.string()),
  commits: z.array(z.string()),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  net: z.number().int(),
  churn: z.number().int().nonnegative(),
});
export type ChangeFileRow = z.infer<typeof ChangeFileRow>;

export const ChangeBucketRow = z.object({
  files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  net: z.number().int(),
  churn: z.number().int().nonnegative(),
});
export type ChangeBucketRow = z.infer<typeof ChangeBucketRow>;

export const ChangeDirectoryRow = ChangeBucketRow.extend({ directory: z.string() });
export type ChangeDirectoryRow = z.infer<typeof ChangeDirectoryRow>;

export const ChangeLanguageRow = ChangeBucketRow.extend({ language: z.string() });
export type ChangeLanguageRow = z.infer<typeof ChangeLanguageRow>;

export const ChangeMap = z.object({
  by_file: z.array(ChangeFileRow),
  by_directory: z.array(ChangeDirectoryRow),
  by_language: z.array(ChangeLanguageRow),
  hotspots: z.array(ChangeFileRow),
});
export type ChangeMap = z.infer<typeof ChangeMap>;

export interface NumstatEntry {
  file: string;
  additions: number;
  deletions: number;
}

export function emptyChangeMap(): ChangeMap {
  return { by_file: [], by_directory: [], by_language: [], hotspots: [] };
}

export function buildItemChangeMap(item: string, commit: string, entries: NumstatEntry[]): ChangeMap {
  return aggregateRows(entries.map((entry) => rowForEntry(item, commit, entry)));
}

export function aggregateChangeMaps(maps: ChangeMap[]): ChangeMap {
  return aggregateRows(maps.flatMap((map) => map.by_file));
}

function aggregateRows(rows: ChangeFileRow[]): ChangeMap {
  const byFile = new Map<string, ChangeFileRow>();
  for (const row of rows) {
    const existing = byFile.get(row.file);
    if (!existing) {
      byFile.set(row.file, { ...row, items: [...row.items], commits: [...row.commits] });
      continue;
    }
    existing.items = unique([...existing.items, ...row.items]);
    existing.commits = unique([...existing.commits, ...row.commits]);
    existing.additions += row.additions;
    existing.deletions += row.deletions;
    existing.net = existing.additions - existing.deletions;
    existing.churn = existing.additions + existing.deletions;
  }
  const fileRows = [...byFile.values()].sort(compareHotspots);
  return {
    by_file: fileRows,
    by_directory: aggregateDirectoryBuckets(fileRows),
    by_language: aggregateLanguageBuckets(fileRows),
    hotspots: fileRows.slice(0, 10),
  };
}

function rowForEntry(item: string, commit: string, entry: NumstatEntry): ChangeFileRow {
  const additions = entry.additions;
  const deletions = entry.deletions;
  return {
    file: entry.file,
    language: languageForPath(entry.file),
    directory: directoryForPath(entry.file),
    items: [item],
    commits: [commit],
    additions,
    deletions,
    net: additions - deletions,
    churn: additions + deletions,
  };
}

function aggregateDirectoryBuckets(rows: ChangeFileRow[]): ChangeDirectoryRow[] {
  const buckets = new Map<string, ChangeBucketRow>();
  for (const row of rows) {
    const bucketKey = row.directory;
    const bucket = buckets.get(bucketKey) ?? { files: 0, additions: 0, deletions: 0, net: 0, churn: 0 };
    bucket.files += 1;
    bucket.additions += row.additions;
    bucket.deletions += row.deletions;
    bucket.net = bucket.additions - bucket.deletions;
    bucket.churn = bucket.additions + bucket.deletions;
    buckets.set(bucketKey, bucket);
  }
  return [...buckets.entries()]
    .map(([directory, bucket]) => ({ directory, ...bucket }))
    .sort((a, b) => b.churn - a.churn || a.directory.localeCompare(b.directory));
}

function aggregateLanguageBuckets(rows: ChangeFileRow[]): ChangeLanguageRow[] {
  const buckets = new Map<string, ChangeBucketRow>();
  for (const row of rows) {
    const bucketKey = row.language;
    const bucket = buckets.get(bucketKey) ?? { files: 0, additions: 0, deletions: 0, net: 0, churn: 0 };
    bucket.files += 1;
    bucket.additions += row.additions;
    bucket.deletions += row.deletions;
    bucket.net = bucket.additions - bucket.deletions;
    bucket.churn = bucket.additions + bucket.deletions;
    buckets.set(bucketKey, bucket);
  }
  return [...buckets.entries()]
    .map(([language, bucket]) => ({ language, ...bucket }))
    .sort((a, b) => b.churn - a.churn || a.language.localeCompare(b.language));
}

function compareHotspots(a: ChangeFileRow, b: ChangeFileRow): number {
  return b.churn - a.churn || b.commits.length - a.commits.length || b.items.length - a.items.length || a.file.localeCompare(b.file);
}

function directoryForPath(file: string): string {
  const dir = dirname(file);
  return dir === "" ? "." : dir;
}

export function languageForPath(file: string): string {
  const ext = extname(file).toLowerCase();
  const byExt: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".json": "JSON",
    ".md": "Markdown",
    ".rs": "Rust",
    ".py": "Python",
    ".go": "Go",
    ".css": "CSS",
    ".html": "HTML",
    ".txt": "Text",
    ".yml": "YAML",
    ".yaml": "YAML",
  };
  return byExt[ext] ?? (ext ? ext.slice(1).toUpperCase() : "Text");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
