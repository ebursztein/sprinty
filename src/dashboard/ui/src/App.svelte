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
  $: if (model && !expandedItemId) expandedItemId = model.currentItem?.id ?? selectedSub?.items[0]?.id ?? null;
  $: ledgerRows = model?.ledger ?? [];
  $: ledgerPages = Math.max(1, Math.ceil(ledgerRows.length / pageSize));
  $: visibleLedger = ledgerRows.slice(ledgerPage * pageSize, ledgerPage * pageSize + pageSize);

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
    expandedItemId = sub.items[0]?.id ?? null;
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

  function statusClass(status: string): string {
    if (status === "completed" || status === "closed") return "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300";
    if (status === "open") return "bg-sky-500/15 text-sky-700 ring-sky-500/25 dark:text-sky-300";
    if (status === "split") return "bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300";
    if (status === "deprecated") return "bg-zinc-500/15 text-zinc-600 ring-zinc-500/25 dark:text-zinc-400";
    return "bg-zinc-500/15 text-zinc-600 ring-zinc-500/25 dark:text-zinc-400";
  }

  function statusDonut(model: DashboardModel): string {
    const total = Math.max(1, model.progress.statuses.total);
    const done = model.progress.statuses.completed / total * 100;
    const open = model.progress.statuses.open / total * 100;
    const split = model.progress.statuses.split / total * 100;
    const deprecated = model.progress.statuses.deprecated / total * 100;
    return `conic-gradient(#10b981 0 ${done}%, #0ea5e9 ${done}% ${done + open}%, #f59e0b ${done + open}% ${done + open + split}%, #71717a ${done + open + split}% ${done + open + split + deprecated}%, #e4e4e7 0)`;
  }

  function targetLabel(artifact: ArtifactView): string {
    return artifact.target_id === "sprint" ? "sprint" : artifact.target_id;
  }
</script>

<svelte:head>
  <title>sprinty dashboard</title>
</svelte:head>

{#if !model}
  <main class="grid min-h-screen place-items-center bg-zinc-950 px-6 text-zinc-100">
    <div class="max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div class="text-sm text-zinc-400">sprinty dashboard</div>
      <h1 class="mt-2 text-2xl font-semibold">Loading sprint</h1>
      {#if error}<p class="mt-3 text-sm text-rose-300">{error}</p>{/if}
    </div>
  </main>
{:else}
  <div class:dark class="dashboard-shell min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
    <header class="border-b border-zinc-200 bg-white/95 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950/95">
      <div class="mx-auto max-w-7xl">
        <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div class="min-w-0">
            <div class="text-xs font-semibold uppercase text-sky-600 dark:text-sky-400">Sprinty</div>
            <h1 class="mt-1 text-balance text-2xl font-semibold tracking-normal">{model.sprint.goal}</h1>
            <div class="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{model.sprint.branch || "no branch"}</span>
              <span class="max-w-full truncate">{model.sprint.worktree || model.sprint.dir}</span>
              <span>{fmt(model.sprint.created_at)}</span>
              {#if stale}<span class="text-amber-600 dark:text-amber-300">stale connection</span>{/if}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class={`rounded-full px-3 py-1 text-sm ring-1 ${statusClass(model.sprint.status)}`}>{model.sprint.status}</span>
            <button class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-sky-500 dark:border-zinc-700 dark:text-zinc-200" on:click={() => dark = !dark}>
              {dark ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5">
      <section class="artifact-shelf" data-testid="artifact-shelf">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">Artifacts</h2>
          <div class="text-xs text-zinc-500 dark:text-zinc-400">{model.artifacts.active.length} active</div>
        </div>
        <div class="mt-3 grid gap-3 md:grid-cols-3">
          {#each model.artifacts.recent as artifact}
            <a class="artifact-card" href={artifact.uri} title={artifact.uri}>
              <div class="flex items-center justify-between gap-2">
                <span class="rounded bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">{artifact.kind}</span>
                <span class="truncate text-xs text-zinc-500 dark:text-zinc-400">{targetLabel(artifact)}</span>
              </div>
              <div class="mt-2 truncate text-sm font-semibold">{artifact.title}</div>
              {#if artifact.description}<div class="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{artifact.description}</div>{/if}
            </a>
          {:else}
            <div class="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">No artifacts recorded yet.</div>
          {/each}
        </div>
      </section>

      <section class="stats-grid" data-testid="stats-strip">
        <div class="stat-panel md:col-span-2">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs text-zinc-500 dark:text-zinc-400">Sprint progress</div>
              <div class="mt-1 text-2xl font-semibold">{model.progress.items.percent}%</div>
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400">{model.progress.items.done}/{model.progress.items.total} terminal</div>
          </div>
          <div class="mt-4 h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div class="h-full rounded-full bg-sky-500" style={`width:${model.progress.items.percent}%`}></div>
          </div>
        </div>
        <div class="stat-panel">
          <div class="flex items-center gap-4">
            <div class="donut" style={`background:${statusDonut(model)}`}></div>
            <div class="grid gap-1 text-xs">
              <span><b class="text-emerald-600 dark:text-emerald-300">{model.progress.statuses.completed}</b> done</span>
              <span><b class="text-sky-600 dark:text-sky-300">{model.progress.statuses.open}</b> todo</span>
              <span><b class="text-amber-600 dark:text-amber-300">{model.progress.statuses.split}</b> split</span>
              <span><b class="text-zinc-500">{model.progress.statuses.deprecated}</b> deprecated</span>
            </div>
          </div>
        </div>
        <div class="stat-panel">
          <div class="text-xs text-zinc-500 dark:text-zinc-400">Code stats</div>
          <div class="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div><b>{model.progress.code.additions}</b><span class="ml-1 text-zinc-500">added</span></div>
            <div><b>{model.progress.code.deletions}</b><span class="ml-1 text-zinc-500">deleted</span></div>
            <div><b>{model.progress.code.churn}</b><span class="ml-1 text-zinc-500">churn</span></div>
            <div><b>{model.progress.code.hotspots}</b><span class="ml-1 text-zinc-500">hotspots</span></div>
          </div>
        </div>
      </section>

      <section class="workspace-grid">
        <aside class="sidebar-panel" data-testid="subsprint-sidebar">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold">Subsprints</h2>
            <span class="text-xs text-zinc-500">{model.sprint.subsprints.length}</span>
          </div>
          <div class="grid gap-2">
            {#each model.tree as sub}
              <button class:selected-sub={selectedSubId === sub.id} class="sub-row" on:click={() => selectSub(sub)}>
                <div class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate text-left">
                    <span class="font-mono text-xs text-sky-600 dark:text-sky-300">{sub.id}</span>
                    <span class="ml-2 text-sm font-medium">{sub.label}</span>
                  </span>
                  <span class={`shrink-0 rounded-full px-2 py-0.5 text-xs ring-1 ${statusClass(sub.status)}`}>{sub.status}</span>
                </div>
                <div class="mt-2 flex items-center gap-2">
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div class="h-full rounded-full bg-sky-500" style={`width:${sub.progress.percent}%`}></div>
                  </div>
                  <span class="text-xs text-zinc-500">{sub.progress.done}/{sub.progress.total}</span>
                </div>
              </button>
            {/each}
          </div>
        </aside>

        <section class="min-w-0" data-testid="item-core">
          <div class="content-panel">
            <div class="flex flex-col gap-2 border-b border-zinc-200 p-4 dark:border-zinc-800 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 class="text-base font-semibold">{selectedSub?.description ?? "No subsprint"}</h2>
                {#if selectedSub}
                  <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{selectedSub.kind}{selectedSub.spike_conclusion ? ` · ${selectedSub.spike_conclusion}` : ""}</div>
                {/if}
              </div>
              {#if selectedSub}
                <span class={`w-fit rounded-full px-3 py-1 text-xs ring-1 ${statusClass(selectedSub.status)}`}>{selectedSub.status}</span>
              {/if}
            </div>

            <div class="divide-y divide-zinc-200 dark:divide-zinc-800">
              {#each selectedSub?.items ?? [] as item}
                <article class="item-row" data-testid="item-row">
                  <button class="flex w-full items-center justify-between gap-3 p-4 text-left" on:click={() => toggleItem(item)} aria-expanded={expandedItemId === item.id}>
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-xs text-sky-600 dark:text-sky-300">{item.id}</span>
                        <span class={`rounded-full px-2 py-0.5 text-xs ring-1 ${statusClass(item.status)}`}>{item.status}</span>
                      </div>
                      <div class="mt-1 truncate text-sm font-medium">{item.description}</div>
                    </div>
                    <span class="text-xl text-zinc-400">{expandedItemId === item.id ? "-" : "+"}</span>
                  </button>
                  {#if expandedItemId === item.id}
                    <div class="grid gap-4 px-4 pb-4 md:grid-cols-[minmax(0,1fr)_18rem]">
                      <div class="detail-markdown prose prose-zinc max-w-none text-sm dark:prose-invert">{@html markdown(item.description)}</div>
                      <div class="grid gap-3 rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
                        <div><span class="text-zinc-500">Files</span><div class="mt-1 font-mono">{item.code_locations.join(", ")}</div></div>
                        <div><span class="text-zinc-500">Gates</span><div class="mt-1">{item.gate_results.filter((g) => g.passed).length}/{item.gates.length} passed</div></div>
                        {#if item.commit_id}<div><span class="text-zinc-500">Commit</span><div class="mt-1 font-mono">{item.commit_id}</div></div>{/if}
                        {#if item.artifacts.length}<div><span class="text-zinc-500">Artifacts</span>{#each item.artifacts as artifact}<div class="mt-1 truncate">{artifact.title}</div>{/each}</div>{/if}
                        {#if item.follow_ups.length}<div><span class="text-zinc-500">Follow-ups</span>{#each item.follow_ups as follow}<div class="mt-1">{follow.bug_ids.join(", ")} · {follow.description}</div>{/each}</div>{/if}
                      </div>
                    </div>
                  {/if}
                </article>
              {:else}
                <div class="p-4 text-sm text-zinc-500 dark:text-zinc-400">No items in this subsprint yet.</div>
              {/each}
            </div>
          </div>

          <section class="content-panel mt-5" data-testid="ledger-table">
            <div class="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
              <h2 class="text-sm font-semibold">Ledger</h2>
              <div class="flex items-center gap-2 text-xs text-zinc-500">
                <button class="pager-button" disabled={ledgerPage === 0} on:click={() => ledgerPage = Math.max(0, ledgerPage - 1)}>Prev</button>
                <span>{ledgerPage + 1}/{ledgerPages}</span>
                <button class="pager-button" disabled={ledgerPage >= ledgerPages - 1} on:click={() => ledgerPage = Math.min(ledgerPages - 1, ledgerPage + 1)}>Next</button>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full min-w-[44rem] text-left text-sm">
                <thead class="bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr><th class="px-4 py-2">Seq</th><th>Type</th><th>Target</th><th>Text</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {#each visibleLedger as row}
                    <tr class="border-t border-zinc-200 hover:bg-sky-500/5 dark:border-zinc-800">
                      <td class="px-4 py-2 font-mono text-xs text-zinc-500">{row.seq}</td>
                      <td>{row.type}</td>
                      <td class="font-mono text-xs text-sky-600 dark:text-sky-300">{row.id}</td>
                      <td class="max-w-[26rem] truncate">{row.text}</td>
                      <td class="text-xs text-zinc-500">{fmt(row.time)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </section>
    </main>
  </div>
{/if}
