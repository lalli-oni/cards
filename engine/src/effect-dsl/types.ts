/**
 * Effect DSL AST types.
 *
 * Expression = Effect[]  (compound: "+" joins parallel effects)
 * Effect     = Step[]    (chain: ">" pipes sequential steps)
 */

/** Top-level: one or more parallel effects joined by "+". */
export type Expression = readonly Effect[];

/** A chain of steps joined by ">". */
export type Effect = readonly Step[];

export interface Step {
  readonly primitive: Primitive;
  /** Ternary consequence — appears after ":" in a chain. */
  readonly consequence?: Consequence;
}

export interface Primitive {
  readonly verb: string;
  readonly subVerb?: string;
  readonly target?: Selector;
  readonly value?: number;
  readonly modifiers: readonly string[];
}

export interface Selector {
  readonly tokens: readonly Token[];
}

export interface Token {
  readonly name: string;
  readonly count?: number;
}

/** Win/lose branching for contests: `> winEffect : loseEffect` */
export interface Consequence {
  readonly winEffect: Effect;
  readonly loseEffect?: Effect;
}
