import { describe, expect, test } from "bun:test";

import { DesktopType, Type } from "./type-scale";

describe("type scales", () => {
  test("desktop is a step down from the iOS scale on every rung", () => {
    expect(DesktopType.title).toBeLessThan(Type.title);
    expect(DesktopType.body).toBeLessThan(Type.body);
    expect(DesktopType.secondary).toBeLessThan(Type.secondary);
    expect(DesktopType.caption).toBeLessThan(Type.caption);
  });
});
