import { Hono } from "hono";
import { ulid } from "ulid";
import { z } from "zod";

import type { IdempotencyCache } from "../concurrency/idempotencyCache";
import type { PerEntityQueue } from "../concurrency/perEntityQueue";
import type { NdjsonAppender } from "../logging/ndjson";
import type { AgentRunner, CanonicalEvent } from "../runner/types";
import type { SourceRegistry } from "../sources/registry";
import { parseEntityRef } from "../sources/types";
import type { ConvexStore } from "../store/convex";
import type {
  DeliveryOpts,
  DeliveryResult,
  WebhookPayload,
} from "../webhook/deliver";

const RunBody = z.object({
  entity_ref: z.string().min(1),
  message: z.string().nullable().optional(),
  multitask_strategy: z
    .enum(["enqueue", "interrupt", "reject"])
    .optional()
    .default("enqueue"),
  webhook: z.string().url().nullable().optional(),
  webhook_token: z.string().nullable().optional(),
});

type RunBodyData = z.infer<typeof RunBody>;

interface AgenticRunRow {
  entity_ref: string;
  status: string;
  last_run_id: string | null;
  last_message_id: string | null;
  resume_cursor: unknown | null;
}

export interface RunRoutesDeps {
  store: ConvexStore;
  queue: PerEntityQueue;
  cache: IdempotencyCache;
  runner: AgentRunner;
  sources: SourceRegistry;
  ndjson: NdjsonAppender;
  webhookDeliver: (
    payload: WebhookPayload,
    opts?: DeliveryOpts,
  ) => Promise<DeliveryResult>;
}

interface Decision {
  status: 200 | 409;
  body: {
    entity_ref: string;
    run_id: string | null;
    status: string;
    accepted: boolean;
    reason?: string;
  };
}

export function createRunRoutes(deps: RunRoutesDeps): Hono {
  const app = new Hono();

  app.post("/run", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = RunBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    const idem =
      c.req.header("Idempotency-Key") ?? c.req.header("idempotency-key");
    const traceparent =
      c.req.header("traceparent") ?? c.req.header("Traceparent") ?? null;

    const decision = await deps.cache.runOnce(
      { key: idem, entity_ref: body.entity_ref, route: "POST /run" },
      async () => decideAndEnqueue(deps, body, traceparent),
    );
    return c.json(decision.body, decision.status);
  });

  return app;
}

async function decideAndEnqueue(
  deps: RunRoutesDeps,
  body: RunBodyData,
  traceparent: string | null,
): Promise<Decision> {
  const existingRun = (await deps.store.getRun(body.entity_ref)) as
    | AgenticRunRow
    | null;
  const busy = deps.queue.isBusy(body.entity_ref);

  if (!body.message && existingRun) {
    return {
      status: 200,
      body: {
        entity_ref: body.entity_ref,
        run_id: existingRun.last_run_id,
        status: existingRun.status,
        accepted: false,
      },
    };
  }

  if (body.multitask_strategy === "reject" && busy) {
    return {
      status: 409,
      body: {
        entity_ref: body.entity_ref,
        run_id: existingRun?.last_run_id ?? null,
        status: existingRun?.status ?? "discovering",
        accepted: false,
        reason: "busy",
      },
    };
  }

  if (body.multitask_strategy === "interrupt" && busy) {
    deps.queue.interrupt(body.entity_ref);
  }

  const run_id = ulid();
  deps.queue.enqueue(body.entity_ref, () =>
    executeRun({
      deps,
      entity_ref: body.entity_ref,
      run_id,
      message: body.message ?? null,
      traceparent,
      webhook: body.webhook ?? null,
      webhook_token: body.webhook_token ?? null,
      existingRun,
    }),
  );

  return {
    status: 200,
    body: {
      entity_ref: body.entity_ref,
      run_id,
      status: "discovering",
      accepted: true,
    },
  };
}

interface ExecuteRunArgs {
  deps: RunRoutesDeps;
  entity_ref: string;
  run_id: string;
  message: string | null;
  traceparent: string | null;
  webhook: string | null;
  webhook_token: string | null;
  existingRun: AgenticRunRow | null;
}

async function executeRun({
  deps,
  entity_ref,
  run_id,
  message,
  traceparent,
  webhook,
  webhook_token,
  existingRun,
}: ExecuteRunArgs): Promise<void> {
  const parsed = parseEntityRef(entity_ref);
  const resume_cursor = existingRun?.resume_cursor ?? null;

  await deps.store.upsertRun({
    entity_ref,
    entity_type: parsed.entity_type,
    entity_id: parsed.entity_id,
    backend: "claude_sdk",
    status: "discovering",
    run_id,
    traceparent,
    resume_cursor,
  });

  if (message) {
    await deps.store.appendThreadMessage({
      entity_ref,
      run_id,
      kind: "user_message",
      body_markdown: message,
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
  }

  const payload = await deps.sources.fetch(entity_ref);

  let lastMessageId: string | null = null;
  const activityIds = new Map<string, string>();

  const onEvent = async (e: CanonicalEvent): Promise<void> => {
    await deps.ndjson.append(entity_ref, { run_id, event: e });
    switch (e.type) {
      case "assistant_message":
      case "reasoning": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: e.type,
          body_markdown: e.body_markdown,
          proposal_json: null,
          error_json: null,
          token_usage:
            e.type === "assistant_message" ? (e.token_usage ?? null) : null,
          checkpoint_id: null,
        });
        return;
      }
      case "tool_call_started": {
        const id = await deps.store.startActivity({
          entity_ref,
          run_id,
          kind: "tool_call",
          name: e.name,
          input_json: e.input,
        });
        activityIds.set(e.activity_key, id);
        return;
      }
      case "tool_call_resolved": {
        const id = activityIds.get(e.activity_key);
        if (id) {
          await deps.store.resolveActivity({
            id,
            status: e.status,
            output_json: e.output,
          });
        }
        return;
      }
      case "proposal": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: "proposal",
          body_markdown: null,
          proposal_json: e.proposal,
          error_json: null,
          token_usage: null,
          checkpoint_id: e.checkpoint_id,
        });
        return;
      }
      case "execution_result":
      case "blocked": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: e.type,
          body_markdown: e.body_markdown,
          proposal_json: null,
          error_json: null,
          token_usage: null,
          checkpoint_id: e.checkpoint_id,
        });
        return;
      }
      case "error": {
        lastMessageId = await deps.store.appendThreadMessage({
          entity_ref,
          run_id,
          kind: "error",
          body_markdown: null,
          proposal_json: null,
          error_json: e.error,
          token_usage: null,
          checkpoint_id: null,
        });
        return;
      }
      case "user_message": {
        // Already recorded above; ignore if the runner re-emits.
        return;
      }
    }
  };

  let finalStatus: "awaiting_decision" | "error" = "awaiting_decision";
  let nextResumeCursor: unknown = resume_cursor;
  try {
    const result = await deps.runner.run({
      entity_ref,
      resume_cursor,
      entity_payload: payload,
      message,
      on_event: onEvent,
    });
    nextResumeCursor = result.resume_cursor;
    if (result.terminal.type === "error") finalStatus = "error";
  } catch (err) {
    finalStatus = "error";
    await onEvent({
      type: "error",
      error: { message: err instanceof Error ? err.message : String(err) },
    });
  }

  await deps.store.updateRunStatus({
    entity_ref,
    status: finalStatus,
    last_message_id: lastMessageId,
    resume_cursor: nextResumeCursor ?? null,
  });

  if (webhook && lastMessageId) {
    await deps.webhookDeliver({
      url: webhook,
      token: webhook_token,
      body: {
        entity_ref,
        run_id,
        status: finalStatus,
        terminal_message_id: lastMessageId,
      },
    });
  }
}
