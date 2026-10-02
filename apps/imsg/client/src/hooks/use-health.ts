import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Private API availability is fixed for the server's lifetime; fetch it once
// per app session, not once per opened chat.
let known: boolean | null = null;
let pending: Promise<boolean> | null = null;

export function usePrivateApi(): boolean {
  const [privateApi, setPrivateApi] = useState(known ?? false);
  useEffect(() => {
    if (known !== null) return;
    let active = true;
    pending ??= api
      .health()
      .then((health) => (known = health.privateApi))
      .finally(() => (pending = null));
    pending.then((value) => active && setPrivateApi(value)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return privateApi;
}
