// Runtime semantics for the governed keyword vocabulary (`keywords.ts`).
// Converts a card's `keywords` tokens into the same `{listeners, queries}`
// shape the hand-written `*_EFFECTS` factories in `listeners/effects.ts`
// produce, so `rebuildListeners` can treat a keyword exactly like a bespoke
// effect. One-way dependency: this file imports from `keywords.ts`, never
// the reverse — `keywords.ts` stays a pure vocabulary/grammar module with no
// engine-state imports.
//
// Bad data at runtime: `parseKeyword` throws `KeywordError` on a malformed
// token. The library build runs the same parser over every card, so a real
// card that builds cannot reach this; hand-built fixtures bypass that gate. We
// let it throw rather than skip — a silently-inert keyword reads as doing
// something and does nothing, which is worse than a loud failure (see
// `mission-helpers.ts`'s parse-error precedent).

import type { CardType, ItemCard, LocationCard, MainGameState, UnitCard } from "./types";
import { isItemAction } from "./types";
import {
  asFamily,
  type FamilyParams,
  findKeywordToken,
  KeywordError,
  type KeywordName,
  parseKeyword,
  type ParsedKeyword,
  requireMagnitude,
  requireStat,
} from "./keywords";
import type {
  APModifierListener,
  CostModifierListener,
  EffectDefinition,
  EffectListener,
  EffectSource,
  QueryListener,
  StatModifierListener,
  StatQueryContext,
} from "./listeners/types";
import { getModifiedStat } from "./listeners/query";

/** Case-insensitive "do these two cards share at least one attribute" check —
 *  like `hasAttribute`, but both sides may be any card type (optional
 *  `attributes`), which `hasAttribute`'s required-`attributes` signature
 *  doesn't accept. */
function sharesAttribute(a: { attributes?: string[] }, b: { attributes?: string[] }): boolean {
  const attrsB: string[] = (b.attributes ?? []).map((x) => x.toLowerCase());
  return (a.attributes ?? []).some((x) => attrsB.includes(x.toLowerCase()));
}

export type KeywordCard = UnitCard | LocationCard | ItemCard;

/** Keywords resolved via a direct hook/helper rather than a `keywordEffects`
 *  switch case, because none fit the query/listener shape: Berserker and Loot
 *  hook apply-main.ts's combat resolution (via `hasKeyword`); Untouchable
 *  needs the full committed-attacker list and Flying is a boolean edge-bypass,
 *  so both are the helpers at the bottom of this file, called directly from
 *  valid-actions.ts and apply-main.ts.
 *
 *  Exported so test/build.test.ts's exhaustiveness check can tell
 *  "intentionally a direct hook" apart from "forgotten case". That test also
 *  pins this list's exact contents — adding a name here is not a way to make a
 *  keyword pass the check without implementing it. */
export const DIRECT_HOOK_KEYWORDS: readonly KeywordName[] = ["Berserker", "Loot", "Untouchable", "Flying"];

// Keyed by the full parameterized token, so the entry count is the number of
// distinct tokens in the loaded library — small by construction, and it never
// grows during a game. Values are frozen because one parsed object is shared
// by every card carrying the token and is captured in long-lived closures.
const parsedCache = new Map<string, Readonly<ParsedKeyword>>();

function parseCached(token: string, cardType: CardType): Readonly<ParsedKeyword> {
  const key: string = `${cardType}|${token}`;
  const cached: Readonly<ParsedKeyword> | undefined = parsedCache.get(key);
  if (cached) return cached;
  const parsed: Readonly<ParsedKeyword> = Object.freeze(parseKeyword(token, cardType));
  parsedCache.set(key, parsed);
  return parsed;
}

/** Does `card` carry the governed keyword `name` (ignoring its params)? */
export function hasKeyword(card: { keywords?: string[] }, name: KeywordName): boolean {
  return findKeywordToken(card, name) !== undefined;
}

// ---------------------------------------------------------------------------
// Modifier families (Prowess, Kindred, Leader, Aura) — shared machinery
// ---------------------------------------------------------------------------

function contextAndRoleMatch(parsed: FamilyParams, ctx: StatQueryContext): boolean {
  switch (parsed.context) {
    case "mission":
      return ctx.mission === true;
    case "contest": {
      if (!ctx.contest) return false;
      if (!parsed.role || parsed.role === "either") return true;
      const wantRole: "attacker" | "defender" = parsed.role === "atk" ? "attacker" : "defender";
      return ctx.contest.role === wantRole;
    }
    default: {
      // A context value the grammar grew without a rule here would otherwise
      // fall through and silently behave as a contest buff.
      const unreachable: never = parsed.context;
      throw new KeywordError(`unhandled keyword context: ${String(unreachable)}`);
    }
  }
}

/** Builds the shared `StatModifierListener` for a family token — stat-scope
 *  and context/role gating are identical across all four families; `matches`
 *  supplies the one thing that differs, who is affected. */
function buildFamilyModifier(
  source: EffectSource,
  parsed: FamilyParams,
  matches: (ctx: StatQueryContext) => boolean,
): StatModifierListener {
  return {
    source,
    query: "stat",
    modify: (_state, ctx) => {
      if (parsed.statScope !== "all" && parsed.statScope !== ctx.stat) return 0;
      if (!contextAndRoleMatch(parsed, ctx)) return 0;
      if (!matches(ctx)) return 0;
      return parsed.signedMagnitude;
    },
  } satisfies StatModifierListener;
}

/**
 * Derive a card's keyword-driven listeners and queries. Called by
 * `rebuildListeners` for locations, units and items on the grid, and for units
 * and items in HQ — in addition to, not instead of, the `definitionId`
 * registry lookup, so a card can carry both a bespoke effect factory and
 * keywords. Cards in hand, market and discard are never visited.
 *
 * `position` is absent for HQ cards. Positional keywords (Leader, Kindred,
 * Aura) key off it and contribute no queries when it's absent; the rest apply
 * anywhere in play, HQ included.
 */
export function keywordEffects(
  card: KeywordCard,
  controllerId: string,
  position?: { row: number; col: number },
): EffectDefinition {
  const listeners: EffectListener[] = [];
  const queries: QueryListener[] = [];

  for (const token of card.keywords ?? []) {
    // Re-thrown with the card identity: rebuildListeners runs on every state
    // read, so an unqualified parse error leaves an operator with nothing but
    // a grep across the library CSVs.
    let parsed: Readonly<ParsedKeyword>;
    try {
      parsed = parseCached(token, card.type);
    } catch (e) {
      if (!(e instanceof KeywordError)) throw e;
      throw new KeywordError(
        `card "${card.definitionId}" (${card.id}), keywords token "${token}": ${e.message}`,
      );
    }
    const source: EffectSource = {
      type: card.type,
      cardId: card.id,
      definitionId: card.definitionId,
      controllerId,
      position,
    };

    switch (parsed.name) {
      // ---- Modifier families -------------------------------------------
      // Prowess alone needs no position gate: its `matches` is self-identity,
      // which is position-independent.
      case "Prowess": {
        queries.push(buildFamilyModifier(source, asFamily(parsed), (ctx) => ctx.unit.id === card.id));
        break;
      }

      case "Kindred": {
        // Positional gating: only applies while the source is on the grid.
        if (position === undefined) break;
        if (card.type !== "unit") break;
        const sourceUnit: UnitCard = card;
        queries.push(
          // Excludes the source itself — contrast with Leader, which includes it.
          buildFamilyModifier(source, asFamily(parsed), (ctx) =>
            ctx.unit.id !== sourceUnit.id
            && ctx.unit.controllerId === controllerId
            && sharesAttribute(sourceUnit, ctx.unit)),
        );
        break;
      }

      case "Leader": {
        // Positional gating: only applies while the source is on the grid.
        if (position === undefined) break;
        const sourcePos: { row: number; col: number } = position;
        queries.push(
          // Includes the source itself — contrast with Kindred, which excludes it.
          buildFamilyModifier(source, asFamily(parsed), (ctx) =>
            ctx.unit.controllerId === controllerId
            && ctx.position?.row === sourcePos.row && ctx.position?.col === sourcePos.col),
        );
        break;
      }

      case "Aura": {
        // Locations are always on the grid, but guard defensively anyway.
        if (position === undefined) break;
        const sourcePos: { row: number; col: number } = position;
        queries.push(
          buildFamilyModifier(source, asFamily(parsed), (ctx) =>
            ctx.position?.row === sourcePos.row && ctx.position?.col === sourcePos.col),
        );
        break;
      }

      // ---- Cost / AP standalones -----------------------------------------
      case "Patron": {
        if (card.type !== "unit") break;
        const sourceUnit: UnitCard = card;
        const amount: number = requireMagnitude(parsed);
        queries.push({
          source,
          query: "cost",
          // No `min` declared — getModifiedCost's floor stays at 0 unless
          // another cost modifier raises it.
          modify: (_state, ctx) => {
            if (ctx.playerId !== controllerId) return 0;
            if (!sharesAttribute(sourceUnit, ctx.card)) return 0;
            return -amount;
          },
        } satisfies CostModifierListener);
        break;
      }

      case "Squire": {
        // ParamSpec.default is display-only (renderer prose) — the engine
        // supplies the omitted-arg fallback itself.
        const amount: number = parsed.magnitude ?? 1;
        queries.push({
          source,
          query: "ap",
          modify: (_state, ctx) => {
            if (ctx.playerId !== controllerId) return 0;
            // Discounts the concept rather than one verb, matching the wording
            // in rules/README.md → Unit keywords.
            if (!isItemAction(ctx.action)) return 0;
            return -amount;
          },
        } satisfies APModifierListener);
        break;
      }

      case "Heavy":
      case "Lightweight": {
        if (card.type !== "item") break;
        const item: ItemCard = card;
        const delta: number = parsed.name === "Heavy" ? 1 : -1;
        queries.push({
          source,
          query: "ap",
          modify: (_state, ctx) => {
            if (ctx.action.type !== "move") return 0;
            if (!item.equippedTo || ctx.action.unitId !== item.equippedTo) return 0;
            return delta;
          },
        } satisfies APModifierListener);
        break;
      }

      // Berserker/Loot/Untouchable/Flying are direct hooks; see
      // DIRECT_HOOK_KEYWORDS.
      default:
        break;
    }
  }

  return { listeners, queries };
}

// ---------------------------------------------------------------------------
// Legality-gated standalones (Untouchable, Flying) — see DIRECT_HOOK_KEYWORDS
// for why these are helpers rather than switch cases.
// ---------------------------------------------------------------------------

/**
 * Is `defender` shielded from an Attack committing `attackers`? Shielded only
 * if its (modified) Untouchable stat exceeds EVERY committed attacker's
 * (modified) same stat — i.e. exceeds the max. Both sides are read with the
 * same contest role/position, so `context:contest` buffs (Leader, Prowess, ...)
 * apply symmetrically to attacker and defender.
 *
 * Note the Untouchable stat need not be the `strength` combat actually rolls —
 * v0.1's Untouchable cards all name `charisma` — so this is a gate on the
 * declaration, not a preview of the roll. Evaluated once, when the Attack is
 * declared; not re-checked between combat rounds.
 */
export function isAttackShielded(
  state: MainGameState,
  queries: QueryListener[],
  defender: UnitCard,
  position: { row: number; col: number },
  attackers: readonly [UnitCard, ...UnitCard[]],
): boolean {
  const token: string | undefined = findKeywordToken(defender, "Untouchable");
  if (!token) return false;
  const stat = requireStat(parseCached(token, "unit"));
  const defenderStat: number = getModifiedStat(
    state, queries, defender, stat, position,
    { contest: { role: "defender", row: position.row, col: position.col } },
  );
  return attackers.every((attacker) => {
    const attackerStat: number = getModifiedStat(
      state, queries, attacker, stat, position,
      { contest: { role: "attacker", row: position.row, col: position.col } },
    );
    return defenderStat > attackerStat;
  });
}

/** Does `unitId` have a Flying item equipped to it at `cell`? Flying bypasses
 *  only the edge-facing check — the destination must still have a location
 *  and be orthogonally adjacent; callers enforce those separately. */
export function unitIgnoresBlockedEdges(cell: { items: ItemCard[] }, unitId: string): boolean {
  return cell.items.some((item) => item.equippedTo === unitId && hasKeyword(item, "Flying"));
}
