/**
 * Shared bearer-secret check used by every /beeper/* HTTP route.
 *
 * Returns null on success, or a Response (401/500) on failure that the
 * handler should return as-is.
 */
export function checkBeeperIngestAuth(req: Request): Response | null {
  const expectedSecret = process.env.BEEPER_INGEST_SECRET;
  if (!expectedSecret) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "BEEPER_INGEST_SECRET is not configured on the Convex deployment",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (provided !== expectedSecret) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}

export function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
