<script lang="ts">
  import type { ActivePassiveEvent, PolicyCard, Trap, TrapView, VisibleState } from "cards-engine";
  import { findCardName } from "../lib/cardLookup";

  interface Props {
    policies: PolicyCard[];
    traps: Trap[] | TrapView[];
    passiveEvents?: ActivePassiveEvent[];
    isSelf: boolean;
    vs: VisibleState;
  }

  let { policies, traps, passiveEvents = [], isSelf, vs }: Props = $props();

  const hasEffects = $derived(
    policies.length > 0 || traps.length > 0 || passiveEvents.length > 0,
  );

  function resolveTarget(targetId: string | undefined): string {
    if (!targetId) return "";
    const name = findCardName(vs, targetId);
    return name ? ` → ${name}` : "";
  }
</script>

{#if hasEffects}
  <div class="flex flex-wrap items-center gap-2 text-xs">
    {#each policies as policy}
      <span class="rounded bg-policy-bg px-1.5 py-0.5 text-policy" title={policy.name + "\n" + (policy.effect ?? "").split(";").map(e => e.trim()).join("\n")}>
        {policy.name}
      </span>
    {/each}

    {#if isSelf}
      {#each traps as trap}
        {@const selfTrap = trap as Trap}
        <span
          class="rounded bg-trap-bg px-1.5 py-0.5 text-trap"
          title={`${selfTrap.card.name}\nTrigger: ${selfTrap.card.trigger}${trap.targetId ? "\nTarget: " + (findCardName(vs, trap.targetId) ?? trap.targetId) : ""}`}
        >
          {selfTrap.card.name.slice(0, 10)}{resolveTarget(trap.targetId)}
        </span>
      {/each}
    {:else if traps.length > 0}
      <span class="rounded bg-trap-bg px-1.5 py-0.5 text-trap">
        Traps: {traps.length}
        {#each traps as trap}
          {#if trap.targetId}
            <span class="text-2xs opacity-75">({findCardName(vs, trap.targetId) ?? "?"})</span>
          {/if}
        {/each}
      </span>
    {/if}

    {#each passiveEvents as event}
      <span
        class="rounded bg-passive-bg px-1.5 py-0.5 text-passive"
        title={`${event.name} (${event.remainingDuration} turns left)${event.targetId ? "\nTarget: " + (findCardName(vs, event.targetId) ?? event.targetId) : ""}${event.text ? "\n" + event.text : ""}`}
      >
        {event.name.slice(0, 10)} ({event.remainingDuration}t){resolveTarget(event.targetId)}
      </span>
    {/each}
  </div>
{/if}
