import type { VisibleState } from "cards-engine";

/**
 * Find a card's display name by instance ID from the visible state.
 * Searches: grid (locations, units, items), hand, HQ, active policies,
 * discard pile, removed-from-game, market, and opponent visible zones.
 */
export function findCardName(vs: VisibleState, cardId: string): string | undefined {
  // Grid: locations, units, items
  for (const row of vs.grid) {
    for (const cell of row) {
      if (cell.location?.id === cardId) return cell.location.name;
      for (const u of cell.units) {
        if (u.id === cardId) return u.name;
      }
      for (const i of cell.items) {
        if (i.id === cardId) return i.name;
      }
    }
  }

  // Self zones, market, opponent visible zones
  const zones = [
    vs.self.hand, vs.self.hq, vs.self.activePolicies,
    vs.self.discardPile, vs.self.removedFromGame,
    vs.market,
    ...vs.opponents.flatMap((opp) => [opp.hq, opp.activePolicies]),
  ];
  for (const zone of zones) {
    for (const c of zone) if (c.id === cardId) return c.name;
  }

  return undefined;
}
