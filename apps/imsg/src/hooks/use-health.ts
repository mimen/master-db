import { useEffect, useState } from "react";

export function usePrivateApi(): boolean {
  const [privateApi, setPrivateApi] = useState(false);
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<{ privateApi: boolean }>)
      .then((health) => setPrivateApi(health.privateApi))
      .catch(() => undefined);
  }, []);
  return privateApi;
}
