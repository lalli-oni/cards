import type { VisibleState } from "cards-engine";

/**
 * Find a card's display name by instance ID from the visible state.
 * Searches grid (locations, units, items), market, hand, HQ, and policies.
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

  // Self zones
  for (const c of vs.self.hand) if (c.id === cardId) return c.name;
  for (const c of vs.self.hq) if (c.id === cardId) return c.name;
  for (const c of vs.self.activePolicies) if (c.id === cardId) return c.name;
  for (const c of vs.self.discardPile) if (c.id === cardId) return c.name;
  for (const c of vs.self.removedFromGame) if (c.id === cardId) return c.name;

  // Market
  for (const c of vs.market) if (c.id === cardId) return c.name;

  // Opponent HQ and policies (visible)
  for (const opp of vs.opponents) {
    for (const c of opp.hq) if (c.id === cardId) return c.name;
    for (const c of opp.activePolicies) if (c.id === cardId) return c.name;
  }

  return undefined;
}
