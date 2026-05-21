import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Truncate text to `max` characters, appending an ellipsis when shortened.
 * Returns the input unchanged when it's already within the limit.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + "…"
}

export interface MarkdownLinkPart {
  type: 'text' | 'link'
  content: string
  url?: string
}

export function parseMarkdownLinks(text: string): MarkdownLinkPart[] {
  const parts: MarkdownLinkPart[] = []
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      })
    }

    parts.push({
      type: 'link',
      content: match[1],
      url: match[2]
    })

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.slice(lastIndex)
    })
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }]
}