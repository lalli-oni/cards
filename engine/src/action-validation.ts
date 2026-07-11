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
const DEEP_VALIDATED_ACTION_TYPES: ReadonlySet<Action["type"]> = new Set<
  Action["type"]
>(["resolve_combat_round", "resolve_pick"]);

/**
 * Why an adapter-submitted action failed the legality gate. Distinguishing these
 * lets a rejection be logged with its cause instead of a bare "not legal":
 * - `type_not_offered`: no enumerated action of this type for the player to act
 *   (e.g. a `deploy` when only `pass`/`activate` are available).
 * - `wrong_player`: the type is offered, but the submitted `playerId` isn't the
 *   player to act — `getValidActions` enumerates only that player's actions, so
 *   this means the adapter addressed the action to the wrong player.
 * - `payload_mismatch`: a deep-validated decision action (see
 *   `DEEP_VALIDATED_ACTION_TYPES`) whose type+player are offered but whose
 *   decision payload isn't in the enumerated legal set (bad sit-out ids, wrong
 *   matchup pairs, an unoffered kind, …).
 */
export type ActionRejectionReason =
  | "type_not_offered"
  | "wrong_player"
  | "payload_mismatch";

/** Result of {@link checkActionLegality}: legal, or illegal with a reason. */
export type ActionLegality =
  | { legal: true }
  | { legal: false; reason: ActionRejectionReason };

/**
 * Legality check for an adapter-submitted action against the enumerated set,
 * returning *why* on rejection (see {@link ActionRejectionReason}).
 *
 * For exhaustively-enumerated decision actions (see above) legality is
 * structural membership of `action` in `validActions`, compared via canonical
 * keys. For everything else it falls back to the shallow type+playerId match.
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
export function checkActionLegality(
  action: Action,
  validActions: readonly Action[],
): ActionLegality {
  const typeMatches = validActions.filter((va) => va.type === action.type);
  if (typeMatches.length === 0) {
    return { legal: false, reason: "type_not_offered" };
  }
  if (!typeMatches.some((va) => va.playerId === action.playerId)) {
    return { legal: false, reason: "wrong_player" };
  }
  // Shallow types are legal on type+player alone — their payload is an
  // adapter-filled template, so applyAction remains the payload validator.
  if (!DEEP_VALIDATED_ACTION_TYPES.has(action.type)) {
    return { legal: true };
  }
  const key = canonicalActionKey(action);
  if (validActions.some((va) => canonicalActionKey(va) === key)) {
    return { legal: true };
  }
  return { legal: false, reason: "payload_mismatch" };
}

/** Boolean convenience wrapper over {@link checkActionLegality}. */
export function isLegalAction(
  action: Action,
  validActions: readonly Action[],
): boolean {
  return checkActionLegality(action, validActions).legal;
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
    // The `?? ""` guards the case where an element serializes to `undefined`
    // (a bare `undefined`/function element). Current deep-validated `Action`
    // payloads only hold string ids and plain pair objects, which always
    // stringify to a defined value — so the guard is defensive, not
    // load-bearing today.
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
