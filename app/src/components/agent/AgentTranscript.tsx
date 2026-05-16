import { AssistantRuntimeProvider, ThreadPrimitive, MessagePrimitive } from "@assistant-ui/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { useAgentRuntime } from "@/hooks/useAgentRuntime"

function MarkdownProse({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export function AgentTranscript({ entity_ref }: { entity_ref: string }) {
  const { runtime, isLoading } = useAgentRuntime(entity_ref)
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex flex-col gap-3">
        <ThreadPrimitive.Viewport className="flex-1">
          <ThreadPrimitive.Messages
            components={{
              UserMessage: () => (
                <MessagePrimitive.Root className="ml-auto max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-sm">
                  <MessagePrimitive.Parts />
                </MessagePrimitive.Root>
              ),
              AssistantMessage: () => (
                <MessagePrimitive.Root className="max-w-full text-sm">
                  <MessagePrimitive.Parts />
                </MessagePrimitive.Root>
              ),
            }}
          />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}

export { MarkdownProse }
