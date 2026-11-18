import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../domain/settings";
import type { SettingsStore } from "../services/ports";

/** Settings loaded once from `store` and saved back on every change. */
export function useSettings(store: SettingsStore) {
  const [settings, setSettings] = useState(() => store.load());

  useEffect(() => {
    store.save(settings);
  }, [store, settings]);

  const updateSettings = useCallback(
    (change: Partial<Settings>) => setSettings((s) => ({ ...s, ...change })),
    [],
  );

  return { settings, updateSettings };
}
