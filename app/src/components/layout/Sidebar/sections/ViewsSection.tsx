import { SidebarButton } from "../components/SidebarButton"
import type { ViewNavItem } from "../types"

import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface ViewsSectionProps {
  items: ViewNavItem[]
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
}

export function ViewsSection({ items, currentViewKey, onViewChange, viewContext }: ViewsSectionProps) {
  return (
    <div className="p-4">
      <div className="space-y-1">
        {items.map((item) => {
          const isActive = currentViewKey === item.key

          const handleItemClick = () => {
            onViewChange(resolveView(item.key, viewContext))
          }

          return (
            <SidebarButton
              key={item.key}
              icon={item.icon}
              label={item.label}
              count={item.count}
              isActive={isActive}
              onClick={handleItemClick}
            />
          )
        })}
      </div>
    </div>
  )
}
