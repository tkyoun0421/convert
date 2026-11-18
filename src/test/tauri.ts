import { vi } from "vitest";

export type DragPayload =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

type DragListener = (event: { payload: unknown }) => void;

interface ProgressMessage {
  percent: number | null;
  speed: number | null;
}

export class FakeChannel {
  onmessage: (message: ProgressMessage) => void = () => {};
}

export interface ConvertCall {
  payload: Record<string, unknown>;
  progress(message: ProgressMessage): void;
  resolve(outcome: { output: string; copied: boolean }): void;
  reject(error: unknown): void;
}

/** Stands in for the Rust side and the Tauri plugins, at the module boundary the app imports. */
class FakeTauri {
  converts: ConvertCall[] = [];
  readonly dragListeners = new Set<DragListener>();

  readonly invoke = vi.fn((cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "convert") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const channel = args.onProgress as FakeChannel;
      this.converts.push({
        payload: args,
        progress: (message) => channel.onmessage(message),
        resolve,
        reject,
      });
    });
  });

  readonly open = vi.fn<(options: unknown) => Promise<unknown>>();
  readonly revealItemInDir = vi.fn<(path: string) => Promise<void>>();

  invocations(cmd: string): unknown[] {
    return this.invoke.mock.calls.filter(([c]) => c === cmd).map(([, args]) => args);
  }

  drag(payload: DragPayload) {
    const event = { payload: { ...payload, position: { x: 0, y: 0 } } };
    for (const listener of [...this.dragListeners]) listener(event);
  }

  reset() {
    this.converts = [];
    this.dragListeners.clear();
    this.invoke.mockClear();
    this.open.mockReset().mockResolvedValue(null);
    this.revealItemInDir.mockReset().mockResolvedValue(undefined);
  }
}

export const tauri = new FakeTauri();

export const coreModule = {
  invoke: (cmd: string, args: Record<string, unknown>) => tauri.invoke(cmd, args),
  Channel: FakeChannel,
};

export const webviewModule = {
  getCurrentWebview: () => ({
    onDragDropEvent(listener: DragListener) {
      tauri.dragListeners.add(listener);
      return Promise.resolve(() => {
        tauri.dragListeners.delete(listener);
      });
    },
  }),
};

export const dialogModule = {
  open: (options: unknown) => tauri.open(options),
};

export const openerModule = {
  revealItemInDir: (path: string) => tauri.revealItemInDir(path),
};
