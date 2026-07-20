/**
 * Shared bearer-secret check for /identity/* HTTP routes. Same shape as
 * convex/beeper/sync/auth.ts — kept as its own copy rather than a shared
 * import since the two ingest pipelines are independent and a secret rotation
 * on one shouldn't require touching the other's module.
 */
export function checkContactsIngestAuth(req: Request): Response | null {
  const expectedSecret = process.env.APPLE_CONTACTS_INGEST_SECRET;
  if (!expectedSecret) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "APPLE_CONTACTS_INGEST_SECRET is not configured on the Convex deployment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (provided !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
