import { expect, test } from "bun:test";

import { gated, reasonOf } from "./route-support";

test("a supported action stays live, an unsupported one greys with its reason, an absent one goes", () => {
  const onPress = () => undefined;
  expect(gated({ ok: true }, { label: "Edit", onPress })).toEqual([{ label: "Edit", onPress }]);
  const [greyed] = gated({ ok: false, reason: "SMS can't edit messages" }, { label: "Edit", destructive: true, onPress });
  expect(greyed).toMatchObject({ label: "Edit", destructive: true, disabled: true, note: "SMS can't edit messages" });
  expect(greyed?.onPress).not.toBe(onPress);
  expect(gated(null, { label: "Leave", onPress })).toEqual([]);
});

test("only a greyed feature has a reason", () => {
  expect(reasonOf({ ok: false, reason: "SMS can't send reactions" })).toBe("SMS can't send reactions");
  expect(reasonOf({ ok: true })).toBeUndefined();
  expect(reasonOf(null)).toBeUndefined();
});
