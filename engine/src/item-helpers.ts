import type { BoardPosition, ItemCard, UnitCard } from "./types";

/**
 * Who controls an item right now.
 *
 * Players control units, not items, so an item's side is derived from where it
 * sits rather than stored on the card:
 *
 *   - equipped  → its bearer's controller, so a bought, stolen or mind-controlled
 *                 unit brings its gear with it (`rules/README.md:308`)
 *   - HQ        → the HQ's player; a private zone has no ground to lie on
 *   - grid, unattached → nobody. A stored item is exposed to any co-located unit
 *                 (`rules/README.md:419`), so claiming a side for it would be the
 *                 thing that lets its last carrier keep using it.
 *
 * `unitsHere` is the units sharing the item's place — an equipped item is always
 * co-located with its bearer, so no board-wide scan is needed. A bearer missing
 * from that list means the attachment is stale, which reads the same as loose.
 */
export function itemController(
  item: ItemCard,
  position: BoardPosition,
  unitsHere: readonly UnitCard[],
): string | undefined {
  if (item.equippedTo) {
    return unitsHere.find((u) => u.id === item.equippedTo)?.controllerId;
  }
  return position.type === "hq" ? position.playerId : undefined;
}
