import { describe, expect, test } from "bun:test";
import { deferOptions, laterLines } from "./later-times";

// Mon Nov 9 2026, 2:00 PM local.
const now = new Date(2026, 10, 9, 14, 0, 0);
const local = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0).getTime();

describe("deferOptions", () => {
  test("Later offers tomorrow morning, this evening and next Monday", () => {
    expect(deferOptions("later", now)).toEqual([
      { label: "Tomorrow 9am", at: local(10, 9) },
      { label: "This evening", at: local(9, 18) },
      { label: "Next week", at: local(16, 9) },
    ]);
  });

  test("This evening drops out once it has passed", () => {
    expect(deferOptions("later", new Date(2026, 10, 9, 19)).map((o) => o.label)).toEqual(["Tomorrow 9am", "Next week"]);
  });

  test("Next week from a Sunday is the next day", () => {
    expect(deferOptions("later", new Date(2026, 10, 8, 10)).at(-1)).toEqual({ label: "Next week", at: local(9, 9) });
  });

  test("Follow up offers two days out and next Monday", () => {
    expect(deferOptions("followUp", now)).toEqual([{ label: "In 2 days", at: local(11, 9) }, { label: "Next week", at: local(16, 9) }]);
  });
});

describe("laterLines", () => {
  test("names each deferral and why a conversation came back", () => {
    expect(laterLines(undefined, now)).toEqual([]);
    expect(laterLines({ snoozedUntil: local(10, 9) }, now)).toEqual(["Snoozed until Tomorrow, 9:00 AM"]);
    expect(laterLines({ returned: { reason: "message", until: local(10, 9), at: local(9, 13) } }, now)).toEqual(["Back: new reply"]);
    expect(laterLines({ returned: { reason: "time", until: local(9, 13), at: local(9, 13) } }, now)).toEqual(["Snoozed until Today, 1:00 PM"]);
    expect(laterLines({ followUp: { at: local(11, 9), since: local(9, 10), due: false } }, now)).toEqual(["Follow up Nov 11, 9:00 AM if no reply"]);
    expect(laterLines({ followUp: { at: local(9, 13), since: local(7, 10), due: true } }, now)).toEqual(["No reply since Nov 7"]);
  });
});
