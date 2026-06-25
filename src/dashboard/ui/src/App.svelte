<script lang="ts">
  import { onMount } from "svelte";
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { deriveDashboardModel, filterLedgerRows, ledgerVerbIcon, statusDotClass, statusPillClass, type DashboardModel, type LedgerEntity, type LedgerRow, type LedgerVerb, type TreeSubsprint } from "../model";
  import type { ArtifactView, ItemView, SprintView, SubsprintView } from "../../../domain/projection";

  let sprint: SprintView | null = null;
  let model: DashboardModel | null = null;
  let error: string | null = null;
  let stale = false;
  let selectedSubId: string | null = null;
  let expandedItemIds: string[] = [];
  let ledgerPage = 0;
  let ledgerSearch = "";
  let ledgerEntityFilter: LedgerEntity | "all" = "all";
  let ledgerVerbFilter: LedgerVerb | "all" = "all";
  let theme: "light" | "dark" = "dark";
  let themeMounted = false;

  const pageSize = 8;
  const themeKey = "sprinty-dashboard-theme";

  $: model = sprint ? deriveDashboardModel(sprint) : null;
  $: if (model && !selectedSubId) selectedSubId = model.activeSubsprint?.id ?? model.sprint.subsprints[0]?.id ?? null;
  $: selectedSub = model?.sprint.subsprints.find((sub) => sub.id === selectedSubId) ?? model?.activeSubsprint ?? null;
  $: isDark = theme === "dark";
  $: if (themeMounted) applyTheme(theme);
  $: ledgerRows = model?.ledger ?? [];
  $: ledgerEntityOptions = [...new Set(ledgerRows.map((row) => row.entity))].sort();
  $: ledgerVerbOptions = [...new Set(ledgerRows.map((row) => row.verb))].sort();
  $: filteredLedgerRows = filterLedgerRows(ledgerRows, { query: ledgerSearch, entity: ledgerEntityFilter, verb: ledgerVerbFilter });
  $: ledgerPages = Math.max(1, Math.ceil(filteredLedgerRows.length / pageSize));
  $: if (ledgerPage > ledgerPages - 1) ledgerPage = ledgerPages - 1;
  $: visibleLedger = filteredLedgerRows.slice(ledgerPage * pageSize, ledgerPage * pageSize + pageSize);
  $: selectedExpandedCount = selectedSub?.items.filter((item) => expandedItemIds.includes(item.id)).length ?? 0;

  onMount(() => {
    const saved = window.localStorage.getItem(themeKey);
    const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
    theme = saved === "light" || saved === "dark" ? saved : prefersLight ? "light" : "dark";
    themeMounted = true;
    applyTheme(theme);
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => clearInterval(timer);
  });

  function applyTheme(next: "light" | "dark"): void {
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    document.body.dataset.theme = next;
    document.body.classList.toggle("dark", next === "dark");
    window.localStorage.setItem(themeKey, next);
  }

  function toggleTheme(): void {
    theme = isDark ? "light" : "dark";
  }

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
  }

  function toggleItem(item: ItemView): void {
    expandedItemIds = expandedItemIds.includes(item.id)
      ? expandedItemIds.filter((id) => id !== item.id)
      : [...expandedItemIds, item.id];
  }

  function resetLedgerPage(): void {
    ledgerPage = 0;
  }

  function inspectLedgerTarget(row: LedgerRow): void {
    if (!model || !row.clickable) return;
    if (row.targetKind === "subsprint") {
      selectedSubId = row.id;
      return;
    }
    if (row.targetKind === "item") {
      openItem(row.id);
    }
  }

  function openItem(id: string): void {
    if (!model) return;
    const item = model.sprint.subsprints.flatMap((sub) => sub.items).find((candidate) => candidate.id === id);
    if (!item) return;
    selectedSubId = item.subsprint_id;
    if (!expandedItemIds.includes(item.id)) expandedItemIds = [...expandedItemIds, item.id];
  }

  function collapseSelectedItems(): void {
    if (!selectedSub) return;
    const selectedIds = new Set(selectedSub.items.map((item) => item.id));
    expandedItemIds = expandedItemIds.filter((id) => !selectedIds.has(id));
  }

  function markdown(value: string): string {
    return DOMPurify.sanitize(String(marked.parse(value)));
  }

  function fmt(ts: string | null | undefined): string {
    if (!ts) return "";
    const date = new Date(ts);
    return Number.isNaN(date.valueOf()) ? ts : date.toLocaleString();
  }

  function statusClass(status: string): string {
    return statusPillClass(status);
  }

  function statusDot(status: string): string {
    return statusDotClass(status);
  }

  function subsprintDotStatus(sub: TreeSubsprint): string {
    return sub.status === "open" && sub.tone === "active" ? "active" : sub.status;
  }

  function itemDotStatus(item: ItemView): string {
    if (model?.blockedItems.some((blocked) => blocked.id === item.id)) return "blocked";
    if (item.id === model?.currentItem?.id) return "active";
    return item.status;
  }

  function itemDisplayStatus(item: ItemView): string {
    return model?.blockedItems.some((blocked) => blocked.id === item.id) ? "blocked" : item.status;
  }

  function ledgerEntityClass(entity: LedgerEntity): string {
    return `ledger-chip ledger-entity-${entity}`;
  }

  function ledgerVerbClass(verb: LedgerVerb): string {
    return `ledger-chip ledger-verb ledger-verb-${verb}`;
  }

  function ledgerTargetClass(row: LedgerRow): string {
    return `ledger-target ledger-target-${row.targetKind}`;
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
    else if (model?.blockedItems.some((blocked) => blocked.id === item.id)) classes.push("todo-blocked");
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
    return `conic-gradient(#16a34a 0 ${done}%, #fbbf24 ${done}% ${done + open}%, #71717a ${done + open}% ${done + open + split}%, #71717a ${done + open + split}% ${done + open + split + deprecated}%, #d4d4d8 0)`;
  }

  function targetLabel(artifact: ArtifactView): string {
    return artifact.target_id === "sprint" ? "sprint" : artifact.target_id;
  }

  function itemTitle(item: ItemView): string {
    const title = (item as ItemView & { title?: string | null }).title;
    if (title?.trim()) return title;
    return item.description.split(/\s+/).slice(0, 10).join(" ");
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
  <div class:dark={isDark} class="dashboard-frame" data-theme={theme}>
    <div class="dashboard-canvas">
      <header class="topbar">
        <div class="min-w-0">
          <div class="eyebrow">Sprinty dashboard</div>
          <h1>{model.sprint.goal}</h1>
          <div class="meta-line">
            <span>{model.sprint.branch || "detached"}</span>
            <span class="truncate">git {model.sprint.dir || model.sprint.worktree}</span>
            <span class="truncate">data {model.sprint.data_dir || "not configured"}</span>
            <span>started {fmt(model.sprint.created_at)}</span>
            {#if stale}<span class="warning-text">stale connection</span>{/if}
          </div>
        </div>
        <div class="topbar-actions">
          <span class={statusClass(model.sprint.status)}>{model.sprint.status}</span>
          <span class="coverage-chip badge badge-outline">{model.sprint.coverage?.lines.percent ?? "--"}% cov</span>
          <button
            class="theme-switch"
            on:click={toggleTheme}
            aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
            aria-pressed={isDark}
            title={`Switch to ${isDark ? "light" : "dark"} theme`}
          >
            <span class="theme-switch-icon theme-switch-sun" aria-hidden="true"></span>
            <span class="theme-switch-icon theme-switch-moon" aria-hidden="true"></span>
            <span class="theme-switch-thumb" aria-hidden="true"></span>
          </button>
        </div>
      </header>

      <main class="dashboard-main">
        <section class="overview-band" data-testid="stats-strip">
          <div class="metrics-grid">
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
              <div class="donut" style={`background:${statusDonut(model)}`}>
                <span>{model.progress.statuses.total}</span>
              </div>
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
                <span><b>{model.progress.gates.passed}</b> gates passed</span>
                <span><b>{model.progress.gates.pending}</b> gates pending</span>
              </div>
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
                    <span class={statusDot(subsprintDotStatus(sub))}></span>
                    <span class="tree-id">{sub.id}</span>
                    <span class="tree-label" title={sub.label}>{sub.label}</span>
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
              <div class="core-actions">
                {#if selectedSub}<span class={statusClass(selectedSub.status)}>{selectedSub.status}</span>{/if}
                <button class="collapse-button" disabled={selectedExpandedCount === 0} on:click={collapseSelectedItems}>
                  Collapse all
                </button>
              </div>
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
                  <button class="todo-button" on:click={() => toggleItem(item)} aria-expanded={expandedItemIds.includes(item.id)}>
                    <span class={statusDot(itemDotStatus(item))}></span>
                    <span class="todo-id">{item.id}</span>
                    <span class="todo-title">{itemTitle(item)}</span>
                    <span class={statusClass(itemDisplayStatus(item))}>{itemDisplayStatus(item)}</span>
                    <span class:todo-expand-open={expandedItemIds.includes(item.id)} class="todo-expand" aria-hidden="true"></span>
                  </button>

                  {#if expandedItemIds.includes(item.id)}
                    <div class="todo-detail">
                      <div class="detail-copy prose prose-zinc max-w-none dark:prose-invert">{@html markdown(item.description)}</div>
                      <div class="detail-grid">
                        <div><span>Files</span><strong>{item.code_locations.join(", ")}</strong></div>
                        <div><span>Gates</span><strong>{gateSummary(item)}</strong></div>
                        {#if item.dependencies.length}
                          <div>
                            <span>Depends on</span>
                            <strong class="dependency-list">
                              {#each item.dependencies as dependency}
                                <button type="button" class="dependency-link" on:click={() => openItem(dependency)}>{dependency}</button>
                              {/each}
                            </strong>
                          </div>
                        {/if}
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

        <section class="ledger-panel" data-testid="ledger-table">
          <div class="ledger-header">
            <div class="section-title">
              <span>Ledger</span>
              <span>{filteredLedgerRows.length}/{ledgerRows.length} rows</span>
            </div>
            <div class="ledger-controls" aria-label="Ledger filters">
              <input
                class="ledger-search"
                type="search"
                bind:value={ledgerSearch}
                on:input={resetLedgerPage}
                placeholder="Search ledger"
                aria-label="Search ledger"
              />
              <select class="ledger-select" bind:value={ledgerEntityFilter} on:change={resetLedgerPage} aria-label="Filter ledger entity">
                <option value="all">All types</option>
                {#each ledgerEntityOptions as entity}
                  <option value={entity}>{entity.replace("_", " ")}</option>
                {/each}
              </select>
              <select class="ledger-select" bind:value={ledgerVerbFilter} on:change={resetLedgerPage} aria-label="Filter ledger verb">
                <option value="all">All verbs</option>
                {#each ledgerVerbOptions as verb}
                  <option value={verb}>{verb}</option>
                {/each}
              </select>
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
                <tr><th>Target</th><th>Type</th><th>Verb</th><th>Text</th><th>Time</th></tr>
              </thead>
              <tbody>
                {#each visibleLedger as row}
                  <tr>
                    <td>
                      {#if row.clickable}
                        <button class={ledgerTargetClass(row)} on:click={() => inspectLedgerTarget(row)}>{row.id}</button>
                      {:else}
                        <span class={ledgerTargetClass(row)}>{row.id}</span>
                      {/if}
                    </td>
                    <td><span class={ledgerEntityClass(row.entity)}>{row.entity.replace("_", " ")}</span></td>
                    <td><span class={ledgerVerbClass(row.verb)}><span class="ledger-verb-icon" aria-hidden="true">{ledgerVerbIcon(row.verb)}</span>{row.verb}</span></td>
                    <td>{row.text}</td>
                    <td>{fmt(row.time)}</td>
                  </tr>
                {:else}
                  <tr>
                    <td colspan="5" class="ledger-empty">No matching ledger rows.</td>
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
