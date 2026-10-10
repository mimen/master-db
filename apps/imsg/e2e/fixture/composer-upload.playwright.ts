import { expect, test } from "../fixtures/desk";

test("staged files upload through Convex with the caption on the first attachment", async ({ desk }) => {
  const page = desk.page;
  const miniRequests: string[] = [];
  const commands: Array<{ kind: string; filename?: string; caption?: string; isAudioMessage?: boolean }> = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/events" || (path.startsWith("/api/") && !["/api/deploy/status", "/api/convex-token"].includes(path))) miniRequests.push(path);
    if (path === "/__fixture/convex") {
      const body = request.postDataJSON() as { name: string; args: { payload?: typeof commands[number] } };
      if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "sendAttachment") commands.push(body.args.payload);
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  const thread = page.getByTestId("thread-view");
  await expect(thread).toBeVisible();
  await page.getByPlaceholder("iMessage").fill("Here are the notes");
  // Exercise the browser's file-drop entry point, then the actual Send button.
  await thread.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["first"], "first.txt", { type: "text/plain" }));
    transfer.items.add(new File(["second"], "second.txt", { type: "text/plain" }));
    node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(2);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(thread.getByText("first.txt", { exact: true })).toBeVisible();
  await expect(thread.getByText("second.txt", { exact: true })).toBeVisible();
  expect(commands).toEqual([
    expect.objectContaining({ filename: "first.txt", caption: "Here are the notes", isAudioMessage: false }),
    expect.objectContaining({ filename: "second.txt", isAudioMessage: false }),
  ]);
  expect(commands[1]).not.toHaveProperty("caption");
  expect(miniRequests).toEqual([]);
  await page.screenshot({ path: "/tmp/convex-composer-upload.png", animations: "disabled" });
});

test("an unknown attachment outcome shows a component toast and does not retry", async ({ desk }) => {
  const page = desk.page;
  let sends = 0;
  await page.route("**/__fixture/convex", async (route) => {
    const body = route.request().postDataJSON() as { name: string; args: { payload?: { kind: string } } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload?.kind === "sendAttachment") sends++;
    if (body.name !== "comma/outbox:getCommand") return route.continue();
    const response = await route.fetch();
    const receipt = await response.json();
    if (receipt?.result?.kind === "sendAttachment") {
      receipt.status = "unknown";
      receipt.error = "The bridge lost its confirmation";
    }
    await route.fulfill({ response, json: receipt });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-row").filter({ hasText: "Alex Rivera" }).click();
  await page.getByTestId("thread-view").evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["maybe sent"], "unknown.txt", { type: "text/plain" }));
    node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Not sure this went through. Check the conversation before trying again.", { exact: true })).toBeVisible();
  await expect(page.getByText("Couldn't send the attachment. Check the bridge connection.", { exact: true })).toHaveCount(0);
  expect(sends).toBe(1);
});
