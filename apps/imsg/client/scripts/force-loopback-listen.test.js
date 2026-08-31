const { describe, expect, test } = require("bun:test");
const { forceLoopbackListenArgs } = require("./force-loopback-listen");

describe("force loopback listener", () => {
  test("injects loopback into numeric listen signatures", () => {
    const callback = () => undefined;
    expect(forceLoopbackListenArgs([8081, callback])).toEqual([8081, "127.0.0.1", callback]);
    expect(forceLoopbackListenArgs([8081, "0.0.0.0", callback])).toEqual([8081, "127.0.0.1", callback]);
    expect(forceLoopbackListenArgs([8081, 128, callback])).toEqual([8081, "127.0.0.1", 128, callback]);
  });

  test("overrides host in option objects and preserves unix sockets", () => {
    expect(forceLoopbackListenArgs([{ port: 8081, host: "::" }])).toEqual([{ port: 8081, host: "127.0.0.1" }]);
    expect(forceLoopbackListenArgs(["/tmp/comma.sock"])).toEqual(["/tmp/comma.sock"]);
  });
});
