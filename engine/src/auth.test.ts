import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { bearerAuth } from "./auth";

const TOKEN = "secret-token-123";

function buildApp() {
  const app = new Hono();
  app.use("*", bearerAuth(TOKEN));
  app.get("/x", (c) => c.text("ok"));
  return app;
}

describe("bearerAuth", () => {
  test("401 on missing header", async () => {
    const res = await buildApp().request("/x");
    expect(res.status).toBe(401);
  });

  test("401 on wrong scheme", async () => {
    const res = await buildApp().request("/x", {
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  test("401 on wrong token", async () => {
    const res = await buildApp().request("/x", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  test("200 on correct bearer", async () => {
    const res = await buildApp().request("/x", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
