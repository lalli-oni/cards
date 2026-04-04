<script lang="ts">
  import type { Action } from "cards-engine";
  import { groupActions, describeAction } from "../lib/actionGroups";
  import { selectAction, resolveCardName } from "../lib/gameStore.svelte";

  interface Props {
    actions: Action[];
    /** When provided, shows a "Clear" button — indicates an active selection. */
    onDeselect?: () => void;
  }

  let { actions, onDeselect }: Props = $props();

  let expandedGroup = $state<string | null>(null);

  const groups = $derived(groupActions(actions));

  function handleGroupClick(type: string, groupActions: Action[]) {
    if (groupActions.length === 1) {
      selectAction(groupActions[0]);
    } else {
      expandedGroup = expandedGroup === type ? null : type;
    }
  }

  function handleActionClick(action: Action) {
    selectAction(action);
    expandedGroup = null;
  }
</script>

<div class="rounded-lg bg-surface p-3">
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-sm font-semibold text-text-muted">
      Actions ({actions.length})
    </h3>
    {#if onDeselect}
      <button
        onclick={onDeselect}
        class="rounded px-2 py-0.5 text-xs text-text-muted hover:bg-surface-hover hover:text-text-secondary"
        title="Clear selection (Esc)"
      >
        ✕ Clear
      </button>
    {/if}
  </div>
  <div class="space-y-1">
    {#each groups as group}
      <div>
        <button
          onclick={() => handleGroupClick(group.type, group.actions)}
          class="w-full rounded px-3 py-1.5 text-left text-sm transition-colors
            {expandedGroup === group.type
            ? 'bg-highlight-bg text-highlight'
            : 'bg-surface-raised text-text-secondary hover:bg-surface-hover'}"
        >
          {#if group.actions.length === 1}
            {describeAction(group.actions[0], resolveCardName)}
          {:else}
            {group.label}
            <span class="text-text-muted">({group.actions.length})</span>
          {/if}
        </button>

        {#if expandedGroup === group.type && group.actions.length > 1}
          <div class="ml-3 mt-1 space-y-1">
            {#each group.actions as action}
              <button
                onclick={() => handleActionClick(action)}
                class="w-full rounded px-3 py-1 text-left text-xs text-text-secondary bg-surface-raised/50 hover:bg-surface-hover"
              >
                {describeAction(action, resolveCardName)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if actions.length === 0}
      <span class="text-sm text-text-faint italic">No actions available</span>
    {/if}
  </div>
</div>
