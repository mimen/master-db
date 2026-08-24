import Anthropic from "@anthropic-ai/sdk";
import type { Result } from "../bluebubbles";
import type { AiConfig } from "../config";

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

export type GatewayFailureKind =
  | "provider"
  | "shared"
  | "timeout"
  | "invalid-output"
  | "schema-unsupported";

export interface GatewayFailure {
  kind: GatewayFailureKind;
  message: string;
  status: number | null;
  retryAfterMs: number | null;
}

export type GatewayResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GatewayFailure };

export interface StructuredOptions {
  model: string;
  maxTokens: number;
  timeoutMs: number;
  effort?: "low" | "medium" | "high";
}

/** Concatenates visible text blocks; thinking blocks intentionally drop out. */
export function extractText(body: GatewayResponse): string {
  return (body.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

/** Recover the first balanced JSON array or object from model output. */
export function parseJsonBlock<T>(text: string): Result<T> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const source = candidate.trim();
    const starts = [source.indexOf("["), source.indexOf("{")].filter((index) => index >= 0);
    if (starts.length === 0) continue;
    const start = Math.min(...starts);
    const opener = source[start];
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index++) {
      const char = source[index];
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
            return { ok: true, value: JSON.parse(source.slice(start, index + 1)) as T };
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
  private client: Anthropic | null;
  private structuredUnsupported = new Set<string>();

  constructor(private config: AiConfig) {
    this.client = this.available
      ? new Anthropic({
          apiKey: config.gatewayKey,
          baseURL: config.gatewayUrl,
          maxRetries: 0,
        })
      : null;
  }

  get available(): boolean {
    return this.config.gatewayKey.length > 0;
  }

  async complete(prompt: string, options: CompleteOptions = {}): Promise<Result<string>> {
    if (!this.client) return { ok: false, error: "AI gateway key not configured" };
    try {
      const response = await this.client.messages.create(
        {
          model: options.model ?? this.config.fastModel,
          max_tokens: options.maxTokens ?? 512,
          ...(options.system ? { system: options.system } : {}),
          messages: [{ role: "user", content: prompt }],
        },
        options.signal ? { signal: options.signal } : undefined,
      );
      const text = extractText(response);
      return text ? { ok: true, value: text } : { ok: false, error: "empty completion" };
    } catch (error) {
      return { ok: false, error: failureFrom(error).message };
    }
  }

  async completeJson<T>(prompt: string, options: CompleteOptions = {}): Promise<Result<T>> {
    const raw = await this.complete(prompt, options);
    if (!raw.ok) return raw;
    return parseJsonBlock<T>(raw.value);
  }

  async completeStructured<T>(
    prompt: string,
    schema: Anthropic.Messages.JSONOutputFormat["schema"],
    options: StructuredOptions,
  ): Promise<GatewayResult<T>> {
    if (!this.client) {
      return failure("shared", "AI gateway key not configured", null, null);
    }

    const structured = !this.structuredUnsupported.has(options.model);
    const first = await this.requestStructured<T>(prompt, schema, options, structured);
    if (first.ok || !structured || first.error.kind !== "schema-unsupported") return first;

    this.structuredUnsupported.add(options.model);
    return this.requestStructured<T>(prompt, schema, options, false);
  }

  private async requestStructured<T>(
    prompt: string,
    schema: Anthropic.Messages.JSONOutputFormat["schema"],
    options: StructuredOptions,
    structured: boolean,
  ): Promise<GatewayResult<T>> {
    if (!this.client) return failure("shared", "AI gateway key not configured", null, null);
    const signal = AbortSignal.timeout(options.timeoutMs);
    try {
      const response = await this.client.messages.create(
        {
          model: options.model,
          max_tokens: options.maxTokens,
          cache_control: { type: "ephemeral" },
          ...(options.model === "claude-opus-5"
            ? {
                thinking: { type: "adaptive" as const },
                output_config: {
                  ...(options.effort ? { effort: options.effort } : {}),
                  ...(structured ? { format: { type: "json_schema" as const, schema } } : {}),
                },
              }
            : structured
              ? { output_config: { format: { type: "json_schema" as const, schema } } }
              : {}),
          messages: [{ role: "user", content: prompt }],
        },
        { signal },
      );
      if (response.stop_reason === "refusal") {
        return failure("provider", "model refused the suggestion request", null, null);
      }
      const text = extractText(response);
      if (!text) return failure("invalid-output", "empty completion", null, null);
      const parsed = parseJsonBlock<T>(text);
      if (!parsed.ok) return failure("invalid-output", parsed.error, null, null);
      return parsed;
    } catch (error) {
      const parsed = failureFrom(error);
      if (
        structured &&
        parsed.status === 400 &&
        /output_config|json_schema|structured output|format\.schema/i.test(parsed.message)
      ) {
        return failure("schema-unsupported", parsed.message, parsed.status, parsed.retryAfterMs);
      }
      return { ok: false, error: parsed };
    }
  }
}

function failureFrom(error: unknown): GatewayFailure {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { kind: "timeout", message: "suggestion model timed out", status: null, retryAfterMs: null };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    const timeout = /timed? ?out|abort/i.test(error.message);
    return {
      kind: timeout ? "timeout" : "shared",
      message: error.message,
      status: null,
      retryAfterMs: null,
    };
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? null;
    const message = error.message;
    const retryAfterMs = parseRetryAfter(error.headers?.get("retry-after") ?? null);
    if (status === 429 || /usage credits|quota|rate limit|upstream.*unavailable|model.*unavailable|unknown provider|provider.*model/i.test(message)) {
      return { kind: "provider", message, status, retryAfterMs };
    }
    if (
      (status === 401 || status === 403) &&
      /anthropic|claude|chatgpt|openai|provider|oauth|credential source/i.test(message)
    ) {
      return { kind: "provider", message, status, retryAfterMs };
    }
    return { kind: "shared", message, status, retryAfterMs };
  }
  return {
    kind: "shared",
    message: error instanceof Error ? error.message : String(error),
    status: null,
    retryAfterMs: null,
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function failure(
  kind: GatewayFailureKind,
  message: string,
  status: number | null,
  retryAfterMs: number | null,
): GatewayResult<never> {
  return { ok: false, error: { kind, message, status, retryAfterMs } };
}
