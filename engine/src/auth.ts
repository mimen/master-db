import type { MiddlewareHandler } from "hono";

export function bearerAuth(expected: string): MiddlewareHandler {
  return async (c, next) => {
    const header =
      c.req.header("authorization") ?? c.req.header("Authorization");
    if (!header) return c.json({ error: "missing authorization" }, 401);
    const [scheme, token] = header.split(" ", 2);
    if (scheme !== "Bearer" || !token) {
      return c.json({ error: "expected Bearer scheme" }, 401);
    }
    if (token !== expected) return c.json({ error: "invalid token" }, 401);
    await next();
  };
}
