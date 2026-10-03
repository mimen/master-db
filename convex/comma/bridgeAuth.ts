import { constantTimeEqual } from "../_lib/constantTimeEqual";
import { jsonResponse } from "../beeper/sync/auth";

export function checkBridgeAuth(request: Request): Response | null {
  const expected = process.env.COMMA_BRIDGE_SECRET;
  if (!expected) {
    return jsonResponse({ ok: false, error: "bridge secret not configured" }, 500);
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return constantTimeEqual(expected, provided)
    ? null
    : jsonResponse({ ok: false, error: "unauthorized" }, 401);
}
