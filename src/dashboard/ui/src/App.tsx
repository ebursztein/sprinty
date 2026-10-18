import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  BarChart03,
  CheckDone01,
  ChevronRight,
  File06,
  GitBranch01,
  Grid01,
  Moon01,
  Sun,
  Users01,
} from "@untitledui/icons";
import type { ArtifactView, SprintView } from "../../../domain/projection.js";
import {
  deriveDashboardModel,
  filterLedgerRows,
  type LedgerEntity,
} from "../model.js";
import { fmt, formatDuration } from "../presentation.js";
import { initialTheme, useSprint } from "./state";
import { Avatar, Badge, Button, Copy, Empty, safeHref } from "./ui";
import WorkTable, { type WorkRow } from "./WorkTable";
import ItemDetail from "./ItemDetail";
const Insights = lazy(() => import("./Insights"));
const views = ["Work", "Agents", "Activity", "Insights", "Artifacts"] as const;
type View = (typeof views)[number];
const icons = [Grid01, Users01, Activity, BarChart03, File06];
function hashState() {
  return new URLSearchParams(window.location.hash.slice(1));
}
export default function App({ initialSprint }: { initialSprint?: SprintView }) {
  const remote = useSprint();
  const sprint = initialSprint ?? remote.sprint;
  const [theme, setTheme] = useState(initialTheme);
  const [view, setView] = useState<View>(() =>
    views.includes(hashState().get("view") as View)
      ? (hashState().get("view") as View)
      : "Work",
  );
  const [scope, setScope] = useState(() => hashState().get("scope") ?? "");
  const [selected, setSelected] = useState<string | null>(() =>
    hashState().get("item"),
  );
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerEntity, setLedgerEntity] = useState<LedgerEntity | "all">("all");
  const [ledgerPage, setLedgerPage] = useState(0);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem("sprinty-dashboard-theme", theme);
    } catch {
      /* private browsing */
    }
  }, [theme]);
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("view", view);
    if (scope) p.set("scope", scope);
    if (selected) p.set("item", selected);
    history.replaceState(null, "", `#${p}`);
  }, [view, scope, selected]);
  useEffect(() => {
    const change = () => {
      const p = hashState();
      setSelected(p.get("item"));
      setScope(p.get("scope") ?? "");
      const next = p.get("view") as View;
      if (views.includes(next)) setView(next);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const model = useMemo(
    () => (sprint ? deriveDashboardModel(sprint) : null),
    [sprint],
  );
  const allRows = useMemo<WorkRow[]>(() => {
    if (!model) return [];
    const blocked = new Set(model.blockedItems.map((i) => i.id));
    return model.sprint.subsprints
      .flatMap((sub) =>
        sub.items.map((item) => ({
          ...item,
          subsprintLabel: sub.description,
          displayStatus:
            item.status === "completed"
              ? "Completed"
              : item.status === "split"
                ? "Split"
                : item.status === "deprecated"
                  ? "Deprecated"
                  : item.claim?.owner
                    ? "Claimed"
                    : blocked.has(item.id)
                      ? "Blocked"
                      : "Ready",
        })),
      )
      .sort(
        (a, b) =>
          Number(!!b.claim?.stall_reasons.length) -
            Number(!!a.claim?.stall_reasons.length) ||
          Number(b.status === "open") - Number(a.status === "open") ||
          Number(!!b.claim?.owner) - Number(!!a.claim?.owner) ||
          a.id.localeCompare(b.id),
      );
  }, [model]);
  const onSelect = useCallback((id: string) => setSelected(id), []);
  if (!sprint || !model)
    return (
      <div className="loading-shell">
        <div className="brand">
          <span className="brand-mark">s</span>Sprinty
        </div>
        {remote.error ? (
          <Empty title="Couldn’t connect to Sprinty">
            <span>{remote.error}</span>
            <Button color="secondary" onPress={remote.retry}>
              Retry connection
            </Button>
          </Empty>
        ) : (
          <div role="status" className="loading-state">
            Connecting to your sprint<span className="loading-dots">…</span>
          </div>
        )}
      </div>
    );
  const rows = allRows.filter((i) => !scope || i.subsprint_id === scope);
  const activeItem = allRows.find((i) => i.id === selected);
  const eta = sprint.eta;
  const agents = sprint.agents ?? [];
  const activeAgents = eta?.active_agent_count ?? 0;
  const claimCount = allRows.filter((i) => i.claim?.owner).length;
  const stalls = allRows.filter((i) => i.claim?.stall_reasons.length);
  const open = allRows.filter((i) => i.status === "open").length;
  const resolved = allRows.length - open;
  const etaLabel =
    eta?.status === "awaiting_handover"
      ? "Awaiting handover"
      : eta?.status === "learning" || !eta
        ? "Learning"
        : eta.status === "complete"
          ? "Complete"
          : eta.status === "paused"
            ? "Paused"
            : "Running";
  const filteredLedger = filterLedgerRows(model.ledger, {
    query: ledgerQuery,
    entity: ledgerEntity,
    verb: "all",
  });
  const lastLedgerPage = Math.max(0, Math.ceil(filteredLedger.length / 25) - 1);
  const currentLedgerPage = Math.min(lastLedgerPage, ledgerPage);
  const navigate = (id: string) => {
    if (allRows.some((i) => i.id === id)) {
      setSelected(id);
      return;
    }
    if (sprint.subsprints.some((s) => s.id === id)) {
      setSelected(null);
      setScope(id);
      setView("Work");
    } else if (sprint.artifacts.some((a) => a.id === id)) {
      setSelected(null);
      setView("Artifacts");
    }
  };
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a
          className="brand"
          href="#view=Work"
          onClick={() => {
            setScope("");
            setView("Work");
            setSelected(null);
          }}
        >
          <span className="brand-mark">s</span>Sprinty
          <span className="brand-meta">WORKSPACE</span>
        </a>
        <div className="workspace-selector">
          <span className="repo-mark">⌘</span>
          <div>
            <strong>
              {sprint.worktree?.split("/").filter(Boolean).at(-1) ||
                "Local workspace"}
            </strong>
            <small>
              <GitBranch01 />
              {sprint.branch || "No branch"}
            </small>
          </div>
          <Badge tone={sprint.status === "active" ? "brand" : "neutral"}>
            {sprint.status}
          </Badge>
        </div>
        <nav aria-label="Workspace views">
          {views.map((name, index) => {
            const Icon = icons[index]!;
            return (
              <button
                key={name}
                className={`nav-item ${view === name ? "selected" : ""}`}
                aria-current={view === name ? "page" : undefined}
                onClick={() => setView(name)}
              >
                <Icon />
                {name}
                {name === "Work" && <span>{open}</span>}
                {name === "Agents" && (
                  <span>{agents.filter((a) => a.attached).length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label">
            SUBSPRINTS <span>{sprint.subsprints.length}</span>
          </div>
          <button
            className={`sub-item ${!scope ? "selected" : ""}`}
            onClick={() => {
              setScope("");
              setView("Work");
            }}
          >
            <span>All work</span>
            <span>{allRows.length}</span>
          </button>
          {sprint.subsprints.map((sub) => (
            <button
              key={sub.id}
              className={`sub-item ${scope === sub.id ? "selected" : ""}`}
              onClick={() => {
                setScope(sub.id);
                setView("Work");
              }}
            >
              <span>
                <small className="mono">{sub.id}</small>
                {sub.description}
              </span>
              <span>
                {sub.items.filter((i) => i.status !== "open").length}/
                {sub.items.length}
              </span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="live-dot" />
            Local & read only<span>No cloud account needed</span>
          </div>
          <Button
            color="tertiary"
            size="sm"
            iconLeading={theme === "dark" ? Sun : Moon01}
            onPress={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "Light appearance" : "Dark appearance"}
          </Button>
          <a
            href="https://github.com/ebursztein/sprinty"
            target="_blank"
            rel="noreferrer"
          >
            Docs & source ↗
          </a>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <ChevronRight />
            <strong>{view}</strong>
            {scope && (
              <>
                <ChevronRight />
                <span>{scope}</span>
              </>
            )}
          </div>
          <div className="connection">
            <span
              className={`live-dot ${remote.error && !initialSprint ? "offline" : ""}`}
            />
            {remote.error && !initialSprint
              ? "Reconnecting"
              : sprint.status === "active"
                ? "Live updates"
                : "Sprint closed"}
            <span className="topbar-time">
              {eta?.estimated_at
                ? `Updated ${new Date(eta.estimated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </span>
          </div>
        </header>
        <div className="page-content">
          <header className="page-header">
            <div>
              <div className="eyebrow">ONE PLAN. EVERY AGENT.</div>
              <h1>
                {sprint.goal === "(no sprint)"
                  ? "Your next sprint starts here"
                  : sprint.goal}
              </h1>
              <p>Follow the work from the first claim to the final gate.</p>
            </div>
            <Badge tone={sprint.status === "active" ? "brand" : "neutral"}>
              {sprint.status === "active"
                ? "Sprint in progress"
                : "Sprint closed"}
            </Badge>
          </header>
          {remote.error && !initialSprint && (
            <div className="notice warning" role="alert">
              <strong>Showing the last successful snapshot</strong>
              <p>{remote.error}. Retrying automatically.</p>
              <Button size="xs" color="secondary" onPress={remote.retry}>
                Retry now
              </Button>
            </div>
          )}
          <div className="metrics-row">
            <section className="metric">
              <div>
                <span>Resolved work</span>
                <CheckDone01 />
              </div>
              <strong>
                {resolved}
                <small> / {allRows.length}</small>
              </strong>
              <div className="metric-progress">
                <i
                  style={{
                    width: `${allRows.length ? (resolved / allRows.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <p>
                {model.progress.statuses.completed} completed ·{" "}
                {model.progress.statuses.split} split ·{" "}
                {model.progress.statuses.deprecated} deprecated
              </p>
            </section>
            <section className="metric">
              <div>
                <span>Agents at work</span>
                <Users01 />
              </div>
              <strong>
                {activeAgents}
                <small> active</small>
              </strong>
              <p>
                {claimCount} claimed item{claimCount === 1 ? "" : "s"} · active
                within 5 minutes
              </p>
            </section>
            <section className="metric eta-metric" aria-label="Sprint estimate">
              <div>
                <span>Remaining effort</span>
                <BarChart03 />
              </div>
              <strong>
                {eta?.remaining_work_ms != null
                  ? formatDuration(eta.remaining_work_ms)
                  : "Learning"}
              </strong>
              <p>
                <span className="estimate-state">{etaLabel}</span>
                {eta?.range_ms && (
                  <span>
                    {" "}
                    · {formatDuration(eta.range_ms[0])}–
                    {formatDuration(eta.range_ms[1])} estimate range
                  </span>
                )}
              </p>
              {eta?.status === "running" && eta.finish_range_at && (
                <small className="finish-range">
                  Approx. finish{" "}
                  {eta.finish_range_at
                    .map((ts) =>
                      new Date(ts).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    )
                    .join("–")}
                </small>
              )}
              <span className="metric-tooltip">
                {eta?.sample_count ?? 0} eligible samples · activity-derived
                estimate
              </span>
            </section>
            <section className="metric">
              <div>
                <span>Verification</span>
                <CheckDone01 />
              </div>
              <strong>
                {model.progress.gates.passed}
                <small> / {model.progress.gates.total}</small>
              </strong>
              <p>
                {model.progress.gates.failed
                  ? `${model.progress.gates.failed} failed · `
                  : ""}
                {model.progress.gates.unverified} unverified ·{" "}
                {model.progress.gates.pending} pending
              </p>
            </section>
          </div>
          {!!stalls.length && (
            <button
              className="stall-banner"
              onClick={() => {
                setView("Work");
                setScope("");
                setSelected(stalls[0]!.id);
              }}
            >
              <span className="warning-symbol">!</span>
              <div>
                <strong>
                  {stalls.length} item{stalls.length === 1 ? "" : "s"} may need
                  attention
                </strong>
                <span>
                  Check owner activity and progress before arranging a handover.
                </span>
              </div>
              <ChevronRight />
            </button>
          )}
          {view === "Work" && (
            <>
              {scope && (
                <div className="scope-context">
                  <h2>
                    {sprint.subsprints.find((s) => s.id === scope)
                      ?.description ?? "Selected subsprint"}
                  </h2>
                  {sprint.subsprints
                    .find((s) => s.id === scope)
                    ?.goals.map((goal) => (
                      <p key={goal}>{goal}</p>
                    ))}
                  <button className="text-link" onClick={() => setScope("")}>
                    Clear subsprint filter
                  </button>
                </div>
              )}
              <WorkTable rows={rows} onSelect={onSelect} />
            </>
          )}
          {view === "Agents" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    Agents, together{" "}
                    <span className="count">{agents.length}</span>
                  </h2>
                  <p>Separate sessions. Shared plan. One owner per item.</p>
                </div>
              </div>
              <div className="agent-grid">
                {agents.map((agent) => {
                  const owned = allRows.filter(
                    (i) => i.claim?.owner === agent.id,
                  );
                  const active =
                    agent.attached &&
                    Date.parse(eta?.estimated_at ?? sprint.created_at) -
                      Date.parse(agent.last_activity_at) <
                      300000;
                  return (
                    <article className="agent-card" key={agent.id}>
                      <div className="agent-heading">
                        <Avatar name={agent.name} />
                        <div>
                          <h3>{agent.name}</h3>
                          <span className="mono">{agent.id.slice(0, 8)}</span>
                        </div>
                        <Badge tone={active ? "brand" : "neutral"}>
                          {!agent.attached
                            ? "Detached"
                            : active
                              ? "Active"
                              : "Inactive"}
                        </Badge>
                      </div>
                      <p className="muted">
                        Last activity {fmt(agent.last_activity_at)}
                      </p>
                      <div className="agent-claims">
                        <span className="eyebrow">
                          {owned.length} CURRENT CLAIM
                          {owned.length === 1 ? "" : "S"}
                        </span>
                        {owned.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => onSelect(item.id)}
                          >
                            <span className="mono">{item.id}</span>
                            <strong>{item.title}</strong>
                            <small>
                              {formatDuration(item.claim.claim_duration_ms)}
                              {item.claim.stall_reasons.length
                                ? " · Potential stall"
                                : ""}
                            </small>
                          </button>
                        ))}
                        {!owned.length && (
                          <p className="muted">No work currently claimed.</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!agents.length && (
                <Empty title="No agent sessions yet">
                  Agents appear automatically when they create or resume a
                  sprint. Legacy work stays visible.
                </Empty>
              )}
            </section>
          )}
          {view === "Activity" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    The sprint record{" "}
                    <span className="count">{sprint.timeline.length}</span>
                  </h2>
                  <p>
                    An append-only history of decisions, progress, and verified
                    outcomes.
                  </p>
                </div>
              </div>
              <div className="table-toolbar">
                <label className="search-field">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="Search activity"
                    placeholder="Search the record…"
                    value={ledgerQuery}
                    onChange={(e) => {
                      setLedgerQuery(e.target.value);
                      setLedgerPage(0);
                    }}
                  />
                </label>
                <label className="sr-only" htmlFor="activity-type">
                  Activity type
                </label>
                <select
                  id="activity-type"
                  value={ledgerEntity}
                  onChange={(e) => {
                    setLedgerEntity(e.target.value as LedgerEntity | "all");
                    setLedgerPage(0);
                  }}
                >
                  <option value="all">All activity</option>
                  {[...new Set(model.ledger.map((e) => e.entity))]
                    .sort()
                    .map((entity) => (
                      <option key={entity}>{entity}</option>
                    ))}
                </select>
              </div>
              <div className="activity-list">
                {filteredLedger
                  .slice(currentLedgerPage * 25, (currentLedgerPage + 1) * 25)
                  .map((e) => (
                    <article key={e.seq} className="activity-row">
                      <span className="event-symbol" aria-hidden="true">
                        {e.entity === "agent"
                          ? "◉"
                          : e.verb === "close"
                            ? "✓"
                            : "+"}
                      </span>
                      <div>
                        <span className="event-type">
                          {e.type.replaceAll("_", " ")}
                        </span>
                        {e.clickable ? (
                          <button
                            className="text-link mono"
                            onClick={() => navigate(e.id)}
                          >
                            {e.id}
                          </button>
                        ) : (
                          <span className="mono muted">{e.id}</span>
                        )}
                        <p>
                          {agents.reduce(
                            (text, agent) =>
                              text.replaceAll(agent.id, agent.name),
                            e.text,
                          )}
                        </p>
                      </div>
                      <time>{fmt(e.time)}</time>
                    </article>
                  ))}
              </div>
              {!filteredLedger.length && (
                <Empty title="No matching activity">
                  Try another search or activity type.
                </Empty>
              )}
              <div className="table-footer">
                <span>{filteredLedger.length} events</span>
                <div>
                  <Button
                    color="secondary"
                    size="xs"
                    isDisabled={currentLedgerPage === 0}
                    onPress={() => setLedgerPage(currentLedgerPage - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    {currentLedgerPage + 1} / {lastLedgerPage + 1}
                  </span>
                  <Button
                    color="secondary"
                    size="xs"
                    isDisabled={currentLedgerPage === lastLedgerPage}
                    onPress={() => setLedgerPage(currentLedgerPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </section>
          )}
          {view === "Insights" && (
            <Suspense
              fallback={
                <div role="status" className="loading-state">
                  Loading insights…
                </div>
              }
            >
              <Insights sprint={sprint} />
            </Suspense>
          )}
          {view === "Artifacts" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    Artifacts & evidence{" "}
                    <span className="count">{sprint.artifacts.length}</span>
                  </h2>
                  <p>
                    Reports, designs, and outputs that stay attached to the
                    work.
                  </p>
                </div>
              </div>
              <div className="artifact-grid">
                {sprint.artifacts.map((artifact) => (
                  <Artifact
                    key={artifact.id}
                    artifact={artifact}
                    onNavigate={navigate}
                  />
                ))}
              </div>
              {!sprint.artifacts.length && (
                <Empty title="Keep the evidence with the work">
                  Your agent can attach reports and other outputs with
                  artifact_add.
                </Empty>
              )}
            </section>
          )}
          {selected && !activeItem && (
            <div className="notice" role="status">
              Item {selected} is not in this sprint.{" "}
              <button className="text-link" onClick={() => setSelected(null)}>
                Dismiss
              </button>
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              Sprinty · Built for work that outlives a context window.
            </span>
            <span className="mono">{sprint.branch}</span>
          </footer>
        </div>
      </main>
      {activeItem && (
        <ItemDetail
          key={activeItem.id}
          item={activeItem}
          sprint={sprint}
          status={activeItem.displayStatus}
          onClose={() => setSelected(null)}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}
function Artifact({
  artifact,
  onNavigate,
}: {
  artifact: ArtifactView;
  onNavigate: (id: string) => void;
}) {
  const href = safeHref(artifact.uri);
  return (
    <article className="artifact-card">
      <div>
        <File06 />
        <Badge tone={artifact.status === "active" ? "brand" : "neutral"}>
          {artifact.status}
        </Badge>
      </div>
      <span className="eyebrow mono">
        {artifact.id} · {artifact.kind}
      </span>
      <h3>{artifact.title}</h3>
      <p>{artifact.description || "Attached sprint output"}</p>
      <code>{artifact.uri}</code>
      <div className="artifact-actions">
        {href ? (
          <Button
            color="secondary"
            size="xs"
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            Open artifact ↗
          </Button>
        ) : (
          <Copy text={artifact.uri} label="Copy path" />
        )}
        {artifact.related_items.map((id) => (
          <button
            key={id}
            className="text-link mono"
            onClick={() => onNavigate(id)}
          >
            {id}
          </button>
        ))}
      </div>
    </article>
  );
}
