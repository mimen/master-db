import { jsonResponse } from "../beeper/sync/auth";

export function checkBridgeAuth(request: Request): Response | null {
  const expected = process.env.COMMA_BRIDGE_SECRET;
  if (!expected) {
    return jsonResponse({ ok: false, error: "bridge secret not configured" }, 500);
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  let difference = expected.length ^ provided.length;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ (provided.charCodeAt(i) || 0);
  }
  return difference === 0
    ? null
    : jsonResponse({ ok: false, error: "unauthorized" }, 401);
}
