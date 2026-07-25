import type { MentionAnnotation } from "../shared/mentions";
import type { BBAttributedBody, BBAttributedBodyRun } from "./bb-types";

export type MentionBodyResult =
  | { ok: true; value: BBAttributedBody }
  | { ok: false; error: string };

function sortedMentions(mentions: readonly MentionAnnotation[]): MentionAnnotation[] {
  return [...mentions].sort((a, b) => a.start - b.start || a.length - b.length);
}

/** Builds the exact attributed-body object accepted by BlueBubbles 1.9.9. */
export function buildMentionAttributedBody(
  text: string,
  mentions: readonly MentionAnnotation[],
): MentionBodyResult {
  if (mentions.length === 0) return { ok: true, value: { string: text, runs: [] } };

  const sorted = sortedMentions(mentions);
  let cursor = 0;
  const runs: BBAttributedBodyRun[] = [];
  for (const mention of sorted) {
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.length)) {
      return { ok: false, error: "mention ranges must be integers" };
    }
    if (mention.start < 0 || mention.length <= 0 || mention.start + mention.length > text.length) {
      return { ok: false, error: "mention range is outside the message" };
    }
    if (!mention.address.trim()) return { ok: false, error: "mention address is required" };
    if (mention.start < cursor) return { ok: false, error: "mention ranges overlap" };

    if (mention.start > cursor) {
      runs.push({
        range: [cursor, mention.start - cursor],
        attributes: { __kIMMessagePartAttributeName: 0 },
      });
    }
    runs.push({
      range: [mention.start, mention.length],
      attributes: {
        __kIMMessagePartAttributeName: 0,
        __kIMMentionConfirmedMention: mention.address,
      },
    });
    cursor = mention.start + mention.length;
  }

  if (cursor < text.length) {
    runs.push({
      range: [cursor, text.length - cursor],
      attributes: { __kIMMessagePartAttributeName: 0 },
    });
  }
  return { ok: true, value: { string: text, runs } };
}
