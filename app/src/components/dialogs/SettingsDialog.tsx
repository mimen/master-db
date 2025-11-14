import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  expandNested: boolean
  onExpandNestedChange: (value: boolean) => void
}

export function SettingsDialog({
  open,
  onClose,
  expandNested,
  onExpandNestedChange,
}: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your Todoist Processor settings</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Appearance</h3>
            <div className="flex items-center justify-between">
              <Label htmlFor="theme" className="text-sm font-normal">
                Theme
              </Label>
              <Select
                value={mounted ? theme : "system"}
                onValueChange={setTheme}
                disabled={!mounted}
              >
                <SelectTrigger id="theme" className="w-[180px]">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium">Projects</h3>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="expand-nested"
                checked={expandNested}
                onCheckedChange={onExpandNestedChange}
              />
              <Label
                htmlFor="expand-nested"
                className="text-sm font-normal cursor-pointer"
              >
                Load nested projects in hierarchy view
              </Label>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
