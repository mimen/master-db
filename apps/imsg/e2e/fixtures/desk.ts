import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { CHAT_GUIDS } from "../fixture/world";

interface DeskFixture {
  readonly desk: {
    readonly chats: typeof CHAT_GUIDS;
    readonly page: Page;
    readonly request: APIRequestContext;
    receive(chatGuid: string, text: string, handle?: string): Promise<void>;
    setTyping(chatGuid: string, display: boolean): Promise<void>;
  };
}

export const test = base.extend<DeskFixture>({
  desk: async ({ page, request }, provide): Promise<void> => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "__IMSG_NATIVE_SHELL__", { value: true, enumerable: true });
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
      setTyping: async (chatGuid, display): Promise<void> => {
        const response = await request.post("/__fixture/typing", {
          data: { chatGuid, display },
        });
        expect(response.ok()).toBe(true);
      },
    });
  },
});

export { expect };
