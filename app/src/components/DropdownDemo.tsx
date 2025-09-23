import { useState } from "react"

import { ProjectSelector, LabelSelector, PrioritySelector } from "@/components/dropdowns"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function DropdownDemo() {
  // Local state for demo purposes
  const [selectedProject, setSelectedProject] = useState<string>()
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
  const [selectedPriority, setSelectedPriority] = useState<number>(1)

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Dropdown Components Demo</h1>
        <p className="text-muted-foreground">
          Interactive dropdowns for managing Todoist tasks
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Selector</CardTitle>
          <CardDescription>
            Select a project from your Todoist workspace
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProjectSelector
            value={selectedProject}
            onChange={setSelectedProject}
            placeholder="Choose a project"
          />
          {selectedProject && (
            <p className="text-sm text-muted-foreground">
              Selected project ID: {selectedProject}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Label Selector</CardTitle>
          <CardDescription>
            Add multiple labels to categorize tasks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LabelSelector
            value={selectedLabels}
            onChange={setSelectedLabels}
            placeholder="Add labels"
          />
          {selectedLabels.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Selected labels: {selectedLabels.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Priority Selector</CardTitle>
          <CardDescription>
            Set task priority from P1 (highest) to P4 (lowest)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <PrioritySelector
              value={selectedPriority}
              onChange={setSelectedPriority}
              placeholder="Set priority"
            />
            <PrioritySelector
              value={selectedPriority}
              onChange={setSelectedPriority}
              placeholder="Small size"
              size="sm"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Selected priority: P{5 - selectedPriority} (internal value: {selectedPriority})
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrated Example</CardTitle>
          <CardDescription>
            All dropdowns working together
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <ProjectSelector
              value={selectedProject}
              onChange={setSelectedProject}
            />
            <LabelSelector
              value={selectedLabels}
              onChange={setSelectedLabels}
            />
            <PrioritySelector
              value={selectedPriority}
              onChange={setSelectedPriority}
              size="sm"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}