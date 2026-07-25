import { describe, expect, test } from "bun:test";

import { INPUT_BORDER_W, INPUT_PADDING_H, MIRROR_INSET_H } from "./composer-metrics";

describe("composer metrics", () => {
  test("the mirror inset accounts for the border, not just the padding", () => {
    // The regression: the mirror was inset by the padding alone, making it 2px
    // wider than the input's text area. Text that wrapped in the input fit on
    // one line in the mirror, so the input never grew and the wrapped line was
    // invisible until the message was sent.
    expect(MIRROR_INSET_H).toBe(INPUT_PADDING_H + INPUT_BORDER_W);
    expect(MIRROR_INSET_H).toBeGreaterThan(INPUT_PADDING_H);
  });
});
