import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/desk";
import { FIXTURE_NOW } from "./world";

const evidence = process.env.VERIFY_IMSG_EVIDENCE ?? mkdtempSync(join(tmpdir(), "imsg-golden-"));
const shot = (page: Page, name: string) => page.screenshot({ path: join(evidence, `${name}.png`) });
const row = (page: Page, name: string) => page.getByTestId("conversation-row").filter({ hasText: name });

async function rename(page: Page, from: string, first: string) {
  await page.getByTestId("contact-row").filter({ hasText: from }).first().click();
  await page.getByTestId("person-edit").click();
  await page.getByLabel("First", { exact: true }).fill(first);
  await page.getByTestId("person-done").click();
}

test("contact-rename: a contact rename shows in the list, Today, the thread and group senders without a reload", async ({ desk }) => {
  const { page, request } = desk;
  await page.addInitScript((fixtureNow) => {
    const realNow = Date.now.bind(Date);
    const offset = fixtureNow - realNow();
    Date.now = () => realNow() + offset;
  }, FIXTURE_NOW);
  const renames: unknown[] = [];
  page.on("request", (req) => {
    if (!req.url().endsWith("/__fixture/convex")) return;
    const body = req.postDataJSON() as { name: string; args: unknown };
    if (body.name === "identity/mutations:renamePerson") renames.push(body.args);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByTestId("today-header")).toBeVisible();
  await expect(row(page, "Alex Rivera")).toHaveCount(1);
  await shot(page, "1-today-before");
  await page.goto(`/chat/${encodeURIComponent(desk.chats.unreadGroup)}`);
  await expect(page.getByTestId("thread-view").getByText("Maya Patel").first()).toBeVisible();
  await shot(page, "2-group-before");

  await page.getByRole("button", { name: "Contacts" }).first().click();
  await rename(page, "Alex Rivera", "Lex");
  await rename(page, "Maya Patel", "Mae");
  await shot(page, "3-contact-after");
  expect(renames).toEqual([
    expect.objectContaining({ personId: "fixture-alex", display_name: "Lex Rivera", first_name: "Lex" }),
    expect.objectContaining({ personId: "fixture-maya", display_name: "Mae Patel", first_name: "Mae" }),
  ]);

  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await expect(page.getByTestId("today-header")).toBeVisible();
  await expect(row(page, "Lex Rivera")).toHaveCount(1);
  await expect(row(page, "Alex Rivera")).toHaveCount(0);
  await expect(row(page, "Lex Rivera").getByTestId("today-reason")).toBeVisible();
  await shot(page, "4-today-after");
  writeFileSync(join(evidence, "aria-today.txt"), await row(page, "Lex Rivera").ariaSnapshot());

  await row(page, "Lex Rivera").click();
  const thread = page.getByTestId("thread-view");
  await expect(page.getByText("Lex Rivera").first()).toBeVisible();
  await shot(page, "5-thread-after");

  await row(page, "Launch Crew").click();
  await expect(thread.getByText("Mae Patel").first()).toBeVisible();
  await expect(thread.getByText("Maya Patel")).toHaveCount(0);
  await shot(page, "6-group-after");
  writeFileSync(join(evidence, "aria-group.txt"), await thread.ariaSnapshot());

  const read = async (name: string, args: Record<string, unknown>) =>
    (await request.post("/__fixture/convex", { data: { name, args } })).json() as Promise<Record<string, unknown>>;
  const alex = await read("comma/queries:resolveChat", { chatGuid: desk.chats.needs });
  const group = await read("comma/queries:resolveChat", { chatGuid: desk.chats.unreadGroup });
  expect(alex).toMatchObject({ displayName: "Lex Rivera", known: true, participants: [{ name: "Lex Rivera" }] });
  expect(group).toMatchObject({ lastMessage: { senderName: "Mae Patel" } });
  writeFileSync(join(evidence, "convex-readback.json"), JSON.stringify({ renames, alex, group }, null, 2));
});
