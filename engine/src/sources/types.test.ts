import { describe, expect, test } from "vitest";

import { parseEntityRef } from "./types";

describe("parseEntityRef", () => {
  test("parses todoist:task:abc", () => {
    expect(parseEntityRef("todoist:task:7218390471")).toEqual({
      entity_type: "todoist_task",
      entity_id: "7218390471",
      raw: "todoist:task:7218390471",
    });
  });

  test("parses gmail:thread:foo", () => {
    expect(parseEntityRef("gmail:thread:abc-def")).toEqual({
      entity_type: "gmail_thread",
      entity_id: "abc-def",
      raw: "gmail:thread:abc-def",
    });
  });

  test("rejects malformed refs", () => {
    expect(() => parseEntityRef("nope")).toThrow();
    expect(() => parseEntityRef("a:b")).toThrow();
    expect(() => parseEntityRef("")).toThrow();
  });
});
