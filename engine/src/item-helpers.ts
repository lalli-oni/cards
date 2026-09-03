import type { BoardPosition, ItemCard, UnitCard } from "./types";

/**
 * Who controls an item right now.
 *
 * Players control units, not items, so an item's side is derived from where it
 * sits rather than stored on the card:
 *
 *   - equipped         → its bearer's controller, so a bought, stolen or
 *                         mind-controlled unit brings its gear with it
 *                         (rules/README.md → Unit status → Controlled)
 *   - HQ, unattached    → the HQ's player; a private zone has no ground to lie on
 *   - grid, unattached  → nobody. A stored item is exposed to any co-located unit
 *                         (rules/README.md → Items → Stored), so claiming a side
 *                         for it would be the thing that lets its last carrier
 *                         keep using it.
 *
 * `unitsHere` is the units sharing the item's place — an equipped item is always
 * co-located with its bearer (every unit-removal or -movement path drops or
 * carries equipped items with the unit: killUnit, raze, mission completion,
 * move, retreat), so no board-wide scan is needed. A bearer missing from that
 * list means the attachment is stale — in HQ this still resolves, since a
 * private zone is unambiguously its own player's regardless of who last held
 * the item; on the grid it has no such fallback and reads as loose, same as
 * an item that was never equipped.
 */
export function itemController(
  item: ItemCard,
  position: BoardPosition,
  unitsHere: readonly UnitCard[],
): string | undefined {
  if (item.equippedTo) {
    const bearer = unitsHere.find((u) => u.id === item.equippedTo);
    if (bearer) return bearer.controllerId;
  }
  return position.type === "hq" ? position.playerId : undefined;
}
