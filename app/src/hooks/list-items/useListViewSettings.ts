import { useCallback, useEffect, useState } from "react"

import type { ListViewSettings } from "@/lib/views/types"

/**
 * Hook for managing list view settings (sort, group, collapsed groups)
 * Persists settings to localStorage per list ID
 *
 * @param persistenceKey Unique key for localStorage (typically list.id)
 * @param defaultSort Default sort option ID
 * @param defaultGroup Default group option ID
 */
export function useListViewSettings(
  persistenceKey: string,
  defaultSort?: string,
  defaultGroup?: string
) {
  // Helper to safely read from localStorage
  const getStoredSettings = useCallback((): ListViewSettings => {
    try {
      const item = window.localStorage.getItem(`list-settings:${persistenceKey}`)
      if (item) {
        const parsed = JSON.parse(item) as Partial<ListViewSettings>
        return {
          sort: parsed.sort ?? defaultSort ?? null,
          group: parsed.group ?? defaultGroup ?? null,
          collapsedGroups: parsed.collapsedGroups ?? [],
        }
      }
    } catch (error) {
      console.warn(`Error reading list settings for "${persistenceKey}":`, error)
    }

    return {
      sort: defaultSort ?? null,
      group: defaultGroup ?? null,
      collapsedGroups: [],
    }
  }, [persistenceKey, defaultSort, defaultGroup])

  // Helper to safely write to localStorage
  const saveSettings = useCallback((settings: ListViewSettings) => {
    try {
      window.localStorage.setItem(`list-settings:${persistenceKey}`, JSON.stringify(settings))
    } catch (error) {
      console.warn(`Error writing list settings for "${persistenceKey}":`, error)
    }
  }, [persistenceKey])

  // Initialize state from localStorage
  const [currentSort, setCurrentSortState] = useState<string | null>(() => {
    return getStoredSettings().sort
  })

  const [currentGroup, setCurrentGroupState] = useState<string | null>(() => {
    return getStoredSettings().group
  })

  const [collapsedGroups, setCollapsedGroupsState] = useState<Set<string>>(() => {
    return new Set(getStoredSettings().collapsedGroups)
  })

  // Persist sort changes
  useEffect(() => {
    const settings = getStoredSettings()
    saveSettings({
      ...settings,
      sort: currentSort,
    })
  }, [currentSort, getStoredSettings, saveSettings])

  // Persist group changes
  useEffect(() => {
    const settings = getStoredSettings()
    saveSettings({
      ...settings,
      group: currentGroup,
    })
  }, [currentGroup, getStoredSettings, saveSettings])

  // Persist collapsed groups changes
  useEffect(() => {
    const settings = getStoredSettings()
    saveSettings({
      ...settings,
      collapsedGroups: Array.from(collapsedGroups),
    })
  }, [collapsedGroups, getStoredSettings, saveSettings])

  // Wrapped setters that also persist to localStorage
  const setCurrentSort = useCallback((sort: string | null) => {
    setCurrentSortState(sort)
  }, [])

  const setCurrentGroup = useCallback((group: string | null) => {
    setCurrentGroupState(group)
  }, [])

  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroupsState((prev) => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }, [])

  return {
    currentSort,
    setCurrentSort,
    currentGroup,
    setCurrentGroup,
    collapsedGroups,
    toggleGroupCollapse,
  }
}
