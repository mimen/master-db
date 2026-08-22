import { expect, test } from "../fixtures/desk";

const RUNNING_WEB = "1111111111111111111111111111111111111111";
const DEPLOYED_WEB = "2222222222222222222222222222222222222222";
const RUNNING_SHELL = "3333333333333333333333333333333333333333";
const STAGED_SHELL = "4444444444444444444444444444444444444444";

test("release banners and Settings expose deployed, running, and staged identity", async ({ desk }) => {
  await desk.page.addInitScript(({ runningWeb, runningShell, stagedShell }) => {
    const releaseWindow = globalThis.window as Window & {
      __IMSG_RELEASE_BUILD__?: {
        environment: "preview";
        branch: string;
        webSha: string;
      };
      __TAURI__?: {
        core: { invoke<Result>(command: string): Promise<Result> };
        event: { listen(): Promise<() => void> };
        window: { getCurrentWindow(): { close(): Promise<void> } };
      };
    };
    releaseWindow.__IMSG_RELEASE_BUILD__ = {
      environment: "preview",
      branch: "feat/release-ui",
      webSha: runningWeb,
    };
    releaseWindow.__TAURI__ = {
      core: {
        invoke: async <Result,>(command: string): Promise<Result> => {
          if (command === "restart_to_staged_shell") {
            globalThis.document.documentElement.dataset.fixtureRestartRequested = "true";
            return null as Result;
          }
          return { runningSha: runningShell, stagedSha: stagedShell } as Result;
        },
      },
      event: { listen: async () => () => undefined },
      window: { getCurrentWindow: () => ({ close: async () => undefined }) },
    };
  }, { runningWeb: RUNNING_WEB, runningShell: RUNNING_SHELL, stagedShell: STAGED_SHELL });

  await desk.page.route("**/api/deploy/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        environment: "preview",
        branch: "feat/release-ui",
        webSha: DEPLOYED_WEB,
      }),
    });
  });

  await desk.page.setViewportSize({ width: 1440, height: 900 });
  await desk.page.goto("/", { waitUntil: "domcontentloaded" });

  const banners = desk.page.getByTestId("release-update-banners");
  await expect(banners.getByText("Web update ready")).toBeVisible();
  await expect(banners.getByRole("button", { name: "Reload web update" })).toBeVisible();
  await expect(banners.getByText("Shell update ready")).toBeVisible();

  await desk.page.getByRole("button", { name: "Settings" }).first().click();
  const footer = desk.page.getByTestId("release-identity-footer");
  await expect(footer).toContainText("preview");
  await expect(footer).toContainText("feat/release-ui");
  await expect(footer).toContainText(RUNNING_WEB.slice(0, 12));
  await expect(footer).toContainText(DEPLOYED_WEB.slice(0, 12));
  await expect(footer).toContainText(RUNNING_SHELL.slice(0, 12));
  await expect(footer).toContainText(STAGED_SHELL.slice(0, 12));

  await desk.page.screenshot({
    path: "/tmp/comma-release-activation.png",
    animations: "disabled",
  });

  await banners.getByRole("button", { name: "Restart into staged shell update" }).click();
  await expect.poll(() => desk.page.evaluate(
    () => globalThis.document.documentElement.dataset.fixtureRestartRequested,
  )).toBe("true");
});
