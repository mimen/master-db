import { describe, expect, test } from "bun:test";

import {
  bundleStampFromHtml,
  composerIsBusy,
  currentBundleStamp,
  installDeployReloader,
  shouldReloadForDeploy,
} from "./deploy-reload";

const OLD_SRC = "/_expo/static/js/web/entry-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js";
const NEW_SRC = "/_expo/static/js/web/entry-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.js";

describe("bundle stamps", () => {
  test("extracts the hashed Expo entry from HTML", () => {
    expect(bundleStampFromHtml(`<script src="${OLD_SRC}"></script>`)).toBe(OLD_SRC);
    expect(bundleStampFromHtml("<html></html>")).toBeNull();
  });

  test("reads the stamp from the live document", () => {
    const script = { getAttribute: (name: string) => (name === "src" ? OLD_SRC : null) };
    const doc = {
      querySelectorAll: () => [script],
    } as unknown as Document;
    expect(currentBundleStamp(doc)).toBe(OLD_SRC);
  });

  test("reloads only when both stamps exist and differ", () => {
    expect(shouldReloadForDeploy(OLD_SRC, NEW_SRC)).toBe(true);
    expect(shouldReloadForDeploy(OLD_SRC, OLD_SRC)).toBe(false);
    expect(shouldReloadForDeploy(null, NEW_SRC)).toBe(false);
    expect(shouldReloadForDeploy(OLD_SRC, null)).toBe(false);
  });
});

describe("composerIsBusy", () => {
  test("true for inputs, textareas, and contenteditable", () => {
    const make = (tag: string, attrs: Record<string, string> = {}): Document =>
      ({
        activeElement: {
          tagName: tag,
          getAttribute: (name: string) => attrs[name] ?? null,
        },
      }) as unknown as Document;
    expect(composerIsBusy(make("INPUT"))).toBe(true);
    expect(composerIsBusy(make("TEXTAREA"))).toBe(true);
    expect(composerIsBusy(make("DIV", { contenteditable: "true" }))).toBe(true);
    expect(composerIsBusy(make("DIV"))).toBe(false);
    expect(composerIsBusy({ activeElement: null } as unknown as Document)).toBe(false);
  });
});

describe("installDeployReloader", () => {
  test("reloads when a newer bundle is served and the composer is idle", async () => {
    let reloads = 0;
    const script = { getAttribute: (name: string) => (name === "src" ? OLD_SRC : null) };
    const listeners = new Map<string, () => void>();
    const doc = {
      querySelectorAll: () => [script],
      visibilityState: "visible",
      activeElement: { tagName: "BODY", getAttribute: () => null },
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Document;

    const uninstall = installDeployReloader({
      document: doc,
      fetchHtml: async () => `<script src="${NEW_SRC}"></script>`,
      reload: () => {
        reloads += 1;
      },
      intervalMs: 60_000,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(reloads).toBe(1);
    uninstall();
  });

  test("does not reload while the composer is focused", async () => {
    let reloads = 0;
    const script = { getAttribute: (name: string) => (name === "src" ? OLD_SRC : null) };
    const doc = {
      querySelectorAll: () => [script],
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as Document;

    installDeployReloader({
      document: doc,
      fetchHtml: async () => `<script src="${NEW_SRC}"></script>`,
      reload: () => {
        reloads += 1;
      },
      nowBusy: () => true,
      intervalMs: 60_000,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(reloads).toBe(0);
  });
});
