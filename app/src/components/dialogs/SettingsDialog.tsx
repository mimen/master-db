import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

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
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your Todoist Processor settings</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
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
