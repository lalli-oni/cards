<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** Tailwind width class for the card. Default w-96. */
    width?: string;
    children: Snippet;
  }

  const { width = "w-96", children }: Props = $props();
</script>

<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
  <div class={`${width} rounded-lg bg-surface p-5`}>
    {@render children()}
  </div>
</div>
