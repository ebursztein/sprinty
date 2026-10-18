import { useMemo, useState } from "react";
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import type { ItemView } from "../../../domain/projection.js";
import { formatDuration } from "../presentation.js";
import { gateSummary } from "../model.js";
import { Avatar, Badge, Button, Empty } from "./ui";
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});
export type WorkRow = ItemView & {
  displayStatus: string;
  subsprintLabel: string;
};
function ownerName(row: WorkRow) {
  return (
    row.claim?.owner_name ??
    (row.status !== "open" ? row.claim?.history.at(-1)?.owner_name : null)
  );
}
export function statusTone(status: string) {
  return status === "Completed"
    ? "success"
    : status === "Claimed"
      ? "brand"
      : status === "Blocked"
        ? "warning"
        : "neutral";
}
export default function WorkTable({
  rows,
  onSelect,
}: {
  rows: WorkRow[];
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [page, setPage] = useState(0);
  const owners = useMemo(
    () =>
      [...new Set(rows.map(ownerName).filter((n): n is string => !!n))].sort(),
    [rows],
  );
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (status === "all" ||
            (status === "open"
              ? r.status === "open"
              : status === "stalled"
                ? !!r.claim?.stall_reasons.length
                : r.displayStatus === status)) &&
          (owner === "all" ||
            (owner === "unclaimed"
              ? !r.claim?.owner
              : ownerName(r) === owner)) &&
          [r.id, r.title, r.description, r.subsprintLabel, ownerName(r)].some(
            (s) => s?.toLowerCase().includes(query.toLowerCase()),
          ),
      ),
    [rows, query, status, owner],
  );
  const columns = useMemo<ColumnDef<typeof features, WorkRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: "Work item",
        cell: (info) => (
          <button
            className="item-link"
            onClick={() => onSelect(info.row.original.id)}
          >
            <span className="mono item-id">{info.row.original.id}</span>
            <strong>{info.row.original.title}</strong>
            <small>{info.row.original.subsprintLabel}</small>
          </button>
        ),
      },
      {
        id: "status",
        accessorKey: "displayStatus",
        header: "Status",
        cell: (info) => (
          <Badge tone={statusTone(info.row.original.displayStatus)}>
            {info.row.original.displayStatus}
          </Badge>
        ),
      },
      {
        id: "owner",
        accessorFn: (r) => ownerName(r) ?? "",
        header: "Owner",
        cell: (info) =>
          ownerName(info.row.original) ? (
            <span
              className="owner-cell"
              title={
                info.row.original.status === "open"
                  ? "Current owner"
                  : "Last owner"
              }
            >
              <Avatar name={ownerName(info.row.original)!} />
              {ownerName(info.row.original)}
            </span>
          ) : (
            <span className="muted">Unclaimed</span>
          ),
      },
      {
        id: "claim",
        accessorFn: (r) => r.claim?.claim_duration_ms ?? 0,
        header: "Claim age",
        cell: (info) =>
          info.row.original.claim?.owner ? (
            <span className="claim-age">
              {formatDuration(info.row.original.claim.claim_duration_ms)}
              {info.row.original.claim.stall_reasons.length > 0 && (
                <Badge tone="warning">Potential stall</Badge>
              )}
            </span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        id: "gates",
        accessorFn: (r) => r.gate_results.filter((g) => g.passed).length,
        header: "Verification",
        cell: (info) => (
          <span
            className={
              info.row.original.gate_results.some(
                (g) => !g.passed && !g.timed_out,
              )
                ? "danger-text"
                : "muted"
            }
          >
            {gateSummary(info.row.original)}
          </span>
        ),
      },
      {
        id: "dependencies",
        accessorFn: (r) => r.dependencies.length,
        header: "Dependencies",
        cell: (info) => (
          <span className="mono muted">
            {info.row.original.dependencies.join(", ") || "—"}
          </span>
        ),
      },
    ],
    [onSelect],
  );
  const table = useTable({ features, columns, data: filtered });
  const sorted = table.getRowModel().rows;
  const pages = Math.max(1, Math.ceil(sorted.length / 15));
  const current = Math.min(page, pages - 1);
  const change = (fn: () => void) => {
    fn();
    setPage(0);
  };
  return (
    <section className="panel work-panel" aria-label="Sprint work">
      <div className="panel-heading">
        <div>
          <h2>
            All work <span className="count">{rows.length}</span>
          </h2>
          <p>A shared plan. Clear ownership. Verified outcomes.</p>
        </div>
        <Badge tone="brand">Read only</Badge>
      </div>
      <div className="table-toolbar">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search work"
            placeholder="Search work, ID, or agent…"
            value={query}
            onChange={(e) => change(() => setQuery(e.target.value))}
          />
        </label>
        <label className="sr-only" htmlFor="work-status">
          Filter by status
        </label>
        <select
          id="work-status"
          value={status}
          onChange={(e) => change(() => setStatus(e.target.value))}
        >
          <option value="all">All statuses</option>
          <option value="open">Open work</option>
          <option value="Claimed">Claimed</option>
          <option value="Ready">Ready</option>
          <option value="Blocked">Blocked</option>
          <option value="Completed">Completed</option>
          <option value="stalled">Potential stalls</option>
          <option value="Deprecated">Deprecated</option>
          <option value="Split">Split</option>
        </select>
        <label className="sr-only" htmlFor="work-owner">
          Filter by owner
        </label>
        <select
          id="work-owner"
          value={owner}
          onChange={(e) => change(() => setOwner(e.target.value))}
        >
          <option value="all">All owners</option>
          <option value="unclaimed">Unclaimed</option>
          {owners.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button onClick={header.column.getToggleSortingHandler()}>
                      <table.FlexRender header={header} />
                      <span aria-hidden="true">
                        {header.column.getIsSorted() === "asc"
                          ? "↑"
                          : header.column.getIsSorted() === "desc"
                            ? "↓"
                            : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {sorted.slice(current * 15, (current + 1) * 15).map((row) => (
              <tr
                key={row.id}
                data-stalled={!!row.original.claim?.stall_reasons.length}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sorted.length && (
        <Empty
          title={rows.length ? "No matching work" : "Your sprint starts here"}
        >
          {rows.length
            ? "Try a different search or clear your filters."
            : "Add a subsprint and an item through your coding agent to see work here."}
        </Empty>
      )}
      <div className="table-footer">
        <span>
          {sorted.length
            ? `${current * 15 + 1}–${Math.min((current + 1) * 15, sorted.length)} of ${sorted.length} items`
            : "0 items"}
        </span>
        <div>
          <Button
            color="secondary"
            size="xs"
            isDisabled={current === 0}
            onPress={() => setPage(current - 1)}
          >
            Previous
          </Button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <Button
            color="secondary"
            size="xs"
            isDisabled={current + 1 >= pages}
            onPress={() => setPage(current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
