import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Shared markdown renderer for descriptions and transcript bodies.
 * Handles markdown + links; links open in a new tab safely (target=_blank
 * rel=noopener noreferrer), matching how MarkdownLinkText treats links.
 */
export function Prose({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => {
            void node
            return <a {...props} target="_blank" rel="noopener noreferrer" />
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
