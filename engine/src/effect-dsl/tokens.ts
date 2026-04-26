import { createToken, Lexer } from "chevrotain";

export const Ident = createToken({ name: "Ident", pattern: /[a-zA-Z_][a-zA-Z0-9_]*/ });
export const Int = createToken({ name: "Int", pattern: /-?[0-9]+/, longer_alt: Ident });
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const LBrack = createToken({ name: "LBrack", pattern: /\[/ });
export const RBrack = createToken({ name: "RBrack", pattern: /\]/ });
export const Plus = createToken({ name: "Plus", pattern: /\+/ });
export const Dot = createToken({ name: "Dot", pattern: /\./ });
export const Gt = createToken({ name: "Gt", pattern: />/ });
export const Tilde = createToken({ name: "Tilde", pattern: /~/ });
export const Colon = createToken({ name: "Colon", pattern: /:/ });
export const WS = createToken({ name: "WS", pattern: /\s+/, group: Lexer.SKIPPED });

export const allTokens = [WS, Int, Ident, LParen, RParen, LBrack, RBrack, Plus, Dot, Gt, Tilde, Colon];
export const lexer = new Lexer(allTokens);
