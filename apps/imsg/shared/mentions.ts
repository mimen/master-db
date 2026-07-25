export interface MentionAnnotation {
  /** UTF-16 code-unit offset, matching NSRange and JavaScript string indices. */
  start: number;
  /** UTF-16 code-unit length. */
  length: number;
  address: string;
}

/**
 * Repositions annotations for an edit outside them and invalidates any mention
 * whose text was edited internally. The single-diff model matches TextInput's
 * old-value/new-value contract and uses UTF-16 offsets throughout.
 */
export function reconcileMentionAnnotations(
  previousText: string,
  nextText: string,
  mentions: readonly MentionAnnotation[],
): MentionAnnotation[] {
  if (mentions.length === 0 || previousText === nextText) return [...mentions];

  let prefix = 0;
  const prefixLimit = Math.min(previousText.length, nextText.length);
  while (prefix < prefixLimit && previousText[prefix] === nextText[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < previousText.length - prefix &&
    suffix < nextText.length - prefix &&
    previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldStart = prefix;
  const oldEnd = previousText.length - suffix;
  const newEnd = nextText.length - suffix;
  const delta = newEnd - oldEnd;
  const insertion = oldStart === oldEnd;
  const next: MentionAnnotation[] = [];

  for (const mention of mentions) {
    const mentionEnd = mention.start + mention.length;
    const touchesMention = insertion
      ? oldStart > mention.start && oldStart < mentionEnd
      : oldStart < mentionEnd && oldEnd > mention.start;
    if (touchesMention) continue;

    const editBeforeMention = insertion ? oldStart <= mention.start : oldEnd <= mention.start;
    next.push(editBeforeMention ? { ...mention, start: mention.start + delta } : { ...mention });
  }
  return next;
}

export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/** Returns the active @ token ending at the current UTF-16 cursor. */
export function mentionQueryAt(text: string, cursor: number): MentionQuery | null {
  if (cursor < 0 || cursor > text.length) return null;
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: at, end: cursor, query };
}

export function trimMentionAnnotations(
  text: string,
  mentions: readonly MentionAnnotation[],
): { text: string; mentions: MentionAnnotation[] } {
  const trimmed = text.trim();
  const leading = text.length - text.trimStart().length;
  const end = leading + trimmed.length;
  return {
    text: trimmed,
    mentions: mentions
      .filter((mention) => mention.start >= leading && mention.start + mention.length <= end)
      .map((mention) => ({ ...mention, start: mention.start - leading })),
  };
}
