import { describe, expect, test } from "bun:test";
import { chatTitle, TITLE_MODEL, TITLE_PROMPT } from "./title";

function gateway(reply: Response | (() => Promise<Response>)) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return typeof reply === "function" ? await reply() : reply;
  };
  return { requests, deps: { fetch, baseUrl: "http://gateway.test", apiKey: "gateway-key" } };
}
const message = (text: string) => Response.json({ content: [{ type: "text", text }] });

describe("chatTitle", () => {
  test("asks Haiku on the gateway with the adapted T3 prompt and returns the title", async () => {
    const { requests, deps } = gateway(message('{"title": "Halloween guest list", "needsRefinement": false}'));
    expect(await chatTitle("add Jesse and Rebecca to the guest list for friday", deps)).toBe("Halloween guest list");
    const [{ url, init }] = requests;
    expect(url).toBe("http://gateway.test/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "gateway-key", "anthropic-version": "2023-06-01" });
    expect(JSON.parse(String(init.body))).toEqual({
      model: TITLE_MODEL, max_tokens: 100, thinking: { type: "disabled" }, system: TITLE_PROMPT,
      messages: [{ role: "user", content: "add Jesse and Rebecca to the guest list for friday" }],
    });
    expect(TITLE_MODEL).toBe("claude-haiku-5-5");
    expect(TITLE_PROMPT).toContain("Comma agent chat");
    expect(TITLE_PROMPT).toContain("Leave out the name of the person the conversation is with");
    expect(TITLE_PROMPT).not.toMatch(/T3 Code|branch|PR\b/);
  });

  test("reads a fenced block, trims, and clips to 40 characters", async () => {
    const fenced = "```json\n{\"title\": \"  Venue walkthrough and final arrival time for the crew  \"}\n```";
    const title = await chatTitle("when do we arrive", gateway(message(fenced)).deps);
    expect(title).toBe("Venue walkthrough and final arrival time");
    expect(title!.length).toBeLessThanOrEqual(40);
  });

  test("rejects with the status, an unreadable reply or the network error, never the key or the ask", async () => {
    const ask = "add rebecca@example.com to the guest list";
    const why = (reply: Response | (() => Promise<Response>)) => chatTitle(ask, gateway(reply).deps).then(() => "resolved", String);
    expect(await why(new Response("busy", { status: 529 }))).toBe("Error: HTTP 529");
    for (const reply of [message("Halloween guest list"), Response.json({ error: "no content" }), new Response("<html>gateway</html>")]) {
      expect(await why(reply)).toBe("Error: the reply was not a JSON title");
    }
    expect(await why(async () => { throw new Error("connection refused"); })).toBe("Error: connection refused");
  });

  test("returns null for a missing or empty title", async () => {
    for (const reply of [message('{"name": "x"}'), message('{"title": "   "}')]) expect(await chatTitle("hi", gateway(reply).deps)).toBeNull();
  });
});
