import { expect, test } from "bun:test";

import { AGENT_MODELS, agentModelChoice, withModel } from "./agent-models";

test("the pane offers exactly the six models, in order", () => {
  expect(AGENT_MODELS.map((model) => model.label)).toEqual(["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Sol", "Muse Wonder Full", "Luna"]);
});

test("a chat on a model that left the list falls back to Opus 5.5 at high", () => {
  expect(agentModelChoice("claude-fable-5-1", "max")).toEqual({ model: "claude-opus-5-5", effort: "high" });
  expect(agentModelChoice("gpt-6.1-sol", "xhigh")).toEqual({ model: "gpt-6.1-sol", effort: "xhigh" });
  expect(agentModelChoice("gpt-6.1-sol", "huge")).toEqual({ model: "gpt-6.1-sol", effort: "high" });
});

test("switching model starts at that model's default effort", () => {
  expect(withModel("gpt-6-luna")).toEqual({ model: "gpt-6-luna", effort: "low" });
  expect(withModel("muse-wonder-full-1.0")).toEqual({ model: "muse-wonder-full-1.0", effort: "high" });
});
