import { Check, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SortOption, GroupOption } from "@/lib/views/types"

export interface ViewSettingsDropdownProps<T> {
  /**
   * Available sort options
   */
  sortOptions?: SortOption<T>[]

  /**
   * Current sort option ID (null = no sort)
   */
  currentSort?: string | null

  /**
   * Callback when sort option is selected
   */
  onSortChange?: (sortId: string | null) => void

  /**
   * Available group options
   */
  groupOptions?: GroupOption<T>[]

  /**
   * Current group option ID (null = no group)
   */
  currentGroup?: string | null

  /**
   * Callback when group option is selected
   */
  onGroupChange?: (groupId: string | null) => void

  /**
   * Optional label to show in dropdown trigger (defaults to "Settings")
   */
  triggerLabel?: string
}

/**
 * ViewSettingsDropdown - Combined dropdown for sort and group options
 *
 * Shows:
 * - Sort section with available sort options
 * - Separator
 * - Group section with "None" option + available group options
 * - Checkmark on current selections
 *
 * Used in BaseListView header to control how data is organized
 */
export function ViewSettingsDropdown<T>({
  sortOptions,
  currentSort,
  onSortChange,
  groupOptions,
  currentGroup,
  onGroupChange,
  triggerLabel = "Settings",
}: ViewSettingsDropdownProps<T>) {
  const hasSortOptions = sortOptions && sortOptions.length > 0
  const hasGroupOptions = groupOptions && groupOptions.length > 0

  // If no options, don't render anything
  if (!hasSortOptions && !hasGroupOptions) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 flex-shrink-0"
          aria-label={triggerLabel}
        >
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline ml-1.5 text-xs font-medium">{triggerLabel}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        {/* SORT SECTION */}
        {hasSortOptions && (
          <>
            <DropdownMenuLabel className="text-xs font-semibold uppercase text-muted-foreground">
              Sort by
            </DropdownMenuLabel>

            {sortOptions.map((option) => (
              <DropdownMenuItem
                key={option.id}
                onClick={() => onSortChange?.(option.id)}
                className="cursor-pointer text-sm py-1.5"
              >
                {option.icon && (
                  <div className="mr-2 h-4 w-4 flex-shrink-0 flex items-center justify-center">
                    {option.icon}
                  </div>
                )}
                <span className="flex-1">{option.label}</span>
                {currentSort === option.id && <Check className="h-4 w-4 ml-2 flex-shrink-0" />}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* SEPARATOR */}
        {hasSortOptions && hasGroupOptions && <DropdownMenuSeparator />}

        {/* GROUP SECTION */}
        {hasGroupOptions && (
          <>
            <DropdownMenuLabel className="text-xs font-semibold uppercase text-muted-foreground">
              Group by
            </DropdownMenuLabel>

            {/* None option */}
            <DropdownMenuItem
              onClick={() => onGroupChange?.(null)}
              className="cursor-pointer text-sm py-1.5"
            >
              <span className="flex-1">None</span>
              {currentGroup === null && <Check className="h-4 w-4 ml-2 flex-shrink-0" />}
            </DropdownMenuItem>

            {/* Group options */}
            {groupOptions.map((option) => (
              <DropdownMenuItem
                key={option.id}
                onClick={() => onGroupChange?.(option.id)}
                className="cursor-pointer text-sm py-1.5"
              >
                {option.icon && (
                  <div className="mr-2 h-4 w-4 flex-shrink-0 flex items-center justify-center">
                    {option.icon}
                  </div>
                )}
                <span className="flex-1">{option.label}</span>
                {currentGroup === option.id && <Check className="h-4 w-4 ml-2 flex-shrink-0" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
