
import { Pause, Play } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Doc } from "@/convex/_generated/dataModel"
import { useRoutineActions } from "@/hooks/useRoutineActions"

interface RoutineDialogProps {
  isOpen: boolean
  onClose: () => void
  routine?: Doc<"routines">
  mode: "create" | "edit"
}

const FREQUENCIES = [
  "Daily",
  "Twice a Week",
  "Weekly",
  "Every Other Week",
  "Monthly",
  "Every Other Month",
  "Quarterly",
  "Twice a Year",
  "Yearly",
  "Every Other Year",
]

const DURATIONS = ["5min", "15min", "30min", "45min", "1hr", "2hr", "3hr", "4hr"]

const TIMES_OF_DAY = [
  { value: "Morning", label: "Morning (7am)" },
  { value: "Day", label: "Day (11am)" },
  { value: "Evening", label: "Evening (3pm)" },
  { value: "Night", label: "Night (7pm)" },
]

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
]


export function RoutineDialog({ isOpen, onClose, routine, mode }: RoutineDialogProps) {
  const { createRoutine, updateRoutine, deleteRoutine, deferRoutine, undeferRoutine } = useRoutineActions()


  // Form state
  const [name, setName] = useState(routine?.name || "")
  const [description, setDescription] = useState(routine?.description || "")
  const [frequency, setFrequency] = useState(routine?.frequency || "Daily")
  const [duration, setDuration] = useState(routine?.duration || "15min")
  const [timeOfDay, setTimeOfDay] = useState<string | undefined>(routine?.timeOfDay)
  const [idealDay, setIdealDay] = useState<number | undefined>(routine?.idealDay)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) {
      return
    }

    setIsSubmitting(true)

    try {
      if (mode === "create") {
        await createRoutine({
          name: name.trim(),
          description: description.trim() || undefined,
          frequency,
          duration,
          
          timeOfDay,
          idealDay,
          
          
          
        })
      } else if (routine) {
        await updateRoutine({
          routineId: routine._id,
          name: name.trim(),
          description: description.trim() || undefined,
          frequency,
          duration,
          
          timeOfDay,
          idealDay,
          
          
          
        })
      }

      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!routine) return

    setIsSubmitting(true)
    try {
      await deleteRoutine(routine._id)
      onClose()
    } finally {
      setIsSubmitting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleToggleDefer = async () => {
    if (!routine) return

    setIsToggling(true)
    try {
      if (routine.defer) {
        await undeferRoutine(routine._id)
      } else {
        await deferRoutine(routine._id)
      }
    } finally {
      setIsToggling(false)
    }
  }


  // Reset form state when routine changes or dialog opens/closes
  useEffect(() => {
    if (routine) {
      setName(routine.name)
      setDescription(routine.description || "")
      setFrequency(routine.frequency)
      setDuration(routine.duration)
      setTimeOfDay(routine.timeOfDay)
      setIdealDay(routine.idealDay)
    } else if (isOpen) {
      // Reset to defaults when creating new routine
      setName("")
      setDescription("")
      setFrequency("Daily")
      setDuration("15min")
      setTimeOfDay(undefined)
      setIdealDay(undefined)
    }
  }, [routine, isOpen])

  // Helper to check if frequency supports ideal day
  const supportsIdealDay = ["Weekly", "Every Other Week", "Monthly", "Every Other Month", "Quarterly", "Twice a Year", "Yearly", "Every Other Year"].includes(frequency)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <DialogTitle>{mode === "create" ? "Create Routine" : "Edit Routine"}</DialogTitle>
              <DialogDescription>
                {mode === "create"
                  ? "Set up a new routine that will automatically generate tasks"
                  : "Update routine settings. Changes apply to newly generated tasks only."}
              </DialogDescription>
            </div>
            {mode === "edit" && routine && (
              <div className="flex items-center gap-2 ml-4 mr-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleDefer}
                  disabled={isToggling}
                >
                  {routine.defer ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Pause
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name - editable in create mode, read-only in edit mode */}
          {mode === "create" ? (
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Morning Exercise"
              />
            </div>
          ) : (
            <div className="pb-2 border-b">
              <p className="text-xs text-muted-foreground mb-1">Routine</p>
              <p className="text-base font-medium">{name}</p>
            </div>
          )}

          {/* Description - only show in create mode */}
          {mode === "create" && (
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="20 minutes of cardio or strength training"
                rows={2}
              />
            </div>
          )}

          {/* Frequency & Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="frequency">Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {freq}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((dur) => (
                    <SelectItem key={dur} value={dur}>
                      {dur}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>


          {/* Time of Day */}
          <div className="space-y-2">
            <Label htmlFor="timeOfDay">Time of Day (optional)</Label>
            <Select value={timeOfDay || "none"} onValueChange={(v) => setTimeOfDay(v === "none" ? undefined : v)}>
              <SelectTrigger id="timeOfDay">
                <SelectValue placeholder="No specific time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific time</SelectItem>
                {TIMES_OF_DAY.map((time) => (
                  <SelectItem key={time.value} value={time.value}>
                    {time.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Ideal Day (only for weekly+ frequencies) */}
          {supportsIdealDay && (
            <div className="space-y-2">
              <Label htmlFor="idealDay">Preferred Day (optional)</Label>
              <Select
                value={idealDay !== undefined ? idealDay.toString() : "none"}
                onValueChange={(v) => setIdealDay(v === "none" ? undefined : parseInt(v))}
              >
                <SelectTrigger id="idealDay">
                  <SelectValue placeholder="Any day" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any day</SelectItem>
                  {DAYS_OF_WEEK.map((day) => (
                    <SelectItem key={day.value} value={day.value.toString()}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {mode === "edit" && routine && (
            <>
              {!showDeleteConfirm ? (
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="sm:mr-auto"
                >
                  Delete
                </Button>
              ) : (
                <div className="flex gap-2 sm:mr-auto">
                  <Button variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
                    Confirm Delete
                  </Button>
                  <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </>
          )}
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || isSubmitting}>
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
