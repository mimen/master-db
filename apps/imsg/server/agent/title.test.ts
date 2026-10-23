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
      model: TITLE_MODEL, max_tokens: 100, system: TITLE_PROMPT,
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

  test("returns null for an error status, malformed JSON, a missing or empty title, or a network failure", async () => {
    const failures: (Response | (() => Promise<Response>))[] = [
      new Response("busy", { status: 529 }),
      message("Halloween guest list"),
      message('{"name": "x"}'),
      message('{"title": "   "}'),
      Response.json({ error: "no content" }),
      async () => { throw new Error("connection refused"); },
    ];
    for (const reply of failures) expect(await chatTitle("hi", gateway(reply).deps)).toBeNull();
  });
});
