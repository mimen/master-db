// Example React component showing how to use Todoist actions with optimistic updates
// This file demonstrates the UI patterns discussed in CLAUDE.md

import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Doc } from "../convex/_generated/dataModel";
import { useState } from "react";

type TodoistItem = Doc<"todoist_items">;

export function TodoistTaskList({ projectId }: { projectId?: string }) {
  const tasks = useQuery(api.todoist.publicQueries.getActiveItems, { projectId });
  const [newTaskContent, setNewTaskContent] = useState("");

  // Create task with optimistic update
  const createTask = useMutation(api.todoist.publicActions.createTask)
    .withOptimisticUpdate((localStore, args) => {
      const currentTasks = localStore.getQuery(
        api.todoist.publicQueries.getActiveItems, 
        { projectId }
      );
      
      if (currentTasks) {
        // Create optimistic task
        const optimisticTask: TodoistItem = {
          _id: crypto.randomUUID() as any, // Temporary ID
          _creationTime: Date.now(),
          todoist_id: `temp_${Date.now()}`,
          content: args.content,
          project_id: args.projectId,
          checked: 0,
          is_deleted: 0,
          child_order: 0,
          priority: args.priority || 1,
          labels: args.labels || [],
          comment_count: 0,
          added_at: new Date().toISOString(),
          user_id: "temp",
          sync_version: Date.now(),
        };

        localStore.setQuery(
          api.todoist.publicQueries.getActiveItems,
          { projectId },
          [...currentTasks, optimisticTask]
        );
      }
    });

  // Complete task with optimistic update
  const completeTask = useMutation(api.todoist.publicActions.completeTask)
    .withOptimisticUpdate((localStore, args) => {
      const currentTasks = localStore.getQuery(
        api.todoist.publicQueries.getActiveItems,
        { projectId }
      );
      
      if (currentTasks) {
        localStore.setQuery(
          api.todoist.publicQueries.getActiveItems,
          { projectId },
          currentTasks.filter(task => task.todoist_id !== args.todoistId)
        );
      }
    });

  // Update task with optimistic update
  const updateTask = useMutation(api.todoist.publicActions.updateTask)
    .withOptimisticUpdate((localStore, args) => {
      const currentTasks = localStore.getQuery(
        api.todoist.publicQueries.getActiveItems,
        { projectId }
      );
      
      if (currentTasks) {
        localStore.setQuery(
          api.todoist.publicQueries.getActiveItems,
          { projectId },
          currentTasks.map(task => 
            task.todoist_id === args.todoistId
              ? { 
                  ...task, 
                  content: args.content || task.content,
                  priority: args.priority || task.priority,
                }
              : task
          )
        );
      }
    });

  // Delete task with optimistic update
  const deleteTask = useMutation(api.todoist.publicActions.deleteTask)
    .withOptimisticUpdate((localStore, args) => {
      const currentTasks = localStore.getQuery(
        api.todoist.publicQueries.getActiveItems,
        { projectId }
      );
      
      if (currentTasks) {
        localStore.setQuery(
          api.todoist.publicQueries.getActiveItems,
          { projectId },
          currentTasks.filter(task => task.todoist_id !== args.todoistId)
        );
      }
    });

  // Handle loading and error states
  if (tasks === undefined) {
    return <div className="animate-pulse">Loading tasks...</div>;
  }

  if (tasks === null) {
    return <div className="text-red-500">Error loading tasks</div>;
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskContent.trim()) return;

    const result = await createTask({ 
      content: newTaskContent,
      projectId,
    });

    if (result.success) {
      setNewTaskContent("");
    } else {
      // Handle error - optimistic update will auto-revert
      console.error("Failed to create task:", result.error);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      {/* Add task form */}
      <form onSubmit={handleCreateTask} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={newTaskContent}
            onChange={(e) => setNewTaskContent(e.target.value)}
            placeholder="Add a task..."
            className="flex-1 px-3 py-2 border rounded-md"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          >
            Add Task
          </button>
        </div>
      </form>

      {/* Task list */}
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem
            key={task._id}
            task={task}
            onComplete={() => completeTask({ todoistId: task.todoist_id })}
            onUpdate={(updates) => updateTask({ todoistId: task.todoist_id, ...updates })}
            onDelete={() => deleteTask({ todoistId: task.todoist_id })}
          />
        ))}
      </div>

      {tasks.length === 0 && (
        <p className="text-gray-500 text-center py-8">
          No tasks yet. Add one above!
        </p>
      )}
    </div>
  );
}

function TaskItem({ 
  task, 
  onComplete, 
  onUpdate, 
  onDelete 
}: { 
  task: TodoistItem;
  onComplete: () => void;
  onUpdate: (updates: { content?: string; priority?: number }) => void;
  onDelete: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(task.content);

  const handleSave = () => {
    if (editContent.trim() && editContent !== task.content) {
      onUpdate({ content: editContent });
    }
    setIsEditing(false);
  };

  const priorityColors = {
    1: "border-gray-200",
    2: "border-blue-200",
    3: "border-orange-200",
    4: "border-red-200",
  };

  return (
    <div className={`flex items-center gap-3 p-3 bg-white rounded-md border ${priorityColors[task.priority]}`}>
      <input
        type="checkbox"
        checked={false}
        onChange={onComplete}
        className="w-5 h-5 rounded"
      />
      
      {isEditing ? (
        <input
          type="text"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setIsEditing(false);
          }}
          className="flex-1 px-2 py-1 border rounded"
          autoFocus
        />
      ) : (
        <span 
          className="flex-1 cursor-pointer"
          onClick={() => setIsEditing(true)}
        >
          {task.content}
        </span>
      )}

      <button
        onClick={onDelete}
        className="text-red-500 hover:text-red-700"
      >
        Delete
      </button>
    </div>
  );
}

// Example usage in a page/app
export function ExampleApp() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm p-4">
        <h1 className="text-2xl font-bold text-center">My Todoist Tasks</h1>
      </header>
      
      <main className="container mx-auto py-8">
        <TodoistTaskList />
      </main>
    </div>
  );
}