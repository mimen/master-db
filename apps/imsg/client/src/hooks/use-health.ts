import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Resolved once per app run, not per ThreadView mount. It used to refetch on
 * every chat switch, and until it landed `privateApi` was false — so a
 * long-press in the first moments of a thread gave you a stripped menu with no
 * Reply and no tapbacks. Same gesture, different menu, depending on a race.
 */
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<(value: boolean) => void>();

function resolve(): Promise<boolean> {
  inflight ??= api
    .health()
    .then((health) => {
      cached = health.privateApi;
      for (const l of listeners) l(health.privateApi);
      return health.privateApi;
    })
    .catch(() => {
      inflight = null; // unreachable server: let the next mount try again
      return false;
    });
  return inflight;
}

export function usePrivateApi(): boolean {
  const [privateApi, setPrivateApi] = useState(cached ?? false);
  useEffect(() => {
    if (cached !== null) {
      setPrivateApi(cached);
      return;
    }
    listeners.add(setPrivateApi);
    void resolve();
    return () => {
      listeners.delete(setPrivateApi);
    };
  }, []);
  return privateApi;
}
