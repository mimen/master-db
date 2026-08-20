import type { Result } from "../bluebubbles";
import type { SmartCloser } from "../../shared/types";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const KINDS = ["reply", "done", "later", "call", "react_done", "archive"] as const;
type SmartCloserKind = (typeof KINDS)[number];

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function exactKeys(value: { [key: string]: JsonValue }, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function nonEmptyString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Strictly validates the model/cache payload into the public discriminated union. */
export function parseSmartCloser(value: JsonValue): Result<SmartCloser> {
  if (!isRecord(value)) return { ok: false, error: "smart closer must be an object" };
  const kind = value.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as SmartCloserKind)) {
    return { ok: false, error: "invalid smart closer kind" };
  }
  const label = nonEmptyString(value.label);
  if (!label) return { ok: false, error: "smart closer label is required" };

  switch (kind) {
    case "reply": {
      if (!exactKeys(value, ["kind", "label", "draft"])) return { ok: false, error: "invalid reply fields" };
      const draft = value.draft === undefined ? null : nonEmptyString(value.draft);
      if (value.draft !== undefined && !draft) return { ok: false, error: "reply draft must be non-empty" };
      return { ok: true, value: draft ? { kind, label, draft } : { kind, label } };
    }
    case "react_done": {
      if (!exactKeys(value, ["kind", "label", "reaction"])) {
        return { ok: false, error: "invalid react_done fields" };
      }
      const reaction = value.reaction === undefined ? null : nonEmptyString(value.reaction);
      if (value.reaction !== undefined && !reaction) {
        return { ok: false, error: "reaction must be non-empty" };
      }
      return { ok: true, value: reaction ? { kind, label, reaction } : { kind, label } };
    }
    case "done":
    case "later":
    case "call":
    case "archive":
      if (!exactKeys(value, ["kind", "label"])) return { ok: false, error: `invalid ${kind} fields` };
      return { ok: true, value: { kind, label } };
    default:
      return { ok: false, error: "invalid smart closer kind" };
  }
}

export function parseSmartCloserJson(payload: string): Result<SmartCloser> {
  try {
    return parseSmartCloser(JSON.parse(payload) as JsonValue);
  } catch {
    return { ok: false, error: "smart closer JSON is invalid" };
  }
}

/** Offline behavior is intentionally limited to the two safe, non-sending choices. */
export function deterministicSmartCloser(text: string): SmartCloser {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/g, "");
  const done = /^(thanks|thank you|thx|ty|ok|okay|got it|sounds good|perfect|cool|great|👍|❤️|❤)$/.test(
    normalized,
  );
  return done ? { kind: "done", label: "Done" } : { kind: "reply", label: "Reply" };
}
