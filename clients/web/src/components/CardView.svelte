<script lang="ts">
  import type { Card } from "cards-engine";
  import { formatRequirements, parseRequirementParts } from "../lib/formatRequirements";

  interface Props {
    card: Card;
    highlighted?: boolean;
    onclick?: (card: Card) => void;
  }

  let { card, highlighted = false, onclick }: Props = $props();

  const typeEmoji: Record<string, string> = {
    unit: "👤",
    location: "📍",
    item: "🛡️",
    event: "⚡",
    policy: "📜",
  };

  const tooltip = $derived.by(() => {
    const lines = [`${card.name} (${card.type}) — Cost: ${card.cost}`];
    if (card.keywords && card.keywords.length > 0) {
      lines.push(`Keywords: ${card.keywords.join(", ")}`);
    }
    if (card.type === "unit") {
      if (card.attributes.length > 0) lines.push(`Attributes: ${card.attributes.join(", ")}`);
      lines.push(`Str:${card.strength} Cun:${card.cunning} Cha:${card.charisma}${card.injured ? " (injured)" : ""}`);
    } else if (card.type === "location") {
      if (card.requirements) lines.push(`Req: ${formatRequirements(card.requirements)}`);
      if (card.rewards) lines.push(`Rew: ${card.rewards}`);
      if (card.passive) lines.push(`Passive: ${card.passive}`);
    } else if (card.type === "item") {
      if (card.equip) lines.push(`Equip: ${card.equip}`);
      if (card.stored) lines.push(`Stored: ${card.stored}`);
    } else if (card.type === "event" && card.subtype === "trap") {
      lines.push(`Trigger: ${card.trigger}`);
    } else if (card.type === "policy") {
      lines.push(`Effect: ${card.effect}`);
    }
    if (card.text) lines.push(card.text);
    return lines.join("\n");
  });

  const attributeStr = $derived(
    card.type === "unit" && card.attributes.length > 0
      ? card.attributes.join(", ")
      : "",
  );
</script>

<button
  class="w-32 flex-shrink-0 rounded border p-2 text-left text-xs transition-colors
    {highlighted
    ? 'border-highlight-border bg-highlight-bg'
    : 'border-surface-hover bg-surface-raised hover:border-text-faint'}"
  title={tooltip}
  onclick={() => onclick?.(card)}
  disabled={!onclick}
>
  <div class="mb-1 flex items-center justify-between">
    <span class="truncate font-semibold text-text-primary">{card.name}</span>
    <span class="ml-1 text-gold">{card.cost}g</span>
  </div>
  <div class="flex items-center justify-between text-text-muted">
    <span>{typeEmoji[card.type] ?? card.type}</span>
    {#if card.type === "unit"}
      <span class="text-2xs">
        <span class="text-stat-strength">{card.strength}</span>/<span class="text-stat-cunning">{card.cunning}</span>/<span class="text-stat-charisma">{card.charisma}</span>
        {#if card.injured}🩹{/if}
      </span>
    {:else if card.type === "location"}
      <span class="text-2xs">{#if card.requirements}{#each parseRequirementParts(card.requirements) as part}<span class={part.className ?? ""}>{part.text}</span>{/each}{/if}</span>
    {/if}
  </div>
  {#if attributeStr}
    <div class="truncate text-2xs text-text-muted">{attributeStr}</div>
  {/if}
  {#if card.type === "item"}
    {#if card.equip}
      <div class="truncate text-2xs text-item-equipped">Equip: {card.equip}</div>
    {/if}
    {#if card.stored}
      <div class="truncate text-2xs text-text-faint">Stored: {card.stored}</div>
    {/if}
  {:else if card.type === "policy"}
    {#if card.effect}
      <div class="truncate text-2xs text-policy">{card.effect}</div>
    {/if}
  {/if}
  {#if card.keywords && card.keywords.length > 0}
    <div class="truncate text-2xs text-text-faint italic">{card.keywords.join(", ")}</div>
  {/if}
  {#if card.text}
    <div class="mt-1 truncate text-text-faint">{card.text}</div>
  {/if}
</button>
