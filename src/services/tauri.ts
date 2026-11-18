import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { VIDEO_EXTENSIONS, type ConvertResult, type Progress } from "../domain/jobs";
import type { ConvertRequest, Converter, Desktop, FileDrag } from "./ports";

/** Rust `ConvertOutcome`. */
interface ConvertOutcome {
  output: string;
  copied: boolean;
}

/** Rust `ConvertError`, serialized with `#[serde(tag = "kind")]`. */
type ConvertError =
  | { kind: "canceled" }
  | { kind: "noAudioStream" }
  | { kind: "failed"; message: string };

function isConvertError(value: unknown): value is ConvertError {
  return typeof value === "object" && value !== null && "kind" in value;
}

function toResult(error: unknown): ConvertResult {
  if (isConvertError(error)) {
    switch (error.kind) {
      case "canceled":
        return { kind: "canceled" };
      case "noAudioStream":
        return { kind: "failed", message: "오디오 트랙이 없는 영상입니다" };
      case "failed":
        return { kind: "failed", message: error.message };
    }
  }
  return { kind: "failed", message: String(error) };
}

/** Calls the `convert` and `cancel` commands in `src-tauri/src/lib.rs`. */
export class TauriConverter implements Converter {
  convert(
    request: ConvertRequest,
    onProgress: (progress: Progress) => void,
  ): Promise<ConvertResult> {
    const channel = new Channel<Progress>();
    channel.onmessage = onProgress;
    return invoke<ConvertOutcome>("convert", { ...request, onProgress: channel }).then(
      ({ output, copied }) => ({ kind: "done", output, copied }),
      toResult,
    );
  }

  cancel(id: number): Promise<void> {
    return invoke("cancel", { id });
  }
}

export class TauriDesktop implements Desktop {
  pickVideos(): Promise<string[] | null> {
    return open({
      multiple: true,
      filters: [{ name: "영상 파일", extensions: VIDEO_EXTENSIONS }],
    });
  }

  async pickFolder(): Promise<string | null> {
    const dir = await open({ directory: true });
    return typeof dir === "string" ? dir : null;
  }

  reveal(path: string): Promise<void> {
    return revealItemInDir(path);
  }

  onFileDrag(listener: (drag: FileDrag) => void): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter" || payload.type === "over") {
          listener({ kind: "hover" });
        } else if (payload.type === "drop") {
          listener({ kind: "drop", paths: payload.paths });
        } else {
          listener({ kind: "leave" });
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }
}
