import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Card, CardHeader, CardContent } from "@/components/ui/card"

export function TaskProcessor() {
  const syncStatus = useQuery(api.todoist.queries.getSyncStatus)
  const tasks = useQuery(api.todoist.queries.getActiveItems)

  if (!syncStatus) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p>Loading sync status...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Sync Status</h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p><strong>Last Sync:</strong> {syncStatus.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleString() : 'Never'}</p>
              <p><strong>Token Valid:</strong> {syncStatus.isValidToken ? 'Yes' : 'No'}</p>
              <p><strong>Has Sync Token:</strong> {syncStatus.hasSyncToken ? 'Yes' : 'No'}</p>
              <p><strong>Project Count:</strong> {syncStatus.projectCount}</p>
              <p><strong>Item Count:</strong> {syncStatus.itemCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Active Tasks</h2>
          </CardHeader>
          <CardContent>
            {tasks ? (
              <div className="space-y-2">
                <p><strong>Total Active Tasks:</strong> {tasks.length}</p>
                {tasks.slice(0, 5).map((task: any) => (
                  <div key={task._id} className="p-2 border rounded">
                    <p className="font-medium">{task.content}</p>
                    <p className="text-sm text-muted-foreground">
                      Priority: {task.priority} | Due: {task.due?.date || 'No due date'}
                    </p>
                  </div>
                ))}
                {tasks.length > 5 && (
                  <p className="text-sm text-muted-foreground">
                    ... and {tasks.length - 5} more tasks
                  </p>
                )}
              </div>
            ) : (
              <p>Loading tasks...</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}