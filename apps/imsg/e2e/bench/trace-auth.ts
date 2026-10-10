/**
 * Where the boot spends time between the socket opening and Convex `Connect`: the token
 * request as the network saw it and as JS saw it, the socket open as JS saw it, the first
 * frames sent, and every long task in between. Read-only; never logs the token.
 *   bun e2e/bench/trace-auth.ts <url> [return|first] [runs]
 */
import { chromium } from "@playwright/test";
import { cachedChromium } from "../chromium";

const url = Bun.argv[2];
const visit = Bun.argv[3] ?? "return";
const runs = Number(Bun.argv[4] ?? 3);

const probe = () => {
  const marks: Array<[string, number]> = [];
  const mark = (name: string) => marks.push([name, Math.round(performance.now())]);
  (window as unknown as { __marks: typeof marks }).__marks = marks;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) marks.push([`longtask ${Math.round(e.duration)}ms`, Math.round(e.startTime)]);
  }).observe({ type: "longtask", buffered: true });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = String(input instanceof Request ? input.url : input);
    if (!href.includes("/api/convex-token")) return realFetch(input, init);
    mark("token fetch called");
    const response = await realFetch(input, init);
    mark("token response in JS");
    const json = response.json.bind(response);
    response.json = async () => { const body = await json(); mark("token json in JS"); return body; };
    return response;
  };
  const RealWebSocket = window.WebSocket;
  let sent = 0;
  window.WebSocket = class extends RealWebSocket {
    constructor(u: string | URL, p?: string | string[]) {
      super(u, p);
      mark("ws constructed");
      this.addEventListener("open", () => mark("ws open in JS"));
      let received = 0;
      this.addEventListener("message", (e: MessageEvent) => {
        const m = JSON.parse(String(e.data)) as { type: string; modifications?: unknown[] };
        if (m.type === "Transition" && received++ < 6) mark(`recv Transition ${m.modifications?.length ?? 0} queries ${Math.round(String(e.data).length / 1024)}KB`);
      });
    }
    send(data: string) {
      const type = (JSON.parse(data) as { type: string }).type;
      if (sent++ < 3 || type === "Authenticate") mark(`send ${type}`);
      super.send(data);
    }
  } as typeof WebSocket;
};

const browser = await chromium.launch({ executablePath: cachedChromium() });
for (let run = 0; run < runs; run++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  if (visit === "return") {
    const prime = await context.newPage();
    await prime.goto(url + "/");
    await prime.getByTestId("conversation-row").first().waitFor();
    await prime.waitForFunction(() => localStorage.getItem("imsg.chatSnapshot.v1") !== null);
    await prime.close();
  }
  const page = await context.newPage();
  await page.addInitScript(probe);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const wire: Array<[string, number]> = [];
  let offset = 0;
  cdp.on("Network.webSocketWillSendHandshakeRequest", (e) => { offset = e.wallTime - e.timestamp; wire.push(["ws handshake sent (net)", e.wallTime * 1000]); });
  cdp.on("Network.webSocketHandshakeResponseReceived", (e) => wire.push(["ws handshake 101 (net)", (e.timestamp + offset) * 1000]));
  await page.goto(url + "/", { waitUntil: "commit" });
  await page.waitForFunction(() => (window as unknown as { __marks: Array<[string, number]> }).__marks.some(([n]) => n.startsWith("send ModifyQuerySet")), undefined, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  const { marks, net } = await page.evaluate(() => {
    const r = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const token = r.find((e) => e.name.includes("/api/convex-token"));
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const scripts = r.filter((e) => e.name.endsWith(".js"));
    const net: Array<[string, number]> = [["html responseEnd", nav.responseEnd]];
    for (const s of scripts) net.push([`js responseEnd ${s.name.split("/").pop()?.slice(0, 24)}`, s.responseEnd]);
    if (token) net.push(["token requestStart (net)", token.requestStart], ["token responseEnd (net)", token.responseEnd]);
    const paint = performance.getEntriesByType("paint").map((p) => [p.name, p.startTime] as [string, number]);
    return { marks: (window as unknown as { __marks: Array<[string, number]> }).__marks, net: [...net, ...paint].map(([n, t]) => [n, Math.round(t)] as [string, number]) };
  });
  const origin = await page.evaluate(() => performance.timeOrigin);
  for (const [n, t] of wire) net.push([n, Math.round(t - origin)]);
  console.log(`--- run ${run} (${visit})`);
  for (const [name, t] of [...marks, ...net].sort((a, b) => a[1] - b[1])) console.log(String(t).padStart(5), name);
  await context.close();
}
await browser.close();
