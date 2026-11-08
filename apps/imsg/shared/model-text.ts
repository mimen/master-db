/**
 * What a platform adapter derives from one raw message at ingest so every model reads it cleanly
 * (`modelTextFields` in convex/schema/comma/validators.ts). The prompt formatter in server/ai/context.ts prefers
 * `modelText` over the message's `text`, and clips from its start.
 *
 * - `modelText`: the body as a model should read it, the new content first. Quoted history, signatures and HTML are
 *   gone (an email), markup is resolved to plain names and labels (Slack's `<@U123>`, `<#C1|name>`, `<url|label>`).
 *   Unset when the platform's text already reads that way.
 * - `subject`: an email's subject.
 * - `threadRef`: the thread inside the conversation the message belongs to, such as a Slack thread's root.
 */
export interface ModelText {
  modelText?: string;
  subject?: string;
  threadRef?: string;
}

/** One platform's derivation, from whatever its bridge receives. */
export type ToModelText<Raw> = (raw: Raw) => ModelText;
