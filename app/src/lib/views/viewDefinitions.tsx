import type {
  ViewBuildContext,
  ViewKey,
  ViewSelection,
} from "./types"
import { getViewDefinition } from "./viewRegistry"

export function resolveView(
  viewKey: ViewKey,
  context: ViewBuildContext = {}
): ViewSelection {
  const definition = getViewDefinition(viewKey)

  if (!definition) {
    throw new Error(`Unsupported view key: ${viewKey}`)
  }

  const lists = definition.buildLists(viewKey, 0, context)

  return {
    key: viewKey,
    metadata: definition.metadata,
    lists,
  }
}
