import type { ViewKey } from "@/lib/views/types"

/**
 * Sort option for sections with sorting capabilities
 * Can be either a static list of view-keys or a generator source
 */
export type SortOption =
  | { key: string; label: string; items: ViewKey[] } // Static list
  | { key: string; label: string; source: string } // Generator

/**
 * Configuration for a single sidebar section
 */
export interface SidebarSection {
  section: string // Section key (e.g., "primary", "time", "folders")
  label?: string // Optional header label (omit for primary)
  items?: ViewKey[] // Static list of view-keys
  sortOptions?: SortOption[] // For sections with sorting (Folders, Labels)
}

/**
 * Definition for subviews (children of expandable views)
 * Can have static items, sortable items, or both
 */
export interface SubviewDefinition {
  items?: ViewKey[] // Static children (always shown)
  sortOptions?: SortOption[] // Sortable children with multiple sort modes
  type?: "generator" // Dynamic children (legacy, use sortOptions instead)
  source?: string // Generator source name (legacy)
  params?: Record<string, any> // Generator parameters (legacy)
}

/**
 * Complete sidebar configuration
 */
export interface SidebarConfig {
  sections: SidebarSection[] // Ordered array of sections
  subviews: Record<ViewKey, SubviewDefinition> // Subview definitions for expandable views
}
