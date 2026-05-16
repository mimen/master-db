import { ArrowUp, Square } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { useRegisterComposer } from "@/contexts/AgentComposerContext"
import { useAgentPost } from "@/hooks/useAgentPost"

export function AgentComposer({
  entity_ref,
  isRunning,
}: {
  entity_ref: string
  isRunning: boolean
}) {
  const [text, setText] = useState("")
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { send, interrupt } = useAgentPost(entity_ref)
  const register = useRegisterComposer()

  useEffect(() => {
    register({
      startModify: (option_id, option_label) => {
        setText(`Modify option ${option_label}: `)
        taRef.current?.setAttribute("data-modify-option-id", option_id)
        taRef.current?.focus()
      },
      focus: () => taRef.current?.focus(),
    })
    return () => register(null)
  }, [register])

  async function submit() {
    const value = text.trim()
    if (!value) return
    const modifyId = taRef.current?.getAttribute("data-modify-option-id") ?? null
    setText("")
    taRef.current?.removeAttribute("data-modify-option-id")
    if (modifyId) {
      // Strip the "Modify option <label>: " prefix if still present.
      const colonIdx = value.indexOf(":")
      const userText = colonIdx >= 0 ? value.slice(colonIdx + 1).trim() : value
      await send(`MODIFY: ${modifyId}: ${userText}`)
    } else {
      await send(value)
    }
  }

  function onKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={2}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        placeholder="Ask a question or describe a modification…"
      />
      {isRunning ? (
        <Button
          type="button"
          aria-label="Stop"
          size="icon"
          className="rounded-full bg-rose-500/90 hover:bg-rose-500 text-white"
          onClick={() => void interrupt()}
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          aria-label="Send"
          size="icon"
          className="rounded-full"
          onClick={() => void submit()}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
