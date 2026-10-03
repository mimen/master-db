import type { api } from "@convex-api";
import { anyApi } from "convex/server";

export const commaApi = anyApi.comma.queries as unknown as typeof api.comma.queries;
