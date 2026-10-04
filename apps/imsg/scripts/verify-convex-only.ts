// Proves the deployed Mini serves only the session, release and health routes,
// and that Convex itself still rejects callers without a session.
// Usage: bun scripts/verify-convex-only.ts [origin]

const origin = process.argv[2] ?? "https://milads-mac-mini.taild31e9a.ts.net:8447";
const convexUrl = "https://shiny-gerbil-853.convex.cloud";

const retained = ["/api/health", "/api/convex-token", "/api/deploy/status", "/api/desktop-release"];
const removed = [
  "/api/chats?state=any",
  "/api/counts?type=all",
  "/api/contacts?q=a",
  "/api/search?q=a",
  "/api/scheduled",
  "/api/ai/status",
  "/api/link-preview?url=https%3A%2F%2Fexample.com",
];

let failed = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed++;
}

for (const path of retained) {
  const response = await fetch(origin + path);
  check(response.ok, `retained ${path} -> ${response.status}`);
}
for (const path of removed) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  check(response?.status === 404, `removed ${path} -> ${response?.status ?? "no response"}`);
}

// Non-API paths fall through to the app shell, so the old stream is gone when /events is HTML.
const events = await fetch(`${origin}/events`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
check(!events?.headers.get("content-type")?.includes("text/event-stream"), `removed /events stream -> ${events?.headers.get("content-type") ?? "no response"}`);
await events?.body?.cancel();

const tokenResponse = await fetch(`${origin}/api/convex-token`);
const { token } = (await tokenResponse.json()) as { token?: string };
const listConversations = (authorization?: string) => fetch(`${convexUrl}/api/query`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
  body: JSON.stringify({ path: "comma/queries:listConversations", args: { paginationOpts: { numItems: 1, cursor: null } }, format: "json" }),
}).then((response) => response.json() as Promise<{ status: string; value?: { page: unknown[] } }>);

const authed = await listConversations(`Bearer ${token}`);
check(authed.status === "success" && (authed.value?.page.length ?? 0) > 0, "Convex reads conversations with the Mini-issued session");
const anonymous = await listConversations();
check(anonymous.status === "error", "Convex rejects a caller without a session");

console.log(failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
