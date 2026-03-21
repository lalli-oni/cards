import prand from "pure-rand";

/** Fisher-Yates shuffle using an RNG. Returns shuffled array and next RNG state. */
export function shuffle<T>(
  array: T[],
  rng: prand.RandomGenerator,
): [T[], prand.RandomGenerator] {
  const result = [...array];
  let currentRng = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, nextRng] = prand.uniformIntDistribution(0, i, currentRng);
    currentRng = nextRng;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, currentRng];
}

/** Serialize RNG state to a JSON-safe array for storage on GameState. */
export function extractRngState(rng: prand.RandomGenerator): readonly number[] {
  const state = rng.getState?.();
  if (!state) {
    throw new Error("RNG generator does not support getState()");
  }
  return state;
}
