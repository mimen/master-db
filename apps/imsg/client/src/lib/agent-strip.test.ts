import { describe, expect, test } from "bun:test";
import type { AgentChat, AgentEntry, AgentItem } from "./agent-api";
import { agentStripState } from "./agent-strip";

let ordinal = 0;
function item(entry: AgentEntry): AgentItem {
  ordinal += 1;
  return {
    _id: `item-${ordinal}` as AgentItem["_id"], _creationTime: ordinal, chatId: "chat" as AgentItem["chatId"],
    key: `k${ordinal}`, ordinal, entry, createdAt: ordinal, updatedAt: ordinal,
  };
}
const user = (text: string) => item({ kind: "user", text, steer: false });
const assistant = (text: string) => item({ kind: "assistant", text, streaming: false });

describe("state strip", () => {
  const chat = (state: AgentChat["state"]) => ({ state } as AgentChat);
  const draft = (used: boolean) => item({ kind: "draft", text: "hey", placed: "pane", used });

  test("asking beats working, and nothing shows for an idle chat with no draft", () => {
    expect(agentStripState(chat("waiting_input"), [])).toBe("asking");
    expect(agentStripState(chat("running"), [])).toBe("working");
    expect(agentStripState(chat("pending"), [])).toBe("working");
    expect(agentStripState(chat("idle"), [user("hi"), assistant("hello")])).toBeNull();
    expect(agentStripState(null, [draft(false)])).toBeNull();
  });

  test("only an unused draft from the latest turn counts", () => {
    expect(agentStripState(chat("idle"), [user("draft it"), draft(false)])).toBe("drafted");
    expect(agentStripState(chat("idle"), [user("draft it"), draft(true)])).toBeNull();
    expect(agentStripState(chat("idle"), [user("draft it"), draft(false), user("thanks"), assistant("np")])).toBeNull();
  });
});
