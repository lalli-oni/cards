/**
 * Effect DSL AST types.
 *
 * Expression = Effect[]  (compound: "+" joins parallel effects)
 * Effect     = Step[]    (chain: ">" pipes sequential steps)
 */

/** Top-level: one or more parallel effects joined by "+". */
export type Expression = Effect[];

/** A chain of steps joined by ">". */
export type Effect = Step[];

export interface Step {
  primitive: Primitive;
  /** Ternary consequence — appears after ":" in a chain. */
  consequence?: Consequence;
}

export interface Primitive {
  verb: string;
  subVerb?: string;
  target?: Selector;
  value?: number;
  modifiers: string[];
}

export interface Selector {
  tokens: Token[];
}

export interface Token {
  name: string;
  count?: number;
}

/** Win/lose branching for contests: `> winEffect : loseEffect` */
export interface Consequence {
  winEffect: Effect;
  loseEffect?: Effect;
}
