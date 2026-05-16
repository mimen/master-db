import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ProposalOption } from "@/lib/agent/proposalToParts"

const REV_CLASS: Record<string, string> = {
  trivial: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  moderate: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  destructive: "bg-rose-500/10 text-rose-600 border-rose-500/20",
}

export function ProposalOptionRow({
  option,
  recommended,
  onExecute,
  onModify,
}: {
  option: ProposalOption
  recommended: boolean
  onExecute: (id: string) => void
  onModify: (id: string) => void
}) {
  return (
    <div className={`rounded-md border p-4 ${recommended ? "border-emerald-500 ring-1 ring-emerald-500" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-base leading-tight">{option.label}</h3>
        {recommended && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 shrink-0 mt-0.5">★ Recommended</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-2 leading-snug">{option.description}</p>
      {option.rationale && (
        <p className="text-xs text-muted-foreground/70 mb-3 italic leading-snug">{option.rationale}</p>
      )}
      <div className="flex flex-wrap gap-1 mb-3">
        <Badge variant="secondary" className="text-[10px]">{Math.round(option.confidence * 100)}% confident</Badge>
        <Badge variant="outline" className={`text-[10px] ${REV_CLASS[option.reversibility] ?? ""}`}>
          {option.reversibility}
        </Badge>
        {option.side_effects?.map((s) => (
          <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={recommended ? "default" : "secondary"}
          onClick={() => onExecute(option.id)}
        >
          Execute
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onModify(option.id)}>
          Modify…
        </Button>
      </div>
    </div>
  )
}
