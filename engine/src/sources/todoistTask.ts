import type { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { parseEntityRef, type EntitySource } from "./types";

export interface TodoistTaskPayload {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  due: unknown;
  raw: unknown;
}

interface TodoistItemRow {
  content: string;
  description?: string;
  project_id?: string;
  due?: unknown;
}

const getItemByTodoistIdPublic = makeFunctionReference<
  "query",
  { todoistId: string },
  TodoistItemRow | null
>("todoist/queries/getItemByTodoistIdPublic");

export function createTodoistTaskSource(
  client: ConvexHttpClient,
): EntitySource<TodoistTaskPayload> {
  return {
    async fetch(entity_ref: string) {
      const { entity_id } = parseEntityRef(entity_ref);
      const row = await client.query(getItemByTodoistIdPublic, {
        todoistId: entity_id,
      });
      if (!row) throw new Error(`todoist task not found: ${entity_id}`);
      return {
        id: entity_id,
        content: row.content,
        description: row.description ?? undefined,
        project_id: row.project_id ?? undefined,
        due: row.due,
        raw: row,
      };
    },
  };
}
