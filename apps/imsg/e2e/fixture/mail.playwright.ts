import { expect, openView, test } from "../fixtures/desk";

test("Mail lists the inbox under People and All inbox, and newsletters never reach People", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  // Email threads list in Mail, not in the Messages lenses; only Today ranks them beside chats.
  await openView(page, "All");
  await expect(page.getByText("Load-in for Saturday")).toHaveCount(0);

  await page.getByRole("button", { name: "Mail", exact: true }).click();
  const list = page.getByTestId("mail-list");
  await expect(page.getByRole("tab", { name: "People, 1" })).toHaveAttribute("aria-selected", "true");
  await expect(list.getByText("Load-in for Saturday")).toBeVisible();
  await expect(list.getByText("This week at the club")).toHaveCount(0);
  await expect(list.getByText("Booking inquiry")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/comma-mail-workspace.png", animations: "disabled" });

  await page.getByRole("button", { name: "2 more in All inbox" }).click();
  await expect(page.getByRole("tab", { name: "All inbox, 3" })).toHaveAttribute("aria-selected", "true");
  await expect(list.getByText("This week at the club")).toBeVisible();
  await expect(list.getByText("Booking inquiry")).toBeVisible();
  await page.screenshot({ path: "/tmp/comma-mail-all-inbox.png", animations: "disabled" });
});

test("the reader shows each message as a card, and a message with a script and a tracking pixel renders with neither", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sam Lee, Load-in for Saturday" }).click();

  const reader = page.getByTestId("email-reader");
  await expect(reader.getByRole("heading", { name: "Load-in for Saturday" })).toBeVisible();
  await expect(reader.getByTestId("email-card")).toHaveCount(2);
  await expect(reader.getByText("What time is load-in?")).toBeVisible();
  await expect(reader.getByRole("button", { name: "Reply to the message from Sam Lee", exact: true })).toBeVisible();
  await expect(reader.getByRole("button", { name: "Reply all to the message from Sam Lee", exact: true })).toBeVisible();

  const frame = reader.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  const body = page.frameLocator('[data-testid="email-reader"] iframe').locator("body");
  await expect(body.getByText("Load-in is at 6 pm, doors at 8.")).toBeVisible();
  await expect(body.locator("script")).toHaveCount(0);
  await expect(body.locator('img[src*="track.example.test"], img[data-comma-src*="track.example.test"]')).toHaveCount(0);
  await expect(body.getByRole("link", { name: "Advance sheet" })).toHaveAttribute("target", "_blank");
  expect(await frame.evaluate((element) => (element as HTMLIFrameElement).srcdoc)).not.toMatch(/<script|onload=|open\.gif/);
  expect(await page.evaluate(() => ({ script: (globalThis as { __mailScript?: boolean }).__mailScript, onload: (globalThis as { __mailOnload?: boolean }).__mailOnload })))
    .toEqual({ script: undefined, onload: undefined });

  // Sam is a known sender, so the floor plan loads without asking. The tracking pixel never reached the page.
  await expect(body.locator('img[src="https://cdn.example.test/floor-plan.png"]')).toHaveCount(1);
  await expect(reader.getByRole("button", { name: /Load images/ })).toHaveCount(0);
  await page.screenshot({ path: "/tmp/comma-email-reader.png", animations: "disabled" });
  await frame.screenshot({ path: "/tmp/comma-email-sanitized.png", animations: "disabled" });
  expect(dialogs).toEqual([]);
  expect(requested.filter((url) => url.includes("track.example.test"))).toEqual([]);
});

test("a stranger's remote images wait behind Load images", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "2 more in All inbox" }).click();
  await page.getByRole("button", { name: "Pat Moreno, Booking inquiry" }).click();
  const reader = page.getByTestId("email-reader");
  const body = page.frameLocator('[data-testid="email-reader"] iframe').locator("body");
  await expect(body.getByText("Is the 14th still open for a two-hour set?")).toBeVisible();
  await expect(body.locator("img[src]")).toHaveCount(0);
  expect(requested.filter((url) => url.includes("press-shot"))).toEqual([]);

  await reader.getByRole("button", { name: /Load images/ }).click();
  await expect(body.locator('img[src="https://cdn.example.test/press-shot.jpg"]')).toHaveCount(1);
});

test("a long thread opens at its first unread message, folds the read ones to a line, and hides each quote behind •••", async ({ desk }) => {
  const page = desk.page;
  await desk.request.post("/__fixture/mail", { data: { longThread: true } });
  // Short enough that the thread overflows, so landing on the first unread means scrolling to it.
  for (const viewport of [{ width: 1440, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(viewport.width > 600 ? "/mail" : "/", { waitUntil: "domcontentloaded" });
    if (viewport.width <= 600) await page.getByTestId("phone-tab-bar").getByRole("tab", { name: "Mail" }).click();
    await page.getByRole("button", { name: "Jordan Kim, March routing" }).click();
    const reader = page.getByTestId("email-reader");
    const cards = reader.getByTestId("email-card");
    await expect(cards).toHaveCount(5);
    // Two unread, so the newest two open; the three before them fold to one line each.
    await expect(cards.nth(0)).toHaveAttribute("aria-expanded", "false");
    await expect(cards.nth(1)).toHaveAttribute("aria-expanded", "false");
    await expect(cards.nth(2)).toHaveAttribute("aria-expanded", "false");
    await expect(cards.nth(3)).toHaveAttribute("aria-expanded", "true");
    await expect(cards.nth(4)).toHaveAttribute("aria-expanded", "true");
    await expect(cards.nth(1)).toContainText("Dallas to Houston is tight. Can Houston slide a day?");

    // Landed on the first unread message, not the top of the thread.
    const box = await cards.nth(3).boundingBox();
    // A thread that fits the reader has nothing to scroll; one that overflows must have scrolled to the unread.
    const scroller = await reader.locator("[data-testid=email-card]").first().evaluate((card) => {
      let node = card.parentElement;
      while (node && getComputedStyle(node).overflowY !== "auto") node = node.parentElement;
      return node ? { top: node.scrollTop, overflows: node.scrollHeight > node.clientHeight } : null;
    });
    expect(scroller).not.toBeNull();
    if (scroller!.overflows) expect(scroller!.top).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(viewport.height / 2);

    // The newest quotes everything before it; only its own words show until ••• opens the quote.
    const newest = cards.nth(4);
    const quoted = newest.frameLocator("iframe").locator("details.comma-fold");
    await expect(newest.frameLocator("iframe").getByText("One more: New Orleans wants a 10 pm set instead of 11. OK?")).toBeVisible();
    await expect(quoted).toHaveCount(1);
    await expect(newest.frameLocator("iframe").getByText("Houston confirmed for the 16th.")).toBeHidden();
    const folded = (await newest.locator("iframe").boundingBox())!.height;
    await quoted.locator("> summary").click();
    await expect(newest.frameLocator("iframe").getByText("Houston confirmed for the 16th.")).toBeVisible();
    await expect.poll(async () => (await newest.locator("iframe").boundingBox())!.height).toBeGreaterThan(folded + 100);

    // Apple Mail's quote folds with the "On … wrote:" line above it.
    await cards.nth(2).click();
    await expect(cards.nth(2)).toHaveAttribute("aria-expanded", "true");
    const apple = cards.nth(2).frameLocator("iframe");
    await expect(apple.getByText("Houston can move to the 16th if that helps the drive.")).toBeVisible();
    await expect(apple.getByText(/On Mar 2, 2027, at 4:10 PM/)).toBeHidden();

    // A plain-text reply folds its quote the same way.
    await cards.nth(1).click();
    await expect(cards.nth(1).getByText("Dallas to Houston is tight. Can Houston slide a day?")).toBeVisible();
    await expect(cards.nth(1).getByText(/Holds expire Friday/)).toHaveCount(0);
    await cards.nth(1).getByRole("button", { name: "Show quoted text" }).click();
    await expect(cards.nth(1).getByText(/Holds expire Friday/)).toBeVisible();

    // Its header folds an open message back to its line.
    await cards.nth(1).getByRole("button", { name: "Fold the message from You" }).click();
    await expect(cards.nth(1)).toHaveAttribute("aria-expanded", "false");
  }
});

test("on a phone, Mail is a tab whose reader opens in place and goes back", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("phone-tab-bar").getByRole("tab", { name: "Mail" }).click();
  await page.getByRole("button", { name: "Sam Lee, Load-in for Saturday" }).click();
  await expect(page.getByTestId("email-card")).toHaveCount(2);
  await expect(page.getByTestId("phone-tab-bar"), "the reader is pushed over the tab bar").toHaveCount(0);
  await page.screenshot({ path: "/tmp/comma-mail-phone.png", animations: "disabled" });
  await page.getByRole("button", { name: "Back to Mail" }).click();
  await expect(page.getByRole("tab", { name: "People, 1" })).toBeVisible();
  await expect(page.getByTestId("phone-tab-bar")).toBeVisible();
});

test("All shows each thread's mailbox on its Gmail mark, and older messages offer Reply only on hover", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await desk.request.post("/__fixture/mail", { data: { mailboxes: true } });
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^All inbox/ }).click();
  const row = (name: string) => page.getByTestId("mail-list").getByTestId("conversation-row").filter({ hasText: name });
  await expect(row("Club Weekly")).toHaveAttribute("aria-label", /, Gmail, personal$/);
  await expect(row("Sam Lee")).toHaveAttribute("aria-label", /^Sam Lee, Load-in for Saturday, .*, Gmail$/);

  await row("Sam Lee").click();
  const reader = page.getByTestId("email-reader");
  await expect(reader.getByRole("button", { name: /^Reply to the message from/ }), "one Reply, on the newest card").toHaveCount(1);
  const older = reader.getByTestId("email-card").first();
  await older.click();
  await expect(older).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(5, 5);
  const actions = older.getByRole("button", { name: "Reply to the message from You" }).locator("..");
  await expect(actions).toHaveCSS("opacity", "0");
  await older.hover({ position: { x: 24, y: 12 } });
  await expect(actions).toHaveCSS("opacity", "1");
});

test("Mail search finds threads by sender, subject or any message's body, and says when nothing matches", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  const list = page.getByTestId("mail-list");
  const search = page.getByRole("textbox", { name: "Search mail" });
  await search.fill("pat booking");
  await expect(list.getByTestId("conversation-row")).toHaveCount(1);
  await expect(list.getByText("Booking inquiry")).toBeVisible();
  // Only the first message, Milad's own, says this.
  await search.fill("what time is load-in");
  await expect(list.getByText("Load-in for Saturday")).toBeVisible();
  await expect(list.getByTestId("conversation-row")).toHaveCount(1);
  await search.fill("zebra crossing");
  await expect(list.getByText("No matches.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(list.getByText("Load-in for Saturday")).toBeVisible();
});

test("H snoozes the open thread out of Mail and moves on; Follow up routes through Mail's keyboard too", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mail", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /^All inbox/ }).click();
  const list = page.getByTestId("mail-list");
  await list.getByTestId("conversation-row").filter({ hasText: "Sam Lee" }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press("Meta+k");
  await page.getByPlaceholder("Search people and messages, or type a command").fill("Follow up");
  await page.getByRole("listbox", { name: "Results" }).getByText("Follow up if no reply…", { exact: true }).click();
  await expect(page.getByText("Follow up waits on your own message. Reply first.")).toBeVisible();

  await page.keyboard.press("h");
  await page.getByRole("dialog").getByText("Tomorrow 9am", { exact: true }).click();
  await expect(page.getByText(/^Snoozed until Tomorrow, 9:00/)).toBeVisible();
  await expect(list.getByText("Load-in for Saturday"), "a snoozed thread leaves Mail").toHaveCount(0);
  await expect(page.getByTestId("email-reader").getByRole("heading", { name: "Load-in for Saturday" }), "the reader moved on").toHaveCount(0);
  await expect(page.getByTestId("email-reader")).toBeVisible();
});

test("with a mailbox connected, search offers a Gmail chip whose hits open in Mail", async ({ desk }) => {
  const page = desk.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const tab = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  await (await tab).close();

  await page.goto("/search", { waitUntil: "domcontentloaded" });
  const chips = page.getByRole("radiogroup", { name: "Search in" });
  await expect(chips.getByRole("radio")).toHaveText(["Everywhere", "iMessage", "Gmail"]);
  await page.getByPlaceholder("Search contacts and messages…").fill("load-in");
  await chips.getByRole("radio", { name: "Gmail" }).click();
  // Inside the search pane: Today's row in the sidebar previews the same line.
  await chips.locator("..").getByText("Hi Milad, Load-in is at 6 pm, doors at 8.", { exact: true }).click();
  await expect(page.getByTestId("email-reader").getByRole("heading", { name: "Load-in for Saturday" })).toBeVisible();
  await expect(page.getByTestId("email-card")).toHaveCount(2);
});
