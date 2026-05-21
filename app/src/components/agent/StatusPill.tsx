// Status-pill pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md

import { getStatusMeta } from "@/lib/agent/statusMeta"

type Props = { status: string }

export function StatusPill({ status }: Props) {
  const conf = getStatusMeta(status)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${conf.cls} ${conf.pulse ? "animate-pulse" : ""}`}>
      {conf.label}
    </span>
  )
}
