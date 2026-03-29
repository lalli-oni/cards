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

<div class="rounded-lg bg-stone-800 p-3">
  <h3 class="mb-2 text-sm font-semibold text-stone-400">
    Actions ({actions.length})
  </h3>
  <div class="space-y-1">
    {#each groups as group}
      <div>
        <button
          onclick={() => handleGroupClick(group.type, group.actions)}
          class="w-full rounded px-3 py-1.5 text-left text-sm transition-colors
            {expandedGroup === group.type
            ? 'bg-amber-800 text-amber-200'
            : 'bg-stone-700 text-stone-200 hover:bg-stone-600'}"
        >
          {group.label}
          {#if group.actions.length > 1}
            <span class="text-stone-400">({group.actions.length})</span>
          {/if}
        </button>

        {#if expandedGroup === group.type && group.actions.length > 1}
          <div class="ml-3 mt-1 space-y-1">
            {#each group.actions as action}
              <button
                onclick={() => handleActionClick(action)}
                class="w-full rounded px-3 py-1 text-left text-xs text-stone-300 bg-stone-700/50 hover:bg-stone-600"
              >
                {describeAction(action)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if actions.length === 0}
      <span class="text-sm text-stone-500 italic">No actions available</span>
    {/if}
  </div>
</div>
