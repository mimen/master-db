import { Hono } from "hono";

import { bearerAuth } from "./auth";
import { createIdempotencyCache } from "./concurrency/idempotencyCache";
import { createPerEntityQueue, type PerEntityQueue } from "./concurrency/perEntityQueue";
import { loadEnv } from "./env";
import { createLogger } from "./logging/logger";
import { createNdjsonAppender } from "./logging/ndjson";
import { createHealthRoute } from "./routes/health";
import { createInterruptRoute } from "./routes/interrupt";
import { createReadRoutes } from "./routes/readRun";
import { createRunRoutes } from "./routes/run";
import { createClaudeSdkRunner } from "./runner/claudeSdkRunner";
import type { AgentRunner } from "./runner/types";
import { createSourceRegistry } from "./sources/registry";
import { createTodoistTaskSource } from "./sources/todoistTask";
import { createConvexStore, type ConvexClientLike } from "./store/convex";
import { deliverWebhook } from "./webhook/deliver";

export interface BuildServerOpts {
  token: string;
  convexClient: ConvexClientLike;
  runner: AgentRunner;
  sources: { fetch: (entity_ref: string) => Promise<unknown> };
  logDir: string;
  now?: () => number;
}

export function buildServer(opts: BuildServerOpts): Hono {
  const startedAt = opts.now?.() ?? Date.now();
  const log = createLogger();
  const ndjson = createNdjsonAppender({ baseDir: opts.logDir });
  const cache = createIdempotencyCache({ ttlMs: 24 * 60 * 60 * 1000 });
  const store = createConvexStore(opts.convexClient);

  let inflight = 0;
  let lastError: { ts: number; message: string } | null = null;

  const queue = createPerEntityQueue({
    onInterrupt: async (ref) => opts.runner.interrupt(ref),
  });

  const wrappedQueue: PerEntityQueue = {
    ...queue,
    enqueue(entity_ref, task) {
      inflight++;
      const settled = queue.enqueue(entity_ref, async () => {
        try {
          return await task();
        } catch (e) {
          lastError = {
            ts: Date.now(),
            message: e instanceof Error ? e.message : String(e),
          };
          throw e;
        } finally {
          inflight--;
        }
      });
      // Prevent unhandled-rejection when callers fire-and-forget (POST /run enqueues
      // without awaiting). The error is already captured in `lastError`; propagating
      // it further would produce noise and cause test suite failures.
      settled.catch(() => {});
      return settled;
    },
  };

  const app = new Hono();

  app.route(
    "/",
    createHealthRoute({
      startedAt,
      inflightCount: () => inflight,
      lastError: () => lastError,
      convexOk: () => true,
    }),
  );

  const protectedApp = new Hono();
  protectedApp.use("*", bearerAuth(opts.token));
  protectedApp.route(
    "/",
    createRunRoutes({
      store,
      queue: wrappedQueue,
      cache,
      runner: opts.runner,
      sources: opts.sources,
      ndjson,
      webhookDeliver: deliverWebhook,
    }),
  );
  protectedApp.route(
    "/",
    createReadRoutes({
      store,
      isBusy: (ref) => queue.isBusy(ref),
    }),
  );
  protectedApp.route(
    "/",
    createInterruptRoute({ queue: wrappedQueue, store }),
  );

  app.route("/", protectedApp);

  app.onError((err, c) => {
    log.error("unhandled", { err });
    return c.json({ error: err.message }, 500);
  });

  return app;
}

// Bun-only entry point — only fires when this file is run directly, not when imported by tests.
if (import.meta.main) {
  const env = loadEnv();
  const log = createLogger();
  // Lazy import the real Convex client at boot to avoid pulling its types into test environments.
  const { ConvexHttpClient } = await import("convex/browser");
  const convexClient = new ConvexHttpClient(env.convexUrl);
  // Backend service auth: when CONVEX_DEPLOY_KEY is set, impersonate the
  // single allowed user so auth-gated queries/mutations let the engine through.
  // The deploy key authenticates us as a deployment admin; `actingAs` populates
  // identity.email which `assertAllowed` fast-paths on.
  if (env.convexDeployKey) {
    // setAdminAuth exists at runtime (used by Convex CLI internally) but is
    // not exposed in @convex/browser's .d.ts. Cast through to call it.
    // The `actingAs` payload populates ctx.auth.getUserIdentity() inside
    // Convex functions, letting `assertAllowed` fast-path on identity.email.
    const adminClient = convexClient as unknown as {
      setAdminAuth(
        token: string,
        actingAs?: { tokenIdentifier: string; subject: string; issuer: string; email?: string; name?: string },
      ): void;
    };
    adminClient.setAdminAuth(env.convexDeployKey, {
      tokenIdentifier: "engine-service",
      subject: "engine-service",
      issuer: "agentic-engine",
      email: "milad@afternoonumbrellafriends.com",
      name: "Agentic Engine",
    });
    log.info("agentic-engine.convex.admin-auth.enabled");
  } else {
    log.warn("agentic-engine.convex.admin-auth.missing", {
      hint: "CONVEX_DEPLOY_KEY not set — auth-gated Convex calls will fail",
    });
  }
  const runner = createClaudeSdkRunner();
  const sources = createSourceRegistry({
    todoist_task: createTodoistTaskSource(convexClient),
  });
  const app = buildServer({
    token: env.token,
    convexClient: convexClient as unknown as ConvexClientLike,
    runner,
    sources,
    logDir: env.logDir,
  });
  log.info("agentic-engine.boot", { port: env.port, log_dir: env.logDir });
  // @ts-expect-error Bun global, not in @types/node; only reachable at runtime under Bun
  // eslint-disable-next-line no-undef
  Bun.serve({ port: env.port, fetch: app.fetch });
}
