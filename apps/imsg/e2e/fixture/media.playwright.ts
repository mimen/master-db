import { expect, test } from "../fixtures/desk";

for (const surface of ["bubble", "gallery", "lightbox"] as const) {
  test(`${surface} shows unavailable media for null storage URLs without a Mini fallback`, async ({ desk }) => {
    const page = desk.page;
    const miniRequests: string[] = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/attachments/")) miniRequests.push(request.url()); });
    await page.route("**/__fixture/convex", async (route) => {
      const body = route.request().postDataJSON() as { name: string };
      const response = await route.fetch();
      const result = await response.json();
      if (body.name === "comma/queries:listMessages") {
        for (const message of result.page) for (const attachment of message.attachments) {
          attachment.originalUrl = null;
          if (surface === "bubble") attachment.thumbUrl = null;
        }
      }
      if (body.name === "comma/media:gallery") for (const item of result) { item.thumbUrl = null; item.originalUrl = null; }
      if (body.name === "comma/media:attachmentMedia" && result) { result.thumbUrl = null; result.originalUrl = null; }
      await route.fulfill({ response, json: result });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("conversation-row").filter({ hasText: "Launch Crew" }).click();
    await expect(page.getByTestId("thread-view")).toBeVisible();
    if (surface === "gallery") {
      await page.keyboard.press("Meta+i");
      await expect(page.getByRole("button", { name: "Open photo 1", exact: true })).toBeVisible();
    }
    if (surface === "lightbox") await page.getByTestId("thread-view").getByRole("button", { name: "Open photo", exact: true }).click();
    await expect(page.getByText("Media pending or unavailable", { exact: true }).last()).toBeVisible();
    await page.screenshot({ path: `/tmp/convex-media-${surface}.png`, animations: "disabled" });
    expect(miniRequests).toEqual([]);
  });
}
