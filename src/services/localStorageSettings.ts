import { DEFAULT_SETTINGS, parseSettings, type Settings } from "../domain/settings";
import type { SettingsStore } from "./ports";

export class LocalStorageSettingsStore implements SettingsStore {
  constructor(private readonly key: string) {}

  load(): Settings {
    try {
      return parseSettings(JSON.parse(localStorage.getItem(this.key) ?? "null"));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  save(settings: Settings): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(settings));
    } catch {
      // Settings just will not persist.
    }
  }
}
