import { LocalStorageSettingsStore } from "./localStorageSettings";
import type { Services } from "./ports";
import { TauriConverter, TauriDesktop } from "./tauri";

export const appServices: Services = {
  converter: new TauriConverter(),
  settings: new LocalStorageSettingsStore("videoToMp3.settings"),
  desktop: new TauriDesktop(),
};
