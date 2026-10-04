export function fixtureCommandWatch<T>(load: () => Promise<T>) {
  let value: T | undefined;
  let error: unknown;
  return {
    localQueryResult: () => { if (error) throw error; return value; },
    onUpdate: (callback: () => void) => {
      let active = true;
      let inFlight = false;
      const refresh = async () => {
        if (inFlight) return;
        inFlight = true;
        try { const next = await load(); if (active) { value = next; error = undefined; callback(); } }
        catch (cause) { if (active) { error = cause; callback(); } }
        finally { inFlight = false; }
      };
      void refresh();
      const timer = setInterval(() => { void refresh(); }, 100);
      return () => { active = false; clearInterval(timer); };
    },
  };
}
