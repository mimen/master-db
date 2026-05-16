// Tool-name → custom renderer override. Empty in v1; per-tool variants are a
// reserved seam (see spec §"Reserved seams"). Day-2 specializations register
// here without touching the transcript.
export const toolRegistry: Record<string, never> = {}
