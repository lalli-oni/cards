import type { Card, PickPrompt } from "cards-engine";

export interface PickPromptResolution {
  /** Cards corresponding to `prompt.options` ids, in the order given. */
  cards: Card[];
  /** Option ids that could not be resolved against `mainDeck`. */
  missingIds: string[];
}

/**
 * Resolve a `PickPrompt`'s option ids against the viewer's `mainDeck`.
 *
 * Engine invariant: every option id is in `mainDeck` while the prompt is
 * set. Returning `missingIds` lets the caller surface invariant
 * violations loudly instead of silently dropping cards.
 */
export function resolvePickOptions(
  prompt: PickPrompt | undefined,
  mainDeck: readonly Card[],
): PickPromptResolution {
  if (!prompt) return { cards: [], missingIds: [] };
  const cards: Card[] = [];
  const missingIds: string[] = [];
  for (const id of prompt.options) {
    const found = mainDeck.find((c) => c.id === id);
    if (found) cards.push(found);
    else missingIds.push(id);
  }
  return { cards, missingIds };
}

/**
 * Toggle membership of `cardId` in `selected`, capped at `count`.
 *
 * When at the cap and adding a new id, the oldest selection (by insertion
 * order) is evicted FIFO so users can re-pick freely without manually
 * deselecting first.
 */
export function togglePickSelection(
  selected: ReadonlySet<string>,
  cardId: string,
  count: number,
): Set<string> {
  const next = new Set(selected);
  if (next.has(cardId)) {
    next.delete(cardId);
    return next;
  }
  if (next.size >= count) {
    const oldest = next.values().next().value;
    if (oldest !== undefined) next.delete(oldest);
  }
  next.add(cardId);
  return next;
}
