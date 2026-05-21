import { parseMarkdownLinks } from "@/lib/utils"

export function MarkdownLinkText({ text }: { text: string }) {
  const segments = parseMarkdownLinks(text)
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <span key={index}>{segment.content}</span>
        ) : (
          <a
            key={index}
            href={segment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary transition-colors"
            onClick={(event) => event.stopPropagation()}
          >
            {segment.content}
          </a>
        ),
      )}
    </>
  )
}
