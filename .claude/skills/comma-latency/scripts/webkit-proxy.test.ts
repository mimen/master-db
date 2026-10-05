import { describe, expect, it, spyOn } from "bun:test";
import { analyze } from "./webkit-proxy";

describe("proxy settlement", () => {
  it("does not select a historical quiet gap before later activity", () => {
    const clock = spyOn(performance, "now").mockReturnValue(600);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { __lat: {
      frames: [16, 416, 616], muts: [10, 400], edits: [], scrolls: [],
      inputs: [{ t: 0 }, { t: 450 }], wsIn: [], mqs: [],
    } } });
    try {
      expect(analyze({ mark: 0, inputIndex: 0, scroll: false, quiet: 300, cap: 5000 })).toEqual({ done: false });
      clock.mockReturnValue(800);
      const result = analyze({ mark: 0, inputIndex: 0, scroll: false, quiet: 300, cap: 5000 });
      expect(result.done).toBe(true);
      if (result.done) expect(result.settled).toBeGreaterThanOrEqual(450);
    } finally { clock.mockRestore(); Reflect.deleteProperty(globalThis, "window"); }
  });
  it("does not call an unchanging page a response", () => {
    const clock = spyOn(performance, "now").mockReturnValue(1000);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { __lat: {
      frames: [16, 32], muts: [], edits: [], scrolls: [], inputs: [{ t: 0 }], wsIn: [], mqs: [],
    } } });
    try { expect(analyze({ mark: 0, inputIndex: 0, scroll: false, quiet: 300, cap: 5000 })).toEqual({ done: false }); }
    finally { clock.mockRestore(); Reflect.deleteProperty(globalThis, "window"); }
  });
});
