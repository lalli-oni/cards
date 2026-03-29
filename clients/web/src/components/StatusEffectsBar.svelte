<script lang="ts">
  import type { ActivePassiveEvent, PolicyCard, Trap, TrapView } from "cards-engine";

  type SelfProps = {
    policies: PolicyCard[];
    traps: Trap[];
    passiveEvents: ActivePassiveEvent[];
    isSelf: true;
  };

  type OpponentProps = {
    policies: PolicyCard[];
    traps: TrapView[];
    isSelf: false;
  };

  type Props = SelfProps | OpponentProps;

  let { policies, traps, isSelf, ...rest }: Props = $props();

  const passiveEvents = $derived(isSelf ? (rest as SelfProps).passiveEvents : []);

  const hasEffects = $derived(
    policies.length > 0 || traps.length > 0 || passiveEvents.length > 0,
  );
</script>

{#if hasEffects}
  <div class="flex flex-wrap items-center gap-2 text-xs">
    {#each policies as policy}
      <span class="rounded bg-policy-bg px-1.5 py-0.5 text-policy" title={policy.effect}>
        {policy.name}
      </span>
    {/each}

    {#if isSelf}
      {#each traps as trap}
        {@const selfTrap = trap as Trap}
        <span
          class="rounded bg-trap-bg px-1.5 py-0.5 text-trap"
          title={selfTrap.card.name}
        >
          {selfTrap.card.name.slice(0, 10)}{trap.targetId
            ? ` → ${trap.targetId.slice(0, 8)}`
            : ""}
        </span>
      {/each}
    {:else if traps.length > 0}
      <span class="rounded bg-trap-bg px-1.5 py-0.5 text-trap">
        Traps: {traps.length}
        {#each traps as trap}
          {#if trap.targetId}
            <span class="text-2xs opacity-75">({trap.targetId.slice(0, 8)})</span>
          {/if}
        {/each}
      </span>
    {/if}

    {#each passiveEvents as event}
      <span
        class="rounded bg-passive-bg px-1.5 py-0.5 text-passive"
        title={event.text ?? event.name}
      >
        {event.name.slice(0, 10)} ({event.remainingDuration}t)
      </span>
    {/each}
  </div>
{/if}
