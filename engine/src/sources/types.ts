export interface ParsedEntityRef {
  entity_type: string;
  entity_id: string;
  raw: string;
}

export function parseEntityRef(raw: string): ParsedEntityRef {
  const parts = raw.split(":");
  if (parts.length < 3 || parts.some((p) => p.length === 0)) {
    throw new Error(`malformed entity_ref: ${raw}`);
  }
  const [system, kind, ...idParts] = parts;
  return {
    entity_type: `${system}_${kind}`,
    entity_id: idParts.join(":"),
    raw,
  };
}

export interface EntitySource<TPayload = unknown> {
  fetch(entity_ref: string): Promise<TPayload>;
}
