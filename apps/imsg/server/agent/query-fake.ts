import type { CanUseTool, Options, PermissionResult, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GenericId } from "convex/values";
import type { QueryFactory } from "./session";

/** A scriptable stand-in for the SDK's query(): tests emit SDK messages and read what the runner pushed. */
export class FakeQuery {
  sent: SDKUserMessage[] = [];
  calls: ("interrupt" | "close")[] = [];
  private output: (SDKMessage | Error | null)[] = [];
  private wake: (() => void) | null = null;

  constructor(readonly options: Options, prompt: AsyncIterable<SDKUserMessage>) {
    void (async () => { for await (const message of prompt) this.sent.push(message); })();
  }

  get closed(): boolean { return this.calls.includes("close"); }

  emit(message: object) { this.push(message as SDKMessage); }
  fail(error: Error) { this.push(error); }
  end() { this.push(null); }

  /** Calls canUseTool the way the CLI does for a tool_use, without awaiting the decision. */
  askTool(name: string, input: Record<string, unknown>, toolUseID: string, signal = new AbortController().signal): Promise<PermissionResult | null> {
    const canUseTool = this.options.canUseTool as CanUseTool;
    return canUseTool(name, input, { signal, toolUseID, requestId: `request-${toolUseID}` });
  }

  /** Each live selection change, in order; set rejectSwitch to make the CLI refuse the next one. */
  switches: ({ model: string | undefined } | { effortLevel: unknown })[] = [];
  rejectSwitch: Error | null = null;
  async setModel(model?: string) {
    if (this.rejectSwitch) throw this.rejectSwitch;
    this.switches.push({ model });
  }
  async applyFlagSettings(settings: { effortLevel?: unknown }) {
    if (this.rejectSwitch) throw this.rejectSwitch;
    this.switches.push({ effortLevel: settings.effortLevel });
  }

  async interrupt() {
    this.calls.push("interrupt");
    return undefined;
  }
  close() {
    this.calls.push("close");
    this.push(null);
  }

  private push(entry: SDKMessage | Error | null) {
    this.output.push(entry);
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
    for (;;) {
      const next = this.output.shift();
      if (next === null) return;
      if (next instanceof Error) throw next;
      if (next) { yield next; continue; }
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
  }
}

export function fakeQueries() {
  const queries: FakeQuery[] = [];
  const query: QueryFactory = ({ prompt, options }) => {
    const fake = new FakeQuery(options, prompt);
    queries.push(fake);
    return fake;
  };
  return { query, queries };
}

export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export async function settle(times = 5) { for (let i = 0; i < times; i++) await tick(); }

export const sdkResult = (uuid: string, text: string, extra: object = {}) =>
  ({ type: "result", subtype: "success", uuid, result: text, is_error: false, duration_ms: 10, queued_turn_count: 0, ...extra });
export const sdkText = (id: string, text: string) =>
  ({ type: "assistant", uuid: `${id}-frame`, parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } });

/** Test ids: the runner only ever compares them. */
export const fakeId = <Table extends string>(value: string) => value as GenericId<Table>;
