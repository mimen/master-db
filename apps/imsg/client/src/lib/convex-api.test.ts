import { expect, test } from "bun:test";
import { getFunctionName, type FunctionArgs } from "convex/server";
import { commaApi, commaDraftsApi } from "./convex-api";

test("comma references resolve to the deployed query paths", () => {
  for (const name of [
    "listConversations", "getConversation", "resolveChat", "listMessages",
    "searchMessages", "listScheduled", "getDraft", "syncStatus",
  ] as const) {
    expect(getFunctionName(commaApi[name])).toBe(`comma/queries:${name}`);
  }
});

test("draft mutation references resolve to the deployed paths", () => {
  expect(getFunctionName(commaDraftsApi.setDraft)).toBe("comma/drafts:setDraft");
  expect(getFunctionName(commaDraftsApi.clearDraft)).toBe("comma/drafts:clearDraft");
});

function checkQueryTypes() {
  const args: FunctionArgs<typeof commaApi.resolveChat> = { chatGuid: "iMessage;-;+16195550101" };
  // @ts-expect-error Chat guids must be strings.
  const wrongArgs: FunctionArgs<typeof commaApi.resolveChat> = { chatGuid: 123 };
  // @ts-expect-error Missing query names must fail typechecking.
  void commaApi.missingQuery;
  return { args, wrongArgs };
}
void checkQueryTypes;
