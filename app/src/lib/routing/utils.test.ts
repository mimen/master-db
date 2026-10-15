import { describe, expect, it } from "vitest"

import { pathToViewKey } from "./utils"

describe("pathToViewKey", () => {
  it("resolves known time ranges and routine filters", () => {
    expect(pathToViewKey("/time/no-date")).toBe("view:time:no-date")
    expect(pathToViewKey("/routine-tasks/get-ahead")).toBe("view:routine-tasks:get-ahead")
  })

  it("treats an unknown time range or routine filter as an unknown path", () => {
    expect(pathToViewKey("/time/bogus")).toBeNull()
    expect(pathToViewKey("/time/today/extra")).toBeNull()
    expect(pathToViewKey("/routine-tasks/bogus")).toBeNull()
  })
})
