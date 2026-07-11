/**
 * Pure helpers for the engine-rejection recovery contract (#182), extracted so
 * the fragile invariants can be unit-tested — the reactive `gameStore.svelte.ts`
 * store and the `.svelte` overlays can't be imported under `bun test` (runes
 * need Svelte compilation).
 */

/**
 * Append `message` to the current error banner, newline-separated, deduping a
 * consecutive identical trailing message.
 *
 * The rejection re-prompt pushes the same "choose again" line on every rejected
 * submission; without the dedupe a broken client / enumerator desync would grow
 * the banner to ~100 identical lines before the loop's give-up backstop trips.
 * Only the *trailing* segment is compared, so distinct interleaved warnings
 * still accumulate.
 */
export function appendBanner(
  current: string | null,
  message: string,
): string {
  if (!current) return message;
  const segments = current.split("\n");
  if (segments[segments.length - 1] === message) return current;
  return `${current}\n${message}`;
}

/**
 * Whether a combat/pick overlay should re-enable its Confirm button after a
 * submit. True exactly when the overlay is mid-submit AND the monotonic
 * rejection nonce has advanced past the value captured at submit time — i.e.
 * the engine rejected *this* submission.
 *
 * Keying off the nonce (not the error-banner string) means an unrelated banner
 * change can neither spuriously unlock Confirm nor, if two rejection messages
 * happened to be identical, leave it permanently stuck.
 */
export function shouldReenableAfterRejection(
  submitted: boolean,
  currentNonce: number,
  nonceAtSubmit: number,
): boolean {
  return submitted && currentNonce !== nonceAtSubmit;
}
