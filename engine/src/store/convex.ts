import { makeFunctionReference, type FunctionReference } from "convex/server";

export interface UpsertRunArgs extends Record<string, unknown> {
  entity_ref: string;
  entity_type: string;
  entity_id: string;
  backend: string;
  status: string;
  run_id: string;
  traceparent: string | null;
  resume_cursor: unknown | null;
}

export interface AppendMessageArgs extends Record<string, unknown> {
  entity_ref: string;
  run_id: string;
  kind: string;
  body_markdown: string | null;
  proposal_json: unknown | null;
  error_json: unknown | null;
  token_usage: unknown | null;
  checkpoint_id: string | null;
}

export interface StartActivityArgs extends Record<string, unknown> {
  entity_ref: string;
  run_id: string;
  kind: string;
  name: string;
  input_json: unknown;
}

export interface ResolveActivityArgs extends Record<string, unknown> {
  id: string;
  status: "ok" | "error";
  output_json: unknown | null;
}

export interface UpdateRunStatusArgs extends Record<string, unknown> {
  entity_ref: string;
  status: string;
  last_message_id: string | null;
  resume_cursor: unknown | null;
}

export interface ConvexStore {
  getRun(entity_ref: string): Promise<unknown>;
  getThread(entity_ref: string): Promise<unknown[]>;
  upsertRun(args: UpsertRunArgs): Promise<string>;
  appendThreadMessage(args: AppendMessageArgs): Promise<string>;
  startActivity(args: StartActivityArgs): Promise<string>;
  resolveActivity(args: ResolveActivityArgs): Promise<void>;
  updateRunStatus(args: UpdateRunStatusArgs): Promise<void>;
}

/**
 * Minimal shape we need from a Convex client. `ConvexHttpClient` satisfies it.
 * Defined here (rather than imported from `convex/browser`) so tests can mock
 * it without pulling the full client in.
 */
export interface ConvexClientLike {
  query<T = unknown>(
    name: FunctionReference<"query", "public", Record<string, unknown>, T>,
    args: unknown,
  ): Promise<T>;
  mutation<T = unknown>(
    name: FunctionReference<"mutation", "public", Record<string, unknown>, T>,
    args: unknown,
  ): Promise<T>;
}

interface EntityRefArgs extends Record<string, unknown> {
  entity_ref: string;
}

const Q_GET_RUN = makeFunctionReference<"query", EntityRefArgs, unknown>(
  "agentic/queries/getRun",
);

const Q_GET_THREAD = makeFunctionReference<"query", EntityRefArgs, unknown[]>(
  "agentic/queries/getThread",
);

const M_UPSERT_RUN = makeFunctionReference<"mutation", UpsertRunArgs, string>(
  "agentic/mutations/upsertRun",
);

const M_APPEND_MESSAGE = makeFunctionReference<
  "mutation",
  AppendMessageArgs,
  string
>("agentic/mutations/appendThreadMessage");

const M_UPDATE_STATUS = makeFunctionReference<
  "mutation",
  UpdateRunStatusArgs,
  void
>("agentic/mutations/updateRunStatus");

const M_START_ACTIVITY = makeFunctionReference<
  "mutation",
  StartActivityArgs,
  string
>("agentic/mutations/recordActivity:start");

const M_RESOLVE_ACTIVITY = makeFunctionReference<
  "mutation",
  ResolveActivityArgs,
  void
>("agentic/mutations/recordActivity:resolve");

export function createConvexStore(client: ConvexClientLike): ConvexStore {
  return {
    getRun: (entity_ref) => client.query(Q_GET_RUN, { entity_ref }),
    getThread: (entity_ref) => client.query(Q_GET_THREAD, { entity_ref }),
    upsertRun: (args) => client.mutation(M_UPSERT_RUN, args),
    appendThreadMessage: (args) => client.mutation(M_APPEND_MESSAGE, args),
    startActivity: (args) => client.mutation(M_START_ACTIVITY, args),
    resolveActivity: (args) => client.mutation(M_RESOLVE_ACTIVITY, args),
    updateRunStatus: (args) => client.mutation(M_UPDATE_STATUS, args),
  };
}
