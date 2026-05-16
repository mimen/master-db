import { randomUUID } from "node:crypto";

import type {
  AgentRunInput,
  AgentRunResult,
  AgentRunner,
  CanonicalEvent,
  CanonicalTerminalEvent,
} from "./types";

interface ResumeCursor {
  turn: number;
}

function isResumeCursor(v: unknown): v is ResumeCursor {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).turn === "number"
  );
}

export function createEchoRunner(): AgentRunner {
  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const events: CanonicalEvent[] = [
        {
          type: "assistant_message",
          body_markdown: `received: ${input.message ?? "<initial>"}`,
        },
      ];
      const checkpoint_id = randomUUID();
      let terminal: CanonicalTerminalEvent;
      if (input.message?.startsWith("EXECUTE:")) {
        terminal = {
          type: "execution_result",
          body_markdown: `executed ${input.message.slice("EXECUTE:".length).trim()}`,
          checkpoint_id,
        };
      } else {
        terminal = {
          type: "proposal",
          checkpoint_id,
          proposal: {
            kind: "proposal",
            summary: "echo proposal",
            options: [
              {
                id: "opt-a",
                label: "Do A",
                description: "the only option",
                confidence: 0.9,
                reversibility: "trivial",
              },
            ],
            recommended_option_id: "opt-a",
            free_text_allowed: true,
          },
        };
      }
      events.push(terminal);
      for (const e of events) await input.on_event(e);
      const prevTurn = isResumeCursor(input.resume_cursor)
        ? input.resume_cursor.turn
        : 0;
      return {
        resume_cursor: { turn: prevTurn + 1 } satisfies ResumeCursor,
        terminal,
      };
    },
    async interrupt() {
      /* no-op */
    },
  };
}
