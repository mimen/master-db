import { describe, expect, test } from "bun:test";
import { fillComposer, onFillComposer } from "./composer-fill";

describe("composer fill stack", () => {
  test("restores the underlying composer after an overlay unmounts", () => {
    const heard: string[] = [];
    const removeBase = onFillComposer((text) => heard.push(`base:${text}`));
    const removeOverlay = onFillComposer((text) => heard.push(`overlay:${text}`));

    fillComposer("one");
    removeOverlay();
    fillComposer("two");
    removeBase();
    fillComposer("ignored");

    expect(heard).toEqual(["overlay:one", "base:two"]);
  });
});
