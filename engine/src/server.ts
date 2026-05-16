import { Hono } from "hono";

const app = new Hono();
app.get("/healthz", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
export default { port, fetch: app.fetch };
