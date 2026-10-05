import { DeskHeader, DESK_HEADER_WITH_CONTROLS_HEIGHT } from "./desk-header";

export const TRIAGE_QUEUE_HEADER_HEIGHT = DESK_HEADER_WITH_CONTROLS_HEIGHT;

/** The Messages sidebar header: search and actions over the lens tabs. */
export function TriageQueueHeader({
  search,
  action,
  controls,
}: {
  search: React.ReactNode;
  action: React.ReactNode;
  controls: React.ReactNode;
}): React.JSX.Element {
  return <DeskHeader testID="triage-queue-header" search={search} action={action} controls={controls} />;
}
