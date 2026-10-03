/**
 * Returns a gate that opens once per burst: the first call fires, and calls
 * keep it shut until `quietMs` passes with no further call.
 */
export function burstGate(quietMs: number, now: () => number = Date.now): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    const fire = at - last >= quietMs;
    last = at;
    return fire;
  };
}
