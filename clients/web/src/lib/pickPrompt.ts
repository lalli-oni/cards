import type { Card, PickPrompt } from "cards-engine";

/**
 * Result of resolving a `PickPrompt`'s option ids against the viewer's `mainDeck`.
 *
 * Discriminated by `ok`: when the engine invariant holds (every option id is
 * findable in `mainDeck`), `ok` is `true` and the caller can render `found`.
 * When the invariant breaks (out-of-band deck mutation, engine/client desync),
 * `ok` is `false`, `missing` lists the unresolved ids, and `found` carries
 * whatever was resolvable. Callers should surface the broken state — not
 * silently render the partial result.
 */
export type PickPromptResolution =
  | { readonly ok: true; readonly found: readonly Card[] }
  | {
      readonly ok: false;
      readonly found: readonly Card[];
      readonly missing: readonly [string, ...string[]];
    };

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
  if (missing.length === 0) return { ok: true, found };
  return { ok: false, found, missing: missing as [string, ...string[]] };
}

/**
 * Toggle membership of `cardId` in `selected`, capped at `count`.
 *
 * When at the cap and adding a new id, the oldest selection (by insertion
 * order) is evicted FIFO so users can re-pick freely without manually
 * deselecting first.
 *
 * Throws on non-positive integer `count` — the engine validator enforces
 * `count >= 1` for `PickPrompt`, so this is defensive against caller bugs.
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
    if (oldest !== undefined) next.delete(oldest);
  }
  next.add(cardId);
  return next;
}
