import type { FolderTypeFilterItem } from "../utils/filterItems"

import { SidebarButton } from "./SidebarButton"

import { SidebarMenuItem } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface FolderTypeItemProps {
  folderType: FolderTypeFilterItem
  currentViewKey?: ViewKey
  onViewChange?: (view: ViewSelection) => void
  viewContext?: ViewBuildContext
  count: number
}

export function FolderTypeItem({
  folderType,
  currentViewKey,
  onViewChange,
  viewContext,
  count,
}: FolderTypeItemProps) {
  const Icon = folderType.icon
  const isActive = currentViewKey === folderType.viewKey

  const handleClick = () => {
    if (onViewChange && viewContext) {
      onViewChange(resolveView(folderType.viewKey, viewContext))
    }
  }

  return (
    <SidebarMenuItem>
      <SidebarButton
        icon={
          <Icon
            className={cn("h-4 w-4", folderType.id === "unassigned" && "text-muted-foreground")}
          />
        }
        label={folderType.label}
        count={count}
        isActive={isActive || false}
        onClick={handleClick}
        level={1}
      />
    </SidebarMenuItem>
  )
}
