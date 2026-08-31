const net = require("node:net");

function forceLoopbackListenArgs(args) {
  const next = [...args];
  const first = next[0];
  if (typeof first === "number") {
    if (typeof next[1] === "string") next[1] = "127.0.0.1";
    else next.splice(1, 0, "127.0.0.1");
    return next;
  }
  if (first && typeof first === "object" && "port" in first) {
    next[0] = { ...first, host: "127.0.0.1" };
  }
  return next;
}

if (process.env.IMSG_FORCE_LOOPBACK === "1") {
  const originalListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function listen(...args) {
    return originalListen.apply(this, forceLoopbackListenArgs(args));
  };
}

module.exports = { forceLoopbackListenArgs };
