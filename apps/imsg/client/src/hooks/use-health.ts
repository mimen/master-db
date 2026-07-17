import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function usePrivateApi(): boolean {
  const [privateApi, setPrivateApi] = useState(false);
  useEffect(() => {
    api
      .health()
      .then((health) => setPrivateApi(health.privateApi))
      .catch(() => undefined);
  }, []);
  return privateApi;
}
