import { SidebarButton } from "../components/SidebarButton"
import type { ViewNavItem } from "../types"

import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { useDialogContext } from "@/contexts/DialogContext"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface ViewsSectionProps {
  items: ViewNavItem[]
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
}

export function ViewsSection({ items, currentViewKey, onViewChange, viewContext }: ViewsSectionProps) {
  const { openSettings } = useDialogContext()

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const isActive = currentViewKey === item.key

          const handleItemClick = () => {
            // Settings is a special case - open dialog instead of changing view
            if (item.key === "view:settings") {
              openSettings()
            } else {
              onViewChange(resolveView(item.key, viewContext))
            }
          }

          return (
            <SidebarMenuItem key={item.key}>
              <SidebarButton
                icon={item.icon}
                label={item.label}
                count={item.count}
                isActive={isActive}
                onClick={handleItemClick}
              />
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
