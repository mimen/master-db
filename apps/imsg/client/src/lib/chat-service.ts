/**
 * Which conversations get green (SMS-style) bubbles rather than blue iMessage
 * ones, decided from the chat guid's service prefix.
 *
 * BOTH "SMS" and "RCS" count. BlueBubbles labels RCS conversations
 * "RCS;-;+1555..." but reports their individual messages as service "SMS", so
 * a settled message renders green either way (bubble.tsx keys off the
 * message's service, not the chat guid). Matching only "SMS" here meant every
 * OPTIMISTIC message in an RCS chat was stamped "iMessage" and drawn blue,
 * then snapped green the instant the real message came back. RCS is the
 * majority of green chats in practice (53 vs 16 at time of writing), so that
 * flash hit nearly every green send.
 *
 * Lives here rather than in composer.tsx so it's unit-testable — importing a
 * component module under bun:test pulls in react-native and fails to parse
 * (same reason lib/contact-order.ts and lib/forward-targets.ts exist).
 */
export function chatIsSMS(chatGuid: string): boolean {
  return chatGuid.startsWith("SMS") || chatGuid.startsWith("RCS");
}
