import { parseEntityRef, type EntitySource } from "./types";

export interface SourceRegistry {
  fetch(entity_ref: string): Promise<unknown>;
}

export function createSourceRegistry(
  sources: Record<string, EntitySource>,
): SourceRegistry {
  return {
    async fetch(entity_ref: string) {
      const { entity_type } = parseEntityRef(entity_ref);
      const source = sources[entity_type];
      if (!source) {
        throw new Error(`no source registered for entity_type=${entity_type}`);
      }
      return source.fetch(entity_ref);
    },
  };
}
