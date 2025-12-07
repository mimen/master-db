import { describe, expect, it } from "vitest"

import {
  findFirstAvailableList,
  findLastAvailableList,
  findNextList,
  findPreviousList,
} from "./taskNavigation"

type MockEntity = { id: string }

describe("taskNavigation", () => {
  // Helper to create entities from count
  const createEntities = (count: number): MockEntity[] =>
    Array.from({ length: count }, (_, i) => ({ id: `entity-${i}` }))

  // Helper to create getEntitiesForList function
  const createGetEntities = (countsMap: Map<string, number>) =>
    (listId: string): MockEntity[] => createEntities(countsMap.get(listId) ?? 0)

  // Helper to get entity ID
  const getEntityId = (entity: MockEntity) => entity.id

  describe("findFirstAvailableList", () => {
    it("should return first list with tasks", () => {
      const listIds = ["list1", "list2", "list3"]
      const counts = new Map([
        ["list1", 0],
        ["list2", 5],
        ["list3", 3],
      ])
      const getEntities = createGetEntities(counts)

      const result = findFirstAvailableList(listIds, getEntities, getEntityId)

      expect(result).toEqual({ listId: "list2", entityId: "entity-0" })
    })

    it("should return null when no lists have tasks", () => {
      const listIds = ["list1", "list2"]
      const counts = new Map([
        ["list1", 0],
        ["list2", 0],
      ])
      const getEntities = createGetEntities(counts)

      const result = findFirstAvailableList(listIds, getEntities, getEntityId)

      expect(result).toBeNull()
    })

    it("should return null for empty list array", () => {
      const listIds: string[] = []
      const counts = new Map()
      const getEntities = createGetEntities(counts)

      const result = findFirstAvailableList(listIds, getEntities, getEntityId)

      expect(result).toBeNull()
    })
  })

  describe("findLastAvailableList", () => {
    it("should return last list with tasks", () => {
      const listIds = ["list1", "list2", "list3"]
      const counts = new Map([
        ["list1", 3],
        ["list2", 5],
        ["list3", 0],
      ])
      const getEntities = createGetEntities(counts)

      const result = findLastAvailableList(listIds, getEntities, getEntityId)

      expect(result).toEqual({ listId: "list2", entityId: "entity-4" })
    })

    it("should select last task index correctly", () => {
      const listIds = ["list1"]
      const counts = new Map([["list1", 7]])
      const getEntities = createGetEntities(counts)

      const result = findLastAvailableList(listIds, getEntities, getEntityId)

      expect(result).toEqual({ listId: "list1", entityId: "entity-6" })
    })

    it("should return null when no lists have tasks", () => {
      const listIds = ["list1", "list2"]
      const counts = new Map([
        ["list1", 0],
        ["list2", 0],
      ])
      const getEntities = createGetEntities(counts)

      const result = findLastAvailableList(listIds, getEntities, getEntityId)

      expect(result).toBeNull()
    })
  })

  describe("findNextList", () => {
    it("should find next list with tasks", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts = new Map([
        ["list1", 5],
        ["list2", 0],
        ["list3", 3],
        ["list4", 0],
      ])
      const getEntities = createGetEntities(counts)

      const result = findNextList(listIds, getEntities, getEntityId, "list1")

      expect(result).toEqual({ listId: "list3", entityId: "entity-0" })
    })

    it("should return null when current list is not found", () => {
      const listIds = ["list1", "list2"]
      const counts = new Map([["list1", 5]])
      const getEntities = createGetEntities(counts)

      const result = findNextList(listIds, getEntities, getEntityId, "list999")

      expect(result).toBeNull()
    })

    it("should return null when current list is last", () => {
      const listIds = ["list1", "list2"]
      const counts = new Map([
        ["list1", 5],
        ["list2", 3],
      ])
      const getEntities = createGetEntities(counts)

      const result = findNextList(listIds, getEntities, getEntityId, "list2")

      expect(result).toBeNull()
    })

    it("should skip empty lists", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts = new Map([
        ["list1", 1],
        ["list2", 0],
        ["list3", 0],
        ["list4", 2],
      ])
      const getEntities = createGetEntities(counts)

      const result = findNextList(listIds, getEntities, getEntityId, "list1")

      expect(result).toEqual({ listId: "list4", entityId: "entity-0" })
    })
  })

  describe("findPreviousList", () => {
    it("should find previous list with tasks", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts = new Map([
        ["list1", 0],
        ["list2", 3],
        ["list3", 0],
        ["list4", 5],
      ])
      const getEntities = createGetEntities(counts)

      const result = findPreviousList(listIds, getEntities, getEntityId, "list4")

      expect(result).toEqual({ listId: "list2", entityId: "entity-2" })
    })

    it("should return last task index of previous list", () => {
      const listIds = ["list1", "list2"]
      const counts = new Map([
        ["list1", 8],
        ["list2", 3],
      ])
      const getEntities = createGetEntities(counts)

      const result = findPreviousList(listIds, getEntities, getEntityId, "list2")

      expect(result).toEqual({ listId: "list1", entityId: "entity-7" })
    })

    it("should return null when current list is not found", () => {
      const listIds = ["list1", "list2"]
      const counts = new Map([["list1", 5]])
      const getEntities = createGetEntities(counts)

      const result = findPreviousList(listIds, getEntities, getEntityId, "list999")

      expect(result).toBeNull()
    })

    it("should return null when current list is first", () => {
      const listIds = ["list1", "list2"]
      const counts = new Map([
        ["list1", 5],
        ["list2", 3],
      ])
      const getEntities = createGetEntities(counts)

      const result = findPreviousList(listIds, getEntities, getEntityId, "list1")

      expect(result).toBeNull()
    })

    it("should skip empty lists", () => {
      const listIds = ["list1", "list2", "list3", "list4"]
      const counts = new Map([
        ["list1", 2],
        ["list2", 0],
        ["list3", 0],
        ["list4", 1],
      ])
      const getEntities = createGetEntities(counts)

      const result = findPreviousList(listIds, getEntities, getEntityId, "list4")

      expect(result).toEqual({ listId: "list1", entityId: "entity-1" })
    })
  })
})
