/**
 * Anti-corruption layer between the engine's serializable-RNG model and
 * pure-rand v8's mutable primitives.
 *
 * The engine treats RNG as state-in/state-out: it stores `rngState: readonly
 * number[]` on `MainGameState`, reconstructs the generator on each use, and
 * passes generator instances around in `[value, nextRng]` tuples within an
 * action. Pure-rand v8 dropped this style in favor of in-place mutation.
 *
 * This module wraps v8's primitives to expose the v6-style immutable API the
 * engine was built on, at the cost of a generator clone per derived value.
 * Single source of truth — every engine and client RNG operation imports
 * from here, never from `pure-rand` directly.
 */
import {
  mersenne as _mersenne,
  mersenneFromState,
} from "pure-rand/generator/mersenne";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import type { RandomGenerator } from "pure-rand/types/RandomGenerator";

export type { RandomGenerator };

/** Seed a fresh Mersenne Twister generator. */
export function mersenne(seed: number): RandomGenerator {
  return _mersenne(seed);
}

/** Reconstruct a Mersenne Twister generator from a previously-extracted state. */
export function fromState(state: readonly number[]): RandomGenerator {
  return mersenneFromState(state);
}

/**
 * Draw a uniform integer in `[min, max]` (inclusive).
 *
 * Returns `[value, nextRng]` immutable-style — the input `rng` is not
 * mutated. Internally clones, applies v8's mutating `uniformInt`, and
 * returns the clone as the "next" generator.
 *
 * Arg order is intentionally v6-style `(min, max, rng)`; the wrapper insulates
 * ~14 engine and client call sites from pure-rand v8's `(rng, min, max)`.
 * Do not "fix" the order — flipping it would touch every caller.
 */
export function uniformIntDistribution(
  min: number,
  max: number,
  rng: RandomGenerator,
): [number, RandomGenerator] {
  const next = rng.clone();
  const value = uniformInt(next, min, max);
  return [value, next];
}

/** Fisher-Yates shuffle using an RNG. Returns shuffled array and next RNG state. */
export function shuffle<T>(
  array: readonly T[],
  rng: RandomGenerator,
): [T[], RandomGenerator] {
  const result = [...array];
  let currentRng = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, nextRng] = uniformIntDistribution(0, i, currentRng);
    currentRng = nextRng;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, currentRng];
}

/** Serialize RNG state to a JSON-safe array for storage on GameState. */
export function extractRngState(rng: RandomGenerator): readonly number[] {
  return rng.getState();
}

// ---------------------------------------------------------------------------
// Performance note for future high-throughput callers — SKETCH (not implemented)
// ---------------------------------------------------------------------------
//
// `uniformIntDistribution` and `shuffle` clone the input generator per call to
// preserve the engine's immutable RNG model. For typical gameplay this is
// trivial (a few rolls per turn). For balance testing / Monte Carlo workloads
// running thousands of games per second the clone tax dominates.
//
// When that need arrives, add a batch helper here that holds a live mutable
// generator across many operations and returns the final state at the end.
// Proposed signature (not real code — `withMutableGenerator` does not exist):
//
//   export function withMutableGenerator<T>(
//     initialState: readonly number[],
//     run: (rng: RandomGenerator) => T,
//   ): [T, readonly number[]] {
//     const rng = fromState(initialState);
//     const result = run(rng);
//     return [result, extractRngState(rng)];
//   }
//
// Inside `run`, the caller can use pure-rand's mutable primitives directly
// (uniformInt(rng, ...), rng.next(), etc.) without cloning. State extraction
// happens once at the end. Same wrapper boundary, faster inner loop.
//
// Caveat: on a thrown `run` the partial RNG advancement is lost. If callers
// need to persist progress even on partial failure, wrap the body in
// try/finally and call `extractRngState(rng)` from the finally block.
