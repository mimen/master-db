import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

const previousSecret = process.env.SAVED_INGEST_SECRET;
afterEach(() => {
  if (previousSecret === undefined) delete process.env.SAVED_INGEST_SECRET;
  else process.env.SAVED_INGEST_SECRET = previousSecret;
});

const post = (id: string, text: string) => ({
  platform: "x" as const,
  platform_id: id,
  url: `https://x.com/i/status/${id}`,
  text,
  links: [],
  media: [],
  collections: [],
});

const firstPage = { paginationOpts: { numItems: 10, cursor: null } };

describe("saved items", () => {
  test("re-ingest refreshes platform fields and keeps the user's triage state", async () => {
    const t = convexTest(schema, modules);
    const me = t.withIdentity({ email: ALLOWED_EMAIL });
    await t.mutation(internal.saved.ingest.upsertItems, { items: [post("1", "old text")] });
    const [row] = (await me.query(api.saved.public.list, firstPage)).page;
    await me.mutation(api.saved.public.setStatus, { id: row._id, status: "kept" });
    await me.mutation(api.saved.public.setNotes, { id: row._id, notes: "try it" });
    expect(
      await t.mutation(internal.saved.ingest.setTriage, {
        results: [
          { platform: "x", platform_id: "1", summary: "a tool", tags: ["ai"], suggestion: "try this tool" },
          { platform: "x", platform_id: "missing", summary: "", tags: [], suggestion: "drop" },
        ],
      }),
    ).toEqual({ updated: 1, skipped: 1 });
    await me.mutation(api.saved.public.setStatus, { id: row._id, status: "new" });
    expect(await t.query(internal.saved.ingest.listUntriaged, { limit: 10 })).toEqual([]);
    await me.mutation(api.saved.public.setStatus, { id: row._id, status: "kept" });

    expect(
      await t.mutation(internal.saved.ingest.upsertItems, { items: [post("1", "edited text")] }),
    ).toEqual({ inserted: 0, updated: 1 });

    const rows = await t.run((ctx) => ctx.db.query("saved_items").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      text: "edited text",
      status: "kept",
      notes: "try it",
      summary: "a tool",
      tags: ["ai"],
      suggestion: "try this tool",
      saved_at: row.saved_at,
    });
    expect(rows[0].processed_at).toEqual(expect.any(String));
  });

  test("raw platform JSON lives in saved_item_raw, one row per item", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.saved.ingest.upsertItems, { items: [{ ...post("1", "t"), raw: "v1" }] });
    await t.mutation(internal.saved.ingest.upsertItems, { items: [{ ...post("1", "t"), raw: "v2" }] });
    const [items, raws] = await t.run(async (ctx) => [
      await ctx.db.query("saved_items").collect(),
      await ctx.db.query("saved_item_raw").collect(),
    ]);
    expect(items[0].raw).toBeUndefined();
    expect(raws).toEqual([expect.objectContaining({ item_id: items[0]._id, raw: "v2" })]);
  });

  test("re-ingest keeps stored media and deletes the duplicate upload", async () => {
    const t = convexTest(schema, modules);
    const [kept, dupe] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(["a"])),
      await ctx.storage.store(new Blob(["b"])),
    ]);
    const withMedia = (storage_id: typeof kept) => ({
      ...post("1", "t"),
      media: [{ type: "image" as const, url: "https://cdn/x.jpg", storage_id }],
    });
    await t.mutation(internal.saved.ingest.upsertItems, { items: [withMedia(kept)] });
    await t.mutation(internal.saved.ingest.upsertItems, { items: [withMedia(dupe)] });
    const [row] = await t.run((ctx) => ctx.db.query("saved_items").collect());
    expect(row.media[0].storage_id).toBe(kept);
    expect(await t.run((ctx) => ctx.storage.get(dupe))).toBeNull();
  });

  test("http routes require the bearer secret", async () => {
    process.env.SAVED_INGEST_SECRET = "s3cret";
    const t = convexTest(schema, modules);
    const call = (path: string, auth: string | null, body: unknown) =>
      t.fetch(path, {
        method: "POST",
        headers: auth ? { Authorization: auth } : {},
        body: JSON.stringify(body),
      });
    const ingest = { items: [post("1", "hi")] };

    for (const path of ["/saved/ingest", "/saved/known", "/saved/upload-url", "/saved/untriaged", "/saved/triage"]) {
      expect((await call(path, null, {})).status).toBe(401);
      expect((await call(path, "Bearer wrong", {})).status).toBe(401);
    }
    expect(await t.run((ctx) => ctx.db.query("saved_items").collect())).toHaveLength(0);

    const ok = await call("/saved/ingest", "Bearer s3cret", ingest);
    expect(await ok.json()).toEqual({ ok: true, inserted: 1, updated: 0 });
    const known = await call("/saved/known", "Bearer s3cret", { platform: "x", platform_ids: ["1", "2"] });
    expect(await known.json()).toEqual({ ok: true, known: ["1"] });
    const untriaged = await call("/saved/untriaged", "Bearer s3cret", {});
    expect((await untriaged.json()).items.map((i: { platform_id: string }) => i.platform_id)).toEqual(["1"]);
    expect((await call("/saved/ingest", "Bearer s3cret", { items: [{ platform: "tiktok" }] })).status).toBe(400);
  });

  test("list rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.saved.public.list, firstPage)).rejects.toThrow(/Unauthorized/);
  });
});
