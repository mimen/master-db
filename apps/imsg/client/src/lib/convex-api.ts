import type { api } from "@convex-api";
import { anyApi } from "convex/server";

export const commaApi = anyApi.comma.queries as unknown as typeof api.comma.queries;
export const commaDraftsApi = anyApi.comma.drafts as unknown as typeof api.comma.drafts;
export const commaOutbox = anyApi.comma.outbox as unknown as typeof api.comma.outbox;
