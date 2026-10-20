import { useEffect, useState } from "react";

import { type GuestListEvent, useUpcomingGuestLists } from "@/lib/identity";

/** Milad's upcoming guest lists, loaded once per mount. Null while loading; a failed load reads as none, so the section stays hidden. */
export function useGuestLists(): { events: GuestListEvent[] | null; update: (event: GuestListEvent) => void } {
  const load = useUpcomingGuestLists();
  const [events, setEvents] = useState<GuestListEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((next) => live && setEvents(next))
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is a fresh closure each render; this fetch runs once per mount.
  }, []);
  const update = (next: GuestListEvent) => setEvents((current) => current?.map((e) => (e.eventId === next.eventId ? next : e)) ?? current);
  return { events, update };
}
