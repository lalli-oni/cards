<script lang="ts">
  import type { CombatSide } from "cards-engine";
  import {
    getError,
    getVisibleState,
    resolveCardName,
    resolvePlayerName,
    selectAction,
  } from "../lib/gameStore.svelte";
  import Modal from "./Modal.svelte";

  const vs = $derived(getVisibleState());
  const prompt = $derived(vs?.combatPrompt);

  function signed(delta: number): string {
    return delta >= 0 ? `+${delta}` : `${delta}`;
  }

  // assignment[attackerUnitId] = defenderUnitId. Seeded to the greedy default
  // (participants are stored highest-power-first, so index-pairing matches
  // highest-vs-highest — the engine's auto-resolve fallback). The defender may
  // re-pair before confirming.
  let assignment = $state<Record<string, string>>({});
  let submitted = $state(false);
  // The error banner present at submit time, so the recovery effect below can
  // tell a NEW mid-submit error (which should re-enable Confirm) from a stale,
  // unrelated banner (which must not).
  let errorAtSubmit = $state<string | null>(null);

  // Reseed when the prompt content changes. Today the outer `{#if vs?.combatPrompt}`
  // unmounts and remounts on every prompt transition, so this is defensive.
  $effect(() => {
    if (!prompt) return;
    void prompt.atkRolls.map((r) => r.unitId).join(",");
    // The engine guarantees equal-length participant lists (the greedy sit-out
    // trims both sides to `min`). If they ever desync, surface it rather than
    // silently seeding `""` — an unseeded attacker would leave `isBijection`
    // false forever with no explanation.
    if (prompt.atkRolls.length !== prompt.defRolls.length) {
      console.warn(
        "CombatPromptOverlay: atkRolls/defRolls length mismatch — participant lists should be equal",
        { atk: prompt.atkRolls.length, def: prompt.defRolls.length },
      );
    }
    const seed: Record<string, string> = {};
    prompt.atkRolls.forEach((atk, i) => {
      seed[atk.unitId] = prompt.defRolls[i]?.unitId ?? "";
    });
    assignment = seed;
    submitted = false;
  });

  // Unlock the confirm button if the engine surfaces a NEW error mid-submit, so
  // the defender can retry. Gating on a fresh error (not merely any error
  // present) avoids a stale banner re-enabling Confirm and inviting a second,
  // dropped click. Mirrors PickPromptOverlay's recovery pattern.
  const error = $derived(getError());
  $effect(() => {
    if (submitted && error && error !== errorAtSubmit) submitted = false;
  });

  // A valid assignment is a bijection: every defender participant used exactly
  // once (equivalently, no two attackers share a defender).
  const isBijection = $derived.by(() => {
    if (!prompt) return false;
    const chosen = Object.values(assignment).filter(Boolean);
    return (
      chosen.length === prompt.atkRolls.length &&
      new Set(chosen).size === prompt.defRolls.length
    );
  });

  function confirm(): void {
    if (!prompt || submitted || !isBijection) return;
    errorAtSubmit = error;
    submitted = true;
    selectAction({
      type: "resolve_combat_round",
      playerId: prompt.playerId,
      decision: {
        kind: "assign_matchups",
        pairs: prompt.atkRolls.map((atk) => ({
          attackerUnitId: atk.unitId,
          defenderUnitId: assignment[atk.unitId],
        })),
      },
    });
  }
</script>

{#if prompt}
  {@const defenderName = resolvePlayerName(prompt.defenderId)}
  {@const attackerName = resolvePlayerName(prompt.attackerId)}
  <Modal width="w-auto max-w-2xl">
    <h3 class="mb-1 text-center text-lg font-bold text-text-primary">
      Assign combat matchups — round {prompt.round + 1}
    </h3>
    <p class="mb-4 text-center text-sm text-text-muted">
      {defenderName} is defending against {attackerName}. Pair each attacker
      against one of your units — you choose after seeing every roll.
    </p>

    {#snippet rollLine(side: CombatSide)}
      <div class="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
        <span class="font-semibold text-text-primary">{resolveCardName(side.unitId)}</span>
        <span class="font-mono">{side.baseStrength}</span>
        {#each side.modifiers as mod}
          <span
            class="rounded bg-surface px-1.5 py-0.5 font-mono {mod.delta > 0
              ? 'text-success'
              : mod.delta < 0
                ? 'text-error'
                : 'text-text-secondary'}"
            title="{mod.source.type}: {mod.source.definitionId}"
          >
            {signed(mod.delta)} {mod.source.definitionId}
          </span>
        {/each}
        <span class="font-mono">+ {side.roll}🎲</span>
        <span class="ml-auto font-mono font-semibold text-text-primary">= {side.power}</span>
      </div>
    {/snippet}

    <div class="mb-4 space-y-2">
      {#each prompt.atkRolls as atk (atk.unitId)}
        <div class="rounded border border-border bg-surface p-2">
          <div class="mb-2 rounded bg-surface-raised p-2">
            {@render rollLine(atk)}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-text-faint">faces</span>
            <select
              bind:value={assignment[atk.unitId]}
              class="flex-1 rounded border border-border bg-surface-raised px-2 py-1 text-sm text-text-primary"
            >
              {#each prompt.defRolls as def (def.unitId)}
                <option value={def.unitId}>
                  {resolveCardName(def.unitId)} (power {def.power}{def.injuredBefore ? ", injured" : ""})
                </option>
              {/each}
            </select>
          </div>
        </div>
      {/each}
    </div>

    {#if !isBijection}
      <p class="mb-3 text-center text-xs text-error">
        Each of your units must face exactly one attacker.
      </p>
    {/if}

    <button
      onclick={confirm}
      disabled={submitted || !isBijection}
      class="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {submitted ? "Resolving…" : "Confirm matchups"}
    </button>
  </Modal>
{/if}
