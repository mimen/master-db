import { describe, expect, it } from "vitest"

import {
  findFirstAvailableList,
  findLastAvailableList,
  findNextList,
  findPreviousList,
  type TaskCounts,
} from "./taskNavigation"

describe("taskNavigation", () => {
  describe("findFirstAvailableList", () => {
    it("should return first list with tasks", () => {
      const listIds = ["list1", "list2", "list3"]
      const counts: TaskCounts = new Map([
        ["list1", 0],
        ["list2", 5],
        ["list3", 3],
      ])

      const result = findFirstAvailableList(listIds, counts)

      expect(result).toEqual({ listId: "list2", taskIndex: 0 })
    })

    it("should return null when no lists have tasks", () => {
      const listIds = ["list1", "list2"]
      const counts: TaskCounts = new Map([
        ["list1", 0],
        ["list2", 0],
      ])

      const result = findFirstAvailableList(listIds, counts)

      expect(result).toBeNull()
    })

    it("should return null for empty list array", () => {
      const listIds: string[] = []
      const counts: TaskCounts = new Map()

      const result = findFirstAvailableList(listIds, counts)

      expect(result).toBeNull()
    })
  })

  describe("findLastAvailableList", () => {
    it("should return last list with tasks", () => {
      const listIds = ["list1", "list2", "list3"]
      const counts: TaskCounts = new Map([
        ["list1", 3],
        ["list2", 5],
        ["list3", 0],
      ])

      const result = findLastAvailableList(listIds, counts)

      expect(result).toEqual({ listId: "list2", taskIndex: 4 })
    })

    it("should select last task index correctly", () => {
      const listIds = ["list1"]
      const counts: TaskCounts = new Map([["list1", 7]])

      const result = findLastAvailableList(listIds, counts)

      expect(result).toEqual({ listId: "list1", taskIndex: 6 })
    })

    it("should return null when no lists have tasks", () => {
      const listIds = ["list1", "list2"]
      const counts: TaskCounts = new Map([
        ["list1", 0],
        ["list2", 0],
      ])

      const result = findLastAvailableList(listIds, counts)

      expect(result).toBeNull()
    })
  })

  describe("findNextList", () => {
    it("should find next list with tasks", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts: TaskCounts = new Map([
        ["list1", 5],
        ["list2", 0],
        ["list3", 3],
        ["list4", 0],
      ])

      const result = findNextList(listIds, counts, "list1")

      expect(result).toEqual({ listId: "list3", taskIndex: 0 })
    })

    it("should return null when current list is not found", () => {
      const listIds = ["list1", "list2"]
      const counts: TaskCounts = new Map([["list1", 5]])

      const result = findNextList(listIds, counts, "list999")

      expect(result).toBeNull()
    })

    it("should return null when current list is last", () => {
      const listIds = ["list1", "list2"]
      const counts: TaskCounts = new Map([
        ["list1", 5],
        ["list2", 3],
      ])

      const result = findNextList(listIds, counts, "list2")

      expect(result).toBeNull()
    })

    it("should skip empty lists", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts: TaskCounts = new Map([
        ["list1", 1],
        ["list2", 0],
        ["list3", 0],
        ["list4", 2],
      ])

      const result = findNextList(listIds, counts, "list1")

      expect(result).toEqual({ listId: "list4", taskIndex: 0 })
    })
  })

  describe("findPreviousList", () => {
    it("should find previous list with tasks", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts: TaskCounts = new Map([
        ["list1", 0],
        ["list2", 3],
        ["list3", 0],
        ["list4", 5],
      ])

      const result = findPreviousList(listIds, counts, "list4")

      expect(result).toEqual({ listId: "list2", taskIndex: 2 })
    })

    it("should return last task index of previous list", () => {
      const listIds = ["list1", "list2"]
      const counts: TaskCounts = new Map([
        ["list1", 8],
        ["list2", 3],
      ])

      const result = findPreviousList(listIds, counts, "list2")

      expect(result).toEqual({ listId: "list1", taskIndex: 7 })
    })

    it("should return null when current list is not found", () => {
      const listIds = ["list1", "list2"]
      const counts: TaskCounts = new Map([["list1", 5]])

      const result = findPreviousList(listIds, counts, "list999")

      expect(result).toBeNull()
    })

    it("should return null when current list is first", () => {
      const listIds = ["list1", "list2"]
      const counts: TaskCounts = new Map([
        ["list1", 5],
        ["list2", 3],
      ])

      const result = findPreviousList(listIds, counts, "list1")

      expect(result).toBeNull()
    })

    it("should skip empty lists", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts: TaskCounts = new Map([
        ["list1", 2],
        ["list2", 0],
        ["list3", 0],
        ["list4", 1],
      ])

      const result = findPreviousList(listIds, counts, "list4")

      expect(result).toEqual({ listId: "list1", taskIndex: 1 })
    })
  })
})
