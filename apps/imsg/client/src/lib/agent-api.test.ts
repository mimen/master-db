import { expect, test } from "bun:test";

import { agentAvailable } from "./agent-api";

test("the agent is available only within two minutes of the runner's last heartbeat", () => {
  expect(agentAvailable(null, 1_000_000)).toBe(false);
  expect(agentAvailable(undefined, 1_000_000)).toBe(false);
  expect(agentAvailable(1_000_000 - 120_000, 1_000_000)).toBe(true);
  expect(agentAvailable(1_000_000 - 120_001, 1_000_000)).toBe(false);
  expect(agentAvailable(1_000_000 + 5_000, 1_000_000)).toBe(true);
});
