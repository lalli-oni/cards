<script lang="ts">
  import type { CombatSide, RetreatUnitDisplay } from "cards-engine";
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
  const isSitOut = $derived(prompt?.kind === "sit_out");
  const isRetreat = $derived(prompt?.kind === "retreat");

  // The units the deciding side would pull back on a retreat (#168). A retreat
  // prompt is blind (raised before the round rolls), so it carries identity,
  // strength, and injured status but no dice — shown without a roll line.
  const retreatingSide = $derived<readonly RetreatUnitDisplay[]>(prompt?.retreatUnits ?? []);

  function signed(delta: number): string {
    return delta >= 0 ? `+${delta}` : `${delta}`;
  }

  // ---- assign_matchups state -------------------------------------------------
  // assignment[attackerUnitId] = defenderUnitId. Seeded to the greedy default
  // (participants are stored highest-power-first, so index-pairing matches
  // highest-vs-highest — the engine's auto-resolve fallback). The defender may
  // re-pair before confirming.
  let assignment = $state<Record<string, string>>({});

  // ---- sit_out state ---------------------------------------------------------
  // The excess units the larger side removes this round. Seeded to the greedy
  // lowest-power default (mirroring the engine's `getValidActions[0]`), which the
  // decider may change before confirming.
  let sitOut = $state<string[]>([]);

  let submitted = $state(false);
  // The error banner present at submit time, so the recovery effect below can
  // tell a NEW mid-submit error (which should re-enable Confirm) from a stale,
  // unrelated banner (which must not).
  let errorAtSubmit = $state<string | null>(null);

  // For a sit-out prompt the larger side is the longer roll list; that side's
  // owner (prompt.playerId) picks exactly `excess` units to remove.
  const attackerLarger = $derived(
    !!prompt && prompt.atkRolls.length > prompt.defRolls.length,
  );
  const largerRolls = $derived<readonly CombatSide[]>(
    !prompt ? [] : attackerLarger ? prompt.atkRolls : prompt.defRolls,
  );
  const excess = $derived(
    !prompt ? 0 : Math.abs(prompt.atkRolls.length - prompt.defRolls.length),
  );

  // Reseed when the prompt content changes. A sit_out → assign_matchups transition
  // keeps the outer `{#if vs?.combatPrompt}` truthy (no remount), so this effect —
  // re-running on the changed `atkRolls` — is what reseeds the new decision and
  // clears `submitted`; it also covers the defensive remount case.
  $effect(() => {
    if (!prompt) return;
    void prompt.atkRolls.map((r) => r.unitId).join(",");
    submitted = false;

    // Retreat is a blind all-or-nothing choice — no seeding, and its side lists
    // can differ in length (both sides' survivors), so skip the matchup checks.
    if (prompt.kind === "retreat") return;

    if (prompt.kind === "sit_out") {
      // Greedy default: the lowest-power `excess` units on the larger side.
      const weakestFirst = [...largerRolls].sort((a, b) => a.power - b.power);
      sitOut = weakestFirst.slice(0, excess).map((r) => r.unitId);
      return;
    }

    // assign_matchups: the engine guarantees equal-length participant lists (the
    // sit-out step already trimmed both sides to `min`). If they ever desync,
    // surface it rather than silently seeding `""` — an unseeded attacker would
    // leave `isBijection` false forever with no explanation.
    if (prompt.atkRolls.length !== prompt.defRolls.length) {
      console.warn(
        "CombatPromptOverlay: atkRolls/defRolls length mismatch — matchup participant lists should be equal",
        { atk: prompt.atkRolls.length, def: prompt.defRolls.length },
      );
    }
    const seed: Record<string, string> = {};
    prompt.atkRolls.forEach((atk, i) => {
      seed[atk.unitId] = prompt.defRolls[i]?.unitId ?? "";
    });
    assignment = seed;
  });

  // Unlock the confirm button if the engine surfaces a NEW error mid-submit, so
  // the decider can retry. Gating on a fresh error (not merely any error present)
  // avoids a stale banner re-enabling Confirm and inviting a second, dropped
  // click. Mirrors PickPromptOverlay's recovery pattern.
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

  // A valid sit-out picks exactly `excess` distinct units off the larger side.
  // `toggleSitOut` already guarantees this, but validate structurally (matching
  // `isBijection`'s rigor) so a future seeding change can't slip an out-of-set or
  // duplicate id past the confirm gate.
  const isValidSitOut = $derived.by(() => {
    const largerIds = new Set(largerRolls.map((r) => r.unitId));
    return (
      sitOut.length === excess &&
      new Set(sitOut).size === excess &&
      sitOut.every((id) => largerIds.has(id))
    );
  });

  const canConfirm = $derived(isSitOut ? isValidSitOut : isBijection);

  function toggleSitOut(unitId: string): void {
    if (sitOut.includes(unitId)) {
      sitOut = sitOut.filter((id) => id !== unitId);
    } else {
      sitOut = [...sitOut, unitId];
    }
  }

  // Retreat (#168): all-or-nothing, so submit directly from the chosen button
  // rather than via the shared confirm gate.
  function submitRetreat(retreat: boolean): void {
    if (!prompt || submitted) return;
    errorAtSubmit = error;
    submitted = true;
    selectAction({
      type: "resolve_combat_round",
      playerId: prompt.playerId,
      decision: { kind: "retreat", retreat },
    });
  }

  function confirm(): void {
    if (!prompt || submitted || !canConfirm) return;
    errorAtSubmit = error;
    submitted = true;
    if (prompt.kind === "sit_out") {
      selectAction({
        type: "resolve_combat_round",
        playerId: prompt.playerId,
        decision: { kind: "sit_out", sitOutUnitIds: sitOut },
      });
      return;
    }
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

{#if prompt}
  {@const defenderName = resolvePlayerName(prompt.defenderId)}
  {@const attackerName = resolvePlayerName(prompt.attackerId)}
  <Modal width="w-auto max-w-2xl">
    {#if isRetreat}
      {@const deciderName = resolvePlayerName(prompt.playerId)}
      <h3 class="mb-1 text-center text-lg font-bold text-text-primary">
        Retreat to HQ, or fight on?
      </h3>
      <p class="mb-4 text-center text-sm text-text-muted">
        Before round {prompt.round + 1} rolls, {deciderName} may pull all {retreatingSide.length}
        remaining unit{retreatingSide.length === 1 ? "" : "s"} back to HQ, or stay and fight the
        round. Retreating units leave this combat and heal at HQ; the opponent wins this combat.
      </p>

      <div class="mb-4 space-y-2">
        {#each retreatingSide as side (side.unitId)}
          <div class="rounded border border-border bg-surface p-2">
            <div class="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
              <span class="font-semibold text-text-primary">{resolveCardName(side.unitId)}</span>
              <span class="font-mono">strength {side.strength}</span>
              {#if side.injured}
                <span class="rounded bg-surface px-1.5 py-0.5 font-mono text-error">injured</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <div class="flex gap-2">
        <button
          type="button"
          onclick={() => submitRetreat(false)}
          disabled={submitted}
          class="flex-1 rounded border border-border bg-surface-raised py-2 font-semibold text-text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitted ? "…" : "Stay and fight"}
        </button>
        <button
          type="button"
          onclick={() => submitRetreat(true)}
          disabled={submitted}
          class="flex-1 rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitted ? "Retreating…" : "Retreat all to HQ"}
        </button>
      </div>
    {:else}
      {#if isSitOut}
        {@const deciderName = resolvePlayerName(prompt.playerId)}
        {@const smallerRolls = attackerLarger ? prompt.defRolls : prompt.atkRolls}
      <h3 class="mb-1 text-center text-lg font-bold text-text-primary">
        Choose units to sit out — round {prompt.round + 1}
      </h3>
      <p class="mb-4 text-center text-sm text-text-muted">
        {deciderName} committed {largerRolls.length} units against {smallerRolls.length}.
        Pick exactly {excess} to sit out this round — the rest fight.
      </p>

      <div class="mb-4 space-y-2">
        {#each largerRolls as side (side.unitId)}
          {@const chosen = sitOut.includes(side.unitId)}
          <button
            type="button"
            onclick={() => toggleSitOut(side.unitId)}
            class="w-full rounded border p-2 text-left transition-colors {chosen
              ? 'border-amber-500 bg-amber-500/10'
              : 'border-border bg-surface hover:border-border-strong'}"
          >
            <div class="mb-1 flex items-center justify-between">
              <span class="text-xs font-semibold {chosen ? 'text-amber-500' : 'text-text-faint'}">
                {chosen ? "Sitting out" : "Fighting"}
              </span>
            </div>
            <div class="rounded bg-surface-raised p-2">
              {@render rollLine(side)}
            </div>
          </button>
        {/each}
      </div>

      {#if !isValidSitOut}
        <p class="mb-3 text-center text-xs text-error">
          Select exactly {excess} unit{excess === 1 ? "" : "s"} to sit out
          (currently {sitOut.length}).
        </p>
      {/if}
    {:else}
      <h3 class="mb-1 text-center text-lg font-bold text-text-primary">
        Assign combat matchups — round {prompt.round + 1}
      </h3>
      <p class="mb-4 text-center text-sm text-text-muted">
        {defenderName} is defending against {attackerName}. Pair each attacker
        against one of your units — you choose after seeing every roll.
      </p>

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
    {/if}

    <button
      onclick={confirm}
      disabled={submitted || !canConfirm}
      class="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {submitted ? "Resolving…" : isSitOut ? "Confirm sit-out" : "Confirm matchups"}
    </button>
    {/if}
  </Modal>
{/if}
