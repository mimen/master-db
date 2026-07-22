import type { Result } from "../bluebubbles";
import type { AiConfig } from "../config";

/**
 * The fast lane: a direct Anthropic-messages POST to the local CLIProxyAPI
 * gateway, which fronts GPT models billed to the ChatGPT subscription. No
 * harness, no tools, no session — ~2s round trip against ~25k and ~8s for a
 * full Claude Code invocation, which is why every suggestion surface uses it.
 */

interface GatewayContentBlock {
  type: string;
  text?: string;
}

interface GatewayResponse {
  content?: GatewayContentBlock[];
}

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  /** Overrides the configured fast model. */
  model?: string;
  signal?: AbortSignal;
}

/**
 * Concatenates the text blocks of a single-turn completion. Thinking blocks
 * carry no `text` and drop out, which is what we want for structured replies.
 */
export function extractText(body: GatewayResponse): string {
  return (body.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

/**
 * Models narrate around JSON no matter how firmly the prompt asks them not to,
 * so recover the first balanced array/object rather than trusting the envelope.
 */
export function parseJsonBlock<T>(text: string): Result<T> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const source = candidate.trim();
    const starts = [source.indexOf("["), source.indexOf("{")].filter((i) => i >= 0);
    if (starts.length === 0) continue;
    const start = Math.min(...starts);
    const opener = source[start];
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = !inString;
      if (inString) continue;
      if (char === opener) depth++;
      else if (char === closer) {
        depth--;
        if (depth === 0) {
          try {
            return { ok: true, value: JSON.parse(source.slice(start, i + 1)) as T };
          } catch {
            break;
          }
        }
      }
    }
  }
  return { ok: false, error: "no parsable JSON in model output" };
}

export class Gateway {
  constructor(private config: AiConfig) {}

  /** False when no key is provisioned; callers degrade instead of erroring. */
  get available(): boolean {
    return this.config.gatewayKey.length > 0;
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<Result<string>> {
    if (!this.available) return { ok: false, error: "AI gateway key not configured" };

    try {
      const response = await fetch(`${this.config.gatewayUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.gatewayKey,
          "anthropic-version": "2023-06-01",
        },
        signal: options.signal,
        body: JSON.stringify({
          model: options.model ?? this.config.fastModel,
          max_tokens: options.maxTokens ?? 512,
          ...(options.system ? { system: options.system } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return { ok: false, error: `gateway ${response.status}: ${detail.slice(0, 200)}` };
      }

      const text = extractText((await response.json()) as GatewayResponse);
      if (!text) return { ok: false, error: "empty completion" };
      return { ok: true, value: text };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** `complete` plus JSON recovery, for the structured suggestion surfaces. */
  async completeJson<T>(prompt: string, options: CompleteOptions = {}): Promise<Result<T>> {
    const raw = await this.complete(prompt, options);
    if (!raw.ok) return raw;
    return parseJsonBlock<T>(raw.value);
  }
}
