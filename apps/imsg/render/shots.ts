/**
 * The shot list: what the render actually captures, and in what order.
 *
 * imsg is one app with two layouts — a split pane above the 768px breakpoint,
 * a list that pushes to a thread below it — so both are captured at fixed
 * viewports rather than one "responsive" width. The four state lenses (Unread /
 * Unresponded / Waiting / Archived) are the app's core idea, so each layout
 * walks all of them; a capture that only shows one lens isn't showing the app.
 *
 * Ordering is load-bearing. Opening a conversation marks it read, which empties
 * the badge it was carrying, so every list-focused capture happens before any
 * unread thread is opened. The one conversation opened early (Dmitri) is
 * Unresponded but already read, so nothing on screen changes because of it.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { FIXTURE_DM_THREAD_GUID, FIXTURE_GROUP_THREAD_GUID } from "../server/render-fixture";

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/** Fixture display names, used both as click targets and as content assertions. */
const GROUP_THREAD_NAME = "Cabin weekend 🏔";
const DM_THREAD_NAME = "Priya Raghunathan";
const READ_UNRESPONDED_NAME = "Dmitri Volkov";

type Lens = "All" | "Unread" | "Unresponded" | "Waiting" | "Archived";

export interface Shot {
  readonly name: string;
  readonly caption: string;
  readonly png: Buffer;
  readonly viewport: { width: number; height: number };
  readonly scheme: "light" | "dark";
}

export interface ShotContext {
  readonly browser: Browser;
  readonly baseUrl: string;
}

/** Lens pills carry their count in the accessible name once the list has loaded. */
function lensPill(page: Page, lens: Lens) {
  return page.getByRole("radio", { name: new RegExp(`^${lens}, \\d+ conversations$`) });
}

/**
 * Resolves once the directory has actually rendered — not merely mounted. A
 * skeleton list or an empty pane would screenshot perfectly happily, which is
 * the exact failure this lane exists to prevent, so readiness is asserted
 * against real fixture content and a counted lens pill.
 */
async function waitForDirectory(page: Page): Promise<void> {
  await lensPill(page, "All").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText(GROUP_THREAD_NAME, { exact: false }).first().waitFor({ timeout: 30_000 });
  await settle(page);
}

/**
 * Lets fonts, layout, and the list's own scroll restoration finish before the
 * shutter. Deliberately NOT `waitForLoadState("networkidle")`: the client holds
 * an SSE connection open for realtime, so the network is never idle and every
 * wait would burn its full timeout.
 */
async function settle(page: Page): Promise<void> {
  // String form on purpose: this expression is evaluated in the page, and the
  // server tsconfig has no DOM lib to typecheck a `document` reference against.
  await page.waitForFunction("document.fonts.status === 'loaded'", null, { timeout: 5_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
}

async function selectLens(page: Page, lens: Lens): Promise<void> {
  await lensPill(page, lens).click();
  await settle(page);
}

/** Opens a conversation by its fixture display name and waits for the composer. */
async function openThread(page: Page, name: string): Promise<void> {
  await page.getByText(name, { exact: false }).first().click();
  await page.getByPlaceholder(/^(iMessage|Text Message)$/).first().waitFor({ timeout: 20_000 });
  await settle(page);
}

async function newContext(
  { browser, baseUrl }: ShotContext,
  viewport: { width: number; height: number },
  scheme: "light" | "dark",
  mobile: boolean,
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: baseUrl,
    viewport,
    deviceScaleFactor: 2,
    colorScheme: scheme,
    hasTouch: mobile,
    isMobile: mobile,
    serviceWorkers: "block",
    // Fixed so relative timestamps ("Yesterday", weekday names) render the same
    // way on any machine that runs this.
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    reducedMotion: "reduce",
  });
}

/**
 * Walks both layouts and returns every capture in order. Kept as one linear
 * script rather than a table of steps: the sequence is the specification, and
 * the read-before-open ordering only reads correctly written out.
 */
export async function captureAll(context: ShotContext): Promise<Shot[]> {
  const shots: Shot[] = [];

  const shoot = async (
    page: Page,
    name: string,
    caption: string,
    viewport: { width: number; height: number },
    scheme: "light" | "dark",
  ): Promise<void> => {
    shots.push({ name, caption, viewport, scheme, png: await page.screenshot({ scale: "device" }) });
  };

  // ---------------------------------------------------- desktop, split pane
  const desktop = await newContext(context, DESKTOP_VIEWPORT, "light", false);
  const desktopPage = await desktop.newPage();
  await desktopPage.goto("/", { waitUntil: "domcontentloaded" });
  await waitForDirectory(desktopPage);

  // Open a read-but-unanswered conversation so the right pane is never the
  // "Select a conversation" placeholder, without spending anyone's unread badge.
  await openThread(desktopPage, READ_UNRESPONDED_NAME);

  await shoot(desktopPage, "desktop-01-unresponded", "Split pane, default Unresponded lens — the conversations that owe a reply, with unread badges intact", DESKTOP_VIEWPORT, "light");

  await selectLens(desktopPage, "Unread");
  await shoot(desktopPage, "desktop-02-unread", "Unread lens — only conversations carrying unread messages", DESKTOP_VIEWPORT, "light");

  await selectLens(desktopPage, "Waiting");
  await shoot(desktopPage, "desktop-03-waiting", "Waiting lens — you sent last, they owe you", DESKTOP_VIEWPORT, "light");

  await selectLens(desktopPage, "Archived");
  await shoot(desktopPage, "desktop-04-archived", "Archived lens — Overlay-only state, hidden from every other lens", DESKTOP_VIEWPORT, "light");

  await selectLens(desktopPage, "All");
  await shoot(desktopPage, "desktop-05-all", "All lens — the full unarchived directory", DESKTOP_VIEWPORT, "light");

  await desktopPage.getByRole("button", { name: "Filter conversations" }).click();
  await settle(desktopPage);
  await shoot(desktopPage, "desktop-06-filters", "Filter popover, anchored to its button on desktop: state lenses over participant type", DESKTOP_VIEWPORT, "light");
  await desktopPage.keyboard.press("Escape");
  await settle(desktopPage);

  await selectLens(desktopPage, "Unresponded");
  await desktop.close();

  // ------------------------------------------------------ desktop, dark mode
  const desktopDark = await newContext(context, DESKTOP_VIEWPORT, "dark", false);
  const darkPage = await desktopDark.newPage();
  await darkPage.goto("/", { waitUntil: "domcontentloaded" });
  await waitForDirectory(darkPage);
  await openThread(darkPage, READ_UNRESPONDED_NAME);
  await shoot(darkPage, "desktop-07-dark", "Same split pane in dark mode — the app follows the system scheme", DESKTOP_VIEWPORT, "dark");
  await desktopDark.close();

  // ------------------------------------------------- mobile, list then thread
  const mobile = await newContext(context, MOBILE_VIEWPORT, "light", true);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto("/", { waitUntil: "domcontentloaded" });
  await waitForDirectory(mobilePage);

  await shoot(mobilePage, "mobile-01-unresponded", "Mobile list, default Unresponded lens — no split pane, the list owns the screen", MOBILE_VIEWPORT, "light");

  await selectLens(mobilePage, "Unread");
  await shoot(mobilePage, "mobile-02-unread", "Mobile Unread lens", MOBILE_VIEWPORT, "light");

  await selectLens(mobilePage, "Waiting");
  await shoot(mobilePage, "mobile-03-waiting", "Mobile Waiting lens", MOBILE_VIEWPORT, "light");

  await selectLens(mobilePage, "Archived");
  await shoot(mobilePage, "mobile-04-archived", "Mobile Archived lens", MOBILE_VIEWPORT, "light");

  await mobilePage.getByRole("button", { name: "Filter conversations" }).click();
  await settle(mobilePage);
  await shoot(mobilePage, "mobile-05-filters", "The same filters as a bottom sheet — the mobile half of the filter surface", MOBILE_VIEWPORT, "light");
  await mobilePage.keyboard.press("Escape");
  await settle(mobilePage);
  await selectLens(mobilePage, "Unresponded");

  // ------------------------------------------------------------ open threads
  // Last, because opening these spends their unread badges.
  await openThread(mobilePage, GROUP_THREAD_NAME);
  await shoot(mobilePage, "mobile-06-thread-group", `Thread pushed over the list: the ${GROUP_THREAD_NAME} group, multiple senders, tapbacks folded onto their targets`, MOBILE_VIEWPORT, "light");
  await mobile.close();

  const desktopThread = await newContext(context, DESKTOP_VIEWPORT, "light", false);
  const threadPage = await desktopThread.newPage();
  await threadPage.goto("/", { waitUntil: "domcontentloaded" });
  await waitForDirectory(threadPage);
  await openThread(threadPage, DM_THREAD_NAME);
  await shoot(threadPage, "desktop-08-thread-dm", `Desktop split pane with the ${DM_THREAD_NAME} DM open — list and thread side by side`, DESKTOP_VIEWPORT, "light");
  await desktopThread.close();

  return shots;
}

/** Guids the shot list depends on; exported so the entry point can assert them. */
export const REQUIRED_THREADS = [FIXTURE_GROUP_THREAD_GUID, FIXTURE_DM_THREAD_GUID] as const;
