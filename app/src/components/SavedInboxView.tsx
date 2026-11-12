import { useMutation, usePaginatedQuery, useQuery } from "convex/react"
import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { useState } from "react"
import { Link } from "wouter"

// app/src/convex/_generated types every function as any; the root static codegen carries the real shapes.
import type { api as typedApi } from "../../../convex/_generated/api"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"

type SavedItem = FunctionReturnType<typeof typedApi.saved.public.list>["page"][number]
type Status = NonNullable<FunctionArgs<typeof typedApi.saved.public.list>["status"]>
type TagCount = FunctionReturnType<typeof typedApi.saved.public.tagCounts>[number]

const STATUSES = ["new", "kept", "done", "dropped"] as const satisfies readonly Status[]
const ACTIONS = [
  { status: "kept", label: "Keep" },
  { status: "done", label: "Done" },
  { status: "dropped", label: "Drop" },
] as const satisfies readonly { status: Status; label: string }[]

export function SavedInboxView() {
  const [status, setStatus] = useState<Status>("new")
  const [tag, setTag] = useState<string | undefined>()
  const tags = useQuery(api.saved.public.tagCounts) as TagCount[] | undefined
  const { results, status: loadState, loadMore } = usePaginatedQuery(
    api.saved.public.list,
    { status, tag },
    { initialNumItems: 25 },
  )
  const items = results as SavedItem[]

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" title="Back to tasks">
          <Link href="/"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <h1 className="text-xl font-semibold">Saved</h1>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Status">
        {STATUSES.map((s) => (
          <Button
            key={s}
            role="tab"
            aria-selected={s === status}
            variant={s === status ? "default" : "outline"}
            size="sm"
            onClick={() => setStatus(s)}
            className="capitalize"
          >
            {s}
          </Button>
        ))}
      </div>

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map(({ tag: t, count }) => (
            <button key={t} type="button" onClick={() => setTag(t === tag ? undefined : t)}>
              <Badge variant={t === tag ? "default" : "secondary"} className="font-normal">
                {t} <span className="ml-1 opacity-60">{count}</span>
              </Badge>
            </button>
          ))}
        </div>
      )}

      {loadState === "LoadingFirstPage" ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        items.map((item) => <SavedCard key={item._id} item={item} />)
      )}

      {loadState === "CanLoadMore" && (
        <Button variant="outline" className="w-full" onClick={() => loadMore(25)}>
          Load more
        </Button>
      )}
    </div>
  )
}

function SavedCard({ item }: { item: SavedItem }) {
  const setStatus = useMutation(api.saved.public.setStatus)
  const setNotes = useMutation(api.saved.public.setNotes)

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2 text-sm">
        <Badge variant="outline" className="uppercase">{item.platform}</Badge>
        {item.author && <span className="font-medium">{item.author}</span>}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          Open <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.text && <p className="whitespace-pre-wrap text-sm">{item.text}</p>}

        {item.media.length > 0 && (
          <div className={cn("grid gap-2", item.media.length > 1 && "grid-cols-2")}>
            {item.media.map((m, i) =>
              m.type === "video" ? (
                <video key={i} src={m.src} controls preload="none" className="w-full rounded-md" />
              ) : (
                <img key={i} src={m.src} alt="" loading="lazy" className="w-full rounded-md" />
              ),
            )}
          </div>
        )}

        {(item.summary || item.suggestion) && (
          <div className="rounded-md bg-muted p-3 text-sm">
            {item.suggestion && <span className="font-medium capitalize">{item.suggestion}. </span>}
            {item.summary}
          </div>
        )}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>
            ))}
          </div>
        )}

        <Textarea
          key={item.notes ?? ""}
          defaultValue={item.notes ?? ""}
          placeholder="Notes"
          className="min-h-[60px]"
          onBlur={(e) => {
            if (e.target.value !== (item.notes ?? "")) void setNotes({ id: item._id, notes: e.target.value })
          }}
        />

        <div className="flex flex-wrap gap-2">
          {ACTIONS.filter((a) => a.status !== item.status).map((a) => (
            <Button key={a.status} size="sm" variant="outline" onClick={() => void setStatus({ id: item._id, status: a.status })}>
              {a.label}
            </Button>
          ))}
          {item.status !== "new" && (
            <Button size="sm" variant="ghost" onClick={() => void setStatus({ id: item._id, status: "new" })}>
              Back to new
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
