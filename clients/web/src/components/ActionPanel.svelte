<script lang="ts">
  import type { Action } from "cards-engine";
  import { groupActions, describeAction } from "../lib/actionGroups";
  import { selectAction } from "../lib/gameStore.svelte";

  interface Props {
    actions: Action[];
  }

  let { actions }: Props = $props();

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
  <h3 class="mb-2 text-sm font-semibold text-text-muted">
    Actions ({actions.length})
  </h3>
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
          {group.label}
          {#if group.actions.length > 1}
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
                {describeAction(action)}
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
