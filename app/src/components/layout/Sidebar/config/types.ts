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
 */
export interface SubviewDefinition {
  items?: ViewKey[] // Static children
  type?: "generator" // Dynamic children
  source?: string // Generator source name
  params?: Record<string, any> // Generator parameters
}

/**
 * Complete sidebar configuration
 */
export interface SidebarConfig {
  sections: SidebarSection[] // Ordered array of sections
  subviews: Record<ViewKey, SubviewDefinition> // Subview definitions for expandable views
}
