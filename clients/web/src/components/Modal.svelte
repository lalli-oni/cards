<script lang="ts">
  import type { Snippet } from "svelte";

  // Centered-card modal over a darkened backdrop. Intentionally NOT
  // dismissable via Escape or click-outside — current callers
  // (PickPromptOverlay, ContestResultPopup) require explicit interaction
  // via their inner buttons. If a future modal needs dismissability, add
  // a `dismissable` prop here rather than introducing a parallel
  // primitive. ARIA dialog attributes set so assistive tech announces
  // the modal; focus trap is not implemented (separate a11y concern).
  interface Props {
    width?: string;
    children: Snippet;
  }

  const { width = "w-96", children }: Props = $props();
</script>

<div
  class="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
  role="dialog"
  aria-modal="true"
>
  <div class={`${width} rounded-lg bg-surface p-5`}>
    {@render children()}
  </div>
</div>
