import { makeFunctionReference, type FunctionArgs, type FunctionReturnType } from "convex/server";

import type { commaApi } from "./convex-api";

export type MessageWindowArgs = {
  conversationId: FunctionArgs<typeof commaApi.listMessages>["conversationId"];
  before?: number;
  after?: number;
  around?: number;
};

export const messageWindow = makeFunctionReference<
  "query", MessageWindowArgs, FunctionReturnType<typeof commaApi.listMessages>["page"]
>("comma/history:messageWindow");

export const searchMessages = makeFunctionReference<
  "query",
  FunctionArgs<typeof commaApi.searchMessages> & { from?: "me" | "them" },
  FunctionReturnType<typeof commaApi.searchMessages>
>("comma/queries:searchMessages");
