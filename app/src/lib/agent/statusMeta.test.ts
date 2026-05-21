import { describe, expect, test } from "vitest"

import { getStatusMeta, STATUS_LABEL, STATUS_META } from "./statusMeta"

describe("statusMeta", () => {
  test("canonical labels", () => {
    expect(STATUS_META.idle.label).toBe("Idle")
    expect(STATUS_META.discovering.label).toBe("Thinking")
    expect(STATUS_META.awaiting_decision.label).toBe("Awaiting decision")
    expect(STATUS_META.executing.label).toBe("Running")
    expect(STATUS_META.error.label).toBe("Error")
  })

  test("pulse and color metadata preserved from StatusPill", () => {
    expect(STATUS_META.discovering.pulse).toBe(true)
    expect(STATUS_META.executing.pulse).toBe(true)
    expect(STATUS_META.awaiting_decision.pulse).toBe(false)
    expect(STATUS_META.error.pulse).toBe(false)
    expect(STATUS_META.idle.pulse).toBe(false)

    expect(STATUS_META.awaiting_decision.cls).toContain("amber")
    expect(STATUS_META.error.cls).toContain("rose")
    expect(STATUS_META.discovering.cls).toContain("blue")
  })

  test("getStatusMeta returns canonical entry", () => {
    expect(getStatusMeta("executing").label).toBe("Running")
    expect(getStatusMeta("awaiting_decision").label).toBe("Awaiting decision")
  })

  test("getStatusMeta falls back for unknown status", () => {
    expect(getStatusMeta("nonsense")).toEqual({
      label: "nonsense",
      cls: "bg-muted text-muted-foreground",
      pulse: false,
    })
  })

  test("STATUS_LABEL accessor exposes canonical labels", () => {
    expect(STATUS_LABEL.awaiting_decision).toBe("Awaiting decision")
    expect(STATUS_LABEL.executing).toBe("Running")
  })
})
