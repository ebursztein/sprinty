<script lang="ts">
  import { onMount } from "svelte";
  import DOMPurify from "dompurify";
  import { marked } from "marked";
  import { deriveDashboardModel, type DashboardModel, type TreeItem, type TreeSubsprint } from "../model";
  import type { ItemView, SprintView, SubsprintView, TimelineEntry } from "../../../domain/projection";

  type Selection =
    | { kind: "item"; id: string }
    | { kind: "subsprint"; id: string }
    | { kind: "event"; seq: number }
    | null;

  let sprint: SprintView | null = null;
  let model: DashboardModel | null = null;
  let error: string | null = null;
  let stale = false;
  let selection: Selection = null;
  let expandedGoals = new Set<string>();

  $: model = sprint ? deriveDashboardModel(sprint) : null;
  $: if (!selection && model?.currentItem) selection = { kind: "item", id: model.currentItem.id };

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

  function selectItem(item: TreeItem): void {
    selection = { kind: "item", id: item.id };
  }

  function selectSubsprint(sub: TreeSubsprint): void {
    selection = { kind: "subsprint", id: sub.id };
  }

  function selectEvent(row: TimelineEntry | { seq: number }): void {
    selection = { kind: "event", seq: row.seq };
  }

  function toggleGoals(id: string): void {
    const next = new Set(expandedGoals);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedGoals = next;
  }

  function selectedItem(): ItemView | null {
    if (!sprint || selection?.kind !== "item") return null;
    return sprint.subsprints.flatMap((sub) => sub.items).find((item) => item.id === selection.id) ?? null;
  }

  function selectedSubsprint(): SubsprintView | null {
    if (!sprint || selection?.kind !== "subsprint") return null;
    return sprint.subsprints.find((sub) => sub.id === selection.id) ?? null;
  }

  function selectedEvent(): TimelineEntry | null {
    if (!sprint || selection?.kind !== "event") return null;
    return sprint.timeline.find((entry) => entry.seq === selection.seq) ?? null;
  }

  function markdown(value: string): string {
    return DOMPurify.sanitize(String(marked.parse(value)));
  }

  function fmt(ts: string | null | undefined): string {
    if (!ts) return "";
    const date = new Date(ts);
    return Number.isNaN(date.valueOf()) ? ts : date.toLocaleString();
  }

  function itemTone(tone: TreeItem["tone"]): string {
    if (tone === "current") return "border-sky-400 bg-sky-950/60 text-sky-50";
    if (tone === "next") return "border-stone-200 bg-stone-100 text-stone-950";
    if (tone === "muted") return "border-stone-700 bg-stone-900/40 text-stone-500";
    return "border-stone-700 bg-[#191d1a] text-stone-200";
  }

  function subTone(tone: TreeSubsprint["tone"]): string {
    if (tone === "active") return "border-sky-500 bg-[#172536]";
    if (tone === "done") return "border-stone-800 bg-[#171917] text-stone-500";
    return "border-stone-700 bg-[#191d1a]";
  }
</script>

<svelte:head>
  <title>sprinty dashboard</title>
</svelte:head>

{#if !model}
  <main class="grid min-h-screen place-items-center bg-[#111312] px-6 text-stone-100">
    <div class="max-w-md rounded-lg border border-stone-700 bg-[#191d1a] p-6">
      <div class="text-sm text-stone-400">sprinty dashboard</div>
      <h1 class="mt-2 text-2xl font-semibold">Loading sprint</h1>
      {#if error}<p class="mt-3 text-sm text-rose-300">{error}</p>{/if}
    </div>
  </main>
{:else}
  <div class="dashboard-shell">
    <header class="border-b border-stone-800 bg-[#151815] px-5 py-4">
      <div class="mx-auto flex max-w-7xl flex-col gap-4">
        <div class="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <div class="text-xs font-medium uppercase text-lime-300">Sprinty</div>
            <h1 class="mt-1 text-2xl font-semibold text-stone-50">{model.sprint.goal}</h1>
            <div class="mt-2 flex flex-wrap gap-2 text-xs text-stone-400">
              <span>{model.sprint.branch || "no branch"}</span>
              <span>{model.sprint.worktree || model.sprint.dir}</span>
              <span>{fmt(model.sprint.created_at)}</span>
              {#if stale}<span class="text-amber-300">stale connection</span>{/if}
            </div>
          </div>
          <div class="rounded-full border border-emerald-700 px-3 py-1 text-sm text-emerald-200">{model.sprint.status}</div>
        </div>

        <div class="grid gap-3 md:grid-cols-4">
          <div class="rounded-lg border border-stone-700 bg-[#1b1f1c] p-3">
            <div class="text-xs text-stone-400">Items</div>
            <div class="mt-1 text-2xl font-semibold">{model.progress.items.percent}%</div>
            <div class="mt-3 h-2 rounded-full bg-stone-800">
              <div class="h-2 rounded-full bg-lime-400" style={`width:${model.progress.items.percent}%`}></div>
            </div>
            <div class="mt-2 text-xs text-stone-400">{model.progress.items.done}/{model.progress.items.total} done</div>
          </div>
          <div class="rounded-lg border border-stone-700 bg-[#1b1f1c] p-3">
            <div class="text-xs text-stone-400">Gates</div>
            <div class="mt-1 text-2xl font-semibold">{model.progress.gates.passed}/{model.progress.gates.total}</div>
            <div class="mt-3 flex h-2 overflow-hidden rounded-full bg-stone-800">
              <div class="bg-emerald-400" style={`width:${model.progress.gates.total ? (model.progress.gates.passed / model.progress.gates.total) * 100 : 0}%`}></div>
              <div class="bg-rose-400" style={`width:${model.progress.gates.total ? (model.progress.gates.failed / model.progress.gates.total) * 100 : 0}%`}></div>
              <div class="bg-amber-300" style={`width:${model.progress.gates.total ? (model.progress.gates.pending / model.progress.gates.total) * 100 : 0}%`}></div>
            </div>
            <div class="mt-2 text-xs text-stone-400">{model.progress.gates.pending} pending</div>
          </div>
          <div class="rounded-lg border border-stone-700 bg-[#1b1f1c] p-3">
            <div class="text-xs text-stone-400">Current</div>
            <button class="mt-1 text-left text-lg font-semibold text-sky-200" on:click={() => model.currentItem && (selection = { kind: "item", id: model.currentItem.id })}>
              {model.currentItem?.id ?? "none"}
            </button>
            <div class="mt-2 truncate text-xs text-stone-400">{model.currentItem?.description ?? "No open item"}</div>
          </div>
          <div class="rounded-lg border border-stone-700 bg-[#1b1f1c] p-3">
            <div class="text-xs text-stone-400">Next</div>
            <button class="mt-1 text-left text-lg font-semibold text-stone-50" on:click={() => model.nextItem && (selection = { kind: "item", id: model.nextItem.id })}>
              {model.nextItem?.id ?? "none"}
            </button>
            <div class="mt-2 truncate text-xs text-stone-400">{model.nextItem?.description ?? "Queue clear"}</div>
          </div>
        </div>
      </div>
    </header>

    <main class="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section class="min-w-0">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-stone-100">Sprint Tree</h2>
          <div class="text-xs text-stone-500">{model.progress.items.open} open</div>
        </div>
        <div class="tree-grid">
          {#each model.tree as sub}
            <details class={`rounded-lg border p-3 ${subTone(sub.tone)}`} open={sub.defaultOpen}>
              <summary class="cursor-pointer list-none">
                <button class="flex w-full items-center justify-between gap-3 text-left" on:click|preventDefault={() => selectSubsprint(sub)}>
                  <span>
                    <span class="font-mono text-xs text-sky-300">{sub.id}</span>
                    <span class="ml-2 font-semibold">{sub.label}</span>
                  </span>
                  <span class="text-xs text-stone-400">{sub.progress.done}/{sub.progress.total}</span>
                </button>
                <div class="mt-3 h-1.5 rounded-full bg-stone-800">
                  <div class="h-1.5 rounded-full bg-sky-400" style={`width:${sub.progress.percent}%`}></div>
                </div>
              </summary>
              <div class="mt-3">
                <button class="text-xs text-stone-400" on:click={() => toggleGoals(sub.id)}>
                  {expandedGoals.has(sub.id) ? "Hide goals" : "Show goals"}
                </button>
                {#if expandedGoals.has(sub.id)}
                  <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-400">
                    {#each sub.goals as goal}<li>{goal}</li>{/each}
                  </ul>
                {/if}
              </div>
              <div class="mt-3 grid gap-2">
                {#each sub.items as item}
                  <button class={`rounded-md border px-3 py-2 text-left ${itemTone(item.tone)}`} on:click={() => selectItem(item)}>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="font-mono text-xs">{item.id}</span>
                      <span class="text-xs">{item.status}</span>
                    </div>
                    <div class="mt-1 text-sm font-medium">{item.label}</div>
                    <div class="mt-1 text-xs opacity-70">{item.gateSummary}</div>
                  </button>
                {/each}
              </div>
            </details>
          {/each}
        </div>

        <section class="mt-5 rounded-lg border border-stone-800 bg-[#171a18] p-4">
          <h2 class="text-sm font-semibold text-stone-100">Timeline</h2>
          <div class="mt-3 grid gap-2">
            {#each model.timeline.slice(0, 10) as row}
              <button class="rounded-md border border-stone-800 bg-[#1c201d] p-3 text-left hover:border-sky-500" on:click={() => selectEvent(row)}>
                <div class="flex flex-wrap justify-between gap-2 text-xs text-stone-500">
                  <span>{row.type}</span>
                  <span>{fmt(row.time)}</span>
                </div>
                <div class="mt-1 text-sm text-stone-200">{row.id}: {row.text}</div>
              </button>
            {/each}
          </div>
        </section>

        <section class="mt-5 rounded-lg border border-stone-800 bg-[#171a18] p-4">
          <h2 class="text-sm font-semibold text-stone-100">Ledger</h2>
          <div class="mt-3 overflow-x-auto">
            <table class="w-full min-w-[42rem] text-left text-sm">
              <thead class="text-xs text-stone-500">
                <tr><th class="py-2">Seq</th><th>Type</th><th>Target</th><th>Text</th></tr>
              </thead>
              <tbody>
                {#each model.ledger as row}
                  <tr class="border-t border-stone-800 hover:bg-stone-900/60">
                    <td class="py-2 font-mono text-xs text-stone-500">{row.seq}</td>
                    <td class="text-stone-400">{row.type}</td>
                    <td class="font-mono text-xs text-sky-300">{row.id}</td>
                    <td><button class="text-left text-stone-200" on:click={() => selectEvent(row)}>{row.text}</button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <aside class="relative">
        <div class="panel-shadow sticky top-5 max-h-[calc(100vh-2.5rem)] overflow-auto rounded-lg border border-stone-700 bg-[#1b1f1c] p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-stone-100">Details</h2>
            <button class="rounded border border-stone-700 px-2 py-1 text-xs text-stone-400" on:click={() => selection = null}>Close</button>
          </div>

          {#if selectedItem()}
            <div class="font-mono text-xs text-sky-300">{selectedItem()?.id}</div>
            <div class="detail-markdown mt-2 text-sm text-stone-100">{@html markdown(selectedItem()?.description ?? "")}</div>
            <div class="mt-4 grid gap-3 text-sm">
              <div><div class="text-xs text-stone-500">Status</div><div>{selectedItem()?.status}</div></div>
              <div><div class="text-xs text-stone-500">Files</div><div class="font-mono text-xs text-stone-300">{selectedItem()?.code_locations.join(", ")}</div></div>
              <div><div class="text-xs text-stone-500">Gates</div>{#each selectedItem()?.gates ?? [] as gate}<div class="mt-1 rounded border border-stone-800 p-2 font-mono text-xs">{gate.kind}: {gate.spec}</div>{/each}</div>
              {#if selectedItem()?.updates.length}<div><div class="text-xs text-stone-500">Updates</div>{#each selectedItem()?.updates ?? [] as update}<div class="mt-1 text-stone-300">{update}</div>{/each}</div>{/if}
              {#if selectedItem()?.notes.length}<div><div class="text-xs text-stone-500">Notes</div>{#each selectedItem()?.notes ?? [] as note}<div class="mt-1 text-stone-300">{note}</div>{/each}</div>{/if}
              {#if selectedItem()?.commit_id}<div><div class="text-xs text-stone-500">Commit</div><div class="font-mono text-xs">{selectedItem()?.commit_id}</div></div>{/if}
            </div>
          {:else if selectedSubsprint()}
            <div class="font-mono text-xs text-sky-300">{selectedSubsprint()?.id}</div>
            <div class="mt-2 text-lg font-semibold">{selectedSubsprint()?.description}</div>
            <div class="mt-4 text-xs text-stone-500">Goals</div>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-300">{#each selectedSubsprint()?.goals ?? [] as goal}<li>{goal}</li>{/each}</ul>
            {#if selectedSubsprint()?.notes.length}<div class="mt-4 text-xs text-stone-500">Notes</div>{#each selectedSubsprint()?.notes ?? [] as note}<div class="mt-1 text-sm text-stone-300">{note}</div>{/each}{/if}
          {:else if selectedEvent()}
            <div class="font-mono text-xs text-sky-300">#{selectedEvent()?.seq}</div>
            <div class="mt-2 text-lg font-semibold">{selectedEvent()?.type}</div>
            <div class="mt-1 text-xs text-stone-500">{fmt(selectedEvent()?.ts)}</div>
            <div class="detail-markdown mt-3 text-sm text-stone-100">{@html markdown(selectedEvent()?.text ?? "")}</div>
          {:else}
            <div class="text-sm text-stone-400">Select a row from the tree, timeline, or ledger.</div>
          {/if}
        </div>
      </aside>
    </main>
  </div>
{/if}
