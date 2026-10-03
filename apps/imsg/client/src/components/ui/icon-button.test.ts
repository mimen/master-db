import { expect, test } from "bun:test";

import type { IconButtonProps } from "./icon-button";

// Checked by `tsc`: an IconButton with no label does not compile.
// @ts-expect-error label is required
const unlabeled: IconButtonProps = { onPress: () => undefined, children: null };
const labeled: IconButtonProps = { label: "Search conversation", onPress: () => undefined, children: null };

test("IconButton props carry an accessible name", () => {
  expect(labeled.label).toBe("Search conversation");
  expect("label" in unlabeled).toBe(false);
});
