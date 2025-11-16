import { useAction } from "convex/react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"

interface CreateProjectArgs {
  name: string
  parentId?: string
  color?: string
  isFavorite?: boolean
  viewStyle?: "list" | "board" | "calendar"
}

export function useCreateProject() {
  const createProjectAction = useAction(api.todoist.actions.createProject.createProject)

  const createProject = async (args: CreateProjectArgs) => {
    try {
      const result = await createProjectAction(args)

      if (result.success && result.data) {
        toast.success("Project created successfully!")
        return result.data
      } else {
        toast.error(result.error || "Failed to create project")
        return null
      }
    } catch (error) {
      console.error("Error creating project:", error)
      toast.error("Failed to create project. Please try again.")
      return null
    }
  }

  return { createProject }
}
