import type { Action } from "./types";

/**
 * Action types whose `getValidActions` enumeration is *exhaustive* — every legal
 * payload is listed, with no player-filled fields left blank — so legality
 * reduces to structural membership and we can deep-validate the whole payload.
 *
 * Deliberately narrow (#182): these are the two decision actions the ticket
 * targets. Other actions carry template fields the enumeration leaves for the
 * adapter to fill (`seed_keep`'s keepIds/exposeIds, the optional `rotation` on
 * `seed_steal` / `seed_place_location` / `raze`), so a deep-equal against the
 * enumerated template would wrongly reject a legitimately-filled submission.
 * Those keep the shallow type+playerId check (unchanged behavior); applyAction
 * remains their payload validator.
 */
const DEEP_VALIDATED_ACTION_TYPES: ReadonlySet<string> = new Set([
  "resolve_combat_round",
  "resolve_pick",
]);

/**
 * Legality check for an adapter-submitted action against the enumerated set.
 *
 * For exhaustively-enumerated decision actions (see above) this is structural
 * membership of `action` in `validActions`, compared via canonical keys. For
 * everything else it falls back to the shallow type+playerId match.
 *
 * Order-insensitivity: the canonical key sorts every array, because several
 * payloads are set-semantic and the client builds them in a different order
 * than the enumerator emits — e.g. `sit_out.sitOutUnitIds` (click order vs.
 * power-ascending), `deck_pick` `resolve_pick.pickedCardIds`, and
 * `assign_matchups.pairs` (a bijection is a *set* of pairs). Sorting is safe
 * against false-accepts: the only payload where element order carries legal
 * meaning is `scholar_reorder` (a `resolve_pick` whose submission order *is*
 * the outcome), and there `getValidActions` enumerates the entire permutation
 * orbit as legal — so collapsing orderings can never admit an illegal action.
 * Sorting collapses *permutations* only, never subsets, so a submitted subset
 * of a larger enumerated set still fails to match.
 */
export function isLegalAction(
  action: Action,
  validActions: readonly Action[],
): boolean {
  if (!DEEP_VALIDATED_ACTION_TYPES.has(action.type)) {
    return validActions.some(
      (va) => va.type === action.type && va.playerId === action.playerId,
    );
  }
  const key = canonicalActionKey(action);
  return validActions.some((va) => canonicalActionKey(va) === key);
}

/**
 * A stable, order-insensitive string key for an action. Two actions share a key
 * iff they are structurally equal up to array ordering and object key ordering.
 * Exported for direct testing.
 */
export function canonicalActionKey(action: Action): string {
  return JSON.stringify(canonicalize(action));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => {
      const sa = JSON.stringify(a) ?? "";
      const sb = JSON.stringify(b) ?? "";
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    // Sort keys so object field order can't affect the key. Drop `undefined`
    // values so an explicit `costIndex: undefined` matches an omitted one.
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}
