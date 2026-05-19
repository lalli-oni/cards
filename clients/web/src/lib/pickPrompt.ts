import type { Card, PickPrompt } from "cards-engine";

/**
 * Result of resolving a `PickPrompt`'s option ids against the viewer's `mainDeck`.
 *
 * Discriminated by `ok`: when the engine invariant holds (every option id is
 * findable in `mainDeck`), `ok` is `true` and `found` holds the resolved cards
 * in `prompt.options` order. When the invariant breaks (out-of-band deck
 * mutation, engine/client desync), `ok` is `false` and `missing` lists the
 * unresolved ids. The failure arm intentionally omits `found` so callers
 * cannot silently render a partial result by skipping the discriminant.
 */
export type PickPromptResolution =
  | { readonly ok: true; readonly found: readonly Card[] }
  | { readonly ok: false; readonly missing: readonly [string, ...string[]] };

/**
 * Resolve a `PickPrompt`'s option ids against the viewer's `mainDeck`.
 *
 * Order of `found` matches the order of `prompt.options` (not `mainDeck`).
 * Caller must guard against `prompt === undefined` before calling.
 */
export function resolvePickOptions(
  prompt: PickPrompt,
  mainDeck: readonly Card[],
): PickPromptResolution {
  const found: Card[] = [];
  const missing: string[] = [];
  for (const id of prompt.options) {
    const card = mainDeck.find((c) => c.id === id);
    if (card) found.push(card);
    else missing.push(id);
  }
  const [head, ...rest] = missing;
  if (head === undefined) return { ok: true, found };
  return { ok: false, missing: [head, ...rest] };
}

/**
 * Toggle membership of `cardId` in `selected`, capped at `count`.
 *
 * When at the cap and adding a new id, the oldest selection (by insertion
 * order) is evicted FIFO so users can re-pick freely without manually
 * deselecting first.
 *
 * Throws on non-positive or non-integer `count`. `PickPrompt.count` is
 * guaranteed `>= 1` by the DSL validator and the `execPick` prompt-creation
 * branch; this throw is purely defensive against caller bugs.
 */
export function togglePickSelection(
  selected: ReadonlySet<string>,
  cardId: string,
  count: number,
): ReadonlySet<string> {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`togglePickSelection: count must be a positive integer (got ${count})`);
  }
  const next = new Set(selected);
  if (next.has(cardId)) {
    next.delete(cardId);
    return next;
  }
  if (next.size >= count) {
    const oldest = next.values().next().value;
    if (oldest === undefined) {
      throw new Error("togglePickSelection: set unexpectedly empty at cap");
    }
    next.delete(oldest);
  }
  next.add(cardId);
  return next;
}
