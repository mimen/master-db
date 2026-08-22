import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { CHAT_GUIDS } from "../fixture/world";

interface DeskFixture {
  readonly desk: {
    readonly chats: typeof CHAT_GUIDS;
    readonly page: Page;
    readonly request: APIRequestContext;
    receive(chatGuid: string, text: string, handle?: string): Promise<void>;
  };
}

export const test = base.extend<DeskFixture>({
  desk: async ({ page, request }, provide): Promise<void> => {
    await page.addInitScript(() => {
      let fullscreen = false;
      const resized = new Set<() => void>();
      const currentWindow = {
        close: async (): Promise<void> => undefined,
        isFullscreen: async (): Promise<boolean> => fullscreen,
        onResized: async (handler: () => void): Promise<() => void> => {
          resized.add(handler);
          return () => {
            resized.delete(handler);
          };
        },
      };
      const target = window as Window & {
        __fixtureHasFullscreenListener?: () => boolean;
        __fixtureSetFullscreen?: (value: boolean) => void;
        __TAURI__?: {
          event: { listen: () => Promise<() => void> };
          window: { getCurrentWindow: () => typeof currentWindow };
        };
      };
      Object.defineProperty(target, "__IMSG_NATIVE_SHELL__", { value: true, enumerable: true });
      target.__fixtureHasFullscreenListener = (): boolean => resized.size > 0;
      target.__fixtureSetFullscreen = (value: boolean): void => {
        fullscreen = value;
        for (const handler of resized) handler();
      };
      target.__TAURI__ = {
        event: { listen: async () => () => undefined },
        window: { getCurrentWindow: () => currentWindow },
      };
    });
    const reset = await request.post("/__fixture/reset");
    expect(reset.ok()).toBe(true);

    await provide({
      chats: CHAT_GUIDS,
      page,
      request,
      receive: async (chatGuid, text, handle): Promise<void> => {
        const response = await request.post("/__fixture/receive", {
          data: { chatGuid, text, handle },
        });
        expect(response.ok()).toBe(true);
      },
    });
  },
});

export { expect };
