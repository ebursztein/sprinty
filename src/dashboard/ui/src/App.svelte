<script lang="ts">
  import { onMount } from "svelte";
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { deriveDashboardModel, type DashboardModel, type TreeSubsprint } from "../model";
  import type { ArtifactView, ItemView, SprintView, SubsprintView } from "../../../domain/projection";

  let sprint: SprintView | null = null;
  let model: DashboardModel | null = null;
  let error: string | null = null;
  let stale = false;
  let selectedSubId: string | null = null;
  let expandedItemId: string | null = null;
  let ledgerPage = 0;
  let dark = true;

  const pageSize = 8;

  $: model = sprint ? deriveDashboardModel(sprint) : null;
  $: if (model && !selectedSubId) selectedSubId = model.activeSubsprint?.id ?? model.sprint.subsprints[0]?.id ?? null;
  $: selectedSub = model?.sprint.subsprints.find((sub) => sub.id === selectedSubId) ?? model?.activeSubsprint ?? null;
  $: if (model && selectedSub && !selectedSub.items.some((item) => item.id === expandedItemId)) expandedItemId = model.currentItem?.subsprint_id === selectedSub.id ? model.currentItem.id : selectedSub.items[0]?.id ?? null;
  $: ledgerRows = model?.ledger ?? [];
  $: ledgerPages = Math.max(1, Math.ceil(ledgerRows.length / pageSize));
  $: if (ledgerPage > ledgerPages - 1) ledgerPage = ledgerPages - 1;
  $: visibleLedger = ledgerRows.slice(ledgerPage * pageSize, ledgerPage * pageSize + pageSize);
  $: recentTimeline = model?.timeline.slice(0, 6) ?? [];

  onMount(() => {
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => clearInterval(timer);
  });

  async function tick(): Promise<void> {
    try {
      const response = await fetch("/state");
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      sprint = await response.json() as SprintView;
      error = null;
      stale = false;
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load state.";
      stale = sprint !== null;
    }
  }

  function selectSub(sub: TreeSubsprint): void {
    selectedSubId = sub.id;
    expandedItemId = model?.currentItem?.subsprint_id === sub.id ? model.currentItem.id : sub.items[0]?.id ?? null;
  }

  function toggleItem(item: ItemView): void {
    expandedItemId = expandedItemId === item.id ? null : item.id;
  }

  function markdown(value: string): string {
    return DOMPurify.sanitize(String(marked.parse(value)));
  }

  function fmt(ts: string | null | undefined): string {
    if (!ts) return "";
    const date = new Date(ts);
    return Number.isNaN(date.valueOf()) ? ts : date.toLocaleString();
  }

  function compactTime(ts: string | null | undefined): string {
    if (!ts) return "";
    const date = new Date(ts);
    return Number.isNaN(date.valueOf()) ? ts : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function statusClass(status: string): string {
    if (status === "completed" || status === "closed") return "status-pill status-done";
    if (status === "open" || status === "active") return "status-pill status-open";
    if (status === "split") return "status-pill status-split";
    if (status === "deprecated") return "status-pill status-deprecated";
    return "status-pill status-neutral";
  }

  function statusDot(status: string): string {
    if (status === "completed" || status === "closed") return "dot dot-done";
    if (status === "open" || status === "active") return "dot dot-open";
    if (status === "split") return "dot dot-split";
    if (status === "deprecated") return "dot dot-deprecated";
    return "dot dot-neutral";
  }

  function treeRowClass(sub: TreeSubsprint): string {
    const classes = ["tree-row"];
    if (selectedSubId === sub.id) classes.push("tree-row-selected");
    if (sub.tone === "done") classes.push("tree-row-done");
    if (sub.tone === "active") classes.push("tree-row-active");
    if (sub.tone === "muted") classes.push("tree-row-muted");
    return classes.join(" ");
  }

  function itemRowClass(item: ItemView): string {
    const classes = ["todo-row"];
    if (item.id === model?.currentItem?.id) classes.push("todo-current");
    else if (item.id === model?.nextItem?.id) classes.push("todo-next");
    if (item.status !== "open") classes.push("todo-terminal");
    return classes.join(" ");
  }

  function gateSummary(item: ItemView): string {
    const passed = item.gate_results.filter((gate) => gate.passed).length;
    const failed = item.gate_results.filter((gate) => !gate.passed).length;
    const pending = Math.max(0, item.gates.length - passed - failed);
    return `${passed}/${item.gates.length} passed${failed ? `, ${failed} failed` : ""}${pending ? `, ${pending} pending` : ""}`;
  }

  function statusDonut(model: DashboardModel): string {
    const total = Math.max(1, model.progress.statuses.total);
    const done = model.progress.statuses.completed / total * 100;
    const open = model.progress.statuses.open / total * 100;
    const split = model.progress.statuses.split / total * 100;
    const deprecated = model.progress.statuses.deprecated / total * 100;
    return `conic-gradient(#22c55e 0 ${done}%, #3b82f6 ${done}% ${done + open}%, #f59e0b ${done + open}% ${done + open + split}%, #71717a ${done + open + split}% ${done + open + split + deprecated}%, #27272a 0)`;
  }

  function targetLabel(artifact: ArtifactView): string {
    return artifact.target_id === "sprint" ? "sprint" : artifact.target_id;
  }
</script>

<svelte:head>
  <title>sprinty dashboard</title>
</svelte:head>

{#if !model}
  <main class="loading-screen">
    <div class="loading-panel">
      <div class="brand-mark">S</div>
      <h1>Loading Sprinty</h1>
      {#if error}<p>{error}</p>{/if}
    </div>
  </main>
{:else}
  <div class:dark class="dashboard-frame">
    <aside class="app-rail" aria-label="Sprinty navigation">
      <div class="rail-logo">S</div>
      <div class="rail-stack">
        <span class="rail-icon rail-icon-active" title="Dashboard">D</span>
        <span class="rail-icon" title="Tree">T</span>
        <span class="rail-icon" title="Ledger">L</span>
      </div>
      <button class="theme-toggle" on:click={() => dark = !dark} aria-label="Toggle theme">{dark ? "L" : "D"}</button>
    </aside>

    <div class="dashboard-canvas">
      <header class="topbar">
        <div class="min-w-0">
          <div class="eyebrow">Sprinty dashboard</div>
          <h1>{model.sprint.goal}</h1>
          <div class="meta-line">
            <span>{model.sprint.branch || "detached"}</span>
            <span class="truncate">{model.sprint.worktree || model.sprint.dir}</span>
            <span>started {fmt(model.sprint.created_at)}</span>
            {#if stale}<span class="warning-text">stale connection</span>{/if}
          </div>
        </div>
        <div class="topbar-actions">
          <span class={statusClass(model.sprint.status)}>{model.sprint.status}</span>
          <span class="coverage-chip">{model.sprint.coverage?.lines.percent ?? "--"}% cov</span>
        </div>
      </header>

      <main class="dashboard-main">
        <section class="artifact-strip" data-testid="artifact-shelf">
          <div class="section-title">
            <span>Artifacts</span>
            <span>{model.artifacts.active.length} active</span>
          </div>
          <div class="artifact-list">
            {#each model.artifacts.recent as artifact}
              <a class="artifact-token" href={artifact.uri} title={artifact.uri}>
                <span>{artifact.kind}</span>
                <strong>{artifact.title}</strong>
                <small>{targetLabel(artifact)}</small>
              </a>
            {:else}
              <div class="empty-inline">No artifacts recorded yet.</div>
            {/each}
          </div>
        </section>

        <section class="metrics-grid" data-testid="stats-strip">
          <div class="metric-panel metric-progress">
            <div class="metric-heading">
              <span>Sprint progress</span>
              <strong>{model.progress.items.percent}%</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style={`width:${model.progress.items.percent}%`}></div>
            </div>
            <div class="metric-foot">{model.progress.items.done}/{model.progress.items.total} items terminal</div>
          </div>

          <div class="metric-panel metric-status">
            <div class="donut" style={`background:${statusDonut(model)}`}></div>
            <div class="status-legend">
              <span><b class="legend-done">{model.progress.statuses.completed}</b> done</span>
              <span><b class="legend-open">{model.progress.statuses.open}</b> todo</span>
              <span><b class="legend-split">{model.progress.statuses.split}</b> split</span>
              <span><b class="legend-muted">{model.progress.statuses.deprecated}</b> deprecated</span>
            </div>
          </div>

          <div class="metric-panel code-metrics">
            <div class="metric-heading"><span>Code stats</span><strong>{model.progress.code.churn}</strong></div>
            <div class="code-grid">
              <span><b>{model.progress.code.additions}</b> added</span>
              <span><b>{model.progress.code.deletions}</b> deleted</span>
              <span><b>{model.progress.code.files}</b> files</span>
              <span><b>{model.progress.code.hotspots}</b> hotspots</span>
            </div>
          </div>
        </section>

        <section class="workbench">
          <aside class="tree-panel" data-testid="subsprint-sidebar">
            <div class="tree-header">
              <h2>Subsprints</h2>
              <span>{model.sprint.subsprints.length}</span>
            </div>
            <div class="tree-list">
              {#each model.tree as sub}
                <button class={treeRowClass(sub)} on:click={() => selectSub(sub)}>
                  <div class="tree-row-main">
                    <span class={statusDot(sub.status)}></span>
                    <span class="tree-id">{sub.id}</span>
                    <span class="tree-label">{sub.label}</span>
                  </div>
                  <div class="tree-row-progress">
                    <span><b>{sub.progress.done}</b>/{sub.progress.total}</span>
                    <div class="mini-track"><div style={`width:${sub.progress.percent}%`}></div></div>
                  </div>
                </button>
              {/each}
            </div>
          </aside>

          <section class="core-panel" data-testid="item-core">
            <div class="core-header">
              <div class="min-w-0">
                <div class="eyebrow">{selectedSub?.id ?? "No subsprint"}</div>
                <h2>{selectedSub?.description ?? "No subsprint selected"}</h2>
                {#if selectedSub}
                  <p>{selectedSub.kind}{selectedSub.spike_conclusion ? `: ${selectedSub.spike_conclusion}` : ""}</p>
                {/if}
              </div>
              {#if selectedSub}<span class={statusClass(selectedSub.status)}>{selectedSub.status}</span>{/if}
            </div>

            {#if selectedSub?.goals.length}
              <details class="goals-fold">
                <summary>Goals</summary>
                <ul>
                  {#each selectedSub.goals as goal}
                    <li>{goal}</li>
                  {/each}
                </ul>
              </details>
            {/if}

            <div class="todo-list">
              {#each selectedSub?.items ?? [] as item}
                <article class={itemRowClass(item)} data-testid="item-row">
                  <button class="todo-button" on:click={() => toggleItem(item)} aria-expanded={expandedItemId === item.id}>
                    <span class={statusDot(item.status)}></span>
                    <span class="todo-id">{item.id}</span>
                    <span class="todo-title">{item.description}</span>
                    <span class={statusClass(item.status)}>{item.status}</span>
                    <span class="todo-expand">{expandedItemId === item.id ? "-" : "+"}</span>
                  </button>

                  {#if expandedItemId === item.id}
                    <div class="todo-detail">
                      <div class="detail-copy prose prose-zinc max-w-none dark:prose-invert">{@html markdown(item.description)}</div>
                      <div class="detail-grid">
                        <div><span>Files</span><strong>{item.code_locations.join(", ")}</strong></div>
                        <div><span>Gates</span><strong>{gateSummary(item)}</strong></div>
                        {#if item.dependencies.length}<div><span>Depends on</span><strong>{item.dependencies.join(", ")}</strong></div>{/if}
                        {#if item.commit_id}<div><span>Commit</span><strong>{item.commit_id}</strong></div>{/if}
                        {#if item.changelog}<div><span>Changelog</span><strong>{item.changelog.verb}: {item.changelog.line}</strong></div>{/if}
                        {#if item.artifacts.length}<div><span>Artifacts</span><strong>{item.artifacts.map((artifact) => artifact.title).join(", ")}</strong></div>{/if}
                        {#if item.follow_ups.length}<div><span>Follow-ups</span><strong>{item.follow_ups.map((follow) => `${follow.bug_ids.join(", ")}: ${follow.description}`).join("; ")}</strong></div>{/if}
                      </div>
                    </div>
                  {/if}
                </article>
              {:else}
                <div class="empty-panel">No items in this subsprint yet.</div>
              {/each}
            </div>
          </section>
        </section>

        <section class="timeline-panel" data-testid="timeline-panel">
          <div class="section-title">
            <span>Timeline</span>
            <span>{model.timeline.length} events</span>
          </div>
          <div class="timeline-list">
            {#each recentTimeline as row}
              <div class="timeline-event">
                <span>{compactTime(row.time)}</span>
                <strong>{row.type}</strong>
                <p>{row.text}</p>
              </div>
            {:else}
              <div class="empty-inline">No events yet.</div>
            {/each}
          </div>
        </section>

        <section class="ledger-panel" data-testid="ledger-table">
          <div class="ledger-header">
            <div class="section-title">
              <span>Ledger</span>
              <span>{ledgerRows.length} rows</span>
            </div>
            <div class="pager">
              <button disabled={ledgerPage === 0} on:click={() => ledgerPage = Math.max(0, ledgerPage - 1)}>Prev</button>
              <span>{ledgerPage + 1}/{ledgerPages}</span>
              <button disabled={ledgerPage >= ledgerPages - 1} on:click={() => ledgerPage = Math.min(ledgerPages - 1, ledgerPage + 1)}>Next</button>
            </div>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr><th>Seq</th><th>Type</th><th>Target</th><th>Text</th><th>Time</th></tr>
              </thead>
              <tbody>
                {#each visibleLedger as row}
                  <tr>
                    <td>{row.seq}</td>
                    <td>{row.type}</td>
                    <td>{row.id}</td>
                    <td>{row.text}</td>
                    <td>{fmt(row.time)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  </div>
{/if}
