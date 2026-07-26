export type ByteRangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "invalid" }
  | { kind: "unsatisfiable" };

function parseIndex(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Resolves one HTTP bytes range to inclusive bounds for a known representation size. */
export function parseByteRange(header: string | null, size: number): ByteRangeResult {
  if (header === null) return { kind: "full" };
  if (!Number.isSafeInteger(size) || size < 0) return { kind: "invalid" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "invalid" };

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return { kind: "invalid" };
  if (size === 0) return { kind: "unsatisfiable" };

  if (!startText) {
    const suffixLength = parseIndex(endText);
    if (suffixLength === null) return { kind: "invalid" };
    if (suffixLength === 0) return { kind: "unsatisfiable" };
    return {
      kind: "partial",
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = parseIndex(startText);
  if (start === null) return { kind: "invalid" };
  if (start >= size) return { kind: "unsatisfiable" };

  if (!endText) return { kind: "partial", start, end: size - 1 };

  const requestedEnd = parseIndex(endText);
  if (requestedEnd === null) return { kind: "invalid" };
  if (requestedEnd < start) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(requestedEnd, size - 1) };
}
