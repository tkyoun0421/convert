import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { tauri } from "./tauri";

vi.mock("@tauri-apps/api/core", async () => (await import("./tauri")).coreModule);
vi.mock("@tauri-apps/api/webview", async () => (await import("./tauri")).webviewModule);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./tauri")).dialogModule);
vi.mock("@tauri-apps/plugin-opener", async () => (await import("./tauri")).openerModule);

beforeEach(() => {
  tauri.reset();
  localStorage.clear();
});

afterEach(cleanup);
