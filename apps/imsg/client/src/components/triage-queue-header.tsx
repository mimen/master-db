import { DeskHeader, DESK_HEADER_WITH_CONTROLS_HEIGHT } from "./desk-header";
import { TriageSummary } from "./triage-summary";

export const TRIAGE_QUEUE_HEADER_HEIGHT = DESK_HEADER_WITH_CONTROLS_HEIGHT;

export function TriageQueueHeader({
  title,
  sweepCount,
  search,
  action,
  controls,
  onSweep,
}: {
  title: string;
  sweepCount: number;
  search: React.ReactNode;
  action: React.ReactNode;
  controls: React.ReactNode;
  onSweep?: () => void;
}): React.JSX.Element {
  return (
    <DeskHeader
      testID="triage-queue-header"
      summary={<TriageSummary title={title} sweepCount={sweepCount} onSweep={onSweep} />}
      search={search}
      action={action}
      controls={controls}
    />
  );
}
