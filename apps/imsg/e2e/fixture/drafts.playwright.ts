import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures/desk";

const SCREENSHOT = fileURLToPath(new URL("../../artifacts/drafts-tab.png", import.meta.url));

test("an agent draft lists under Drafts, opens into the composer with its attachment and note, and sends through the normal path", async ({ desk }) => {
  const { page, request } = desk;
  const convex = async (name: string, args: Record<string, unknown>) => {
    const response = await request.post("/__fixture/convex", { data: { name, args } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const upload = await request.post("/__fixture/upload", {
    headers: { "Content-Type": "image/png" },
    data: readFileSync(fileURLToPath(new URL("./assets/run-of-show.png", import.meta.url))),
  });
  const { storageId } = await upload.json() as { storageId: string };
  await convex("comma/uploads:finalizeUpload", { storageId, filename: "run-of-show.png", mimeType: "image/png" });
  await convex("comma/drafts:prepareDraft", {
    chatGuid: desk.chats.needs, text: "Doors at 7, we're on at 9:30. Run of show attached.", attachments: [storageId],
    note: "Alex asked for the final arrival time.\nPulled from the event doc.",
  });
  const sent: Array<{ kind: string; storageId?: string; caption?: string }> = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname !== "/__fixture/convex") return;
    const body = req.postDataJSON() as { name: string; args: { payload?: typeof sent[number] } };
    if (body.name === "comma/outbox:enqueue" && body.args.payload) sent.push(body.args.payload);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^Drafts/ }).click();
  const rows = page.getByTestId("conversation-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Alex Rivera");
  await expect(rows.first()).toContainText("Agent draft");
  await expect(rows.first()).toContainText("Alex asked for the final arrival time.");
  await rows.first().click();

  await expect(page.getByPlaceholder("Add a comment or Send")).toHaveValue("Doors at 7, we're on at 9:30. Run of show attached.");
  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(1);
  await expect(page.getByTestId("draft-note")).toContainText("Pulled from the event doc.");
  // The lens underline is a Reanimated spring, which animations: "disabled" does not stop.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: SCREENSHOT, animations: "disabled" });

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => sent.filter((p) => p.kind === "sendAttachment")).toEqual([
    expect.objectContaining({ storageId, caption: "Doors at 7, we're on at 9:30. Run of show attached." }),
  ]);
  await expect(rows.filter({ hasText: "Agent draft" })).toHaveCount(0);
});
