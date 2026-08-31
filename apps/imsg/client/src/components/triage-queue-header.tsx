import { DeskHeader, DESK_HEADER_HEIGHT } from "./desk-header";
import { TriageSummary } from "./triage-summary";

export const TRIAGE_QUEUE_HEADER_HEIGHT = DESK_HEADER_HEIGHT;

/** Messages' desk header — the shared DeskHeader shell with triage progress. */
export function TriageQueueHeader({
  title,
  completed,
  sweepCount,
  oldestAt,
  search,
  action,
  onSweep,
}: {
  title: string;
  completed: number;
  sweepCount: number;
  oldestAt: number | null;
  search: React.ReactNode;
  action: React.ReactNode;
  onSweep?: () => void;
}): React.JSX.Element {
  return (
    <DeskHeader
      testID="triage-queue-header"
      summary={
        <TriageSummary
          title={title}
          sweepCount={sweepCount}
          completed={completed}
          oldestAt={oldestAt}
          onSweep={onSweep}
        />
      }
      search={search}
      action={action}
    />
  );
}
