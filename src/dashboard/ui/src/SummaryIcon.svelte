<script lang="ts">
  type SummaryIconName =
    | "check"
    | "command"
    | "edit"
    | "file"
    | "plus";

  export let name: SummaryIconName;
  export let className = "";
</script>

<svg
  class={className}
  data-summary-icon={name}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "plus"}
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  {:else if name === "check"}
    <path d="M20 6 9 17l-5-5" />
  {:else if name === "edit"}
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  {:else if name === "file"}
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  {:else if name === "command"}
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
  {/if}
</svg>
