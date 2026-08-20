import type { Result } from "../bluebubbles";
import type { ShadowBrief } from "../../shared/types";
import type { JsonValue } from "./smart-closer";

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

/** Strict cache/model parser. basedOnMessageGuid is supplied by the service, not trusted from AI. */
export function parseShadowBriefContent(
  value: JsonValue,
): Result<Omit<ShadowBrief, "basedOnMessageGuid">> {
  if (!isRecord(value)) return { ok: false, error: "shadow brief must be an object" };
  const keys = Object.keys(value);
  if (keys.length !== 3 || !keys.every((key) => ["context", "actionItems", "draft"].includes(key))) {
    return { ok: false, error: "invalid shadow brief fields" };
  }
  if (typeof value.context !== "string" || typeof value.draft !== "string") {
    return { ok: false, error: "shadow brief context and draft must be strings" };
  }
  if (!Array.isArray(value.actionItems) || !value.actionItems.every((item) => typeof item === "string")) {
    return { ok: false, error: "shadow brief actionItems must be strings" };
  }
  return {
    ok: true,
    value: {
      context: value.context.trim(),
      actionItems: value.actionItems.map((item) => item.trim()).filter(Boolean),
      draft: value.draft.trim(),
    },
  };
}

export function parseShadowBriefJson(
  payload: string,
): Result<Omit<ShadowBrief, "basedOnMessageGuid">> {
  try {
    return parseShadowBriefContent(JSON.parse(payload) as JsonValue);
  } catch {
    return { ok: false, error: "shadow brief JSON is invalid" };
  }
}
