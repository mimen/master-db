import { describe, expect, test } from "bun:test";

import { goBackOrHome } from "./back-navigation";

function fakeNav(canGoBack: boolean) {
  const calls: string[] = [];
  return {
    calls,
    canGoBack: () => canGoBack,
    back: () => calls.push("back"),
    replace: (href: string) => calls.push(`replace ${href}`),
  };
}

describe("goBackOrHome", () => {
  test("pops when there is history", () => {
    const nav = fakeNav(true);
    goBackOrHome(nav);
    expect(nav.calls).toEqual(["back"]);
  });

  test("goes to the list after a reload or deep link", () => {
    const nav = fakeNav(false);
    goBackOrHome(nav);
    expect(nav.calls).toEqual(["replace /"]);
  });
});
