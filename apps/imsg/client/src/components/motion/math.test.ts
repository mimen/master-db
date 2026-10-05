import { expect, test } from "bun:test";

import { digitPlaces, edgeSprings } from "./math";

test("the leading edge rides snappy and the trailing edge lazy, swapped by direction", () => {
  expect(edgeSprings(true)).toEqual({ left: "lazy", right: "snappy" });
  expect(edgeSprings(false)).toEqual({ left: "snappy", right: "lazy" });
});

test("digits keep their place-value key when the number grows a digit", () => {
  expect(digitPlaces(9)).toEqual([{ key: "d0", digit: 9 }]);
  expect(digitPlaces(10)).toEqual([{ key: "d1", digit: 1 }, { key: "d0", digit: 0 }]);
  expect(digitPlaces(-3)).toEqual([{ key: "d0", digit: 0 }]);
});
