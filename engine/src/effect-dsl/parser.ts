import { EmbeddedActionsParser } from "chevrotain";
import { allTokens, Ident, Int, LParen, RParen, LBrack, RBrack, Plus, Dot, Gt, Tilde, Colon } from "./tokens";
import { lexer } from "./tokens";
import type { Expression, Effect, Step, Primitive, Selector, Token } from "./types";

// ---------------------------------------------------------------------------
// Post-processing: raw chain segments → proper AST with consequences
// ---------------------------------------------------------------------------

interface ChainSegment {
  sep: ">" | ":";
  primitive: Primitive;
}

function buildEffect(first: Primitive, segments: ChainSegment[]): Effect {
  const steps: Step[] = [];
  let current: Step = { primitive: first };

  for (const seg of segments) {
    if (seg.sep === ":") {
      // Lose branch of ternary consequence
      if (current.consequence) {
        current.consequence.loseEffect = [{ primitive: seg.primitive }];
      } else {
        current.consequence = { winEffect: [], loseEffect: [{ primitive: seg.primitive }] };
      }
    } else if (current.primitive.verb === "contest" && !current.consequence) {
      // First ">" after a contest = win consequence
      current.consequence = { winEffect: [{ primitive: seg.primitive }] };
    } else {
      // Regular chain step
      steps.push(current);
      current = { primitive: seg.primitive };
    }
  }
  steps.push(current);
  return steps;
}

// ---------------------------------------------------------------------------
// Chevrotain parser — keeps rules flat and simple
// ---------------------------------------------------------------------------

class EffectDSLParser extends EmbeddedActionsParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  // expression = chainedEffect ("+" chainedEffect)*
  public expression = this.RULE("expression", (): Expression => {
    const effects: Effect[] = [this.SUBRULE(this.chainedEffect)];
    this.MANY(() => {
      this.CONSUME(Plus);
      effects.push(this.SUBRULE2(this.chainedEffect));
    });
    return effects;
  });

  // chainedEffect = primitive ((">" | ":") primitive)*
  // Flat parse — post-processed by buildEffect
  private chainedEffect = this.RULE("chainedEffect", (): Effect => {
    const first = this.SUBRULE(this.primitive);
    const segments: ChainSegment[] = [];
    this.MANY(() => {
      const sep = this.OR([
        { ALT: () => { this.CONSUME(Gt); return ">" as const; } },
        { ALT: () => { this.CONSUME(Colon); return ":" as const; } },
      ]);
      const prim = this.SUBRULE2(this.primitive);
      segments.push({ sep, primitive: prim });
    });
    return buildEffect(first, segments);
  });

  // primitive = verb ("." subVerb)? target? value? modifier*
  private primitive = this.RULE("primitive", (): Primitive => {
    const verb = this.CONSUME(Ident).image;
    let subVerb: string | undefined;
    this.OPTION(() => {
      this.CONSUME(Dot);
      subVerb = this.CONSUME2(Ident).image;
    });
    let target: Selector | undefined;
    this.OPTION2(() => {
      target = this.SUBRULE(this.target);
    });
    let value: number | undefined;
    this.OPTION3(() => {
      value = this.SUBRULE(this.value);
    });
    const modifiers: string[] = [];
    this.MANY2(() => {
      this.CONSUME(Tilde);
      modifiers.push(this.CONSUME3(Ident).image);
    });
    return { verb, subVerb, target, value, modifiers };
  });

  // target = "(" token ("+" token)* ")"
  private target = this.RULE("target", (): Selector => {
    this.CONSUME(LParen);
    const tokens: Token[] = [this.SUBRULE(this.token)];
    this.MANY(() => {
      this.CONSUME(Plus);
      tokens.push(this.SUBRULE2(this.token));
    });
    this.CONSUME(RParen);
    return { tokens };
  });

  // token = ident value?
  private token = this.RULE("token", (): Token => {
    const name = this.CONSUME(Ident).image;
    let count: number | undefined;
    this.OPTION(() => {
      count = this.SUBRULE(this.value);
    });
    return { name, count };
  });

  // value = "[" int "]"
  private value = this.RULE("value", (): number => {
    this.CONSUME(LBrack);
    const n = parseInt(this.CONSUME(Int).image, 10);
    this.CONSUME(RBrack);
    return n;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const parserInstance = new EffectDSLParser();

export class DSLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DSLParseError";
  }
}

export function parse(input: string): Expression {
  const { tokens, errors: lexErrors } = lexer.tokenize(input);
  if (lexErrors.length > 0) {
    throw new DSLParseError(`Lexer error in "${input}": ${lexErrors[0].message}`);
  }
  parserInstance.input = tokens;
  const ast = parserInstance.expression();
  if (parserInstance.errors.length > 0) {
    throw new DSLParseError(`Parse error in "${input}": ${parserInstance.errors[0].message}`);
  }
  return ast;
}
