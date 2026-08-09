// Runtime semantics for the governed keyword vocabulary (`keywords.ts`).
// Converts a card's `keywords` tokens into the same `{listeners, queries}`
// shape the hand-written `*_EFFECTS` factories in `listeners/effects.ts`
// produce, so `rebuildListeners` can treat a keyword exactly like a bespoke
// effect. One-way dependency: this file imports from `keywords.ts`, never
// the reverse — `keywords.ts` stays a pure vocabulary/grammar module with no
// engine-state imports.
//
// Bad data at runtime: `parseKeyword` throws `KeywordError` on a malformed
// token. The library build guarantees validity for real cards; hand-built
// fixtures bypass that guarantee. We let it throw rather than skip — a
// silently-inert keyword reads as doing something and does nothing, which is
// worse than a loud failure (see `mission-helpers.ts`'s parse-error precedent).

import type { CardType, ItemCard, LocationCard, UnitCard } from "./types";
import { parseKeyword, type ParsedKeyword } from "./keywords";
import type { EffectDefinition, EffectListener, EffectSource, QueryListener } from "./listeners/types";

export type KeywordCard = UnitCard | LocationCard | ItemCard;

// Tokens are a closed, tiny vocabulary, so this cache is bounded by
// KEYWORDS.length — no eviction needed.
const parsedCache = new Map<string, ParsedKeyword>();

function parseCached(token: string, cardType: CardType): ParsedKeyword {
  const key = `${cardType}|${token}`;
  const cached = parsedCache.get(key);
  if (cached) return cached;
  const parsed = parseKeyword(token, cardType);
  parsedCache.set(key, parsed);
  return parsed;
}

/** Does `card` carry the governed keyword `name` (ignoring its params)? */
export function hasKeyword(card: { keywords?: string[] }, name: string): boolean {
  return (card.keywords ?? []).some((token) => token.split(":")[0] === name);
}

/**
 * Derive a card's keyword-driven listeners and queries. Called by
 * `rebuildListeners` for every location, unit, and item it visits (grid and
 * HQ alike) — in addition to, not instead of, the `definitionId` registry
 * lookup, so a card can carry both a bespoke effect factory and keywords.
 *
 * `position` is absent for HQ cards. Positional keywords (Leader, Kindred,
 * Aura) key off it and simply contribute no queries when it's absent;
 * "while in play" keywords (Patron, Squire) don't need it at all.
 */
export function keywordEffects(
  card: KeywordCard,
  controllerId: string,
  position?: { row: number; col: number },
): EffectDefinition {
  const listeners: EffectListener[] = [];
  const queries: QueryListener[] = [];

  for (const token of card.keywords ?? []) {
    const parsed = parseCached(token, card.type);
    const source: EffectSource = {
      type: card.type,
      cardId: card.id,
      definitionId: card.definitionId,
      controllerId,
      position,
    };

    switch (parsed.name) {
      default:
        // Phases 1-4 add cases here as each keyword is wired. An unhandled
        // governed name is caught by test/build.test.ts's exhaustiveness
        // check, not silently ignored.
        break;
    }
  }

  return { listeners, queries };
}
